// Declarative transcript cards. A card rule maps the shape of a tool call to a
// card (title, tone, blocks) written as data with {{bindings}}, so a renderer
// can be designed by an agent, reviewed as text, shared as a file and rendered
// identically by the Web and the TUI. There is no code in a rule and no
// expression language: a binding is a path into the call, optionally piped
// through one of a fixed set of formatters.
//
//   { "id": "linear-issue", "status": "active",
//     "match": { "tool": "mcp__linear__get_issue" },
//     "title": "{{input.id}} · {{result.json.title}}",
//     "tone": [{ "when": { "path": "result.json.state", "equals": "Done" }, "tone": "success" }],
//     "blocks": [
//       { "type": "badge", "text": "{{result.json.state}}" },
//       { "type": "kv", "rows": [["Assignee", "{{result.json.assignee.name | default none}}"]] } ] }
//
// Browser-safe: no I/O. Everything produced goes through decodeCardBlocks, so
// scrubbing and caps are the same as for a plugin's own blocks.
import { decodeCardBlocks, scrubCardText, type CardBlock } from './cardBlocks'

export type CardRuleStatus = 'draft' | 'active' | 'disabled'
export type CardRuleTone = 'info' | 'success' | 'warning' | 'error'
/** `tool` is a tool name, or for kind "system" the subtype of a system message (a notice, a retry, a status). */
export type CardRuleMatch = { readonly kind?: 'tool' | 'system'; readonly tool: string; readonly mcpServer?: string; readonly keys?: readonly string[] }
export type CardRuleCondition = { readonly path: string; readonly equals?: string | number | boolean; readonly contains?: string; readonly exists?: boolean }
/**
 * Why a card is the way it is, written by whoever designed it. It is a claim, not a fact: the host
 * derives what a rule reads and shows from the rule itself (explainRule) and labels these as declared.
 */
export type CardRuleRationale = {
  readonly intent?: string
  readonly choices?: readonly { readonly block: string; readonly reason: string }[]
  readonly alternatives?: readonly string[]
  readonly assumptions?: readonly string[]
}
export type CardRule = {
  readonly id: string
  /** Counts the writes to this rule, set by the host; a patch names the revision it was written against. */
  readonly revision?: number
  readonly rationale?: CardRuleRationale
  readonly status: CardRuleStatus
  readonly match: CardRuleMatch
  readonly title: string
  readonly tone?: CardRuleTone | readonly { readonly when: CardRuleCondition; readonly tone: CardRuleTone }[]
  readonly blocks: readonly unknown[]
  /** Replace a native card too. Without it a rule applies only where the host has no dedicated card. */
  readonly overridesNative?: boolean
  /** A few redacted inputs/results the rule was designed against, for previews. */
  readonly samples?: readonly CardRuleSample[]
  readonly provenance?: { readonly by?: string; readonly at?: string; readonly sessionId?: string }
}
export type CardRuleSample = { readonly input: Record<string, unknown>; readonly result?: { readonly text: string; readonly isError?: boolean } }

/** What a rule is evaluated against: the call and, once it has one, its result. */
export type CardRuleContext = {
  readonly kind?: 'tool' | 'system'
  readonly tool: { readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  readonly result?: { readonly text: string; readonly isError: boolean }
}

export const CARD_RULE_LIMITS = Object.freeze({ id: 64, template: 600, blocks: 30, pathDepth: 8, pathSegment: 64, globLength: 120, keys: 12, samples: 3, sampleChars: 4_000, conditions: 8, jsonChars: 8_000, intent: 300, reason: 200, choices: 12, alternatives: 6, alternative: 100, assumptions: 6, assumption: 200 })
export const CARD_FORMATTERS = Object.freeze(['basename', 'dirname', 'truncate', 'join', 'upper', 'lower', 'count', 'default'] as const)
type Formatter = (typeof CARD_FORMATTERS)[number]

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const STATUSES = new Set<string>(['draft', 'active', 'disabled'])
const TONES = new Set<string>(['info', 'success', 'warning', 'error'])
const BINDING = /\{\{([^{}]*)\}\}/g

type Binding = { readonly path: readonly string[]; readonly pipes: readonly { readonly name: Formatter; readonly arg?: string }[] }

function parseBinding(source: string): Binding | string {
  const parts = source.split('|').map(part => part.trim())
  const path = parts[0]!.split('.').filter(Boolean)
  if (!path.length || path.length > CARD_RULE_LIMITS.pathDepth) return `binding "${source.trim().slice(0, 60)}" has no path or is too deep`
  if (!['input', 'result', 'tool'].includes(path[0]!)) return `binding "${path.join('.')}" must start with input, result or tool`
  for (const segment of path) if (!SEGMENT.test(segment) || FORBIDDEN.has(segment)) return `binding segment "${segment.slice(0, 30)}" is not allowed`
  const pipes: { name: Formatter; arg?: string }[] = []
  for (const piece of parts.slice(1)) {
    const [name, ...rest] = piece.split(/\s+/)
    if (!(CARD_FORMATTERS as readonly string[]).includes(name!)) return `unknown formatter "${(name ?? '').slice(0, 30)}"`
    pipes.push({ name: name as Formatter, ...(rest.length ? { arg: rest.join(' ') } : {}) })
  }
  return { path, pipes }
}

/** Every problem in a template string, or none. */
function templateProblems(template: unknown, where: string): string[] {
  if (typeof template !== 'string') return [`${where} is not a string`]
  if (template.length > CARD_RULE_LIMITS.template) return [`${where} is longer than ${CARD_RULE_LIMITS.template} characters`]
  const problems: string[] = []
  for (const match of template.matchAll(BINDING)) { const parsed = parseBinding(match[1]!); if (typeof parsed === 'string') problems.push(`${where}: ${parsed}`) }
  if (/\{\{|\}\}/.test(template.replace(BINDING, ''))) problems.push(`${where} has an unmatched brace`)
  return problems
}

function pathProblems(path: unknown, where: string): string[] {
  if (typeof path !== 'string') return [`${where} is not a string`]
  const parsed = parseBinding(path)
  return typeof parsed === 'string' ? [`${where}: ${parsed}`] : []
}

/** Strings inside a block that are templates. A block's shape decides which fields these are. */
function blockTemplateProblems(block: unknown, index: number): string[] {
  const where = `blocks[${index}]`
  if (!block || typeof block !== 'object') return [`${where} is not an object`]
  const b = block as Record<string, unknown>
  switch (b.type) {
    case 'heading': case 'text': case 'badge': case 'code': return templateProblems(b.text, `${where}.text`)
    case 'progress': return [...templateProblems(b.label, `${where}.label`), ...templateProblems(b.value, `${where}.value`), ...templateProblems(b.max, `${where}.max`)]
    case 'kv': return Array.isArray(b.rows) ? b.rows.flatMap((row, i) => Array.isArray(row) && row.length === 2 ? [...templateProblems(row[0], `${where}.rows[${i}][0]`), ...templateProblems(row[1], `${where}.rows[${i}][1]`)] : [`${where}.rows[${i}] is not a [key, value] pair`]) : [`${where}.rows is not an array`]
    case 'table': {
      if (typeof b.rowsFrom !== 'string' || !Array.isArray(b.columns) || !b.columns.length) return [`${where} needs rowsFrom and columns`]
      return [...pathProblems(b.rowsFrom, `${where}.rowsFrom`), ...b.columns.flatMap((column, i) => {
        const c = column as { header?: unknown; path?: unknown } | null
        return c && typeof c.header === 'string' ? [...templateProblems(c.header, `${where}.columns[${i}].header`), ...(typeof c.path === 'string' && /^[A-Za-z0-9_.-]*$/.test(c.path) ? [] : [`${where}.columns[${i}].path is not a plain path`])] : [`${where}.columns[${i}] needs a header`]
      })]
    }
    default: return [`${where} has unknown type "${String(b.type).slice(0, 30)}"`]
  }
}

function globToRegExp(glob: string): RegExp { return new RegExp(`^${glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`) }

/** A rationale reduced to bounded, scrubbed strings; whatever is malformed is dropped, never repaired. */
function parseRationale(raw: Record<string, unknown>): CardRuleRationale {
  const L = CARD_RULE_LIMITS
  const list = (value: unknown, max: number, each: number) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, max).map(item => scrubCardText(item, each)) : []
  const choices = Array.isArray(raw.choices) ? raw.choices.slice(0, L.choices).flatMap((choice: unknown) => { const c = choice as { block?: unknown; reason?: unknown } | null; return c && typeof c.block === 'string' && typeof c.reason === 'string' && c.reason.trim() ? [{ block: scrubCardText(c.block, 40), reason: scrubCardText(c.reason, L.reason) }] : [] }) : []
  const alternatives = list(raw.alternatives, L.alternatives, L.alternative), assumptions = list(raw.assumptions, L.assumptions, L.assumption)
  return { ...(typeof raw.intent === 'string' && raw.intent.trim() ? { intent: scrubCardText(raw.intent, L.intent) } : {}), ...(choices.length ? { choices } : {}), ...(alternatives.length ? { alternatives } : {}), ...(assumptions.length ? { assumptions } : {}) }
}

/** Every binding a rule reads, in the order first met: what the card is grounded in. */
export function ruleBindingPaths(rule: CardRule): string[] {
  const seen = new Set<string>()
  const scan = (text: unknown) => { if (typeof text === 'string') for (const match of text.matchAll(BINDING)) { const parsed = parseBinding(match[1]!); if (typeof parsed !== 'string') seen.add(parsed.path.join('.')) } }
  scan(rule.title)
  for (const block of rule.blocks as readonly Record<string, unknown>[]) {
    for (const key of ['text', 'label', 'value', 'max']) scan(block[key])
    if (Array.isArray(block.rows)) for (const row of block.rows) if (Array.isArray(row)) { scan(row[0]); scan(row[1]) }
    if (typeof block.rowsFrom === 'string') { const parsed = parseBinding(block.rowsFrom); if (typeof parsed !== 'string') seen.add(parsed.path.join('.')) }
    if (Array.isArray(block.columns)) for (const column of block.columns) scan((column as { header?: unknown }).header)
  }
  if (Array.isArray(rule.tone)) for (const entry of rule.tone) { const parsed = parseBinding(entry.when.path); if (typeof parsed !== 'string') seen.add(parsed.path.join('.')) }
  return [...seen]
}

/** A rule from untrusted data (a file, an agent), or the reasons it was refused. A refused rule is never rendered. */
export function parseCardRule(raw: unknown): { rule: CardRule | null; problems: string[] } {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { rule: null, problems: ['a card rule is not an object'] }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID.test(r.id)) problems.push('id must be lowercase letters, digits, ".", "_" or "-" (at most 64)')
  if (!STATUSES.has(String(r.status))) problems.push('status must be draft, active or disabled')
  const m = r.match as Record<string, unknown> | undefined
  if (!m || typeof m !== 'object' || typeof m.tool !== 'string' || !m.tool || m.tool.length > CARD_RULE_LIMITS.globLength || !/^[A-Za-z0-9_.*:-]+$/.test(m.tool)) problems.push('match.tool must be a tool name, with * as the only wildcard')
  else if (m.tool.replace(/\*/g, '') === '') problems.push('match.tool must name something: "*" alone would match every tool')
  if (m && m.kind !== undefined && m.kind !== 'tool' && m.kind !== 'system') problems.push('match.kind must be tool or system')
  if (m && m.mcpServer !== undefined && (typeof m.mcpServer !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(m.mcpServer))) problems.push('match.mcpServer is not a server name')
  if (m && m.keys !== undefined && (!Array.isArray(m.keys) || m.keys.length > CARD_RULE_LIMITS.keys || !m.keys.every(key => typeof key === 'string' && SEGMENT.test(key) && !FORBIDDEN.has(key)))) problems.push('match.keys must be up to 12 plain key names')
  problems.push(...templateProblems(r.title, 'title'))
  if (!Array.isArray(r.blocks)) problems.push('blocks must be an array')
  else if (r.blocks.length > CARD_RULE_LIMITS.blocks) problems.push(`blocks has more than ${CARD_RULE_LIMITS.blocks} entries`)
  else r.blocks.forEach((block, index) => problems.push(...blockTemplateProblems(block, index)))
  if (r.tone !== undefined && !(typeof r.tone === 'string' && TONES.has(r.tone))) {
    if (!Array.isArray(r.tone) || r.tone.length > CARD_RULE_LIMITS.conditions) problems.push('tone must be a tone or up to 8 {when, tone} rules')
    else r.tone.forEach((entry, index) => {
      const e = entry as { when?: { path?: unknown; equals?: unknown; contains?: unknown; exists?: unknown }; tone?: unknown } | null
      if (!e || !TONES.has(String(e.tone)) || !e.when) problems.push(`tone[${index}] needs when and a tone`)
      else { problems.push(...pathProblems(e.when.path, `tone[${index}].when.path`)); if (e.when.equals === undefined && e.when.contains === undefined && e.when.exists === undefined) problems.push(`tone[${index}].when needs equals, contains or exists`) }
    })
  }
  if (r.revision !== undefined && !(Number.isInteger(r.revision) && (r.revision as number) >= 1 && (r.revision as number) <= 1_000_000)) problems.push('revision must be a positive integer')
  if (r.rationale !== undefined && (!r.rationale || typeof r.rationale !== 'object' || Array.isArray(r.rationale))) problems.push('rationale must be an object')
  if (r.samples !== undefined && (!Array.isArray(r.samples) || r.samples.length > CARD_RULE_LIMITS.samples)) problems.push('samples must be at most 3 entries')
  if (problems.length) return { rule: null, problems }
  const samples = (Array.isArray(r.samples) ? r.samples : []).flatMap((sample: unknown) => {
    const s = sample as { input?: unknown; result?: { text?: unknown; isError?: unknown } } | null
    if (!s || typeof s.input !== 'object' || !s.input || Array.isArray(s.input) || JSON.stringify(s.input).length > CARD_RULE_LIMITS.sampleChars) return []
    return [{ input: s.input as Record<string, unknown>, ...(s.result && typeof s.result.text === 'string' ? { result: { text: s.result.text.slice(0, CARD_RULE_LIMITS.sampleChars), isError: s.result.isError === true } } : {}) }]
  })
  const prov = r.provenance as Record<string, unknown> | undefined
  return {
    rule: {
      id: r.id as string, status: r.status as CardRuleStatus,
      ...(typeof r.revision === 'number' ? { revision: r.revision } : {}),
      ...(r.rationale ? { rationale: parseRationale(r.rationale as Record<string, unknown>) } : {}),
      match: { ...(m!.kind === 'system' ? { kind: 'system' as const } : {}), tool: (m as { tool: string }).tool, ...(typeof m!.mcpServer === 'string' ? { mcpServer: m!.mcpServer } : {}), ...(Array.isArray(m!.keys) ? { keys: m!.keys as string[] } : {}) },
      title: r.title as string, blocks: r.blocks as unknown[],
      ...(r.tone !== undefined ? { tone: r.tone as CardRule['tone'] } : {}),
      ...(r.overridesNative === true ? { overridesNative: true } : {}),
      ...(samples.length ? { samples } : {}),
      ...(prov && typeof prov === 'object' ? { provenance: { ...(typeof prov.by === 'string' ? { by: scrubCardText(prov.by, 80) } : {}), ...(typeof prov.at === 'string' ? { at: scrubCardText(prov.at, 40) } : {}), ...(typeof prov.sessionId === 'string' ? { sessionId: scrubCardText(prov.sessionId, 80) } : {}) } } : {}),
    },
    problems: [],
  }
}

/** The MCP server a tool name belongs to (`mcp__<server>__<tool>`), if it is one. */
export function mcpServerOf(toolName: string): string | null {
  const match = /^mcp__(.+?)__.+$/.exec(toolName)
  return match ? match[1]! : null
}

export function cardRuleMatches(rule: CardRule, context: CardRuleContext): boolean {
  if ((rule.match.kind ?? 'tool') !== (context.kind ?? 'tool')) return false
  if (!globToRegExp(rule.match.tool).test(context.tool.name)) return false
  if (rule.match.mcpServer && mcpServerOf(context.tool.name) !== rule.match.mcpServer) return false
  if (rule.match.keys?.some(key => !Object.hasOwn(context.tool.input, key))) return false
  return true
}

/** How specific a rule is, so the narrower of two matching rules wins: exact name, then more literal characters, then more required keys. */
export function cardRuleSpecificity(rule: CardRule): number {
  return (rule.match.tool.includes('*') ? 0 : 1_000_000) + rule.match.tool.replace(/\*/g, '').length * 100 + (rule.match.mcpServer ? 50 : 0) + (rule.match.keys?.length ?? 0)
}

type Scope = { input: unknown; result: { text: string; isError: boolean; json: unknown } | undefined; tool: { name: string } }

function scopeOf(context: CardRuleContext): Scope {
  let json: unknown
  const text = context.result?.text ?? ''
  if (context.result && text.length <= CARD_RULE_LIMITS.jsonChars && /^\s*[[{]/.test(text)) { try { json = JSON.parse(text) } catch { /* not JSON: result.json stays unset */ } }
  return { input: context.tool.input, result: context.result ? { text, isError: context.result.isError, json } : undefined, tool: { name: context.tool.name } }
}

function lookup(root: unknown, path: readonly string[]): unknown {
  let value: unknown = root
  for (const segment of path) {
    if (value === null || typeof value !== 'object') return undefined
    if (Array.isArray(value)) { if (!/^\d{1,4}$/.test(segment) && segment !== 'length') return undefined; value = segment === 'length' ? value.length : value[Number(segment)] }
    else value = Object.hasOwn(value, segment) ? (value as Record<string, unknown>)[segment] : undefined
  }
  return value
}

const asText = (value: unknown): string => value === undefined || value === null ? '' : typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : Array.isArray(value) ? value.map(asText).join(', ') : JSON.stringify(value)

function applyFormatter(name: Formatter, value: unknown, arg: string | undefined): unknown {
  switch (name) {
    case 'basename': return asText(value).split(/[\\/]/).filter(Boolean).pop() ?? ''
    case 'dirname': { const parts = asText(value).split(/[\\/]/); parts.pop(); return parts.join('/') }
    case 'truncate': { const n = Math.max(1, Math.min(2_000, Number(arg) || 80)); const text = asText(value); return text.length > n ? `${text.slice(0, n - 1)}…` : text }
    case 'join': return Array.isArray(value) ? value.map(asText).join(arg ?? ', ') : asText(value)
    case 'upper': return asText(value).toUpperCase()
    case 'lower': return asText(value).toLowerCase()
    case 'count': return Array.isArray(value) ? value.length : typeof value === 'string' ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
    case 'default': return value === undefined || value === null || value === '' ? arg ?? '' : value
  }
}

function resolveBinding(source: string, scope: Scope): unknown {
  const parsed = parseBinding(source)
  if (typeof parsed === 'string') return ''
  let value = lookup(scope, parsed.path)
  for (const pipe of parsed.pipes) value = applyFormatter(pipe.name, value, pipe.arg)
  return value
}

/** A template with each binding replaced by its text. A binding that finds nothing is empty, never "undefined". */
function renderTemplate(template: string, scope: Scope, max: number): string {
  return scrubCardText(template.replace(BINDING, (_, source: string) => asText(resolveBinding(source, scope))), max)
}

function conditionHolds(when: CardRuleCondition, scope: Scope): boolean {
  const value = resolveBinding(when.path, scope)
  if (when.exists !== undefined) return (value !== undefined && value !== null && value !== '') === when.exists
  if (when.equals !== undefined) return value === when.equals || asText(value) === String(when.equals)
  if (when.contains !== undefined) return asText(value).includes(when.contains)
  return false
}

export type RenderedCard = { readonly title: string; readonly tone: CardRuleTone; readonly blocks: CardBlock[] }

/** The card a rule makes of a call. A failed call is toned as an error whatever the rule says: a rule cannot make a failure look fine. */
export function renderCardRule(rule: CardRule, context: CardRuleContext): RenderedCard {
  const scope = scopeOf(context)
  const L = CARD_RULE_LIMITS
  let tone: CardRuleTone = 'info'
  if (typeof rule.tone === 'string') tone = rule.tone
  else if (Array.isArray(rule.tone)) for (const entry of rule.tone) if (conditionHolds(entry.when, scope)) { tone = entry.tone; break }
  if (context.result?.isError) tone = 'error'
  const raw: unknown[] = []
  for (const block of rule.blocks as readonly Record<string, unknown>[]) {
    const text = (value: unknown, max = 2_000) => renderTemplate(String(value ?? ''), scope, max)
    if (block.type === 'heading' || block.type === 'text' || block.type === 'badge' || block.type === 'code') raw.push({ ...block, text: text(block.text, 20_000) })
    else if (block.type === 'progress') raw.push({ type: 'progress', label: text(block.label, 120), value: Number(text(block.value, 40)), max: Number(text(block.max, 40)) })
    else if (block.type === 'kv') raw.push({ type: 'kv', rows: (block.rows as [string, string][]).map(([key, value]) => [text(key, 120), text(value, 500)]) })
    else if (block.type === 'table') {
      const source = resolveBinding(String(block.rowsFrom), scope)
      const columns = block.columns as { header: string; path: string }[]
      const rows = (Array.isArray(source) ? source : []).slice(0, 100).map(row => columns.map(column => asText(column.path ? lookup(row, column.path.split('.').filter(Boolean)) : row)))
      raw.push({ type: 'table', columns: columns.map(column => text(column.header, 120)), rows })
    }
  }
  return { title: renderTemplate(rule.title, scope, 120), tone, blocks: decodeCardBlocks(raw).slice(0, L.blocks) }
}

// What past transcripts say about how tools are called and what they return. The live read path sees a
// call once and keeps three samples; this reads the sessions already on disk and keeps *statistics*: how
// often each result field is present, what values an enum-like field takes, how long arrays run, how often
// calls fail. A card designed from that handles optional fields, uses the real states for its tone, and
// can be checked against hundreds of calls instead of three.
//
// Local and bounded. Only derived numbers and redacted samples are kept (never whole transcripts); the
// scan is incremental (a session is read once), newest first, and stops at a session count, a deadline or
// an abort. A field named like a secret is never recorded, and a field with many distinct values keeps no
// value list at all, so ids and tokens cannot leak into "enums".
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasNativeToolCard } from '../plugins/nativeTools'
import { ruleBindingPaths, type CardRule } from '../plugins/cardTemplates'
import { redactForSample, redactResultText, type ShapeSample } from './shapes'

/** `present` counts the results (or calls) a field appeared in, once each; `count` every observation, so an item field of a list can be seen many times in one result. */
export type FieldStat = { present: number; count: number; empty: number; types: Record<string, number>; values: Record<string, number> | null; arrayMin?: number; arrayMax?: number; stringMax?: number }
export type ToolCorpus = {
  tool: string; mcpServer?: string
  calls: number; errors: number; withResult: number; jsonResults: number; sessions: number
  bytesSum: number; bytesMax: number
  keySets: Record<string, number>
  fields: Record<string, FieldStat>
  samples: ShapeSample[]
  firstSeen: number; lastSeen: number
}
export type Corpus = { version: 1; tools: Record<string, ToolCorpus>; scanned: Record<string, number>; updatedAt: number }

export const CORPUS_LIMITS = Object.freeze({ tools: 200, fieldsPerTool: 150, samples: 6, keySets: 12, scanned: 5_000, depth: 5, arrayItems: 20, keysPerObject: 60, enumValues: 12, enumValueChars: 40, enumMinPresent: 5, jsonChars: 2_000_000, minForNever: 8 })
const SECRET_KEY = /token|secret|passw|authorization|api[-_]?key|credential|cookie|bearer/i

export const emptyCorpus = (): Corpus => ({ version: 1, tools: {}, scanned: {}, updatedAt: 0 })

// ── persistence ────────────────────────────────────────────────────────────────────────────────────

export function adaptiveUiStateDir(): string { return process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR || join(process.cwd(), '.agent-viewer-data', 'adaptive-ui') }
const corpusFile = () => join(adaptiveUiStateDir(), 'corpus.json')

export function loadCorpus(): Corpus {
  try {
    const raw = JSON.parse(readFileSync(corpusFile(), 'utf8')) as Corpus
    if (raw?.version === 1 && raw.tools && typeof raw.tools === 'object' && raw.scanned && typeof raw.scanned === 'object') return raw
  } catch { /* none yet, or unreadable: start empty */ }
  return emptyCorpus()
}
/**
 * A value list is only worth keeping for a field whose values REPEAT (a status, a level). One that is mostly
 * distinct per call (an id, a path, a timestamp) is not an enum, and keeping its values would store what is
 * effectively an identifier, so those lists are dropped once enough calls show the pattern.
 */
export function pruneEnums(corpus: Corpus): void {
  for (const tool of Object.values(corpus.tools)) {
    for (const stat of Object.values(tool.fields)) {
      if (stat.values && stat.count >= CORPUS_LIMITS.enumMinPresent && Object.keys(stat.values).length * 2 > stat.count) stat.values = null
    }
  }
}

export function saveCorpus(corpus: Corpus): void {
  pruneEnums(corpus)
  try {
    mkdirSync(adaptiveUiStateDir(), { recursive: true, mode: 0o700 })
    const file = corpusFile(), temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(corpus), { mode: 0o600 })
    renameSync(temp, file)
  } catch { /* a corpus that cannot be saved is rebuilt by the next scan */ }
}

// ── ingesting one call ─────────────────────────────────────────────────────────────────────────────

export type CorpusCall = { readonly tool: string; readonly input: Readonly<Record<string, unknown>>; readonly result?: { readonly text: string; readonly isError: boolean }; readonly at: number }
const typeOf = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const isEmptyValue = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && value !== null && !Array.isArray(value) && !Object.keys(value).length)

function observeField(tool: ToolCorpus, path: string, value: unknown, seen: Set<string>): void {
  let stat = tool.fields[path]
  if (!stat) {
    if (Object.keys(tool.fields).length >= CORPUS_LIMITS.fieldsPerTool) return
    stat = tool.fields[path] = { present: 0, count: 0, empty: 0, types: {}, values: {} }
  }
  stat.count++
  if (!seen.has(path)) { seen.add(path); stat.present++ }
  if (isEmptyValue(value)) stat.empty++
  const type = typeOf(value); stat.types[type] = (stat.types[type] ?? 0) + 1
  if (Array.isArray(value)) { stat.arrayMin = Math.min(stat.arrayMin ?? value.length, value.length); stat.arrayMax = Math.max(stat.arrayMax ?? 0, value.length) }
  if (typeof value === 'string') stat.stringMax = Math.max(stat.stringMax ?? 0, value.length)
  const last = path.split('.').at(-1) ?? ''
  if (stat.values && (typeof value === 'string' || typeof value === 'boolean') && !SECRET_KEY.test(last)) {
    const text = String(value)
    if (text.length > CORPUS_LIMITS.enumValueChars) stat.values = null
    else {
      stat.values[text] = (stat.values[text] ?? 0) + 1
      if (Object.keys(stat.values).length > CORPUS_LIMITS.enumValues) stat.values = null
    }
  } else if (stat.values && typeof value === 'number') stat.values = null
}

function walk(tool: ToolCorpus, path: string, value: unknown, depth: number, seen: Set<string>): void {
  const last = path.split('.').at(-1) ?? ''
  if (SECRET_KEY.test(last.replace('[]', ''))) return
  observeField(tool, path, value, seen)
  if (depth >= CORPUS_LIMITS.depth) return
  if (Array.isArray(value)) for (const item of value.slice(0, CORPUS_LIMITS.arrayItems)) walk(tool, `${path}[]`, item, depth + 1, seen)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, CORPUS_LIMITS.keysPerObject)) walk(tool, `${path}.${key}`, item, depth + 1, seen)
}

function newTool(tool: string, at: number): ToolCorpus {
  const server = /^mcp__(.+?)__.+$/.exec(tool)?.[1]
  return { tool, ...(server ? { mcpServer: server } : {}), calls: 0, errors: 0, withResult: 0, jsonResults: 0, sessions: 0, bytesSum: 0, bytesMax: 0, keySets: {}, fields: {}, samples: [], firstSeen: at, lastSeen: at }
}

/** Fold one call into the corpus. Tools a built-in card draws are not tracked: there is nothing to design. */
export function ingestCall(corpus: Corpus, call: CorpusCall): void {
  if (hasNativeToolCard(call.tool)) return
  let tool = corpus.tools[call.tool]
  if (!tool) {
    if (Object.keys(corpus.tools).length >= CORPUS_LIMITS.tools) {
      const least = Object.values(corpus.tools).sort((a, b) => a.calls - b.calls)[0]!
      delete corpus.tools[least.tool]
    }
    tool = corpus.tools[call.tool] = newTool(call.tool, call.at)
  }
  tool.calls++; tool.firstSeen = Math.min(tool.firstSeen, call.at); tool.lastSeen = Math.max(tool.lastSeen, call.at)
  const keys = Object.keys(call.input ?? {}).filter(key => /^[A-Za-z0-9_-]{1,64}$/.test(key)).sort().join(',')
  const known = keys in tool.keySets
  if (known || Object.keys(tool.keySets).length < CORPUS_LIMITS.keySets) tool.keySets[keys] = (tool.keySets[keys] ?? 0) + 1
  const inputSeen = new Set<string>()
  for (const key of keys ? keys.split(',') : []) observeField(tool, `input.${key}`, (call.input as Record<string, unknown>)[key], inputSeen)
  let keep: 'error' | 'new-keys' | 'largest' | 'first' | null = null
  let size = 0
  if (call.result) {
    tool.withResult++; size = call.result.text.length; tool.bytesSum += size; tool.bytesMax = Math.max(tool.bytesMax, size)
    if (call.result.isError) { tool.errors++; if (!tool.samples.some(sample => sample.result?.isError)) keep = 'error' }
    if (!call.result.isError && size <= CORPUS_LIMITS.jsonChars && /^\s*[[{]/.test(call.result.text)) {
      try { walk(tool, 'result.json', JSON.parse(call.result.text), 0, new Set()); tool.jsonResults++ } catch { /* not JSON */ }
    }
  }
  if (!keep) {
    if (!tool.samples.length) keep = 'first'
    else if (!known && tool.samples.length < CORPUS_LIMITS.samples) keep = 'new-keys'
    else if (call.result && !call.result.isError && size > Math.max(0, ...tool.samples.map(sample => sample.result?.text.length ?? 0)) * 1.5 && tool.samples.length < CORPUS_LIMITS.samples) keep = 'largest'
  }
  if (keep && tool.samples.length < CORPUS_LIMITS.samples) tool.samples.push({ input: redactForSample(call.input) as Record<string, unknown>, ...(call.result ? { result: { text: redactResultText(call.result.text), isError: call.result.isError } } : {}) })
}

// ── reading the profile ────────────────────────────────────────────────────────────────────────────

const pct = (n: number, of: number) => of ? Math.round((100 * n) / of) : 0
const kb = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`

/** One line for the gallery: how much history there is for a tool. */
export function corpusSummary(tool: ToolCorpus): string {
  return `${tool.calls} past call${tool.calls === 1 ? '' : 's'} in ${tool.sessions} session${tool.sessions === 1 ? '' : 's'} · ${pct(tool.errors, tool.withResult || tool.calls)}% failed${tool.withResult ? ` · JSON ${pct(tool.jsonResults, tool.withResult)}% · typical ${kb(Math.round(tool.bytesSum / tool.withResult))}, up to ${kb(tool.bytesMax)}` : ''}`
}

/** What a designer is told about real results: presence, types, enum values and list lengths per field. */
export function corpusProfileText(tool: ToolCorpus): string {
  const lines = [`Past use of this tool (${corpusSummary(tool)}).`]
  const keySets = Object.entries(tool.keySets).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([keys, n]) => `${n}× {${keys || 'no arguments'}}`)
  if (keySets.length) lines.push(`Calls: ${keySets.join(', ')}.`)
  const fields = Object.entries(tool.fields).filter(([path, stat]) => path.startsWith('result.json') && path !== 'result.json' && Object.keys(stat.types).join() !== 'object').sort((a, b) => b[1].present - a[1].present || a[0].localeCompare(b[0])).slice(0, 40)
  if (fields.length) {
    lines.push(`Fields of JSON results (${tool.jsonResults} parsed), share of results where each is present:`)
    for (const [path, stat] of fields) {
      const types = Object.entries(stat.types).sort((a, b) => b[1] - a[1]).map(([type]) => type).join('/')
      const values = stat.values && stat.count >= CORPUS_LIMITS.enumMinPresent && Object.keys(stat.values).length * 2 <= stat.count && Object.keys(stat.values).length >= 1 && Object.keys(stat.values).length <= CORPUS_LIMITS.enumValues && types !== 'object' && types !== 'array'
        ? ` one of: ${Object.entries(stat.values).sort((a, b) => b[1] - a[1]).map(([value, n]) => `${value} (${pct(n, stat.count)}%)`).join(', ')}` : ''
      const list = stat.arrayMax !== undefined ? ` ${stat.arrayMin}–${stat.arrayMax} items` : ''
      const empty = stat.empty && stat.empty * 2 >= stat.count ? ' (usually empty)' : ''
      lines.push(`  ${path}  ${pct(stat.present, tool.jsonResults)}%  ${types}${list}${values}${empty}`)
    }
  } else if (tool.withResult) lines.push('Results are not JSON (plain text), so bind result.text.')
  return lines.join('\n')
}

/** `items.0.name` is `items[].name` in the profile. */
const profilePath = (binding: string) => binding.replace(/\.\d+(?=\.|$)/g, '[]')

/**
 * Check a rule's bindings against what real results looked like. A field no past result had is a refusal
 * for a designer (`never`); one present in under half is a warning.
 */
export function profileCoverage(rule: CardRule, tool: ToolCorpus | undefined): { never: string[]; rare: string[] } {
  const out = { never: [] as string[], rare: [] as string[] }
  if (!tool) return out
  for (const binding of ruleBindingPaths(rule)) {
    if (binding.startsWith('result.json') && tool.jsonResults >= CORPUS_LIMITS.minForNever && !binding.endsWith('.length')) {
      const stat = tool.fields[profilePath(binding)]
      if (!stat) out.never.push(`${binding} was never present in ${tool.jsonResults} past JSON results`)
      else if (stat.present * 2 < tool.jsonResults) out.rare.push(`${binding} is present in only ${pct(stat.present, tool.jsonResults)}% of ${tool.jsonResults} past JSON results`)
    } else if (binding.startsWith('result.json') && tool.withResult >= CORPUS_LIMITS.minForNever && tool.jsonResults === 0) out.never.push(`past results of this tool were never JSON, so ${binding} is always empty: use result.text`)
    else if (binding.startsWith('input.') && tool.calls >= CORPUS_LIMITS.minForNever) {
      const key = binding.split('.')[1]!
      const having = Object.entries(tool.keySets).filter(([keys]) => keys.split(',').includes(key)).reduce((sum, [, n]) => sum + n, 0)
      if (having === 0) out.never.push(`${binding} was never passed in ${tool.calls} past calls`)
      else if (having * 2 < tool.calls) out.rare.push(`${binding} is passed in only ${pct(having, tool.calls)}% of ${tool.calls} past calls`)
    }
  }
  return out
}

// ── the scan ───────────────────────────────────────────────────────────────────────────────────────

export type HistorySession = { readonly key: string; readonly lastModified: number }
export type HistorySource = {
  /** Sessions, any order; the scan sorts newest first. */
  list(): Promise<readonly HistorySession[]>
  /** The messages of one session in the wire format (assistant tool_use blocks, user tool_result blocks). */
  read(session: HistorySession, signal?: AbortSignal): Promise<readonly { message?: unknown; timestamp?: string }[]>
}
export type ScanOptions = { readonly maxSessions?: number; readonly deadlineMs?: number; readonly signal?: AbortSignal; readonly now?: () => number }
export type ScanReport = { readonly scanned: number; readonly remaining: number; readonly calls: number; readonly tools: number; readonly stopped: 'done' | 'limit' | 'deadline' | 'aborted' }

type Block = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map(part => (part as { type?: string; text?: unknown })?.type === 'text' ? String((part as { text?: unknown }).text ?? '') : '').join('\n') : ''
}

/** Read each not-yet-read session (newest first) and fold its tool calls in. Persists as it goes. */
export async function scanHistory(corpus: Corpus, source: HistorySource, options: ScanOptions = {}): Promise<ScanReport> {
  const now = options.now ?? Date.now
  const started = now()
  const sessions = [...await source.list()].sort((a, b) => b.lastModified - a.lastModified).filter(session => !(session.key in corpus.scanned))
  let scanned = 0, calls = 0, stopped: ScanReport['stopped'] = 'done'
  for (const session of sessions) {
    if (options.signal?.aborted) { stopped = 'aborted'; break }
    if (scanned >= (options.maxSessions ?? 40)) { stopped = 'limit'; break }
    if (options.deadlineMs !== undefined && now() - started > options.deadlineMs) { stopped = 'deadline'; break }
    let messages: Awaited<ReturnType<HistorySource['read']>> = []
    try { messages = await source.read(session, options.signal) } catch { /* an unreadable session is skipped, and not retried this run */ }
    const uses = new Map<string, { tool: string; input: Record<string, unknown>; at: number }>()
    const results = new Map<string, { text: string; isError: boolean }>()
    for (const entry of messages) {
      const content = (entry.message as { content?: unknown } | undefined)?.content
      if (!Array.isArray(content)) continue
      const at = entry.timestamp ? Date.parse(entry.timestamp) || session.lastModified : session.lastModified
      for (const block of content as Block[]) {
        if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') uses.set(block.id, { tool: block.name, input: (block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input : {}) as Record<string, unknown>, at })
        else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') results.set(block.tool_use_id, { text: textOf(block.content), isError: block.is_error === true })
      }
    }
    const touched = new Set<string>()
    for (const [id, use] of uses) {
      if (hasNativeToolCard(use.tool)) continue
      ingestCall(corpus, { tool: use.tool, input: use.input, ...(results.has(id) ? { result: results.get(id)! } : {}), at: use.at })
      touched.add(use.tool); calls++
    }
    for (const name of touched) corpus.tools[name]!.sessions++
    corpus.scanned[session.key] = session.lastModified
    const keys = Object.keys(corpus.scanned)
    if (keys.length > CORPUS_LIMITS.scanned) for (const key of keys.slice(0, keys.length - CORPUS_LIMITS.scanned)) delete corpus.scanned[key]
    scanned++
    if (scanned % 5 === 0) { corpus.updatedAt = now(); saveCorpus(corpus) }
  }
  corpus.updatedAt = now(); saveCorpus(corpus)
  return { scanned, remaining: Math.max(0, sessions.length - scanned), calls, tools: Object.keys(corpus.tools).length, stopped }
}

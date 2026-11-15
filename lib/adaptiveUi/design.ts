// "Design here": the in-app route to a card. The shape's redacted samples go to a
// tool-less one-shot question, the reply is validated as a rule, and a refusal is
// fed back for up to MAX_ATTEMPTS tries. The result is always written as a draft:
// nothing a model produces draws until a person enables it.
import { parseCardRule, type CardRule } from '../plugins/cardTemplates'
import { vocabularyMarkdown } from './vocabulary'
import type { ModelAsk } from '../plugins/modelService'
import { ruleIdFor } from './prompt'
import type { ShapeRecord } from './shapes'
import { patchCardRule, writeCardRule } from './store'
import { currentRevision, parseCardPatch } from './patch'

export const DESIGN_MAX_ATTEMPTS = 3
export const DESIGN_DAILY_LIMIT = 20

const SYSTEM = [
  'You design transcript cards for an agent-viewer app. You reply with ONE JSON object and nothing else: no prose, no code fence.',
  'The object is a card rule: { "id", "status": "draft", "match": { "tool" }, "title", "tone", "blocks" }.',
  vocabularyMarkdown(),
  'Show the few fields a person needs at a glance, not the whole payload.',
  'Also include a short "rationale": { "intent": what the person is trying to find out, "choices": [{ "block", "reason" }], "alternatives": [other cards you considered], "assumptions": [what you assumed about the data] }. Keep it true to the rule you wrote: it is shown to the person next to the card.',
].join('\n')

const PATCH_SYSTEM = [
  'You change an existing transcript card by patch. You reply with ONE JSON object and nothing else: { "operations": [ … ] }.',
  'Operations: { "op": "set-title", "title" } · { "op": "set-tone", "tone" } · { "op": "replace-block", "index", "block" } · { "op": "insert-block", "index", "block" } · { "op": "remove-block", "index" } · { "op": "set-rationale", "rationale" }. Block indexes count from 0 in the card you are shown.',
  vocabularyMarkdown(),
  'Make the smallest change that does what was asked. Do not change what the card is for.',
].join('\n')

/** The first JSON object in a reply, tolerating a code fence or surrounding words. */
export function extractRuleJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1] ?? reply
  const start = fenced.indexOf('{')
  if (start < 0) throw new Error('the reply has no JSON object')
  for (let end = fenced.lastIndexOf('}'); end > start; end = fenced.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(fenced.slice(start, end + 1)) } catch { /* try a shorter span */ }
  }
  throw new Error('the reply is not valid JSON')
}

export async function designCardWithModel(shape: ShapeRecord, ask: ModelAsk, options: { dir?: string; signal?: AbortSignal; now?: () => Date; preference?: string | null } = {}): Promise<CardRule> {
  const samples = shape.samples.map((sample, index) => `Sample ${index + 1}\ninput: ${JSON.stringify(sample.input)}${sample.result ? `\nresult${sample.result.isError ? ' (error)' : ''}: ${sample.result.text}` : ''}`).join('\n\n') || '(no samples were kept)'
  const base = `${options.preference ? `${options.preference}\n\n` : ''}Design a card for the tool "${shape.tool}"${shape.mcpServer ? ` (MCP server "${shape.mcpServer}")` : ''}. Input keys: ${shape.inputKeys.join(', ') || 'none'}.\n\n${samples}`
  let feedback = ''
  let last = 'no attempt was made'
  for (let attempt = 0; attempt < DESIGN_MAX_ATTEMPTS; attempt++) {
    options.signal?.throwIfAborted()
    const reply = await ask({ system: SYSTEM, prompt: base + feedback, ...(options.signal ? { signal: options.signal } : {}) })
    try {
      const raw = extractRuleJson(reply) as Record<string, unknown>
      // Whatever the reply says, the rule is this tool's, a draft, and carries its own provenance and samples.
      const candidate = { ...raw, id: typeof raw.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw.id) ? raw.id : ruleIdFor(shape.tool), status: 'draft', match: { tool: shape.tool, ...(shape.mcpServer ? { mcpServer: shape.mcpServer } : {}) }, overridesNative: undefined, samples: shape.samples, provenance: { by: 'model', at: (options.now?.() ?? new Date()).toISOString() } }
      const parsed = parseCardRule(candidate)
      if (!parsed.rule) { last = parsed.problems.join('; '); feedback = `\n\nYour previous reply was refused: ${last}. Reply again with a corrected JSON object.`; continue }
      return writeCardRule(parsed.rule, options.dir, { actor: 'model', action: 'design', summary: `designed ${parsed.rule.id} from ${shape.samples.length} samples` })
    } catch (error) { last = error instanceof Error ? error.message : String(error); feedback = `\n\nYour previous reply could not be used: ${last}. Reply with ONE JSON object only.` }
  }
  throw new Error(`the model did not produce a valid card after ${DESIGN_MAX_ATTEMPTS} tries (${last})`)
}

/**
 * Change a rule from a plain-language instruction: the model answers with a patch, the patch is checked
 * against the revision read at the start (so an edit made meanwhile is a conflict, not an overwrite), and
 * the result is a draft. Up to DESIGN_MAX_ATTEMPTS tries, each told why the last was refused.
 */
export async function refineCardWithModel(rule: CardRule, instruction: string, ask: ModelAsk, options: { dir?: string; signal?: AbortSignal } = {}): Promise<CardRule> {
  const text = instruction.trim()
  if (!text || text.length > 500) throw new Error('say what to change in at most 500 characters')
  const baseRevision = currentRevision(rule)
  const shown = { id: rule.id, status: rule.status, revision: baseRevision, match: rule.match, title: rule.title, tone: rule.tone, blocks: rule.blocks, rationale: rule.rationale }
  const base = `Current card:\n${JSON.stringify(shown, null, 2)}\n\nChange requested: ${text}`
  let feedback = '', last = 'no attempt was made'
  for (let attempt = 0; attempt < DESIGN_MAX_ATTEMPTS; attempt++) {
    options.signal?.throwIfAborted()
    const reply = await ask({ system: PATCH_SYSTEM, prompt: base + feedback, ...(options.signal ? { signal: options.signal } : {}) })
    try {
      const raw = extractRuleJson(reply) as { operations?: unknown }
      const parsed = parseCardPatch({ baseRevision, operations: raw.operations })
      if (!parsed.patch) { last = parsed.problems.join('; '); feedback = `\n\nYour previous reply was refused: ${last}. Reply again.`; continue }
      return patchCardRule(rule.id, parsed.patch, 'model', options.dir)
    } catch (error) {
      if (error instanceof Error && error.name === 'PatchConflictError') throw error
      last = error instanceof Error ? error.message : String(error); feedback = `\n\nYour previous reply could not be used: ${last}. Reply with ONE JSON object only.`
    }
  }
  throw new Error(`the model did not produce a usable change after ${DESIGN_MAX_ATTEMPTS} tries (${last})`)
}

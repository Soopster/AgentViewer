// "Design here": the in-app route to a card. The shape's redacted samples go to a
// tool-less one-shot question, the reply is validated as a rule, and a refusal is
// fed back for up to MAX_ATTEMPTS tries. The result is always written as a draft:
// nothing a model produces draws until a person enables it.
import { CARD_FORMATTERS, CARD_RULE_LIMITS, parseCardRule, type CardRule } from '../plugins/cardTemplates'
import type { ModelAsk } from '../plugins/modelService'
import { ruleIdFor } from './prompt'
import type { ShapeRecord } from './shapes'
import { writeCardRule } from './store'

export const DESIGN_MAX_ATTEMPTS = 3
export const DESIGN_DAILY_LIMIT = 20

const SYSTEM = [
  'You design transcript cards for an agent-viewer app. You reply with ONE JSON object and nothing else: no prose, no code fence.',
  'The object is a card rule: { "id", "status": "draft", "match": { "tool" }, "title", "tone", "blocks" }.',
  'Blocks: heading/text/badge/code {text}; progress {label,value,max}; kv {rows:[[key,value]]}; table {rowsFrom,columns:[{header,path}]}.',
  `Templates use {{bindings}} that start with input., result. (result.text, result.isError, result.json) or tool.name, optionally piped through: ${CARD_FORMATTERS.join(', ')}.`,
  `At most ${CARD_RULE_LIMITS.blocks} blocks and ${CARD_RULE_LIMITS.template} characters per template. No code, no other syntax. Show the few fields a person needs at a glance.`,
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

export async function designCardWithModel(shape: ShapeRecord, ask: ModelAsk, options: { dir?: string; signal?: AbortSignal; now?: () => Date } = {}): Promise<CardRule> {
  const samples = shape.samples.map((sample, index) => `Sample ${index + 1}\ninput: ${JSON.stringify(sample.input)}${sample.result ? `\nresult${sample.result.isError ? ' (error)' : ''}: ${sample.result.text}` : ''}`).join('\n\n') || '(no samples were kept)'
  const base = `Design a card for the tool "${shape.tool}"${shape.mcpServer ? ` (MCP server "${shape.mcpServer}")` : ''}. Input keys: ${shape.inputKeys.join(', ') || 'none'}.\n\n${samples}`
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
      return writeCardRule(parsed.rule, options.dir)
    } catch (error) { last = error instanceof Error ? error.message : String(error); feedback = `\n\nYour previous reply could not be used: ${last}. Reply with ONE JSON object only.` }
  }
  throw new Error(`the model did not produce a valid card after ${DESIGN_MAX_ATTEMPTS} tries (${last})`)
}

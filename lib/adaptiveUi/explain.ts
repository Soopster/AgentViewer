// "Why does this card look like this, and what is it built from?" Two kinds of answer, kept apart:
// what the host can DERIVE from the rule (which fields it reads, what each block shows, when it applies,
// what it can never do), and what the designer DECLARED (intent, reasons, alternatives, assumptions).
// The derived part is true by construction; the declared part is labelled as a claim.
import { ruleBindingPaths, type CardRule } from '../plugins/cardTemplates'

export type RuleExplanation = {
  readonly id: string
  readonly status: CardRule['status']
  readonly revision: number
  /** Derived from the rule. */
  readonly derived: {
    readonly appliesTo: string
    readonly reads: readonly string[]
    readonly blocks: readonly { readonly type: string; readonly shows: readonly string[] }[]
    readonly tone: string
    readonly cannot: readonly string[]
    readonly replacesBuiltIn: boolean
  }
  /** Written by whoever designed the rule: a claim, not a fact. */
  readonly declared: { readonly by?: string; readonly intent?: string; readonly choices: readonly { block: string; reason: string }[]; readonly alternatives: readonly string[]; readonly assumptions: readonly string[] }
}

const BINDING = /\{\{\s*([^{}|]*?)\s*(?:\|[^{}]*)?\}\}/g
const bindingsIn = (value: unknown): string[] => typeof value === 'string' ? [...value.matchAll(BINDING)].map(match => match[1]!.trim()) : []

export function explainRule(rule: CardRule): RuleExplanation {
  const blocks = (rule.blocks as readonly Record<string, unknown>[]).map(block => ({
    type: String(block.type),
    shows: [...new Set([...bindingsIn(block.text), ...bindingsIn(block.label), ...bindingsIn(block.value), ...(Array.isArray(block.rows) ? block.rows.flatMap(row => Array.isArray(row) ? [...bindingsIn(row[1])] : []) : []), ...(typeof block.rowsFrom === 'string' ? [block.rowsFrom] : []), ...(Array.isArray(block.columns) ? block.columns.flatMap(column => bindingsIn((column as { header?: unknown }).header)) : [])])],
  }))
  const tone = typeof rule.tone === 'string' ? `always ${rule.tone}` : Array.isArray(rule.tone) ? `${rule.tone.map(entry => `${entry.tone} when ${entry.when.path}`).join('; ')}, otherwise info` : 'info'
  return {
    id: rule.id, status: rule.status, revision: rule.revision ?? 1,
    derived: {
      appliesTo: `${rule.match.kind === 'system' ? 'system messages of subtype ' : ''}${rule.match.tool}${rule.match.mcpServer ? ` on MCP server ${rule.match.mcpServer}` : ''}${rule.match.keys?.length ? ` when the call has ${rule.match.keys.join(', ')}` : ''}`,
      reads: ruleBindingPaths(rule),
      blocks, tone: `${tone}; error whenever the call failed`,
      cannot: ['run anything or call a tool', 'add a button or any control', 'change state', 'hide that a call failed', rule.overridesNative ? 'be replaced by the built-in card (it replaces it)' : 'replace a built-in card'].filter(item => !item.endsWith('(it replaces it)')),
      replacesBuiltIn: rule.overridesNative === true,
    },
    declared: { ...(rule.provenance?.by ? { by: rule.provenance.by } : {}), ...(rule.rationale?.intent ? { intent: rule.rationale.intent } : {}), choices: rule.rationale?.choices ?? [], alternatives: rule.rationale?.alternatives ?? [], assumptions: rule.rationale?.assumptions ?? [] },
  }
}

export function explanationLines(explanation: RuleExplanation): string[] {
  const d = explanation.derived, c = explanation.declared
  return [
    `${explanation.id} · ${explanation.status} · revision ${explanation.revision}`,
    'Derived from the rule:',
    `  applies to  ${d.appliesTo}`,
    `  reads       ${d.reads.join(', ') || '(nothing: the card is static)'}`,
    ...d.blocks.map(block => `  ${block.type.padEnd(11)} ${block.shows.join(', ') || '—'}`),
    `  tone        ${d.tone}`,
    `  cannot      ${d.cannot.join('; ')}`,
    ...(d.replacesBuiltIn ? ['  it REPLACES the built-in card for this tool'] : []),
    `Declared by ${c.by ?? 'its designer'} (a claim, not checked):`,
    ...(c.intent ? [`  intent       ${c.intent}`] : ['  (no intent was written)']),
    ...c.choices.map(choice => `  ${choice.block.padEnd(11)} ${choice.reason}`),
    ...c.alternatives.map(alternative => `  alternative  ${alternative}`),
    ...c.assumptions.map(assumption => `  assumed      ${assumption}`),
  ]
}

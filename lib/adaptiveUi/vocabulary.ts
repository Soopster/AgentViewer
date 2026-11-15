// The card vocabulary, described once. A card rule is built from these blocks, bindings and formatters;
// this table is what the design request, `agent-viewer cards schema` and the docs are generated from, and
// scripts/adaptiveVocabularySmoke.ts checks it against the validator in both directions, so the words an
// agent is taught and the rules the host enforces cannot drift apart. Each entry says what a thing is for
// (`useWhen`), not only what it accepts, so a designer can choose between them.
import { CARD_FORMATTERS, CARD_RULE_LIMITS } from '../plugins/cardTemplates'

export type VocabularyBlock = {
  readonly type: string
  readonly purpose: string
  readonly useWhen: readonly string[]
  /** Field to what it takes. A value in {{braces}} is a template. */
  readonly fields: Readonly<Record<string, string>>
  /** A valid instance, used by the smoke and shown to designers. */
  readonly example: Readonly<Record<string, unknown>>
}

export const CARD_VOCABULARY = Object.freeze({
  blocks: [
    { type: 'heading', purpose: 'A short label that titles a group of lines.', useWhen: ['The card has two or more distinct parts'], fields: { text: 'template' }, example: { type: 'heading', text: 'Details' } },
    { type: 'text', purpose: 'A plain line or paragraph.', useWhen: ['One sentence says it', 'A result is prose'], fields: { text: 'template', tone: 'default | muted | success | warning | error (optional)' }, example: { type: 'text', text: '{{result.text | truncate 120}}' } },
    { type: 'badge', purpose: 'A single short status word.', useWhen: ['A state, level or category decides how the call went'], fields: { text: 'template', tone: 'default | muted | success | warning | error (optional)' }, example: { type: 'badge', text: '{{result.json.state}}' } },
    { type: 'kv', purpose: 'Labelled facts, one per row.', useWhen: ['A record has a few named fields', 'You would otherwise write "key: value" lines'], fields: { rows: '[[key template, value template], …]' }, example: { type: 'kv', rows: [['Assignee', '{{result.json.assignee.name | default none}}']] } },
    { type: 'table', purpose: 'Rows of a list, one column per field.', useWhen: ['The result is a list of similar records', 'The person will compare rows'], fields: { rowsFrom: 'binding to an array', columns: '[{ header: template, path: dotted path inside a row }, …]' }, example: { type: 'table', rowsFrom: 'result.json.items', columns: [{ header: 'Name', path: 'name' }] } },
    { type: 'progress', purpose: 'How far along something is.', useWhen: ['The result carries a done/total pair or a percentage'], fields: { label: 'template', value: 'template giving a number', max: 'template giving a number' }, example: { type: 'progress', label: 'Done', value: '{{result.json.done}}', max: '{{result.json.total}}' } },
    { type: 'code', purpose: 'Verbatim text in a box.', useWhen: ['The exact output matters (a command, a diff, a log)', 'Whitespace is meaningful'], fields: { text: 'template' }, example: { type: 'code', text: '{{result.text | truncate 400}}' } },
  ],
  /** The rule itself: what a card's own fields take. (Blocks have their own tone values; these are the card's.) */
  rule: {
    fields: {
      id: 'lowercase letters, digits, ".", "_" or "-"',
      status: 'always "draft" when you write it',
      match: '{ "tool": the tool name, with * as the only wildcard } — or { "kind": "system", "tool": a system message subtype }',
      title: 'template: what was asked and what came back, in one line',
      tone: '"info", "success", "warning" or "error"; or a list of { "when": { "path", "equals" | "contains" | "exists" }, "tone": … } (first that holds wins). Not "default": that is a block tone.',
      blocks: 'a list of the blocks above',
      rationale: '{ intent, choices: [{ block, reason }], alternatives: [], assumptions: [] } (optional, short, true to the rule)',
    },
    toneValues: ['info', 'success', 'warning', 'error'],
    templateNotes: ['A formatter argument is literal text, never a binding: write {{input.id | default none}}, not {{… | default {{input.id}}}}.', 'Bindings cannot be nested or combined with expressions.'],
  },
  bindings: [
    { root: 'input', meaning: 'The arguments the tool was called with (for a rule with match.kind "system": the fields of the system message)', example: 'input.path' },
    { root: 'result', meaning: 'What came back: text, isError, and json when the result parses as JSON (empty while the call runs)', example: 'result.json.items.0.name' },
    { root: 'tool', meaning: 'tool.name is the tool called', example: 'tool.name' },
  ],
  formatters: [
    { name: 'basename', meaning: 'The last path segment', example: '{{input.path | basename}}' },
    { name: 'dirname', meaning: 'A path without its last segment', example: '{{input.path | dirname}}' },
    { name: 'truncate', meaning: 'At most N characters (default 80)', example: '{{result.text | truncate 120}}' },
    { name: 'join', meaning: 'An array as one string (default ", ")', example: '{{input.tags | join " · "}}' },
    { name: 'upper', meaning: 'Upper case', example: '{{result.json.state | upper}}' },
    { name: 'lower', meaning: 'Lower case', example: '{{result.json.state | lower}}' },
    { name: 'count', meaning: 'Length of an array or string, or keys of an object', example: '{{result.json.items | count}}' },
    { name: 'default', meaning: 'A fallback when the value is empty', example: '{{result.json.owner | default nobody}}' },
  ],
  limits: { blocks: CARD_RULE_LIMITS.blocks, template: CARD_RULE_LIMITS.template },
  /** What a rule can match: a tool call (the default), or a system message by subtype with `match.kind: "system"`, which replaces that message's generic card. */
  matches: ['tool', 'system'],
  /** What a rule may do: present. It cannot run anything, call a tool, change state or add a button. */
  authority: 'presentation only',
} as const)

export function vocabularyMarkdown(): string {
  const V = CARD_VOCABULARY
  return [
    '## Blocks',
    ...V.blocks.map(block => `- **${block.type}**: ${block.purpose} Use when: ${block.useWhen.join('; ')}. Fields: ${Object.entries(block.fields).map(([name, what]) => `${name} (${what})`).join(', ')}.`),
    '## The rule',
    ...Object.entries(V.rule.fields).map(([name, what]) => `- **${name}**: ${what}`),
    ...V.rule.templateNotes.map(note => `- ${note}`),
    '## Bindings',
    ...V.bindings.map(binding => `- \`${binding.root}\`: ${binding.meaning}. e.g. \`{{${binding.example}}}\``),
    '## Formatters',
    ...V.formatters.map(formatter => `- \`${formatter.name}\`: ${formatter.meaning}. e.g. \`${formatter.example}\``),
    `Limits: at most ${V.limits.blocks} blocks, ${V.limits.template} characters per template. Authority: ${V.authority}.`,
  ].join('\n')
}

/** The formatter names the vocabulary lists, for comparing with the engine's own list. */
export const VOCABULARY_FORMATTERS: readonly string[] = CARD_VOCABULARY.formatters.map(formatter => formatter.name)
void CARD_FORMATTERS

// The vocabulary an agent is taught is the vocabulary the validator enforces, in both directions.
import assert from 'node:assert/strict'
import { CARD_VOCABULARY, VOCABULARY_FORMATTERS, vocabularyMarkdown } from '../lib/adaptiveUi/vocabulary'
import { CARD_FORMATTERS, parseCardRule, renderCardRule } from '../lib/plugins/cardTemplates'
import { decodeCardBlocks } from '../lib/plugins/cardBlocks'

const rule = (blocks: unknown[]) => parseCardRule({ id: 'v', status: 'draft', match: { tool: 'mcp__a__b' }, title: 't', blocks })
// Every block the vocabulary teaches validates, renders and survives decoding.
for (const block of CARD_VOCABULARY.blocks) {
  const parsed = rule([block.example]); assert.deepEqual(parsed.problems, [], `${block.type} example is a valid rule block`)
  const card = renderCardRule(parsed.rule!, { tool: { name: 'mcp__a__b', input: { path: '/x/y.ts', tags: ['a', 'b'] } }, result: { text: JSON.stringify({ state: 'Done', items: [{ name: 'n' }], done: 1, total: 2, assignee: { name: 'Ada' } }), isError: false } })
  assert.equal(card.blocks.length, 1, `${block.type} renders to a block`); assert.equal(card.blocks[0]!.type, block.type)
  assert.ok(Object.keys(block.fields).length > 0 && block.useWhen.length > 0 && block.purpose, `${block.type} says what it is for`)
}
// And nothing the validator accepts is missing from the teaching: a block type the engine renders must be listed.
const taught = new Set<string>(CARD_VOCABULARY.blocks.map(block => block.type))
const probe = ['heading', 'text', 'badge', 'kv', 'table', 'progress', 'code', 'chart', 'button', 'input', 'image'].filter(type => rule([{ type, text: 'x', label: 'l', value: '1', max: '2', rows: [['a', 'b']], rowsFrom: 'input.x', columns: [{ header: 'h', path: 'p' }] }]).rule)
assert.deepEqual(new Set(probe), taught, 'the validator accepts exactly the block types the vocabulary teaches')
// Formatters: the same set, so a designer is never offered one the engine refuses or denied one it has.
assert.deepEqual([...VOCABULARY_FORMATTERS].sort(), [...CARD_FORMATTERS].sort())
for (const formatter of CARD_VOCABULARY.formatters) assert.deepEqual(parseCardRule({ id: 'f', status: 'draft', match: { tool: 'x' }, title: formatter.example, blocks: [] }).problems, [], `${formatter.name} example is valid`)
// Binding roots are exactly the ones the engine accepts.
for (const root of ['input', 'result', 'tool']) assert.ok(CARD_VOCABULARY.bindings.some(binding => binding.root === root))
assert.ok(parseCardRule({ id: 'f', status: 'draft', match: { tool: 'x' }, title: '{{env.HOME}}', blocks: [] }).problems.length)
// The rule's own tone values are the ones the parser accepts, and the one a model confuses with a block tone is refused.
const withTone = (tone: unknown) => parseCardRule({ id: 'r', status: 'draft', match: { tool: 'x' }, title: 't', blocks: [], tone }).rule
for (const tone of CARD_VOCABULARY.rule.toneValues) assert.ok(withTone(tone), `rule tone ${tone}`)
assert.equal(withTone('default'), null); assert.equal(withTone('muted'), null)
for (const field of Object.keys(CARD_VOCABULARY.rule.fields)) assert.ok(vocabularyMarkdown().includes(`**${field}**`), `the rule field ${field} is taught`)
assert.ok(parseCardRule({ id: 'r', status: 'draft', match: { tool: 'x' }, title: '{{input.id | default {{input.x}}}}', blocks: [] }).problems.length, 'nested bindings are refused, and the vocabulary says so')
assert.equal(CARD_VOCABULARY.authority, 'presentation only')
assert.equal(decodeCardBlocks([{ type: 'button', text: 'x' }]).length, 0, 'there is no block that can act')
const md = vocabularyMarkdown()
for (const block of CARD_VOCABULARY.blocks) assert.ok(md.includes(`**${block.type}**`)); for (const name of CARD_FORMATTERS) assert.ok(md.includes(`\`${name}\``))
console.log('adaptiveVocabularySmoke: ok')

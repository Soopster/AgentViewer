// Card blocks and declarative card rules: the guards a generated renderer relies on.
import assert from 'node:assert/strict'
import { cardBlockLines, decodeCardBlocks, scrubCardText, CARD_BLOCK_LIMITS } from '../lib/plugins/cardBlocks'
import { cardRuleMatches, cardRuleSpecificity, mcpServerOf, parseCardRule, renderCardRule } from '../lib/plugins/cardTemplates'

const ESC = String.fromCharCode(27)
const base = { id: 'linear-issue', status: 'active', match: { tool: 'mcp__linear__get_issue' }, title: '{{input.id}} · {{result.json.title}}',
  tone: [{ when: { path: 'result.json.state', equals: 'Done' }, tone: 'success' }],
  blocks: [{ type: 'badge', text: '{{result.json.state}}' }, { type: 'kv', rows: [['Assignee', '{{result.json.assignee.name | default none}}'], ['Path', '{{input.file | basename}}']] },
    { type: 'table', rowsFrom: 'result.json.labels', columns: [{ header: 'Label', path: 'name' }] }] }
const parse = (value: unknown) => parseCardRule(value)
const ok = parse(base)
assert.deepEqual(ok.problems, []); assert.ok(ok.rule)

// Rendering: bindings, formatters, tone rules, tables from result JSON.
const json = JSON.stringify({ title: 'Fix login', state: 'Done', assignee: null, labels: [{ name: 'bug' }, { name: 'auth' }] })
const card = renderCardRule(ok.rule!, { tool: { name: 'mcp__linear__get_issue', input: { id: 'ENG-1', file: '/a/b/c.ts' } }, result: { text: json, isError: false } })
assert.equal(card.title, 'ENG-1 · Fix login'); assert.equal(card.tone, 'success')
assert.deepEqual(cardBlockLines(card.blocks), ['[Done]', 'Assignee  none', 'Path      c.ts', 'Label', 'bug', 'auth'])
// While running there is no result: bindings are empty, never the word "undefined".
const running = renderCardRule(ok.rule!, { tool: { name: 'mcp__linear__get_issue', input: { id: 'ENG-1' } } })
assert.ok(!JSON.stringify(running).includes('undefined')); assert.equal(running.tone, 'info')
// A failed call is an error whatever the rule says.
assert.equal(renderCardRule({ ...ok.rule!, tone: 'success' }, { tool: { name: 'mcp__linear__get_issue', input: {} }, result: { text: 'boom', isError: true } }).tone, 'error')

// Refusals: each one a way a generated rule could escape its sandbox or mislead.
const refused = (patch: Record<string, unknown>, needle: string) => { const r = parse({ ...base, ...patch }); assert.equal(r.rule, null, needle); assert.ok(r.problems.join('\n').includes(needle), `${needle} in ${r.problems.join(' | ')}`) }
refused({ title: '{{input.x | eval}}' }, 'unknown formatter')
refused({ title: '{{input.__proto__.x}}' }, 'not allowed')
refused({ title: '{{process.env.HOME}}' }, 'must start with')
refused({ title: '{{input.a' }, 'unmatched brace')
refused({ match: { tool: '*' } }, 'match.tool')
refused({ match: { tool: 'x', keys: ['a b'] } }, 'match.keys')
refused({ status: 'live' }, 'status')
refused({ id: 'Bad Id' }, 'id must')
refused({ blocks: [{ type: 'script', text: 'x' }] }, 'unknown type')
refused({ blocks: Array.from({ length: 31 }, () => ({ type: 'text', text: 'x' })) }, 'more than')
refused({ title: 'x'.repeat(601) }, 'longer than')
refused({ blocks: [{ type: 'table', rowsFrom: 'input.rows', columns: [{ header: 'h', path: '../x' }] }] }, 'plain path')

// Matching and precedence.
const rule = (tool: string, extra: Record<string, unknown> = {}) => parse({ ...base, match: { tool, ...extra } }).rule!
assert.ok(cardRuleMatches(rule('mcp__linear__*'), { tool: { name: 'mcp__linear__get_issue', input: {} } }))
assert.ok(!cardRuleMatches(rule('mcp__linear__*'), { tool: { name: 'mcp__github__get_issue', input: {} } }))
assert.ok(!cardRuleMatches(rule('x', { keys: ['id'] }), { tool: { name: 'x', input: {} } }))
assert.ok(cardRuleMatches(rule('mcp__*', { mcpServer: 'linear' }), { tool: { name: 'mcp__linear__a', input: {} } }))
assert.equal(mcpServerOf('mcp__linear__get_issue'), 'linear'); assert.equal(mcpServerOf('Bash'), null)
assert.ok(cardRuleSpecificity(rule('mcp__linear__get_issue')) > cardRuleSpecificity(rule('mcp__linear__*')))
assert.ok(cardRuleSpecificity(rule('mcp__linear__*', { keys: ['id'] })) > cardRuleSpecificity(rule('mcp__linear__*')))

// Output is scrubbed and capped whatever a result contains.
const hostile = renderCardRule(parse({ ...base, blocks: [{ type: 'text', text: '{{result.text}}' }] }).rule!, { tool: { name: 'mcp__linear__get_issue', input: {} }, result: { text: `a${ESC}]0;pwned\u0007b‮c${'z'.repeat(5000)}`, isError: false } })
const text = (hostile.blocks[0] as { text: string }).text
const BIDI = String.fromCharCode(0x202e)
assert.ok(!text.includes(ESC)); assert.ok(!text.includes(BIDI)); assert.ok(!text.includes('pwned')); assert.ok(text.length <= CARD_BLOCK_LIMITS.text)
assert.equal(scrubCardText(`x${ESC}[31my`, 10), 'xy')
// Prototype pollution through a binding finds nothing.
assert.equal(renderCardRule(parse({ ...base, title: '{{input.toString}}' }).rule!, { tool: { name: 'mcp__linear__get_issue', input: {} } }).title, '')
// decodeCardBlocks drops malformed entries instead of repairing them.
assert.deepEqual(decodeCardBlocks([{ type: 'table', columns: [1], rows: [] }, { type: 'progress', label: 'p', value: 1, max: 0 }, { type: 'nope' }, null]), [])
assert.equal(decodeCardBlocks(Array.from({ length: 200 }, () => ({ type: 'text', text: 'x' }))).length, CARD_BLOCK_LIMITS.blocks)
console.log('cardTemplatesSmoke: ok')

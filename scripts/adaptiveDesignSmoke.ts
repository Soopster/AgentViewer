// "Design here": a model's reply becomes a draft rule only after it validates, refusals are fed back,
// the model cannot activate a rule or point it at another tool, and spending is bounded.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-design-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes')
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
const { designCardWithModel, extractRuleJson, DESIGN_DAILY_LIMIT, DESIGN_MAX_ATTEMPTS } = await import('../lib/adaptiveUi/design')
const { designHere, recordShape } = await import('../lib/adaptiveUi/runtime')
const { loadCardRules } = await import('../lib/adaptiveUi/store')
type Ask = import('../lib/plugins/modelService').ModelAsk

const shape = { key: 'mcp__linear__get_issue|id', tool: 'mcp__linear__get_issue', mcpServer: 'linear', inputKeys: ['id'], count: 3, firstSeen: 1, lastSeen: 2, samples: [{ input: { id: 'ENG-1' }, result: { text: '{"title":"Fix login","state":"Done"}', isError: false } }] }
const good = { id: 'linear.get_issue', status: 'active', overridesNative: true, match: { tool: 'Bash' }, title: '{{input.id}} · {{result.json.title}}', blocks: [{ type: 'badge', text: '{{result.json.state}}' }] }

// JSON extraction tolerates fences and chatter, and refuses prose.
assert.deepEqual(extractRuleJson('Sure!\n```json\n{"a":1}\n```\nEnjoy'), { a: 1 })
assert.deepEqual(extractRuleJson('here: {"a":{"b":2}} done'), { a: { b: 2 } })
assert.throws(() => extractRuleJson('no json here'), /no JSON/)

// Refusals are fed back; the third reply is valid. Whatever it claims, the rule is a draft for THIS tool.
const prompts: string[] = []
const replies = ['I think a table would be nice', JSON.stringify({ ...good, title: '{{input.x | eval}}' }), '```json\n' + JSON.stringify(good) + '\n```']
const ask: Ask = async ({ prompt }) => { prompts.push(prompt); return replies[prompts.length - 1]! }
const rule = await designCardWithModel(shape, ask, { dir: join(root, 'recipes'), now: () => new Date('2026-01-02T03:04:05Z') })
assert.equal(prompts.length, 3)
assert.ok(prompts[1]!.includes('could not be used') && prompts[2]!.includes('unknown formatter'), 'the reason for each refusal is sent back')
assert.equal(rule.status, 'draft'); assert.equal(rule.match.tool, 'mcp__linear__get_issue'); assert.equal(rule.match.mcpServer, 'linear')
assert.equal(rule.overridesNative, undefined, 'a model cannot ask to replace a built-in card')
assert.deepEqual(rule.provenance, { by: 'model', at: '2026-01-02T03:04:05.000Z' }); assert.equal(rule.samples!.length, 1)
assert.equal(JSON.parse(readFileSync(join(root, 'recipes', 'linear.get_issue.json'), 'utf8')).status, 'draft')
assert.ok(prompts[0]!.includes('ENG-1') && prompts[0]!.includes('Fix login'))

// Giving up is bounded and writes nothing.
let calls = 0
await assert.rejects(designCardWithModel({ ...shape, tool: 'mcp__x__y', key: 'k' }, async () => { calls++; return 'nope' }, { dir: join(root, 'recipes') }), /did not produce a valid card/)
assert.equal(calls, DESIGN_MAX_ATTEMPTS); assert.equal(existsSync(join(root, 'recipes', 'x.y.json')), false)
// A failing model call surfaces its error.
await assert.rejects(designCardWithModel(shape, async () => { throw new Error('quota') }, { dir: join(root, 'recipes') }), /quota/)

// Through the runtime: needs samples, and is limited per day.
recordShape({ tool: 'mcp__notion__search', mcpServer: 'notion', inputKeys: ['q'] })
await assert.rejects(designHere('mcp__notion__search|q', async () => ''), /no samples/)
recordShape({ tool: 'mcp__notion__search', mcpServer: 'notion', inputKeys: ['q'], sample: { input: { q: 'roadmap' }, result: { text: '[]', isError: false } } })
const notion = JSON.stringify({ id: 'notion.search', status: 'draft', match: { tool: 'mcp__notion__search' }, title: 'search {{input.q}}', blocks: [] })
let made = 0
for (; made < DESIGN_DAILY_LIMIT; made++) assert.equal(await designHere('mcp__notion__search|q', async () => notion), 'notion.search')
await assert.rejects(designHere('mcp__notion__search|q', async () => notion), /limit/)
assert.ok(loadCardRules(join(root, 'recipes')).rules.some(entry => entry.id === 'notion.search'))
console.log('adaptiveDesignSmoke: ok')
process.exit(0)

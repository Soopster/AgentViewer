// Learning from past sessions end to end: the scan seeds the gallery, a design is told what real results looked like and
// is refused when it reads a field no past result had, and a card is checked against history.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-learn-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes'); process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state'); process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(root, 'plugins.json')
process.chdir(root)
const { learnFromHistory, adaptiveUiSnapshot, designHere } = await import('../lib/adaptiveUi/runtime')
const { writeCardRule } = await import('../lib/adaptiveUi/store')
const { loadCorpus } = await import('../lib/adaptiveUi/corpus')

const TOOL = 'mcp__linear__get_issue'
const wire = (n: number) => [
  { timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id: `u${n}`, name: TOOL, input: { id: `E${n}` } }, { type: 'tool_use', id: `b${n}`, name: 'Bash', input: { command: 'ls' } }] } },
  { timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: `u${n}`, content: JSON.stringify({ task: { status: n % 5 === 0 ? 'failed' : 'completed', title: `T${n}` }, ...(n === 1 ? { diff: 'once' } : {}) }) }, { type: 'tool_result', tool_use_id: `b${n}`, content: 'a' }] } },
]
let listed = 0
const source = { list: async () => { listed++; return Array.from({ length: 12 }, (_, i) => ({ key: `claude:s${i}`, lastModified: 100 + i })) }, read: async (session: { key: string }) => wire(Number(session.key.split('s').at(-1))) }

// One scan at a time, however many ask.
const [a, b] = await Promise.all([learnFromHistory(source, { maxSessions: 5 }), learnFromHistory(source, { maxSessions: 5 })])
assert.equal(a, b, 'two callers share one scan'); assert.equal(listed, 1)
assert.ok(a.startsWith('Read 5 past sessions (5 in all, 7 still to read)') && a.includes('Run it again'), a)
// The gallery learns about a tool it never saw live, with what history says about it.
let snap = adaptiveUiSnapshot()
const shape = snap.shapes.find(entry => entry.tool === TOOL)!
assert.ok(shape && shape.count === 5 && shape.samples.length > 0 && !snap.shapes.some(entry => entry.tool === 'Bash'), 'a tool from history appears; a built-in does not')
assert.ok(snap.knowledge.tools[TOOL]!.startsWith('5 past calls in 5 sessions'), snap.knowledge.tools[TOOL])
await learnFromHistory(source, { maxSessions: 50 }); snap = adaptiveUiSnapshot()
assert.equal(snap.shapes.find(entry => entry.tool === TOOL)!.count, 12); assert.equal(snap.knowledge.scanned, 12); assert.equal(loadCorpus().tools[TOOL]!.calls, 12, 'persisted')

// A design is told the profile, and is checked against history.
const prompts: string[] = []
const good = (title: string) => JSON.stringify({ id: 'linear.get_issue', status: 'draft', match: { tool: TOOL }, title, blocks: [{ type: 'badge', text: '{{result.json.task.status}}' }] })
const replies = [good('{{input.id}} {{result.json.task.owner}}'), good('{{input.id}} · {{result.json.task.title}}')]
const ruleId = await designHere(shape.key, async ({ prompt }) => { prompts.push(prompt); return replies[prompts.length - 1]! })
assert.equal(prompts.length, 2, 'the first reply read a field no past result had')
assert.ok(prompts[0]!.includes('Past use of this tool') && prompts[0]!.includes('result.json.task.status') && prompts[0]!.includes('one of: completed'), 'the model is told what real results look like')
assert.ok(prompts[1]!.includes('result.json.task.owner was never present in 12 past JSON results'), 'and why a reply was refused')
assert.equal(ruleId, 'linear.get_issue')

// A card the person wrote is checked against history too.
writeCardRule({ id: 'mine', status: 'draft', match: { tool: TOOL }, title: '{{input.id}}', blocks: [{ type: 'text', text: '{{result.json.diff}} {{result.json.ghost}}' }] })
snap = adaptiveUiSnapshot()
assert.deepEqual(snap.knowledge.ruleWarnings.mine, ['result.json.ghost was never present in 12 past JSON results', 'result.json.diff is present in only 8% of 12 past JSON results'].sort((x, y) => (x.includes('never') ? -1 : 1)))
assert.equal(snap.knowledge.ruleWarnings['linear.get_issue'], undefined, 'a rule that reads what history has is not flagged')
// A tool with history but no live sample can still be designed from history.
const historyOnly = 'mcp__only__hist'
await learnFromHistory({ list: async () => [{ key: 'claude:h1', lastModified: 999 }, { key: 'claude:h2', lastModified: 998 }], read: async () => [{ message: { content: [{ type: 'tool_use', id: 'x', name: historyOnly, input: { q: 'a' } }, { type: 'tool_result', tool_use_id: 'x', content: '{"hits":[{"t":"a"}]}' }] } }] }, { maxSessions: 5 })
const onlyShape = adaptiveUiSnapshot().shapes.find(entry => entry.tool === historyOnly)!
assert.ok(onlyShape.samples.length > 0, 'history supplied the samples')
console.log('adaptiveLearnSmoke: ok')
process.exit(0)

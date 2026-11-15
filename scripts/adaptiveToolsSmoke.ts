// What an agent can do with cards through the tools: look, propose, patch and preview, with every guard still on.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-tools-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes'); process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state'); process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(root, 'plugins.json'); process.env.AGENT_VIEWER_PLUGINS_DIR = join(root, 'plugins'); process.env.AGENT_VIEWER_MODS_WATCH = '0'
process.chdir(root)
const { pluginBehaviorHost } = await import('../lib/plugins/serverBehaviors')
const { recordShape, learnFromHistory } = await import('../lib/adaptiveUi/runtime')
const { loadCardRules } = await import('../lib/adaptiveUi/store')
const { readCardHistory } = await import('../lib/adaptiveUi/history')
const host = pluginBehaviorHost()
const call = (tool: string, args: Record<string, unknown> = {}) => host.callTool(`adaptive_ui_${tool}`, args)

const TOOL = 'mcp__linear__get_issue'
const wire = (n: number) => [
  { timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id: `u${n}`, name: TOOL, input: { id: `E${n}` } }] } },
  { timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: `u${n}`, content: JSON.stringify({ task: { status: n % 4 ? 'completed' : 'failed', title: `T${n}` } }) }] } },
]
await learnFromHistory({ list: async () => Array.from({ length: 10 }, (_, i) => ({ key: `claude:s${i}`, lastModified: i })), read: async s => wire(Number(s.key.split('s').at(-1))) }, { maxSessions: 20 })

// Reading.
assert.equal((await call('list_shapes')).isError, false); assert.ok((await call('list_shapes')).text.includes(`${TOOL}  10 calls`) && (await call('list_shapes')).text.includes('history: 10 past calls'))
assert.ok((await call('profile', { tool: TOOL })).text.includes('result.json.task.status  100%  string one of: completed (70%), failed (30%)'))
assert.match((await call('profile', { tool: 'mcp__never__seen' })).text, /nothing is known/); assert.equal((await call('profile', { tool: 'mcp__never__seen' })).isError, true)
assert.ok((await call('schema')).text.includes('**badge**') && (await call('schema')).text.includes('presentation only'))

// Proposing: refused with reasons (grammar, then history); accepted only as a draft, whatever the agent claims.
const rule = (patch: Record<string, unknown> = {}) => JSON.stringify({ id: 'linear.get_issue', status: 'active', overridesNative: true, match: { tool: TOOL }, title: '{{input.id}} · {{result.json.task.title}}', blocks: [{ type: 'badge', text: '{{result.json.task.status}}' }], ...patch })
let r = await call('propose_rule', { rule_json: '{ not json' }); assert.equal(r.isError, true); assert.match(r.text, /not valid JSON/)
r = await call('propose_rule', { rule_json: rule({ title: '{{input.x | eval}}' }) }); assert.equal(r.isError, true); assert.match(r.text, /refused: .*unknown formatter/)
r = await call('propose_rule', { rule_json: rule({ title: '{{result.json.task.owner}}' }) }); assert.equal(r.isError, true); assert.match(r.text, /refused against past calls: result\.json\.task\.owner was never present in 10 past JSON results/)
assert.equal(loadCardRules().rules.length, 0, 'nothing was saved by a refused proposal')
r = await call('propose_rule', { rule_json: rule() }); assert.equal(r.isError, false, r.text); assert.match(r.text, /Saved linear\.get_issue as a draft \(revision 1\)/)
const saved = loadCardRules().rules[0]!
assert.equal(saved.status, 'draft', 'an agent cannot enable a card'); assert.equal(saved.overridesNative, undefined, 'nor replace a built-in one'); assert.equal(saved.provenance?.by, 'agent')
assert.deepEqual(readCardHistory(loadCardRules().dir).map(entry => entry.actor), ['agent'])
assert.equal((await call('propose_rule', { rule_json: rule({ id: 'x'.repeat(20_001) }) })).isError, true, 'oversized input is refused by the declaration')

// Patching and previewing.
assert.ok((await call('show_rule', { id: 'linear.get_issue' })).text.includes('"revision": 1'))
r = await call('patch_rule', { id: 'linear.get_issue', patch_json: JSON.stringify({ baseRevision: 1, operations: [{ op: 'set-title', title: '{{input.id}}' }] }) }); assert.equal(r.isError, false, r.text); assert.match(r.text, /revision 2 and a draft/)
r = await call('patch_rule', { id: 'linear.get_issue', patch_json: JSON.stringify({ baseRevision: 1, operations: [{ op: 'set-title', title: 'late' }] }) }); assert.equal(r.isError, true); assert.match(r.text, /read it again/)
assert.equal((await call('patch_rule', { id: 'linear.get_issue', patch_json: '{"baseRevision":2,"operations":[{"op":"set-match","tool":"*"}]}' })).isError, true, 'a patch cannot retarget a card')
assert.equal((await call('show_rule', { id: 'nope' })).isError, true)
assert.ok((await call('preview_rule', { id: 'linear.get_issue' })).text.includes('Derived from the rule') || (await call('preview_rule', { id: 'linear.get_issue' })).text.length > 0)
// Writing tools are declared as writing, reading tools as reading: the agent's host asks the person accordingly.
const scopes = Object.fromEntries(host.listTools().filter(tool => tool.pluginId === 'adaptive-ui').map(tool => [tool.spec.name, tool.spec.scope]))
assert.deepEqual(scopes, { list_shapes: 'read', profile: 'read', schema: 'read', show_rule: 'read', propose_rule: 'write', patch_rule: 'write', preview_rule: 'read' })
console.log('adaptiveToolsSmoke: ok')
process.exit(0)

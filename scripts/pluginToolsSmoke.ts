// Plugin tools for agents: declared, validated, bounded, namespaced, owned by an enabled plugin, and honest about failure.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'plugin-tools-'))
process.env.AGENT_VIEWER_PLUGINS_DIR = join(root, 'plugins'); process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(root, 'plugins.json'); process.env.AGENT_VIEWER_MODS_WATCH = '0'
const { validatePluginToolSpecs, validatePluginToolArgs, boundPluginToolResult, pluginToolFullName, PLUGIN_TOOL_LIMITS } = await import('../lib/plugins/pluginTools')
const { createPluginBehaviorHost } = await import('../lib/plugins/behaviorHost')
const { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } = await import('../lib/plugins/enablement')
const { PLUGIN_API_VERSION } = await import('../lib/plugins/types')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

// Declarations: strict, bounded.
const good = [{ name: 'echo', description: 'Echo a word', scope: 'read', fields: { word: { t: 'string', min: 1, max: 20 }, times: { t: 'number', int: true, min: 1, max: 3, optional: true }, loud: { t: 'boolean', optional: true }, mood: { t: 'enum', values: ['calm', 'wild'], optional: true } } }]
assert.deepEqual(validatePluginToolSpecs(good).problems, [])
for (const [bad, needle] of [
  [[{ ...good[0], name: 'Bad Name' }], 'name must be lowercase'], [[{ ...good[0], scope: 'admin' }], 'scope must be'], [[{ ...good[0], description: '' }], 'description is required'],
  [[good[0], good[0]], 'is repeated'], [[{ ...good[0], fields: { x: { t: 'object' } } }], 'x.t must be'], [[{ ...good[0], fields: { 'Bad-Field': { t: 'string' } } }], 'field names'],
  [[{ ...good[0], fields: { m: { t: 'enum', values: [] } } }], 'enum needs'], ['nope', 'must be an array'],
] as const) { const result = validatePluginToolSpecs(bad); assert.ok(result.problems.join().includes(needle), `${needle}: ${result.problems.join()}`); assert.deepEqual(result.specs, [], 'a declaration with problems yields no tools') }
assert.ok(validatePluginToolSpecs(Array.from({ length: PLUGIN_TOOL_LIMITS.tools + 1 }, (_, i) => ({ ...good[0], name: `t${i}` }))).problems.length)
const spec = validatePluginToolSpecs(good).specs[0]!

// Arguments: types, bounds, enums, required, and an argument the declaration lacks is refused (never silently dropped).
const ok = (args: unknown) => validatePluginToolArgs(spec, args)
assert.deepEqual(ok({ word: 'hi', times: 2, loud: true, mood: 'calm' }), { args: { word: 'hi', times: 2, loud: true, mood: 'calm' } })
assert.deepEqual(ok({ word: 'hi' }), { args: { word: 'hi' } })
for (const [args, needle] of [[{}, 'needs "word"'], [{ word: 5 }, 'must be a string'], [{ word: '' }, 'at least 1'], [{ word: 'x'.repeat(21) }, 'at most 20'], [{ word: 'a', times: 1.5 }, 'integer'], [{ word: 'a', times: 9 }, 'at most 3'], [{ word: 'a', loud: 'yes' }, 'true or false'], [{ word: 'a', mood: 'meh' }, 'one of: calm, wild'], [{ word: 'a', extra: 1 }, 'takes no argument "extra"'], [[1], 'must be an object']] as const) assert.ok('error' in ok(args) && (ok(args) as { error: string }).error.includes(needle), needle)
assert.equal(boundPluginToolResult('x'.repeat(20_000)).includes('more characters cut'), true); assert.equal(boundPluginToolResult(undefined), 'done'); assert.equal(boundPluginToolResult({ a: 1 }), '{\n  "a": 1\n}')
assert.equal(pluginToolFullName('adaptive-ui', 'list_shapes'), 'adaptive_ui_list_shapes')

// The host: lists enabled plugins' tools, calls them, and every failure is text for the agent.
const manifest = (id: string, extra: Record<string, unknown> = {}) => ({ apiVersion: PLUGIN_API_VERSION, id, title: id, description: id, renderers: ['web', 'tui'], stateVersion: 1, surfaces: [], commands: [], tools: good, ...extra }) as never
const module = (id: string, handlers: Record<string, unknown>) => async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: id, tools: handlers }) as never
const host = createPluginBehaviorHost([manifest('echo-plugin'), manifest('broken-plugin'), manifest('missing-plugin')], {
  'echo-plugin': module('echo-plugin', { echo: ({ word, times }: { word: string; times?: number }) => word.repeat(Number(times ?? 1)) }),
  'broken-plugin': module('broken-plugin', { echo: () => { throw new Error('boom') } }),
  'missing-plugin': module('missing-plugin', {}),
})
assert.deepEqual(host.listTools().map(tool => tool.name).sort(), ['broken_plugin_echo', 'echo_plugin_echo', 'missing_plugin_echo'])
assert.deepEqual(await host.callTool('echo_plugin_echo', { word: 'ab', times: 2 }), { text: 'abab', isError: false })
assert.deepEqual(await host.callTool('echo_plugin_echo', { word: 'ab', extra: 1 }), { text: 'echo takes no argument "extra" (it takes: word, times, loud, mood)', isError: true })
assert.match((await host.callTool('broken_plugin_echo', { word: 'a' })).text, /failed: boom/); assert.equal((await host.callTool('broken_plugin_echo', { word: 'a' })).isError, true)
assert.equal((await host.callTool('missing_plugin_echo', { word: 'a' })).isError, true, 'a declared tool with no handler is an error to read, not a crash')
assert.match((await host.callTool('nope', {})).text, /no tool "nope" \(plugin tools: /)
const big = createPluginBehaviorHost([manifest('big-plugin')], { 'big-plugin': module('big-plugin', { echo: () => 'z'.repeat(100_000) }) })
assert.ok((await big.callTool('big_plugin_echo', { word: 'a' })).text.length < 17_000, 'what a model is handed is bounded')
const slow = createPluginBehaviorHost([manifest('slow-plugin')], { 'slow-plugin': module('slow-plugin', { echo: () => new Promise(() => {}) }) })
const gone = new AbortController(); setTimeout(() => gone.abort(), 60)
assert.match((await slow.callTool('slow_plugin_echo', { word: 'a' }, gone.signal)).text, /did not finish/)
// Turning a plugin off removes its tools at once.
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'echo-plugin', false))
assert.ok(!host.listTools().some(tool => tool.pluginId === 'echo-plugin')); assert.equal((await host.callTool('echo_plugin_echo', { word: 'a' })).isError, true)
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS); host.dispose(); big.dispose(); slow.dispose()

// A mod offers tools too: declared in plugin.json, handled by its server module.
const modDir = join(root, 'plugins', 'tools-mod'); mkdirSync(modDir, { recursive: true })
writeFileSync(join(modDir, 'plugin.json'), JSON.stringify({ id: 'tools-mod', tools: [{ name: 'shout', description: 'Upper-case a word', scope: 'read', fields: { word: { t: 'string', min: 1, max: 50 } } }] }))
writeFileSync(join(modDir, 'server.mjs'), "export const tools = { shout: ({ word }) => word.toUpperCase() }")
const { requestModReload } = await import('../lib/plugins/modReload'); const { localPluginDiscovery } = await import('../lib/plugins/localPlugins')
requestModReload(); assert.deepEqual(localPluginDiscovery().refused, [])
const { pluginBehaviorHost } = await import('../lib/plugins/serverBehaviors')
const live = pluginBehaviorHost()
assert.ok(live.listTools().some(tool => tool.name === 'tools_mod_shout'), 'a mod with only tools is loaded')
assert.deepEqual(await live.callTool('tools_mod_shout', { word: 'hey' }), { text: 'HEY', isError: false })
assert.ok(live.listTools().some(tool => tool.name === 'adaptive_ui_propose_rule'), 'the bundled adaptive-ui plugin offers its tools')
writeFileSync(join(modDir, 'plugin.json'), JSON.stringify({ id: 'tools-mod', tools: [{ name: 'shout', description: 'x', scope: 'root', fields: {} }] }))
requestModReload(); assert.ok(localPluginDiscovery().refused.some(entry => entry.problems.join().includes('scope must be')), 'a bad declaration refuses the mod')
console.log('pluginToolsSmoke: ok')
process.exit(0)

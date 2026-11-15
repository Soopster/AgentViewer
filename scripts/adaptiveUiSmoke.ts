// The Adaptive UI loop through the real read path: an unseen tool shape is reported without its
// values, a rule written as a draft draws nothing, enabling it changes the card, and the guards
// that stop a generated card from misleading hold.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'adaptive-ui-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes')
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
process.env.AGENT_VIEWER_PLUGINS_DIR = join(root, 'plugins')
process.env.AGENT_VIEWER_MODS_WATCH = '0'
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(root, 'plugins.json')

const { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } = await import('../lib/plugins/enablement')
const { annotatePluginToolCards, clearPluginToolCardCache } = await import('../lib/plugins/toolCards')
const { onPluginRuntimeEvent } = await import('../lib/plugins/runtimeEvents')
const { pluginsMayPresentToolCards } = await import('../lib/plugins/toolCardsGate')
const { nativeAdaptiveUi, adaptiveUiSnapshot } = await import('../lib/adaptiveUi/runtime')
const { writeCardRule, loadCardRules } = await import('../lib/adaptiveUi/store')
const { cardBlockLines } = await import('../lib/plugins/cardBlocks')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
assert.equal(pluginsMayPresentToolCards(), true, 'the plugin declares toolCard, so the read path runs')

type Msg = { type: string; uuid: string; session_id: string; message: { role: string; content: unknown[] } }
const call = (id: string, name: string, input: Record<string, unknown>, result?: { text: string; error?: boolean }): Msg[] => [
  { type: 'assistant', uuid: `a-${id}`, session_id: 's', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
  ...(result ? [{ type: 'user', uuid: `u-${id}`, session_id: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result.text, ...(result.error ? { is_error: true } : {}) }] } }] : []),
]
const card = async (messages: Msg[]) => {
  const out = await annotatePluginToolCards('claude', undefined, 's', messages as never)
  const use = (out[0]!.message as { content: { pluginCard?: { title: string; tone: string; blocks?: never[]; lines: string[] } }[] }).content[0]!
  return use.pluginCard
}
const events: { type: string; shape?: { tool: string; inputKeys: readonly string[]; mcpServer?: string; resultBytes?: number } }[] = []
const off = onPluginRuntimeEvent(event => { if (event.type === 'block.unrendered') events.push(event as never) })

const TOOL = 'mcp__linear__get_issue'
const issue = JSON.stringify({ title: 'Fix login', state: 'Done', assignee: { name: 'Ada' } })
const SECRET = 'sk-live-should-never-appear'

// 1. An unseen shape: no card, one event with key names only, a redacted sample kept.
assert.equal(await card(call('t1', TOOL, { id: 'ENG-1', apiKey: SECRET }, { text: issue })), undefined)
assert.equal(events.length, 1); assert.deepEqual(events[0]!.shape, { tool: TOOL, mcpServer: 'linear', inputKeys: ['apiKey', 'id'], resultBytes: issue.length })
assert.ok(!JSON.stringify(events).includes('ENG-1') && !JSON.stringify(events).includes(SECRET), 'the event carries key names, never values')
clearPluginToolCardCache()
assert.equal(await card(call('t2', TOOL, { id: 'ENG-2', apiKey: SECRET }, { text: issue })), undefined)
assert.equal(events.length, 1, 'once per shape per process')
let snap = adaptiveUiSnapshot()
const shape = snap.shapes.find(s => s.tool === TOOL)!
assert.equal(shape.count, 2); assert.ok(shape.samples.length >= 1)
assert.ok(!JSON.stringify(snap).includes(SECRET), 'samples are redacted'); assert.ok(JSON.stringify(shape.samples).includes('[redacted]'))
// Native tools are never reported or drawn by a rule.
assert.equal(await card(call('b1', 'Bash', { command: 'ls' }, { text: 'a' })), undefined)
assert.equal(events.length, 1, 'a tool with its own card is not "unrendered"')
assert.ok(!adaptiveUiSnapshot().shapes.some(s => s.tool === 'Bash'))

// 2. The design request names the file, the format and the (redacted) samples.
const prompt = await nativeAdaptiveUi.designPrompt(shape.key)
assert.ok(prompt.includes(join(root, 'recipes')) && prompt.includes('linear.get_issue.json') && prompt.includes('"status": "draft"') && prompt.includes('ENG-'))
assert.ok(!prompt.includes(SECRET))
assert.ok(prompt.includes('agent-viewer cards check') && prompt.includes('Do not enable the rule'), 'the request tells the agent how to validate and not to enable')

// 3. A rule written as a draft draws nothing; enabling it draws the card, in the same read path.
const rule = { id: 'linear.get_issue', status: 'draft', match: { tool: TOOL }, title: '{{input.id}} · {{result.json.title}}',
  tone: [{ when: { path: 'result.json.state', equals: 'Done' }, tone: 'success' }],
  blocks: [{ type: 'badge', text: '{{result.json.state}}' }, { type: 'kv', rows: [['Assignee', '{{result.json.assignee.name | default none}}']] }],
  samples: [{ input: { id: 'ENG-1' }, result: { text: issue } }] }
writeCardRule(rule); clearPluginToolCardCache()
assert.equal(await card(call('t3', TOOL, { id: 'ENG-3' }, { text: issue })), undefined, 'a draft is never drawn')
await nativeAdaptiveUi.setStatus('linear.get_issue', 'active')
const drawn = await card(call('t4', TOOL, { id: 'ENG-4' }, { text: issue }))
assert.ok(drawn); assert.equal(drawn!.title, 'ENG-4 · Fix login'); assert.equal(drawn!.tone, 'success')
assert.deepEqual(cardBlockLines(drawn!.blocks as never), ['[Done]', 'Assignee  Ada'])
assert.deepEqual(drawn!.lines, ['[Done]', 'Assignee  Ada'], 'lines stay as the fallback form')
// While the call runs there is no result: the card still draws, with empty bindings.
const running = await card(call('t5', TOOL, { id: 'ENG-5' }))
assert.equal(running!.title, 'ENG-5 ·'); assert.equal(running!.tone, 'info')
// A failed call is an error whatever the rule says.
assert.equal((await card(call('t6', TOOL, { id: 'ENG-6' }, { text: 'boom', error: true })))!.tone, 'error')

// 4. A rule does not replace a built-in card unless it says so.
writeCardRule({ id: 'bash.card', status: 'active', match: { tool: 'Bash' }, title: 'ran {{input.command}}', blocks: [] }); clearPluginToolCardCache()
assert.equal(await card(call('b2', 'Bash', { command: 'ls' }, { text: 'x' })), undefined)
writeCardRule({ id: 'bash.card', status: 'active', overridesNative: true, match: { tool: 'Bash' }, title: 'ran {{input.command}}', blocks: [] }); clearPluginToolCardCache()
assert.equal((await card(call('b3', 'Bash', { command: 'ls' }, { text: 'x' })))!.title, 'ran ls')

// 5. The narrower of two matching rules wins.
writeCardRule({ id: 'linear.any', status: 'active', match: { tool: 'mcp__linear__*' }, title: 'generic linear', blocks: [] }); clearPluginToolCardCache()
assert.equal((await card(call('t7', TOOL, { id: 'ENG-7' }, { text: issue })))!.title, 'ENG-7 · Fix login')
assert.equal((await card(call('t8', 'mcp__linear__list', { q: 'x' }, { text: '[]' })))!.title, 'generic linear')

// 6. A file that does not validate is listed with its reasons and never drawn.
writeFileSync(join(root, 'recipes', 'bad.json'), JSON.stringify({ id: 'bad', status: 'active', match: { tool: '*' }, title: '{{input.x | eval}}', blocks: [] }))
writeFileSync(join(root, 'recipes', 'worse.json'), '{ not json')
const loaded = loadCardRules()
assert.deepEqual(loaded.invalid.map(entry => entry.file).sort(), ['bad.json', 'worse.json'])
assert.ok(loaded.invalid.find(entry => entry.file === 'bad.json')!.problems.join().includes('match.tool'))
assert.throws(() => writeCardRule({ id: 'x', status: 'active', match: { tool: '*' }, title: 't', blocks: [] }), /refused/)

// 7. Delete removes the card.
await nativeAdaptiveUi.remove('linear.any'); await nativeAdaptiveUi.remove('linear.get_issue'); clearPluginToolCardCache()
assert.equal(await card(call('t9', TOOL, { id: 'ENG-9' }, { text: issue })), undefined)
assert.ok(!readdirSync(join(root, 'recipes')).includes('linear.get_issue.json'))
// 8. The TUI reads transcripts in a worker isolate and draws the gallery in the main one: shapes the
// other isolate persisted reach this one's snapshot without a restart.
const { writeFileSync: write, mkdirSync: mk } = await import('node:fs')
mk(join(root, 'state'), { recursive: true })
await new Promise(resolve => setTimeout(resolve, 20))
write(join(root, 'state', 'state.json'), JSON.stringify({ shapes: [{ key: 'mcp__other__ping|q', tool: 'mcp__other__ping', inputKeys: ['q'], count: 7, firstSeen: 1, lastSeen: Date.now() + 5_000, samples: [] }] }))
assert.ok(adaptiveUiSnapshot().shapes.some(shape => shape.tool === 'mcp__other__ping' && shape.count === 7), 'a shape persisted by another isolate appears')
// 9. A mod ships card rules in its own folder: they draw for its tools, read-only here, and the person's own
// rule with the same id wins. A disabled mod's rules do not draw.
const { mkdirSync: mkd } = await import('node:fs')
const { resetLocalPluginDiscovery } = await import('../lib/plugins/localPlugins')
const { withPluginEnabled, DEFAULT_PLUGIN_SETTINGS: defaults } = await import('../lib/plugins/enablement')
const modDir = join(root, 'plugins', 'rules-mod'); mkd(join(modDir, 'ui-recipes'), { recursive: true })
write(join(modDir, 'plugin.json'), JSON.stringify({ id: 'rules-mod', commands: [{ id: 'x' }] })); write(join(modDir, 'server.mjs'), 'export const commands = { x: () => ({}) }')
write(join(modDir, 'ui-recipes', 'ping.card.json'), JSON.stringify({ id: 'ping.card', status: 'active', match: { tool: 'mcp__ping__ping' }, title: 'ping from mod {{input.q}}', blocks: [] }))
write(join(modDir, 'ui-recipes', 'broken.json'), '{ nope')
resetLocalPluginDiscovery(); clearPluginToolCardCache()
const fromMod = await card(call('m1', 'mcp__ping__ping', { q: 'x' }, { text: 'pong' }))
assert.equal(fromMod?.title, 'ping from mod x', 'a mod ships its own card rules')
let withMod = await nativeAdaptiveUi.scan()
assert.equal(withMod.origins['ping.card'], 'rules-mod'); assert.ok(withMod.invalid.some(entry => entry.file === 'rules-mod/broken.json'))
await assert.rejects(nativeAdaptiveUi.setStatus('ping.card', 'disabled'), /no card rule/, 'the gallery cannot edit a mod\'s files')
writeCardRule({ id: 'ping.card', status: 'active', match: { tool: 'mcp__ping__ping' }, title: 'ping from me', blocks: [] }); clearPluginToolCardCache()
assert.equal((await card(call('m2', 'mcp__ping__ping', { q: 'x' }, { text: 'pong' })))?.title, 'ping from me', 'the person\'s rule wins over a mod\'s')
const merged = await nativeAdaptiveUi.scan()
assert.equal(merged.rules.filter(rule => rule.id === 'ping.card').length, 1, 'one rule per id, not both'); assert.equal(merged.origins['ping.card'], undefined)
await nativeAdaptiveUi.remove('ping.card'); clearPluginToolCardCache()
const { writePluginSettingsFile } = await import('../lib/plugins/settingsFile')
writePluginSettingsFile(withPluginEnabled(defaults, 'rules-mod', false)); clearPluginToolCardCache()
assert.equal(await card(call('m3', 'mcp__ping__ping', { q: 'x' }, { text: 'pong' })), undefined, 'a disabled mod\'s rules do not draw')
writePluginSettingsFile(defaults)
off()
console.log('adaptiveUiSmoke: ok')
process.exit(0)

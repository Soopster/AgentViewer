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
off()
console.log('adaptiveUiSmoke: ok')
process.exit(0)

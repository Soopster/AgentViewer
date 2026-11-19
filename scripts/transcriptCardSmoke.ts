// A plugin can present a transcript block that is not a tool call: system messages, through the same read
// path, with the same guarantees, in both renderers' data (the payload carries the card through threading).
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'transcript-card-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes')
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
process.env.AGENT_VIEWER_PLUGINS_DIR = join(root, 'plugins')
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(root, 'plugins.json')
process.env.AGENT_VIEWER_MODS_WATCH = '0'
const { annotatePluginToolCards, clearPluginToolCardCache } = await import('../lib/plugins/toolCards')
const { writeCardRule } = await import('../lib/adaptiveUi/store')
const { buildThreadedMessages } = await import('../lib/threading')
const { formatTranscriptCards } = await import('../tui/format')
const { parseCardRule } = await import('../lib/plugins/cardTemplates')
const { localPluginDiscovery } = await import('../lib/plugins/localPlugins')
const { requestModReload } = await import('../lib/plugins/modReload')

const system = (uuid: string, subtype: string, extra: Record<string, unknown> = {}) => ({ type: 'system', uuid, session_id: 's', parent_tool_use_id: null, message: { type: 'system', subtype, content: 'plain', ...extra } })
const annotate = async (...messages: ReturnType<typeof system>[]) => (await annotatePluginToolCards('claude', undefined, 's', messages as never)) as unknown as { message: { pluginCard?: { title: string; tone: string; lines: string[]; blocks?: unknown[] }; subtype: string } }[]
const rule = { id: 'retry.card', status: 'draft', overridesNative: true, match: { kind: 'system', tool: 'api_retry' }, title: 'Retrying · attempt {{input.attempt}} of {{input.max_retries}}', tone: 'warning', blocks: [{ type: 'badge', text: '{{input.reason | default unknown}}' }] }

// A system rule parses, and a tool rule can never match a system message nor the reverse.
assert.equal(parseCardRule(rule).rule?.match.kind, 'system'); assert.equal(parseCardRule({ ...rule, match: { kind: 'tool', tool: 'x' } }).rule?.match.kind, undefined); assert.equal(parseCardRule({ ...rule, match: { kind: 'other', tool: 'x' } }).rule, null)
writeCardRule(rule); clearPluginToolCardCache()
assert.equal((await annotate(system('m1', 'api_retry', { attempt: 2, max_retries: 5 })))[0]!.message.pluginCard, undefined, 'a draft is never drawn')
writeCardRule({ ...rule, status: 'active' }); clearPluginToolCardCache()
const [hit, miss] = await annotate(system('m2', 'api_retry', { attempt: 2, max_retries: 5, reason: 'overloaded' }), system('m3', 'compact_boundary'))
assert.equal(hit!.message.pluginCard!.title, 'Retrying · attempt 2 of 5'); assert.equal(hit!.message.pluginCard!.tone, 'warning'); assert.deepEqual(hit!.message.pluginCard!.lines, ['[overloaded]'])
assert.equal(miss!.message.pluginCard, undefined, 'another subtype keeps its own card')
// A tool rule that happens to share the name does not draw a system message.
writeCardRule({ id: 'tool.same', status: 'active', match: { tool: 'compact_boundary' }, title: 'tool rule', blocks: [] }); clearPluginToolCardCache()
assert.equal((await annotate(system('m4', 'compact_boundary')))[0]!.message.pluginCard, undefined)
// And a system rule never draws a tool call, even one named like its subtype.
writeCardRule({ id: 'sys.named.like.tool', status: 'active', overridesNative: true, match: { kind: 'system', tool: 'mcp__x__y' }, title: 'system rule', blocks: [] }); clearPluginToolCardCache()
const toolCall = [{ type: 'assistant', uuid: 'tc1', session_id: 's', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'mcp__x__y', input: {} }] } }]
const annotatedTool = await annotatePluginToolCards('claude', undefined, 's', toolCall as never) as unknown as { message: { content: { pluginCard?: unknown }[] } }[]
assert.equal(annotatedTool[0]!.message.content[0]!.pluginCard, undefined, 'a system rule does not draw a tool call')
// A failed system message is an error whatever the rule says.
assert.equal((await annotate(system('m5', 'api_retry', { attempt: 1, max_retries: 5, level: 'error' })))[0]!.message.pluginCard!.tone, 'error')
assert.equal((await annotate(system('m6', 'api_retry', { attempt: 1, max_retries: 5, error: 'rate_limit' })))[0]!.message.pluginCard!.tone, 'error')

// The card survives threading and reaches the TUI's cards; the original payload is untouched underneath.
const threaded = buildThreadedMessages((await annotate(system('m7', 'api_retry', { attempt: 3, max_retries: 5 }))) as never)
const block = threaded[0]!.blocks[0] as { type: string; payload: { pluginCard?: { title: string }; attempt?: number } }
assert.equal(block.type, 'claude_system'); assert.equal(block.payload.pluginCard?.title, 'Retrying · attempt 3 of 5'); assert.equal(block.payload.attempt, 3)
const cards = formatTranscriptCards(threaded)
assert.ok(cards[0]!.lines.some(entry => entry.text.includes('Retrying · attempt 3 of 5')), cards[0]!.lines.map(entry => entry.text).join('|'))
assert.ok(cards[0]!.expandedLines.some(entry => entry.text.includes('Retrying · attempt 3 of 5')))

// A mod can present system messages with its own hook, bounded payload in, bounded card out.
const mod = join(root, 'plugins', 'sys-mod'); mkdirSync(mod, { recursive: true })
writeFileSync(join(mod, 'plugin.json'), JSON.stringify({ id: 'sys-mod', commands: [{ id: 'x' }], behavior: { hooks: ['transcriptCard'] } }))
writeFileSync(join(mod, 'server.mjs'), `export const commands = { x: () => ({}) }
export function transcriptCard({ block }) { return block.subtype === 'mod_notice' ? { title: 'from the mod: ' + block.payload.content, blocks: [{ type: 'text', text: 'seen ' + Object.keys(block.payload).length + ' keys, ' + JSON.stringify(block.payload).length + ' chars' }] } : null }`)
requestModReload(); localPluginDiscovery(); clearPluginToolCardCache() // a reload, as in the app: the host is rebuilt with the new mod
const wide = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`k${i}`, 'z'.repeat(900)]))
const [fromMod] = await annotate(system('m8', 'mod_notice', { ...wide, huge: 'z'.repeat(50_000), nested: { a: 1 } }))
assert.equal(fromMod!.message.pluginCard!.title, 'from the mod: plain')
const seen = (fromMod!.message.pluginCard!.blocks![0] as { text: string }).text
assert.ok(Number(/(\d+) chars/.exec(seen)![1]) <= 8_000, `the hook saw a bounded payload: ${seen}`)
console.log('transcriptCardSmoke: ok')
process.exit(0)

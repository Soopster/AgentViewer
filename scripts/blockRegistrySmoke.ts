// Plugin blocks and terminal tool formatters: a mod's `blocks` pattern becomes a
// threaded `plugin_block` drawn as a card by the terminal and the HTML export;
// a registered terminal tool formatter draws (or declines) a tool call.
import assert from 'node:assert/strict'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { syncBlocksFrom } from '../lib/plugins/blockContributions'
import { blockPatternProblem, findPluginBlockRegions, registerBlockParser } from '../lib/blockRegistry'
import { buildThreadedMessages } from '../lib/threading'
import { formatTranscriptCards, formatTranscriptExpandedText } from '../tui/format'
import { registerTuiToolFormatter } from '../tui/format/registry'
import { exportSessionToHtml } from '../lib/export'

let n = 0
const message = (role: 'user' | 'assistant', content: unknown[]): never => ({ type: role, uuid: `u${++n}`, session_id: 's', parent_tool_use_id: null, message: { role, content } }) as never
const withBlock = (text: string) => buildThreadedMessages([message('user', [{ type: 'text', text }])])

// A mod's declarative pattern.
const parsed = parseLocalPluginManifest({ id: 'tickets', blocks: [{ kind: 'ref', pattern: 'TICKET-(\\d+)', title: 'Ticket {1}', lines: ['opens https://tracker.example/{1}', 'seen: {0}'], tone: 'warning' }] }, new Set())
assert.deepEqual(parsed.problems, [])
const manifest = parsed.manifest!
assert.equal(manifest.blocks?.[0]?.kind, 'ref')
syncBlocksFrom([manifest])
const threaded = withBlock('before TICKET-42 after')
const blocks = threaded[0]!.blocks
assert.deepEqual(blocks.map(block => block.type), ['text', 'plugin_block', 'text'])
const pluginBlock = blocks[1] as Extract<(typeof blocks)[number], { type: 'plugin_block' }>
assert.equal(pluginBlock.kind, 'tickets.ref')
assert.equal(pluginBlock.card.title, 'Ticket 42')
assert.deepEqual(pluginBlock.card.lines, ['opens https://tracker.example/42', 'seen: TICKET-42'])
assert.equal(pluginBlock.text, 'TICKET-42')

// Terminal and export draw it without any per-renderer code.
const [card] = formatTranscriptCards(threaded)
assert.ok(card!.lines.some(entry => entry.text.includes('Ticket 42')), 'terminal card shows the title')
assert.ok(formatTranscriptExpandedText(threaded).includes('opens https://tracker.example/42'), 'expanded terminal text shows the lines')
const html = exportSessionToHtml({ sessionId: 's', summary: 'S' }, [message('user', [{ type: 'text', text: 'see TICKET-7' }])])
assert.ok(html.includes('Ticket 7') && html.includes('data-kind="tickets.ref"'), 'export draws the block')

// Withdrawn with its plugin; nothing changes for text no parser claims.
syncBlocksFrom([])
assert.deepEqual(withBlock('before TICKET-42 after')[0]!.blocks.map(block => block.type), ['text'])

// Bounded patterns, refused up front.
for (const bad of [{ pattern: '' }, { pattern: 'x'.repeat(201) }, { pattern: '(a+)+$' }, { pattern: '(' }, { pattern: 'a', flags: 'g' }]) assert.ok(blockPatternProblem(bad), `refused ${bad.pattern.slice(0, 12)}`)
assert.ok(parseLocalPluginManifest({ id: 'bad', blocks: [{ kind: 'x', pattern: '(a+)+$', title: 't' }] }, new Set()).problems.length)
assert.ok(parseLocalPluginManifest({ id: 'bad', blocks: [{ kind: 'x', pattern: 'a' }] }, new Set()).problems.length, 'a title is required')

// A faulty or lying parser contributes nothing and cannot blank a transcript.
const stopThrow = registerBlockParser({ id: 'throws', find() { throw new Error('boom') } })
const stopLie = registerBlockParser({ id: 'lies', find: () => [{ start: 5, end: 999, kind: 'x', card: { pluginId: 'p', title: 't', lines: [], tone: 'info' } }] })
assert.deepEqual(findPluginBlockRegions('short'), [])
assert.deepEqual(withBlock('plain text')[0]!.blocks.map(block => block.type), ['text'])
stopThrow(); stopLie()

// Terminal tool formatters: registered by tool name, newest first, null defers, restore on unregister.
const toolMessages = buildThreadedMessages([
  message('assistant', [{ type: 'tool_use', id: 't1', name: 'Mystery', input: { q: 1 } }]),
  message('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'out' }]),
])
const bodyOf = () => formatTranscriptCards(toolMessages)[0]!.lines.map(entry => entry.text).join('\n')
const builtIn = bodyOf()
assert.ok(!builtIn.includes('MYSTERY'))
const stopOlder = registerTuiToolFormatter(['Mystery'], { preview: () => [{ text: 'MYSTERY-OLD', tone: 'tool' }] })
const stopNewer = registerTuiToolFormatter(['Mystery'], { preview: () => [{ text: 'MYSTERY-NEW', tone: 'tool' }], expanded: () => [{ text: 'MYSTERY-FULL', tone: 'tool' }] })
assert.ok(bodyOf().includes('MYSTERY-NEW') && !bodyOf().includes('MYSTERY-OLD'))
assert.ok(formatTranscriptExpandedText(toolMessages).includes('MYSTERY-FULL'))
const stopDecline = registerTuiToolFormatter(['Mystery'], { preview: () => null })
assert.ok(bodyOf().includes('MYSTERY-NEW'), 'a declining formatter hands over to the next')
stopDecline(); stopNewer()
assert.ok(bodyOf().includes('MYSTERY-OLD'), 'removing the newest restores the older')
stopOlder()
assert.equal(bodyOf(), builtIn, 'built-in formatting returns')
console.log('block registry smoke passed')

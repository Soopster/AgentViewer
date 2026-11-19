// The TUI knows which tools a card is about, counts expanding and folding it the way the Web does, and
// delivers the counts to plugins as ui.interaction.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(mkdtempSync(join(tmpdir(), 'tui-card-')), 'plugins.json')
const { buildThreadedMessages } = await import('../lib/threading')
const { formatTranscriptCards } = await import('../tui/format')
const { reportCardToolInteraction } = await import('../tui/opentui/app/reportCardInteraction')
const { setUiInteractionSink, flushUiInteractions } = await import('../lib/plugins/uiInteractions')
const { installTuiUiInteractionSink } = await import('../tui/opentui/uiInteractionSink')
const { onPluginRuntimeEvent } = await import('../lib/plugins/runtimeEvents')

const msg = (uuid: string, type: string, role: string, content: unknown[]) => ({ type, uuid, session_id: 's1', message: { role, content }, parent_tool_use_id: null })
const messages = [
  msg('a1', 'assistant', 'assistant', [
    { type: 'tool_use', id: 't1', name: 'mcp__linear__get_issue', input: { id: 'ENG-1' } },
    { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } },
    { type: 'tool_use', id: 't3', name: 'mcp__linear__get_issue', input: { id: 'ENG-2' } },
  ]),
  msg('u1', 'user', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: '{"title":"x"}' }, { type: 'tool_result', tool_use_id: 't2', content: 'a' }, { type: 'tool_result', tool_use_id: 't3', content: '{}' }]),
  msg('a2', 'assistant', 'assistant', [{ type: 'text', text: 'done' }]),
]
const cards = formatTranscriptCards(buildThreadedMessages(messages as never))
const withTools = cards.find(card => card.toolNames)!
assert.deepEqual(withTools.toolNames, ['mcp__linear__get_issue', 'Bash'], 'real tool names, once each, in order')
assert.equal(cards.find(card => card.key === 'a2')?.toolNames, undefined, 'a card that called nothing has none')

// Only tools a generic card draws are counted, and `expanded` is the state the card goes to.
const reports: { action: string; subject: string; sessionId: string }[] = []
setUiInteractionSink(batch => { for (const r of batch) reports.push({ action: r.action, subject: r.subject, sessionId: r.target.sessionId }) })
const session = { provider: 'claude', sessionId: 's1' }
reportCardToolInteraction(withTools, true, session); reportCardToolInteraction(withTools, false, session)
reportCardToolInteraction(cards.find(card => card.key === 'a2')!, true, session)
reportCardToolInteraction(withTools, true, null)
flushUiInteractions()
assert.deepEqual(reports, [{ action: 'expand', subject: 'mcp__linear__get_issue', sessionId: 's1' }, { action: 'fold', subject: 'mcp__linear__get_issue', sessionId: 's1' }].map(r => r), 'Bash has its own card; a card with no tools and an unknown session report nothing')

// The TUI's sink publishes what it is handed as ui.interaction.
const events: { interaction?: { action: string; subject: string; count: number }; source: string; target: { provider: string; sessionId: string } }[] = []
const off = onPluginRuntimeEvent(event => { if (event.type === 'ui.interaction') events.push(event as never) })
installTuiUiInteractionSink()
reportCardToolInteraction(withTools, true, session); reportCardToolInteraction(withTools, true, session)
flushUiInteractions()
for (let i = 0; i < 100 && !events.length; i++) await new Promise(resolve => setTimeout(resolve, 50))
off()
assert.equal(events.length, 1); assert.deepEqual(events[0]!.interaction, { action: 'expand', subject: 'mcp__linear__get_issue', count: 2 })
assert.equal(events[0]!.source, 'renderer'); assert.deepEqual(events[0]!.target, { provider: 'claude', sessionId: 's1' })
console.log('tuiCardInteractionSmoke: ok')
process.exit(0)

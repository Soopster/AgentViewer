import assert from 'node:assert/strict'
import { normalizeCodexStreamThreadedMessage } from '../lib/codexMapper'
import { indexComposerMessages, visibleComposerMessages, upsertComposerMessage } from '../lib/composerTranscript'
import { appendCodexLiveToolOutput } from '../tui/opentui/app/liveStream'
import { runTranscriptCards } from '../tui/opentui/app/derived/transcriptCards'
import { formatTranscriptCard } from '../tui/format'
import { buildTaskRegistry } from '../lib/taskRegistry'
import type { ThreadedMessage } from '../lib/threading'
const session = { provider: 'codex' as const, sessionId: 'thread', cwd: '/tmp', lastModified: 1 }
const item = { type: 'commandExecution', id: 'command', command: 'git status --short', cwd: '/tmp', status: 'inProgress', source: 'agent', commandActions: [], aggregatedOutput: '', exitCode: null, durationMs: null }
const tool = normalizeCodexStreamThreadedMessage({ type: 'codex_item_started', threadId: 'thread', turnId: 'turn', item })!
assert.ok(tool)
let live: ThreadedMessage[] = [tool]
const polled = { ...tool }
const output = (delta: string) => { live = appendCodexLiveToolOutput(live, { type: 'codex_command_output_delta', threadId: 'thread', turnId: 'turn', itemId: 'command', delta }, session) }
const text = () => live.flatMap(message => message.blocks).flatMap(block => block.type === 'tool_thread' && typeof block.result?.content === 'string' ? [block.result.content] : []).join('')
output('first output\n')
live = visibleComposerMessages(live, indexComposerMessages([polled]))
assert.equal(live.length, 1, 'a polled tool with the same ID must not evict the streaming tool')
output('second output\n')
assert.equal(text(), 'first output\nsecond output\n', 'polling must not discard output already streamed')
const thinking: ThreadedMessage = { role: 'assistant', uuid: 'turn:thinking', sessionId: 'thread', provider: 'codex', blocks: [{ type: 'thinking', thinking: 'Inspecting output', reasoning: { startedAt: 1000 } }] }
live = upsertComposerMessage(live, thinking)
const cards = runTranscriptCards({ liveTranscriptMessagesForSession: visibleComposerMessages(live, indexComposerMessages([polled])), baseAndBridgeTranscriptCards: [formatTranscriptCard(polled)], showToolCalls: true, liveTurnStartedAt: 1000, latestBaseAndBridgeTimestamp: 0, density: 'balanced', baseTaskContext: { activeForms: new Map(), taskRegistry: buildTaskRegistry([]) } })
assert.equal(cards.length, 2, 'thinking updates retain the one tool row in place without duplication')
assert.match(cards[0].expandedLines.map(line => line.text).join('\n'), /first output[\s\S]*second output/)
live = visibleComposerMessages(live, indexComposerMessages(live))
output('third output\n')
assert.equal(text(), 'first output\nsecond output\nthird output\n', 'even a caught-up poll must retain the live accumulator until turn settlement')
const done = normalizeCodexStreamThreadedMessage({ type: 'codex_item_completed', threadId: 'thread', turnId: 'turn', item: { ...item, status: 'completed', aggregatedOutput: text(), exitCode: 0, durationMs: 20 } })!
live = upsertComposerMessage(live, done)
assert.equal(live.filter(message => message.uuid === tool.uuid).length, 1, 'tool completion updates the existing tool row')
assert.match(text(), /third output/)
console.log('Codex tool handoff: polled IDs, incremental output, thinking updates and completion preserve live tool rows')

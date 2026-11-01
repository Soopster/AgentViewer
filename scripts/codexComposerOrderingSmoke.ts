import assert from 'node:assert/strict'
import { normalizeCodexStreamThreadedMessage } from '../lib/codexMapper'
import { acknowledgeComposerMessage, indexComposerMessages, upsertComposerMessage, visibleComposerMessages } from '../lib/composerTranscript'
import type { ThreadedMessage } from '../lib/threading'
import { formatTranscriptCards } from '../tui/format'
import { runTranscriptCards } from '../tui/opentui/app/derived/transcriptCards'
import { buildTaskRegistry } from '../lib/taskRegistry'

const owner = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'thread' }
const echo = (uuid: string): ThreadedMessage => ({ ...owner, role: 'user', uuid, blocks: [{ type: 'text', text: 'Explain native warming' }] })
const native = (clientId: string, itemId: string): ThreadedMessage => {
  const row = normalizeCodexStreamThreadedMessage({
    type: 'codex_item_completed', threadId: owner.sessionId, turnId: 'turn',
    item: { type: 'userMessage', id: itemId, clientId, content: [{ type: 'text', text: 'Explain native warming', text_elements: [] }] },
  })
  assert.ok(row, 'Codex user notifications must produce a transcript row')
  return { ...row, providerInstanceId: owner.providerInstanceId }
}
const reply: ThreadedMessage = { ...owner, role: 'assistant', uuid: 'reply', blocks: [{ type: 'text', text: 'There are two warming APIs.' }] }
const saved = native('steer-1', 'item-1')
assert.equal(saved.uuid, 'turn:item-1', 'preserve native transcript identity')
assert.equal(saved.requestId, 'steer-1', 'retain Codex client identity through threading')
const live = [echo('steer-1'), reply]
assert.deepEqual(upsertComposerMessage(live, saved), [saved, reply], 'replace the prompt in place before its reply')
assert.deepEqual(upsertComposerMessage([saved, reply], echo('steer-1')), [saved, reply], 'a late steering receipt must not append a duplicate below the reply')
assert.deepEqual(visibleComposerMessages(live, indexComposerMessages([saved, reply])), [], 'polling must hide both saved rows synchronously')
assert.deepEqual(visibleComposerMessages([echo('steer-1'), echo('steer-2')], indexComposerMessages([saved])), [echo('steer-2')], 'identical prompts are distinct submissions')
assert.deepEqual(visibleComposerMessages([echo('steer-2')], indexComposerMessages([saved])), [echo('steer-2')], 'cleanup must not reuse an older identical prompt')
assert.deepEqual(visibleComposerMessages([echo('steer-1')], indexComposerMessages([{ ...saved, providerInstanceId: 'personal' }])), [echo('steer-1')], 'client IDs stay scoped to their provider instance')
const accepted = acknowledgeComposerMessage([echo('live-user'), reply], owner, 'steer-1')
assert.deepEqual(visibleComposerMessages(accepted, indexComposerMessages([saved])), [reply], 'ordinary sends reconcile through their acknowledgement too')
assert.deepEqual(acknowledgeComposerMessage([echo('live-user'), saved, reply], owner, 'steer-1'), [saved, reply], 'native notification arriving before acceptance must consume the optimistic echo')
const second = native('steer-2', 'item-2')
assert.deepEqual(upsertComposerMessage([saved, reply, echo('steer-2')], second), [saved, reply, second])
const cards = runTranscriptCards({
  baseAndBridgeTranscriptCards: formatTranscriptCards([saved, reply], 'balanced'),
  liveTranscriptMessagesForSession: visibleComposerMessages(live, indexComposerMessages([saved, reply])),
  showToolCalls: true, liveTurnStartedAt: undefined, latestBaseAndBridgeTimestamp: 0, density: 'balanced',
  baseTaskContext: { activeForms: new Map(), taskRegistry: buildTaskRegistry([]) },
})
assert.deepEqual(cards.map(card => card.role), ['user', 'assistant'], 'the rendered card sequence must not repeat the prompt below its reply after polling')
console.log('Codex composer ordering: steering, repeated prompts, notification/receipt races and poll reconciliation passed')

import assert from 'node:assert/strict'
import { applySessionTranscriptWindow, emptySessionTranscript } from '../components/session-reader/sessionTranscriptWindow'
import { mergeMessages, trimProjectMessagesForMemory } from '../components/session-reader/messageMerge'
import type { Session, SessionMessage } from '../lib/types'

const session: Session = { sessionId: 's', provider: 'codex', providerInstanceId: 'work' }
function message(index: number, instance = 'work'): SessionMessage {
  return { type: 'assistant', uuid: `m${index}`, session_id: 's', parent_tool_use_id: null,
    provider: 'codex', providerInstanceId: instance, timestamp: new Date(index * 1000).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text: `Message ${index}` }] } }
}
const initial = emptySessionTranscript()
const messages = Array.from({ length: 3000 }, (_, index) => message(index))
const loaded = { ...initial, messages, count: 4000 }
assert.equal(applySessionTranscriptWindow(loaded, { sessionId: 'other' }, session), loaded)
assert.equal(applySessionTranscriptWindow(loaded, { provider: 'claude', externalWriter: true }, session), loaded)
const tail = Array.from({ length: 21 }, (_, index) => message(2980 + index))
const next = applySessionTranscriptWindow(loaded, { offset: 3980, total: 4001, messages: tail }, session)
assert.equal(next.count, 4001, 'cursor uses absolute server offsets rather than retained length')
assert.equal(next.messages.length, 3000)
assert.equal(next.messages[0]!.uuid, 'm1')
assert.equal(next.messages.at(-1)!.uuid, 'm3000')
assert.equal(next.cursorUuid, 'm2981')
assert.equal(applySessionTranscriptWindow(next, { offset: 3980, total: 4001, messages: tail.map(value => ({ ...value })) }, session), next,
  'an unchanged poll preserves the snapshot identity')
const full = applySessionTranscriptWindow({ ...loaded, fullTranscript: true }, { offset: 3980, total: 4001, messages: tail }, session)
assert.equal(full.messages.length, 3001, 'deep links preserve anchored history')
const replacement = applySessionTranscriptWindow(full, { offset: 10, total: 11, replace: true, messages: [message(50)] }, session)
assert.equal(replacement.fullTranscript, false)
assert.equal(replacement.messages.length, 1)
assert.equal(replacement.count, 11)
assert.equal(replacement.cursorUuid, undefined)
const empty = applySessionTranscriptWindow(next, { total: 0, offset: 0, replace: true, messages: [] }, session)
assert.equal(empty.count, 0)
assert.equal(empty.cursorUuid, undefined)
assert.equal(empty.messages.length, 0)
const unstamped = { ...message(0), providerInstanceId: undefined }
assert.equal(applySessionTranscriptWindow(initial, { messages: [unstamped] }, session).messages[0]!.providerInstanceId, 'work')

const work = message(1)
const personal = message(1, 'personal')
assert.equal(mergeMessages([work], [{ ...work }])[0], work)
assert.equal(mergeMessages([work], [personal]).length, 2, 'matching UUIDs from distinct provider instances stay distinct')
const small = [work, personal]
assert.equal(trimProjectMessagesForMemory(small), small)
const perInstance = [...Array.from({ length: 220 }, (_, index) => message(index)),
  ...Array.from({ length: 220 }, (_, index) => message(index, 'personal'))]
const trimmed = trimProjectMessagesForMemory(perInstance)
assert.equal(trimmed.length, 400)
assert.equal(trimmed.filter(value => value.providerInstanceId === 'work').length, 200)
assert.equal(trimmed.filter(value => value.providerInstanceId === 'personal').length, 200)
const manySessions = Array.from({ length: 2600 }, (_, index) => ({ ...message(index), session_id: `s${index}` }))
assert.equal(trimProjectMessagesForMemory(manySessions).length, 2500)
console.log('Web transcript data: absolute cursors, identity bailouts, rewrites, anchored history, and memory bounds passed')

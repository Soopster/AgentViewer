import assert from 'node:assert/strict'
import { createComposerSessions } from '../lib/composerSessions'
import { acknowledgeComposerMessage, upsertComposerMessage, indexComposerMessages, visibleComposerMessages } from '../lib/composerTranscript'
import type { ThreadedMessage } from '../lib/threading'
const store = createComposerSessions()
const a = 'codex@work:shared', b = 'codex@personal:shared'
const aAbort = store.ref<AbortController | null>(a, 'abort', new AbortController())
const bAbort = store.ref<AbortController | null>(b, 'abort', new AbortController())
let aUpdates = 0, bUpdates = 0
store.get(a, 'state', 'idle'); store.get(b, 'state', 'idle')
const unsubscribeA = store.subscribe(a, 'state', () => aUpdates++)
const unsubscribeB = store.subscribe(b, 'state', () => bUpdates++)
store.set(a, 'state', 'idle', 'sending'); store.set(b, 'state', 'idle', 'sending')
aAbort.current!.abort()
assert.equal(bAbort.current!.signal.aborted, false)
store.set(a, 'state', 'idle', 'idle')
assert.equal(store.get(b, 'state', 'idle'), 'sending')
assert.equal(aUpdates, 2); assert.equal(bUpdates, 1)
store.rekey(a, 'codex@work:materialized')
assert.equal(store.peekRef('codex@work:materialized', 'abort'), aAbort)
store.set(a, 'state', 'idle', 'error')
assert.equal(store.get('codex@work:materialized', 'state', 'idle'), 'error')
unsubscribeA(); unsubscribeB()
const user = (uuid: string, text: string, providerInstanceId = 'work'): ThreadedMessage => ({ role: 'user', uuid, provider: 'codex', providerInstanceId, sessionId: 'shared', blocks: [{ type: 'text', text }] })
const echo = user('live-user', 'same prompt'), ack = user('server-id', 'same prompt')
assert.deepEqual(upsertComposerMessage([echo], ack), [ack])
assert.equal(upsertComposerMessage([ack], user('second-real-id', 'same prompt')).length, 2, 'identical durable prompts are separate sends')
assert.equal(upsertComposerMessage([echo], user('other', 'same prompt', 'personal')).length, 2, 'another account consumed this echo')
assert.deepEqual(visibleComposerMessages([echo], indexComposerMessages([ack], new Set(['server-id']))), [])
assert.deepEqual(visibleComposerMessages([echo], indexComposerMessages([ack])), [echo], 'historical text hid a new repeated prompt')
assert.deepEqual(visibleComposerMessages([ack], indexComposerMessages([ack])), [])
const claudeOwner = { provider: 'claude' as const, providerInstanceId: 'work', sessionId: 'shared' }
const claudeEcho = { ...echo, provider: 'claude' as const }
const savedWithContext = { ...claudeEcho, uuid: 'claude-prompt-id', blocks: [{ type: 'text' as const, text: 'same prompt\n\nAttached file: notes.md' }] }
const accepted = acknowledgeComposerMessage([claudeEcho], claudeOwner, savedWithContext.uuid)
assert.equal(accepted[0].uuid, savedWithContext.uuid)
assert.deepEqual(visibleComposerMessages(accepted, indexComposerMessages([savedWithContext])), [], 'provider-added context must not leave a duplicate echo')
assert.equal(acknowledgeComposerMessage(accepted, claudeOwner, savedWithContext.uuid), accepted, 'replayed receipts must be a no-op')
assert.deepEqual(acknowledgeComposerMessage([claudeEcho], { ...claudeOwner, providerInstanceId: 'personal' }, savedWithContext.uuid), [claudeEcho], 'receipts must stay within their provider instance')
assert.deepEqual(acknowledgeComposerMessage([claudeEcho, savedWithContext], claudeOwner, savedWithContext.uuid), [savedWithContext], 'an acknowledgement already in the overlay replaces its echo')
const steer = { ...claudeEcho, uuid: 'claude-steered-id' }
assert.deepEqual(visibleComposerMessages([steer], indexComposerMessages([steer])), [], 'steered prompts must reconcile by their receipt ID')
assert.equal(visibleComposerMessages([steer], indexComposerMessages([{ ...steer, uuid: 'prior-identical-send' }])).length, 1, 'identical sends with different receipt IDs must remain distinct')
console.log('Composer session isolation, targeted cancellation, rekeying and optimistic/persisted deduplication passed')

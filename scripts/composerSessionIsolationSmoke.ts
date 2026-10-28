import assert from 'node:assert/strict'
import { createComposerSessions } from '../lib/composerSessions'
import { upsertComposerMessage, indexComposerMessages, visibleComposerMessages } from '../lib/composerTranscript'
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
console.log('Composer session isolation, targeted cancellation, rekeying and optimistic/persisted deduplication passed')

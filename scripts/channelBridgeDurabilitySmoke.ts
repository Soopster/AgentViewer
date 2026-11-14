import assert from 'node:assert/strict'
import { advanceChannelDeliveryState } from '../lib/channelBridge'
import {
  createChannelBridgeOutboxEntry,
  enqueueChannelBridgeMessage,
  flushChannelBridgeOutbox,
  sanitizeChannelBridgeOutbox,
  sendDurableChannelMessage,
  type ChannelBridgeOutboxEntry,
  type ChannelBridgeOutboxStorage,
} from '../lib/channelBridgeOutbox'

function memoryStorage(initial: ChannelBridgeOutboxEntry[] = []): ChannelBridgeOutboxStorage & {
  snapshot: () => ChannelBridgeOutboxEntry[]
} {
  let entries = structuredClone(initial)
  return {
    async load() { return structuredClone(entries) },
    async save(next) { entries = structuredClone(next) },
    snapshot() { return structuredClone(entries) },
  }
}

const config = { baseUrl: 'http://127.0.0.1:8790/' }
assert.equal(advanceChannelDeliveryState('processed', 'accepted'), 'processed', 'late transport ACK must not downgrade processed delivery')
const first = createChannelBridgeOutboxEntry({
  config,
  targetSessionId: 'claude-session-a',
  text: 'first durable prompt',
  chatId: 'chat-a',
  messageId: 'message-a',
  createdAt: '2026-08-22T00:00:00.000Z',
})
const second = createChannelBridgeOutboxEntry({
  config,
  targetSessionId: 'claude-session-a',
  text: 'second durable prompt',
  chatId: 'chat-a',
  messageId: 'message-b',
  createdAt: '2026-08-22T00:00:01.000Z',
})
const otherSession = createChannelBridgeOutboxEntry({
  config,
  targetSessionId: 'claude-session-b',
  text: 'different target',
  messageId: 'message-c',
  createdAt: '2026-08-22T00:00:02.000Z',
})

assert.deepEqual(
  sanitizeChannelBridgeOutbox([first, first, { nope: true }]).map((entry) => entry.messageId),
  ['message-a'],
  'outbox parsing must reject malformed rows and de-duplicate stable message ids',
)

const storage = memoryStorage()
await enqueueChannelBridgeMessage(storage, first)
await enqueueChannelBridgeMessage(storage, first)
await enqueueChannelBridgeMessage(storage, second)
await enqueueChannelBridgeMessage(storage, otherSession)
assert.deepEqual(
  storage.snapshot().map((entry) => entry.messageId),
  ['message-a', 'message-b', 'message-c'],
  'enqueue must be idempotent without disturbing FIFO order',
)

const failed = await flushChannelBridgeOutbox(storage, config, 'claude-session-a', {
  deliver: async () => { throw new Error('bridge offline') },
})
assert.equal(failed.delivered.length, 0)
assert.match(failed.error?.message ?? '', /bridge offline/)
assert.deepEqual(
  storage.snapshot().map((entry) => [entry.messageId, entry.attempts]),
  [['message-a', 1], ['message-b', 0], ['message-c', 0]],
  'a failed head delivery must remain durable and block later messages for that target',
)

const deliveredIds: string[] = []
const replayed = await flushChannelBridgeOutbox(storage, config, 'claude-session-a', {
  deliver: async (_deliveryConfig, entry) => {
    deliveredIds.push(entry.messageId)
    return {
      message_id: entry.messageId,
      chat_id: entry.chatId ?? 'assigned-chat',
      status: entry.messageId === 'message-a' ? 'duplicate' : 'accepted',
      target_session_id: entry.targetSessionId,
    }
  },
})
assert.deepEqual(deliveredIds, ['message-a', 'message-b'])
assert.deepEqual(replayed.delivered.map((delivery) => delivery.entry.messageId), ['message-a', 'message-b'])
assert.deepEqual(
  storage.snapshot().map((entry) => entry.messageId),
  ['message-c'],
  'accepted and duplicate acknowledgements must both retire their durable rows',
)

const nativeSessionId = 'shared-native-session'
const personalOwner = 'claude@personal:shared-native-session'
const workOwner = 'claude@work:shared-native-session'
const scopedEntry = (messageId: string, ownerKey?: string) => createChannelBridgeOutboxEntry({
  config, targetSessionId: nativeSessionId, ownerKey, messageId, text: messageId,
  createdAt: '2026-11-13T00:00:00.000Z',
})
const legacy = scopedEntry('legacy-message')
const personal = scopedEntry('personal-message', personalOwner)
const work = scopedEntry('work-message', workOwner)
assert.deepEqual(
  sanitizeChannelBridgeOutbox([personal, { ...personal, messageId: 'invalid-owner', ownerKey: 1 }]).map(entry => [entry.messageId, entry.ownerKey]),
  [['personal-message', personalOwner]],
  'stored owners survive parsing and malformed owner fields are rejected',
)
const ownedStorage = memoryStorage([legacy, personal, work])
const failedPersonal = await flushChannelBridgeOutbox(ownedStorage, config, nativeSessionId, {
  ownerKey: personalOwner,
  deliver: async () => { throw new Error('personal bridge offline') },
})
assert.equal(failedPersonal.delivered.length, 0)
assert.deepEqual(ownedStorage.snapshot().map(entry => [entry.messageId, entry.attempts]), [
  ['legacy-message', 0], ['personal-message', 1], ['work-message', 0],
])

const deliverOwned = (ownerKey?: string) => async (_config: typeof config, entry: ChannelBridgeOutboxEntry) => {
  assert.equal(entry.ownerKey, ownerKey)
  assert.equal(entry.targetSessionId, nativeSessionId, 'local ownership cannot replace the native RPC target')
  return { message_id: entry.messageId, chat_id: 'assigned-chat', status: 'accepted' as const, target_session_id: entry.targetSessionId }
}
const workReplay = await flushChannelBridgeOutbox(ownedStorage, config, nativeSessionId, {
  ownerKey: workOwner, deliver: deliverOwned(workOwner),
})
assert.deepEqual(workReplay.delivered.map(delivery => delivery.entry.messageId), ['work-message'])
assert.deepEqual(ownedStorage.snapshot().map(entry => entry.messageId), ['legacy-message', 'personal-message'],
  'a scoped replay cannot consume legacy rows or another account sharing the native id')
const legacyReplay = await flushChannelBridgeOutbox(ownedStorage, config, nativeSessionId, { deliver: deliverOwned() })
assert.deepEqual(legacyReplay.delivered.map(delivery => delivery.entry.messageId), ['legacy-message'])
assert.deepEqual(ownedStorage.snapshot().map(entry => entry.messageId), ['personal-message'],
  'legacy callers continue replaying unscoped rows but cannot consume scoped rows')
const personalReplay = await flushChannelBridgeOutbox(ownedStorage, config, nativeSessionId, {
  ownerKey: personalOwner, deliver: deliverOwned(personalOwner),
})
assert.equal(personalReplay.delivered[0].entry.attempts, 2)
assert.equal(ownedStorage.snapshot().length, 0)

// The send helper must apply the same owner fence during its immediate flush.
const immediateStorage = memoryStorage([legacy, work])
const sentBodies: Record<string, unknown>[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  sentBodies.push(body)
  return new Response(JSON.stringify({ message_id: body.message_id, chat_id: 'assigned-chat', status: 'accepted', target_session_id: body.target_session_id }))
}) as typeof fetch
try {
  const sent = await sendDurableChannelMessage(immediateStorage, config, {
    targetSessionId: nativeSessionId, ownerKey: personalOwner, text: 'new personal prompt', messageId: 'personal-immediate',
  })
  assert.equal(sent.queued, false)
  assert.equal(sent.entry.ownerKey, personalOwner)
  assert.deepEqual(sentBodies.map(body => [body.message_id, body.target_session_id]), [['personal-immediate', nativeSessionId]])
  assert.equal('ownerKey' in sentBodies[0], false, 'owner keys are local replay fences, not native bridge payloads')
  assert.deepEqual(immediateStorage.snapshot().map(entry => [entry.messageId, entry.attempts]), [['legacy-message', 0], ['work-message', 0]])
} finally {
  globalThis.fetch = originalFetch
}

console.log('channel bridge durability smoke passed (FIFO, retry, scoped replay, legacy compatibility and native RPC identity)')

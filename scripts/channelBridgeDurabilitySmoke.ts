import assert from 'node:assert/strict'
import { advanceChannelDeliveryState } from '../lib/channelBridge'
import {
  createChannelBridgeOutboxEntry,
  enqueueChannelBridgeMessage,
  flushChannelBridgeOutbox,
  sanitizeChannelBridgeOutbox,
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

console.log('channel bridge durability smoke passed')

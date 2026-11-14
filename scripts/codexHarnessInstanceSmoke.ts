import assert from 'node:assert/strict'
import type { CodexNotification } from '../lib/codexProtocol'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

let instance = 'codex-primary'
const clients = new Map<string, {
  notifications: Set<(notification: CodexNotification) => void>
  disconnects: Set<() => void>
  subscribe: (listener: (notification: CodexNotification) => void) => void
  subscribeDisconnect: (listener: () => void) => void
}>()
function clientFor(id: string) {
  let client = clients.get(id)
  if (!client) {
    const notifications = new Set<(notification: CodexNotification) => void>()
    const disconnects = new Set<() => void>()
    client = {
      notifications, disconnects,
      subscribe: listener => { notifications.add(listener) },
      subscribeDisconnect: listener => { disconnects.add(listener) },
    }
    clients.set(id, client)
  }
  return client
}
mock.module('../lib/codexClient', () => ({ getCodexClient: () => clientFor(instance) }))
mock.module('../lib/providerInstances', () => ({ currentProviderInstanceId: () => instance }))
const { subscribeToCodexEvents } = await import('../lib/codexHarness')

const first = subscribeToCodexEvents({ threadId: 'shared-thread' })
await first.events.next() // connected
instance = 'codex-secondary'
const second = subscribeToCodexEvents({ threadId: 'shared-thread' })
await second.events.next()

try {
  // The second account's turn must receive its first delta before completion,
  // even if diagnostics or a previous turn initialized another account first.
  const delta = {
    method: 'item/agentMessage/delta',
    params: { threadId: 'shared-thread', turnId: 'turn-2', itemId: 'answer', delta: 'Live reply' },
  } satisfies CodexNotification
  for (const listener of clientFor(instance).notifications) listener(delta)
  const missing = Symbol('missing live delta')
  const received = await Promise.race([
    second.events.next(),
    new Promise<typeof missing>(resolve => setTimeout(() => resolve(missing), 100)),
  ])
  assert.notEqual(received, missing, 'Codex live delta was lost after switching provider instances')
  if (received === missing) throw new Error('missing live delta')
  assert.deepEqual(received.value, { type: 'notification', notification: delta, threadId: 'shared-thread' })

  const primaryDelta = { ...delta, params: { ...delta.params, delta: 'Primary reply' } }
  for (const listener of clientFor('codex-primary').notifications) listener(primaryDelta)
  assert.deepEqual((await first.events.next()).value, { type: 'notification', notification: primaryDelta, threadId: 'shared-thread' })

  const reattached = subscribeToCodexEvents({ threadId: 'shared-thread' })
  reattached.close()
  assert.equal(clientFor(instance).notifications.size, 1, 'reuse one native subscription per instance')
  for (const listener of clientFor(instance).disconnects) listener()
  assert.deepEqual((await second.events.next()).value, { type: 'disconnected' })
  for (const listener of clientFor('codex-primary').notifications) listener(primaryDelta)
  assert.deepEqual((await first.events.next()).value, { type: 'notification', notification: primaryDelta, threadId: 'shared-thread' })
} finally {
  first.close()
  second.close()
}
console.log('Codex instance live notification smoke passed')

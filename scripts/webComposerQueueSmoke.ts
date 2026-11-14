import assert from 'node:assert/strict'

import {
  WebComposerQueueStore,
  type WebComposerQueueAsyncStore,
  type WebComposerQueueExclusive,
  type WebComposerQueueSnapshot,
} from '../lib/webComposerQueue'

type Entry = { id: string; text: string; large?: boolean }

const isEntry = (value: unknown): value is Entry => Boolean(
  value
  && typeof value === 'object'
  && typeof (value as Partial<Entry>).id === 'string'
  && typeof (value as Partial<Entry>).text === 'string',
)

class MemoryStorage {
  readonly values = new Map<string, string>()
  failWrites = false

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded')
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function memoryAsyncStore(initial?: WebComposerQueueSnapshot<Entry>): {
  adapter: WebComposerQueueAsyncStore<Entry>
  read: () => WebComposerQueueSnapshot<Entry> | undefined
} {
  let snapshot = initial
  return {
    adapter: {
      read: async () => snapshot,
      write: async (next) => {
        if (!snapshot || snapshot.revision <= next.revision) snapshot = structuredClone(next)
      },
    },
    read: () => snapshot,
  }
}

function sharedExclusive(): WebComposerQueueExclusive {
  const tails = new Map<string, Promise<void>>()
  return async (name, task) => {
    const previous = tails.get(name) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    tails.set(name, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (tails.get(name) === tail) tails.delete(name)
    }
  }
}

let now = 1_000
const local = new MemoryStorage()
const asyncMemory = memoryAsyncStore()
const store = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: local,
  asyncStore: asyncMemory.adapter,
  shouldInline: (entries) => !entries.some((entry) => entry.large),
  now: () => now,
  origin: 'smoke-a',
})

assert.deepEqual(store.hydrateSync(), { entries: [], ready: false, durability: 'saving' })
assert.deepEqual(await store.hydrateAsync(), { entries: [], ready: true, durability: 'memory-only' })

const smallEntries = [{ id: 'small', text: 'saved synchronously' }]
const smallCommit = store.commit(smallEntries)
assert.equal(smallCommit.durability, 'durable')
assert.equal(await smallCommit.settled, 'durable')
assert.deepEqual(asyncMemory.read()?.entries, smallEntries)

const restoredSmall = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: local,
  asyncStore: asyncMemory.adapter,
  shouldInline: () => true,
  now: () => now,
  origin: 'smoke-b',
})
assert.deepEqual(restoredSmall.hydrateSync(), { entries: smallEntries, ready: true, durability: 'durable' })

now += 1
const largeEntries = [{ id: 'large', text: 'indexeddb payload', large: true }]
const largeCommit = store.commit(largeEntries)
assert.equal(largeCommit.durability, 'saving')
assert.equal(await largeCommit.settled, 'durable')
const restoredLarge = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: local,
  asyncStore: asyncMemory.adapter,
  shouldInline: (entries) => !entries.some((entry) => entry.large),
  now: () => now,
  origin: 'smoke-c',
})
assert.deepEqual(restoredLarge.hydrateSync(), { entries: [], ready: false, durability: 'saving' })
assert.deepEqual(await restoredLarge.hydrateAsync(), { entries: largeEntries, ready: true, durability: 'durable' })

const quotaStorage = new MemoryStorage()
quotaStorage.failWrites = true
const quotaAsyncMemory = memoryAsyncStore()
const quotaStore = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: quotaStorage,
  asyncStore: quotaAsyncMemory.adapter,
  now: () => now,
  origin: 'smoke-quota',
})
const quotaCommit = quotaStore.commit(smallEntries)
assert.equal(quotaCommit.durability, 'saving')
assert.equal(await quotaCommit.settled, 'durable')
assert.deepEqual(quotaAsyncMemory.read()?.entries, smallEntries)

let releaseStaleRead: ((snapshot: WebComposerQueueSnapshot<Entry>) => void) | undefined
const staleSnapshot = asyncMemory.read()!
const delayedStore = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: new MemoryStorage(),
  asyncStore: {
    read: () => new Promise((resolve) => { releaseStaleRead = resolve }),
    write: async () => {},
  },
  now: () => now + 10,
  origin: 'smoke-race',
})
delayedStore.hydrateSync()
const delayedHydration = delayedStore.hydrateAsync()
const newestEntries = [{ id: 'newest', text: 'typed while storage was loading' }]
assert.equal(delayedStore.commit(newestEntries).durability, 'durable')
releaseStaleRead!(staleSnapshot)
assert.equal(await delayedHydration, null, 'stale async hydration must not overwrite a newer queue commit')

const failedStore = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: quotaStorage,
  asyncStore: {
    read: async () => { throw new Error('unavailable') },
    write: async () => { throw new Error('unavailable') },
  },
  now: () => now,
  origin: 'smoke-failed',
})
const failedCommit = failedStore.commit(smallEntries)
assert.equal(failedCommit.durability, 'saving')
assert.equal(await failedCommit.settled, 'memory-only')

const legacyStorage = new MemoryStorage()
legacyStorage.setItem('agentViewer:composerQueue:v1', JSON.stringify({ version: 1, entries: smallEntries }))
const legacyAsyncMemory = memoryAsyncStore()
const legacyStore = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: legacyStorage,
  asyncStore: legacyAsyncMemory.adapter,
  now: () => now,
  origin: 'smoke-legacy',
})
assert.deepEqual(legacyStore.hydrateSync().entries, smallEntries)
await Promise.resolve()
assert.equal(legacyStorage.getItem('agentViewer:composerQueue:v2') !== null, true)

const sharedLocal = new MemoryStorage()
const sharedAsync = memoryAsyncStore()
const exclusive = sharedExclusive()
const queuedForTwoTabs = [
  { id: 'shared-first', text: 'send once' },
  { id: 'shared-second', text: 'send later' },
]
const seeder = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: sharedLocal,
  asyncStore: sharedAsync.adapter,
  exclusive,
  shouldInline: () => false,
  now: () => now + 20,
  origin: 'smoke-seeder',
})
await seeder.commit(queuedForTwoTabs).settled
const tabA = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: sharedLocal,
  asyncStore: sharedAsync.adapter,
  exclusive,
  shouldInline: () => false,
  now: () => now + 21,
  origin: 'smoke-tab-a',
})
const tabB = new WebComposerQueueStore<Entry>({
  isEntry,
  getEntryId: (entry) => entry.id,
  localStorage: sharedLocal,
  asyncStore: sharedAsync.adapter,
  exclusive,
  shouldInline: () => false,
  now: () => now + 22,
  origin: 'smoke-tab-b',
})
tabA.hydrateSync()
tabB.hydrateSync()
const claims = await Promise.all([
  tabA.claim('codex:shared-session', 'shared-first'),
  tabB.claim('codex:shared-session', 'shared-first'),
])
assert.equal(claims.filter((claim) => claim.claimed).length, 1, 'two tabs must produce exactly one queue consumer')
assert.deepEqual(sharedAsync.read()?.entries, [queuedForTwoTabs[1]])
assert.deepEqual(claims.find((claim) => !claim.claimed)?.entries, [queuedForTwoTabs[1]])

console.log('Web composer queue persistence, fallback, migration, hydration races, and cross-tab claims passed')

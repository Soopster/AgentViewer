export type WebComposerQueueDurability = 'durable' | 'saving' | 'memory-only'

export type WebComposerQueueSnapshot<T> = {
  version: 2
  revision: string
  external: boolean
  entries: T[]
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type WebComposerQueueAsyncStore<T> = {
  read: () => Promise<unknown>
  write: (snapshot: WebComposerQueueSnapshot<T>) => Promise<void>
}

type QueueStoreOptions<T> = {
  isEntry: (value: unknown) => value is T
  getEntryId: (entry: T) => string
  localStorage?: StorageLike
  asyncStore?: WebComposerQueueAsyncStore<T>
  exclusive?: WebComposerQueueExclusive
  shouldInline?: (entries: T[]) => boolean
  now?: () => number
  origin?: string
}

type HydratedQueue<T> = {
  entries: T[]
  ready: boolean
  durability: WebComposerQueueDurability
}

export type QueueCommit = {
  durability: WebComposerQueueDurability
  settled: Promise<WebComposerQueueDurability>
}

export type WebComposerQueueClaim<T> = {
  claimed: boolean
  entries: T[]
  durability: WebComposerQueueDurability
}

export type WebComposerQueueExclusive = <T>(name: string, task: () => Promise<T>) => Promise<T>

const LOCAL_KEY = 'agentViewer:composerQueue:v2'
const LEGACY_LOCAL_KEY = 'agentViewer:composerQueue:v1'
const DATABASE_NAME = 'agent-viewer-composer'
const DATABASE_VERSION = 1
const OBJECT_STORE = 'queue'
const ACTIVE_QUEUE_KEY = 'active'

function randomOrigin(): string {
  const randomUuid = globalThis.crypto?.randomUUID
  if (typeof randomUuid === 'function') return randomUuid.call(globalThis.crypto)
  return `${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function compareRevision(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

const runBrowserExclusive: WebComposerQueueExclusive = async (name, task) => {
  let locks: LockManager | undefined
  try { locks = typeof navigator === 'undefined' ? undefined : navigator.locks } catch { locks = undefined }
  if (!locks) return task()
  return locks.request(name, { mode: 'exclusive' }, task)
}

function normalizeSnapshot<T>(value: unknown, isEntry: (entry: unknown) => entry is T): WebComposerQueueSnapshot<T> | null {
  if (!value || typeof value !== 'object') return null
  const snapshot = value as Partial<WebComposerQueueSnapshot<T>>
  if (snapshot.version !== 2 || typeof snapshot.revision !== 'string' || !snapshot.revision) return null
  if (typeof snapshot.external !== 'boolean' || !Array.isArray(snapshot.entries)) return null
  const entries = snapshot.entries.filter(isEntry)
  if (entries.length !== snapshot.entries.length) return null
  return { version: 2, revision: snapshot.revision, external: snapshot.external, entries }
}

function parseStoredSnapshot<T>(raw: string | null, isEntry: (entry: unknown) => entry is T): WebComposerQueueSnapshot<T> | null {
  if (!raw) return null
  try {
    return normalizeSnapshot(JSON.parse(raw), isEntry)
  } catch {
    return null
  }
}

function parseLegacyEntries<T>(raw: string | null, isEntry: (entry: unknown) => entry is T): T[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    const entries = parsed.entries.filter(isEntry)
    return entries.length === parsed.entries.length ? entries : null
  } catch {
    return null
  }
}

function openComposerQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Unable to open composer queue database'))
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

let composerQueueDatabasePromise: Promise<IDBDatabase> | null = null

function defaultAsyncStore<T>(): WebComposerQueueAsyncStore<T> {
  const database = () => {
    composerQueueDatabasePromise ??= openComposerQueueDatabase().catch((error) => {
      composerQueueDatabasePromise = null
      throw error
    })
    return composerQueueDatabasePromise
  }
  return {
    async read() {
      const db = await database()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(OBJECT_STORE, 'readonly')
        const request = transaction.objectStore(OBJECT_STORE).get(ACTIVE_QUEUE_KEY)
        request.onerror = () => reject(request.error ?? new Error('Unable to read composer queue'))
        request.onsuccess = () => resolve(request.result)
      })
    },
    async write(snapshot) {
      const db = await database()
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(OBJECT_STORE, 'readwrite')
        const store = transaction.objectStore(OBJECT_STORE)
        const readRequest = store.get(ACTIVE_QUEUE_KEY)
        readRequest.onerror = () => reject(readRequest.error ?? new Error('Unable to compare composer queue revision'))
        readRequest.onsuccess = () => {
          const current = readRequest.result as Partial<WebComposerQueueSnapshot<T>> | undefined
          if (typeof current?.revision !== 'string' || compareRevision(current.revision, snapshot.revision) <= 0) {
            store.put({ ...snapshot, external: false }, ACTIVE_QUEUE_KEY)
          }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to write composer queue'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Composer queue write was aborted'))
      })
    },
  }
}

export class WebComposerQueueStore<T> {
  private readonly isEntry: (value: unknown) => value is T
  private readonly getEntryId: (entry: T) => string
  private readonly localStorage?: StorageLike
  private readonly asyncStore?: WebComposerQueueAsyncStore<T>
  private readonly shouldInline: (entries: T[]) => boolean
  private readonly exclusive: WebComposerQueueExclusive
  private readonly now: () => number
  private readonly origin: string
  private revisionCounter = 0
  private lastRevisionTime = 0
  private currentRevision = ''
  private currentExternal = false
  private currentEntries: T[] = []
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: QueueStoreOptions<T>) {
    this.isEntry = options.isEntry
    this.getEntryId = options.getEntryId
    this.localStorage = options.localStorage
    this.asyncStore = options.asyncStore
    this.shouldInline = options.shouldInline ?? (() => true)
    this.exclusive = options.exclusive ?? (async (_name, task) => task())
    this.now = options.now ?? Date.now
    this.origin = options.origin ?? randomOrigin()
  }

  hydrateSync(): HydratedQueue<T> {
    try {
      const snapshot = parseStoredSnapshot(this.localStorage?.getItem(LOCAL_KEY) ?? null, this.isEntry)
      if (snapshot) {
        this.currentRevision = snapshot.revision
        this.currentExternal = snapshot.external
        this.currentEntries = snapshot.entries
        return {
          entries: snapshot.entries,
          ready: !snapshot.external,
          durability: snapshot.external ? 'saving' : 'durable',
        }
      }
      const legacy = parseLegacyEntries(this.localStorage?.getItem(LEGACY_LOCAL_KEY) ?? null, this.isEntry)
      if (legacy) {
        const committed = this.commit(legacy)
        return { entries: legacy, ready: true, durability: committed.durability }
      }
    } catch {
      // Browser storage may be disabled. IndexedDB hydration below can still recover.
    }
    return { entries: [], ready: false, durability: 'saving' }
  }

  async hydrateAsync(): Promise<HydratedQueue<T> | null> {
    if (!this.asyncStore) {
      return { entries: this.currentEntries, ready: true, durability: this.currentRevision ? 'durable' : 'memory-only' }
    }
    try {
      const snapshot = normalizeSnapshot(await this.asyncStore.read(), this.isEntry)
      if (!snapshot) {
        return {
          entries: this.currentEntries,
          ready: true,
          durability: this.currentRevision && !this.currentExternal ? 'durable' : 'memory-only',
        }
      }
      const comparison = compareRevision(snapshot.revision, this.currentRevision)
      if (comparison < 0 || (comparison === 0 && !this.currentExternal)) return null
      this.currentRevision = snapshot.revision
      this.currentExternal = false
      this.currentEntries = snapshot.entries
      this.writeLocalSnapshot({ ...snapshot, external: !this.shouldInline(snapshot.entries) })
      return { entries: snapshot.entries, ready: true, durability: 'durable' }
    } catch {
      return {
        entries: this.currentEntries,
        ready: true,
        durability: this.currentRevision && !this.currentExternal ? 'durable' : 'memory-only',
      }
    }
  }

  commit(entries: T[]): QueueCommit {
    this.revisionCounter += 1
    const hydratedRevisionTime = Number.parseInt(this.currentRevision.slice(0, 13), 10)
    this.lastRevisionTime = Math.max(
      this.lastRevisionTime,
      Number.isFinite(hydratedRevisionTime) ? hydratedRevisionTime : 0,
      this.now(),
    )
    const revision = `${String(this.lastRevisionTime).padStart(13, '0')}:${this.origin}:${String(this.revisionCounter).padStart(8, '0')}`
    const inline = this.shouldInline(entries)
    const snapshot: WebComposerQueueSnapshot<T> = { version: 2, revision, external: !inline, entries }
    this.currentRevision = revision
    this.currentExternal = !inline
    this.currentEntries = entries
    const localDurable = this.writeLocalSnapshot(snapshot)

    if (!this.asyncStore) {
      const durability = localDurable && inline ? 'durable' : 'memory-only'
      return { durability, settled: Promise.resolve(durability) }
    }

    let asyncWriteSucceeded = false
    const write = this.writeChain
      .catch(() => {})
      .then(() => this.asyncStore!.write({ ...snapshot, external: false }))
      .then(() => { asyncWriteSucceeded = true })
    this.writeChain = write
    const settled = write.then<WebComposerQueueDurability>(() => {
      if (this.currentRevision === revision) this.currentExternal = false
      return 'durable'
    }).catch<WebComposerQueueDurability>(() => localDurable && inline ? 'durable' : 'memory-only')
    const durability = localDurable && inline ? 'durable' : 'saving'
    void settled.finally(() => {
      if (!asyncWriteSucceeded) return
      try { this.localStorage?.removeItem(LEGACY_LOCAL_KEY) } catch { /* best-effort migration cleanup */ }
    })
    return { durability, settled }
  }

  /**
   * Atomically claim one queued entry across browser tabs before provider I/O.
   * The winner persists the dequeue while holding a per-session Web Lock. A
   * loser receives the authoritative remaining queue and must not send.
   */
  claim(scope: string, entryId: string): Promise<WebComposerQueueClaim<T>> {
    return this.exclusive(`agentViewer:composerQueue:claim:${scope}`, async () => {
      const latest = await this.readLatestSnapshot()
      if (latest) this.applySnapshot(latest)
      if (!this.currentEntries.some((entry) => this.getEntryId(entry) === entryId)) {
        return {
          claimed: false,
          entries: this.currentEntries,
          durability: this.currentRevision && !this.currentExternal ? 'durable' : 'memory-only',
        }
      }
      const remaining = this.currentEntries.filter((entry) => this.getEntryId(entry) !== entryId)
      const commit = this.commit(remaining)
      // A full localStorage snapshot is synchronous and shared across tabs, so
      // it is already sufficient to release the lock and start provider I/O.
      // Large/external snapshots wait for IndexedDB before the claim succeeds.
      const durability = commit.durability === 'durable' ? 'durable' : await commit.settled
      return { claimed: true, entries: remaining, durability }
    })
  }

  private async readLatestSnapshot(): Promise<WebComposerQueueSnapshot<T> | null> {
    await this.writeChain.catch(() => {})
    const candidates: WebComposerQueueSnapshot<T>[] = []
    if (this.currentRevision) {
      candidates.push({
        version: 2,
        revision: this.currentRevision,
        external: this.currentExternal,
        entries: this.currentEntries,
      })
    }
    try {
      const local = parseStoredSnapshot(this.localStorage?.getItem(LOCAL_KEY) ?? null, this.isEntry)
      if (local) candidates.push(local)
    } catch { /* storage may be unavailable */ }
    if (this.asyncStore) {
      try {
        const stored = normalizeSnapshot(await this.asyncStore.read(), this.isEntry)
        if (stored) candidates.push(stored)
      } catch { /* the local or in-memory snapshot can still be authoritative */ }
    }
    let latest: WebComposerQueueSnapshot<T> | null = null
    for (const candidate of candidates) {
      if (!latest || compareRevision(candidate.revision, latest.revision) > 0) {
        latest = candidate
      } else if (candidate.revision === latest.revision && latest.external && !candidate.external) {
        latest = candidate
      }
    }
    return latest
  }

  private applySnapshot(snapshot: WebComposerQueueSnapshot<T>): void {
    this.currentRevision = snapshot.revision
    this.currentExternal = snapshot.external
    this.currentEntries = snapshot.entries
  }

  private writeLocalSnapshot(snapshot: WebComposerQueueSnapshot<T>): boolean {
    if (!this.localStorage) return false
    try {
      const localSnapshot = snapshot.external ? { ...snapshot, entries: [] } : snapshot
      this.localStorage.setItem(LOCAL_KEY, JSON.stringify(localSnapshot))
      return true
    } catch {
      return false
    }
  }
}

export function createDefaultWebComposerQueueStore<T>(
  isEntry: (value: unknown) => value is T,
  shouldInline: (entries: T[]) => boolean,
  getEntryId: (entry: T) => string,
): WebComposerQueueStore<T> {
  let browserStorage: Storage | undefined
  try {
    browserStorage = typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    browserStorage = undefined
  }
  return new WebComposerQueueStore({
    isEntry,
    getEntryId,
    localStorage: browserStorage,
    asyncStore: typeof window === 'undefined' ? undefined : defaultAsyncStore<T>(),
    exclusive: runBrowserExclusive,
    shouldInline,
  })
}

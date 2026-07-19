import type { ThreadedMessage } from '../../lib/threading'
import type { TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import type { ProviderSelection, Session, SessionInfo, SessionMessage } from '../../lib/types'

export type SessionDetailPayload = {
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
  transcriptCards: TuiTranscriptCard[]
}

type ThreadingClientCache = {
  threadedMessages: ThreadedMessage[]
  // LRU card cache keyed by `${density}|${showToolCalls ? 1 : 0}`. Kept tiny
  // because each entry can contain one formatted card per transcript message.
  cardsByVariant: Map<string, TuiTranscriptCard[]>
}

type Pending =
  | {
      kind: 'detail'
      sessionKey: string
      cardsVariant: string
      resolve: (payload: SessionDetailPayload) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'format'
      resolve: (cards: TuiTranscriptCard[]) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'sessions'
      resolve: (sessions: Session[]) => void
      reject: (error: Error) => void
    }

type WorkerResponse =
  | {
      id: number
      ok: true
      info: SessionInfo | null
      rawMessages: SessionMessage[]
      threadedMessages: ThreadedMessage[]
      transcriptCards: TuiTranscriptCard[]
      rawPrefix: number
      threadedPrefix: number
      cardsPrefix: number
    }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: true; sessions: Session[] }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()
// Holds the recent session neighbourhood. With tabs enabled users commonly
// switch between 4-8 sessions; a cap of 2 evicted almost everything on the
// third switch, forcing full main-thread card rebuilds on revisit.
const THREADING_CACHE_LIMIT = 10
const CARD_VARIANT_CACHE_LIMIT = 4
const threadingCacheByKey = new Map<string, ThreadingClientCache>()

// What the previous detail response for each session delivered to callers.
// postMessage cloning mints fresh objects every read, which would miss every
// identity-keyed cache downstream (App's WeakMaps, TranscriptCard memo, raw
// message fingerprint cache). The worker reports how many leading entries are
// unchanged since its previous response (identity prefixes); we splice our own
// previously-delivered objects back in for that prefix so unchanged content
// keeps its main-thread identity across polls.
type LastDeliveredDetail = {
  raw: SessionMessage[]
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  cardsVariant: string
}
const lastDeliveredByKey = new Map<string, LastDeliveredDetail>()

function touchLastDelivered(key: string, value: LastDeliveredDetail): void {
  if (lastDeliveredByKey.has(key)) lastDeliveredByKey.delete(key)
  lastDeliveredByKey.set(key, value)
  while (lastDeliveredByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = lastDeliveredByKey.keys().next().value
    if (oldestKey === undefined) break
    lastDeliveredByKey.delete(oldestKey)
  }
}

// Replace the unchanged prefix of a fresh-cloned array with the objects we
// handed out last time. Falls back to the fresh array whenever the previous
// delivery is missing or the prefix is empty — the response always carries the
// full content, so reconciliation is purely an identity optimization.
function spliceDelivered<T>(prev: T[] | undefined, fresh: T[], prefix: number): T[] {
  if (!prev || prefix <= 0) return fresh
  const n = Math.min(prefix, prev.length, fresh.length)
  if (n <= 0) return fresh
  if (n === fresh.length && prev.length === fresh.length) return prev
  const out = fresh.slice()
  for (let i = 0; i < n; i++) out[i] = prev[i]
  return out
}

function cacheKey(session: Session): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function variantKey(density: TuiDensity, showToolCalls: boolean): string {
  return `${density}|${showToolCalls ? 1 : 0}`
}

function rememberCardsVariant(
  cache: ThreadingClientCache,
  density: TuiDensity,
  showToolCalls: boolean,
  cards: TuiTranscriptCard[],
): void {
  const key = variantKey(density, showToolCalls)
  if (cache.cardsByVariant.has(key)) cache.cardsByVariant.delete(key)
  cache.cardsByVariant.set(key, cards)
  while (cache.cardsByVariant.size > CARD_VARIANT_CACHE_LIMIT) {
    const oldestKey = cache.cardsByVariant.keys().next().value
    if (oldestKey === undefined) break
    cache.cardsByVariant.delete(oldestKey)
  }
}

function touchThreadingCache(key: string, cache: ThreadingClientCache): void {
  if (threadingCacheByKey.has(key)) threadingCacheByKey.delete(key)
  threadingCacheByKey.set(key, cache)
  while (threadingCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = threadingCacheByKey.keys().next().value
    if (oldestKey === undefined) break
    threadingCacheByKey.delete(oldestKey)
  }
}

function ensureWorker(): Worker {
  if (worker) return worker
  const url = new URL('./threadingWorker.ts', import.meta.url)
  const w = new Worker(url.href, { type: 'module' })
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (!data.ok) {
      entry.reject(new Error(data.error))
      return
    }
    if (entry.kind === 'detail' && 'rawMessages' in data) {
      const prev = lastDeliveredByKey.get(entry.sessionKey)
      const variantMatches = prev?.cardsVariant === entry.cardsVariant
      const rawMessages = spliceDelivered(prev?.raw, data.rawMessages, data.rawPrefix ?? 0)
      const threadedMessages = spliceDelivered(prev?.threaded, data.threadedMessages, data.threadedPrefix ?? 0)
      const transcriptCards = spliceDelivered(
        variantMatches ? prev?.cards : undefined,
        data.transcriptCards,
        data.cardsPrefix ?? 0,
      )
      touchLastDelivered(entry.sessionKey, {
        raw: rawMessages,
        threaded: threadedMessages,
        cards: transcriptCards,
        cardsVariant: entry.cardsVariant,
      })
      entry.resolve({
        info: data.info,
        rawMessages,
        threadedMessages,
        transcriptCards,
      })
    } else if (entry.kind === 'format' && 'transcriptCards' in data) {
      entry.resolve(data.transcriptCards)
    } else if (entry.kind === 'sessions' && 'sessions' in data) {
      entry.resolve(data.sessions)
    }
  }
  w.onerror = (event) => {
    const message = typeof event === 'object' && event && 'message' in event
      ? String((event as { message?: unknown }).message ?? 'threading worker error')
      : 'threading worker error'
    const err = new Error(message)
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

/**
 * List sessions in the transcript worker so provider SDKs are loaded in one
 * isolate. Pi's SDK has a large fixed resident cost; listing in the main TUI
 * and reading detail in this worker otherwise loads a full copy in each.
 */
export function readTuiSessionsAsync(provider: ProviderSelection): Promise<Session[]> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<Session[]>((resolve, reject) => {
    pending.set(id, { kind: 'sessions', resolve, reject })
    w.postMessage({ kind: 'sessions', id, provider })
  })
}

/**
 * Read a session from disk/SDK, thread it, and format its cards — all inside
 * the worker. Only the finished payload crosses back, so the read +
 * normalize/sort and threading CPU never runs on the main render thread. The
 * App's mtime guard already skips this call when the session file is unchanged;
 * the worker's own incremental-threading + card caches handle the rest.
 */
export function readAndBuildTranscriptAsync(
  session: Session,
  density: TuiDensity,
  showToolCalls: boolean,
): Promise<SessionDetailPayload> {
  const key = cacheKey(session)
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<SessionDetailPayload>((resolve, reject) => {
    pending.set(id, {
      kind: 'detail',
      sessionKey: key,
      cardsVariant: variantKey(density, showToolCalls),
      resolve: (payload) => {
        const cacheEntry = {
          threadedMessages: payload.threadedMessages,
          cardsByVariant: new Map<string, TuiTranscriptCard[]>(),
        }
        rememberCardsVariant(cacheEntry, density, showToolCalls, payload.transcriptCards)
        touchThreadingCache(key, cacheEntry)
        resolve(payload)
      },
      reject,
    })
    w.postMessage({ kind: 'detail', id, session, density, showToolCalls })
  })
}

/**
 * Re-format already-threaded messages with a new density / showToolCalls pair.
 * Used when the user toggles density or tool visibility. This avoids re-reading
 * disk and re-threading while keeping only the current formatted-card variant
 * resident on the main thread.
 */
export function formatTranscriptCardsAsync(
  session: Session,
  threaded: ThreadedMessage[],
  density: TuiDensity,
  showToolCalls: boolean,
): Promise<TuiTranscriptCard[]> {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)
  if (cached && cached.threadedMessages === threaded) {
    const variant = cached.cardsByVariant.get(variantKey(density, showToolCalls))
    if (variant) {
      touchThreadingCache(key, cached)
      return Promise.resolve(variant)
    }
  }

  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<TuiTranscriptCard[]>((resolve, reject) => {
    pending.set(id, {
      kind: 'format',
      resolve: (transcriptCards) => {
        // (Re)create the entry when it was evicted or holds a different
        // threaded identity — getTranscriptCardsSync compares identity against
        // the caller's `threaded`, so an entry keyed to anything else can never
        // serve the transcript this format was requested for. A fresher detail
        // read simply re-caches on its own resolve.
        const existing = threadingCacheByKey.get(key)
        const entry = existing && existing.threadedMessages === threaded
          ? existing
          : { threadedMessages: threaded, cardsByVariant: new Map<string, TuiTranscriptCard[]>() }
        rememberCardsVariant(entry, density, showToolCalls, transcriptCards)
        touchThreadingCache(key, entry)
        resolve(transcriptCards)
      },
      reject,
    })
    w.postMessage({ kind: 'format', id, session, threaded, density, showToolCalls })
  })
}

/**
 * Synchronous main-thread cache lookup. Returns the cards if they were already
 * formatted for this (session, threaded, density, showToolCalls); null otherwise.
 * Callers use this from a useMemo so render time sees the cached cards directly
 * without paying a Promise microtask + setState round-trip on cache hits.
 */
export function getTranscriptCardsSync(
  session: Session,
  threaded: ThreadedMessage[],
  density: TuiDensity,
  showToolCalls: boolean,
): TuiTranscriptCard[] | null {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)
  if (!cached || cached.threadedMessages !== threaded) return null
  return cached.cardsByVariant.get(variantKey(density, showToolCalls)) ?? null
}

import type { ThreadedMessage } from '../../lib/threading'
import type { TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import type { Session, SessionMessage } from '../../lib/types'
import { sameSessionMessageContent } from './messageFingerprint'

export type TranscriptPayload = {
  threadedMessages: ThreadedMessage[]
  transcriptCards: TuiTranscriptCard[]
}

type ThreadingClientCache = {
  messages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
  // LRU card cache keyed by `${density}|${showToolCalls ? 1 : 0}`. Kept tiny
  // because each entry can contain one formatted card per transcript message.
  cardsByVariant: Map<string, TuiTranscriptCard[]>
}

type Pending =
  | {
      kind: 'thread'
      resolve: (payload: TranscriptPayload) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'format'
      resolve: (cards: TuiTranscriptCard[]) => void
      reject: (error: Error) => void
    }

type WorkerResponse =
  | { id: number; ok: true; threadedMessages: ThreadedMessage[]; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()
// Matches the worker-side cap. Holds the active session plus one neighbour;
// switching back further re-runs threading from disk-sourced messages which
// is already fast and avoids a 3rd resident transcript.
const THREADING_CACHE_LIMIT = 2
const CARD_VARIANT_CACHE_LIMIT = 1
const threadingCacheByKey = new Map<string, ThreadingClientCache>()

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

function sameMessageSequence(messages: SessionMessage[], prevMessages: SessionMessage[]): boolean {
  if (messages.length !== prevMessages.length) return false
  for (let i = 0; i < messages.length; i++) {
    if (!sameSessionMessageContent(messages[i], prevMessages[i])) return false
  }
  return true
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
    if (entry.kind === 'thread' && 'threadedMessages' in data) {
      entry.resolve({ threadedMessages: data.threadedMessages, transcriptCards: data.transcriptCards })
    } else if (entry.kind === 'format') {
      entry.resolve(data.transcriptCards)
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

export function buildAndFormatTranscriptAsync(
  session: Session,
  messages: SessionMessage[],
  density: TuiDensity,
  showToolCalls: boolean,
): Promise<TranscriptPayload> {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)
  if (cached && sameMessageSequence(messages, cached.messages)) {
    const variant = cached.cardsByVariant.get(variantKey(density, showToolCalls))
    if (variant) {
      touchThreadingCache(key, cached)
      return Promise.resolve({
        threadedMessages: cached.threadedMessages,
        transcriptCards: variant,
      })
    }
  }

  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<TranscriptPayload>((resolve, reject) => {
    pending.set(id, {
      kind: 'thread',
      resolve: (payload) => {
        const existing = threadingCacheByKey.get(key)
        const cardsByVariant = existing?.threadedMessages === payload.threadedMessages
          ? existing.cardsByVariant
          : new Map<string, TuiTranscriptCard[]>()
        const cacheEntry = {
          messages,
          threadedMessages: payload.threadedMessages,
          cardsByVariant,
        }
        rememberCardsVariant(cacheEntry, density, showToolCalls, payload.transcriptCards)
        touchThreadingCache(key, cacheEntry)
        resolve(payload)
      },
      reject,
    })
    w.postMessage({ kind: 'thread', id, session, messages, density, showToolCalls })
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
        const existing = threadingCacheByKey.get(key)
        if (existing && existing.threadedMessages === threaded) {
          rememberCardsVariant(existing, density, showToolCalls, transcriptCards)
          touchThreadingCache(key, existing)
        }
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

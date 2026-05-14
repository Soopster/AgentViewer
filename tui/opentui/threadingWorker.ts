import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  stripToolCallBlocks,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../../lib/threading'
import { formatTranscriptCard, type TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import type { Session, SessionMessage } from '../../lib/types'

type ThreadRequest = {
  kind: 'thread'
  id: number
  session: Session
  messages: SessionMessage[]
  density: TuiDensity
  showToolCalls: boolean
}
type FormatRequest = {
  kind: 'format'
  id: number
  session: Session
  threaded: ThreadedMessage[]
  density: TuiDensity
  showToolCalls: boolean
}
type WorkerRequest = ThreadRequest | FormatRequest

type WorkerResponse =
  | { id: number; ok: true; threadedMessages: ThreadedMessage[]; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

const THREADING_CACHE_LIMIT = 8
const threadingCacheByKey = new Map<string, IncrementalThreadingCache>()

// Per-session card cache keyed by message uuid → density → card. Stable refs are
// returned across calls so the main thread's render-time identity checks bail out
// when density/showToolCalls flip back to a previously-seen value (proposal 2).
type CardCache = Map<string, Map<TuiDensity, TuiTranscriptCard>>
const cardCacheByKey = new Map<string, CardCache>()

function cacheKey(session: Session): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function touchThreadingCache(key: string, cache: IncrementalThreadingCache): void {
  if (threadingCacheByKey.has(key)) threadingCacheByKey.delete(key)
  threadingCacheByKey.set(key, cache)
  while (threadingCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = threadingCacheByKey.keys().next().value
    if (oldestKey === undefined) break
    threadingCacheByKey.delete(oldestKey)
    cardCacheByKey.delete(oldestKey)
  }
}

function sameMessageSequence(messages: SessionMessage[], prevMessages: SessionMessage[]): boolean {
  if (messages.length !== prevMessages.length) return false
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.uuid !== prevMessages[i]?.uuid) return false
  }
  return true
}

function reuseCachedPrefix(
  messages: SessionMessage[],
  prevMessages: SessionMessage[],
): SessionMessage[] | null {
  if (messages.length <= prevMessages.length) return null
  for (let i = 0; i < prevMessages.length; i++) {
    if (messages[i]?.uuid !== prevMessages[i]?.uuid) return null
  }

  const aligned = messages.slice()
  for (let i = 0; i < prevMessages.length; i++) aligned[i] = prevMessages[i]
  return aligned
}

function threadMessages(session: Session, messages: SessionMessage[]): ThreadedMessage[] {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)

  if (cached && sameMessageSequence(messages, cached.messages)) {
    touchThreadingCache(key, cached)
    return cached.threaded
  }

  let cacheMessages = messages
  let threaded: ThreadedMessage[] | null = null

  if (cached) {
    const aligned = reuseCachedPrefix(messages, cached.messages)
    if (aligned) {
      threaded = buildThreadedMessagesIncremental(aligned, cached)
      if (threaded) cacheMessages = aligned
    }
  }

  const nextThreaded = threaded ?? buildThreadedMessages(messages)
  touchThreadingCache(key, { messages: cacheMessages, threaded: nextThreaded })
  return nextThreaded
}

function formatCards(
  sessionCacheKey: string,
  threaded: ThreadedMessage[],
  density: TuiDensity,
  showToolCalls: boolean,
): TuiTranscriptCard[] {
  const messages = showToolCalls ? threaded : stripToolCallBlocks(threaded)
  let perSession = cardCacheByKey.get(sessionCacheKey)
  if (!perSession) {
    perSession = new Map()
    cardCacheByKey.set(sessionCacheKey, perSession)
  }

  const cards: TuiTranscriptCard[] = new Array(messages.length)
  const seenUuids = new Set<string>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    seenUuids.add(msg.uuid)
    let perUuid = perSession.get(msg.uuid)
    if (!perUuid) {
      perUuid = new Map()
      perSession.set(msg.uuid, perUuid)
    }
    let card = perUuid.get(density)
    if (!card) {
      card = formatTranscriptCard(msg, density)
      perUuid.set(density, card)
    }
    cards[i] = card
  }

  // Prune entries for uuids that no longer exist in the active threaded set.
  // Bounded by message count and only runs in the worker thread.
  if (perSession.size > seenUuids.size) {
    for (const uuid of perSession.keys()) {
      if (!seenUuids.has(uuid)) perSession.delete(uuid)
    }
  }

  return cards
}

self.onmessage = async (event) => {
  const data = event.data
  try {
    if (data.kind === 'format') {
      const sessionCacheKey = cacheKey(data.session)
      const transcriptCards = formatCards(sessionCacheKey, data.threaded, data.density, data.showToolCalls)
      self.postMessage({ id: data.id, ok: true, transcriptCards })
      return
    }
    const threadedMessages = threadMessages(data.session, data.messages)
    const sessionCacheKey = cacheKey(data.session)
    const transcriptCards = formatCards(sessionCacheKey, threadedMessages, data.density, data.showToolCalls)
    self.postMessage({ id: data.id, ok: true, threadedMessages, transcriptCards })
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

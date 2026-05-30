import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  stripToolCallBlocks,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../../lib/threading'
import { buildTaskRegistry } from '../../lib/taskRegistry'
import { buildTaskActiveForms, formatTranscriptCard, type TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import type { Session, SessionInfo, SessionMessage } from '../../lib/types'
import { readTuiSessionDetailSource } from '../../lib/tui/service'
import { sameSessionMessageContent, threadedMessageFingerprint } from './messageFingerprint'

// Reads the session from disk/SDK *inside the worker*, then threads + formats.
// Keeping the read here means the full transcript (and the read/normalize/sort
// CPU) never touches the main thread — only the finished payload crosses back.
type DetailRequest = {
  kind: 'detail'
  id: number
  session: Session
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
type WorkerRequest = DetailRequest | FormatRequest

type WorkerResponse =
  | {
      id: number
      ok: true
      info: SessionInfo | null
      rawMessages: SessionMessage[]
      threadedMessages: ThreadedMessage[]
      transcriptCards: TuiTranscriptCard[]
    }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

// Each entry pins a full threaded transcript + per-message card cache; for the
// largest sessions that is multiple MB. Two entries (the active session plus
// one most-recently-visited) covers the common back-and-forth pattern without
// holding 33% more memory than necessary.
const THREADING_CACHE_LIMIT = 2
const CARD_DENSITY_CACHE_LIMIT = 1
const threadingCacheByKey = new Map<string, IncrementalThreadingCache>()

// Per-session card cache keyed by message content fingerprint -> density -> card.
// Stable refs are returned across calls for the active density without keeping
// every previously-seen density resident for large transcripts.
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
    if (!sameSessionMessageContent(messages[i], prevMessages[i])) return false
  }
  return true
}

function reuseCachedPrefix(
  messages: SessionMessage[],
  prevMessages: SessionMessage[],
): SessionMessage[] | null {
  if (messages.length <= prevMessages.length) return null
  for (let i = 0; i < prevMessages.length; i++) {
    if (!sameSessionMessageContent(messages[i], prevMessages[i])) return null
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

function hasTaskListBlock(msg: ThreadedMessage): boolean {
  for (const b of msg.blocks) {
    if (b.type === 'tool_thread' && b.toolUse.name === 'TaskList') return true
  }
  return false
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
  const activeForms = buildTaskActiveForms(messages)
  const taskRegistry = buildTaskRegistry(messages)

  const cards: TuiTranscriptCard[] = new Array(messages.length)
  const seenMessageKeys = new Set<string>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const messageKey = threadedMessageFingerprint(msg)
    seenMessageKeys.add(messageKey)
    // TaskList rendering depends on the session-wide activeForms map, which
    // can change as earlier TaskCreate/TaskUpdate calls arrive. Skip the
    // per-message cache for these to avoid stale subjects.
    if (hasTaskListBlock(msg)) {
      cards[i] = formatTranscriptCard(msg, density, activeForms, taskRegistry)
      continue
    }
    let perMessage = perSession.get(messageKey)
    if (!perMessage) {
      perMessage = new Map()
      perSession.set(messageKey, perMessage)
    }
    let card = perMessage.get(density)
    if (!card) {
      card = formatTranscriptCard(msg, density, activeForms, taskRegistry)
      if (perMessage.has(density)) perMessage.delete(density)
      perMessage.set(density, card)
      while (perMessage.size > CARD_DENSITY_CACHE_LIMIT) {
        const oldestDensity = perMessage.keys().next().value
        if (oldestDensity === undefined) break
        perMessage.delete(oldestDensity)
      }
    }
    cards[i] = card
  }

  // Prune entries that no longer exist in the active threaded set. The key
  // includes content, so in-place Codex item updates cannot reuse stale cards.
  // Bounded by message count and only runs in the worker thread.
  if (perSession.size > seenMessageKeys.size) {
    for (const messageKey of perSession.keys()) {
      if (!seenMessageKeys.has(messageKey)) perSession.delete(messageKey)
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
    const { info, rawMessages } = await readTuiSessionDetailSource(data.session)
    const threadedMessages = threadMessages(data.session, rawMessages)
    const sessionCacheKey = cacheKey(data.session)
    const transcriptCards = formatCards(sessionCacheKey, threadedMessages, data.density, data.showToolCalls)
    self.postMessage({ id: data.id, ok: true, info, rawMessages, threadedMessages, transcriptCards })
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

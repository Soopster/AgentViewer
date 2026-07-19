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
import type { ProviderSelection, Session, SessionInfo, SessionMessage } from '../../lib/types'
import { readTuiSessionDetailSource, readTuiSessions } from '../../lib/tui/service'
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
type SessionsRequest = {
  kind: 'sessions'
  id: number
  provider: ProviderSelection
}
type WorkerRequest = DetailRequest | FormatRequest | SessionsRequest

type WorkerResponse =
  | {
      id: number
      ok: true
      info: SessionInfo | null
      rawMessages: SessionMessage[]
      threadedMessages: ThreadedMessage[]
      transcriptCards: TuiTranscriptCard[]
      // How many leading entries of each array are object-identical (in this
      // worker) to the previous detail response for the same session. postMessage
      // cloning destroys identity, so the client uses these counts to splice its
      // own previously-delivered objects back in — unchanged messages/cards keep
      // their main-thread identity and every WeakMap/memo cache downstream hits.
      rawPrefix: number
      threadedPrefix: number
      cardsPrefix: number
    }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[] }
  | { id: number; ok: true; sessions: Session[] }
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

// Arrays from the previous detail response per session, for the identity-prefix
// counts in WorkerResponse. These hold references into threadingCacheByKey /
// cardCacheByKey content, so the marginal memory is three array spines.
type LastSentDetail = {
  raw: SessionMessage[]
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  cardsVariant: string
}
const lastSentByKey = new Map<string, LastSentDetail>()

function sharedIdentityPrefix<T>(next: readonly T[], prev: readonly T[]): number {
  const limit = Math.min(next.length, prev.length)
  let i = 0
  while (i < limit && next[i] === prev[i]) i++
  return i
}

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
    lastSentByKey.delete(oldestKey)
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

// Returns the threaded transcript plus the message array actually cached —
// content-identical to the input, but with previously-seen message objects
// swapped in for the unchanged prefix. Posting THAT array (rather than the
// fresh read) is what makes the worker-side identity-prefix counts meaningful.
function threadMessages(
  session: Session,
  messages: SessionMessage[],
): { threaded: ThreadedMessage[]; messages: SessionMessage[] } {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)

  if (cached && sameMessageSequence(messages, cached.messages)) {
    touchThreadingCache(key, cached)
    return { threaded: cached.threaded, messages: cached.messages }
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
  return { threaded: nextThreaded, messages: cacheMessages }
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
    // can change as earlier TaskCreate/TaskUpdate calls arrive, so these are
    // always re-formatted. But when the output is unchanged, return the cached
    // OBJECT — an always-new TaskList card caps the identity prefix at the
    // first TaskList in the transcript and forfeits the downstream cache hits.
    if (hasTaskListBlock(msg)) {
      const fresh = formatTranscriptCard(msg, density, activeForms, taskRegistry)
      let perTaskMessage = perSession.get(messageKey)
      if (!perTaskMessage) {
        perTaskMessage = new Map()
        perSession.set(messageKey, perTaskMessage)
      }
      const prevCard = perTaskMessage.get(density)
      if (prevCard && JSON.stringify(prevCard) === JSON.stringify(fresh)) {
        cards[i] = prevCard
        continue
      }
      if (perTaskMessage.has(density)) perTaskMessage.delete(density)
      perTaskMessage.set(density, fresh)
      while (perTaskMessage.size > CARD_DENSITY_CACHE_LIMIT) {
        const oldestDensity = perTaskMessage.keys().next().value
        if (oldestDensity === undefined) break
        perTaskMessage.delete(oldestDensity)
      }
      cards[i] = fresh
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
    if (data.kind === 'sessions') {
      const sessions = await readTuiSessions(data.provider)
      self.postMessage({ id: data.id, ok: true, sessions })
      return
    }
    if (data.kind === 'format') {
      const sessionCacheKey = cacheKey(data.session)
      const transcriptCards = formatCards(sessionCacheKey, data.threaded, data.density, data.showToolCalls)
      self.postMessage({ id: data.id, ok: true, transcriptCards })
      return
    }
    const { info, rawMessages } = await readTuiSessionDetailSource(data.session)
    const { threaded: threadedMessages, messages: alignedMessages } = threadMessages(data.session, rawMessages)
    const sessionCacheKey = cacheKey(data.session)
    const transcriptCards = formatCards(sessionCacheKey, threadedMessages, data.density, data.showToolCalls)
    const cardsVariant = `${data.density}|${data.showToolCalls ? 1 : 0}`
    const prev = lastSentByKey.get(sessionCacheKey)
    const rawPrefix = prev ? sharedIdentityPrefix(alignedMessages, prev.raw) : 0
    const threadedPrefix = prev ? sharedIdentityPrefix(threadedMessages, prev.threaded) : 0
    const cardsPrefix = prev && prev.cardsVariant === cardsVariant
      ? sharedIdentityPrefix(transcriptCards, prev.cards)
      : 0
    lastSentByKey.set(sessionCacheKey, {
      raw: alignedMessages,
      threaded: threadedMessages,
      cards: transcriptCards,
      cardsVariant,
    })
    self.postMessage({
      id: data.id,
      ok: true,
      info,
      rawMessages: alignedMessages,
      threadedMessages,
      transcriptCards,
      rawPrefix,
      threadedPrefix,
      cardsPrefix,
    })
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

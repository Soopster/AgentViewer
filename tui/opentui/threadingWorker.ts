import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  stripToolCallBlocks,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../../lib/threading'
import {
  buildTranscriptTaskContext,
  formatTranscriptCard,
  type TranscriptTaskContext,
  type TuiTranscriptCard,
} from '../format'
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
  previousDeliveryToken?: number
}
type FormatRequest = {
  kind: 'format'
  id: number
  session: Session
  threaded?: ThreadedMessage[]
  threadedPrefix?: number
  threadedDeleteCount?: number
  threadedPatch?: ThreadedMessage[]
  previousFormatToken?: number
  density: TuiDensity
  showToolCalls: boolean
}
type SessionsRequest = {
  kind: 'sessions'
  id: number
  provider: ProviderSelection
}
// A neighbour prefetch. Identical work to `detail` — read, thread, format —
// but the payload never crosses back: the caller only wants this worker's
// threading/card caches warm so the real open is cheap. Building and posting
// the response dominates a prefetch (~311ms of worker time for eight
// first-visit sessions, against ~47ms to warm the same eight), and this worker
// is serial — so a `detail` used as a prefetch spends that time holding the
// queue against the open the user is waiting on.
type WarmRequest = {
  kind: 'warm'
  id: number
  session: Session
  density: TuiDensity
  showToolCalls: boolean
}
type WorkerRequest = DetailRequest | FormatRequest | SessionsRequest | WarmRequest

type WorkerResponse =
  | {
      id: number
      ok: true
      info: SessionInfo | null
      rawMessages: SessionMessage[]
      threadedMessages: ThreadedMessage[]
      transcriptCards: TuiTranscriptCard[]
      deliveryToken: number
      baseDeliveryToken?: number
      // How many leading entries of each array are object-identical (in this
      // worker) to the previous detail response for the same session. postMessage
      // cloning destroys identity, so the client uses these counts to splice its
      // own previously-delivered objects back in — unchanged messages/cards keep
      // their main-thread identity and every WeakMap/memo cache downstream hits.
      rawPrefix: number
      threadedPrefix: number
      cardsPrefix: number
      externalWriter?: boolean
    }
  | {
      id: number
      ok: true
      info: SessionInfo | null
      unchanged: true
      deliveryToken: number
      externalWriter?: boolean
    }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[]; formatToken: number }
  | {
      id: number
      ok: true
      cardsPatch: TuiTranscriptCard[]
      cardsPrefix: number
      cardsDeleteCount: number
      formatToken: number
      baseFormatToken: number
    }
  | { id: number; ok: true; sessions: Session[] }
  | { id: number; ok: true; warmed: true }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

// Each entry pins a full threaded transcript + per-message card cache; for the
// largest sessions that is multiple MB. The visible working set is the primary
// reader plus up to two split panes, *plus* the neighbourhood the `warm`
// requests prefetch (NEIGHBOR_PREFETCH_RADIUS on each side of the reader in
// App.tsx). Sized below that, a prefetch round evicts the very session the user
// is reading and the next poll rebuilds it from scratch — the cache thrashes
// itself and the prefetch becomes a pure cost.
const THREADING_CACHE_LIMIT = 6
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
  deliveryToken: number
}
const lastSentByKey = new Map<string, LastSentDetail>()

function sharedIdentityPrefix<T>(next: readonly T[], prev: readonly T[]): number {
  const limit = Math.min(next.length, prev.length)
  let i = 0
  while (i < limit && next[i] === prev[i]) i++
  return i
}

function sharedIdentitySuffix<T>(next: readonly T[], prev: readonly T[], prefix: number): number {
  const limit = Math.min(next.length, prev.length) - prefix
  let i = 0
  while (i < limit && next[next.length - 1 - i] === prev[prev.length - 1 - i]) i++
  return i
}

// Per-session card cache keyed by message content fingerprint -> density -> card.
// Stable refs are returned across calls for the active density without keeping
// every previously-seen density resident for large transcripts.
type CardCache = Map<string, Map<TuiDensity, TuiTranscriptCard>>
const cardCacheByKey = new Map<string, CardCache>()

type LastFormatted = {
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  formatToken: number
  hasTaskList: boolean
}
const lastFormattedByKey = new Map<string, LastFormatted>()

function touchLastFormatted(key: string, value: LastFormatted): void {
  if (lastFormattedByKey.has(key)) lastFormattedByKey.delete(key)
  lastFormattedByKey.set(key, value)
  while (lastFormattedByKey.size > THREADING_CACHE_LIMIT * 4) {
    const oldestKey = lastFormattedByKey.keys().next().value
    if (oldestKey === undefined) break
    lastFormattedByKey.delete(oldestKey)
  }
}

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
  pruneCache = true,
  taskContext?: TranscriptTaskContext,
): TuiTranscriptCard[] {
  const messages = showToolCalls ? threaded : stripToolCallBlocks(threaded)
  let perSession = cardCacheByKey.get(sessionCacheKey)
  if (!perSession) {
    perSession = new Map()
    cardCacheByKey.set(sessionCacheKey, perSession)
  }
  const { activeForms, taskRegistry } = taskContext ?? buildTranscriptTaskContext(messages)

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
  if (pruneCache && perSession.size > seenMessageKeys.size) {
    for (const messageKey of perSession.keys()) {
      if (!seenMessageKeys.has(messageKey)) perSession.delete(messageKey)
    }
  }

  return cards
}

function pruneCardCacheMessages(sessionCacheKey: string, messages: ThreadedMessage[]): void {
  const perSession = cardCacheByKey.get(sessionCacheKey)
  if (!perSession) return
  for (const message of messages) perSession.delete(threadedMessageFingerprint(message))
}

self.onmessage = async (event) => {
  const data = event.data
  try {
    if (data.kind === 'sessions') {
      const sessions = await readTuiSessions(data.provider)
      self.postMessage({ id: data.id, ok: true, sessions })
      return
    }
    if (data.kind === 'warm') {
      const { info: _info, rawMessages } = await readTuiSessionDetailSource(data.session)
      const { threaded } = threadMessages(data.session, rawMessages)
      // Populates this worker's per-message card cache for the variant the
      // reader will ask for; the cards themselves stay here.
      formatCards(cacheKey(data.session), threaded, data.density, data.showToolCalls)
      self.postMessage({ id: data.id, ok: true, warmed: true })
      return
    }
    if (data.kind === 'format') {
      const sessionCacheKey = cacheKey(data.session)
      const cardsVariant = `${data.density}|${data.showToolCalls ? 1 : 0}`
      const formatKey = `${sessionCacheKey}|${cardsVariant}`
      const prev = lastFormattedByKey.get(formatKey)
      const canApplyPatch = Boolean(
        prev
        && data.previousFormatToken === prev.formatToken
        && Number.isInteger(data.threadedPrefix)
        && Number.isInteger(data.threadedDeleteCount)
        && (data.threadedPrefix ?? -1) >= 0
        && (data.threadedDeleteCount ?? -1) >= 0
        && (data.threadedPrefix ?? 0) + (data.threadedDeleteCount ?? 0) <= prev.threaded.length
        && Array.isArray(data.threadedPatch),
      )
      const threaded = canApplyPatch && prev
        ? prev.threaded.slice(0, data.threadedPrefix).concat(
            data.threadedPatch ?? [],
            prev.threaded.slice((data.threadedPrefix ?? 0) + (data.threadedDeleteCount ?? 0)),
          )
        : data.threaded
      if (!threaded) throw new Error('threading worker format delta baseline unavailable')

      const patch = canApplyPatch && prev ? data.threadedPatch ?? [] : null
      const patchHasTaskList = patch?.some(hasTaskListBlock) ?? false
      // With visible tool calls, cards map 1:1 to threaded messages. Format
      // only the inserted/replaced middle and retain both unchanged ends.
      // TaskList is the sole global dependency: build its context once and
      // selectively refresh only TaskList cards outside the changed middle.
      if (canApplyPatch && prev && patch && data.showToolCalls) {
        const threadedPrefix = data.threadedPrefix ?? 0
        const threadedDeleteCount = data.threadedDeleteCount ?? 0
        pruneCardCacheMessages(
          sessionCacheKey,
          prev.threaded.slice(threadedPrefix, threadedPrefix + threadedDeleteCount),
        )
        const hasTaskList = prev.hasTaskList || patchHasTaskList
          ? threaded.some(hasTaskListBlock)
          : false
        const taskContext = hasTaskList ? buildTranscriptTaskContext(threaded) : undefined
        const cardsPatch = formatCards(
          sessionCacheKey,
          patch,
          data.density,
          data.showToolCalls,
          false,
          taskContext,
        )
        const transcriptCards = prev.cards.slice(0, threadedPrefix).concat(
          cardsPatch,
          prev.cards.slice(threadedPrefix + threadedDeleteCount),
        )
        if (hasTaskList && taskContext) {
          const patchEnd = threadedPrefix + patch.length
          for (let i = 0; i < threaded.length; i++) {
            if (i >= threadedPrefix && i < patchEnd) continue
            if (!hasTaskListBlock(threaded[i])) continue
            transcriptCards[i] = formatCards(
              sessionCacheKey,
              [threaded[i]],
              data.density,
              data.showToolCalls,
              false,
              taskContext,
            )[0]
          }
        }
        touchLastFormatted(formatKey, {
          threaded,
          cards: transcriptCards,
          formatToken: data.id,
          hasTaskList,
        })
        const cardsPrefix = sharedIdentityPrefix(transcriptCards, prev.cards)
        const cardsSuffix = sharedIdentitySuffix(transcriptCards, prev.cards, cardsPrefix)
        self.postMessage({
          id: data.id,
          ok: true,
          cardsPatch: transcriptCards.slice(cardsPrefix, transcriptCards.length - cardsSuffix),
          cardsPrefix,
          cardsDeleteCount: prev.cards.length - cardsPrefix - cardsSuffix,
          formatToken: data.id,
          baseFormatToken: prev.formatToken,
        })
        return
      }

      const transcriptCards = formatCards(sessionCacheKey, threaded, data.density, data.showToolCalls)
      touchLastFormatted(formatKey, {
        threaded,
        cards: transcriptCards,
        formatToken: data.id,
        hasTaskList: threaded.some(hasTaskListBlock),
      })
      if (canApplyPatch && prev) {
        const cardsPrefix = sharedIdentityPrefix(transcriptCards, prev.cards)
        const cardsSuffix = sharedIdentitySuffix(transcriptCards, prev.cards, cardsPrefix)
        self.postMessage({
          id: data.id,
          ok: true,
          cardsPatch: transcriptCards.slice(cardsPrefix, transcriptCards.length - cardsSuffix),
          cardsPrefix,
          cardsDeleteCount: prev.cards.length - cardsPrefix - cardsSuffix,
          formatToken: data.id,
          baseFormatToken: prev.formatToken,
        })
        return
      }
      self.postMessage({ id: data.id, ok: true, transcriptCards, formatToken: data.id })
      return
    }
    const { info, rawMessages, externalWriter } = await readTuiSessionDetailSource(data.session)
    const { threaded: threadedMessages, messages: alignedMessages } = threadMessages(data.session, rawMessages)
    const sessionCacheKey = cacheKey(data.session)
    const cardsVariant = `${data.density}|${data.showToolCalls ? 1 : 0}`
    const prev = lastSentByKey.get(sessionCacheKey)

    // threadMessages only returns the prior arrays when every freshly-read
    // message is content-identical. If the client still owns that exact
    // delivery and the card variant is unchanged, there is no formatting or
    // identity-prefix work left to do. This is the common idle-poll path for
    // providers whose source mtime cannot be gated reliably.
    if (
      prev
      && data.previousDeliveryToken === prev.deliveryToken
      && prev.cardsVariant === cardsVariant
      && alignedMessages === prev.raw
      && threadedMessages === prev.threaded
    ) {
      self.postMessage({
        id: data.id,
        ok: true,
        info,
        unchanged: true,
        deliveryToken: prev.deliveryToken,
        externalWriter,
      })
      return
    }

    const transcriptCards = formatCards(sessionCacheKey, threadedMessages, data.density, data.showToolCalls)
    const rawPrefix = prev ? sharedIdentityPrefix(alignedMessages, prev.raw) : 0
    const threadedPrefix = prev ? sharedIdentityPrefix(threadedMessages, prev.threaded) : 0
    const cardsPrefix = prev && prev.cardsVariant === cardsVariant
      ? sharedIdentityPrefix(transcriptCards, prev.cards)
      : 0
    // A token binds the worker baseline to the exact arrays the client still
    // owns. Prefix/length equality proves the transcript is unchanged; the
    // token prevents concurrent reads or a client eviction from reusing a
    // different baseline. Mutations, truncations and card-variant changes all
    // fall through to the full response below.
    const canReusePreviousDelivery = Boolean(
      prev
      && data.previousDeliveryToken === prev.deliveryToken
      && prev.cardsVariant === cardsVariant
      && prev.raw.length === alignedMessages.length
      && prev.threaded.length === threadedMessages.length
      && prev.cards.length === transcriptCards.length
      && rawPrefix === alignedMessages.length
      && threadedPrefix === threadedMessages.length
      && cardsPrefix === transcriptCards.length,
    )
    const deliveryToken = canReusePreviousDelivery && prev ? prev.deliveryToken : data.id
    lastSentByKey.set(sessionCacheKey, {
      raw: alignedMessages,
      threaded: threadedMessages,
      cards: transcriptCards,
      cardsVariant,
      deliveryToken,
    })
    if (canReusePreviousDelivery) {
      self.postMessage({ id: data.id, ok: true, info, unchanged: true, deliveryToken, externalWriter })
      return
    }
    self.postMessage({
      id: data.id,
      ok: true,
      info,
      rawMessages: alignedMessages,
      threadedMessages,
      transcriptCards,
      deliveryToken,
      baseDeliveryToken: prev?.deliveryToken,
      rawPrefix,
      threadedPrefix,
      cardsPrefix,
      externalWriter,
    })
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

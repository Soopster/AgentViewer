import { sessionIdentityKey, sessionVariantKey, sessionVariantParts } from './sessionIdentity'
import { mainTranscriptBudget } from './sessionCacheBudget'
import type { ThreadedMessage } from '../../lib/threading'
import { deferTranscriptCardSearchText, withTranscriptCardPreview, type TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import type { ContextUsage, ProviderSelection, Session, SessionInfo, SessionMessage, SubagentSummary } from '../../lib/types'
import { readTuiComposerOptions, readTuiSessionMetadata, readTuiSlashCommands } from '../../lib/tui/reads'
import { createKeyedWorkerQueue } from './latestWorkerQueue'
import { threadedMessageFingerprint } from './messageFingerprint'
import { tuiWorkerUrl } from './workerUrl'
import { restoreDeliveredPrefix } from './transcriptDelivery'

export type SessionDetailPayload = {
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
  transcriptCards: TuiTranscriptCard[]
  /** Present only for a read that asked for `separateTurnDurations`. */
  turnDurationLabels?: TurnDurationLabels
  estimatedRetainedBytes?: number
  externalWriter?: boolean
}

/** A turn's elapsed time by card key — see TranscriptCardOptions. */
export type TurnDurationLabels = Readonly<Record<string, string>>
type TurnDurationPatch = Record<string, string | null>

export type TranscriptCardOptions = {
  /**
   * Deliver each turn's elapsed time beside the cards instead of on them.
   * A turn's duration runs to its newest message, so as `card.durationLabel`
   * it changes every card of the streaming turn on every poll and each arrives
   * as a new object, missing every identity-keyed cache in the reader. With
   * this set, cards carry no durationLabel and keep their identity across an
   * appended message; read the label from `turnDurationLabelsForCards(cards)`.
   */
  separateTurnDurations?: boolean
}

type ThreadingClientCache = {
  requestId: number
  threadedMessages: ThreadedMessage[]
  // LRU card cache keyed by variantKey(). Kept tiny
  // because each entry can contain one formatted card per transcript message.
  cardsByVariant: Map<string, TuiTranscriptCard[]>
}

type Pending =
  | {
      kind: 'detail'
      sessionKey: string
      cardsVariant: string
      previousDelivery?: LastDeliveredDetail
      resolve: (payload: SessionDetailPayload) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'format'
      sessionKey: string
      formatKey: string
      threaded: ThreadedMessage[]
      previousDelivery?: LastFormattedDelivery
      resolve: (cards: TuiTranscriptCard[]) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'sessions'
      resolve: (sessions: Session[]) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'warm'
      resolve: () => void
      reject: (error: Error) => void
    }
  | {
      kind: 'metadata'
      resolve: (metadata: TuiSessionMetadataResult) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'affordances'
      resolve: (affordances: TuiComposerAffordances) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'subagents'
      resolve: (subagents: SubagentSummary[]) => void
      reject: (error: Error) => void
    }

type WorkerResponse = (
  | {
      id: number
      ok: true
      info: SessionInfo | null
      rawMessages: SessionMessage[]
      threadedMessages: ThreadedMessage[]
      transcriptCards: TuiTranscriptCard[]
      deliveryToken: number
      baseDeliveryToken?: number
      suffixOnly?: boolean
      rawPrefix: number
      threadedPrefix: number
      cardsPrefix: number
      estimatedRetainedBytes?: number
  externalWriter?: boolean
      turnDurationLabels?: TurnDurationLabels
      turnDurationPatch?: TurnDurationPatch
    }
  | {
      id: number
      ok: true
      info: SessionInfo | null
      unchanged: true
      deliveryToken: number
      estimatedRetainedBytes?: number
  externalWriter?: boolean
    }
  | { id: number; ok: true; transcriptCards: TuiTranscriptCard[]; formatToken: number; turnDurationLabels?: TurnDurationLabels }
  | { id: number; ok: true; densityCards: (TuiTranscriptCard | { sharedCardIndex: number; lines: TuiTranscriptCard['lines']; compactSummary: string })[]; formatToken: number; baseFormatToken: number; turnDurationLabels?: TurnDurationLabels }
  | {
      id: number
      ok: true
      cardsPatch: TuiTranscriptCard[]
      cardsPrefix: number
      cardsDeleteCount: number
      formatToken: number
      baseFormatToken: number
      turnDurationPatch?: TurnDurationPatch
    }
  | { id: number; ok: true; sessions: Session[] }
  | { id: number; ok: true; warmed: true }
  | { id: number; ok: true; metadata: TuiSessionMetadataResult }
  | { id: number; ok: true; affordances: TuiComposerAffordances }
  | { id: number; ok: true; subagents: SubagentSummary[] }
  | { id: number; ok: false; error: string }
) & { estimatedRetainedBytes?: number }

let worker: Worker | null = null
let requestCounter = 0
const sessionBudget = mainTranscriptBudget
const estimatesBySession = new Map<string, number>()
const retainedSessions = new Map<string, { session: Session; count: number }>()
const pending = new Map<number, Pending>()
// Holds the recent session neighbourhood. With tabs enabled users commonly
// switch between 4-8 sessions; a cap of 2 evicted almost everything on the
// third switch, forcing full main-thread card rebuilds on revisit.
const THREADING_CACHE_LIMIT = 10
const CARD_VARIANT_CACHE_LIMIT = 4
const FORMAT_DELIVERY_CACHE_LIMIT = 12
const threadingCacheByKey = new Map<string, ThreadingClientCache>()

// What the previous detail response for each session delivered to callers.
// postMessage cloning mints fresh objects every read, which would miss every
// identity-keyed cache downstream (App's WeakMaps, TranscriptCard memo, raw
// message fingerprint cache). The worker reports how many leading entries are
// unchanged since its previous response (identity prefixes); we splice our own
// previously-delivered objects back in for that prefix so unchanged content
// keeps its main-thread identity across polls.
type LastDeliveredDetail = {
  requestId: number
  raw: SessionMessage[]
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  cardsVariant: string
  deliveryToken: number
  estimatedRetainedBytes?: number
}
const lastDeliveredByKey = new Map<string, LastDeliveredDetail>()

type LastFormattedDelivery = {
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  formatToken: number
}
const lastFormattedByKey = new Map<string, LastFormattedDelivery>()

function touchLastFormatted(key: string, value: LastFormattedDelivery): void {
  if ((lastFormattedByKey.get(key)?.formatToken ?? -1) > value.formatToken) return
  if (lastFormattedByKey.has(key)) lastFormattedByKey.delete(key)
  lastFormattedByKey.set(key, value)
  while (lastFormattedByKey.size > FORMAT_DELIVERY_CACHE_LIMIT) {
    const oldestKey = lastFormattedByKey.keys().next().value
    if (oldestKey === undefined) break
    lastFormattedByKey.delete(oldestKey)
  }
}

/** Mirrors the worker's own eviction: this map is keyed by
 *  `[sessionKey, cardsVariant]`, so a session dropped from the threading
 *  cache would otherwise leave its threaded transcript and cards pinned here
 *  until twelve other format keys pushed them out. */
function dropLastFormattedForSession(sessionKey: string): void {
  for (const key of lastFormattedByKey.keys()) {
    if (sessionVariantParts(key)[0] === sessionKey) lastFormattedByKey.delete(key)
  }
}

function touchLastDelivered(key: string, value: LastDeliveredDetail): void {
  if ((lastDeliveredByKey.get(key)?.requestId ?? -1) > value.requestId) return
  if (lastDeliveredByKey.has(key)) lastDeliveredByKey.delete(key)
  lastDeliveredByKey.set(key, value)
  while (lastDeliveredByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = lastDeliveredByKey.keys().next().value
    if (oldestKey === undefined) break
    lastDeliveredByKey.delete(oldestKey)
  }
}

function sameThreadedMessage(next: ThreadedMessage, prev: ThreadedMessage): boolean {
  return next === prev || threadedMessageFingerprint(next) === threadedMessageFingerprint(prev)
}

function threadedPatchBounds(next: ThreadedMessage[], prev: ThreadedMessage[]): {
  prefix: number
  deleteCount: number
  patch: ThreadedMessage[]
} {
  const limit = Math.min(next.length, prev.length)
  let prefix = 0
  while (prefix < limit && sameThreadedMessage(next[prefix], prev[prefix])) prefix++

  let suffix = 0
  const suffixLimit = limit - prefix
  while (
    suffix < suffixLimit
    && sameThreadedMessage(next[next.length - 1 - suffix], prev[prev.length - 1 - suffix])
  ) suffix++

  return {
    prefix,
    deleteCount: prev.length - prefix - suffix,
    patch: next.slice(prefix, next.length - suffix),
  }
}

function cacheKey(session: Session): string {
  return sessionIdentityKey(session)
}

function variantKey(density: TuiDensity, showToolCalls: boolean, options?: TranscriptCardOptions): string {
  return `${density}|${showToolCalls ? 1 : 0}${options?.separateTurnDurations ? '|d' : ''}`
}

// Turn durations are a property of a delivered card array, so they are kept
// against the array rather than threaded through every cache that holds one:
// whoever has the cards can ask for their labels, and the labels die with them.
const turnDurationLabelsByCards = new WeakMap<TuiTranscriptCard[], TurnDurationLabels>()

/**
 * The turn durations for a card array this client delivered with
 * `separateTurnDurations`; undefined for any other array. The object is the
 * same one until a label changes, so it is safe as a memo dependency.
 */
export function turnDurationLabelsForCards(cards: TuiTranscriptCard[]): TurnDurationLabels | undefined {
  return turnDurationLabelsByCards.get(cards)
}

function rememberTurnDurationLabels(
  cards: TuiTranscriptCard[],
  labels: TurnDurationLabels | undefined,
  patch: TurnDurationPatch | undefined,
  previousCards: TuiTranscriptCard[] | undefined,
): TurnDurationLabels | undefined {
  let next = labels
  if (!next) {
    const previous = previousCards && turnDurationLabelsByCards.get(previousCards)
    if (!previous) return undefined
    next = previous
    if (patch) {
      const patched: Record<string, string> = { ...previous }
      for (const key in patch) {
        const label = patch[key]
        if (label === null) delete patched[key]
        else patched[key] = label
      }
      next = patched
    }
  }
  turnDurationLabelsByCards.set(cards, next)
  return next
}

/** Cards cross from the worker without their search strings (see
 *  deferTranscriptCardSearchText); each derives them on first read. */
function deferSearchText(cards: TuiTranscriptCard[]): TuiTranscriptCard[] {
  for (const card of cards) deferTranscriptCardSearchText(card)
  return cards
}

function rememberCardsVariant(
  cache: ThreadingClientCache,
  key: string,
  cards: TuiTranscriptCard[],
): void {
  if (cache.cardsByVariant.has(key)) cache.cardsByVariant.delete(key)
  cache.cardsByVariant.set(key, cards)
  while (cache.cardsByVariant.size > CARD_VARIANT_CACHE_LIMIT) {
    const oldestKey = cache.cardsByVariant.keys().next().value
    if (oldestKey === undefined) break
    cache.cardsByVariant.delete(oldestKey)
  }
}

function touchThreadingCache(key: string, cache: ThreadingClientCache): void {
  if ((threadingCacheByKey.get(key)?.requestId ?? -1) > cache.requestId) return
  if (threadingCacheByKey.has(key)) threadingCacheByKey.delete(key)
  threadingCacheByKey.set(key, cache)
  sessionBudget.touch(key, estimatesBySession.get(key) ?? lastDeliveredByKey.get(key)?.estimatedRetainedBytes
    ?? cache.threadedMessages.length * 1024 + [...cache.cardsByVariant.values()].reduce((bytes, cards) => bytes + cards.length * 1024, 0))
  trimSessionBudget()
  while (threadingCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = [...threadingCacheByKey.keys()].find(key => !sessionBudget.isPinned(key))
    if (oldestKey === undefined) break
    threadingCacheByKey.delete(oldestKey)
    sessionBudget.evictSession(oldestKey)
    estimatesBySession.delete(oldestKey)
    lastDeliveredByKey.delete(oldestKey)
    dropLastFormattedForSession(oldestKey)
  }
}

const deliveryBudgetOwner = { evictSession(key: string) {
  threadingCacheByKey.delete(key)
  estimatesBySession.delete(key)
  lastDeliveredByKey.delete(key)
  dropLastFormattedForSession(key)
} }
sessionBudget.register(deliveryBudgetOwner)
function trimSessionBudget() { sessionBudget.trim() }

/** A visibility lease. Retaining never starts a provider worker by itself. */
export function retainTranscriptSession(session: Session): () => void {
  const key = cacheKey(session)
  const previous = retainedSessions.get(key)
  retainedSessions.set(key, { session, count: (previous?.count ?? 0) + 1 })
  sessionBudget.retain(key)
  if (!previous) worker?.postMessage({ kind: 'retain', id: ++requestCounter, session, retain: true })
  let released = false
  return () => {
    if (released) return
    released = true
    sessionBudget.release(key)
    const entry = retainedSessions.get(key)
    if (entry && entry.count > 1) entry.count--
    else {
      retainedSessions.delete(key)
      worker?.postMessage({ kind: 'retain', id: ++requestCounter, session, retain: false })
    }
    trimSessionBudget()
  }
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(tuiWorkerUrl('tui/opentui/threadingWorker'), { type: 'module' })
  // The renderer keeps the TUI alive; the worker on its own must not, or a
  // process that is done (a smoke, a harness) waits on it forever.
  ;(w as unknown as { unref(): void }).unref()
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    if ((entry.kind === 'detail' || entry.kind === 'format') && data.estimatedRetainedBytes !== undefined) {
      estimatesBySession.set(entry.sessionKey, Math.max(estimatesBySession.get(entry.sessionKey) ?? 0, data.estimatedRetainedBytes))
    }
    pending.delete(data.id)
    if (!data.ok) {
      entry.reject(new Error(data.error))
      return
    }
    if (entry.kind === 'detail' && 'unchanged' in data) {
      const prev = entry.previousDelivery
      if (!prev || prev.cardsVariant !== entry.cardsVariant || prev.deliveryToken !== data.deliveryToken) {
        entry.reject(new Error('threading worker returned an unknown unchanged delivery'))
        return
      }
      touchLastDelivered(entry.sessionKey, { ...prev, requestId: data.id })
      entry.resolve({
        info: data.info,
        rawMessages: prev.raw,
        threadedMessages: prev.threaded,
        transcriptCards: prev.cards,
        turnDurationLabels: turnDurationLabelsByCards.get(prev.cards),
        externalWriter: data.externalWriter,
        estimatedRetainedBytes: data.estimatedRetainedBytes,
      })
    } else if (entry.kind === 'detail' && 'rawMessages' in data) {
      const prev = entry.previousDelivery?.deliveryToken === data.baseDeliveryToken
        ? entry.previousDelivery
        : undefined
      const variantMatches = prev?.cardsVariant === entry.cardsVariant
      if (data.suffixOnly && (!variantMatches || !prev
        || ![data.rawPrefix, data.threadedPrefix, data.cardsPrefix].every(Number.isInteger)
        || data.rawPrefix < 0 || data.rawPrefix > prev.raw.length
        || data.threadedPrefix < 0 || data.threadedPrefix > prev.threaded.length
        || data.cardsPrefix < 0 || data.cardsPrefix > prev.cards.length)) {
        entry.reject(new Error('threading worker returned an unknown detail delta baseline'))
        return
      }
      const rawMessages = restoreDeliveredPrefix(prev?.raw, data.rawMessages, data.rawPrefix ?? 0, data.suffixOnly)
      const threadedMessages = restoreDeliveredPrefix(prev?.threaded, data.threadedMessages, data.threadedPrefix ?? 0, data.suffixOnly)
      const transcriptCards = restoreDeliveredPrefix(
        variantMatches ? prev?.cards : undefined,
        deferSearchText(data.transcriptCards),
        data.cardsPrefix ?? 0,
        data.suffixOnly,
      )
      const turnDurationLabels = rememberTurnDurationLabels(
        transcriptCards,
        data.turnDurationLabels,
        data.turnDurationPatch,
        data.suffixOnly ? prev?.cards : undefined,
      )
      touchLastDelivered(entry.sessionKey, {
        requestId: data.id,
        raw: rawMessages,
        threaded: threadedMessages,
        cards: transcriptCards,
        cardsVariant: entry.cardsVariant,
        deliveryToken: data.deliveryToken,
        estimatedRetainedBytes: data.estimatedRetainedBytes,
      })
      entry.resolve({
        info: data.info,
        rawMessages,
        threadedMessages,
        transcriptCards,
        turnDurationLabels,
        externalWriter: data.externalWriter,
        estimatedRetainedBytes: data.estimatedRetainedBytes,
      })
    } else if (entry.kind === 'format' && 'transcriptCards' in data && 'formatToken' in data) {
      deferSearchText(data.transcriptCards)
      rememberTurnDurationLabels(data.transcriptCards, data.turnDurationLabels, undefined, undefined)
      touchLastFormatted(entry.formatKey, {
        threaded: entry.threaded,
        cards: data.transcriptCards,
        formatToken: data.formatToken,
      })
      entry.resolve(data.transcriptCards)
    } else if (entry.kind === 'format' && 'densityCards' in data) {
      const prev = entry.previousDelivery
      if (!prev || prev.formatToken !== data.baseFormatToken || data.densityCards.some((card) => 'sharedCardIndex' in card && (!Number.isInteger(card.sharedCardIndex) || card.sharedCardIndex < 0 || card.sharedCardIndex >= prev.cards.length))) {
        entry.reject(new Error('threading worker returned an unknown density delta baseline'))
        return
      }
      const transcriptCards = data.densityCards.map((card) => 'sharedCardIndex' in card
        ? withTranscriptCardPreview(prev.cards[card.sharedCardIndex], card.lines, card.compactSummary)
        : deferTranscriptCardSearchText(card))
      rememberTurnDurationLabels(transcriptCards, data.turnDurationLabels, undefined, undefined)
      touchLastFormatted(entry.formatKey, { threaded: entry.threaded, cards: transcriptCards, formatToken: data.formatToken })
      entry.resolve(transcriptCards)
    } else if (entry.kind === 'format' && 'cardsPatch' in data) {
      const prev = entry.previousDelivery
      if (
        !prev
        || prev.formatToken !== data.baseFormatToken
        || data.cardsPrefix < 0
        || data.cardsDeleteCount < 0
        || data.cardsPrefix + data.cardsDeleteCount > prev.cards.length
      ) {
        entry.reject(new Error('threading worker returned an unknown format delta baseline'))
        return
      }
      const transcriptCards = data.cardsDeleteCount === 0 && data.cardsPatch.length === 0 ? prev.cards : prev.cards.slice(0, data.cardsPrefix).concat(
        deferSearchText(data.cardsPatch),
        prev.cards.slice(data.cardsPrefix + data.cardsDeleteCount),
      )
      rememberTurnDurationLabels(transcriptCards, undefined, data.turnDurationPatch, prev.cards)
      touchLastFormatted(entry.formatKey, {
        threaded: entry.threaded,
        cards: transcriptCards,
        formatToken: data.formatToken,
      })
      entry.resolve(transcriptCards)
    } else if (entry.kind === 'sessions' && 'sessions' in data) {
      entry.resolve(data.sessions)
    } else if (entry.kind === 'warm' && 'warmed' in data) {
      entry.resolve()
    } else if (entry.kind === 'metadata' && 'metadata' in data) {
      entry.resolve(data.metadata)
    } else if (entry.kind === 'affordances' && 'affordances' in data) {
      entry.resolve(data.affordances)
    } else if (entry.kind === 'subagents' && 'subagents' in data) {
      entry.resolve(data.subagents)
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
  for (const { session } of retainedSessions.values()) w.postMessage({ kind: 'retain', id: ++requestCounter, session, retain: true })
  return w
}

/**
 * List sessions in the transcript worker so provider SDKs are loaded in one
 * isolate. Pi's SDK has a large fixed resident cost; listing in the main TUI
 * and reading detail in this worker otherwise loads a full copy in each.
 */
export type TuiSessionMetadataResult = { currentModel: string | null; contextUsage: ContextUsage | null }

/**
 * Read a session's current model + context usage in the transcript worker.
 * This had a Worker to itself, for isolation from a read that can block for
 * over a second — but that Worker was a second JS VM re-importing this exact
 * provider graph to produce two scalars, ~95MB of RSS for a model badge. The
 * read is I/O-bound, so sharing this worker costs no serialization: it yields
 * at its first await rather than queueing behind a detail read.
 */
export function readTuiSessionMetadataAsync(session: Session): Promise<TuiSessionMetadataResult> {
  const metadata = readTuiSessionMetadataInWorker(session)
  if (session.provider !== 'codex') return metadata
  // Codex's model is only reported by thread/resume, and a resume makes that
  // app-server the thread's writer. Each isolate runs its own app-server, so a
  // resume from the worker took the writer away from the main isolate, whose
  // prewarm and turns then failed with "already has an active writer". The
  // worker therefore never resumes: it answers from learned models and reports
  // an unknown one as null, and only then does the main isolate read (and
  // resume) — so browsing sessions whose models are known starts no app-server
  // on the main isolate at all (~170MB).
  return metadata.then((result) => (
    result.currentModel !== null
      ? result
      : readTuiSessionMetadata(session).then(({ currentModel, contextUsage }) => ({ currentModel, contextUsage }))
  ))
}

function readTuiSessionMetadataInWorker(session: Session): Promise<TuiSessionMetadataResult> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<TuiSessionMetadataResult>((resolve, reject) => {
    pending.set(id, { kind: 'metadata', resolve, reject })
    w.postMessage({ kind: 'metadata', id, session })
  })
}

/** A session's provider-recorded subagents, read where the provider graph already lives. */
export function readTuiSubagentSummariesAsync(session: Session): Promise<SubagentSummary[]> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<SubagentSummary[]>((resolve, reject) => {
    pending.set(id, { kind: 'subagents', resolve, reject })
    w.postMessage({ kind: 'subagents', id, session })
  })
}

export type TuiComposerAffordances = {
  commands: Awaited<ReturnType<typeof readTuiSlashCommands>>
  options: Awaited<ReturnType<typeof readTuiComposerOptions>>
}

/**
 * The composer's slash commands and options for a session. These read on the
 * main isolate for providers whose answer comes from a runtime the send path
 * warms there — Claude's pooled Query, a Copilot or Pi session, Codex's
 * app-server — so the read shares it. OpenCode warms nothing: its commands come
 * from a server, and reading them on the main isolate started a second
 * `opencode serve` (~500MB) beside the worker's merely to browse. They read in
 * the worker, which already runs one; the main isolate's server starts when the
 * composer is engaged (see shouldPrewarmTuiRuntime).
 */
export function readTuiComposerAffordancesAsync(session: Session): Promise<TuiComposerAffordances> {
  if (session.provider !== 'opencode') {
    return Promise.all([
      readTuiSlashCommands(session.sessionId, session.provider),
      readTuiComposerOptions(session.sessionId, session.provider),
    ]).then(([commands, options]) => ({ commands, options }))
  }
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<TuiComposerAffordances>((resolve, reject) => {
    pending.set(id, { kind: 'affordances', resolve, reject })
    w.postMessage({ kind: 'affordances', id, session })
  })
}

export function readTuiSessionsAsync(provider: ProviderSelection, providerInstanceId?: string): Promise<Session[]> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<Session[]>((resolve, reject) => {
    pending.set(id, { kind: 'sessions', resolve, reject })
    w.postMessage({ kind: 'sessions', id, provider, providerInstanceId })
  })
}

// ── Per-key dispatch ────────────────────────────────────────────────────────
// The worker handles each message in its own async task, so two requests for
// one session interleave there. Both the worker and this client guard their
// delta baselines with tokens, so an overlap is never *wrong* — it falls back
// to shipping the whole transcript, which is exactly the cost the deltas exist
// to avoid. Serializing per key removes the overlap instead of tolerating it.
//
// The baseline is therefore captured inside `run`, at the moment of posting.
// Capturing it when the caller enqueued would reintroduce the same staleness
// the queue is here to remove: the baseline maps are updated on *response*, so
// a request that waited behind another would carry a baseline the worker had
// already superseded.

type DetailRequest = {
  session: Session
  density: TuiDensity
  showToolCalls: boolean
  options?: TranscriptCardOptions
  resolve: (payload: SessionDetailPayload) => void
  reject: (error: Error) => void
}

type WarmRequest = {
  session: Session
  density: TuiDensity
  showToolCalls: boolean
  options?: TranscriptCardOptions
  resolve: () => void
  reject: (error: Error) => void
}

type FormatRequest = {
  session: Session
  threaded: ThreadedMessage[]
  density: TuiDensity
  showToolCalls: boolean
  options?: TranscriptCardOptions
  resolve: (cards: TuiTranscriptCard[]) => void
  reject: (error: Error) => void
}

/**
 * A stable id per threaded array, so a format key can say *which* transcript it
 * is for. Held weakly: these arrays are the transcript, and the map must not be
 * what keeps an evicted one alive.
 */
const threadedIds = new WeakMap<ThreadedMessage[], number>()
let threadedIdCounter = 0
function threadedIdentity(threaded: ThreadedMessage[]): number {
  const existing = threadedIds.get(threaded)
  if (existing !== undefined) return existing
  const id = ++threadedIdCounter
  threadedIds.set(threaded, id)
  return id
}

/**
 * Hands a superseded caller the replacement's answer. Sound only because the
 * key is the whole question: the replacement asks the same thing of newer
 * state, so its answer is at least as fresh as the one that was asked for.
 */
function chainSuperseded<R>(
  superseded: { resolve: (value: R) => void; reject: (error: Error) => void },
  replacement: { resolve: (value: R) => void; reject: (error: Error) => void },
): void {
  const { resolve, reject } = superseded
  const nextResolve = replacement.resolve
  const nextReject = replacement.reject
  replacement.resolve = (value) => { nextResolve(value); resolve(value) }
  replacement.reject = (error) => { nextReject(error); reject(error) }
}

function dispatchDetail(request: DetailRequest): Promise<void> {
  const { session, density, showToolCalls } = request
  const key = cacheKey(session)
  const cardsVariant = variantKey(density, showToolCalls, request.options)
  const separateTurnDurations = request.options?.separateTurnDurations === true
  const id = ++requestCounter
  const w = ensureWorker()
  const stored = lastDeliveredByKey.get(key)
  const previousDelivery = stored?.cardsVariant === cardsVariant ? stored : undefined
  return new Promise<void>((settle) => {
    pending.set(id, {
      kind: 'detail',
      sessionKey: key,
      cardsVariant,
      previousDelivery,
      resolve: (payload) => {
        const cacheEntry = {
          requestId: id,
          threadedMessages: payload.threadedMessages,
          cardsByVariant: new Map<string, TuiTranscriptCard[]>(),
        }
        rememberCardsVariant(cacheEntry, cardsVariant, payload.transcriptCards)
        touchThreadingCache(key, cacheEntry)
        request.resolve(payload)
        settle()
      },
      reject: (error) => { request.reject(error); settle() },
    })
    w.postMessage({
      kind: 'detail',
      id,
      session,
      density,
      showToolCalls,
      separateTurnDurations,
      previousDeliveryToken: previousDelivery?.deliveryToken,
    })
  })
}

function dispatchWarm(request: WarmRequest): Promise<void> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<void>((settle) => {
    pending.set(id, {
      kind: 'warm',
      resolve: () => { request.resolve(); settle() },
      reject: (error) => { request.reject(error); settle() },
    })
    w.postMessage({
      kind: 'warm',
      id,
      session: request.session,
      density: request.density,
      showToolCalls: request.showToolCalls,
      separateTurnDurations: request.options?.separateTurnDurations === true,
    })
  })
}

function dispatchFormat(request: FormatRequest): Promise<void> {
  const { session, threaded, density, showToolCalls } = request
  const key = cacheKey(session)
  const cardsVariant = variantKey(density, showToolCalls, request.options)
  const separateTurnDurations = request.options?.separateTurnDurations === true
  // Every density of one tool-visibility and duration mode ends the same way.
  const siblingSuffix = cardsVariant.slice(cardsVariant.indexOf('|'))
  const formatKey = sessionVariantKey(key, cardsVariant)
  const id = ++requestCounter
  const w = ensureWorker()
  let previousDelivery = lastFormattedByKey.get(formatKey)
  let threadedBaseVariant: string | undefined
  if (!previousDelivery) {
    // The first format of a density can use another density's exact token as
    // its input baseline. Output sharing is independently checked in worker.
    for (const [candidateKey, candidate] of lastFormattedByKey) {
      const [candidateOwner, candidateVariant] = sessionVariantParts(candidateKey)
      if (candidateOwner === key && candidateVariant.slice(candidateVariant.indexOf('|')) === siblingSuffix) {
        previousDelivery = candidate
        threadedBaseVariant = candidateVariant
      }
    }
  }
  const patch = previousDelivery ? threadedPatchBounds(threaded, previousDelivery.threaded) : null
  return new Promise<void>((settle) => {
    let retriedWithFullTranscript = false
    const entry: Extract<Pending, { kind: 'format' }> = {
      kind: 'format',
      sessionKey: key,
      formatKey,
      threaded,
      previousDelivery,
      resolve: (transcriptCards) => {
        // (Re)create the entry when it was evicted or holds a different
        // threaded identity — getTranscriptCardsSync compares identity against
        // the caller's `threaded`, so an entry keyed to anything else can never
        // serve the transcript this format was requested for. A fresher detail
        // read simply re-caches on its own resolve.
        const existing = threadingCacheByKey.get(key)
        if (existing && existing.requestId > id) {
          request.resolve(transcriptCards)
          settle()
          return
        }
        const cacheEntry = existing && existing.threadedMessages === threaded
          ? existing
          : { requestId: id, threadedMessages: threaded, cardsByVariant: new Map<string, TuiTranscriptCard[]>() }
        cacheEntry.requestId = id
        rememberCardsVariant(cacheEntry, cardsVariant, transcriptCards)
        touchThreadingCache(key, cacheEntry)
        request.resolve(transcriptCards)
        settle()
      },
      reject: (error) => {
        // Worker and client LRUs have different working sets. An evicted
        // worker baseline is a cache miss: retry once with the full source.
        if (!retriedWithFullTranscript && patch && error.message === 'threading worker format delta baseline unavailable') {
          retriedWithFullTranscript = true
          entry.previousDelivery = undefined
          pending.set(id, entry)
          w.postMessage({ kind: 'format', id, session, threaded, density, showToolCalls, separateTurnDurations })
          return
        }
        request.reject(error)
        settle()
      },
    }
    pending.set(id, entry)
    w.postMessage(patch && previousDelivery
      ? {
          kind: 'format',
          id,
          session,
          threadedPrefix: patch.prefix,
          threadedDeleteCount: patch.deleteCount,
          threadedPatch: patch.patch,
          previousFormatToken: previousDelivery.formatToken,
          threadedBaseVariant,
          density,
          showToolCalls,
          separateTurnDurations,
        }
      : { kind: 'format', id, session, threaded, density, showToolCalls, separateTurnDurations })
  })
}

const detailQueue = createKeyedWorkerQueue<DetailRequest>({
  run: dispatchDetail,
  supersede: chainSuperseded,
})

const warmQueue = createKeyedWorkerQueue<WarmRequest>({
  run: dispatchWarm,
  supersede: chainSuperseded,
})

const formatQueue = createKeyedWorkerQueue<FormatRequest>({
  run: dispatchFormat,
  supersede: chainSuperseded,
})

/** Test seam: session keys with threading work queued or in flight. */
export function threadingQueueActiveKeys(): number {
  return detailQueue.activeKeys + warmQueue.activeKeys + formatQueue.activeKeys
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
  options?: TranscriptCardOptions,
): Promise<SessionDetailPayload> {
  return new Promise<SessionDetailPayload>((resolve, reject) => {
    detailQueue.push({
      // The variant is part of the question: two reads that differ in density
      // are not the same request, and answering one with the other's cards
      // would hand back a transcript formatted for a display the caller is not
      // showing.
      key: JSON.stringify(['detail', cacheKey(session), variantKey(density, showToolCalls, options)]),
      request: { session, density, showToolCalls, options, resolve, reject },
    })
  })
}

/**
 * Warm the worker's threading + card caches for a session without shipping the
 * transcript back. Used by the sidebar neighbour prefetch: the worker is
 * serial, so a prefetch that also builds and posts a full transcript spends
 * most of its time occupying the queue a real open has to wait in.
 */
export function warmTranscriptAsync(
  session: Session,
  density: TuiDensity,
  showToolCalls: boolean,
  options?: TranscriptCardOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    warmQueue.push({
      key: JSON.stringify(['warm', cacheKey(session), variantKey(density, showToolCalls, options)]),
      request: { session, density, showToolCalls, options, resolve, reject },
    })
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
  options?: TranscriptCardOptions,
): Promise<TuiTranscriptCard[]> {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)
  if (cached && cached.threadedMessages === threaded) {
    const variant = cached.cardsByVariant.get(variantKey(density, showToolCalls, options))
    if (variant) {
      touchThreadingCache(key, cached)
      return Promise.resolve(variant)
    }
  }

  return new Promise<TuiTranscriptCard[]>((resolve, reject) => {
    formatQueue.push({
      // The threaded array is part of the question — two formats of different
      // transcripts are not interchangeable, and a superseded caller handed the
      // other one's cards would render a different number of cards than it has
      // messages. Identity is minted per array rather than derived from its
      // contents: this runs on every density toggle, and the arrays are large.
      key: JSON.stringify(['format', key, variantKey(density, showToolCalls, options), threadedIdentity(threaded)]),
      request: { session, threaded, density, showToolCalls, options, resolve, reject },
    })
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
  options?: TranscriptCardOptions,
): TuiTranscriptCard[] | null {
  const key = cacheKey(session)
  const cached = threadingCacheByKey.get(key)
  if (!cached || cached.threadedMessages !== threaded) return null
  return cached.cardsByVariant.get(variantKey(density, showToolCalls, options)) ?? null
}

import { sessionIdentityKey, sessionVariantKey, sessionVariantParts } from './sessionIdentity'
import { SessionCacheBudget } from './sessionCacheBudget'
import { transcriptPayloadBytes } from './transcriptPayloadSize'
import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  computeTurnDurationsMs,
  stripToolCallBlocks,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../../lib/threading'
import {
  buildTranscriptTaskContext,
  ensureTuiMermaidRenderer,
  formatTranscriptCard,
  reformatTranscriptCardDensity,
  retimeTranscriptCard,
  textNeedsTuiMermaid,
  turnDurationLabel,
  type TuiTranscriptCard,
} from '../format'
import type { TuiDensity } from '../theme'
import type { ContextUsage, ProviderSelection, Session, SessionInfo, SessionMessage } from '../../lib/types'
// lib/tui/reads.ts, not lib/tui/service.ts: this Worker is a separate JS VM
// that only ever reads, and service.ts's graph reaches the whole send path —
// every provider client, harness and SDK — for ~72MB of footprint against
// ~16MB here. Keep this import off service.ts.
import {
  readTuiComposerOptions,
  readTuiSessionDetailSource,
  readTuiSessionMetadata,
  readTuiSessions,
  readTuiSlashCommands,
  readTuiSubagentSummaries,
} from '../../lib/tui/reads'
import { sameSessionMessageContent, threadedMessageFingerprint } from './messageFingerprint'
import { startRawHeapSampler, reportWorkerHeap } from './workerHeapProbe'
import { disallowCodexModelResume } from '../../lib/codexThreads'

// Reads the session from disk/SDK *inside the worker*, then threads + formats.
// Keeping the read here means the full transcript (and the read/normalize/sort
// CPU) never touches the main thread — only the finished payload crosses back.
type DetailRequest = {
  kind: 'detail'
  id: number
  session: Session
  density: TuiDensity
  showToolCalls: boolean
  separateTurnDurations?: boolean
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
  threadedBaseVariant?: string
  density: TuiDensity
  showToolCalls: boolean
  separateTurnDurations?: boolean
}
type SessionsRequest = {
  kind: 'sessions'
  id: number
  provider: ProviderSelection
  providerInstanceId?: string
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
  separateTurnDurations?: boolean
}
// A session's current model + context usage. This used to run in a Worker of
// its own, which bought isolation from a read that can block for over a second
// (the Agent SDK's getContextUsage) — but a Bun Worker is a whole JS VM, and
// that one re-imported this exact provider graph to return two scalars: ~95MB
// of RSS for a model badge. It lives here now because this worker already
// holds the graph. Serialization is not a concern the way it is for `warm`:
// the read is I/O-bound (it awaits a provider round-trip), so it yields the
// event loop immediately and interleaves with a detail read rather than
// queueing behind it.
type MetadataRequest = {
  kind: 'metadata'
  id: number
  session: Session
}
// Composer slash commands + options, for providers that warm no runtime on
// the main isolate (see readTuiComposerAffordancesAsync).
type AffordancesRequest = {
  kind: 'affordances'
  id: number
  session: Session
}
// A session's provider-recorded subagents, for the sidebar's nesting.
type SubagentsRequest = {
  kind: 'subagents'
  id: number
  session: Session
}
type RetainRequest = { kind: 'retain'; id: number; session: Session; retain: boolean }
type WorkerRequest = RetainRequest | DetailRequest | FormatRequest | SessionsRequest | WarmRequest | MetadataRequest | AffordancesRequest | SubagentsRequest

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
      // How many leading entries of each array are object-identical (in this
      // worker) to the previous detail response for the same session. postMessage
      // cloning destroys identity, so the client uses these counts to splice its
      // own previously-delivered objects back in — unchanged messages/cards keep
      // their main-thread identity and every WeakMap/memo cache downstream hits.
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
  | { id: number; ok: true; metadata: { currentModel: string | null; contextUsage: ContextUsage | null } }
  | { id: number; ok: true; subagents: Awaited<ReturnType<typeof readTuiSubagentSummaries>> }
  | { id: number; ok: true; affordances: {
      commands: Awaited<ReturnType<typeof readTuiSlashCommands>>
      options: Awaited<ReturnType<typeof readTuiComposerOptions>>
    } }
  | { id: number; ok: false; error: string }
) & { estimatedRetainedBytes?: number }

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
const threadingCacheByKey = new Map<string, IncrementalThreadingCache>()
const sessionBudget = new SessionCacheBudget(96 * 1024 * 1024)

// Arrays from the previous detail response per session, for the identity-prefix
// counts in WorkerResponse. These hold references into threadingCacheByKey /
// cardCacheByKey content, so the marginal memory is three array spines.
type LastSentDetail = {
  requestId: number
  raw: SessionMessage[]
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  cardsVariant: string
  deliveryToken: number
  estimatedRetainedBytes?: number
  turnDurationLabels?: TurnDurationLabels
}
const lastSentByKey = new Map<string, LastSentDetail>()

// With `separateTurnDurations` a card carries no durationLabel: a turn's elapsed
// time runs to its newest message, so on a card it changes every card of the
// streaming turn on every poll — 17 to 160 cards per appended message in real
// sessions — and each one reaches the reader as a new object. The labels travel
// beside the cards instead, keyed by card key, as a patch against the previous
// delivery so a poll ships the active turn's entries and not the transcript's.
type TurnDurationLabels = Record<string, string>
type TurnDurationPatch = Record<string, string | null>

function cardsVariantKey(density: TuiDensity, showToolCalls: boolean, separateTurnDurations: boolean | undefined): string {
  return `${density}|${showToolCalls ? 1 : 0}${separateTurnDurations ? '|d' : ''}`
}

function visibleMessages(threaded: ThreadedMessage[], showToolCalls: boolean): ThreadedMessage[] {
  return showToolCalls ? threaded : stripToolCallBlocks(threaded)
}

function turnDurationLabelsFor(threaded: ThreadedMessage[], showToolCalls: boolean): TurnDurationLabels {
  const labels: TurnDurationLabels = {}
  for (const [key, durationMs] of computeTurnDurationsMs(visibleMessages(threaded, showToolCalls))) {
    const label = turnDurationLabel(durationMs)
    if (label !== undefined) labels[key] = label
  }
  return labels
}

/** What turns `previous` into `next`; undefined when they already agree. */
function turnDurationPatch(next: TurnDurationLabels, previous: TurnDurationLabels | undefined): TurnDurationPatch | undefined {
  const patch: TurnDurationPatch = {}
  let changed = false
  for (const key in next) {
    if (previous?.[key] !== next[key]) { patch[key] = next[key]; changed = true }
  }
  if (previous) {
    for (const key in previous) {
      if (!(key in next)) { patch[key] = null; changed = true }
    }
  }
  return changed ? patch : undefined
}

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

// Per-session card cache keyed by message content fingerprint.
// Stable refs are returned across calls for the active density without keeping
// every previously-seen density resident for large transcripts.
type CachedCard = {
  card: TuiTranscriptCard
  density: TuiDensity
  durationMs?: number
}
type CardCache = Map<string, CachedCard>
const cardCacheByKey = new Map<string, CardCache>()

type LastFormatted = {
  threaded: ThreadedMessage[]
  cards: TuiTranscriptCard[]
  formatToken: number
  hasTaskList: boolean
  estimatedRetainedBytes?: number
  turnDurationLabels?: TurnDurationLabels
}
const lastFormattedByKey = new Map<string, LastFormatted>()

function touchLastFormatted(owner: string, key: string, value: LastFormatted): void {
  if ((lastFormattedByKey.get(key)?.formatToken ?? -1) > value.formatToken) return
  const previous = lastFormattedByKey.get(key)
  value.estimatedRetainedBytes = previous?.cards === value.cards && previous.threaded === value.threaded
    ? previous.estimatedRetainedBytes
    : transcriptPayloadBytes({ info: null, rawMessages: [], threadedMessages: value.threaded, transcriptCards: value.cards, contextUsage: null })
  if (lastFormattedByKey.has(key)) lastFormattedByKey.delete(key)
  lastFormattedByKey.set(key, value)
  sessionBudget.touch(owner, Math.max(lastSentByKey.get(owner)?.estimatedRetainedBytes ?? 0, value.estimatedRetainedBytes ?? 0))
  trimSessionBudget()
  while (lastFormattedByKey.size > THREADING_CACHE_LIMIT * 4) {
    const oldestKey = lastFormattedByKey.keys().next().value
    if (oldestKey === undefined) break
    lastFormattedByKey.delete(oldestKey)
  }
}

/** Every cache here is keyed by session except this one, which is keyed by
 *  sessionVariantKey(sessionCacheKey, cardsVariant) — so evicting a session from the
 *  threading cache used to leave its formatted transcript behind. Each entry
 *  pins a full ThreadedMessage[] *and* a full card array, and the cap is four
 *  per session, so the worker could hold 24 whole transcripts while intending
 *  to hold 6. That gap was the bulk of this worker's resident memory. */
function dropLastFormattedForSession(sessionCacheKey: string): void {
  for (const key of lastFormattedByKey.keys()) {
    if (sessionVariantParts(key)[0] === sessionCacheKey) lastFormattedByKey.delete(key)
  }
}

function cacheKey(session: Session): string {
  return sessionIdentityKey(session)
}

function trimSessionBudget() {
  sessionBudget.trim(key => {
    threadingCacheByKey.delete(key)
    cardCacheByKey.delete(key)
    lastSentByKey.delete(key)
    dropLastFormattedForSession(key)
  })
}

function touchThreadingCache(key: string, cache: IncrementalThreadingCache): void {
  if (threadingCacheByKey.has(key)) threadingCacheByKey.delete(key)
  threadingCacheByKey.set(key, cache)
  while (threadingCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = [...threadingCacheByKey.keys()].find(key => !sessionBudget.isPinned(key))
    if (oldestKey === undefined) break
    threadingCacheByKey.delete(oldestKey)
    cardCacheByKey.delete(oldestKey)
    lastSentByKey.delete(oldestKey)
    sessionBudget.forget(oldestKey)
    dropLastFormattedForSession(oldestKey)
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

/** Loads the Mermaid renderer only for a transcript that actually contains a
 *  Mermaid fence. The renderer costs ~21MB of RSS to evaluate and almost no
 *  transcript needs it, so paying for it at import — in this Worker's own VM,
 *  on top of the main one's — was the single largest avoidable allocation
 *  here. Formatting itself stays synchronous; this is the await that lets it. */
async function ensureMermaidForTranscript(threaded: ThreadedMessage[]): Promise<void> {
  for (const msg of threaded) {
    for (const block of msg.blocks) {
      // Only text blocks reach the Mermaid path in tui/format.ts.
      if (block.type !== 'text') continue
      if (textNeedsTuiMermaid(block.text)) {
        await ensureTuiMermaidRenderer()
        return
      }
    }
  }
}

async function formatCards(
  sessionCacheKey: string,
  threaded: ThreadedMessage[],
  density: TuiDensity,
  showToolCalls: boolean,
  pruneCache = true,
  separateTurnDurations = false,
): Promise<TuiTranscriptCard[]> {
  await ensureMermaidForTranscript(threaded)
  const messages = visibleMessages(threaded, showToolCalls)
  let perSession = cardCacheByKey.get(sessionCacheKey)
  if (!perSession) {
    perSession = new Map()
  }
  // Format-only sessions (including live overlays) never touch the threading
  // LRU. Bound their caches here too, and retire delta baselines together so
  // they cannot keep an evicted transcript resident.
  cardCacheByKey.delete(sessionCacheKey)
  cardCacheByKey.set(sessionCacheKey, perSession)
  while (cardCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = [...cardCacheByKey.keys()].find(key => !sessionBudget.isPinned(key))
    if (oldestKey === undefined) break
    cardCacheByKey.delete(oldestKey)
    threadingCacheByKey.delete(oldestKey)
    lastSentByKey.delete(oldestKey)
    sessionBudget.forget(oldestKey)
    dropLastFormattedForSession(oldestKey)
  }
  const { activeForms, taskRegistry } = buildTranscriptTaskContext(messages)
  const durations = separateTurnDurations ? null : computeTurnDurationsMs(messages)

  const cards: TuiTranscriptCard[] = new Array(messages.length)
  const seenMessageKeys = new Set<string>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const durationMs = durations?.get(msg.uuid)
    const messageKey = threadedMessageFingerprint(msg)
    seenMessageKeys.add(messageKey)
    // TaskList rendering depends on the session-wide activeForms map, which
    // can change as earlier TaskCreate/TaskUpdate calls arrive, so these are
    // always re-formatted. But when the output is unchanged, return the cached
    // OBJECT — an always-new TaskList card caps the identity prefix at the
    // first TaskList in the transcript and forfeits the downstream cache hits.
    if (hasTaskListBlock(msg)) {
      const fresh = formatTranscriptCard(msg, density, activeForms, taskRegistry, durationMs, true)
      const prevEntry = perSession.get(messageKey)
      if (prevEntry?.density === density && Object.is(prevEntry.durationMs, durationMs) && JSON.stringify(prevEntry.card) === JSON.stringify(fresh)) {
        cards[i] = prevEntry.card
        continue
      }
      perSession.set(messageKey, { card: fresh, durationMs, density })
      cards[i] = fresh
      continue
    }
    let entry = perSession.get(messageKey)
    if (!entry || entry.density !== density || !Object.is(entry.durationMs, durationMs)) {
      // The key is the message's content, so a cached entry differs from what
      // is wanted in at most its density and its turn's duration, and each has
      // a rewrite that leaves the rest of the card alone. The duration one is
      // the live-poll path: a turn's elapsed time runs to its newest message,
      // so every card of the streaming turn lands here on every poll.
      entry = {
        card: !entry
          ? formatTranscriptCard(msg, density, activeForms, taskRegistry, durationMs, true)
          : Object.is(entry.durationMs, durationMs)
          ? reformatTranscriptCardDensity(msg, density, entry.card, activeForms, taskRegistry)
          : entry.density === density
          ? retimeTranscriptCard(entry.card, durationMs)
          : formatTranscriptCard(msg, density, activeForms, taskRegistry, durationMs, true),
        durationMs,
        density,
      }
      perSession.set(messageKey, entry)
    }
    cards[i] = entry.card
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

function changedTurnRange(
  messages: ThreadedMessage[],
  changeStart: number,
  changedCount: number,
  includePreviousBoundary = false,
): { start: number; end: number } {
  if (messages.length === 0) return { start: 0, end: 0 }

  let anchor = Math.min(Math.max(changeStart, 0), messages.length - 1)
  if (includePreviousBoundary && anchor > 0 && messages[anchor]?.role === 'user') anchor -= 1

  let start = anchor
  while (start > 0 && messages[start]?.role !== 'user') start -= 1

  let end = Math.min(
    messages.length,
    Math.max(changeStart + changedCount, start + 1),
  )
  while (end < messages.length && messages[end]?.role !== 'user') end += 1
  return { start, end }
}

function pruneCardCacheRange(sessionCacheKey: string, messages: ThreadedMessage[]): void {
  const perSession = cardCacheByKey.get(sessionCacheKey)
  if (!perSession) return
  for (const message of messages) perSession.delete(threadedMessageFingerprint(message))
}

// Density conversion shares all fields except the collapsed preview. Require
// reference/value equality for every remaining field before sending only that
// preview; TaskList/context and duration changes naturally fail this check.
function densityCardDelivery(card: TuiTranscriptCard, previous: TuiTranscriptCard | undefined, index: number): TuiTranscriptCard | { sharedCardIndex: number; lines: TuiTranscriptCard['lines']; compactSummary: string } {
  if (!previous || card.expandedLines !== previous.expandedLines) return card
  const keys = Object.keys(card) as (keyof TuiTranscriptCard)[]
  if (keys.length !== Object.keys(previous).length || keys.some((key) => key !== 'lines' && key !== 'compactSummary' && card[key] !== previous[key])) return card
  return { sharedCardIndex: index, lines: card.lines, compactSummary: card.compactSummary }
}

self.onmessage = async (event) => {
  const data = event.data
  reportWorkerHeap('threading')
  try {
    if (data.kind === 'retain') {
      const key = cacheKey(data.session)
      if (data.retain) sessionBudget.retain(key)
      else { sessionBudget.release(key); trimSessionBudget() }
      return
    }
    if (data.kind === 'sessions') {
      const sessions = await readTuiSessions(data.provider, data.providerInstanceId)
      self.postMessage({ id: data.id, ok: true, sessions })
      return
    }
    if (data.kind === 'metadata') {
      const metadata = await readTuiSessionMetadata(data.session)
      self.postMessage({
        id: data.id,
        ok: true,
        metadata: { currentModel: metadata.currentModel, contextUsage: metadata.contextUsage },
      })
      return
    }
    if (data.kind === 'subagents') {
      const subagents = await readTuiSubagentSummaries(data.session.sessionId, data.session.provider)
      self.postMessage({ id: data.id, ok: true, subagents })
      return
    }
    if (data.kind === 'affordances') {
      const [commands, options] = await Promise.all([
        readTuiSlashCommands(data.session.sessionId, data.session.provider),
        readTuiComposerOptions(data.session.sessionId, data.session.provider),
      ])
      self.postMessage({ id: data.id, ok: true, affordances: { commands, options } })
      return
    }
    if (data.kind === 'warm') {
      const { info: _info, rawMessages } = await readTuiSessionDetailSource(data.session)
      const { threaded, messages: aligned } = threadMessages(data.session, rawMessages)
      // Populates this worker's per-message card cache for the variant the
      // reader will ask for; the cards themselves stay here.
      const cards = await formatCards(cacheKey(data.session), threaded, data.density, data.showToolCalls, true, data.separateTurnDurations)
      sessionBudget.touch(cacheKey(data.session), transcriptPayloadBytes({ info: _info, rawMessages: aligned, threadedMessages: threaded, transcriptCards: cards, contextUsage: null }))
      trimSessionBudget()
      self.postMessage({ id: data.id, ok: true, warmed: true })
      return
    }
    if (data.kind === 'format') {
      const sessionCacheKey = cacheKey(data.session)
      const separateTurnDurations = data.separateTurnDurations === true
      const cardsVariant = cardsVariantKey(data.density, data.showToolCalls, separateTurnDurations)
      const formatKey = sessionVariantKey(sessionCacheKey, cardsVariant)
      const prev = lastFormattedByKey.get(formatKey)
      const inputBaseline = data.threadedBaseVariant
        ? lastFormattedByKey.get(sessionVariantKey(sessionCacheKey, data.threadedBaseVariant))
        : prev
      const canApplyPatch = Boolean(
        inputBaseline
        && data.previousFormatToken === inputBaseline.formatToken
        && Number.isInteger(data.threadedPrefix)
        && Number.isInteger(data.threadedDeleteCount)
        && (data.threadedPrefix ?? -1) >= 0
        && (data.threadedDeleteCount ?? -1) >= 0
        && (data.threadedPrefix ?? 0) + (data.threadedDeleteCount ?? 0) <= inputBaseline.threaded.length
        && Array.isArray(data.threadedPatch),
      )
      const unchangedInput = canApplyPatch && data.threadedDeleteCount === 0 && data.threadedPatch?.length === 0
      const threaded = canApplyPatch && inputBaseline
        ? unchangedInput ? inputBaseline.threaded : inputBaseline.threaded.slice(0, data.threadedPrefix).concat(
            data.threadedPatch ?? [],
            inputBaseline.threaded.slice((data.threadedPrefix ?? 0) + (data.threadedDeleteCount ?? 0)),
          )
        : data.threaded
      if (!threaded) throw new Error('threading worker format delta baseline unavailable')
      const turnDurationLabels = separateTurnDurations ? turnDurationLabelsFor(threaded, data.showToolCalls) : undefined

      const patch = canApplyPatch && prev ? data.threadedPatch ?? [] : null
      const sameVariantPatch = canApplyPatch && inputBaseline === prev
      if (sameVariantPatch && prev && unchangedInput) {
        touchLastFormatted(sessionCacheKey, formatKey, { ...prev, formatToken: data.id })
        self.postMessage({ id: data.id, ok: true, cardsPatch: [], cardsPrefix: prev.cards.length, cardsDeleteCount: 0, formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes, baseFormatToken: prev.formatToken })
        return
      }
      const patchHasTaskList = patch?.some(hasTaskListBlock) ?? false
      if (sameVariantPatch && prev && patch && data.showToolCalls && !prev.hasTaskList && !patchHasTaskList) {
        const threadedPrefix = data.threadedPrefix ?? 0
        const threadedDeleteCount = data.threadedDeleteCount ?? 0
        const nextRange = changedTurnRange(threaded, threadedPrefix, patch.length, threadedDeleteCount > 0)
        const previousRange = changedTurnRange(
          prev.threaded,
          threadedPrefix,
          threadedDeleteCount,
          patch.length > 0,
        )
        const replaceStart = Math.min(nextRange.start, previousRange.start)
        const replaceEnd = Math.max(nextRange.end, replaceStart)
        const previousEnd = Math.max(previousRange.end, replaceStart)

        pruneCardCacheRange(
          sessionCacheKey,
          prev.threaded.slice(replaceStart, previousEnd),
        )
        const replacementCards = await formatCards(
          sessionCacheKey,
          threaded.slice(replaceStart, replaceEnd),
          data.density,
          data.showToolCalls,
          false,
          separateTurnDurations,
        )
        const transcriptCards = prev.cards.slice(0, replaceStart).concat(
          replacementCards,
          prev.cards.slice(previousEnd),
        )
        touchLastFormatted(sessionCacheKey, formatKey, {
          threaded,
          cards: transcriptCards,
          formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes,
          hasTaskList: false,
          turnDurationLabels,
        })
        const cardsPrefix = sharedIdentityPrefix(transcriptCards, prev.cards)
        const cardsSuffix = sharedIdentitySuffix(transcriptCards, prev.cards, cardsPrefix)
        self.postMessage({
          id: data.id,
          ok: true,
          cardsPatch: transcriptCards.slice(cardsPrefix, transcriptCards.length - cardsSuffix),
          cardsPrefix,
          cardsDeleteCount: prev.cards.length - cardsPrefix - cardsSuffix,
          formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes,
          baseFormatToken: prev.formatToken,
          turnDurationPatch: turnDurationLabels && turnDurationPatch(turnDurationLabels, prev.turnDurationLabels),
        })
        return
      }

      const transcriptCards = await formatCards(sessionCacheKey, threaded, data.density, data.showToolCalls, true, separateTurnDurations)
      touchLastFormatted(sessionCacheKey, formatKey, {
        threaded,
        cards: transcriptCards,
        formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes,
        hasTaskList: threaded.some(hasTaskListBlock),
        turnDurationLabels,
      })
      if (sameVariantPatch && prev) {
        const cardsPrefix = sharedIdentityPrefix(transcriptCards, prev.cards)
        const cardsSuffix = sharedIdentitySuffix(transcriptCards, prev.cards, cardsPrefix)
        self.postMessage({
          id: data.id,
          ok: true,
          cardsPatch: transcriptCards.slice(cardsPrefix, transcriptCards.length - cardsSuffix),
          cardsPrefix,
          cardsDeleteCount: prev.cards.length - cardsPrefix - cardsSuffix,
          formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes,
          baseFormatToken: prev.formatToken,
          turnDurationPatch: turnDurationLabels && turnDurationPatch(turnDurationLabels, prev.turnDurationLabels),
        })
        return
      }
      if (canApplyPatch && inputBaseline && data.threadedBaseVariant) {
        self.postMessage({ id: data.id, ok: true, densityCards: transcriptCards.map((card, index) => densityCardDelivery(card, inputBaseline.cards[index], index)), formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes, baseFormatToken: inputBaseline.formatToken, turnDurationLabels })
        return
      }
      self.postMessage({ id: data.id, ok: true, transcriptCards, formatToken: data.id, estimatedRetainedBytes: lastFormattedByKey.get(formatKey)?.estimatedRetainedBytes, turnDurationLabels })
      return
    }
    const { info, rawMessages, externalWriter } = await readTuiSessionDetailSource(data.session)
    const sessionCacheKey = cacheKey(data.session)
    const separateTurnDurations = data.separateTurnDurations === true
    if ((lastSentByKey.get(sessionCacheKey)?.requestId ?? -1) > data.id) {
      // A slow source read still answers its caller, but cannot replace the
      // newer threading/card baselines (including an unchanged newer read).
      const threadedMessages = buildThreadedMessages(rawMessages)
      await ensureMermaidForTranscript(threadedMessages)
      const visible = visibleMessages(threadedMessages, data.showToolCalls)
      const { activeForms, taskRegistry } = buildTranscriptTaskContext(visible)
      const durations = separateTurnDurations ? null : computeTurnDurationsMs(visible)
      const transcriptCards = visible.map((message) => formatTranscriptCard(message, data.density, activeForms, taskRegistry, durations?.get(message.uuid), true))
      self.postMessage({
        id: data.id, ok: true, info, rawMessages, threadedMessages, transcriptCards, deliveryToken: data.id, rawPrefix: 0, threadedPrefix: 0, cardsPrefix: 0, externalWriter,
        turnDurationLabels: separateTurnDurations ? turnDurationLabelsFor(threadedMessages, data.showToolCalls) : undefined,
        estimatedRetainedBytes: transcriptPayloadBytes({ info, rawMessages, threadedMessages, transcriptCards, contextUsage: null }),
      })
      return
    }
    const { threaded: threadedMessages, messages: alignedMessages } = threadMessages(data.session, rawMessages)
    const cardsVariant = cardsVariantKey(data.density, data.showToolCalls, separateTurnDurations)
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
      if (prev.requestId <= data.id) lastSentByKey.set(sessionCacheKey, { ...prev, requestId: data.id })
      self.postMessage({
        id: data.id,
        ok: true,
        info,
        unchanged: true,
        deliveryToken: prev.deliveryToken,
        estimatedRetainedBytes: prev.estimatedRetainedBytes,
        externalWriter,
      })
      return
    }

    const transcriptCards = await formatCards(sessionCacheKey, threadedMessages, data.density, data.showToolCalls, true, separateTurnDurations)
    const turnDurationLabels = separateTurnDurations ? turnDurationLabelsFor(threadedMessages, data.showToolCalls) : undefined
    const rawPrefix = prev ? sharedIdentityPrefix(alignedMessages, prev.raw) : 0
    const threadedPrefix = prev ? sharedIdentityPrefix(threadedMessages, prev.threaded) : 0
    const cardsPrefix = prev && prev.cardsVariant === cardsVariant
      ? sharedIdentityPrefix(transcriptCards, prev.cards)
      : 0
    // A token binds the worker baseline to the exact arrays the client still
    // owns. Prefix/length equality proves the transcript is unchanged; the
    // token prevents concurrent reads or a client eviction from reusing a
    // different baseline. Mutations, truncations and card-variant changes all
    // fall through to the array delivery below.
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
    const estimatedRetainedBytes = canReusePreviousDelivery && prev?.estimatedRetainedBytes !== undefined
      ? prev.estimatedRetainedBytes
      : transcriptPayloadBytes({ info, rawMessages: alignedMessages, threadedMessages, transcriptCards, contextUsage: null })
    if ((lastSentByKey.get(sessionCacheKey)?.requestId ?? -1) <= data.id) {
      lastSentByKey.set(sessionCacheKey, {
        requestId: data.id,
        raw: alignedMessages,
        threaded: threadedMessages,
        cards: transcriptCards,
        cardsVariant,
        deliveryToken,
        estimatedRetainedBytes,
        turnDurationLabels,
      })
    }
    sessionBudget.touch(sessionCacheKey, estimatedRetainedBytes)
    trimSessionBudget()
    if (canReusePreviousDelivery) {
      self.postMessage({ id: data.id, ok: true, info, unchanged: true, deliveryToken, externalWriter, estimatedRetainedBytes })
      return
    }
    // Only omit a prefix when this request captured the matching delivery.
    // Concurrent reads and client eviction otherwise receive complete arrays.
    const suffixOnly = Boolean(prev
      && data.previousDeliveryToken === prev.deliveryToken
      && prev.cardsVariant === cardsVariant)
    self.postMessage({
      id: data.id,
      ok: true,
      info,
      suffixOnly,
      rawMessages: suffixOnly ? alignedMessages.slice(rawPrefix) : alignedMessages,
      threadedMessages: suffixOnly ? threadedMessages.slice(threadedPrefix) : threadedMessages,
      transcriptCards: suffixOnly ? transcriptCards.slice(cardsPrefix) : transcriptCards,
      deliveryToken,
      estimatedRetainedBytes,
      baseDeliveryToken: prev?.deliveryToken,
      rawPrefix,
      threadedPrefix,
      cardsPrefix,
      externalWriter,
      // A suffix delivery is applied to the client's copy of `prev`, so its
      // labels can be a patch against prev's; anything else carries them whole.
      turnDurationLabels: suffixOnly ? undefined : turnDurationLabels,
      turnDurationPatch: suffixOnly && turnDurationLabels ? turnDurationPatch(turnDurationLabels, prev?.turnDurationLabels) : undefined,
    })
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// This isolate runs its own Codex app-server, and a resume would make it the
// thread's writer — taking the thread from the main isolate's sends. It answers
// Codex models from what is learned and leaves unknown ones to the main isolate.
disallowCodexModelResume()
startRawHeapSampler('threading')

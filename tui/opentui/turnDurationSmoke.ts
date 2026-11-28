import assert from 'node:assert/strict'
// @ts-ignore -- Bun's test helpers are available to standalone smoke scripts.
import { mock } from 'bun:test'
import { buildThreadedMessages } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { formatTranscriptCards, type TuiTranscriptCard } from '../format'

// A turn's elapsed time runs to its newest message. Carried on each card, one
// appended message therefore changes every card of the streaming turn, and each
// reaches the reader as a new object. `separateTurnDurations` carries the labels
// beside the cards instead. Nothing on screen shows the difference — the cards
// read the same either way — so this pins it by object identity.

const FINISHED_TURN = 40
const STREAMING_TURN = 300
const START = Date.UTC(2026, 0, 1)

function message(sessionId: string, index: number, role: 'user' | 'assistant', atSeconds: number): SessionMessage {
  return {
    uuid: `${sessionId}-${index}`,
    session_id: sessionId,
    type: role,
    parent_tool_use_id: null,
    provider: 'codex',
    timestamp: new Date(START + atSeconds * 1000).toISOString(),
    message: { role, content: `${role} message ${index}: ${'streaming turn content '.repeat(6)}` },
  }
}

/** One finished turn, then a long turn that is still streaming. */
function transcript(sessionId: string): SessionMessage[] {
  const out: SessionMessage[] = []
  for (let i = 0; i < FINISHED_TURN; i++) out.push(message(sessionId, out.length, i === 0 ? 'user' : 'assistant', i))
  for (let i = 0; i < STREAMING_TURN; i++) out.push(message(sessionId, out.length, i === 0 ? 'user' : 'assistant', 1000 + i))
  return out
}

const sources = new Map<string, SessionMessage[]>()
mock.module('../../lib/tui/reads', () => ({
  readTuiSessionDetailSource: async (session: { sessionId: string }) => ({
    info: null,
    rawMessages: structuredClone(sources.get(session.sessionId) ?? []),
  }),
  readTuiSessionMetadata: async () => ({}),
  readTuiSessions: async () => [],
  readTuiSlashCommands: async () => [],
  readTuiComposerOptions: async () => ({}),
}))

// The real worker handler and the real client, with real clone semantics.
type Wire = {
  id: number
  suffixOnly?: boolean
  transcriptCards?: TuiTranscriptCard[]
  cardsPatch?: TuiTranscriptCard[]
  turnDurationLabels?: Record<string, string>
  turnDurationPatch?: Record<string, string | null>
}
let latestWire: Wire = { id: 0 }
let receiver: ((event: MessageEvent) => void) | null = null
const workerScope = {
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
  postMessage(data: Wire) {
    latestWire = data
    receiver?.({ data: structuredClone(data) } as MessageEvent)
  },
}
;(globalThis as unknown as { self: unknown }).self = workerScope
await import('./threadingWorker')
class LocalWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror = null
  postMessage(data: unknown) {
    receiver = this.onmessage
    void workerScope.onmessage!({ data: structuredClone(data) } as MessageEvent)
  }
  terminate() {}
}
Object.assign(globalThis, { Worker: LocalWorker })
const {
  formatTranscriptCardsAsync,
  readAndBuildTranscriptAsync,
  turnDurationLabelsForCards,
} = await import('./threadingWorkerClient')

const SEPARATE = { separateTurnDurations: true }

/** What the cards would say with their durations on them. */
function expectedLabels(raw: SessionMessage[]): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const card of formatTranscriptCards(buildThreadedMessages(raw))) {
    if (card.durationLabel !== undefined) labels[card.key] = card.durationLabel
  }
  return labels
}

function retainedIdentities(next: TuiTranscriptCard[], previous: TuiTranscriptCard[]): number {
  let same = 0
  for (let i = 0; i < previous.length; i++) if (next[i] === previous[i]) same++
  return same
}

// ── Detail reads, durations beside the cards ────────────────────────────────
const separate = { provider: 'codex' as const, sessionId: 'turn-duration-separate' }
let raw = transcript(separate.sessionId)
sources.set(separate.sessionId, raw)

const first = await readAndBuildTranscriptAsync(separate, 'balanced', true, SEPARATE)
assert.equal(first.transcriptCards.length, raw.length)
assert.ok(first.transcriptCards.every((card) => card.durationLabel === undefined), 'a card still carries its turn duration')
assert.deepEqual(first.turnDurationLabels, expectedLabels(raw), 'the labels beside the cards are not the ones the cards would carry')
assert.equal(turnDurationLabelsForCards(first.transcriptCards), first.turnDurationLabels)
// Cards and labels together are exactly the cards as they are formatted today.
assert.deepEqual(
  first.transcriptCards.map((card) => ({ ...card, durationLabel: first.turnDurationLabels?.[card.key] })),
  formatTranscriptCards(buildThreadedMessages(raw)),
)

const idle = await readAndBuildTranscriptAsync(separate, 'balanced', true, SEPARATE)
assert.equal(idle.transcriptCards, first.transcriptCards)
assert.equal(idle.turnDurationLabels, first.turnDurationLabels, 'an unchanged poll minted a new labels object')

// One more message lands in the streaming turn.
raw = [...raw, message(separate.sessionId, raw.length, 'assistant', 1000 + STREAMING_TURN + 30)]
sources.set(separate.sessionId, raw)
const polled = await readAndBuildTranscriptAsync(separate, 'balanced', true, SEPARATE)
assert.equal(polled.transcriptCards.length, first.transcriptCards.length + 1)
assert.equal(
  retainedIdentities(polled.transcriptCards, first.transcriptCards),
  first.transcriptCards.length,
  'an appended message re-identified cards that did not change',
)
assert.equal(latestWire.suffixOnly, true)
assert.equal(latestWire.transcriptCards?.length, 1, 'the poll shipped more than the new card')
assert.equal(latestWire.turnDurationLabels, undefined, 'a suffix poll shipped the whole labels map')
// Only the streaming turn's entries moved; the finished turn's are not resent.
const patchKeys = Object.keys(latestWire.turnDurationPatch ?? {})
assert.equal(patchKeys.length, STREAMING_TURN + 1)
assert.ok(patchKeys.every((key) => Number(key.slice(separate.sessionId.length + 1)) >= FINISHED_TURN))
assert.notEqual(polled.turnDurationLabels, first.turnDurationLabels)
assert.deepEqual(polled.turnDurationLabels, expectedLabels(raw), 'the labels did not follow the turn')
const streamingKey = `${separate.sessionId}-${FINISHED_TURN}`
assert.notEqual(polled.turnDurationLabels?.[streamingKey], first.turnDurationLabels?.[streamingKey])
assert.equal(polled.turnDurationLabels?.[`${separate.sessionId}-0`], first.turnDurationLabels?.[`${separate.sessionId}-0`])

// A density switch is a different card variant: whole arrays, whole labels.
const dense = await readAndBuildTranscriptAsync(separate, 'dense', true, SEPARATE)
assert.deepEqual(dense.turnDurationLabels, expectedLabels(raw))
assert.deepEqual(
  dense.transcriptCards.map((card) => ({ ...card, durationLabel: dense.turnDurationLabels?.[card.key] })),
  formatTranscriptCards(buildThreadedMessages(raw), 'dense'),
)

// ── The control: durations on the cards, as today ───────────────────────────
const baked = { provider: 'codex' as const, sessionId: 'turn-duration-baked' }
let bakedRaw = transcript(baked.sessionId)
sources.set(baked.sessionId, bakedRaw)
const bakedFirst = await readAndBuildTranscriptAsync(baked, 'balanced', true)
assert.equal(bakedFirst.turnDurationLabels, undefined)
assert.equal(turnDurationLabelsForCards(bakedFirst.transcriptCards), undefined)
assert.deepEqual(bakedFirst.transcriptCards, formatTranscriptCards(buildThreadedMessages(bakedRaw)))
bakedRaw = [...bakedRaw, message(baked.sessionId, bakedRaw.length, 'assistant', 1000 + STREAMING_TURN + 30)]
sources.set(baked.sessionId, bakedRaw)
const bakedPolled = await readAndBuildTranscriptAsync(baked, 'balanced', true)
assert.deepEqual(bakedPolled.transcriptCards, formatTranscriptCards(buildThreadedMessages(bakedRaw)))
const bakedRetained = retainedIdentities(bakedPolled.transcriptCards, bakedFirst.transcriptCards)
// The finished turn survives; every card of the streaming turn is a new object.
assert.equal(bakedRetained, FINISHED_TURN)

// ── Format requests (density toggles, live overlays) ────────────────────────
const formatted = { provider: 'codex' as const, sessionId: 'turn-duration-format' }
let formatRaw = transcript(formatted.sessionId)
let threaded = buildThreadedMessages(formatRaw)
const formatFirst = await formatTranscriptCardsAsync(formatted, threaded, 'balanced', true, SEPARATE)
assert.ok(formatFirst.every((card) => card.durationLabel === undefined))
assert.deepEqual(turnDurationLabelsForCards(formatFirst), expectedLabels(formatRaw))
formatRaw = [...formatRaw, message(formatted.sessionId, formatRaw.length, 'assistant', 1000 + STREAMING_TURN + 30)]
// The caller's transcript keeps its unchanged messages, as the reader's does.
threaded = [...threaded, ...buildThreadedMessages(formatRaw).slice(threaded.length)]
const formatPolled = await formatTranscriptCardsAsync(formatted, threaded, 'balanced', true, SEPARATE)
assert.equal(retainedIdentities(formatPolled, formatFirst), formatFirst.length, 'a format re-identified unchanged cards')
assert.equal(latestWire.cardsPatch?.length, 1)
assert.deepEqual(turnDurationLabelsForCards(formatPolled), expectedLabels(formatRaw))

// ── Search text crosses as '' and derives itself on first read ──────────────
assert.ok(latestWire.cardsPatch?.every((card) => card.searchText === '' && card.searchHaystackLower === ''), 'search text crossed the wire')
const eager = formatTranscriptCards(buildThreadedMessages(raw))
const needle = `assistant message ${raw.length - 1}:`
assert.ok(polled.transcriptCards.at(-1)?.searchHaystackLower.includes(needle), 'a delivered card is not searchable')
assert.deepEqual(polled.transcriptCards.map((card) => card.searchText), eager.map((card) => card.searchText))
assert.deepEqual(polled.transcriptCards.map((card) => card.searchHaystackLower), eager.map((card) => card.searchHaystackLower))
assert.deepEqual(polled.transcriptCards.map((card) => Object.keys(card)), eager.map((card) => Object.keys(card)), 'a delivered card lists its keys in another order')

console.log(JSON.stringify({
  smoke: 'turn-duration-delivery',
  streamingTurnCards: STREAMING_TURN,
  reidentifiedPerAppend: {
    durationsOnCards: bakedFirst.transcriptCards.length - bakedRetained,
    durationsBesideCards: first.transcriptCards.length - retainedIdentities(polled.transcriptCards, first.transcriptCards),
  },
  labelsPatchEntries: patchKeys.length,
}))
process.exit(0)

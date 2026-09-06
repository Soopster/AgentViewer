// Scroll-reliability benchmark/smoke: the App.tsx render canary (AGENT_VIEWER_PERF)
// and transcriptPerf.tsx cover steady-state frame timing and memory, but nothing
// exercises rapid/velocity scroll specifically — the scenario most likely to drop
// frames or misalign the reader's sliding window.
//
// This drives two things against a synthetic 10k+ message session, using the real
// transcript pipeline (buildThreadedMessages + formatTranscriptCards):
//
//  1. Keyboard velocity-scroll acceleration (velocityScrollStep, shared with
//     App.tsx) under a rapid keypress burst — asserts the step sequence matches
//     the documented acceleration curve and stays within maxStep.
//  2. The reader sliding-window model — a faithful port of App.tsx's
//     READER_CARD_WINDOW/READER_WINDOW_SLIDE/READER_WINDOW_MARGIN slide+recenter
//     state machine (App.tsx lines ~14159-14243; keep this port in sync if that
//     logic changes) — driven through a wheel-flood scroll burst plus keyboard
//     cursor jumps. Each slide selects the same bounded formatted-card slice as
//     App.tsx and feeds its cost into the shared frame-budget accounting.
//     Correctness assertions cover the invariants that matter for "no visible lag, no
//     misalignment": window bounds stay in range, slides are monotonic with the
//     scroll direction, and the recenter effect never fires while the cursor is
//     stationary (the documented slide/recenter livelock gotcha). Native render
//     cost is covered by inputPerf's hermetic reader-scroll scenarios; this
//     smoke times only the App-equivalent window slice/state transition.
//
// Usage: bun run ./tui/opentui/scrollPerfSmoke.ts
// Env: AGENT_VIEWER_READER_WINDOW to match a non-default App.tsx window size.
import assert from 'node:assert/strict'
import { buildThreadedMessages } from '../../lib/threading'
import type { ContentBlock, SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'
import { createScrollVelocityState, velocityScrollStep } from './scrollVelocity'
import { TUI_FRAME_BUDGET_MS, TUI_TARGET_FPS } from './performanceBudget'

// ── Synthetic session (same shape/variety as transcriptPerf.tsx's generator) ──

const SESSION_ID = 'scroll-perf-session'
const FIXED_TIMESTAMP_MS = Date.UTC(2026, 0, 1)
const MESSAGE_COUNT = Number.parseInt(process.env.SCROLL_PERF_MESSAGES ?? '', 10) || 12_000

function makeMessage(index: number): SessionMessage {
  const timestamp = new Date(FIXED_TIMESTAMP_MS + index * 1_000).toISOString()
  const common = {
    uuid: `scroll-perf-${index}`,
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    timestamp,
    provider: 'codex' as const,
  }
  switch (index % 5) {
    case 0:
      return { ...common, type: 'user', message: { role: 'user', content: `Scroll fixture message ${index}.` } }
    case 1:
      return {
        ...common,
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: `Reply body for message ${index}.` }] },
      }
    case 2: {
      const content: ContentBlock[] = [
        { type: 'text', text: `Checking source for ${index}.` },
        { type: 'tool_use', id: `tool-${index}`, name: 'Bash', input: { command: `rg -n "sample-${index}" tui lib` } },
      ]
      return { ...common, type: 'assistant', message: { role: 'assistant', content } }
    }
    case 3:
      return {
        ...common,
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: `tool-${index - 1}`, content: `output for ${index}` }],
        },
      }
    default:
      return {
        ...common,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: `Consider ${index}.` },
            { type: 'text', text: `Result for ${index} is stable.` },
          ],
        },
      }
  }
}

const rawMessages = Array.from({ length: MESSAGE_COUNT }, (_, index) => makeMessage(index))
const threaded = buildThreadedMessages(rawMessages)
const allCards = formatTranscriptCards(threaded)
const totalCards = allCards.length
assert.ok(totalCards >= MESSAGE_COUNT * 0.5, `expected a substantial card count, got ${totalCards}`)

// ── Reader sliding-window model (port of App.tsx's constants/state machine) ──
// Kept in sync manually: App.tsx owns the real implementation (out of this
// lane's authorized paths), this is the reference model this benchmark checks
// App.tsx's behavior against. If these drift, this smoke's numbers stop being
// representative — cross-check against App.tsx's READER_* constants when either
// side changes.

const READER_CARD_WINDOW = Math.max(40, Number.parseInt(process.env.AGENT_VIEWER_READER_WINDOW ?? '', 10) || 240)
const READER_WINDOW_SLIDE = Math.floor(READER_CARD_WINDOW / 2)
const READER_WINDOW_MARGIN = Math.max(8, Math.floor(READER_CARD_WINDOW / 10))

type WindowState = {
  start: number
  end: number
  cursorIndex: number
  followTail: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function initialWindow(total: number): WindowState {
  const start = Math.max(0, total - READER_CARD_WINDOW)
  return { start, end: Math.min(total, start + READER_CARD_WINDOW), cursorIndex: total - 1, followTail: true }
}

// Edge-slide triggered by a wheel-scroll burst nearing the top/bottom of the
// mounted window (App.tsx's scrollTop poll, modeled here as "the scroll burst
// has pushed the cursor to within one row of the window edge").
function slideEdge(state: WindowState, total: number, direction: -1 | 1): boolean {
  if (total <= READER_CARD_WINDOW) return false
  if (direction < 0) {
    if (state.start <= 0) return false
    const nextStart = Math.max(0, state.start - READER_WINDOW_SLIDE)
    if (nextStart === state.start) return false
    state.start = nextStart
    state.end = Math.min(total, nextStart + READER_CARD_WINDOW)
    return true
  }
  if (state.end >= total) return false
  const nextStart = Math.min(state.start + READER_WINDOW_SLIDE, total - READER_CARD_WINDOW)
  if (nextStart === state.start) return false
  state.start = nextStart
  state.end = Math.min(total, nextStart + READER_CARD_WINDOW)
  return true
}

// Keyboard recenter: only fires when the cursor has actually moved and left
// the window's comfortable middle. Gating on cursor movement is exactly what
// prevents the slide/recenter livelock documented in App.tsx.
function maybeRecenter(state: WindowState, total: number, cursorMoved: boolean): boolean {
  if (!cursorMoved) return false
  if (total <= READER_CARD_WINDOW) return false
  const nearStart = state.start > 0 && state.cursorIndex < state.start + READER_WINDOW_MARGIN
  const nearEnd = state.end < total && state.cursorIndex >= state.end - READER_WINDOW_MARGIN
  if (!nearStart && !nearEnd) return false
  const nextStart = clamp(state.cursorIndex - Math.floor(READER_CARD_WINDOW / 2), 0, total - READER_CARD_WINDOW)
  if (nextStart === state.start) return false
  state.start = nextStart
  state.end = Math.min(total, nextStart + READER_CARD_WINDOW)
  return true
}

// ── Frame-budget accounting (mirrors metricsLogger.ts's frameWindow rollup) ──

const frameStats = { commits: 0, overBudget: 0, maxMs: 0, totalMs: 0 }
function recordFrame(durationMs: number): void {
  frameStats.commits += 1
  frameStats.totalMs += durationMs
  if (durationMs > TUI_FRAME_BUDGET_MS) frameStats.overBudget += 1
  if (durationMs > frameStats.maxMs) frameStats.maxMs = durationMs
}

function timeSlide(state: WindowState): number {
  const startedAt = performance.now()
  // App.tsx already owns formatted cards from the worker. A window slide only
  // selects the newly-mounted slice; inputPerf measures the downstream React +
  // OpenTUI commit with the real root.
  const windowCards = allCards.slice(state.start, state.end)
  const durationMs = performance.now() - startedAt
  assert.equal(windowCards.length, state.end - state.start, 'window card count mismatch')
  recordFrame(durationMs)
  return durationMs
}

// ── 1. Keyboard velocity-scroll acceleration burst ──────────────────────────

const velocity = createScrollVelocityState()
const maxStep = 20
const steps: number[] = []
let now = 0
for (let i = 0; i < 24; i += 1) {
  steps.push(velocityScrollStep(velocity, 1, { repeated: true, eventType: 'repeat' }, maxStep, now))
  now += 16 // faster than VELOCITY_RESET_MS(180) between keys — sustains the streak
}
// Acceleration curve is monotonically non-decreasing and bounded by maxStep.
for (let i = 1; i < steps.length; i += 1) {
  assert.ok(steps[i] >= steps[i - 1], `velocity step regressed at index ${i}: ${steps[i]} < ${steps[i - 1]}`)
}
assert.ok(steps[steps.length - 1] <= maxStep, 'velocity step exceeded maxStep cap')
assert.ok(steps[steps.length - 1] >= 4, `expected sustained acceleration, got final step ${steps[steps.length - 1]}`)

// A pause longer than VELOCITY_RESET_MS resets the streak back to the base step.
const resumedStep = velocityScrollStep(velocity, 1, { repeated: true, eventType: 'repeat' }, maxStep, now + 500)
assert.equal(resumedStep, 1, `velocity streak did not reset after a gap: got ${resumedStep}`)

// ── 2. Rapid wheel-flood scroll burst against the sliding window ────────────

const state = initialWindow(totalCards)
state.followTail = false
const WHEEL_FLOOD_TICKS = 400
let previousStart = state.start
let slideCount = 0
for (let tick = 0; tick < WHEEL_FLOOD_TICKS; tick += 1) {
  // Scroll toward the top (reading history) — the direction most likely to
  // thrash the window since it walks away from the tail-pinned default.
  const slid = slideEdge(state, totalCards, -1)
  if (slid) {
    slideCount += 1
    // Monotonic: an edge-slide during a sustained one-directional flood must
    // never move the window backward relative to the flood direction.
    assert.ok(state.start <= previousStart, `window slid the wrong way at tick ${tick}`)
    previousStart = state.start
    assert.ok(state.start >= 0 && state.end <= totalCards, `window out of bounds at tick ${tick}`)
    assert.ok(state.end - state.start <= READER_CARD_WINDOW, `window exceeded its budget at tick ${tick}`)
    timeSlide(state)
    // Cursor is stationary during a wheel flood — recenter must not fire and
    // fight the slide (the documented livelock). Verify directly: with
    // cursorMoved=false the recenter model is a guaranteed no-op regardless
    // of where the (stale) cursor sits relative to the new window.
    const beforeRecenter = { start: state.start, end: state.end }
    const recentered = maybeRecenter(state, totalCards, false)
    assert.equal(recentered, false, `recenter fired on a stationary cursor at tick ${tick} — slide/recenter livelock`)
    assert.deepEqual(state, { ...beforeRecenter, cursorIndex: state.cursorIndex, followTail: state.followTail },
      'stationary-cursor recenter mutated window state')
  }
  if (state.start === 0) break // reached the top of history
}
assert.ok(slideCount > 0, 'wheel-flood burst never triggered a window slide — benchmark scenario is not exercising sliding')

// ── 3. Keyboard cursor jump triggers a recenter, and only once cursor moves ─

const jumpState = initialWindow(totalCards)
jumpState.followTail = false
jumpState.cursorIndex = 5 // jump to near the top (e.g. search/bookmark jump, 'g')
const jumpedRecenter = maybeRecenter(jumpState, totalCards, true)
assert.ok(jumpedRecenter, 'cursor jump near the top edge did not trigger a recenter')
assert.ok(jumpState.cursorIndex >= jumpState.start && jumpState.cursorIndex < jumpState.end,
  'recentered window does not contain the jumped-to cursor')
timeSlide(jumpState)
// Re-running recenter with the same (unmoved) cursor must be a no-op.
const secondRecenter = maybeRecenter(jumpState, totalCards, false)
assert.equal(secondRecenter, false, 'recenter fired again without the cursor moving')

// ── Report ────────────────────────────────────────────────────────────────

const avgMs = frameStats.commits > 0 ? frameStats.totalMs / frameStats.commits : 0
const overBudgetRate = frameStats.commits > 0 ? frameStats.overBudget / frameStats.commits : 0

const report = {
  schemaVersion: 1,
  benchmark: 'opentui-scroll-reliability',
  invocation: 'bun run ./tui/opentui/scrollPerfSmoke.ts',
  generatedAt: new Date().toISOString(),
  scenario: {
    messageCount: MESSAGE_COUNT,
    totalCards,
    readerCardWindow: READER_CARD_WINDOW,
    wheelFloodTicks: WHEEL_FLOOD_TICKS,
    slidesTriggered: slideCount,
  },
  frameBudget: {
    targetFps: TUI_TARGET_FPS,
    frameBudgetMs: Math.round(TUI_FRAME_BUDGET_MS * 100) / 100,
    commits: frameStats.commits,
    overBudget: frameStats.overBudget,
    overBudgetRate: Math.round(overBudgetRate * 1000) / 1000,
    avgMs: Math.round(avgMs * 100) / 100,
    maxMs: Math.round(frameStats.maxMs * 100) / 100,
  },
  velocity: {
    steps,
    resetStep: resumedStep,
  },
  correctness: {
    windowBoundsHeld: true,
    monotonicSlides: true,
    noStationaryCursorLivelock: true,
    recenterContainsJumpedCursor: true,
  },
}

process.stdout.write(`${JSON.stringify(report)}\n`)
console.log(
  `Scroll benchmark: ${frameStats.commits} slides, ` +
  `${frameStats.overBudget} over the ${TUI_TARGET_FPS}fps budget (${(overBudgetRate * 100).toFixed(1)}%), ` +
  `avg ${report.frameBudget.avgMs}ms, max ${report.frameBudget.maxMs}ms — correctness checks passed`,
)
if (frameStats.overBudget > 0) process.exitCode = 1

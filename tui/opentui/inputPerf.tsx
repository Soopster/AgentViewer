/** @jsxImportSource @opentui/react */
// Render-cost harness for the OpenTUI navigation surfaces. Mounts the real root
// against a hermetic workload (a realistic 10k-message coding transcript and
// 120 sessions by default), drives one surface at key-repeat or wheel-flood
// speed, and reports two independent clocks for the timed window:
//
//   frames   every pass of the renderer's own loop — frame callbacks, the tree
//            pass (Yoga layout + drawing into the buffer) and the native diff.
//            This is the one that sees scrolling: moving a scrollbox mostly
//            does not commit React at all.
//   commits  what a React Profiler around the real root saw, split into render
//            (actualDuration) and commit (everything after React's mutations).
//
// A frame or commit over budget is one the terminal cannot repaint in, which
// is what unresponsiveness actually is.
//
//   bun tui/opentui/inputPerf.tsx                     # every scenario
//   INPUT_SCENARIO=stream-wheel bun tui/opentui/inputPerf.tsx
//   INPUT_SCENARIO=stream- bun tui/opentui/inputPerf.tsx  # trailing - = prefix
//   INPUT_LIST=1 bun tui/opentui/inputPerf.tsx        # scenario names
//   INPUT_SECONDS=8 bun tui/opentui/inputPerf.tsx     # longer window each
//   INPUT_FIXTURE=trivial bun tui/opentui/inputPerf.tsx # the old one-line workload
//   INPUT_REAL_SESSIONS=1 bun tui/opentui/inputPerf.tsx # field diagnostic
//   INPUT_MEMORY=1 bun tui/opentui/inputPerf.tsx # forced-GC heap/RSS outside timing
//   INPUT_JSON=1 bun tui/opentui/inputPerf.tsx   # one JSON line per scenario too
//   INPUT_COUNT_NODES=1 INPUT_CHILD=1 INPUT_SCENARIO=card-page bun tui/opentui/inputPerf.tsx
//       renderables per mounted card by type; INPUT_DUMP_CARD=3,4 also prints those cards' trees
//   INPUT_FOCUS_TRACE=1 INPUT_CHILD=1 INPUT_SCENARIO=focus-toggle bun tui/opentui/inputPerf.tsx
//       distance from the bottom per frame through the reader's staged first-focus expansion
//   INPUT_CPU_PROFILE=1 INPUT_SCENARIO=stream-wheel bun tui/opentui/inputPerf.tsx
//       runs that one scenario under `bun --cpu-prof --cpu-prof-md` and prints
//       where the .cpuprofile and .md were written (INPUT_CPU_PROFILE_DIR to
//       choose). Rank that output by sample count, never by self-time.
//
// INPUT_REAL_SESSIONS is intentionally not deterministic across runs. The
// reported `cards` column makes that field diagnostic interpretable, but only
// the hermetic default is suitable as a repeatable gate.
//
// Each scenario runs in its OWN process. Sharing one is not merely tidier to
// avoid: a scenario that leaves the app in an unexpected mode (a stray escape
// landing on the exit confirm, a `/` reaching the composer instead of search)
// silently mismeasures every scenario after it, and the numbers look like an
// app regression rather than a harness bug. Each scenario also asserts what it
// expects to be looking at before timing — and a scroll scenario that the
// transcript never moved under is reported as skipped, not as a fast one.
//
// What this cannot see: the bytes written to a real terminal and the
// terminal's own paint. The test renderer diffs into memory, so the native
// column is the cost of producing a frame, not of a PTY accepting it.
//
// Timing keypresses directly does not work here: React 19 renders outside
// act()'s synchronous scope, and the test renderer's flush waits for a frame,
// so every scenario reports the same ~17ms.
import { spawnSync } from 'child_process'
import { mkdirSync, readdirSync } from 'fs'
import { tmpdir as osTmpdir } from 'os'
import { join as joinPath } from 'path'
import { fileURLToPath } from 'url'
import type { ProfilerOnRenderCallback } from 'react'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import type { TuiDensity, TuiTranscriptView } from '../theme'
import { buildInputPerfMessages, resolveInputPerfFixtureKind } from './inputPerfFixture'
import { formatTuiFrameBudgetMs, summarizeFrameTimes, TUI_FRAME_BUDGET_MS, TUI_TARGET_FPS } from './performanceBudget'

type Press =
  | { key: string; shift?: boolean; ctrl?: boolean }
  // One wheel notch over the middle of the transcript.
  | { wheel: 'up' | 'down' }
  // Bytes straight to stdin, for keys the mock has no name for (PgUp/PgDn).
  | { raw: string }

type Scenario = {
  name: string
  // Transcript view the app boots into (default: the card view).
  view?: TuiTranscriptView
  // Pressed once before the timed window (focus moves, mode switches).
  setup?: Press[]
  // Cycled through for the timed window…
  press: Press[]
  // …or, when present, for its second half: scroll away, then scroll back.
  thenPress?: Press[]
  // Substring the frame must contain once setup has run (any one of several).
  // The guard against measuring a surface the harness never actually reached.
  expect?: string | string[]
  // The reader must be focused over a transcript taller than its viewport.
  reader?: boolean
  // The transcript must actually move during the window.
  scrolls?: boolean
  // Events per tick. A trackpad fling delivers several notches per frame.
  burst?: number
  intervalMs?: number
  seconds?: number
  // Hermetic runs only: the mounted window must travel at least this far.
  minCardsCrossed?: number
}

// Keep benchmark clock reads behind a function so React Doctor does not treat
// the child-process harness's top-level timing loop as render-time impurity.
const monotonicNow = () => performance.now()

const TAB: Press = { key: 'tab' }
const keys = (text: string): Press[] => text.split('').map((key) => ({ key }))
const OPEN_THREE_TABS: Press[] = [
  TAB, TAB,
  { key: 'j' }, { key: 'j' }, TAB, TAB,
  { key: 'j' }, { key: 'j' }, TAB, TAB,
]
const ADD_COLUMN_SPLIT: Press[] = [{ key: 'b', ctrl: true }, { key: '%' }]
const ADD_ROW_SPLIT: Press[] = [{ key: 'b', ctrl: true }, { key: '"' }]
// An unfocused pane's border says how to reach it — unless the notice that
// announces the split is still drawn over that border, which says the same.
const SPLIT_OPEN = ['⌃B 1 focus', 'Split panes: 1']
// Only a focused pane offers the way back to the reader in the status bar.
const PANE_FOCUSED = 'esc reader'
const PAGE_UP: Press = { raw: '\x1b[5~' }
const PAGE_DOWN: Press = { raw: '\x1b[6~' }

// Every way a transcript is scrolled, once per view. The reader opens on the
// tail, so each scenario scrolls away for the first half of its window and
// back for the second; the sustained wheel only ever goes up, far enough to
// cross the reader's sliding card window many times.
const SCROLL_VIEWS: Array<{ prefix: string; view: TuiTranscriptView }> = [
  { prefix: 'card', view: 'conversation' },
  { prefix: 'stream', view: 'stream' },
  { prefix: 'scrollback', view: 'scrollback' },
  { prefix: 'transcript', view: 'transcript' },
]
const SUSTAINED_SECONDS = Number.parseInt(process.env.INPUT_SUSTAINED_SECONDS ?? '', 10) || 40
// The sustained wheel exists to cross the sliding card window repeatedly; a
// run that did not get that far measured ordinary scrolling under its name.
const SUSTAINED_MIN_CARDS = Number.parseInt(process.env.INPUT_SUSTAINED_MIN_CARDS ?? '', 10) || 1000
const scrollScenarios = ({ prefix, view }: { prefix: string; view: TuiTranscriptView }): Scenario[] => {
  const base = { view, setup: [TAB], reader: true, scrolls: true }
  return [
    { ...base, name: `${prefix}-line`, press: [{ key: 'k' }], thenPress: [{ key: 'j' }] },
    { ...base, name: `${prefix}-halfpage`, press: [{ key: 'u', ctrl: true }], thenPress: [{ key: 'd', ctrl: true }] },
    { ...base, name: `${prefix}-page`, press: [PAGE_UP], thenPress: [PAGE_DOWN] },
    { ...base, name: `${prefix}-ends`, press: [{ key: 'g' }, { key: 'G', shift: true }] },
    { ...base, name: `${prefix}-wheel`, press: [{ wheel: 'up' }], thenPress: [{ wheel: 'down' }], burst: 3, intervalMs: 16 },
    {
      ...base,
      name: `${prefix}-wheel-sustained`,
      press: [{ wheel: 'up' }],
      burst: 12,
      intervalMs: 16,
      seconds: SUSTAINED_SECONDS,
      minCardsCrossed: SUSTAINED_MIN_CARDS,
    },
  ]
}

const SCENARIOS: Scenario[] = [
  { name: 'sidebar-scroll', press: [{ key: 'j' }] },
  { name: 'sidebar-scroll-alt', press: [{ key: 'j' }, { key: 'k' }] },
  ...SCROLL_VIEWS.flatMap(scrollScenarios),
  { name: 'reader-expand', setup: [TAB, { key: 'k' }], press: [{ key: 'return' }], reader: true },
  // `(`/`)` step between conversation cards, `{`/`}` between technical ones —
  // jumps that skip whatever lies between. (`[`/`]` are bookmark jumps, which
  // do nothing in a session with no bookmarks; timing them timed a no-op.)
  { name: 'conversation-jump', setup: [TAB], press: [{ key: '(' }], thenPress: [{ key: ')' }], reader: true, scrolls: true },
  { name: 'technical-jump', setup: [TAB], press: [{ key: '{' }], thenPress: [{ key: '}' }], reader: true, scrolls: true },
  { name: 'focus-toggle', press: [TAB] },
  { name: 'view-cycle', press: [{ key: 'v' }] },
  { name: 'transcript-search', setup: [TAB, { key: '/' }], press: keys('session'), expect: 'SEARCH' },
  { name: 'sidebar-search', setup: [{ key: '/' }], press: keys('agent') },
  { name: 'composer-type', setup: [TAB, { key: 'c' }], press: keys('rendering-performance'), expect: 'send' },
  {
    name: 'composer-window-type',
    setup: [TAB, { key: 'c' }, { key: 'o', ctrl: true }],
    press: keys('expanded-composer-performance'),
    expect: 'send',
  },
  { name: 'composer-slash-filter', setup: [TAB, { key: 'c' }], press: keys('/model'), expect: 'send' },
  { name: 'composer-mention-filter', setup: [TAB, { key: 'c' }], press: keys('@src'), expect: 'send' },
  { name: 'command-palette-nav', setup: [{ key: '?' }], press: [{ key: 'j' }, { key: 'k' }], expect: 'type to filter' },
  { name: 'command-palette-filter', setup: [{ key: '?' }], press: keys('transcript'), expect: 'type to filter' },
  { name: 'editor-nav', setup: [{ key: 'e', ctrl: true }], press: [{ key: 'j' }, { key: 'k' }], expect: 'EDITOR' },
  // Opening a second tab: Tab into the reader promotes the preview to a tab, so
  // focusing two different sessions leaves two tabs to switch between.
  {
    name: 'tab-switch',
    setup: [TAB, TAB, { key: 'j' }, { key: 'j' }, TAB, TAB],
    press: [{ key: 'ARROW_LEFT' }, { key: 'ARROW_RIGHT' }],
  },
  {
    name: 'split-reader-columns',
    setup: [...OPEN_THREE_TABS, ...ADD_COLUMN_SPLIT],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: SPLIT_OPEN,
  },
  {
    name: 'split-pane-columns',
    setup: [...OPEN_THREE_TABS, ...ADD_COLUMN_SPLIT, { key: 'b', ctrl: true }, { key: 'o' }],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: PANE_FOCUSED,
  },
  {
    name: 'split-reader-rows',
    setup: [...OPEN_THREE_TABS, ...ADD_ROW_SPLIT, ...ADD_ROW_SPLIT],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: '⌃B 2 focus',
  },
  {
    name: 'split-pane-rows',
    setup: [...OPEN_THREE_TABS, ...ADD_ROW_SPLIT, ...ADD_ROW_SPLIT, { key: 'b', ctrl: true }, { key: 'o' }],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: PANE_FOCUSED,
  },
]

const SECONDS = Number.parseInt(process.env.INPUT_SECONDS ?? '', 10) || 5
// Roughly a held key at the default macOS repeat rate.
const PRESS_INTERVAL_MS = Number.parseInt(process.env.INPUT_PRESS_MS ?? '', 10) || 33
const only = process.env.INPUT_SCENARIO
const useRealSessions = process.env.INPUT_REAL_SESSIONS === '1'
const fixtureKind = resolveInputPerfFixtureKind(process.env.INPUT_FIXTURE)
const fixtureMessageCount = Number.parseInt(process.env.INPUT_FIXTURE_MESSAGES ?? '', 10) || 10_000
const fixtureSessionCount = Number.parseInt(process.env.INPUT_FIXTURE_SESSIONS ?? '', 10) || 120

type TimeSummary = { count: number; over: number; p50: number; p95: number; worst: number }
type ScenarioResult = {
  frames: TimeSummary
  // Worst tree pass (Yoga layout + draw) and worst remainder (native diff).
  treeWorst: number
  nativeWorst: number
  commits: number
  over: number
  worst: number
  renderWorst: number
  commitWorst: number
  renderTotal: number
  commitTotal: number
  cards: number
  mounted: number
  moved: number
  slides: number
  cardsCrossed: number
  memory?: unknown
}

// ── Parent: fan the scenarios out, one child each ────────────────────────────
if (!process.env.INPUT_CHILD) {
  const selfPath = fileURLToPath(import.meta.url)
  const selected = SCENARIOS.filter((scenario) => (
    !only || scenario.name === only || (only.endsWith('-') && scenario.name.startsWith(only))
  ))
  if (process.env.INPUT_LIST === '1') {
    for (const scenario of SCENARIOS) console.log(scenario.name)
    process.exit(0)
  }
  const cpuProfile = process.env.INPUT_CPU_PROFILE === '1'
  if (cpuProfile && selected.length !== 1) {
    console.error(`INPUT_CPU_PROFILE=1 profiles exactly one scenario; INPUT_SCENARIO=${only ?? '(unset)'} selects ${selected.length}.`)
    process.exit(2)
  }
  const ms = (value: number) => value.toFixed(1)
  const columns: Array<[string, number]> = [
    ['frames', 7], ['f-p50', 6], ['f-p95', 6], ['f-worst', 8], ['f-over', 7],
    ['commits', 8], ['c-over', 7], ['c-worst', 8], ['render', 7], ['commit', 7],
    ['cards', 6], ['moved', 6], ['slides', 7],
  ]
  let measuredScenarios = 0
  let skippedScenarios = 0
  let totalOverBudget = 0
  console.log(`\nframe and render cost per navigation surface (${SECONDS}s at ${PRESS_INTERVAL_MS}ms key repeat unless the scenario says otherwise)`)
  console.log(`  workload ${useRealSessions ? 'live local sessions' : `hermetic ${fixtureKind} ${fixtureMessageCount}-message/${fixtureSessionCount}-session fixture`}`)
  console.log(`  target ${TUI_TARGET_FPS}fps (${formatTuiFrameBudgetMs()}ms budget) · times in ms`)
  console.log('  f-* = whole renderer frames (callbacks + Yoga layout + draw + native diff); c-* = React commits;')
  console.log('  render/commit = worst React render (actualDuration) and worst post-mutation commit; moved = ticks the transcript moved on;')
  console.log('  slides = times the mounted card window changed')
  console.log(`  ${'scenario'.padEnd(27)}${columns.map(([label, width]) => label.padStart(width)).join('')}`)
  for (const scenario of selected) {
    const profileDir = cpuProfile
      ? process.env.INPUT_CPU_PROFILE_DIR
        ?? joinPath(osTmpdir(), 'agent-viewer-input-perf-profiles', `${scenario.name}-${Date.now()}`)
      : null
    if (profileDir) mkdirSync(profileDir, { recursive: true })
    const run = spawnSync(
      'bun',
      [...(profileDir ? ['--cpu-prof', '--cpu-prof-md', `--cpu-prof-dir=${profileDir}`] : []), selfPath],
      {
        env: { ...process.env, INPUT_CHILD: '1', INPUT_SCENARIO: scenario.name },
        encoding: 'utf8',
        timeout: 600_000,
        maxBuffer: 256 * 1024 * 1024,
      },
    )
    if (profileDir) {
      const written = readdirSync(profileDir).map((file) => joinPath(profileDir, file))
      console.log(written.length > 0
        ? `CPU profile for ${scenario.name}:\n${written.map((file) => `    ${file}`).join('\n')}`
        : `CPU profile for ${scenario.name}: nothing was written to ${profileDir}`)
    }
    const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '))
    if (!line) {
      const why = (run.stdout ?? '').split('\n').find((l) => l.startsWith('SKIP '))
        ?? (run.error ? `SKIP ${run.error.message}` : `SKIP no result (exit ${run.status})`)
      console.log(`  ${scenario.name.padEnd(27)} ${why.replace(/^SKIP /, '')}`)
      skippedScenarios += 1
      continue
    }
    const result = JSON.parse(line.slice('RESULT '.length)) as ScenarioResult
    measuredScenarios += 1
    totalOverBudget += result.over + result.frames.over
    const cells = [
      String(result.frames.count), ms(result.frames.p50), ms(result.frames.p95), ms(result.frames.worst), String(result.frames.over),
      String(result.commits), String(result.over), ms(result.worst), ms(result.renderWorst), ms(result.commitWorst),
      String(result.cards), String(result.moved), String(result.slides),
    ]
    console.log(`  ${scenario.name.padEnd(27)}${cells.map((cell, index) => cell.padStart(columns[index][1])).join('')}`)
    if (process.env.INPUT_JSON === '1') console.log(`JSON ${JSON.stringify({ scenario: scenario.name, ...result })}`)
    if (result.memory) console.log(`MEMORY ${JSON.stringify({ scenario: scenario.name, ...result.memory as object })}`)
  }
  if (measuredScenarios === 0 || skippedScenarios > 0 || totalOverBudget > 0) {
    console.error(
      `Input performance gate failed: ${totalOverBudget} frame(s)/commit(s) exceeded ${formatTuiFrameBudgetMs()}ms; `
      + `${skippedScenarios} scenario(s) skipped.`,
    )
    process.exit(1)
  }
  console.log(`Input performance gate passed: all ${measuredScenarios} scenarios stayed within ${formatTuiFrameBudgetMs()}ms.`)
  process.exit(0)
}

// ── Child: boot the app and drive exactly one scenario ───────────────────────
const { mkdtempSync, readFileSync } = await import('fs')
const { tmpdir } = await import('os')
const path = await import('path')
const React = (await import('react')).default
const { act } = await import('react')
const { testRender } = await import('./testRender')

const scenario = SCENARIOS.find((s) => s.name === only)
if (!scenario) {
  console.log(`SKIP unknown scenario ${only}`)
  process.exit(0)
}

async function sampleRetainedMemory() {
  if (process.env.INPUT_MEMORY !== '1') return null
  // @ts-expect-error Bun-only diagnostics, including native allocations in RSS.
  const { heapStats } = await import('bun:jsc')
  ;(globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
  const { heapSize, objectCount } = heapStats()
  return { heapSize: heapSize as number, objectCount: objectCount as number, rssBytes: process.memoryUsage.rss() }
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-viewer-input-perf-'))
process.chdir(dataDir)
const perfLog = path.join(dataDir, 'frames.log')
const metricsLog = path.join(dataDir, 'metrics.jsonl')
process.env.AGENT_VIEWER_PERF = '1'
process.env.AGENT_VIEWER_PERF_LOG = perfLog
// Gauges carry the transcript size, which is what most of the run-to-run
// variance in these numbers actually is.
process.env.AGENT_VIEWER_TUI_METRICS = '1'
process.env.AGENT_VIEWER_TUI_METRICS_INTERVAL = '5'
process.env.AGENT_VIEWER_TUI_METRICS_LOG = metricsLog

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const service = await import('../../lib/tui/service')
const scenarioView: TuiTranscriptView = scenario.view ?? 'conversation'
// The view is a scenario input, never whatever tui.json last held.
const viewOverrides = {
  readTuiTranscriptView: async () => scenarioView,
  writeTuiTranscriptView: async () => {},
}
// Card key → transcript index, so the mounted window can be located.
const cardIndexByKey = new Map<string, number>()

if (useRealSessions) {
  mock.module('../../lib/tui/service', () => ({ ...service, ...viewOverrides }))
} else {
  const fixedTimestamp = Date.UTC(2026, 0, 1)
  const provider = fixtureKind === 'trivial' ? 'codex' as const : 'claude' as const
  const rawMessages = buildInputPerfMessages(fixtureKind, fixtureMessageCount, 'input-perf-session-0')
  const { buildThreadedMessages } = await import('../../lib/threading')
  const { formatTranscriptCards } = await import('../format')
  const threadedMessages = buildThreadedMessages(rawMessages)
  const cardsByDensity = new Map<TuiDensity, TuiTranscriptCard[]>()
  const cardsFor = (density: TuiDensity) => {
    let cards = cardsByDensity.get(density)
    if (!cards) {
      cards = formatTranscriptCards(threadedMessages, density)
      cardsByDensity.set(density, cards)
    }
    return cards
  }
  cardsFor('balanced').forEach((card, index) => cardIndexByKey.set(card.key, index))
  const sessions: Session[] = Array.from({ length: fixtureSessionCount }, (_, index) => ({
    sessionId: `input-perf-session-${index}`,
    provider,
    cwd: dataDir,
    summary: `Input performance fixture ${index}`,
    // Distinct per session on purpose: the app's "detail unchanged" bail-out
    // compares message fingerprints, model and title but not which session the
    // detail belongs to, and every session here carries the same transcript.
    customTitle: `Input performance fixture ${index}`,
    firstPrompt: `Inspect deterministic workload ${index}`,
    lastModified: fixedTimestamp - index * 1_000,
  }))
  // Every session carries the same transcript, but each must answer as ITSELF:
  // the reader keeps its transcript unmounted while the displayed detail
  // belongs to a session other than the selected one (isScrubbing). A detail
  // that always claimed to be session 0 left every reader scenario timing "…".
  const detailFor = (session: Session, density: TuiDensity = 'balanced', showToolCalls = true) => ({
    info: sessions.find((candidate) => candidate.sessionId === session.sessionId) ?? sessions[0],
    rawMessages,
    threadedMessages,
    transcriptCards: cardsFor(density),
    transcriptCardsDensity: density,
    transcriptCardsShowToolCalls: showToolCalls,
    contextUsage: null,
  })
  const detailClient = await import('./sessionDetailWorkerClient')
  mock.module('./sessionDetailWorkerClient', () => ({
    ...detailClient,
    readTuiSessionsAsync: async () => sessions,
    readTuiSessionDetailAsync: async (session: Session, density: TuiDensity, showToolCalls: boolean) => (
      detailFor(session, density, showToolCalls)
    ),
    formatTranscriptCardsAsync: async (_session: Session, _threaded: unknown, density: TuiDensity) => cardsFor(density),
    getTranscriptCardsSync: (_session: Session, _threaded: unknown, density: TuiDensity) => cardsFor(density),
    warmTranscriptAsync: async () => {},
  }))
  const metadataClient = await import('./metadataWorkerClient')
  mock.module('./metadataWorkerClient', () => ({
    ...metadataClient,
    readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
  }))
  mock.module('../../lib/tui/service', () => ({
    ...service,
    ...viewOverrides,
    readTuiSessions: async () => sessions,
    readTuiSessionDetail: async (session: Session) => detailFor(session),
    readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
    readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
    listTuiRunningSessions: async () => [],
    prewarmTuiSession: async () => {},
    readTuiSlashCommands: async () => [],
    readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  }))
}

const { default: OpenTuiApp } = await import('./App')

const profiled = { commits: 0, over: 0, worst: 0, renderWorst: 0, commitWorst: 0, renderTotal: 0, commitTotal: 0 }
let profileWindowOpen = false
const recordProfileFrame: ProfilerOnRenderCallback = (
  _id,
  _phase,
  actualDuration,
  _baseDuration,
  _startTime,
  commitTime,
) => {
  if (!profileWindowOpen) return
  // The callback runs after React has applied the renderer mutations. Add the
  // render CPU time to the commit phase elapsed so root AND child-local updates
  // are covered. Do not use `now - startTime`: concurrent work may legitimately
  // wait for the test renderer's next flush, which is scheduling latency rather
  // than time spent producing a frame.
  const commitMs = Math.max(0, performance.now() - commitTime)
  const durationMs = actualDuration + commitMs
  profiled.renderWorst = Math.max(profiled.renderWorst, actualDuration)
  profiled.commitWorst = Math.max(profiled.commitWorst, commitMs)
  profiled.renderTotal += actualDuration
  profiled.commitTotal += commitMs
  if (process.env.INPUT_DEBUG_PROFILE === '1' && durationMs > TUI_FRAME_BUDGET_MS) {
    console.error(`OVER commit=${durationMs.toFixed(2)}ms render=${actualDuration.toFixed(2)}ms post-mutation=${commitMs.toFixed(2)}ms phase=${_phase} commit#=${profiled.commits}`)
  }
  profiled.commits += 1
  if (durationMs > TUI_FRAME_BUDGET_MS) profiled.over += 1
  profiled.worst = Math.max(profiled.worst, durationMs)
}

const setup = await testRender(
  <React.Profiler id="OpenTuiApp" onRender={recordProfileFrame}>
    <OpenTuiApp />
  </React.Profiler>,
  { width: 140, height: 44, kittyKeyboard: true },
)

// ── Whole-frame clock ────────────────────────────────────────────────────────
// `loop` is one pass of the renderer: frame callbacks, then the tree pass
// (Yoga layout and every renderable drawing into the next buffer), then the
// native diff. Every frame the app produces goes through it, whether React
// committed or a scrollbox merely moved, so wrapping it is the only clock that
// sees native scrolling. A call that returns without advancing the frame id
// was the re-entrancy guard, not a frame.
// OpenTUI 0.6 paints natively and has no JS tree pass to wrap (`root.render` is
// gone); the renderer reports the scene's layout + paint time itself.
type RendererInternals = {
  loop(): Promise<void>
  frameId: number
  lastSceneTimeMs: number
}
const rendererInternals = setup.renderer as unknown as RendererInternals
const frameTimes: number[] = []
let treeWorst = 0
let nativeWorst = 0
let treeMsThisFrame = 0
const originalLoop = rendererInternals.loop.bind(setup.renderer)
rendererInternals.loop = async () => {
  const frameBefore = rendererInternals.frameId
  const startedAt = performance.now()
  await originalLoop()
  const durationMs = performance.now() - startedAt
  treeMsThisFrame = rendererInternals.frameId === frameBefore ? 0 : rendererInternals.lastSceneTimeMs
  if (!profileWindowOpen || rendererInternals.frameId === frameBefore) return
  frameTimes.push(durationMs)
  treeWorst = Math.max(treeWorst, treeMsThisFrame)
  nativeWorst = Math.max(nativeWorst, durationMs - treeMsThisFrame)
  if (process.env.INPUT_DEBUG_PROFILE === '1' && durationMs > TUI_FRAME_BUDGET_MS) {
    console.error(`OVER frame=${durationMs.toFixed(2)}ms tree=${treeMsThisFrame.toFixed(2)}ms rest=${(durationMs - treeMsThisFrame).toFixed(2)}ms`)
  }
}

// ── Transcript probe ─────────────────────────────────────────────────────────
type ProbeNode = { id: string; getChildren(): ProbeNode[] }
type TranscriptScrollbox = {
  scrollTop: number
  scrollHeight: number
  x: number
  y: number
  width: number
  height: number
  focused: boolean
  viewport: { height: number }
  content: ProbeNode
}
// Cached: a full-tree findDescendantById per press was ~10% of a sustained
// wheel profile, all of it the harness's own, competing with the app on the
// same thread. Re-found when the scrollbox is replaced.
let cachedTranscript: (TranscriptScrollbox & { isDestroyed?: boolean }) | undefined
const transcript = () => {
  if (!cachedTranscript || cachedTranscript.isDestroyed) {
    cachedTranscript = setup.renderer.root.findDescendantById('transcript-scroll') as unknown as typeof cachedTranscript
  }
  return cachedTranscript
}
// A tool row's `card:` id sits one level down, inside a centering wrapper.
const cardKeyOf = (node: ProbeNode): string | null => {
  if (node.id.startsWith('card:')) return node.id.slice('card:'.length)
  const inner = node.getChildren()[0]
  return inner?.id.startsWith('card:') ? inner.id.slice('card:'.length) : null
}
const mountedWindow = () => {
  const keys: string[] = []
  for (const child of transcript()?.content.getChildren() ?? []) {
    const key = cardKeyOf(child)
    if (key) keys.push(key)
  }
  return { first: keys[0] ?? null, count: keys.length }
}

const send = async (p: Press) => {
  if ('wheel' in p) {
    const sb = transcript()
    if (!sb) return
    await setup.mockMouse.scroll(sb.x + Math.floor(sb.width / 2), sb.y + Math.floor(sb.height / 2), p.wheel)
  } else if ('raw' in p) setup.renderer.stdin.emit('data', Buffer.from(p.raw))
  else if (p.key === 'tab') setup.mockInput.pressTab()
  else if (p.key === 'return') setup.mockInput.pressEnter()
  else setup.mockInput.pressKey(p.key, { shift: p.shift, ctrl: p.ctrl })
}

// Flush on a frame cadence: React's scheduler is driven by act() under the test
// renderer, so a single flush then a long sleep lets queued work pile up and
// report as one giant frame that no real render loop would ever produce.
const settle = async (ms: number) => {
  const until = performance.now() + ms
  do {
    await act(async () => {
      await setup.flush()
      await new Promise((r) => setTimeout(r, 16))
    })
  } while (performance.now() < until)
}

const skip = (why: string): never => {
  if (process.env.INPUT_DEBUG_FRAME === '1') console.error(setup.captureCharFrame())
  console.log(`SKIP ${why}`)
  process.exit(0)
}

await settle(3000)
// Open a session so the reader has a real transcript to lay out.
await act(async () => { await send({ key: 'j' }) })
await settle(2000)

for (const press of scenario.setup ?? []) {
  await act(async () => { await send(press) })
  await settle(200)
}
await settle(500)

if (scenario.expect) {
  const frame = setup.captureCharFrame()
  const anyOf = Array.isArray(scenario.expect) ? scenario.expect : [scenario.expect]
  if (!anyOf.some((marker) => frame.includes(marker))) {
    skip(`precondition not met (frame missing ${anyOf.map((marker) => JSON.stringify(marker)).join(' or ')})`)
  }
}
if (scenario.reader) {
  const sb = transcript()
  if (!sb) skip('precondition not met (no transcript scrollbox)')
  else if (mountedWindow().count === 0) skip('precondition not met (transcript has no cards mounted)')
  else if (sb.scrollHeight <= sb.viewport.height) skip('precondition not met (transcript does not overflow its viewport)')
  else if (!sb.focused) skip('precondition not met (transcript is not focused)')
}

const seconds = scenario.seconds ?? SECONDS
const intervalMs = scenario.intervalMs ?? PRESS_INTERVAL_MS
const burst = scenario.burst ?? 1
const memoryBefore = await sampleRetainedMemory()
let lastScrollTop = transcript()?.scrollTop ?? 0
let lastWindowFirst = mountedWindow().first
let minCardIndex = lastWindowFirst == null ? Infinity : cardIndexByKey.get(lastWindowFirst) ?? Infinity
let maxCardIndex = minCardIndex === Infinity ? -Infinity : minCardIndex
let moved = 0
let slides = 0
let mounted = 0
const startedAt = monotonicNow()
const until = startedAt + seconds * 1000
let i = 0
if (process.env.INPUT_COUNT_NODES === '1') {
  // What a mounted card is made of: renderables per card, by constructor.
  const byType = new Map<string, number>()
  let cards = 0
  let total = 0
  const walk = (node: ProbeNode) => { total += 1; const t = (node as unknown as { constructor: { name: string } }).constructor.name; byType.set(t, (byType.get(t) ?? 0) + 1); for (const c of node.getChildren()) walk(c) }
  for (const child of transcript()?.content.getChildren() ?? []) { if (cardKeyOf(child)) { cards += 1; walk(child) } }
  if (process.env.INPUT_DUMP_CARD) {
    const dump = (node: ProbeNode, depth: number): string => { const n = node as unknown as { constructor: { name: string }; id: string; width: number; height: number; flexDirection?: string }; return `${'  '.repeat(depth)}${n.constructor.name.replace(/Renderable2?$/, '')} ${n.id} ${n.width}x${n.height} ${JSON.stringify(String((node as any).plainText ?? '').slice(0, 50))}\n` + node.getChildren().map((c) => dump(c, depth + 1)).join('') }
    const kids = (transcript()?.content.getChildren() ?? []).filter((c) => cardKeyOf(c))
    for (const index of process.env.INPUT_DUMP_CARD.split(',').map(Number)) console.log(dump(kids[index], 0))
  }
  console.log(`nodes: ${cards} cards, ${total} renderables (${(total / Math.max(cards, 1)).toFixed(1)}/card)`, JSON.stringify([...byType].sort((a, b) => b[1] - a[1])))
}
if (process.env.INPUT_FOCUS_TRACE === '1') {
  // The reader's first focus expands cards in stages at the tail; the viewport
  // must stay on the bottom through every stage.
  await act(async () => { await send({ key: 'tab' } as Press) })
  const samples: string[] = []
  for (let i = 0; i < 40; i++) {
    await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 10)) })
    const sb = transcript()
    if (sb) samples.push(`${sb.scrollHeight - sb.viewport.height - sb.scrollTop}`)
  }
  console.log('FOCUS TRACE distance-from-bottom per frame:', samples.join(','))
}
profileWindowOpen = true
while (monotonicNow() < until) {
  const presses = scenario.thenPress && monotonicNow() - startedAt > seconds * 500 ? scenario.thenPress : scenario.press
  await act(async () => {
    for (let n = 0; n < burst; n += 1) await send(presses[i++ % presses.length])
  })
  await settle(intervalMs)
  // Read between frames, outside both clocks.
  const sb = transcript()
  if (sb) {
    const window = mountedWindow()
    mounted = Math.max(mounted, window.count)
    if (window.first !== lastWindowFirst) {
      slides += 1
      lastWindowFirst = window.first
      const index = window.first == null ? undefined : cardIndexByKey.get(window.first)
      if (index !== undefined) {
        minCardIndex = Math.min(minCardIndex, index)
        maxCardIndex = Math.max(maxCardIndex, index)
      }
      lastScrollTop = sb.scrollTop
      moved += 1
    } else if (sb.scrollTop !== lastScrollTop) {
      lastScrollTop = sb.scrollTop
      moved += 1
    }
  }
}
profileWindowOpen = false
if (scenario.scrolls && moved === 0) skip('the transcript never moved during the timed window')
const cardsCrossed = Number.isFinite(minCardIndex) ? maxCardIndex - minCardIndex : 0
if (!useRealSessions && scenario.minCardsCrossed && cardsCrossed < scenario.minCardsCrossed) {
  skip(`the card window crossed ${cardsCrossed} cards in ${slides} slides; this scenario needs ${scenario.minCardsCrossed} (raise INPUT_SUSTAINED_SECONDS)`)
}
// Let the last metrics sample and any asynchronous logging flush.
await settle(1500)
const memoryAfter = await sampleRetainedMemory()

let cards = 0
try {
  for (const raw of readFileSync(metricsLog, 'utf8').trim().split('\n')) {
    const total = JSON.parse(raw)?.gauges?.readerWindowTotal
    if (typeof total === 'number') cards = Math.max(cards, total)
  }
} catch { /* gauges are a nicety; the frame numbers are the result */ }
const result: ScenarioResult = {
  frames: summarizeFrameTimes(frameTimes),
  treeWorst,
  nativeWorst,
  commits: profiled.commits,
  over: profiled.over,
  worst: profiled.worst,
  renderWorst: profiled.renderWorst,
  commitWorst: profiled.commitWorst,
  renderTotal: profiled.renderTotal,
  commitTotal: profiled.commitTotal,
  cards,
  mounted,
  moved,
  slides,
  cardsCrossed,
  memory: memoryBefore && memoryAfter ? { before: memoryBefore, after: memoryAfter } : undefined,
}
console.log(`RESULT ${JSON.stringify(result)}`)
if (process.env.INPUT_DEBUG_PROFILE === '1') console.error(`PROFILE ${JSON.stringify(result)}`)
if (process.env.INPUT_DEBUG_FRAME === '1') console.error(setup.captureCharFrame())
process.exit(0)

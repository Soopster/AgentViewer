/** @jsxImportSource @opentui/react */
// Render-cost harness for the OpenTUI navigation surfaces. Mounts the real root
// against a hermetic 10k-message/120-session workload by default, drives one
// surface at key-repeat speed, and reports what a React Profiler around the
// real root saw (including child-local pane/editor updates):
// commits, how many blew the target budget, and the worst one. A frame over
// budget is a frame the terminal cannot repaint in, which is what
// unresponsiveness actually is.
//
//   bun tui/opentui/inputPerf.tsx                     # every scenario
//   INPUT_SCENARIO=reader-scroll bun tui/opentui/inputPerf.tsx
//   INPUT_SECONDS=8 bun tui/opentui/inputPerf.tsx     # longer window each
//   INPUT_REAL_SESSIONS=1 bun tui/opentui/inputPerf.tsx # field diagnostic
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
// expects to be looking at before timing, so a mis-driven surface fails loudly
// instead of reporting a suspiciously good number.
//
// Timing keypresses directly does not work here: React 19 renders outside
// act()'s synchronous scope, and the test renderer's flush waits for a frame,
// so every scenario reports the same ~17ms. The Profiler measures each commit.
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import type { ProfilerOnRenderCallback } from 'react'
import type { Session, SessionMessage } from '../../lib/types'
import { formatTuiFrameBudgetMs, TUI_FRAME_BUDGET_MS, TUI_TARGET_FPS } from './performanceBudget'

type Press = { key: string; shift?: boolean; ctrl?: boolean }

type Scenario = {
  name: string
  // Pressed once before the timed window (focus moves, mode switches).
  setup?: Press[]
  // Cycled through for the timed window.
  press: Press[]
  // Substring the frame must contain once setup has run. The guard against
  // measuring a surface the harness never actually reached.
  expect?: string
}

// Keep benchmark clock reads behind a function so React Doctor does not treat
// the child-process harness's top-level timing loop as render-time impurity.
const monotonicNow = () => performance.now()

const TAB: Press = { key: 'tab' }
const READER_FOCUSED = 'b bookmark'
const OPEN_THREE_TABS: Press[] = [
  TAB, TAB,
  { key: 'j' }, { key: 'j' }, TAB, TAB,
  { key: 'j' }, { key: 'j' }, TAB, TAB,
]
const ADD_COLUMN_SPLIT: Press[] = [{ key: 'b', ctrl: true }, { key: '%' }]
const ADD_ROW_SPLIT: Press[] = [{ key: 'b', ctrl: true }, { key: '"' }]

const SCENARIOS: Scenario[] = [
  { name: 'sidebar-scroll', press: [{ key: 'j' }] },
  { name: 'sidebar-scroll-alt', press: [{ key: 'j' }, { key: 'k' }] },
  { name: 'reader-scroll', setup: [TAB], press: [{ key: 'j' }], expect: READER_FOCUSED },
  { name: 'reader-scroll-alt', setup: [TAB], press: [{ key: 'j' }, { key: 'k' }], expect: READER_FOCUSED },
  { name: 'reader-page', setup: [TAB], press: [{ key: 'd', ctrl: true }, { key: 'u', ctrl: true }], expect: READER_FOCUSED },
  { name: 'reader-jump-ends', setup: [TAB], press: [{ key: 'G', shift: true }, { key: 'g' }], expect: READER_FOCUSED },
  { name: 'reader-expand', setup: [TAB], press: [{ key: 'return' }], expect: READER_FOCUSED },
  { name: 'focus-toggle', press: [TAB] },
  { name: 'view-cycle', press: [{ key: 'v' }] },
  { name: 'transcript-search', setup: [TAB, { key: '/' }], press: 'session'.split('').map((k) => ({ key: k })), expect: 'SEARCH' },
  { name: 'sidebar-search', setup: [{ key: '/' }], press: 'agent'.split('').map((k) => ({ key: k })) },
  {
    name: 'composer-type',
    setup: [TAB, { key: 'c' }],
    press: 'rendering-performance'.split('').map((key) => ({ key })),
    expect: 'send',
  },
  {
    name: 'composer-window-type',
    setup: [TAB, { key: 'c' }, { key: 'o', ctrl: true }],
    press: 'expanded-composer-performance'.split('').map((key) => ({ key })),
    expect: 'send',
  },
  {
    name: 'composer-slash-filter',
    setup: [TAB, { key: 'c' }],
    press: '/model'.split('').map((key) => ({ key })),
    expect: 'send',
  },
  {
    name: 'composer-mention-filter',
    setup: [TAB, { key: 'c' }],
    press: '@src'.split('').map((key) => ({ key })),
    expect: 'send',
  },
  {
    name: 'command-palette-nav',
    setup: [{ key: '?' }],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: 'type to filter',
  },
  {
    name: 'command-palette-filter',
    setup: [{ key: '?' }],
    press: 'transcript'.split('').map((key) => ({ key })),
    expect: 'type to filter',
  },
  {
    name: 'editor-nav',
    setup: [{ key: 'e', ctrl: true }],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: 'EDITOR',
  },
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
    expect: '⌃B 1 focus',
  },
  {
    name: 'split-pane-columns',
    setup: [...OPEN_THREE_TABS, ...ADD_COLUMN_SPLIT, { key: 'b', ctrl: true }, { key: 'o' }],
    press: [{ key: 'j' }, { key: 'k' }],
    expect: 'split pane 1',
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
    expect: 'split pane 1',
  },
  { name: 'turn-jump', setup: [TAB], press: [{ key: '[' }, { key: ']' }], expect: READER_FOCUSED },
]

const SECONDS = Number.parseInt(process.env.INPUT_SECONDS ?? '', 10) || 5
// Roughly a held key at the default macOS repeat rate.
const PRESS_INTERVAL_MS = Number.parseInt(process.env.INPUT_PRESS_MS ?? '', 10) || 33
const only = process.env.INPUT_SCENARIO
const useRealSessions = process.env.INPUT_REAL_SESSIONS === '1'
const fixtureMessageCount = Number.parseInt(process.env.INPUT_FIXTURE_MESSAGES ?? '', 10) || 10_000
const fixtureSessionCount = Number.parseInt(process.env.INPUT_FIXTURE_SESSIONS ?? '', 10) || 120

// ── Parent: fan the scenarios out, one child each ────────────────────────────
if (!process.env.INPUT_CHILD) {
  const selfPath = fileURLToPath(import.meta.url)
  let measuredScenarios = 0
  let skippedScenarios = 0
  let totalOverBudget = 0
  console.log(`\nrender cost per navigation surface (${SECONDS}s at ${PRESS_INTERVAL_MS}ms key repeat)`)
  console.log(`  workload ${useRealSessions ? 'live local sessions' : `hermetic ${fixtureMessageCount}-message/${fixtureSessionCount}-session fixture`}`)
  console.log(`  target ${TUI_TARGET_FPS}fps (${formatTuiFrameBudgetMs()}ms frame budget)`)
  console.log(`  ${'scenario'.padEnd(20)} ${'commits'.padStart(8)} ${`over-${formatTuiFrameBudgetMs()}ms`.padStart(12)} ${'worst frame'.padStart(12)} ${'cards'.padStart(7)}`)
  for (const scenario of SCENARIOS) {
    if (only && scenario.name !== only) continue
    const run = spawnSync('bun', [selfPath], {
      env: { ...process.env, INPUT_CHILD: '1', INPUT_SCENARIO: scenario.name },
      encoding: 'utf8',
      timeout: 300_000,
    })
    const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '))
    if (!line) {
      const why = (run.stdout ?? '').split('\n').find((l) => l.startsWith('SKIP ')) ?? 'no result'
      console.log(`  ${scenario.name.padEnd(20)} ${why.replace(/^SKIP /, '')}`)
      skippedScenarios += 1
      continue
    }
    const parsed: unknown = JSON.parse(line.slice('RESULT '.length))
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('commits' in parsed) || typeof parsed.commits !== 'number'
      || !('over' in parsed) || typeof parsed.over !== 'number'
      || !('worst' in parsed) || typeof parsed.worst !== 'number'
      || !('cards' in parsed) || typeof parsed.cards !== 'number'
    ) {
      console.log(`  ${scenario.name.padEnd(20)} malformed result`)
      skippedScenarios += 1
      continue
    }
    const { commits, over, worst, cards } = parsed
    measuredScenarios += 1
    totalOverBudget += over
    console.log(
      `  ${scenario.name.padEnd(20)} ${String(commits).padStart(8)} ${String(over).padStart(12)} ${(worst.toFixed(1) + 'ms').padStart(12)} ${String(cards).padStart(7)}`,
    )
  }
  if (measuredScenarios === 0 || skippedScenarios > 0 || totalOverBudget > 0) {
    console.error(
      `Input performance gate failed: ${totalOverBudget} frame(s) exceeded ${formatTuiFrameBudgetMs()}ms; `
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
const { testRender } = await import('@opentui/react/test-utils')

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

if (!useRealSessions) {
  const sessionId = 'input-perf-session-0'
  const fixedTimestamp = Date.UTC(2026, 0, 1)
  const rawMessages: SessionMessage[] = Array.from({ length: fixtureMessageCount }, (_, index) => {
    const common = {
      uuid: `input-perf-message-${index}`,
      session_id: sessionId,
      parent_tool_use_id: null,
      timestamp: new Date(fixedTimestamp + index * 1_000).toISOString(),
      provider: 'codex' as const,
    }
    return index % 2 === 0
      ? { ...common, type: 'user', message: { role: 'user', content: `Inspect deterministic workload ${index}.` } }
      : {
          ...common,
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: `Deterministic response ${index} keeps the mounted reader window busy.` }],
          },
        }
  })
  const { buildThreadedMessages } = await import('../../lib/threading')
  const { formatTranscriptCards } = await import('../format')
  const threadedMessages = buildThreadedMessages(rawMessages)
  const transcriptCards = formatTranscriptCards(threadedMessages)
  const sessions: Session[] = Array.from({ length: fixtureSessionCount }, (_, index) => ({
    sessionId: `input-perf-session-${index}`,
    provider: 'codex' as const,
    cwd: dataDir,
    summary: `Input performance fixture ${index}`,
    firstPrompt: `Inspect deterministic workload ${index}`,
    lastModified: fixedTimestamp - index * 1_000,
  }))
  const detail = {
    info: sessions[0],
    rawMessages,
    threadedMessages,
    transcriptCards,
    contextUsage: null,
  }
  const bunTestSpecifier = 'bun:test'
  const { mock } = await import(bunTestSpecifier) as {
    mock: { module(specifier: string, factory: () => unknown): void }
  }
  const detailClient = await import('./sessionDetailWorkerClient')
  mock.module('./sessionDetailWorkerClient', () => ({
    ...detailClient,
    readTuiSessionsAsync: async () => sessions,
    readTuiSessionDetailAsync: async () => detail,
    formatTranscriptCardsAsync: async () => transcriptCards,
    getTranscriptCardsSync: () => transcriptCards,
    warmTranscriptAsync: async () => {},
  }))
  const metadataClient = await import('./metadataWorkerClient')
  mock.module('./metadataWorkerClient', () => ({
    ...metadataClient,
    readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
  }))
  const service = await import('../../lib/tui/service')
  mock.module('../../lib/tui/service', () => ({
    ...service,
    readTuiSessions: async () => sessions,
    readTuiSessionDetail: async () => detail,
    readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
    readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
    listTuiRunningSessions: async () => [],
    prewarmTuiSession: async () => {},
    readTuiSlashCommands: async () => [],
    readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  }))
}

const { default: OpenTuiApp } = await import('./App')

const scenario = SCENARIOS.find((s) => s.name === only)
if (!scenario) {
  console.log(`SKIP unknown scenario ${only}`)
  process.exit(0)
}

const profiledFrames = { commits: 0, over: 0, worst: 0, actualWorst: 0, commitWorst: 0 }
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
  const durationMs = actualDuration + Math.max(0, performance.now() - commitTime)
  profiledFrames.actualWorst = Math.max(profiledFrames.actualWorst, actualDuration)
  profiledFrames.commitWorst = Math.max(profiledFrames.commitWorst, Math.max(0, performance.now() - commitTime))
  if (process.env.INPUT_DEBUG_PROFILE === '1' && durationMs > TUI_FRAME_BUDGET_MS) {
    console.error(`OVER frame=${durationMs.toFixed(2)}ms actual=${actualDuration.toFixed(2)}ms commit=${(performance.now() - commitTime).toFixed(2)}ms`)
  }
  profiledFrames.commits += 1
  if (durationMs > TUI_FRAME_BUDGET_MS) profiledFrames.over += 1
  profiledFrames.worst = Math.max(profiledFrames.worst, durationMs)
}

const setup = await testRender(
  <React.Profiler id="OpenTuiApp" onRender={recordProfileFrame}>
    <OpenTuiApp />
  </React.Profiler>,
  { width: 140, height: 44, kittyKeyboard: true },
)

const send = (p: Press) => {
  if (p.key === 'tab') setup.mockInput.pressTab()
  else if (p.key === 'return') setup.mockInput.pressEnter()
  else setup.mockInput.pressKey(p.key, { shift: p.shift, ctrl: p.ctrl })
}

// Flush on a frame cadence: React's scheduler is driven by act() under the test
// renderer, so a single flush then a long sleep lets queued work pile up and
// report as one giant frame that no real render loop would ever produce.
const settle = async (ms: number) => {
  const until = performance.now() + ms
  while (performance.now() < until) {
    await act(async () => {
      await setup.flush()
      await new Promise((r) => setTimeout(r, 16))
    })
  }
}

await settle(3000)
// Open a session so the reader has a real transcript to lay out.
act(() => { setup.mockInput.pressKey('j') })
await settle(2000)

for (const press of scenario.setup ?? []) {
  act(() => { send(press) })
  await settle(200)
}
await settle(500)

const preconditionFrame = setup.captureCharFrame()
if (scenario.expect && !preconditionFrame.includes(scenario.expect)) {
  if (process.env.INPUT_DEBUG_FRAME === '1') console.error(preconditionFrame)
  console.log(`SKIP precondition not met (frame missing ${JSON.stringify(scenario.expect)})`)
  process.exit(0)
}

const until = monotonicNow() + SECONDS * 1000
let i = 0
profileWindowOpen = true
while (monotonicNow() < until) {
  act(() => { send(scenario.press[i++ % scenario.press.length]) })
  await settle(PRESS_INTERVAL_MS)
}
profileWindowOpen = false
// Let the last metrics sample and any asynchronous logging flush.
await settle(1500)

let cards = 0
try {
  for (const raw of readFileSync(metricsLog, 'utf8').trim().split('\n')) {
    const total = JSON.parse(raw)?.gauges?.readerWindowTotal
    if (typeof total === 'number') cards = Math.max(cards, total)
  }
} catch { /* gauges are a nicety; the frame numbers are the result */ }
console.log(`RESULT ${JSON.stringify({
  commits: profiledFrames.commits,
  over: profiledFrames.over,
  worst: profiledFrames.worst,
  cards,
})}`)
if (process.env.INPUT_DEBUG_PROFILE === '1') console.error(`PROFILE ${JSON.stringify(profiledFrames)}`)
process.exit(0)

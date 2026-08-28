/** @jsxImportSource @opentui/react */
// Render-cost harness for the OpenTUI navigation surfaces. Mounts the real root
// against the user's real local sessions, drives one surface at key-repeat
// speed, and reports what the app's own frame canary (AGENT_VIEWER_PERF) saw:
// commits, how many blew the 60fps budget, and the worst one. A frame over
// budget is a frame the terminal cannot repaint in, which is what
// unresponsiveness actually is.
//
//   bun tui/opentui/inputPerf.tsx                     # every scenario
//   INPUT_SCENARIO=reader-scroll bun tui/opentui/inputPerf.tsx
//   INPUT_SECONDS=8 bun tui/opentui/inputPerf.tsx     # longer window each
//
// NOT deterministic across runs. The scenarios drive the real sidebar, whose
// order tracks lastModified, so a run measures whatever sessions happen to sit
// at those positions — and a 60-card session and an 800-card one cost very
// different amounts to mount. The reported `cards` column is how many
// transcript cards the reader was holding, so a run that looks like a
// regression can be checked against it. Interleave A/B runs; never compare a
// batch of one config against a batch of the other.
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
// so every scenario reports the same ~17ms. The canary measures the render.
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

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

const TAB: Press = { key: 'tab' }
const READER_FOCUSED = 'b bookmark'

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
  // Opening a second tab: Tab into the reader promotes the preview to a tab, so
  // focusing two different sessions leaves two tabs to switch between.
  {
    name: 'tab-switch',
    setup: [TAB, TAB, { key: 'j' }, { key: 'j' }, TAB, TAB],
    press: [{ key: 'ARROW_LEFT' }, { key: 'ARROW_RIGHT' }],
  },
  { name: 'turn-jump', setup: [TAB], press: [{ key: '[' }, { key: ']' }], expect: READER_FOCUSED },
]

const SECONDS = Number.parseInt(process.env.INPUT_SECONDS ?? '', 10) || 5
// Roughly a held key at the default macOS repeat rate.
const PRESS_INTERVAL_MS = Number.parseInt(process.env.INPUT_PRESS_MS ?? '', 10) || 33
const only = process.env.INPUT_SCENARIO

// ── Parent: fan the scenarios out, one child each ────────────────────────────
if (!process.env.INPUT_CHILD) {
  const selfPath = fileURLToPath(import.meta.url)
  console.log(`\nrender cost per navigation surface (${SECONDS}s at ${PRESS_INTERVAL_MS}ms key repeat)`)
  console.log(`  ${'scenario'.padEnd(20)} ${'commits'.padStart(8)} ${'over-16.7ms'.padStart(12)} ${'worst frame'.padStart(12)} ${'cards'.padStart(7)}`)
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
      continue
    }
    const { commits, over, worst, cards } = JSON.parse(line.slice('RESULT '.length))
    console.log(
      `  ${scenario.name.padEnd(20)} ${String(commits).padStart(8)} ${String(over).padStart(12)} ${(worst.toFixed(1) + 'ms').padStart(12)} ${String(cards).padStart(7)}`,
    )
  }
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

const { default: OpenTuiApp } = await import('./App')

const scenario = SCENARIOS.find((s) => s.name === only)
if (!scenario) {
  console.log(`SKIP unknown scenario ${only}`)
  process.exit(0)
}

const setup = await testRender(<OpenTuiApp />, { width: 140, height: 44, kittyKeyboard: true })

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

if (scenario.expect && !setup.captureCharFrame().includes(scenario.expect)) {
  console.log(`SKIP precondition not met (frame missing ${JSON.stringify(scenario.expect)})`)
  process.exit(0)
}

const from = Date.now()
const until = performance.now() + SECONDS * 1000
let i = 0
while (performance.now() < until) {
  act(() => { send(scenario.press[i++ % scenario.press.length]) })
  await settle(PRESS_INTERVAL_MS)
}
const to = Date.now()
// Let the last per-second canary line flush.
await settle(1500)

type Line = { at: number; commits: number; over: number; max: number }
const lines: Line[] = readFileSync(perfLog, 'utf8').trim().split('\n').filter(Boolean).flatMap((raw) => {
  const m = raw.match(/^(\S+) commits=(\d+) over-budget=(\d+) max=([\d.]+)ms$/)
  return m ? [{ at: Date.parse(m[1]), commits: +m[2], over: +m[3], max: +m[4] }] : []
})
// The canary writes a line at the END of each one-second window, so a line
// belongs to the scenario when its stamp falls inside the window plus the tail
// second that closes it.
const mine = lines.filter((l) => l.at >= from && l.at <= to + 1000)
let cards = 0
try {
  for (const raw of readFileSync(metricsLog, 'utf8').trim().split('\n')) {
    const total = JSON.parse(raw)?.gauges?.readerWindowTotal
    if (typeof total === 'number') cards = Math.max(cards, total)
  }
} catch { /* gauges are a nicety; the frame numbers are the result */ }
console.log(`RESULT ${JSON.stringify({
  commits: mine.reduce((a, l) => a + l.commits, 0),
  over: mine.reduce((a, l) => a + l.over, 0),
  worst: mine.reduce((a, l) => Math.max(a, l.max), 0),
  cards,
})}`)
process.exit(0)

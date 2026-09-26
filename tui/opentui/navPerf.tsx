/** @jsxImportSource @opentui/react */
// Session-navigation latency harness. Mounts the real OpenTUI root against the
// user's real local sessions, walks the sidebar with j, and reports the metrics
// logger's nav.* rollup — select-to-open (debounce), open-to-detail (worker
// read), and select-to-paint, the number the user actually feels.
//
//   bun tui/opentui/navPerf.tsx                    # 20 steps walking down
//   NAV_PATTERN=pingpong bun tui/opentui/navPerf.tsx   # revisits (cached opens)
//   NAV_PATTERN=scrub bun tui/opentui/navPerf.tsx      # fast fly-by scrubbing
//   NAV_PATTERN=tabs bun tui/opentui/navPerf.tsx       # switching between open tabs
//   NAV_STEPS=40 AGENT_VIEWER_PROVIDER=all bun tui/opentui/navPerf.tsx
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-viewer-nav-perf-'))
process.chdir(dataDir)
const metricsPath = path.join(dataDir, 'nav-metrics.jsonl')
process.env.AGENT_VIEWER_TUI_METRICS = '1'
process.env.AGENT_VIEWER_TUI_METRICS_INTERVAL = '5'
process.env.AGENT_VIEWER_TUI_METRICS_LOG = metricsPath

const { default: OpenTuiApp } = await import('./App')

const STEPS = Number.parseInt(process.env.NAV_STEPS ?? '', 10) || 20
// Long enough for the open debounce, the read, and the neighbour prefetch to
// finish, so each step measures a steady-state navigation rather than a queue.
const PATTERN = (process.env.NAV_PATTERN ?? 'down') as 'down' | 'pingpong' | 'scrub' | 'tabs'
const STEP_DWELL_MS = Number.parseInt(process.env.NAV_DWELL_MS ?? '', 10)
  || (PATTERN === 'scrub' ? 25 : 900)

const setup = await testRender(<OpenTuiApp />, { width: 140, height: 44, kittyKeyboard: true })

await act(async () => { await new Promise((r) => setTimeout(r, 3000)) })

if (PATTERN === 'tabs') {
  // Tab into the reader promotes the previewed session to a tab, so focusing
  // two different sessions leaves two tabs to switch between with the arrows.
  for (const press of ['TAB', 'TAB', 'j', 'j', 'TAB', 'TAB'] as const) {
    act(() => { press === 'TAB' ? setup.mockInput.pressTab() : setup.mockInput.pressKey(press) })
    await act(async () => { await setup.flush(); await new Promise((r) => setTimeout(r, 300)) })
  }
}

for (let step = 0; step < STEPS; step++) {
  const key = PATTERN === 'tabs'
    ? (step % 2 === 0 ? 'ARROW_LEFT' : 'ARROW_RIGHT')
    : (PATTERN === 'pingpong' && step % 2 === 1 ? 'k' : 'j')
  act(() => { setup.mockInput.pressKey(key) })
  // Flush on a frame cadence rather than once-then-sleep: React's scheduler is
  // driven by act() here, so a single flush followed by a long sleep would
  // report a state update as taking the whole sleep. A real terminal render
  // loop wakes continuously; this mirrors that.
  const dwellUntil = performance.now() + STEP_DWELL_MS
  while (performance.now() < dwellUntil) {
    await act(async () => {
      await setup.flush()
      await new Promise((r) => setTimeout(r, 16))
    })
  }
}
// Let the final metrics interval flush.
await act(async () => { await new Promise((r) => setTimeout(r, 6000)) })

const lines = readFileSync(metricsPath, 'utf8').trim().split('\n').filter(Boolean)
const last = lines.map((line) => JSON.parse(line)).reverse().find((s) => s.navLatency)
console.log(`\nnav latency over ${STEPS} ${PATTERN} steps (dwell ${STEP_DWELL_MS}ms)`)
if (!last) console.log('no nav samples recorded')
else for (const row of last.navLatency) {
  console.log(`  ${row.label.padEnd(22)} n=${String(row.count).padStart(3)}  avg=${Math.round(row.avgMs)}ms  p50=${Math.round(row.p50Ms)}ms  p95=${Math.round(row.p95Ms)}ms  max=${Math.round(row.maxMs)}ms`)
}
const frames = lines.map((line) => JSON.parse(line)).filter((s) => s.frames?.commits)
console.log('frames per interval:', frames.map((s) => `${s.frames.commits}c/${s.frames.overBudget}over/${Math.round(s.frames.maxMs)}max`).join('  '))
process.exit(0)

/** @jsxImportSource @opentui/react */
// Memory-footprint harness. Mounts the real OpenTUI root against the user's
// real local sessions, walks the sidebar, and reports process RSS plus JSC
// heap stats (size + the top object-type counts) at each checkpoint. Pair with
// `bun --expose-gc` so the "after gc" numbers reflect retained memory rather
// than garbage awaiting collection.
//
//   bun --expose-gc tui/opentui/memPerf.tsx
//   MEM_STEPS=40 AGENT_VIEWER_PROVIDER=all bun --expose-gc tui/opentui/memPerf.tsx
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
// bun:jsc has no ambient types in the OpenTUI tsconfig; this harness only runs
// under Bun.
// @ts-expect-error -- Bun-only module
import { heapStats } from 'bun:jsc'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-mem-perf-')))

const { default: OpenTuiApp } = await import('./App')

const STEPS = Number.parseInt(process.env.MEM_STEPS ?? '', 10) || 20
const TOP_TYPES = Number.parseInt(process.env.MEM_TOP_TYPES ?? '', 10) || 12

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

function snapshot(label: string) {
  // @ts-expect-error --expose-gc
  if (typeof Bun.gc === 'function') Bun.gc(true)
  const stats = heapStats() as {
    heapSize: number
    objectCount: number
    objectTypeCounts: Record<string, number>
  }
  const rss = process.memoryUsage.rss()
  return { label, rss, heapSize: stats.heapSize, objectCount: stats.objectCount, counts: stats.objectTypeCounts }
}

const marks: ReturnType<typeof snapshot>[] = []
const report = (label: string) => { marks.push(snapshot(label)) }

report('before mount')

const setup = await testRender(<OpenTuiApp />, { width: 140, height: 44, kittyKeyboard: true })
await act(async () => { await new Promise((r) => setTimeout(r, 3000)) })
report('after boot')

for (let step = 0; step < STEPS; step++) {
  act(() => { setup.mockInput.pressKey('j') })
  const dwellUntil = performance.now() + 700
  while (performance.now() < dwellUntil) {
    await act(async () => { await setup.flush(); await new Promise((r) => setTimeout(r, 16)) })
  }
  if (step === Math.floor(STEPS / 2) - 1) report(`after ${step + 1} opens`)
}
report(`after ${STEPS} opens`)

console.log('')
for (const mark of marks) {
  console.log(`${mark.label.padEnd(22)} rss=${mb(mark.rss).padStart(8)}  jsHeap=${mb(mark.heapSize).padStart(8)}  objects=${mark.objectCount}`)
}

const last = marks[marks.length - 1]
const first = marks[1] ?? marks[0]
console.log(`\ntop ${TOP_TYPES} object types at end (delta vs. after boot):`)
const rows = Object.entries(last.counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP_TYPES)
for (const [type, count] of rows) {
  const delta = count - (first.counts[type] ?? 0)
  console.log(`  ${type.padEnd(28)} ${String(count).padStart(8)}  ${delta >= 0 ? '+' : ''}${delta}`)
}

process.exit(0)

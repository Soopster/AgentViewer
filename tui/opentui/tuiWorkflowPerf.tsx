/** @jsxImportSource @opentui/react */
// Pure sidebar workflow cost, not terminal frame/FPS evidence. The baseline
// reproduces App's previous per-row element cache; the candidate is App's
// actual helper. Both preserve unchanged element identity across list refreshes.
import assert from 'node:assert/strict'
import { createSidebarRowElements } from './App'

type Entry = { key: string; session: string | null }
type Element = { key: string; selected: boolean; style: string }
type Build = (entry: Entry, selected: boolean) => Element
const getSession = (entry: Entry) => entry.session
function baseline() {
  const cache = new Map<string, { entry: Entry; selected: boolean; build: Build; element: Element }>()
  return (entries: readonly Entry[], selectedKey: string | null, build: Build) => {
    const live = new Set<string>()
    const rows = entries.map((entry) => {
      live.add(entry.key)
      const selected = entry.session !== null && selectedKey !== null && entry.session === selectedKey
      const prev = cache.get(entry.key)
      if (prev && prev.entry === entry && prev.selected === selected && prev.build === build) return prev.element
      const element = build(entry, selected)
      cache.set(entry.key, { entry, selected, build, element })
      return element
    })
    for (const key of cache.keys()) if (!live.has(key)) cache.delete(key)
    return rows
  }
}
const build: Build = (entry, selected) => ({ key: entry.key, selected, style: 'original' })
const changedBuild: Build = (entry, selected) => ({ key: entry.key, selected, style: 'renamed/resized/theme' })
if (process.env.WORKFLOW_MEMORY_MODE) {
  // Isolate each mode in a fresh process. Fixture memory is excluded; the
  // closure is rooted so GC observes its current cache, then its empty cache.
  // @ts-expect-error Bun-only diagnostic API
  const { heapStats } = await import('bun:jsc')
  const gc = () => (globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
  const list = Array.from({ length: 10_000 }, (_, i) => ({ key: `row-${i}`, session: `session-${i}` }))
  gc()
  const before = heapStats().heapSize
  const resolve = process.env.WORKFLOW_MEMORY_MODE === 'baseline' ? baseline() : createSidebarRowElements<Entry, Element>(getSession)
  const root = globalThis as unknown as { workflowCache?: unknown }
  root.workflowCache = resolve
  resolve(list, 'session-0', build)
  gc()
  const retainedBytes = heapStats().heapSize - before
  resolve([], null, build)
  gc()
  console.log(JSON.stringify({ runtime: `Bun ${process.versions.bun}`, mode: process.env.WORKFLOW_MEMORY_MODE, count: list.length, retainedBytes, afterRemovalBytes: heapStats().heapSize - before }))
  delete root.workflowCache
  process.exit(0)
}
const entries: Entry[] = [
  { key: 'project', session: null }, { key: 'a', session: 'a' },
  { key: 'nested-a', session: 'a' }, { key: 'summary', session: null }, { key: 'b', session: 'b' },
]
const oldRows = baseline()
const newRows = createSidebarRowElements<Entry, Element>(getSession)
let previous: Element[] | null = null
let previousEntries: readonly Entry[] | null = null
let previousBuild: Build | null = null
let previousSelection: string | null = null
const reordered = [entries[4], entries[0], entries[2], entries[1]]
const replacement = reordered.map((entry) => ({ ...entry }))
for (const [list, selection, builder] of [
  [entries, 'a', build], [entries, 'b', build], [entries, null, build],
  [entries, 'missing', build], [entries, 'missing', build], [entries, 'a', build],
  [entries.slice(), 'a', build], [reordered, 'a', build],
  [replacement, 'a', build], [replacement, 'b', changedBuild],
  [replacement, null, changedBuild], [[], 'a', build], [entries, 'a', build],
] as const) {
  const expected = oldRows(list, selection, builder)
  const actual = newRows(list, selection, builder)
  assert.deepEqual(actual, expected)
  if (previous && previousEntries === list && previousBuild === builder) {
    if (previousSelection === selection) assert.strictEqual(actual, previous, 'unchanged selection reuses array')
    actual.forEach((element, index) => {
      if (previous![index].selected === element.selected) assert.strictEqual(element, previous![index], 'unaffected rows preserve identity')
    })
  }
  previous = actual
  previousEntries = list
  previousBuild = builder
  previousSelection = selection
}
console.log('sidebar workflow parity passed (duplicate/null/missing selection, list replacement/removal/reorder, builder invalidation, stable identities)')

const now = () => performance.now()
for (const count of [120, 10_000]) {
  const list = Array.from({ length: count }, (_, i) => ({ key: `row-${i}`, session: `session-${i}` }))
  for (const workflow of ['selection', 'list-refresh', 'list-replacement'] as const) {
    const rounds = workflow === 'selection' ? 2_000 : 100
    const measurements: Record<string, number[]> = { baseline: [], candidate: [] }
    // Alternate run order to reduce systematic warmup/order bias.
    for (let repeat = 0; repeat < 6; repeat++) {
      for (const name of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const resolve = name === 'baseline' ? baseline() : createSidebarRowElements<Entry, Element>(getSession)
        resolve(list, 'session-0', build)
        for (let i = 0; i < 100; i++) resolve(list, `session-${i % count}`, build)
        const started = now()
        for (let i = 0; i < rounds; i++) {
          const input = workflow === 'selection' ? list : workflow === 'list-refresh' ? list.slice() : list.map((entry) => ({ ...entry }))
          const result = resolve(input, `session-${i % count}`, build)
          assert.equal(result.length, count)
        }
        measurements[name].push((now() - started) / rounds)
      }
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const before = median(measurements.baseline)
    const after = median(measurements.candidate)
    console.log(JSON.stringify({ runtime: `Bun ${process.versions.bun}`, count, workflow, rounds, samples: 6, baselineMs: before, candidateMs: after, speedup: before / after }))
  }
}
process.exit(0)

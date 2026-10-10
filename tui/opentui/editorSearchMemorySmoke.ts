import assert from 'node:assert/strict'
// @ts-expect-error -- Bun-only diagnostic API
import { heapStats } from 'bun:jsc'
import type { Session } from '../../lib/types'
import { filterComposerMentionEntries, type ComposerMentionFileEntry } from './composerMentionRanking'
import { searchEditorBuffers, type EditorProjectSearchBuffer, type EditorProjectSearchOptions } from './editorProjectSearch'
import { createSidebarSessionSearch } from './sidebarSessionSearch'

function baselineMention(entries: ComposerMentionFileEntry[], limit: number, scores?: Record<string, number>, prefix?: string) {
  return entries.map((entry, order) => ({ entry, order, score: scores?.[prefix ? `${prefix}/${entry.path}` : entry.path] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(({ entry }) => entry)
}
const entries = Array.from({ length: 5000 }, (_, i) => ({ path: `src/Éclair${i}.ts`, basename: `Éclair${i}.ts` }))
for (const prefix of [undefined, '/repo']) {
  for (const values of [undefined, [0], [-3, 0, 3], [NaN, 1, 2], [Infinity, -Infinity, 1]]) {
    const scores = values && Object.fromEntries(entries.map((entry, i) => [prefix ? `${prefix}/${entry.path}` : entry.path, values[i % values.length]!]))
    for (const limit of [0, -1, -30, 0.5, 20.7, 1, 20, 5000, 6000, NaN, Infinity]) {
      assert.deepEqual(filterComposerMentionEntries(entries, '', limit, scores, prefix), baselineMention(entries, limit, scores, prefix), `limit ${limit}, prefix ${prefix}, scores ${values}`)
    }
  }
}
const history = { [entries[4999]!.path]: 10 }
assert.equal(filterComposerMentionEntries(entries, '', 20, history)[0], entries[4999])
history[entries[4999]!.path] = -1
assert.equal(filterComposerMentionEntries(entries, '', 20, history)[0], entries[0], 'History updates cannot reuse stale rankings')
assert.deepEqual(filterComposerMentionEntries(entries.slice(100), '', 20, history), entries.slice(100, 120), 'New project list cannot retain old candidates')

function baselineBuffers(buffers: EditorProjectSearchBuffer[], query: string, options: Omit<EditorProjectSearchOptions, 'signal'>) {
  if (!query) return []
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.matchCase ? 'gu' : 'giu')
  const results: ReturnType<typeof searchEditorBuffers> = []
  const limit = options.limit ?? 500
  for (const buffer of buffers) {
    for (const [line, preview] of buffer.content.split('\n').entries()) {
      pattern.lastIndex = 0
      for (let match = pattern.exec(preview); match && results.length < limit; match = pattern.exec(preview)) {
        results.push({ path: buffer.path, line, character: match.index, preview })
        if (!match[0].length) {
          const offset = pattern.lastIndex
          const first = preview.charCodeAt(offset)
          pattern.lastIndex += first >= 0xD800 && first <= 0xDBFF && preview.charCodeAt(offset + 1) >= 0xDC00 && preview.charCodeAt(offset + 1) <= 0xDFFF ? 2 : 1
        }
      }
      if (results.length >= limit) return results
    }
  }
  return results
}
const buffers = ['', '\n', 'needle needle\r\nNEEDLE\r\n', 'A👩‍💻B\n\n', 'nothing\nneedle'].map((content, i) => ({ path: `file${i}.ts`, content }))
for (const [query, regex] of [['needle', false], ['(?=.)', true], ['()', true], ['^|$', true], ['missing', false], ['', false]] as const) {
  for (const limit of [0, 1, 3, 500]) {
    for (const matchCase of [true, false]) {
      for (const wholeWord of [true, false]) {
        const options = { regex, limit, matchCase, wholeWord }
        assert.deepEqual(searchEditorBuffers(buffers, query, options), baselineBuffers(buffers, query, options), JSON.stringify({ query, options }))
      }
    }
  }
}
const sessions: Session[] = [{ sessionId: 'old', customTitle: 'Éclair', cwd: '/repo/alpha' }]
const search = createSidebarSessionSearch(sessions)
assert.equal(search(''), sessions)
assert.deepEqual(search('éclair'), sessions)
const replaced: Session[] = [{ sessionId: 'new', customTitle: 'Renamed', cwd: '/repo/beta' }]
const refreshed = createSidebarSessionSearch(replaced)
assert.deepEqual(refreshed('éclair'), [])
assert.deepEqual(refreshed('renamed'), replaced)
assert.deepEqual(search('éclair'), sessions, 'Old list owns its own index')

// Repeated unique projects, titles and buffers must not grow retained caches.
// Heap is VM-local post-GC evidence, not peak RSS or terminal FPS.
let generation = 0
function churn() {
  for (let i = 0; i < 200; i += 1) {
    const id = generation++
    const list = entries.slice(0, 100).map((entry) => ({ ...entry, path: `${id}/${entry.path}` }))
    filterComposerMentionEntries(list, '', 20, { [list[99]!.path]: i })
    searchEditorBuffers([{ path: `${id}.ts`, content: `needle ${id}\n`.repeat(100) }], 'needle', { regex: false, matchCase: true, wholeWord: false, limit: 20 })
    createSidebarSessionSearch([{ sessionId: `${id}`, customTitle: `unique-${id}` }])('unique')
  }
}
const collect = () => (globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
churn()
collect()
const before = heapStats().heapSize
for (let i = 0; i < 5; i += 1) churn()
collect()
const after = heapStats().heapSize
assert.ok(after - before < 8 * 1024 * 1024, `Unexpected retained search growth: ${after - before} bytes`)
console.log(`Mention ranking/search output parity and immutable sidebar invalidation passed; unique-request post-GC heap ${(before / 1048576).toFixed(2)} -> ${(after / 1048576).toFixed(2)} MiB`)

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The store resolves its file from process.cwd() at import time, so chdir first.
const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-frecency-'))
process.chdir(cwd)

const {
  FRECENCY_MAX_ENTRIES,
  frecencyKey,
  frecencyPrefix,
  frecencyScore,
  parseFrecencyTable,
  readFrecencyScores,
  recordFrecencyUse,
  resetFrecencyCacheForTests,
} = await import('../../lib/tuiFrecency')
const { filterComposerMentionEntries } = await import('./composerMentionRanking')

const FILE = path.join(cwd, '.agent-viewer-data', 'frecency.jsonl')
const DAY = 86_400_000

// ── scoring ────────────────────────────────────────────────────────────────
// Frequency alone pins a file you have finished with; recency alone forgets the
// file you come back to every day. The score has to move on both.
const now = Date.now()
const daily = { path: 'a', frequency: 20, lastUsed: now - 1 * DAY }
const stale = { path: 'b', frequency: 40, lastUsed: now - 30 * DAY }
assert.ok(frecencyScore(daily, now) > frecencyScore(stale, now),
  'A file opened often and opened recently must outrank one opened twice as often a month ago')
assert.equal(frecencyScore(undefined, now), 0, 'An unknown path scores 0 so it sorts last')
assert.ok(frecencyScore({ path: 'c', frequency: 2, lastUsed: now }, now)
  > frecencyScore({ path: 'd', frequency: 1, lastUsed: now }, now),
  'At equal age, the more frequently opened file wins')

// ── the JSONL table ────────────────────────────────────────────────────────
recordFrecencyUse('/repo/src/one.ts', now - 2 * DAY)
recordFrecencyUse('/repo/src/one.ts', now)
recordFrecencyUse('/repo/src/two.ts', now)

// An append is an update: the later line for a path supersedes the earlier one.
const lines = readFileSync(FILE, 'utf-8').split('\n').filter(Boolean)
assert.equal(lines.length, 3, `Each use appends exactly one line: ${JSON.stringify(lines)}`)
assert.equal(parseFrecencyTable(readFileSync(FILE, 'utf-8')).length, 2,
  'Parsing keeps one entry per path, not one per append')
const parsed = parseFrecencyTable(readFileSync(FILE, 'utf-8'))
assert.equal(parsed.find((entry) => entry.path === '/repo/src/one.ts')?.frequency, 2,
  'The surviving entry carries the accumulated frequency, not the last line\'s alone')

// A torn final write must cost that line, not the whole history: the file is
// appended to on every open, so a crash lands mid-line often enough to matter.
writeFileSync(FILE, `${lines.join('\n')}\n{"path":"/repo/src/thr`, 'utf-8')
assert.equal(parseFrecencyTable(readFileSync(FILE, 'utf-8')).length, 2,
  'A truncated trailing line is skipped and the rest of the table survives')

// The table is compacted once on load, so the file cannot grow without bound.
resetFrecencyCacheForTests()
assert.ok(readFrecencyScores(now).size > 0, 'The compacted table still reads back')
assert.equal(readFileSync(FILE, 'utf-8').split('\n').filter(Boolean).length, 2,
  'Loading rewrites the file to one line per path')

// ── keys ───────────────────────────────────────────────────────────────────
assert.equal(frecencyKey('/repo', 'src/one.ts'), '/repo/src/one.ts')
assert.equal(frecencyKey('/repo/', 'src/one.ts'), '/repo/src/one.ts',
  'A trailing separator on the root must not produce a second key for the same file')
assert.equal(frecencyKey('C:\\repo', 'src/one.ts'), 'C:/repo/src/one.ts',
  'Windows separators normalize, or a joined key and a resolved key silently disagree')
assert.equal(`${frecencyPrefix('/repo/')}/src/one.ts`, frecencyKey('/repo', 'src/one.ts'),
  'The prefix a worker joins must produce the same key the recorder writes')

// ── the cap ────────────────────────────────────────────────────────────────
for (let i = 0; i < FRECENCY_MAX_ENTRIES + 50; i += 1) recordFrecencyUse(`/repo/gen/${i}.ts`, now + i)
assert.ok(readFrecencyScores(now).size <= FRECENCY_MAX_ENTRIES,
  'The table is capped, keeping the most recently used entries')

// ── mention ranking ────────────────────────────────────────────────────────
// This is the invariant worth protecting: frecency breaks ties, it never
// outranks a match. A file you have never opened must still be findable.
const entries = [
  { path: 'src/zzz-never-opened.ts', basename: 'zzz-never-opened.ts' },
  { path: 'src/alpha.ts', basename: 'alpha.ts' },
  { path: 'docs/beta.md', basename: 'beta.md' },
  { path: 'src/gamma.ts', basename: 'gamma.ts' },
]
const scores: Record<string, number> = {
  '/repo/docs/beta.md': 50,
  '/repo/src/gamma.ts': 10,
}

const empty = filterComposerMentionEntries(entries, '', 4, scores, '/repo')
assert.deepEqual(empty.map((entry) => entry.path),
  ['docs/beta.md', 'src/gamma.ts', 'src/zzz-never-opened.ts', 'src/alpha.ts'],
  'A bare @ lists what you have been working in, then file-walk order for the rest')

// The cap must be applied after ranking, not before: with a limit of 1 the
// frecent file has to survive even though the walk would have handed back the
// first entry.
assert.deepEqual(filterComposerMentionEntries(entries, '', 1, scores, '/repo').map((e) => e.path),
  ['docs/beta.md'],
  'Ranking happens before the limit, or a bare @ shows whatever the walk produced first')

assert.deepEqual(filterComposerMentionEntries(entries, 'zzz', 4, scores, '/repo').map((e) => e.path),
  ['src/zzz-never-opened.ts'],
  'A typed query finds a file that has never been opened — frecency must not outrank a match')

// A basename prefix is a better match than a path substring, whatever frecency
// says: tiers come first in the sort.
const tiered = [
  { path: 'deep/nested/beta/other.ts', basename: 'other.ts' },
  { path: 'src/beta-helper.ts', basename: 'beta-helper.ts' },
]
assert.deepEqual(
  filterComposerMentionEntries(tiered, 'beta', 2, { '/repo/deep/nested/beta/other.ts': 999 }, '/repo')
    .map((entry) => entry.path),
  ['src/beta-helper.ts', 'deep/nested/beta/other.ts'],
  'Match quality outranks frecency: a basename prefix beats a path substring')

console.log('Frecency smoke passed (scoring, JSONL durability, keys, cap, rank-before-limit)')

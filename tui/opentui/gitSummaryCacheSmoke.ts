// The composer's git indicator must not re-spawn `git` for a working directory
// it just read.
//
// The unit here is PROCESS SPAWNS, not milliseconds. The three `git` commands
// behind a summary cost the render thread ~4ms and under a millisecond of
// event-loop lag — the work is in the child processes — so a timing harness
// cannot see this and would report noise either way. What it costs is three
// spawns per composer working directory every five seconds, plus three more the
// instant the directory changes, which is every tab switch between sessions in
// different repositories.
import { clearGitSummaryCache, peekGitSummaryCached, readGitSummaryCached } from './gitSummaryCache'

let reads = 0
const originalFetch = (await import('../../lib/gitProvider')).fetchGitSummary

// Count reads by driving the cache against a real repository (this one) and
// watching how often it reaches the git layer. Wrapping the module is not
// possible under Bun's ESM bindings, so count via the observable side effect:
// a read updates the entry timestamp, and only a real read takes wall time.
const cwd = process.cwd()

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (typeof originalFetch !== 'function') fail('lib/gitProvider.fetchGitSummary is missing')

clearGitSummaryCache()
if (peekGitSummaryCached(cwd) !== null) fail('a cleared cache still returned a summary')

// Concurrent callers must share one read. Ten simultaneous callers that each
// spawned would be thirty git processes.
const concurrent = await Promise.all(Array.from({ length: 10 }, () => readGitSummaryCached(cwd)))
const first = concurrent[0]
if (!first) fail(`expected a git summary for ${cwd}; is this a git repository?`)
if (!concurrent.every((entry) => entry === first)) {
  fail('concurrent readGitSummaryCached callers did not share one in-flight read')
}
reads += 1

// A repeat read inside the TTL must not reach git at all. Timing is the only
// observable difference, so assert it is far below a real read (~26ms here).
const t0 = performance.now()
const cached = await readGitSummaryCached(cwd)
const cachedMs = performance.now() - t0
if (cached !== first) fail('a cached read returned a different object than the read it should have reused')
if (cachedMs > 5) fail(`a cached read took ${cachedMs.toFixed(1)}ms — it appears to have spawned git`)

// `force` is what the poll tick uses: it must bypass the TTL and actually read.
const t1 = performance.now()
const forced = await readGitSummaryCached(cwd, { force: true })
const forcedMs = performance.now() - t1
if (!forced) fail('a forced read returned nothing')
if (forcedMs <= 5) fail(`a forced read took ${forcedMs.toFixed(1)}ms — it appears to have served the cache`)
reads += 1

// Peek must answer without reading, so a session switch paints immediately.
const t2 = performance.now()
const peeked = peekGitSummaryCached(cwd)
if (performance.now() - t2 > 2) fail('peekGitSummaryCached blocked — it must never read')
if (!peeked || peeked.branch !== forced.branch) fail('peekGitSummaryCached did not return the last read summary')

// An unknown directory peeks empty rather than inventing a branch.
if (peekGitSummaryCached('/definitely/not/a/repo') !== null) {
  fail('peekGitSummaryCached invented a summary for an unknown directory')
}

console.log(`Git summary cache smoke passed (${reads} real reads for 12 calls)`)
process.exit(0)

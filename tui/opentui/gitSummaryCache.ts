// Shared, short-lived cache in front of the composer's git summary.
//
// `fetchGitSummary` spawns three `git` processes (`rev-parse`, `status
// --porcelain -u`, `rev-list --walk-reflogs`). That costs the render thread
// almost nothing — measured on this repo, ~4ms of main-thread CPU and under a
// millisecond of event-loop lag per poll, because the work happens in the child
// processes. What it does do is spawn three processes every five seconds, per
// distinct working directory, forever.
//
// The waste is at the edges rather than in the steady state. The composer's
// effect keys on `composerWorkingDirectory` and fires immediately when it
// changes, so switching between two sessions in the same repository — the
// common case, and the whole point of tabs — re-spawned all three every switch
// while the answer it already had was milliseconds old. Keying by cwd rather
// than by session is what collapses that: a switch inside one repo now reuses
// the standing answer, and a burst of switches coalesces into one read.
//
// The TTL is deliberately shorter than the poll interval. This exists to
// deduplicate concurrent and back-to-back readers, not to slow the poll down:
// a cache that outlived the interval would make the working-tree indicator
// stale on purpose, which is the one thing it must not be.
import { fetchGitSummary, type GitSummary } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'

const TTL_MS = 2_000
/** Enough for every repo a fleet of tabs realistically spans. */
const MAX_ENTRIES = 16

type Entry = {
  at: number
  summary: GitSummary | null
  /** Set while a read is in flight, so concurrent callers share one spawn. */
  inFlight: Promise<GitSummary | null> | null
}

const entries = new Map<string, Entry>()

function evictOldest() {
  if (entries.size <= MAX_ENTRIES) return
  // Insertion order is close enough to use order here: a re-read refreshes an
  // entry's position via the delete/set in `readGitSummaryCached`.
  const oldest = entries.keys().next()
  if (!oldest.done) entries.delete(oldest.value)
}

/**
 * Read `cwd`'s git summary, reusing an answer newer than `TTL_MS` and joining a
 * read already in flight. `force` skips the cached value but still joins an
 * in-flight read — a poll tick wants fresh data, not a duplicate spawn.
 */
export function readGitSummaryCached(cwd: string, options?: { force?: boolean }): Promise<GitSummary | null> {
  const now = Date.now()
  const existing = entries.get(cwd)
  if (existing?.inFlight) return existing.inFlight
  if (existing && !options?.force && now - existing.at < TTL_MS) return Promise.resolve(existing.summary)

  const entry: Entry = { at: now, summary: existing?.summary ?? null, inFlight: null }
  const read = fetchGitSummary(cwd, runGitCommand)
    .then((summary) => {
      entry.at = Date.now()
      entry.summary = summary
      return summary
    })
    .catch(() => entry.summary)
    .finally(() => { entry.inFlight = null })
  entry.inFlight = read
  entries.delete(cwd)
  entries.set(cwd, entry)
  evictOldest()
  return read
}

/** Test seam. */
export function clearGitSummaryCache(): void {
  entries.clear()
}

/**
 * The last summary read for `cwd`, without starting a read. Lets a newly
 * selected session paint the indicator immediately instead of blanking it, when
 * another session in the same repository has already read it. Deliberately not
 * TTL-gated: a stale branch name for the moment before the refresh lands beats
 * a blank one, and the caller always refreshes.
 */
export function peekGitSummaryCached(cwd: string): GitSummary | null {
  return entries.get(cwd)?.summary ?? null
}

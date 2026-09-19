// Filters a project's file list against an @-mention query off the render
// thread. The list can hold up to 5 000 entries (see lib/projectFiles.ts);
// the substring + fuzzy-subsequence scan below is O(entries × query length)
// and previously ran inline in the composer's mention effect, on the same
// thread that draws the TUI and processes the live SSE stream.
//
// Matches are tiered by how well they match, then ranked by frecency within a
// tier (see lib/tuiFrecency.ts). Ranking happens in the worker because it has
// to happen *before* the limit: an empty query matches everything, so slicing
// first would hand back whatever the file walk produced and leave nothing for
// frecency to order.

export type ComposerMentionFileEntry = { path: string; basename: string }

// Tiers, best first. A tier is the match quality; frecency only reorders within
// one, so a typed query still finds a file that has never been opened.
const TIER_EXACT = 0
const TIER_BASENAME_PREFIX = 1
const TIER_BASENAME_SUBSTRING = 2
const TIER_PATH_SUBSTRING = 3
const TIER_SUBSEQUENCE = 4

/**
 * How many matches to collect before ranking. Scanning every entry would cost
 * the whole list on every keystroke; stopping at `limit` would let file-walk
 * order decide which matches frecency ever sees. A bounded pool keeps the early
 * exit and still gives frecency something to choose between.
 */
const CANDIDATE_FACTOR = 4

type Candidate = { entry: ComposerMentionFileEntry; tier: number; order: number }

function rank(
  candidates: Candidate[],
  limit: number,
  scoreOf: (entry: ComposerMentionFileEntry) => number,
): ComposerMentionFileEntry[] {
  return candidates
    .sort((left, right) => left.tier - right.tier
      || scoreOf(right.entry) - scoreOf(left.entry)
      || left.order - right.order)
    .slice(0, limit)
    .map((candidate) => candidate.entry)
}

function filterEntries(
  entries: ComposerMentionFileEntry[],
  rawQuery: string,
  limit: number,
  scoreOf: (entry: ComposerMentionFileEntry) => number,
): ComposerMentionFileEntry[] {
  const query = rawQuery.toLowerCase()
  // An empty query matches everything, so there is no tier to separate entries
  // and frecency orders the list outright — this is what makes a bare `@` list
  // what you have been working in.
  if (!query) {
    return entries
      .map((entry, order) => ({ entry, tier: 0, order }))
      .sort((left, right) => scoreOf(right.entry) - scoreOf(left.entry) || left.order - right.order)
      .slice(0, limit)
      .map((candidate) => candidate.entry)
  }

  const pool = limit * CANDIDATE_FACTOR
  const candidates: Candidate[] = []
  const seen = new Set<ComposerMentionFileEntry>()

  for (const entry of entries) {
    if (candidates.length >= pool) break
    const lower = entry.path.toLowerCase()
    const base = entry.basename.toLowerCase()
    const tier = base === query ? TIER_EXACT
      : base.startsWith(query) ? TIER_BASENAME_PREFIX
      : base.includes(query) ? TIER_BASENAME_SUBSTRING
      : lower.includes(query) ? TIER_PATH_SUBSTRING
      : null
    if (tier === null) continue
    candidates.push({ entry, tier, order: candidates.length })
    seen.add(entry)
  }

  if (candidates.length < pool) {
    for (const entry of entries) {
      if (candidates.length >= pool) break
      if (seen.has(entry)) continue
      let qi = 0
      for (let i = 0; i < entry.path.length && qi < query.length; i += 1) {
        if (entry.path[i] === query[qi]) qi += 1
      }
      if (qi === query.length) candidates.push({ entry, tier: TIER_SUBSEQUENCE, order: candidates.length })
    }
  }

  return rank(candidates, limit, scoreOf)
}

export function filterComposerMentionEntries(
  entries: ComposerMentionFileEntry[],
  query: string,
  limit: number,
  frecency?: Record<string, number>,
  frecencyPrefix?: string,
): ComposerMentionFileEntry[] {
  const scoreOf = frecency
    ? (entry: ComposerMentionFileEntry) => frecency[frecencyPrefix ? `${frecencyPrefix}/${entry.path}` : entry.path] ?? 0
    : () => 0
  return filterEntries(entries, query, limit, scoreOf)
}

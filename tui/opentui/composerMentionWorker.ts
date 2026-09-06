// Filters a project's file list against an @-mention query off the render
// thread. The list can hold up to 5 000 entries (see lib/projectFiles.ts);
// the substring + fuzzy-subsequence scan below is O(entries × query length)
// and previously ran inline in the composer's mention effect, on the same
// thread that draws the TUI and processes the live SSE stream.

export type ComposerMentionFileEntry = { path: string; basename: string }

type MentionFilterRequest = {
  id: number
  entries: ComposerMentionFileEntry[]
  query: string
  limit: number
}
type MentionFilterResponse =
  | { id: number; ok: true; matches: ComposerMentionFileEntry[] }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<MentionFilterRequest>) => void) | null
  postMessage: (message: MentionFilterResponse) => void
}

function filterEntries(entries: ComposerMentionFileEntry[], rawQuery: string, limit: number): ComposerMentionFileEntry[] {
  const query = rawQuery.toLowerCase()
  const matches: ComposerMentionFileEntry[] = []
  if (!query) return entries.slice(0, limit)

  for (const entry of entries) {
    if (matches.length >= limit) break
    const lower = entry.path.toLowerCase()
    const base = entry.basename.toLowerCase()
    if (base === query || base.startsWith(query) || base.includes(query) || lower.includes(query)) {
      matches.push(entry)
    }
  }

  if (matches.length < limit) {
    const seen = new Set(matches)
    for (const entry of entries) {
      if (matches.length >= limit) break
      if (seen.has(entry)) continue
      let qi = 0
      for (let i = 0; i < entry.path.length && qi < query.length; i += 1) {
        if (entry.path[i] === query[qi]) qi += 1
      }
      if (qi === query.length) matches.push(entry)
    }
  }

  return matches
}

self.onmessage = (event) => {
  const { id, entries, query, limit } = event.data
  try {
    const matches = filterEntries(entries, query, limit)
    self.postMessage({ id, ok: true, matches })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// Worker glue for the @-mention file filter. The ranking itself lives in
// `composerMentionRanking.ts` so a test can drive it directly: importing this
// file registers an `onmessage` handler, which keeps the runtime's event loop
// alive and a smoke test would never exit.

import { filterComposerMentionEntries, type ComposerMentionFileEntry } from './composerMentionRanking'

export type { ComposerMentionFileEntry }

type MentionFilterRequest = {
  id: number
  entries: ComposerMentionFileEntry[]
  query: string
  limit: number
  /** Frecency key → score. Absent paths score 0 and sort last. */
  frecency?: Record<string, number>
  /** Prefix joined to an entry's relative path to reach its frecency key. */
  frecencyPrefix?: string
}
type MentionFilterResponse =
  | { id: number; ok: true; matches: ComposerMentionFileEntry[] }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<MentionFilterRequest>) => void) | null
  postMessage: (message: MentionFilterResponse) => void
}

self.onmessage = (event) => {
  const { id, entries, query, limit, frecency, frecencyPrefix } = event.data
  try {
    const matches = filterComposerMentionEntries(entries, query, limit, frecency, frecencyPrefix)
    self.postMessage({ id, ok: true, matches })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

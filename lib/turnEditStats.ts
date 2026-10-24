// What one turn did to files, read off its tool calls: which files and how many
// lines went in and out. Read from the transcript rather than from git so it
// costs nothing per render and covers turns that ran outside this app (the
// native CLIs take no checkpoint). The counts are the calls' own, so a file the
// agent rewrote with a shell command is not in them; a turn's checkpoint diff
// is the exact answer, and the summary opens it.

import { extractFileEditsFromToolUse, type ExtractedFileEdit } from './provenanceExtract'

export type FileEditStat = { path: string; added: number; removed: number }

/**
 * Lines an edit actually changed. An edit's old and new text share their
 * unchanged context, so counting both whole reads a one-word change in a
 * ten-line `old_string` as −10 +10; lines present on both sides cancel. A
 * patch's '+'/'-' lines are already the change.
 */
function editLineCounts(edit: ExtractedFileEdit): { added: number; removed: number } {
  if (edit.kind === 'patch' || edit.removedLines.length === 0) {
    return { added: edit.addedLines.length, removed: edit.removedLines.length }
  }
  const remaining = new Map<string, number>()
  for (const line of edit.removedLines) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  let added = 0
  for (const line of edit.addedLines) {
    const count = remaining.get(line) ?? 0
    if (count > 0) remaining.set(line, count - 1)
    else added += 1
  }
  let removed = 0
  for (const count of remaining.values()) removed += count
  return { added, removed }
}

/** Per-file line counts for the tool calls given; a failed call changed nothing. */
export function fileEditStatsFromToolCalls(
  calls: Iterable<{ name: string; input: Record<string, unknown>; failed: boolean }>,
): FileEditStat[] {
  const byPath = new Map<string, FileEditStat>()
  for (const call of calls) {
    if (call.failed) continue
    for (const edit of extractFileEditsFromToolUse(call.name, call.input, null)) {
      if (!edit.filePath) continue
      const { added, removed } = editLineCounts(edit)
      const entry = byPath.get(edit.filePath)
      if (entry) {
        entry.added += added
        entry.removed += removed
      } else {
        byPath.set(edit.filePath, { path: edit.filePath, added, removed })
      }
    }
  }
  return [...byPath.values()]
}

/** Merge per-card stats into one turn's, keyed by path. */
export function mergeFileEditStats(groups: Iterable<readonly FileEditStat[] | undefined>): FileEditStat[] {
  const byPath = new Map<string, FileEditStat>()
  for (const group of groups) {
    for (const stat of group ?? []) {
      const entry = byPath.get(stat.path)
      if (entry) {
        entry.added += stat.added
        entry.removed += stat.removed
      } else {
        byPath.set(stat.path, { ...stat })
      }
    }
  }
  return [...byPath.values()]
}

/** `3 files · +42 −7`, or null when the turn changed no file. */
export function formatFileEditSummary(stats: readonly FileEditStat[]): string | null {
  if (stats.length === 0) return null
  let added = 0
  let removed = 0
  for (const stat of stats) {
    added += stat.added
    removed += stat.removed
  }
  return `${stats.length} file${stats.length === 1 ? '' : 's'} · +${added} −${removed}`
}

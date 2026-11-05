// What one turn did to files, read off its tool calls: which files and how many
// lines went in and out. Read from the transcript rather than from git so it
// costs nothing per render and covers turns that ran outside this app (the
// native CLIs take no checkpoint). The counts are the calls' own, so a file the
// agent rewrote with a shell command is not in them; a turn's checkpoint diff
// is the exact answer, and the summary opens it.

import { extractFileEditsFromToolUse, type ExtractedFileEdit } from './provenanceExtract'

export type FileEditStat = { path: string; added: number; removed: number }

const SHELL_TOOLS = new Set(['bash', 'shell', 'exec_command', 'run_shell_command'])
const PATH_LITERAL = /['"]((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z][\w]{0,5})['"]/g
const tidyPath = (path: string) => path.replace(/^\.\//, '')

/**
 * Files a shell command visibly writes: `sed -i`, `> file` / `>> file` / `tee`, and a
 * script that calls a write API on path-like string literals. Line counts are only known
 * for a heredoc's body (`cat > f <<EOF`); every other write counts the file with 0 lines,
 * because the transcript does not say how many changed. A heuristic, so it lives here
 * (a summary) and not in the provenance extractor, where a wrong file would mis-attribute code.
 */
export function shellWrittenFiles(command: string): FileEditStat[] {
  const byPath = new Map<string, FileEditStat>()
  const note = (path: string, added = 0) => {
    const key = tidyPath(path)
    if (!key || key.startsWith('/dev/') || key.startsWith('/tmp/')) return
    const entry = byPath.get(key)
    if (entry) entry.added += added
    else byPath.set(key, { path: key, added, removed: 0 })
  }
  const redirect = /(?:^|[\s;&|(])(?:\d?>>?|>>?)\s*['"]?([\w./~-]+\.[A-Za-z]\w{0,5})['"]?([^\n]*)\n?/g
  for (let match = redirect.exec(command); match; match = redirect.exec(command)) {
    const heredoc = /^[^\n]*<<-?\s*\\?['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/.exec(command.slice(match.index))
    note(match[1]!, heredoc ? heredoc[2]!.split('\n').length : 0)
  }
  for (const line of command.split(/\n|;|&&|\|\|/)) {
    if (/\bsed\b/.test(line) && /\s(?:-[a-zA-Z]*i\S*|--in-place\S*)(?:\s|$)/.test(line)) {
      const file = [...line.matchAll(/(?:^|\s)['"]?([\w./~-]+\.[A-Za-z]\w{0,5})['"]?(?=\s|$)/g)].map(m => m[1]!).pop()
      if (file) note(file)
    }
    const tee = /\btee\s+(?:-a\s+)?['"]?([\w./~-]+\.[A-Za-z]\w{0,5})/.exec(line)
    if (tee) note(tee[1]!)
  }
  if (/\.write\(|write_text\(|write_bytes\(|writeFile(?:Sync)?\(|\.write_all\(/.test(command)) {
    for (const match of command.matchAll(PATH_LITERAL)) note(match[1]!)
  }
  return [...byPath.values()]
}

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
  const add = (path: string, added: number, removed: number) => {
    const entry = byPath.get(path)
    if (entry) { entry.added += added; entry.removed += removed } else byPath.set(path, { path, added, removed })
  }
  for (const call of calls) {
    if (call.failed) continue
    if (SHELL_TOOLS.has(call.name.toLowerCase())) {
      const command = call.input.command
      const text = typeof command === 'string' ? command : Array.isArray(command) ? command.join(' ') : ''
      for (const stat of shellWrittenFiles(text)) add(stat.path, stat.added, stat.removed)
      continue
    }
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
  const files = `${stats.length} file${stats.length === 1 ? '' : 's'}`
  // A shell write names the file but not its line counts; say only what is known.
  return added === 0 && removed === 0 ? files : `${files} · +${added} −${removed}`
}

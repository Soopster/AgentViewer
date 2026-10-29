import type { ThreadedMessage, ToolThread } from '../../lib/threading'
import { pathBasename } from '../../lib/projectPaths'
import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'
import { line, truncateLine, sanitizeLine, MAX_CARD_LINES } from './text'
import { normalizeToolThreadForTui } from './tools'

export function summarizeKind(kind: unknown): string {
  if (typeof kind === 'string' && kind.trim()) return kind
  if (kind == null) return 'change'
  if (typeof kind === 'object' && kind !== null) {
    const obj = kind as Record<string, unknown>
    if (typeof obj.type === 'string' && obj.type.trim()) return obj.type
    if (typeof obj.kind === 'string' && obj.kind.trim()) return obj.kind
  }
  return 'change'
}

/**
 * Normalise a unified diff that may have Codex-specific quirks:
 * - strips non-standard leading lines before the first @@ or --- header
 * - rewrites @@ hunk headers with the actual line counts from the hunk body
 */
export function normalizeUnifiedDiff(diff: string): string {
  const raw = diff.split('\n')
  const out: string[] = []
  let i = 0

  // Skip any non-standard prefix lines (e.g. "update /path/to/file")
  while (i < raw.length) {
    const l = raw[i]
    if (l.startsWith('@@') || l.startsWith('---') || l.startsWith('+++')
        || l.startsWith('diff ') || l.startsWith('index ')) break
    i++
  }

  while (i < raw.length) {
    const l = raw[i]
    if (!l.startsWith('@@')) {
      out.push(l)
      i++
      continue
    }

    // Collect hunk body up to the next @@ or end
    const bodyStart = i + 1
    let j = bodyStart
    while (j < raw.length && !raw[j].startsWith('@@')) j++
    const body = raw.slice(bodyStart, j)

    // Recount: context lines count for both old and new
    let oldCount = 0
    let newCount = 0
    for (const bl of body) {
      if (bl === '\\ No newline at end of file') continue
      if (bl.startsWith('-')) oldCount++
      else if (bl.startsWith('+')) newCount++
      else { oldCount++; newCount++ }
    }

    const m = l.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
    out.push(m
      ? `@@ -${m[1]},${oldCount} +${m[2]},${newCount} @@${m[3] ?? ''}`
      : l)
    out.push(...body)
    i = j
  }

  return out.join('\n')
}

export function previewDiff(diffText: string, limit: number): TuiTranscriptCardLine[] {
  if (!diffText.trim()) return [line('No diff body recorded.', 'muted')]

  const rawLines = sanitizeLine(diffText).split('\n').map((entry) => entry.trimEnd())
  const selected: TuiTranscriptCardLine[] = []
  let skipped = 0

  for (const rawLine of rawLines) {
    if (!rawLine) continue

    let tone: TuiTranscriptLineTone | null = null
    if (rawLine.startsWith('@@')) {
      tone = 'diff_meta'
    } else if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      tone = 'diff_add'
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      tone = 'diff_remove'
    } else if (
      rawLine.startsWith('diff --git')
      || rawLine.startsWith('index ')
      || rawLine.startsWith('+++ ')
      || rawLine.startsWith('--- ')
    ) {
      tone = 'diff_meta'
    }

    if (tone == null) continue

    if (selected.length < limit) {
      selected.push(line(truncateLine(rawLine), tone))
    } else {
      skipped += 1
    }
  }

  if (selected.length === 0) {
    const nonEmpty = rawLines.filter(Boolean)
    const fallback = nonEmpty.slice(0, limit).map((entry) => line(truncateLine(entry), 'muted'))
    if (nonEmpty.length > limit) {
      fallback.push(line(`… ${nonEmpty.length - limit} more diff lines`, 'dim'))
    }
    return fallback.length > 0 ? fallback.slice(0, limit) : [line('No diff body recorded.', 'muted')]
  }

  if (skipped > 0 && selected.length < limit) {
    selected.push(line(`… ${skipped} more diff lines`, 'dim'))
  }

  return selected.slice(0, limit)
}

export function previewFileChange(thread: ToolThread): TuiTranscriptCardLine[] {
  const input = thread.toolUse.input as {
    status?: string
    changes?: Array<{ path?: string; kind?: unknown; diff?: string }>
  }
  const changes = input.changes ?? []

  if (changes.length === 0) {
    return [
      line(`tool FileChange: ${typeof input.status === 'string' ? input.status : 'completed'}`, 'tool'),
      line('No file changes recorded.', 'muted'),
    ]
  }

  const first = changes[0]
  const filePath = typeof first.path === 'string' && first.path.trim() ? first.path : 'unknown file'
  const fileName = pathBasename(filePath) || filePath
  const kind = summarizeKind(first.kind)
  const toolSummary = changes.length > 1
    ? `tool FileChange: ${fileName} +${changes.length - 1} more`
    : `tool FileChange: ${fileName}`
  const lines: TuiTranscriptCardLine[] = [
    line(toolSummary, 'tool'),
    line(`${kind} ${filePath}`, 'diff_meta'),
    ...previewDiff(normalizeUnifiedDiff(first.diff ?? ''), Math.max(MAX_CARD_LINES - 2 - (changes.length > 1 ? 1 : 0), 1)),
  ]

  if (changes.length > 1) {
    lines.push(line(`… ${changes.length - 1} more files`, 'dim'))
  }

  return lines
}

function makeUnifiedDiffHunk(filePath: string, oldStr: string, newStr: string): string {
  const oldLines = oldStr ? oldStr.split('\n') : []
  const newLines = newStr ? newStr.split('\n') : []
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
  ].join('\n')
}

export function synthesizeEditDiff(message: ThreadedMessage): string | undefined {
  const hunks: string[] = []
  for (const block of message.blocks) {
    if (block.type !== 'tool_thread') continue
    const normalizedBlock = normalizeToolThreadForTui(block)
    const { name, input } = normalizedBlock.toolUse
    const inp = input as Record<string, unknown>

    if (name === 'Edit') {
      const filePath = typeof inp.file_path === 'string' ? inp.file_path : 'unknown'
      const oldStr = typeof inp.old_string === 'string' ? inp.old_string : ''
      const newStr = typeof inp.new_string === 'string' ? inp.new_string : ''
      if (oldStr || newStr) hunks.push(makeUnifiedDiffHunk(filePath, oldStr, newStr))
    } else if (name === 'MultiEdit') {
      const edits = Array.isArray(inp.edits) ? (inp.edits as Array<Record<string, unknown>>) : []
      const defaultFilePath = typeof inp.file_path === 'string' ? inp.file_path : 'unknown'
      for (const edit of edits) {
        const filePath = typeof edit.file_path === 'string' ? edit.file_path : defaultFilePath
        const oldStr = typeof edit.old_string === 'string' ? edit.old_string : ''
        const newStr = typeof edit.new_string === 'string' ? edit.new_string : ''
        if (oldStr || newStr) hunks.push(makeUnifiedDiffHunk(filePath, oldStr, newStr))
      }
    } else if (name === 'Write') {
      const filePath = typeof inp.file_path === 'string' ? inp.file_path : 'unknown'
      const content = typeof inp.content === 'string' ? inp.content : ''
      if (content) hunks.push(makeUnifiedDiffHunk(filePath, '', content))
    }
  }
  return hunks.length > 0 ? hunks.join('\n') : undefined
}

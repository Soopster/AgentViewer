

import type { ToolThread } from '@/lib/threading'

import { canonicalToolName, toolInputRecord, toolStringParam, agentsFileChanges, summarizeAgentsFileChangeKind, agentsDiffStats, agentsEditStats, summarizeAgentsTool, lineCount, normalizeToolThreadForNativeCard } from './toolModel'

export function streamToolStatus(thread: ToolThread): { marker: '•' | '✓' | '×' | '▲'; color: string; rank: number } {
  if (thread.result?.is_error) return { marker: '×', color: 'var(--red)', rank: 3 }
  const status = typeof thread.toolUse.input.status === 'string' ? thread.toolUse.input.status.toLowerCase() : ''
  if (/denied|blocked|warning|approval/.test(status)) return { marker: '▲', color: 'var(--amber)', rank: 2 }
  if (thread.result) return { marker: '✓', color: 'var(--green)', rank: 1 }
  return { marker: '•', color: 'var(--text-3)', rank: 0 }
}

export function isStreamActivityThread(thread: ToolThread): boolean {
  return ['Bash', 'Read', 'Grep', 'Glob'].includes(canonicalToolName(thread.toolUse.name))
}

export function streamActivitySummary(threads: ToolThread[]): string {
  let readCount = 0
  let searchCount = 0
  let shellCount = 0
  for (const thread of threads) {
    const name = canonicalToolName(thread.toolUse.name)
    if (name === 'Read') readCount += 1
    else if (name === 'Grep' || name === 'Glob') searchCount += 1
    else if (name === 'Bash') shellCount += 1
  }
  const parts: string[] = []
  if (readCount > 0) parts.push(`${readCount} ${readCount === 1 ? 'file' : 'files'}`)
  if (searchCount > 0) parts.push(`${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`)
  if (shellCount > 0) parts.push(`${shellCount} shell ${shellCount === 1 ? 'command' : 'commands'}`)
  return parts.join('  ·  ')
}

export function isStreamFileUpdateThread(thread: ToolThread): boolean {
  return ['Edit', 'MultiEdit', 'Write', 'FileChange'].includes(canonicalToolName(thread.toolUse.name))
}

export type StreamDiffPreviewLine = {
  key: string
  tone: 'context' | 'addition' | 'deletion'
  oldLine?: number
  newLine?: number
  text: string
}

export type StreamFileUpdateData = {
  operation: 'Create' | 'Update' | 'Delete'
  path: string
  additions: number
  deletions: number
  preview: StreamDiffPreviewLine[]
  hiddenLines: number
}

const STREAM_WEB_DIFF_PREVIEW_LINES = 7

function streamPatchPreview(patch: string): { lines: StreamDiffPreviewLine[]; hiddenLines: number } {
  const parsed: StreamDiffPreviewLine[] = []
  let oldLine = 0
  let newLine = 0
  let sequence = 0
  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    if (hunk?.[1] && hunk[2]) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue
    if (line.startsWith('+')) {
      parsed.push({ key: `a:${sequence}`, tone: 'addition', newLine, text: line.slice(1) })
      newLine += 1
      sequence += 1
    } else if (line.startsWith('-')) {
      parsed.push({ key: `d:${sequence}`, tone: 'deletion', oldLine, text: line.slice(1) })
      oldLine += 1
      sequence += 1
    } else if (line.startsWith(' ')) {
      parsed.push({ key: `c:${sequence}`, tone: 'context', oldLine, newLine, text: line.slice(1) })
      oldLine += 1
      newLine += 1
      sequence += 1
    }
  }
  const firstChange = parsed.findIndex((line) => line.tone !== 'context')
  const start = Math.max(firstChange - 2, 0)
  const lines = parsed.slice(start, start + STREAM_WEB_DIFF_PREVIEW_LINES)
  return { lines, hiddenLines: Math.max(parsed.length - lines.length, 0) }
}

function streamInlineEditPreview(input: Record<string, unknown>): StreamDiffPreviewLine[] {
  const edits = Array.isArray(input.edits) ? input.edits : [input]
  const lines: StreamDiffPreviewLine[] = []
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue
    const record = edit as Record<string, unknown>
    const oldText = toolStringParam(record, ['oldText', 'old_string']) ?? ''
    const newText = toolStringParam(record, ['newText', 'new_string']) ?? ''
    for (const text of oldText.split('\n').filter(Boolean)) {
      lines.push({ key: `d:${lines.length}`, tone: 'deletion', text })
    }
    for (const text of newText.split('\n').filter(Boolean)) {
      lines.push({ key: `a:${lines.length}`, tone: 'addition', text })
    }
  }
  return lines.slice(0, STREAM_WEB_DIFF_PREVIEW_LINES)
}

export function streamFileUpdateData(thread: ToolThread): StreamFileUpdateData | null {
  const normalized = normalizeToolThreadForNativeCard(thread)
  const name = canonicalToolName(normalized.toolUse.name)
  if (!['Edit', 'MultiEdit', 'Write', 'FileChange'].includes(name)) return null
  const input = toolInputRecord(normalized)

  if (name === 'FileChange') {
    const changes = agentsFileChanges(input)
    if (changes.length === 0) return null
    const first = changes[0]
    const patch = first.diff ?? ''
    const stats = changes.reduce((total, change) => {
      const next = agentsDiffStats(change.diff)
      return { additions: total.additions + next.additions, deletions: total.deletions + next.deletions }
    }, { additions: 0, deletions: 0 })
    const kind = summarizeAgentsFileChangeKind(first.kind).toLowerCase()
    const operation = patch.includes('--- /dev/null') || /create|add/.test(kind)
      ? 'Create'
      : patch.includes('+++ /dev/null') || /delete|remove/.test(kind)
        ? 'Delete'
        : 'Update'
    const preview = streamPatchPreview(patch)
    const firstPath = first.path ?? 'file'
    return {
      operation,
      path: changes.length > 1 ? `${firstPath} (+${changes.length - 1} more)` : firstPath,
      additions: stats.additions,
      deletions: stats.deletions,
      preview: preview.lines,
      hiddenLines: preview.hiddenLines,
    }
  }

  const path = toolStringParam(input, ['file_path', 'path']) ?? 'file'
  if (name === 'Write') {
    const content = toolStringParam(input, ['content']) ?? ''
    const contentLines = content ? content.split('\n') : []
    return {
      operation: 'Create',
      path,
      additions: content ? lineCount(content) : 0,
      deletions: 0,
      preview: contentLines.slice(0, STREAM_WEB_DIFF_PREVIEW_LINES).map((text, index) => ({
        key: `a:${index}`,
        tone: 'addition',
        newLine: index + 1,
        text,
      })),
      hiddenLines: Math.max(contentLines.length - STREAM_WEB_DIFF_PREVIEW_LINES, 0),
    }
  }

  const stats = agentsEditStats(input) ?? { additions: 0, deletions: 0 }
  const preview = streamInlineEditPreview(input)
  return {
    operation: 'Update',
    path,
    additions: stats.additions,
    deletions: stats.deletions,
    preview,
    hiddenLines: Math.max(stats.additions + stats.deletions - preview.length, 0),
  }
}

export function dedupeStreamToolThreads(threads: ToolThread[]): ToolThread[] {
  const unique: ToolThread[] = []
  const indexBySummary = new Map<string, number>()
  for (const thread of threads) {
    // Preserve every file mutation as its own chronological update. Repeated
    // edits to the same path are meaningful history, not duplicate status rows.
    if (isStreamFileUpdateThread(thread)) {
      unique.push(thread)
      continue
    }
    const key = `${canonicalToolName(thread.toolUse.name)} ${summarizeAgentsTool(thread)}`.replace(/\s+/g, ' ').trim().toLowerCase()
    const existingIndex = indexBySummary.get(key)
    if (existingIndex == null) {
      indexBySummary.set(key, unique.length)
      unique.push(thread)
      continue
    }
    const existing = unique[existingIndex]
    if (existing && streamToolStatus(thread).rank > streamToolStatus(existing).rank) unique[existingIndex] = thread
  }
  return unique
}

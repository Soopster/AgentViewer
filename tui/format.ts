import { getAssistantLabel } from '../lib/provider'
import { pathBasename } from '../lib/projectPaths'
import { renderMermaidASCII } from 'beautiful-mermaid'
import type { ThreadedBlock, ThreadedMessage, ToolThread } from '../lib/threading'
import type { ContentBlock, Session, SessionInfo } from '../lib/types'
import type { TuiDensity } from './theme'

const MAX_PREVIEW_CHARS = 160
const MAX_BLOCK_LINES = 6
const MAX_CARD_LINES = 4
const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export type TuiTranscriptLineTone =
  | 'default'
  | 'muted'
  | 'dim'
  | 'tool'
  | 'agent'
  | 'result_ok'
  | 'result_error'
  | 'thinking'
  | 'system'
  | 'diff_add'
  | 'diff_remove'
  | 'diff_meta'

export type TuiTranscriptCardLine = {
  text: string
  tone: TuiTranscriptLineTone
}

export type TuiTranscriptCardCategory = 'conversation' | 'technical' | 'diff' | 'system' | 'insight'

function countNonBlankLines(value: string): number {
  let count = 0
  let lineHasContent = false
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i)
    if (ch === 10) {
      if (lineHasContent) count++
      lineHasContent = false
    } else if (ch !== 32 && ch !== 9 && ch !== 13) {
      lineHasContent = true
    }
  }
  if (lineHasContent) count++
  return count
}

function sanitizeLine(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, '')
}

function formatTimestamp(value?: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function truncateLine(value: string, maxChars = MAX_PREVIEW_CHARS): string {
  const sanitized = sanitizeLine(value)
  if (sanitized.length <= maxChars) return sanitized
  return `${sanitized.slice(0, Math.max(maxChars - 1, 1))}…`
}

function compactLines(lines: string[]): string[] {
  const normalized = lines
    .map((line) => truncateLine(line.trimEnd()))
    .filter((line) => line.length > 0)

  if (normalized.length <= MAX_BLOCK_LINES) return normalized
  return [
    ...normalized.slice(0, MAX_BLOCK_LINES),
    `… ${normalized.length - MAX_BLOCK_LINES} more lines`,
  ]
}

function previewJson(value: unknown): string {
  try {
    return truncateLine(JSON.stringify(value))
  } catch {
    return truncateLine(String(value))
  }
}

function line(text: string, tone: TuiTranscriptLineTone = 'default'): TuiTranscriptCardLine {
  return { text, tone }
}

function summarizeKind(kind: unknown): string {
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
function normalizeUnifiedDiff(diff: string): string {
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

function previewDiff(diffText: string, limit: number): TuiTranscriptCardLine[] {
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

function previewFileChange(thread: ToolThread): TuiTranscriptCardLine[] {
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

function extractAgentResultText(content: string | ContentBlock[] | null | undefined): string | null {
  if (!content) return null
  if (typeof content === 'string') return content.trim() || null
  const parts = content
    .filter((b) => b.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => ((b as { text: string }).text).trim())
    .filter((t) => t.length > 0)
  return parts.length > 0 ? parts.join('\n\n') : null
}

function parseAgentResultJson(content: string | ContentBlock[] | null | undefined): Record<string, unknown> | null {
  const raw = extractAgentResultText(content)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function formatAgentStatsSummary(parsed: Record<string, unknown> | null): string {
  if (!parsed) return ''
  const parts: string[] = []
  const ms = parsed.totalDurationMs as number | undefined
  const tok = parsed.totalTokens as number | undefined
  const tools = parsed.totalToolUseCount as number | undefined
  const stats = parsed.toolStats as Record<string, number> | undefined
  if (ms != null) parts.push(`${(ms / 1000).toFixed(1)}s`)
  if (tok != null) parts.push(`${tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : tok} tok`)
  if (tools != null) parts.push(`${tools} tools`)
  if (stats) {
    if (stats.bashCount) parts.push(`bash×${stats.bashCount}`)
    if (stats.editFileCount) parts.push(`edit×${stats.editFileCount}`)
    if (stats.readCount) parts.push(`read×${stats.readCount}`)
    if (stats.linesAdded || stats.linesRemoved) parts.push(`+${stats.linesAdded ?? 0}/-${stats.linesRemoved ?? 0}`)
  }
  return parts.join('  ')
}

function previewTool(thread: ToolThread): TuiTranscriptCardLine[] {
  if (thread.toolUse.name === 'FileChange') {
    return previewFileChange(thread)
  }

  const input = thread.toolUse.input as Record<string, unknown>
  const toolName = thread.toolUse.name

  if (toolName === 'Agent') {
    const description = typeof input.description === 'string' ? input.description : 'agent'
    const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : ''
    const isError = thread.result?.is_error === true
    const parsed = parseAgentResultJson(thread.result?.content)
    const resultText = extractAgentResultText(thread.result?.content)
    const previewText = resultText
      ? truncateLine(resultText.split('\n').find((l) => l.trim()) ?? resultText)
      : thread.result ? 'done' : 'running…'
    const stats = formatAgentStatsSummary(parsed)
    const lines: TuiTranscriptCardLine[] = [
      line(`agent ${description}${subagentType ? ` [${subagentType}]` : ''}`, 'tool'),
      line(`${isError ? '✗' : '✓'} ${previewText}`, isError ? 'result_error' : 'result_ok'),
    ]
    if (stats) lines.push(line(stats, 'dim'))
    return lines
  }

  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
    const filePath = typeof input.file_path === 'string' ? pathBasename(input.file_path) : ''
    const isError = thread.result?.is_error === true

    let removedLines = 0
    let addedLines = 0

    if (toolName === 'MultiEdit') {
      const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : []
      for (const edit of edits) {
        if (typeof edit.old_string === 'string') removedLines += countNonBlankLines(edit.old_string)
        if (typeof edit.new_string === 'string') addedLines += countNonBlankLines(edit.new_string)
      }
    } else if (toolName === 'Write') {
      const content = typeof input.content === 'string' ? input.content : ''
      addedLines = countNonBlankLines(content)
    } else {
      if (typeof input.old_string === 'string') removedLines = countNonBlankLines(input.old_string)
      if (typeof input.new_string === 'string') addedLines = countNonBlankLines(input.new_string)
    }

    const summary = toolName === 'Write'
      ? `+${addedLines} lines`
      : `-${removedLines} +${addedLines} lines`

    return [
      line(`tool ${toolName}${filePath ? `: ${filePath}` : ''}`, 'tool'),
      line(isError ? '✗ ERROR' : `✓ ${summary}`, isError ? 'result_error' : 'result_ok'),
    ]
  }

  const target = typeof input.file_path === 'string'
    ? pathBasename(input.file_path)
    : typeof input.path === 'string'
    ? pathBasename(input.path)
    : typeof input.command === 'string'
    ? input.command
    : typeof input.pattern === 'string'
    ? input.pattern
    : previewJson(thread.toolUse.input)

  const resultText = typeof thread.result?.content === 'string'
    ? truncateLine(thread.result.content.trim())
    : thread.result
    ? 'structured result'
    : 'pending'

  return [
    line(`tool ${thread.toolUse.name}${target ? `: ${target}` : ''}`, 'tool'),
    line(`result ${thread.result?.is_error ? 'error' : 'ok'}: ${resultText || 'empty'}`, thread.result?.is_error ? 'result_error' : 'result_ok'),
  ]
}

function formatBlock(block: ThreadedBlock): TuiTranscriptCardLine[] {
  switch (block.type) {
    case 'text':
      return block.text.trim()
        ? compactLines(block.text.trim().split('\n')).map((entry) => line(entry))
        : []
    case 'thinking':
      return block.thinking.trim()
        ? [line(`thinking: ${truncateLine(block.thinking.trim().split('\n')[0])}`, 'thinking')]
        : [line('thinking', 'thinking')]
    case 'tool_thread':
      return previewTool(block)
    case 'task_notification':
      return [line(`task ${block.status}: ${truncateLine(block.summary || block.taskId)}`, 'thinking')]
    case 'system_reminder':
      return [line(`system reminder: ${truncateLine(block.content)}`, 'system')]
    case 'slash_command':
      return [line(truncateLine(`/${block.command} ${block.args}`.trim()), 'tool')]
    case 'local_command_stdout':
      return block.stdout.trim()
        ? [line(`❯ ${truncateLine(block.stdout.trim().split('\n')[0])}`, 'dim')]
        : [line('❯', 'dim')]
    case 'claude_system': {
      if (block.subtype === 'task_progress' || block.subtype === 'task_updated') {
        const text = typeof block.payload.summary === 'string' ? block.payload.summary
          : typeof block.payload.description === 'string' ? block.payload.description
          : 'task running'
        return [line(`● ${truncateLine(text)}`, 'thinking')]
      }
      return [line(`system ${block.subtype}`, 'system')]
    }
    case 'image':
      return [line('image attachment', 'muted')]
    default:
      return []
  }
}

export function formatTranscriptLines(messages: ThreadedMessage[]): string[] {
  const lines = messages.flatMap((message) => {
    const role = message.role === 'assistant'
      ? getAssistantLabel(message.provider)
      : message.role.toUpperCase()
    const header = `${role}${message.timestamp ? ` ${formatTimestamp(message.timestamp)}` : ''}`
    const body = message.blocks.flatMap(formatBlock)
    return [header, ...body.map((entry) => `  ${entry.text}`), '']
  })

  return lines
}

export type TuiTranscriptCard = {
  key: string
  role: ThreadedMessage['role']
  provider?: ThreadedMessage['provider']
  label: string
  category: TuiTranscriptCardCategory
  autoFold: boolean
  compactSummary: string
  usageSummary?: string
  timestamp?: string
  timestampMs?: number
  dayKey?: string
  dayLabel?: string
  lines: TuiTranscriptCardLine[]
  expandedLines: TuiTranscriptCardLine[]
  searchText: string
  codeBlocks?: Array<{ key: string; lang: string; content: string }>
  editDiff?: string
  markdownContent?: string
  hasMermaidDiagrams?: boolean
}

function cardLineLimit(density: TuiDensity): number {
  switch (density) {
    case 'comfortable':
      return 3
    case 'dense':
      return 6
    default:
      return MAX_CARD_LINES
  }
}

function formatDayLabel(value?: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parsed)
}

function compactCardLines(lines: TuiTranscriptCardLine[], density: TuiDensity): TuiTranscriptCardLine[] {
  const normalized = lines
    .map((entry) => ({
      text: truncateLine(entry.text.trim()),
      tone: entry.tone,
    }))
    .filter((entry) => entry.text.length > 0)

  const maxCardLines = cardLineLimit(density)
  if (normalized.length === 0) return [line('No visible content', 'dim')]
  if (normalized.length <= maxCardLines) return normalized
  return [
    ...normalized.slice(0, maxCardLines - 1),
    line(`… ${normalized.length - (maxCardLines - 1)} more`, 'dim'),
  ]
}

function compactAutoFoldLines(lines: TuiTranscriptCardLine[]): TuiTranscriptCardLine[] {
  const normalized = lines
    .map((entry) => ({
      text: truncateLine(entry.text.trim()),
      tone: entry.tone,
    }))
    .filter((entry) => entry.text.length > 0)

  if (normalized.length === 0) return [line('Technical activity', 'muted')]
  if (normalized.length <= 2) return normalized
  return [
    normalized[0],
    line(`… ${normalized.length - 1} more`, 'dim'),
  ]
}

function compactMermaidLines(lines: TuiTranscriptCardLine[]): TuiTranscriptCardLine[] {
  const diagramIndex = lines.findIndex((entry) => entry.text === '[diagram: mermaid]' || entry.text.startsWith('[diagram: mermaid render failed:'))
  if (diagramIndex === -1) return compactCardLines(lines, 'balanced')

  const sourceIndex = lines.findIndex((entry) => entry.text === '[source: mermaid]')
  const intro = lines.slice(0, diagramIndex)
    .map((entry) => ({
      text: truncateLine(entry.text.trim()),
      tone: entry.tone,
    }))
    .filter((entry) => entry.text.length > 0)
    .slice(0, 2)

  const diagramEnd = sourceIndex > diagramIndex ? sourceIndex : lines.length
  const diagramLineCount = Math.max(diagramEnd - diagramIndex - 1, 0)
  return [
    ...intro,
    line(`Mermaid diagram · ${diagramLineCount} rendered line${diagramLineCount === 1 ? '' : 's'} · source below · e expand`, 'muted'),
  ]
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatUsageSummary(message: ThreadedMessage): string | undefined {
  if (!message.usage) return undefined
  const parts = [
    `${fmtTokens(message.usage.input_tokens)}↑`,
    `${fmtTokens(message.usage.output_tokens)}↓`,
  ]
  const cacheRead = message.usage.cache_read_input_tokens ?? 0
  if (cacheRead > 0) parts.push(`⚡${fmtTokens(cacheRead)}`)
  return parts.join(' ')
}

const INSIGHT_RE = /`★\s*Insight\s*─+`/

function classifyCardCategory(message: ThreadedMessage): TuiTranscriptCardCategory {
  if (message.role === 'system') return 'system'
  const DIFF_TOOLS = new Set(['FileChange', 'Edit', 'MultiEdit', 'Write'])
  if (message.blocks.some((block) => block.type === 'tool_thread' && DIFF_TOOLS.has(block.toolUse.name))) {
    return 'diff'
  }

  const hasInsight = message.blocks.some(
    (block) => block.type === 'text' && INSIGHT_RE.test(block.text),
  )
  if (hasInsight) return 'insight'

  const hasOperationalBlock = message.blocks.some((block) => (
    block.type === 'tool_thread'
    || block.type === 'task_notification'
    || block.type === 'system_reminder'
    || block.type === 'slash_command'
    || block.type === 'local_command_stdout'
    || block.type === 'claude_system'
  ))

  return hasOperationalBlock ? 'technical' : 'conversation'
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

function synthesizeEditDiff(message: ThreadedMessage): string | undefined {
  const hunks: string[] = []
  for (const block of message.blocks) {
    if (block.type !== 'tool_thread') continue
    const { name, input } = block.toolUse
    const inp = input as Record<string, unknown>

    if (name === 'Edit') {
      const filePath = typeof inp.file_path === 'string' ? inp.file_path : 'unknown'
      const oldStr = typeof inp.old_string === 'string' ? inp.old_string : ''
      const newStr = typeof inp.new_string === 'string' ? inp.new_string : ''
      if (oldStr || newStr) hunks.push(makeUnifiedDiffHunk(filePath, oldStr, newStr))
    } else if (name === 'MultiEdit') {
      const edits = Array.isArray(inp.edits) ? (inp.edits as Array<Record<string, unknown>>) : []
      for (const edit of edits) {
        const filePath = typeof edit.file_path === 'string' ? edit.file_path : 'unknown'
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

export function formatTranscriptCard(message: ThreadedMessage, density: TuiDensity = 'balanced'): TuiTranscriptCard {
  const baseLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : message.role.toUpperCase()
  const label = message.origin?.kind?.startsWith('subagent:') ? `${baseLabel} ↪ sub` : baseLabel
  const previewLines = message.blocks.flatMap(formatBlock)
  const { processedLines: expandedLines, codeBlocks, hasMermaidDiagrams } = extractCodeBlocksFromBlocks(message.blocks)
  const parsedTimestamp = message.timestamp ? new Date(message.timestamp) : null
  const category = classifyCardCategory(message)
  const autoFold = category !== 'conversation' && category !== 'insight'
  const previewSourceLines = previewLines
  const collapsedLines = hasMermaidDiagrams
    ? compactMermaidLines(expandedLines)
    : autoFold
    ? compactAutoFoldLines(previewSourceLines)
    : compactCardLines(previewSourceLines, density)
  const compactSummary = collapsedLines.map((entry) => entry.text).join(' · ')

  return {
    key: message.uuid,
    role: message.role,
    provider: message.provider,
    label,
    category,
    autoFold,
    compactSummary,
    usageSummary: formatUsageSummary(message),
    timestamp: message.timestamp ? formatTimestamp(message.timestamp) : undefined,
    timestampMs: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.getTime() : undefined,
    dayKey: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.toISOString().slice(0, 10) : undefined,
    dayLabel: formatDayLabel(message.timestamp),
    lines: collapsedLines,
    expandedLines,
    searchText: expandedLines.map((entry) => entry.text).join('\n'),
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
    editDiff: synthesizeEditDiff(message),
    markdownContent: (category === 'conversation' || category === 'insight')
      ? extractMarkdownContent(message.blocks)
      : undefined,
    hasMermaidDiagrams,
  }
}

export function formatTranscriptCards(messages: ThreadedMessage[], density: TuiDensity = 'balanced'): TuiTranscriptCard[] {
  return messages.map((message) => formatTranscriptCard(message, density))
}

export function formatSessionLabel(session: Session): string {
  const title = session.customTitle ?? session.summary ?? '(untitled session)'
  const provider = session.provider ?? 'claude'
  const project = pathBasename(session.cwd) || 'no-project'
  return truncateLine(`${provider.padEnd(8)} ${title} · ${project}`, 110)
}

export function formatSessionTitle(session: Session): string {
  return truncateLine(session.customTitle ?? session.summary ?? '(untitled session)', 72)
}

export function formatSessionProject(session: Session): string {
  return truncateLine(pathBasename(session.cwd) || 'no-project', 28)
}

export function formatProviderLabel(provider?: Session['provider']): string {
  return (provider ?? 'claude').toUpperCase()
}

function extractMarkdownContent(blocks: ThreadedBlock[]): string | undefined {
  const chunks: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) {
      chunks.push(block.text.trim())
    }
  }
  return chunks.length > 0 ? chunks.join('\n\n') : undefined
}

const CODE_FENCE_RE = /^```(\w*)\s*\n([\s\S]*?)^```[ \t]*$/gm
const MERMAID_LANGS = new Set(['mermaid', 'mmd'])

function renderMermaidForTui(content: string): string {
  try {
    const rendered = renderMermaidASCII(content, {
      colorMode: 'none',
      useAscii: false,
      paddingX: 3,
      paddingY: 2,
      boxBorderPadding: 1,
    })
    return [
      '[diagram: mermaid]',
      rendered,
      '[source: mermaid]',
      '```mermaid',
      content,
      '```',
    ].join('\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to render Mermaid diagram.'
    return [
      `[diagram: mermaid render failed: ${message}]`,
      '```mermaid',
      content,
      '```',
    ].join('\n')
  }
}

function extractCodeBlocksFromBlocks(blocks: ThreadedBlock[]): {
  processedLines: TuiTranscriptCardLine[]
  codeBlocks: Array<{ key: string; lang: string; content: string }>
  hasMermaidDiagrams: boolean
} {
  const all: Array<{ key: string; lang: string; content: string }> = []
  let n = 0
  const lines: TuiTranscriptCardLine[] = []
  let hasMermaidDiagrams = false

  for (const block of blocks) {
    if (block.type !== 'text' || !block.text.trim()) {
      lines.push(...formatBlockExpanded(block).filter((l) => l.text.trim()))
      continue
    }
    const matches = Array.from(block.text.matchAll(CODE_FENCE_RE))
    let replaced = block.text
    for (const match of matches) {
      const lang = ((match[1] ?? '').trim() || 'text').toLowerCase()
      const content = (match[2] ?? '').trimEnd()
      if (MERMAID_LANGS.has(lang)) {
        hasMermaidDiagrams = true
        replaced = replaced.replace(match[0], renderMermaidForTui(content))
      } else {
        all.push({ key: `cb${n++}`, lang, content })
        replaced = replaced.replace(match[0], `[code: ${lang}]`)
      }
    }
    const processed = sanitizeLine(replaced).trim().split('\n')
      .map((l) => line(l.trimEnd()))
      .filter((l) => l.text.trim().length > 0)
    lines.push(...processed)
  }

  return { processedLines: lines, codeBlocks: all, hasMermaidDiagrams }
}

function formatBlockExpanded(block: ThreadedBlock): TuiTranscriptCardLine[] {
  switch (block.type) {
    case 'text':
      return block.text.trim()
        ? sanitizeLine(block.text).trim().split('\n').map((l) => line(l.trimEnd()))
        : []

    case 'thinking': {
      const content = block.thinking.trim()
      if (!content) return []
      return content
        .split('\n')
        .map((ln) => line(ln.trim(), 'thinking'))
        .filter((entry) => entry.text.length > 0)
    }

    case 'tool_thread': {
      const input = block.toolUse.input as Record<string, unknown>
      const toolName = block.toolUse.name

      if (toolName === 'FileChange') {
        const fcInput = block.toolUse.input as {
          changes?: Array<{ path?: string; kind?: unknown; diff?: string }>
        }
        const changes = fcInput.changes ?? []
        const result: TuiTranscriptCardLine[] = [
          line(`tool FileChange: ${changes.length} file change${changes.length === 1 ? '' : 's'}`, 'tool'),
        ]
        for (const [idx, change] of changes.entries()) {
          const filePath = typeof change.path === 'string' && change.path.trim() ? change.path : 'unknown file'
          const kind = summarizeKind(change.kind)
          if (idx > 0) result.push(line('', 'dim'))
          result.push(line(`${kind} ${filePath}`, 'diff_meta'))
          if (change.diff) result.push(...previewDiff(normalizeUnifiedDiff(change.diff), 60))
        }
        return result
      }

      if (toolName === 'Agent') {
        const description = typeof input.description === 'string' ? input.description : 'agent'
        const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : ''
        const isError = block.result?.is_error === true
        const parsed = parseAgentResultJson(block.result?.content)
        const resultText = extractAgentResultText(block.result?.content)
        const stats = formatAgentStatsSummary(parsed)
        const header = line(`agent ${description}${subagentType ? ` [${subagentType}]` : ''}`, 'tool')
        if (!block.result) return [header, line('running…', 'dim')]
        const resultLines = resultText
          ? sanitizeLine(resultText).split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0).map((l) => line(l, 'agent'))
          : [line(isError ? '✗ ERROR' : '✓ done', isError ? 'result_error' : 'result_ok')]
        return [
          header,
          ...resultLines,
          ...(stats ? [line(stats, 'dim')] : []),
        ]
      }

      if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
        const filePath = typeof input.file_path === 'string' ? input.file_path : ''
        const isError = block.result?.is_error === true
        // Diff content is handled via card.editDiff → <diff> component; only emit header + status here
        return [
          line(`tool ${toolName}${filePath ? `: ${filePath}` : ''}`, 'tool'),
          line(isError ? '✗ ERROR' : '✓ OK', isError ? 'result_error' : 'result_ok'),
        ]
      }

      const target = typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
        ? input.path
        : typeof input.command === 'string'
        ? input.command
        : typeof input.pattern === 'string'
        ? input.pattern
        : ''

      const toolLines: TuiTranscriptCardLine[] = [
        line(`tool ${toolName}${target ? `: ${target}` : ''}`, 'tool'),
      ]
      const isError = block.result?.is_error === true
      const content = typeof block.result?.content === 'string'
        ? sanitizeLine(block.result.content).trim()
        : null

      if (content) {
        toolLines.push(line(isError ? '✗ ERROR' : '✓ OK', isError ? 'result_error' : 'result_ok'))
        toolLines.push(
          ...content
            .split('\n')
            .map((l) => l.trimEnd())
            .filter((l) => l.length > 0)
            .map((l) => line(truncateLine(l), 'muted')),
        )
      } else if (block.result) {
        toolLines.push(line(isError ? '✗ ERROR' : '✓ OK', isError ? 'result_error' : 'result_ok'))
      }
      return toolLines
    }

    case 'task_notification':
      return [line(`task ${block.status}: ${truncateLine(block.summary || block.taskId)}`, 'thinking')]
    case 'system_reminder':
      return [line(`system reminder: ${truncateLine(block.content)}`, 'system')]
    case 'slash_command':
      return [line(truncateLine(`/${block.command} ${block.args}`.trim()), 'tool')]
    case 'local_command_stdout':
      return block.stdout.trim()
        ? sanitizeLine(block.stdout).trim().split('\n').map((l) => line(l.trimEnd(), 'dim'))
        : []
    case 'claude_system': {
      if (block.subtype === 'task_progress' || block.subtype === 'task_updated') {
        const p = block.payload
        const patch = typeof p.patch === 'object' && p.patch !== null
          ? p.patch as Record<string, unknown>
          : null
        const summary = typeof p.summary === 'string' ? p.summary : null
        const description = typeof p.description === 'string'
          ? p.description
          : typeof patch?.description === 'string'
          ? patch.description
          : null
        const status = typeof p.status === 'string'
          ? p.status
          : typeof patch?.status === 'string'
          ? patch.status
          : null
        const lastTool = typeof p.last_tool_name === 'string' ? p.last_tool_name : null
        const lines: TuiTranscriptCardLine[] = [
          line(`● ${summary ?? description ?? status ?? 'task running'}`, 'thinking'),
        ]
        if (status && status !== summary && status !== description) {
          lines.push(line(`  status: ${status}`, 'dim'))
        }
        if (lastTool) lines.push(line(`  last: ${lastTool}`, 'dim'))
        if (typeof p.usage === 'object' && p.usage !== null) {
          const u = p.usage as { tool_uses?: number; duration_ms?: number }
          const parts: string[] = []
          if (u.tool_uses != null) parts.push(`${u.tool_uses} tool calls`)
          if (u.duration_ms != null) parts.push(`${(u.duration_ms / 1000).toFixed(1)}s`)
          if (parts.length) lines.push(line(`  ${parts.join(' · ')}`, 'dim'))
        }
        if (typeof patch?.total_paused_ms === 'number') {
          lines.push(line(`  paused: ${(patch.total_paused_ms / 1000).toFixed(1)}s`, 'dim'))
        }
        if (typeof patch?.error === 'string' && patch.error.trim()) {
          lines.push(line(`  error: ${truncateLine(patch.error.trim())}`, 'result_error'))
        }
        return lines
      }
      return [line(`system ${block.subtype}`, 'system')]
    }
    case 'image':
      return [line('image attachment', 'muted')]
    default:
      return []
  }
}

export function formatMessageExpanded(messages: ThreadedMessage[], messageUuid: string): TuiTranscriptCardLine[] {
  const message = messages.find((m) => m.uuid === messageUuid)
  if (!message) return []
  return message.blocks
    .flatMap(formatBlockExpanded)
    .filter((ln) => ln.text.trim().length > 0)
}

export function formatSessionMeta(session: Session, info: SessionInfo | null): string[] {
  const title = info?.customTitle ?? info?.summary ?? session.customTitle ?? session.summary ?? '(untitled session)'
  const project = info?.cwd ?? session.cwd ?? 'unknown'
  const model = info?.currentModel ?? 'unknown'
  const tag = info?.tag ?? session.tag ?? 'none'

  return [
    truncateLine(title),
    truncateLine(`project: ${project}`),
    truncateLine(`model: ${model}`),
    truncateLine(`tag: ${tag}`),
  ]
}

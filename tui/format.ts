import { getAssistantLabel } from '../lib/provider'
import { pathBasename } from '../lib/projectPaths'
import type { ThreadedBlock, ThreadedMessage, ToolThread } from '../lib/threading'
import type { Session, SessionInfo } from '../lib/types'
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
  return parsed.toISOString().slice(11, 19)
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
    const fallback = rawLines.filter(Boolean).slice(0, limit).map((entry) => line(truncateLine(entry), 'muted'))
    if (rawLines.filter(Boolean).length > limit) {
      fallback.push(line(`… ${rawLines.filter(Boolean).length - limit} more diff lines`, 'dim'))
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
  const kind = summarizeKind(first.kind)
  const lines: TuiTranscriptCardLine[] = [
    line(`tool FileChange: ${changes.length} file change${changes.length === 1 ? '' : 's'}`, 'tool'),
    line(`${kind} ${filePath}`, 'diff_meta'),
    ...previewDiff(first.diff ?? '', Math.max(MAX_CARD_LINES - 2 - (changes.length > 1 ? 1 : 0), 1)),
  ]

  if (changes.length > 1) {
    lines.push(line(`… ${changes.length - 1} more files`, 'dim'))
  }

  return lines
}

function previewTool(thread: ToolThread): TuiTranscriptCardLine[] {
  if (thread.toolUse.name === 'FileChange') {
    return previewFileChange(thread)
  }

  const input = thread.toolUse.input as Record<string, unknown>
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
      return [line(truncateLine(`slash command: /${block.command} ${block.args}`.trim()), 'tool')]
    case 'local_command_stdout':
      return block.stdout.trim()
        ? [line(`stdout: ${truncateLine(block.stdout.trim().split('\n')[0])}`, 'muted')]
        : [line('stdout', 'muted')]
    case 'claude_system':
      return [line(`system ${block.subtype}`, 'system')]
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
  timestamp?: string
  timestampMs?: number
  dayKey?: string
  dayLabel?: string
  lines: TuiTranscriptCardLine[]
  expandedLines: TuiTranscriptCardLine[]
  searchText: string
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

export function formatTranscriptCards(messages: ThreadedMessage[], density: TuiDensity = 'balanced'): TuiTranscriptCard[] {
  return messages.map((message) => {
    const label = message.role === 'assistant'
      ? getAssistantLabel(message.provider)
      : message.role.toUpperCase()
    const expandedLines = message.blocks
      .flatMap(formatBlockExpanded)
      .filter((entry) => entry.text.trim().length > 0)
    const parsedTimestamp = message.timestamp ? new Date(message.timestamp) : null

    return {
      key: message.uuid,
      role: message.role,
      provider: message.provider,
      label,
      timestamp: message.timestamp ? formatTimestamp(message.timestamp) : undefined,
      timestampMs: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.getTime() : undefined,
      dayKey: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.toISOString().slice(0, 10) : undefined,
      dayLabel: formatDayLabel(message.timestamp),
      lines: compactCardLines(message.blocks.flatMap(formatBlock), density),
      expandedLines,
      searchText: expandedLines.map((entry) => entry.text).join('\n'),
    }
  })
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

function formatBlockExpanded(block: ThreadedBlock): TuiTranscriptCardLine[] {
  switch (block.type) {
    case 'text':
      return block.text.trim()
        ? sanitizeLine(block.text).trim().split('\n').map((l) => line(l.trimEnd()))
        : []

    case 'thinking':
      return block.thinking.trim()
        ? [line(`thinking: ${truncateLine(block.thinking.trim().split('\n')[0])}`, 'thinking')]
        : []

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
          if (change.diff) result.push(...previewDiff(change.diff, 60))
        }
        return result
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
        ? sanitizeLine(block.stdout).trim().split('\n').map((l) => line(l.trimEnd(), 'muted'))
        : []
    case 'claude_system':
      return [line(`system ${block.subtype}`, 'system')]
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

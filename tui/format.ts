import { getAssistantLabel } from '../lib/provider'
import {
  extractClaudeReadFileSummary,
  formatClaudeReadKind,
  formatClaudeReadMetadata,
  formatClaudeReadRange,
  formatClaudeRuntimeCounts,
  formatClaudeRuntimeDetailLines,
} from '../lib/claudeSdkFeatures'
import { pathBasename } from '../lib/projectPaths'
import { renderMermaidASCII } from 'beautiful-mermaid'
import { detectTuiCodeFiletypeFromPath, normalizeTuiCodeFiletype } from './codeFiletypes'
import type { ThreadedBlock, ThreadedMessage, ToolThread } from '../lib/threading'
import { buildTaskRegistry, parseCreatedTaskId, type TaskRegistry } from '../lib/taskRegistry'
import type { ContentBlock, Session, SessionInfo, SystemMessagePayload } from '../lib/types'
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

export type TuiTranscriptCodeBlock = {
  key: string
  lang: string
  filetype?: string
  content: string
  filePath?: string
  lineNumbers?: string[]
  maxVisibleLines?: number
}

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

type McpToolId = { server: string; tool: string }

function parseMcpToolName(name: string): McpToolId | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const idx = rest.indexOf('__')
  if (idx <= 0) return null
  const server = rest.slice(0, idx)
  const tool = rest.slice(idx + 2)
  if (!server || !tool) return null
  return { server, tool }
}

function prettifyFencedJson(text: string): string {
  return text.replace(/```json\s*\n([\s\S]*?)\n```/g, (match, body: string) => {
    const trimmed = body.trim()
    if (trimmed.includes('\n')) return match
    try {
      const parsed = JSON.parse(trimmed)
      return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
    } catch {
      return match
    }
  })
}

function extractResultText(content: unknown): string {
  if (typeof content === 'string') return prettifyFencedJson(content)
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text)
    } else if (b.type === 'image') {
      parts.push('[image]')
    }
  }
  return prettifyFencedJson(parts.join('\n').trim())
}

function mcpHeaderLabel(id: McpToolId): string {
  return `mcp ${id.server}/${id.tool}`
}

function summarizeMcpInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input)
  if (keys.length === 0) return ''
  const firstKey = keys[0]
  const firstVal = input[firstKey]
  if (typeof firstVal === 'string') {
    const oneLine = firstVal.replace(/\s+/g, ' ').trim()
    return keys.length === 1 ? oneLine : `${firstKey}: ${oneLine}`
  }
  if (firstVal == null) return firstKey
  return `${firstKey}: ${previewJson(firstVal)}`
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

const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TaskStop'])
const OPENCODE_TASK_TOOL_NAMES = new Set(['task', 'task_status'])
const OPENCODE_TASK_STATE_TONE: Record<string, TuiTranscriptLineTone> = {
  pending: 'dim',
  running: 'thinking',
  completed: 'result_ok',
  error: 'result_error',
  cancelled: 'dim',
}
const TASK_STATUS_ICON: Record<string, string> = {
  completed: '✓',
  in_progress: '◐',
  running: '◐',
  pending: '○',
  paused: 'Ⅱ',
  failed: '×',
  stopped: '■',
  killed: '■',
  deleted: '✗',
}

type TaskListGroupKey = 'in_progress' | 'blocked' | 'paused' | 'pending' | 'failed' | 'stopped' | 'completed' | 'other'

const TASK_LIST_GROUP_ORDER: TaskListGroupKey[] = [
  'in_progress',
  'blocked',
  'paused',
  'pending',
  'failed',
  'stopped',
  'completed',
  'other',
]

const TASK_LIST_GROUP_LABEL: Record<TaskListGroupKey, string> = {
  in_progress: 'IN PROGRESS',
  blocked: 'BLOCKED',
  paused: 'PAUSED',
  pending: 'PENDING',
  failed: 'FAILED',
  stopped: 'STOPPED',
  completed: 'COMPLETED',
  other: 'OTHER',
}

type TaskItem = { id?: string; subject?: string; status?: string; owner?: string; blockedBy?: string[] }
type TaskToolInput = {
  taskId?: string
  task_id?: string
  subject?: string
  description?: string
  activeForm?: string
  status?: string
  owner?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
}

type TaskGetResult = { task?: { id?: string; subject?: string; description?: string; status?: string; blocks?: string[]; blockedBy?: string[] } | null }
type TaskCreateResult = { task?: { id?: string; subject?: string } }
type TaskUpdateResult = { success?: boolean; taskId?: string; updatedFields?: string[]; error?: string; statusChange?: { from?: string; to?: string } }

function parseTaskResultJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export type TaskActiveForms = Map<string, string>

/**
 * Scan a thread of messages for TaskCreate/TaskUpdate calls and build a map of
 * taskId → activeForm reflecting the most recent activeForm set for each task.
 * Used by the TaskList renderer to substitute the present-continuous form for
 * tasks that are currently in_progress.
 */
export function buildTaskActiveForms(messages: ThreadedMessage[]): TaskActiveForms {
  const map = new Map<string, string>()
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type !== 'tool_thread') continue
      const name = b.toolUse.name
      if (name === 'TaskCreate') {
        const inp = b.toolUse.input as { activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (!af || !b.result) continue
        const text = resultRawTextOf(b)
        if (!text) continue
        const id = parseCreatedTaskId(text)
        if (id) map.set(id, af)
      } else if (name === 'TaskUpdate') {
        const inp = b.toolUse.input as { taskId?: string; task_id?: string; activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        const id = inp.taskId ?? inp.task_id
        if (typeof id === 'string' && af) map.set(id, af)
      }
    }
  }
  return map
}

function parseTaskListPayload(raw: string | null | undefined): TaskItem[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as TaskItem[]
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
      return (parsed as { tasks: TaskItem[] }).tasks
    }
  } catch { /* not JSON */ }
  return null
}

function taskListGroupFor(task: TaskItem, completedSet: Set<string>): TaskListGroupKey {
  const status = task.status ?? 'pending'
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : []
  const openBlockers = blockedBy.filter((id) => !completedSet.has(id))
  if ((status === 'pending' || status === '') && openBlockers.length > 0) return 'blocked'
  if (status === 'in_progress' || status === 'running') return 'in_progress'
  if (status === 'paused') return 'paused'
  if (status === 'pending' || status === '') return 'pending'
  if (status === 'failed') return 'failed'
  if (status === 'stopped' || status === 'killed') return 'stopped'
  if (status === 'completed') return 'completed'
  return 'other'
}

function groupTaskListItems(tasks: TaskItem[], completedSet: Set<string>): Array<{ group: TaskListGroupKey; tasks: TaskItem[] }> {
  const grouped: Record<TaskListGroupKey, TaskItem[]> = {
    in_progress: [],
    blocked: [],
    paused: [],
    pending: [],
    failed: [],
    stopped: [],
    completed: [],
    other: [],
  }
  for (const task of tasks) grouped[taskListGroupFor(task, completedSet)].push(task)
  return TASK_LIST_GROUP_ORDER
    .map((group) => ({ group, tasks: grouped[group] }))
    .filter((entry) => entry.tasks.length > 0)
}

function resultTextOf(thread: ToolThread): string | null {
  const content = thread.result?.content
  if (typeof content === 'string') return content.trim() || null
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      const text = (block as { type?: string; text?: unknown }).text
      if (block && (block as { type?: string }).type === 'text' && typeof text === 'string') {
        const trimmed = text.trim()
        if (trimmed) parts.push(trimmed)
      }
    }
    return parts.length > 0 ? parts.join('\n\n') : null
  }
  return null
}

function readInputPathOf(thread: ToolThread): string | undefined {
  const input = thread.toolUse.input as { file_path?: unknown }
  return typeof input.file_path === 'string' ? input.file_path : undefined
}

function readSummaryOf(thread: ToolThread) {
  return extractClaudeReadFileSummary(thread.result, readInputPathOf(thread))
}

function readSummaryStatusText(thread: ToolThread): string {
  const summary = readSummaryOf(thread)
  const range = summary ? formatClaudeReadRange(summary) : null
  const kind = summary ? formatClaudeReadKind(summary) : null
  const parts = [
    range,
    kind,
    summary?.truncatedByTokenCap ? 'partial: token cap' : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'OK'
}

function claudeRuntimeSuffix(payload: SystemMessagePayload): string {
  return formatClaudeRuntimeCounts(payload).join(' · ')
}

function withClaudeRuntimeSuffix(text: string, payload: SystemMessagePayload): string {
  const suffix = claudeRuntimeSuffix(payload)
  return suffix ? `${text} · ${suffix}` : text
}

function claudeRuntimeDetailCardLines(payload: SystemMessagePayload): TuiTranscriptCardLine[] {
  return formatClaudeRuntimeDetailLines(payload).map((entry) => {
    if (!entry.trim()) return line('', 'dim')
    if (entry.endsWith(':')) return line(entry, 'system')
    return line(`  ${truncateLine(entry)}`, 'dim')
  })
}

function resultRawTextOf(thread: ToolThread): string | null {
  if (thread.toolUse.name === 'Read') {
    const summary = readSummaryOf(thread)
    if (summary?.content) return summary.content
  }
  const content = thread.result?.content
  if (typeof content === 'string') return content || null
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      const text = (block as { type?: string; text?: unknown }).text
      if (block && (block as { type?: string }).type === 'text' && typeof text === 'string') {
        parts.push(text)
        continue
      }
      const file = (block as { type?: string; file?: unknown }).file
      if (block && (block as { type?: string }).type === 'text' && file && typeof file === 'object') {
        const content = (file as { content?: unknown }).content
        if (typeof content === 'string') parts.push(content)
      }
    }
    const joined = parts.join('\n\n')
    return joined || null
  }
  return null
}

const TOOLSEARCH_NAME_PATTERN = /"name"\s*:\s*"([A-Za-z0-9_./:-]+)"/g

type ToolSearchInput = { query?: string; max_results?: number }

function formatToolSearchQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return '(empty)'
  if (trimmed.startsWith('select:')) {
    const names = trimmed.slice('select:'.length).split(',').map((n) => n.trim()).filter(Boolean)
    if (names.length === 0) return 'select (empty)'
    if (names.length === 1) return `select ${names[0]}`
    return `select ${names[0]} +${names.length - 1}`
  }
  return `"${truncateLine(trimmed, 80)}"`
}

function parseToolSearchNames(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  TOOLSEARCH_NAME_PATTERN.lastIndex = 0
  while ((m = TOOLSEARCH_NAME_PATTERN.exec(raw)) !== null) {
    if (m[1]) seen.add(m[1])
  }
  return [...seen]
}

function formatToolSearchTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] {
  const input = thread.toolUse.input as ToolSearchInput
  const queryLabel = formatToolSearchQuery(input.query ?? '')
  const result = thread.result
  const isError = result?.is_error === true
  const raw = resultTextOf(thread)
  const names = parseToolSearchNames(raw)

  const lines: TuiTranscriptCardLine[] = [
    line(`tool ToolSearch: ${queryLabel}`, 'tool'),
  ]
  if (!result) return lines
  if (isError) {
    lines.push(line('✗ ERROR', 'result_error'))
    return lines
  }
  if (names.length === 0) {
    lines.push(line('✓ no matches', 'result_ok'))
    return lines
  }
  lines.push(line(`✓ ${names.length} tool${names.length === 1 ? '' : 's'} loaded`, 'result_ok'))
  if (expanded) {
    for (const name of names) {
      lines.push(line(`• ${name}`, 'muted'))
    }
  }
  return lines
}

function formatTaskTool(thread: ToolThread, expanded: boolean, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  const name = thread.toolUse.name
  const input = thread.toolUse.input as TaskToolInput
  const result = thread.result
  const isError = result?.is_error === true
  const raw = resultTextOf(thread)

  if (name === 'TaskCreate') {
    const subject = (input.subject ?? '').trim() || 'task'
    const createdId = parseCreatedTaskId(raw ?? '')
    const idTag = createdId ? ` #${createdId}` : ''
    const lines: TuiTranscriptCardLine[] = [
      line(`tool TaskCreate${idTag}: ${truncateLine(subject)}`, 'tool'),
    ]
    if (expanded && input.description && input.description.trim()) {
      lines.push(line(truncateLine(input.description.trim()), 'muted'))
    }
    if (expanded && input.activeForm && input.activeForm.trim()) {
      lines.push(line(`active: ${truncateLine(input.activeForm.trim())}`, 'dim'))
    }
    if (result) {
      lines.push(line(isError ? '✗ ERROR' : '✓ created', isError ? 'result_error' : 'result_ok'))
    }
    return lines
  }

  if (name === 'TaskUpdate') {
    const rawId = input.taskId ?? input.task_id ?? ''
    const id = rawId ? `#${rawId}` : ''
    const updateOut = parseTaskResultJson(raw) as TaskUpdateResult | null
    const sc = updateOut?.statusChange
    const statusPill = sc?.from && sc?.to
      ? ` → ${sc.from} → ${sc.to}${TASK_STATUS_ICON[sc.to] ? ` ${TASK_STATUS_ICON[sc.to]}` : ''}`
      : input.status
        ? ` → ${input.status}${TASK_STATUS_ICON[input.status] ? ` ${TASK_STATUS_ICON[input.status]}` : ''}`
        : ''
    const lines: TuiTranscriptCardLine[] = [
      line(`tool TaskUpdate ${id}${statusPill}`.replace(/\s+/g, ' ').trim(), 'tool'),
    ]
    if (Array.isArray(input.addBlockedBy) && input.addBlockedBy.length > 0) {
      lines.push(line(`  +blocked by ${input.addBlockedBy.map((x) => `#${x}`).join(', ')}`, 'dim'))
    }
    if (Array.isArray(input.addBlocks) && input.addBlocks.length > 0) {
      lines.push(line(`  +blocks ${input.addBlocks.map((x) => `#${x}`).join(', ')}`, 'dim'))
    }
    if (expanded && updateOut?.updatedFields && updateOut.updatedFields.length > 0) {
      lines.push(line(`changed: ${updateOut.updatedFields.join(', ')}`, 'dim'))
    }
    if (updateOut?.error) {
      lines.push(line(`✗ ${truncateLine(updateOut.error)}`, 'result_error'))
    } else if (result && isError) {
      lines.push(line('✗ ERROR', 'result_error'))
    }
    return lines
  }

  if (name === 'TaskGet') {
    const rawId = input.taskId ?? input.task_id ?? ''
    const id = rawId ? `#${rawId}` : ''
    const lines: TuiTranscriptCardLine[] = [line(`tool TaskGet ${id}`.trim(), 'tool')]
    if (isError) {
      lines.push(line('✗ ERROR', 'result_error'))
      return lines
    }
    const getOut = parseTaskResultJson(raw) as TaskGetResult | null
    const task = getOut?.task ?? null
    if (task) {
      const icon = TASK_STATUS_ICON[task.status ?? 'pending'] ?? '○'
      const subject = (task.subject ?? '').trim() || '(no subject)'
      lines.push(line(`  ${icon} ${truncateLine(subject)}`, 'muted'))
      if (expanded && task.description && task.description.trim()) {
        lines.push(line(`    ${truncateLine(task.description.trim())}`, 'dim'))
      }
      if (Array.isArray(task.blockedBy) && task.blockedBy.length > 0) {
        lines.push(line(`    ↳ blocked by ${task.blockedBy.map((x) => `#${x}`).join(', ')}`, 'dim'))
      }
      if (Array.isArray(task.blocks) && task.blocks.length > 0) {
        lines.push(line(`    ⤴ blocks ${task.blocks.map((x) => `#${x}`).join(', ')}`, 'dim'))
      }
    } else if (result) {
      lines.push(line('task not found', 'dim'))
    }
    return lines
  }

  if (name === 'TaskList') {
    const tasks = parseTaskListPayload(raw)
    const count = tasks?.length ?? 0
    const lines: TuiTranscriptCardLine[] = [
      line(`tool TaskList: ${count} task${count === 1 ? '' : 's'}`, 'tool'),
    ]
    if (isError) {
      lines.push(line('✗ ERROR', 'result_error'))
      return lines
    }
    if (tasks && tasks.length > 0) {
      const completedSet = new Set(
        tasks.filter((t) => t.status === 'completed' && t.id).map((t) => t.id as string),
      )
      const groups = groupTaskListItems(tasks, completedSet)
      let renderedTasks = 0
      const taskLimit = expanded ? Number.POSITIVE_INFINITY : Math.min(tasks.length, MAX_CARD_LINES - 1)
      for (const { group, tasks: groupTasks } of groups) {
        if (renderedTasks >= taskLimit) break
        lines.push(line(`${TASK_LIST_GROUP_LABEL[group]} · ${groupTasks.length}`, 'dim'))
        for (const t of groupTasks) {
          if (renderedTasks >= taskLimit) break
          renderedTasks += 1
          const status = t.status ?? 'pending'
          const icon = TASK_STATUS_ICON[status] ?? '○'
          const tone: TuiTranscriptLineTone = status === 'completed' ? 'dim' : 'muted'
          const idTag = t.id ? `#${t.id} ` : ''
          const registryTask = t.id ? taskRegistry?.get(t.id) : undefined
          const baseSubject = (t.subject ?? '').trim()
            || registryTask?.subject
            || registryTask?.summary
            || registryTask?.description
            || '(no subject)'
          const activeForm = (status === 'in_progress' || status === 'running') && t.id
            ? activeForms?.get(t.id) ?? registryTask?.activeForm
            : undefined
          const subject = activeForm && activeForm.trim() ? activeForm.trim() : baseSubject
          const owner = t.owner ?? registryTask?.owner
          const ownerTag = owner ? ` @${owner}` : ''
          const eventCount = registryTask && registryTask.events.length > 1 ? `${registryTask.events.length} events` : ''
          lines.push(line(`${icon} ${idTag}${truncateLine(subject)}${ownerTag}`, tone))
          if (eventCount) lines.push(line(`  ${eventCount}`, 'dim'))
          if (expanded && Array.isArray(t.blockedBy)) {
            const openBlockers = t.blockedBy.filter((id) => !completedSet.has(id))
            if (openBlockers.length > 0 && status !== 'completed') {
              lines.push(line(`  ↳ blocked by ${openBlockers.map((id) => `#${id}`).join(', ')}`, 'dim'))
            }
          }
        }
      }
      if (!expanded && tasks.length > renderedTasks) {
        lines.push(line(`… ${tasks.length - renderedTasks} more`, 'dim'))
      }
    }
    return lines
  }

  if (name === 'TaskStop') {
    const rawId = input.taskId ?? input.task_id ?? ''
    const id = rawId ? `#${rawId}` : ''
    const lines: TuiTranscriptCardLine[] = [line(`tool TaskStop ${id}`.trim(), 'tool')]
    if (result) {
      lines.push(line(isError ? '✗ ERROR' : '✓ stopped', isError ? 'result_error' : 'result_ok'))
    }
    return lines
  }

  return []
}

type OpenCodeTaskParsed = {
  taskId: string | null
  state: 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | null
  bodyText: string
  isErrorBody: boolean
}

/** Parser for the `task` / `task_status` result envelope. Matches the format
 *  produced by `output()` / `backgroundOutput()` / `format()` in OpenCode's
 *  `packages/opencode/src/tool/{task,task_status}.ts`. */
function parseOpenCodeTaskResult(raw: string): OpenCodeTaskParsed {
  if (!raw) return { taskId: null, state: null, bodyText: '', isErrorBody: false }
  const idMatch = raw.match(/^task_id:\s*(\S+)/m)
  const stateMatch = raw.match(/^state:\s*(\w+)/m)
  const bodyMatch = raw.match(/<task_(result|error)>([\s\S]*?)<\/task_\1>/)
  const state = stateMatch?.[1] as OpenCodeTaskParsed['state'] | undefined
  return {
    taskId: idMatch?.[1] ?? null,
    state: state ?? null,
    bodyText: (bodyMatch?.[2] ?? '').trim(),
    isErrorBody: bodyMatch?.[1] === 'error',
  }
}

type OpenCodeTaskInput = {
  description?: string
  subagent_type?: string
  task_id?: string
  background?: boolean
  wait?: boolean
}

type AskUserOption = { label: string; description?: string; preview?: string }
type AskUserQuestion = { question: string; header?: string; multiSelect?: boolean; options: AskUserOption[] }
type AskUserAnswers = { answers?: Record<string, string>; annotations?: Record<string, { preview?: string; notes?: string }> }

function parseAskUserAnswers(raw: string | null): AskUserAnswers {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as AskUserAnswers
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* fall through */ }
  return {}
}

function selectedOptionLabels(question: AskUserQuestion, answers: AskUserAnswers['answers']): Set<string> {
  const raw = answers?.[question.question]
  if (typeof raw !== 'string' || !raw) return new Set()
  // multi-select answers are comma-separated per AskUserQuestionOutput schema
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  return new Set(parts)
}

function formatAskUserQuestionTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] {
  const input = thread.toolUse.input as { questions?: AskUserQuestion[] }
  const questions = Array.isArray(input.questions) ? input.questions : []
  const raw = resultTextOf(thread)
  const isError = thread.result?.is_error === true
  const parsed = parseAskUserAnswers(raw)
  const answered = !!thread.result && !isError && !!parsed.answers && Object.keys(parsed.answers).length > 0

  const stateTone: TuiTranscriptLineTone = isError
    ? 'result_error'
    : answered
      ? 'result_ok'
      : thread.result
        ? 'dim'
        : 'thinking'
  const stateGlyph = isError ? '✗' : answered ? '✓' : thread.result ? '○' : '◌'
  const stateLabel = isError ? 'error' : answered ? 'answered' : thread.result ? 'no answer' : 'pending'

  const headerSummary = questions.length === 0
    ? 'no questions'
    : questions.length === 1
      ? truncateLine(questions[0].question)
      : `${questions.length} questions`

  const lines: TuiTranscriptCardLine[] = [
    line(`ask user: ${headerSummary}`, 'tool'),
    line(`${stateGlyph} ${stateLabel}`, stateTone),
  ]

  // Compact mode: show at most one line per question if there are multiple,
  // or all options collapsed for a single question.
  if (!expanded) {
    if (questions.length === 1) {
      const q = questions[0]
      const selected = selectedOptionLabels(q, parsed.answers)
      const maxOptions = Math.max(MAX_CARD_LINES, 4)
      const visible = q.options.slice(0, maxOptions)
      for (const opt of visible) {
        const hit = selected.has(opt.label)
        const marker = hit
          ? (q.multiSelect ? '☑' : '●')
          : (q.multiSelect ? '☐' : '○')
        const tone: TuiTranscriptLineTone = hit ? 'result_ok' : 'muted'
        lines.push(line(`  ${marker} ${truncateLine(opt.label)}`, tone))
      }
      if (q.options.length > visible.length) {
        lines.push(line(`  … +${q.options.length - visible.length} more`, 'dim'))
      }
    } else {
      for (const q of questions.slice(0, 3)) {
        const selected = selectedOptionLabels(q, parsed.answers)
        const answer = selected.size > 0
          ? [...selected].join(', ')
          : (answered ? '—' : 'pending')
        const headerChip = q.header ? `[${q.header}] ` : ''
        const tone: TuiTranscriptLineTone = selected.size > 0 ? 'result_ok' : 'muted'
        lines.push(line(`  ${headerChip}${truncateLine(q.question)} → ${truncateLine(answer)}`, tone))
      }
      if (questions.length > 3) {
        lines.push(line(`  … +${questions.length - 3} more questions`, 'dim'))
      }
    }
    return lines
  }

  // Expanded mode: full questions, options, descriptions, selection markers,
  // and any user-supplied notes/preview content.
  for (const [qi, q] of questions.entries()) {
    if (qi > 0) lines.push(line('', 'dim'))
    const headerChip = q.header ? `[${q.header.toUpperCase()}] ` : ''
    const mode = q.multiSelect ? ' (multi-select)' : ''
    lines.push(line(`${headerChip}${truncateLine(q.question)}${mode}`, 'system'))

    const selected = selectedOptionLabels(q, parsed.answers)
    for (const opt of q.options) {
      const hit = selected.has(opt.label)
      const marker = hit
        ? (q.multiSelect ? '☑' : '●')
        : (q.multiSelect ? '☐' : '○')
      const tone: TuiTranscriptLineTone = hit ? 'result_ok' : 'muted'
      lines.push(line(`  ${marker} ${truncateLine(opt.label)}${opt.preview ? '  ⤓' : ''}`, tone))
      if (opt.description) {
        lines.push(line(`      ${truncateLine(opt.description)}`, 'dim'))
      }
    }

    const note = parsed.annotations?.[q.question]?.notes?.trim()
    if (note) {
      for (const ln of note.split('\n')) {
        lines.push(line(`  ✎ ${truncateLine(ln)}`, 'agent'))
      }
    }
  }

  return lines
}

function formatOpenCodeTaskTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] {
  const name = thread.toolUse.name
  const input = thread.toolUse.input as OpenCodeTaskInput
  const result = thread.result
  const isResultError = result?.is_error === true
  const raw = resultTextOf(thread) ?? ''
  const parsed = parseOpenCodeTaskResult(raw)
  const inferredState: OpenCodeTaskParsed['state'] = parsed.state
    ?? (parsed.isErrorBody || isResultError
      ? 'error'
      : result
        ? 'completed'
        : 'running')
  const isStatus = name === 'task_status'
  const description = (input.description ?? '').trim() || (isStatus ? 'task status' : 'subagent task')
  const subagentTag = input.subagent_type ? ` [@${input.subagent_type}]` : ''
  const taskId = parsed.taskId ?? input.task_id ?? ''
  const shortId = taskId ? ` #${taskId.slice(-8)}` : ''
  const bgMark = (input.background === true || (isStatus && inferredState === 'running')) ? ' ⟳' : ''
  const stateTone = OPENCODE_TASK_STATE_TONE[inferredState ?? 'pending'] ?? 'dim'
  const stateGlyph = inferredState === 'completed'
    ? '✓'
    : inferredState === 'error'
      ? '✗'
      : inferredState === 'cancelled'
        ? '■'
        : inferredState === 'running'
          ? '◐'
          : '…'

  const lines: TuiTranscriptCardLine[] = [
    line(`tool ${name}${bgMark}: ${truncateLine(description)}${subagentTag}${shortId}`, 'tool'),
    line(`${stateGlyph} ${inferredState ?? 'pending'}`, stateTone),
  ]
  if (expanded && parsed.bodyText) {
    for (const ln of parsed.bodyText.split('\n')) {
      lines.push(line(truncateLine(ln), parsed.isErrorBody ? 'result_error' : 'muted'))
    }
  }
  return lines
}

function previewTool(thread: ToolThread, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  if (thread.toolUse.name === 'FileChange') {
    return previewFileChange(thread)
  }

  if (TASK_TOOL_NAMES.has(thread.toolUse.name)) {
    return formatTaskTool(thread, false, activeForms, taskRegistry)
  }

  if (OPENCODE_TASK_TOOL_NAMES.has(thread.toolUse.name)) {
    return formatOpenCodeTaskTool(thread, false)
  }

  if (thread.toolUse.name === 'AskUserQuestion') {
    return formatAskUserQuestionTool(thread, false)
  }

  if (thread.toolUse.name === 'ToolSearch') {
    return formatToolSearchTool(thread, false)
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

  if (toolName === 'Read') {
    const filePath = typeof input.file_path === 'string' ? pathBasename(input.file_path) : ''
    const pages = typeof input.pages === 'string' && input.pages.trim() ? ` pages ${input.pages.trim()}` : ''
    const isError = thread.result?.is_error === true
    const resultText = thread.result
      ? isError ? 'ERROR' : readSummaryStatusText(thread)
      : 'pending'
    return [
      line(`tool Read${filePath ? `: ${filePath}` : ''}${pages}`, 'tool'),
      line(`${isError ? '✗' : thread.result ? '✓' : '…'} ${resultText}`, isError ? 'result_error' : thread.result ? 'result_ok' : 'dim'),
    ]
  }

  const mcpId = parseMcpToolName(toolName)
  if (mcpId) {
    const isError = thread.result?.is_error === true
    const summary = summarizeMcpInput(input)
    const rawResult = extractResultText(thread.result?.content)
    const resultPreview = thread.result
      ? rawResult
        ? truncateLine(rawResult.split('\n').find((l) => l.trim()) ?? rawResult.trim())
        : 'ok'
      : 'pending'
    const label = mcpHeaderLabel(mcpId)
    const remaining = Math.max(20, MAX_PREVIEW_CHARS - label.length - 2)
    const header = summary ? `${label}: ${truncateLine(summary, remaining)}` : label
    return [
      line(header, 'tool'),
      line(
        `${isError ? '✗' : thread.result ? '✓' : '…'} ${resultPreview}`,
        isError ? 'result_error' : thread.result ? 'result_ok' : 'dim',
      ),
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
    ? truncateLine(extractResultText(thread.result.content)) || 'structured result'
    : 'pending'

  return [
    line(`tool ${thread.toolUse.name}${target ? `: ${target}` : ''}`, 'tool'),
    line(`result ${thread.result?.is_error ? 'error' : 'ok'}: ${resultText || 'empty'}`, thread.result?.is_error ? 'result_error' : 'result_ok'),
  ]
}

function formatBlock(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
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
      return previewTool(block, activeForms, taskRegistry)
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
      const subagentType = typeof block.payload.subagent_type === 'string' ? block.payload.subagent_type : ''
      const subagentPrefix = subagentType ? `[${subagentType}] ` : ''
      const errorCode = typeof block.payload.error === 'string' ? block.payload.error : ''
      if (errorCode) {
        const apiStatus = typeof block.payload.api_error_status === 'number' ? block.payload.api_error_status : null
        const label = errorCode === 'model_not_found'
          ? 'model not available'
          : errorCode.replace(/_/g, ' ')
        const suffix = apiStatus != null ? ` (HTTP ${apiStatus})` : ''
        return [line(`● ${label}${suffix}`, 'result_error')]
      }
      if (block.subtype === 'task_started' || block.subtype === 'task_progress' || block.subtype === 'task_updated' || block.subtype === 'task_notification') {
        const text = typeof block.payload.summary === 'string' ? block.payload.summary
          : typeof block.payload.description === 'string' ? block.payload.description
          : 'task running'
        return [line(`● ${subagentPrefix}${truncateLine(withClaudeRuntimeSuffix(text, block.payload))}`, 'thinking')]
      }
      if (block.subtype === 'hook_started') {
        const name = typeof block.payload.hook_name === 'string' ? block.payload.hook_name : 'hook'
        const event = typeof block.payload.hook_event === 'string' ? block.payload.hook_event : ''
        return [line(withClaudeRuntimeSuffix(`hook ${name}${event ? ` ▸ ${event}` : ''}`, block.payload), 'system')]
      }
      if (block.subtype === 'hook_progress') {
        const name = typeof block.payload.hook_name === 'string' ? block.payload.hook_name : 'hook'
        const output = typeof block.payload.output === 'string' && block.payload.output ? block.payload.output
          : typeof block.payload.stdout === 'string' ? block.payload.stdout : ''
        return [line(withClaudeRuntimeSuffix(`hook ${name}${output ? ` · ${truncateLine(output)}` : ''}`, block.payload), 'system')]
      }
      if (block.subtype === 'hook_response') {
        const name = typeof block.payload.hook_name === 'string' ? block.payload.hook_name : 'hook'
        const outcome = typeof block.payload.outcome === 'string' ? block.payload.outcome : ''
        return [line(withClaudeRuntimeSuffix(`hook ${name}${outcome ? ` ${outcome}` : ''}`, block.payload), 'system')]
      }
      if (block.subtype === 'memory_recall') {
        const memories = Array.isArray(block.payload.memories) ? block.payload.memories as Array<Record<string, unknown>> : []
        const mode = typeof block.payload.mode === 'string' ? block.payload.mode : ''
        const head = line(withClaudeRuntimeSuffix(`memory ${mode || 'recall'}: ${memories.length} file${memories.length === 1 ? '' : 's'}`, block.payload), 'system')
        const previews = memories.slice(0, 2).map((m) => {
          const path = typeof m.path === 'string' ? m.path : ''
          const scope = typeof m.scope === 'string' ? m.scope : ''
          return line(`  ${scope ? `[${scope}] ` : ''}${truncateLine(path)}`, 'muted')
        })
        return [head, ...previews]
      }
      if (block.subtype === 'rate_limit_event') {
        const info = typeof block.payload.rate_limit_info === 'object' && block.payload.rate_limit_info !== null
          ? block.payload.rate_limit_info as Record<string, unknown>
          : null
        const status = typeof info?.status === 'string' ? info.status : 'updated'
        const utilization = typeof info?.utilization === 'number' ? ` · ${Math.round(info.utilization * 100)}%` : ''
        return [line(`rate limit ${status}${utilization}`, status === 'rejected' ? 'result_error' : 'system')]
      }
      if (block.subtype === 'prompt_suggestion' && typeof block.payload.suggestion === 'string') {
        return [line(`suggestion: ${truncateLine(block.payload.suggestion)}`, 'result_ok')]
      }
      if (block.subtype === 'auth_status') {
        const text = typeof block.payload.error === 'string'
          ? block.payload.error
          : typeof block.payload.content === 'string' && block.payload.content.trim()
          ? block.payload.content
          : block.payload.isAuthenticating === true ? 'authenticating' : 'auth status'
        return [line(`auth: ${truncateLine(text)}`, typeof block.payload.error === 'string' ? 'result_error' : 'system')]
      }
      if (block.subtype === 'permission_denied') {
        const tool = typeof block.payload.tool_name === 'string' ? block.payload.tool_name : 'tool'
        return [line(`permission denied: ${tool}`, 'result_error')]
      }
      if (block.subtype === 'notification' && typeof block.payload.text === 'string') {
        return [line(`notice: ${truncateLine(block.payload.text)}`, 'system')]
      }
      return [line(withClaudeRuntimeSuffix(`system ${block.subtype}`, block.payload), 'system')]
    }
    case 'image':
      return [line('image attachment', 'muted')]
    default:
      return []
  }
}

export function formatTranscriptLines(messages: ThreadedMessage[]): string[] {
  const activeForms = buildTaskActiveForms(messages)
  const lines = messages.flatMap((message) => {
    const role = message.role === 'assistant'
      ? getAssistantLabel(message.provider)
      : message.role.toUpperCase()
    const header = `${role}${message.timestamp ? ` ${formatTimestamp(message.timestamp)}` : ''}`
    const body = message.blocks.flatMap((b) => formatBlock(b, activeForms))
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
  searchHaystackLower: string
  codeBlocks?: TuiTranscriptCodeBlock[]
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

export function formatTranscriptCard(message: ThreadedMessage, density: TuiDensity = 'balanced', activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCard {
  const baseLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : message.role.toUpperCase()
  const isSubagent = message.origin?.kind?.startsWith('subagent:') === true
  const subagentLabel = isSubagent ? `${baseLabel} ↪ sub` : baseLabel
  const taskSuffix = isSubagent && message.taskDescription
    ? ` · task: ${truncateLine(message.taskDescription, 48)}`
    : ''
  const requestSuffix = message.requestId
    ? ` · req:${message.requestId.slice(0, 10)}`
    : ''
  const label = `${subagentLabel}${taskSuffix}${requestSuffix}`
  const previewLines = message.blocks.flatMap((b) => formatBlock(b, activeForms, taskRegistry))
  const { processedLines: expandedLines, codeBlocks, hasMermaidDiagrams } = extractCodeBlocksFromBlocks(message.blocks, activeForms, taskRegistry)
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

  const searchText = expandedLines.map((entry) => entry.text).join('\n')
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
    searchText,
    searchHaystackLower: `${label}\n${searchText}`.toLowerCase(),
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
    editDiff: synthesizeEditDiff(message),
    markdownContent: (category === 'conversation' || category === 'insight')
      ? extractMarkdownContent(message.blocks)
      : undefined,
    hasMermaidDiagrams,
  }
}

export function formatTranscriptCards(messages: ThreadedMessage[], density: TuiDensity = 'balanced'): TuiTranscriptCard[] {
  const activeForms = buildTaskActiveForms(messages)
  const taskRegistry = buildTaskRegistry(messages)
  return messages.map((message) => formatTranscriptCard(message, density, activeForms, taskRegistry))
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

const CODE_FENCE_RE = /^```([^\s`]*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm
const MERMAID_LANGS = new Set(['mermaid', 'mmd'])

function displayLanguageFromPath(filePath?: string): string {
  if (!filePath) return 'text'
  const name = pathBasename(filePath)
  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'text'
  return name.slice(dot + 1).toLowerCase() || 'text'
}

function parseReadResultLines(raw: string): Array<{ num: string; code: string }> {
  const lines = raw.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r/g, '').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.map((entry) => {
    const tab = entry.indexOf('\t')
    if (tab === -1) return { num: '', code: sanitizeLine(entry).trimEnd() }
    return {
      num: entry.slice(0, tab).trim(),
      code: sanitizeLine(entry.slice(tab + 1)).trimEnd(),
    }
  })
}

function readCodeBlockFromTool(thread: ToolThread, key: string): TuiTranscriptCodeBlock | null {
  if (!thread.result || thread.result.is_error) return null
  const summary = readSummaryOf(thread)
  if (summary && summary.kind !== 'text') return null
  const raw = resultRawTextOf(thread)
  if (!raw) return null
  const input = thread.toolUse.input as { file_path?: string }
  const filePath = summary?.filePath ?? (typeof input.file_path === 'string' ? input.file_path : undefined)
  const parsed = parseReadResultLines(raw)
  const content = parsed.map((entry) => entry.code).join('\n')
  if (!content.trim()) return null
  const lineNumbers = parsed.map((entry) => entry.num)
  const hasLineNumbers = lineNumbers.length > 0 && lineNumbers.every((num) => /^\d+$/.test(num))
  const structuredLineNumbers = summary?.startLine != null
    ? parsed.map((_, index) => String(summary.startLine! + index))
    : undefined
  return {
    key,
    lang: displayLanguageFromPath(filePath),
    filetype: detectTuiCodeFiletypeFromPath(filePath),
    content,
    filePath,
    lineNumbers: structuredLineNumbers ?? (hasLineNumbers ? lineNumbers : undefined),
  }
}

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

function extractCodeBlocksFromBlocks(blocks: ThreadedBlock[], activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): {
  processedLines: TuiTranscriptCardLine[]
  codeBlocks: TuiTranscriptCodeBlock[]
  hasMermaidDiagrams: boolean
} {
  const all: TuiTranscriptCodeBlock[] = []
  let n = 0
  const lines: TuiTranscriptCardLine[] = []
  let hasMermaidDiagrams = false

  for (const block of blocks) {
    if (block.type === 'tool_thread' && block.toolUse.name === 'Read') {
      const readBlock = readCodeBlockFromTool(block, `read${n++}`)
      if (readBlock) all.push(readBlock)
      lines.push(...formatBlockExpanded(block, activeForms, taskRegistry).filter((l) => l.text.trim()))
      continue
    }

    if (block.type === 'tool_thread' && parseMcpToolName(block.toolUse.name)) {
      const rawLines = formatBlockExpanded(block, activeForms, taskRegistry).filter((l) => l.text.trim())
      const lifted: TuiTranscriptCardLine[] = []
      let i = 0
      while (i < rawLines.length) {
        const cur = rawLines[i]
        const openMatch = cur.text.match(/^```(\S*)/)
        if (openMatch) {
          const lang = (openMatch[1] || 'text').toLowerCase()
          let j = i + 1
          const contentLines: string[] = []
          while (j < rawLines.length && rawLines[j].text.trim() !== '```') {
            contentLines.push(rawLines[j].text)
            j++
          }
          if (j < rawLines.length) {
            const content = contentLines.join('\n')
            all.push({ key: `mcp${n++}`, lang, filetype: normalizeTuiCodeFiletype(lang), content })
            lifted.push(line(`[code: ${lang}]`, 'dim'))
            i = j + 1
            continue
          }
        }
        lifted.push(cur)
        i++
      }
      lines.push(...lifted)
      continue
    }

    if (block.type !== 'text' || !block.text.trim()) {
      lines.push(...formatBlockExpanded(block, activeForms, taskRegistry).filter((l) => l.text.trim()))
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
        all.push({ key: `cb${n++}`, lang, filetype: normalizeTuiCodeFiletype(lang), content })
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

function formatBlockExpanded(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
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

      if (TASK_TOOL_NAMES.has(toolName)) {
        return formatTaskTool(block, true, activeForms, taskRegistry)
      }

      if (OPENCODE_TASK_TOOL_NAMES.has(toolName)) {
        return formatOpenCodeTaskTool(block, true)
      }

      if (toolName === 'AskUserQuestion') {
        return formatAskUserQuestionTool(block, true)
      }

      if (toolName === 'ToolSearch') {
        return formatToolSearchTool(block, true)
      }

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

      if (toolName === 'Read') {
        const filePath = typeof input.file_path === 'string' ? input.file_path : ''
        const pages = typeof input.pages === 'string' && input.pages.trim() ? ` pages ${input.pages.trim()}` : ''
        const isError = block.result?.is_error === true
        const summary = readSummaryOf(block)
        const lines: TuiTranscriptCardLine[] = [
          line(`tool Read${filePath ? `: ${filePath}` : ''}${pages}`, 'tool'),
        ]
        if (!block.result) return lines
        lines.push(line(isError ? '✗ ERROR' : `✓ ${summary ? readSummaryStatusText(block) : 'OK'}`, isError ? 'result_error' : 'result_ok'))
        if (summary) {
          for (const entry of formatClaudeReadMetadata(summary)) {
            lines.push(line(`  ${entry}`, entry === 'token cap' ? 'result_error' : 'dim'))
          }
        }
        if (isError) {
          const content = resultRawTextOf(block)
          if (content) {
            lines.push(
              ...sanitizeLine(content)
                .trim()
                .split('\n')
                .map((l) => l.trimEnd())
                .filter((l) => l.length > 0)
                .map((l) => line(truncateLine(l), 'muted')),
            )
          }
        }
        return lines
      }

      const mcpId = parseMcpToolName(toolName)
      if (mcpId) {
        const isError = block.result?.is_error === true
        const lines: TuiTranscriptCardLine[] = [line(mcpHeaderLabel(mcpId), 'tool')]
        const inputKeys = Object.keys(input)
        for (const key of inputKeys) {
          const value = input[key]
          if (typeof value === 'string') {
            const trimmed = value.trim()
            if (!trimmed) continue
            const valueLines = sanitizeLine(trimmed).split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0)
            if (valueLines.length <= 1 && (valueLines[0]?.length ?? 0) + key.length + 2 <= MAX_PREVIEW_CHARS) {
              lines.push(line(`${key}: ${valueLines[0] ?? ''}`, 'dim'))
            } else {
              lines.push(line(`${key}:`, 'dim'))
              const shown = valueLines.slice(0, MAX_BLOCK_LINES)
              for (const l of shown) lines.push(line(`  ${truncateLine(l)}`, 'muted'))
              if (valueLines.length > shown.length) {
                lines.push(line(`  … ${valueLines.length - shown.length} more lines`, 'dim'))
              }
            }
          } else if (value == null || typeof value === 'number' || typeof value === 'boolean') {
            lines.push(line(`${key}: ${value === null ? 'null' : String(value)}`, 'dim'))
          } else {
            lines.push(line(`${key}: ${previewJson(value)}`, 'dim'))
          }
        }
        if (!block.result) {
          lines.push(line('… pending', 'dim'))
          return lines
        }
        const resultText = extractResultText(block.result.content)
        lines.push(line(isError ? '✗ ERROR' : '✓ OK', isError ? 'result_error' : 'result_ok'))
        // Result text is emitted unfiltered (no line cap, fences left in) so
        // extractCodeBlocksFromBlocks can lift fenced code into TUI code blocks.
        if (resultText) {
          const resultLines = sanitizeLine(resultText).split('\n').map((l) => l.trimEnd())
          for (const l of resultLines) {
            if (l.length === 0) continue
            lines.push(line(l, 'muted'))
          }
        }
        return lines
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
        : Array.isArray(block.result?.content)
        ? sanitizeLine(extractResultText(block.result.content)).trim() || null
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
      const errorCode = typeof block.payload.error === 'string' ? block.payload.error : ''
      if (errorCode) {
        const apiStatus = typeof block.payload.api_error_status === 'number' ? block.payload.api_error_status : null
        const label = errorCode === 'model_not_found'
          ? 'Model not available — pick a different model'
          : errorCode.replace(/_/g, ' ')
        const lines: TuiTranscriptCardLine[] = [line(`● ${label}`, 'result_error')]
        if (apiStatus != null) lines.push(line(`  HTTP ${apiStatus}`, 'dim'))
        const errs = Array.isArray(block.payload.errors) ? block.payload.errors as unknown[] : null
        if (errs) {
          for (const e of errs.slice(0, 3)) {
            if (typeof e === 'string' && e.trim()) lines.push(line(`  ${truncateLine(e.trim())}`, 'dim'))
          }
        }
        return lines
      }
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
        return [...lines, ...claudeRuntimeDetailCardLines(block.payload)]
      }
      if (block.subtype === 'task_started' || block.subtype === 'task_notification') {
        const text = typeof block.payload.summary === 'string' ? block.payload.summary
          : typeof block.payload.description === 'string' ? block.payload.description
          : typeof block.payload.content === 'string' ? block.payload.content
          : 'task'
        const status = typeof block.payload.status === 'string' ? ` · ${block.payload.status}` : ''
        return [
          line(`● ${text}${status}`, 'thinking'),
          ...claudeRuntimeDetailCardLines(block.payload),
        ]
      }
      if (block.subtype === 'rate_limit_event') {
        const info = typeof block.payload.rate_limit_info === 'object' && block.payload.rate_limit_info !== null
          ? block.payload.rate_limit_info as Record<string, unknown>
          : null
        const lines: TuiTranscriptCardLine[] = [
          line(`rate limit ${typeof info?.status === 'string' ? info.status : 'updated'}`, info?.status === 'rejected' ? 'result_error' : 'system'),
        ]
        if (typeof info?.rateLimitType === 'string') lines.push(line(`  limit: ${info.rateLimitType}`, 'dim'))
        if (typeof info?.utilization === 'number') lines.push(line(`  utilization: ${Math.round(info.utilization * 100)}%`, 'dim'))
        if (typeof info?.overageStatus === 'string') lines.push(line(`  overage: ${info.overageStatus}`, 'dim'))
        if (typeof info?.overageDisabledReason === 'string') lines.push(line(`  overage disabled: ${info.overageDisabledReason}`, 'dim'))
        return lines
      }
      if (block.subtype === 'prompt_suggestion' && typeof block.payload.suggestion === 'string') {
        return [line('prompt suggestion', 'result_ok'), line(`  ${truncateLine(block.payload.suggestion)}`, 'dim')]
      }
      if (block.subtype === 'auth_status') {
        const output = Array.isArray(block.payload.output)
          ? block.payload.output.filter((entry): entry is string => typeof entry === 'string')
          : []
        const content = typeof block.payload.content === 'string' ? block.payload.content : ''
        const error = typeof block.payload.error === 'string' ? block.payload.error : ''
        return [
          line(`auth ${block.payload.isAuthenticating === true ? 'authenticating' : 'status'}`, error ? 'result_error' : 'system'),
          ...[content, ...output, error].filter(Boolean).map((entry) => line(`  ${truncateLine(entry)}`, error ? 'result_error' : 'dim')),
        ]
      }
      if (block.subtype === 'permission_denied') {
        const tool = typeof block.payload.tool_name === 'string' ? block.payload.tool_name : 'tool'
        const reason = typeof block.payload.decision_reason === 'string' ? block.payload.decision_reason : ''
        const message = typeof block.payload.message === 'string' ? block.payload.message : ''
        return [
          line(`permission denied: ${tool}`, 'result_error'),
          ...[reason, message].filter(Boolean).map((entry) => line(`  ${truncateLine(entry)}`, 'dim')),
        ]
      }
      if (block.subtype === 'notification' && typeof block.payload.text === 'string') {
        return [line(`notice: ${block.payload.text}`, 'system')]
      }
      if (block.subtype === 'memory_recall') {
        const memories = Array.isArray(block.payload.memories) ? block.payload.memories as Array<Record<string, unknown>> : []
        const mode = typeof block.payload.mode === 'string' ? block.payload.mode : 'recall'
        return [
          line(`memory ${mode}: ${memories.length} file${memories.length === 1 ? '' : 's'}`, 'system'),
          ...memories.map((m) => {
            const path = typeof m.path === 'string' ? m.path : ''
            const scope = typeof m.scope === 'string' ? m.scope : ''
            return line(`  ${scope ? `[${scope}] ` : ''}${truncateLine(path)}`, 'muted')
          }),
        ]
      }
      if (block.subtype === 'api_retry') {
        const attempt = typeof block.payload.attempt === 'number' ? block.payload.attempt : undefined
        const max = typeof block.payload.max_retries === 'number' ? block.payload.max_retries : undefined
        const delayMs = typeof block.payload.retry_delay_ms === 'number' ? block.payload.retry_delay_ms : undefined
        const status = typeof block.payload.error_status === 'number' ? block.payload.error_status : null
        const head = attempt != null && max != null ? `api retry ${attempt}/${max}` : 'api retry'
        const lines: TuiTranscriptCardLine[] = [line(head, 'result_error')]
        if (delayMs != null) lines.push(line(`  delay: ${(delayMs / 1000).toFixed(1)}s`, 'dim'))
        if (status != null) lines.push(line(`  HTTP ${status}`, 'dim'))
        const err = block.payload.error && typeof block.payload.error === 'object'
          ? block.payload.error as Record<string, unknown>
          : null
        if (typeof err?.message === 'string') lines.push(line(`  ${truncateLine(err.message)}`, 'dim'))
        return lines
      }
      if (block.subtype === 'session_state_changed') {
        const state = typeof block.payload.state === 'string' ? block.payload.state : 'changed'
        return [line(`session state: ${state}`, 'system')]
      }
      if (block.subtype === 'local_command_output') {
        const text = typeof block.payload.content === 'string' ? block.payload.content : ''
        if (!text.trim()) return [line('local command output', 'system')]
        const lines: TuiTranscriptCardLine[] = [line('local command output', 'system')]
        for (const l of sanitizeLine(text).split('\n').map((s) => s.trimEnd()).filter((s) => s.length > 0).slice(0, MAX_BLOCK_LINES)) {
          lines.push(line(`  ${truncateLine(l)}`, 'dim'))
        }
        return lines
      }
      if (block.subtype === 'result') {
        const resultSubtype = typeof block.payload.result_subtype === 'string' ? block.payload.result_subtype : ''
        const isError = resultSubtype && resultSubtype !== 'success'
        const head = isError ? `run ended: ${resultSubtype.replace(/_/g, ' ')}` : 'run completed'
        const lines: TuiTranscriptCardLine[] = [line(head, isError ? 'result_error' : 'result_ok')]
        if (typeof block.payload.num_turns === 'number') lines.push(line(`  ${block.payload.num_turns} turn${block.payload.num_turns === 1 ? '' : 's'}`, 'dim'))
        if (typeof block.payload.duration_ms === 'number') lines.push(line(`  ${(block.payload.duration_ms / 1000).toFixed(1)}s`, 'dim'))
        if (typeof block.payload.total_cost_usd === 'number') lines.push(line(`  $${block.payload.total_cost_usd.toFixed(4)}`, 'dim'))
        const errors = Array.isArray(block.payload.errors) ? block.payload.errors as unknown[] : []
        for (const e of errors.slice(0, 3)) {
          if (typeof e === 'string' && e.trim()) lines.push(line(`  ${truncateLine(e.trim())}`, 'result_error'))
        }
        return lines
      }
      return [
        line(withClaudeRuntimeSuffix(`system ${block.subtype}`, block.payload), 'system'),
        ...claudeRuntimeDetailCardLines(block.payload),
      ]
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
  const activeForms = buildTaskActiveForms(messages)
  const taskRegistry = buildTaskRegistry(messages)
  return message.blocks
    .flatMap((b) => formatBlockExpanded(b, activeForms, taskRegistry))
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

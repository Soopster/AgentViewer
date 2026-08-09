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
import { sanitizeProtocolEvent, type AgentProtocolEvent } from '../lib/agentProtocol'

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

function parseAgentProtocolCodeBlock(raw: string): AgentProtocolEvent | null {
  try {
    return sanitizeProtocolEvent(JSON.parse(raw))
  } catch {
    return null
  }
}

function agentProtocolTone(event: AgentProtocolEvent): TuiTranscriptLineTone {
  if (event.type === 'finding' || event.type === 'learning' || event.type === 'task.completed' || event.type === 'plan.approved') return 'result_ok'
  if (event.type === 'agent.blocked' || event.type === 'task.failed' || event.type === 'lock.denied' || event.type === 'plan.rejected') return 'result_error'
  if (event.type === 'message' || event.type === 'handoff' || event.type === 'review.requested') return 'agent'
  if (event.type.startsWith('lock.')) return 'system'
  return 'tool'
}

function agentProtocolSubject(event: AgentProtocolEvent): string {
  if (event.type === 'message' && event.to) return `to ${event.to}`
  if (event.type === 'task.created' && event.title) return event.title
  if (event.summary) return event.summary
  if (event.detail) return event.detail
  if (event.paths?.length) return event.paths.join(', ')
  return ''
}

function formatAgentProtocolEvent(event: AgentProtocolEvent, expanded: boolean): TuiTranscriptCardLine[] {
  const tone = agentProtocolTone(event)
  const target = event.to ? ` · to ${event.to}` : ''
  const task = event.taskId ? ` · ${event.taskId}` : ''
  const subject = agentProtocolSubject(event)
  const eventLabel = event.type.replace(/^agent\./, '').replace(/[._]/g, ' ')
  const lines: TuiTranscriptCardLine[] = [
    line(`coordinator ${eventLabel}${task}${target}`, tone),
    ...(subject ? [line(`  ${truncateLine(subject, 112)}`, tone === 'result_error' ? 'result_error' : 'muted')] : []),
    line(`  ${event.agentId} · run ${event.runId.slice(0, 8)}`, 'dim'),
  ]
  if (expanded) {
    if (event.detail && event.detail !== event.summary) {
      lines.push(...compactLines(event.detail.split('\n')).map((entry) => line(`  ${entry}`, 'muted')))
    }
    if (event.paths?.length) lines.push(line(`  paths: ${event.paths.join(', ')}`, 'dim'))
    if (event.dependsOn?.length) lines.push(line(`  depends on: ${event.dependsOn.join(', ')}`, 'dim'))
    if (event.lockId) lines.push(line(`  lock: ${event.lockId}`, 'dim'))
    if (event.timestamp) lines.push(line(`  at ${formatTimestamp(event.timestamp)}`, 'dim'))
  }
  return lines
}

function textLinesForProtocolAwareBlock(text: string, expanded: boolean): TuiTranscriptCardLine[] | null {
  // Some clients preserve the A2A fence while others rewrite it to `json`.
  // The StreamResponse keys let us recognize both without parsing every
  // ordinary fenced code block in the transcript. Legacy AVP remains readable.
  if (!text.includes('```a2a') && !text.includes('agent-protocol') && !text.includes('"AVP/') && !text.includes('"statusUpdate"') && !text.includes('"artifactUpdate"')) return null
  const lines: TuiTranscriptCardLine[] = []
  let replacedAny = false
  let lastIndex = 0
  for (const match of text.matchAll(CODE_FENCE_RE)) {
    const lang = ((match[1] ?? '').trim() || 'text').toLowerCase()
    const start = match.index ?? 0
    const before = text.slice(lastIndex, start)
    if (before.trim()) {
      const beforeLines = expanded ? sanitizeLine(before).trim().split('\n') : compactLines(before.trim().split('\n'))
      lines.push(...beforeLines.map((entry) => line(entry.trimEnd())).filter((entry) => entry.text.trim()))
    }
    const content = (match[2] ?? '').trim()
    const event = (lang === 'a2a' || lang === 'agent-protocol' || lang === 'json')
      ? parseAgentProtocolCodeBlock(content)
      : null
    if (event) {
      replacedAny = true
      lines.push(...formatAgentProtocolEvent(event, expanded))
    } else {
      const fallback = match[0]
      const fallbackLines = expanded ? sanitizeLine(fallback).trim().split('\n') : compactLines(fallback.trim().split('\n'))
      lines.push(...fallbackLines.map((entry) => line(entry.trimEnd())).filter((entry) => entry.text.trim()))
    }
    lastIndex = start + match[0].length
  }
  const after = text.slice(lastIndex)
  if (after.trim()) {
    const afterLines = expanded ? sanitizeLine(after).trim().split('\n') : compactLines(after.trim().split('\n'))
    lines.push(...afterLines.map((entry) => line(entry.trimEnd())).filter((entry) => entry.text.trim()))
  }
  return replacedAny ? lines : null
}

function isAgentProtocolText(text: string): boolean {
  return ((text.includes('```a2a') || text.includes('A2A Protocol')) && text.includes('agent-viewer.dev/extensions/coordination/v1'))
    || (text.includes('agent-protocol') && text.includes('"AVP/'))
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

function mcpToolIdForThread(thread: ToolThread): McpToolId | null {
  const encoded = parseMcpToolName(thread.toolUse.name)
  if (encoded) return encoded
  const input = toolInputRecord(thread)
  const server = typeof input.server === 'string' ? input.server.trim() : ''
  return server ? { server, tool: thread.toolUse.name } : null
}

function coordinatorToolName(thread: ToolThread): string | null {
  const id = mcpToolIdForThread(thread)
  if (!id || !normalizedToolKey(id.tool).startsWith('coord_')) return null
  return normalizedToolKey(id.tool)
}

function coordinatorActionLabel(toolName: string): string {
  const labels: Record<string, string> = {
    coord_create_run: 'create run',
    coord_join_run: 'join run',
    coord_list_runs: 'list runs',
    coord_resume: 'resume',
    coord_status: 'status',
    coord_wait: 'wait',
    coord_create_task: 'create task',
    coord_claim_task: 'claim task',
    coord_release_task: 'release task',
    coord_read_inbox: 'inbox',
    coord_send_message: 'send message',
    coord_handoff_task: 'handoff task',
    coord_request_locks: 'request locks',
    coord_progress: 'progress',
    coord_publish_finding: 'publish finding',
    coord_submit_plan: 'submit plan',
    coord_review_plan: 'review plan',
    coord_complete_task: 'complete task',
    coord_fail_task: 'fail task',
    coord_finalize_run: 'finalize run',
  }
  return labels[toolName] ?? toolName.slice('coord_'.length).replace(/_/g, ' ')
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function coordinatorResultText(thread: ToolThread): string {
  const raw = extractResultText(thread.result?.content).trim()
  const envelope = parseJsonValue(raw)
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return raw
  const content = (envelope as Record<string, unknown>).content
  if (!Array.isArray(content)) return raw
  const text = content.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = (entry as Record<string, unknown>).text
    return typeof value === 'string' ? [value] : []
  }).join('\n').trim()
  return text || raw
}

function coordinatorInputSummary(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (key === 'server' || key === 'request_id' || value == null) continue
    // Codex includes the MCP transport status beside the actual arguments.
    if (key === 'status' && (value === 'completed' || value === 'inProgress' || value === 'failed')) continue
    if (key === 'value' && typeof value === 'object' && Object.keys(value as object).length === 0) continue
    if (typeof value === 'string') parts.push(`${key.replace(/_/g, ' ')} ${compactOneLine(value, 48)}`)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key.replace(/_/g, ' ')} ${String(value)}`)
    else if (Array.isArray(value)) parts.push(`${key.replace(/_/g, ' ')} ${value.length}`)
  }
  return parts.slice(0, 3).join(' · ')
}

function coordinatorPayloadLines(raw: string, expanded: boolean): TuiTranscriptCardLine[] {
  const parsed = parseJsonValue(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const text = raw.split('\n').find((entry) => entry.trim())?.trim() ?? ''
    return text ? [line(truncateLine(text, expanded ? MAX_PREVIEW_CHARS : 120), 'muted')] : []
  }

  const payload = parsed as Record<string, unknown>
  const lines: TuiTranscriptCardLine[] = []
  const participant = payload.participant && typeof payload.participant === 'object'
    ? payload.participant as Record<string, unknown>
    : null
  const task = payload.task && typeof payload.task === 'object'
    ? payload.task as Record<string, unknown>
    : null
  const snapshot = payload.snapshot && typeof payload.snapshot === 'object'
    ? payload.snapshot as Record<string, unknown>
    : payload
  const run = snapshot.run && typeof snapshot.run === 'object'
    ? snapshot.run as Record<string, unknown>
    : null
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : []

  if (participant) {
    const name = typeof participant.name === 'string' ? participant.name : participant.agentId
    const role = typeof participant.role === 'string' ? ` · ${participant.role}` : ''
    if (name) lines.push(line(`participant ${String(name)}${role}`, 'agent'))
  }
  if (task) {
    const id = typeof task.id === 'string' ? task.id : typeof task.taskId === 'string' ? task.taskId : 'task'
    const title = typeof task.title === 'string' ? ` · ${task.title}` : ''
    const status = typeof task.status === 'string' ? ` · ${task.status}` : ''
    lines.push(line(`${id}${title}${status}`, 'agent'))
  }
  if (run || tasks.length > 0 || agents.length > 0) {
    const status = run && typeof run.status === 'string' ? run.status : 'run'
    lines.push(line(`${status} · ${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${agents.length} agent${agents.length === 1 ? '' : 's'}`, 'agent'))
  }
  if (messages.length > 0) {
    lines.push(line(`${messages.length} inbox message${messages.length === 1 ? '' : 's'}`, 'agent'))
    if (expanded) {
      for (const message of messages.slice(0, MAX_BLOCK_LINES)) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue
        const record = message as Record<string, unknown>
        const from = typeof record.fromName === 'string' ? record.fromName : typeof record.from === 'string' ? record.from : 'agent'
        const body = typeof record.body === 'string' ? record.body : typeof record.message === 'string' ? record.message : ''
        if (body) lines.push(line(`  ${from}: ${truncateLine(compactOneLine(body), 120)}`, 'muted'))
      }
    }
  }
  if (payload.accepted === true) lines.push(line('accepted', 'result_ok'))
  if (lines.length === 0) {
    const keys = Object.keys(payload).filter((key) => !key.startsWith('_')).slice(0, 4)
    if (keys.length > 0) lines.push(line(keys.join(' · '), 'dim'))
  }
  return lines
}

function formatCoordinatorTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] | null {
  const toolName = coordinatorToolName(thread)
  if (!toolName) return null
  const input = toolInputRecord(thread)
  const inputSummary = coordinatorInputSummary(input)
  const lines: TuiTranscriptCardLine[] = [
    line(`coordinator ${coordinatorActionLabel(toolName)}${inputSummary ? ` · ${inputSummary}` : ''}`, 'tool'),
  ]
  if (!thread.result) return [...lines, line('… pending', 'dim')]

  const transportFailed = input.status === 'failed'
  const isError = thread.result.is_error === true || transportFailed
  const resultText = coordinatorResultText(thread)
  const payloadLines = coordinatorPayloadLines(resultText, expanded)
  if (!expanded) {
    const detail = payloadLines[0]?.text
    return [
      ...lines,
      line(`${isError ? '✗' : '✓'} ${detail || (isError ? 'failed' : 'complete')}`, isError ? 'result_error' : 'result_ok'),
    ]
  }
  lines.push(line(isError ? '✗ failed' : '✓ complete', isError ? 'result_error' : 'result_ok'))
  if (isError && payloadLines.length > 0) payloadLines[0] = { ...payloadLines[0], tone: 'result_error' }
  lines.push(...payloadLines)
  return lines
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

const BASH_TOOL_ALIASES = new Set(['bash', 'shell', 'local_shell', 'powershell', 'run_in_terminal', 'command', 'command_execution'])
const READ_TOOL_ALIASES = new Set(['read', 'read_file', 'open_file', 'view_file', 'cat', 'ls', 'list_dir', 'fs_read'])
const GREP_TOOL_ALIASES = new Set(['grep', 'grep_search', 'search', 'semantic_search', 'find', 'find_text', 'rg'])
const GLOB_TOOL_ALIASES = new Set(['glob', 'find_files', 'file_search'])
const EDIT_TOOL_ALIASES = new Set(['edit', 'str_replace_editor', 'replace_string_in_file', 'insert_edit_into_file', 'update_file'])
const MULTI_EDIT_TOOL_ALIASES = new Set(['multi_edit', 'multiedit'])
const WRITE_TOOL_ALIASES = new Set(['write', 'write_file', 'create_file'])
const FILE_CHANGE_TOOL_ALIASES = new Set(['filechange', 'file_change'])
const TODO_TOOL_ALIASES = new Set(['todowrite', 'todo_write', 'todo'])
const AGENT_TOOL_ALIASES = new Set(['agent', 'subtask', 'task_create_agent', 'taskcreateagent'])
const TASK_CREATE_TOOL_ALIASES = new Set(['task_create', 'taskcreate'])
const TASK_GET_TOOL_ALIASES = new Set(['task_get', 'taskget'])
const TASK_UPDATE_TOOL_ALIASES = new Set(['task_update', 'taskupdate'])
const TASK_LIST_TOOL_ALIASES = new Set(['task_list', 'tasklist'])
const TASK_STOP_TOOL_ALIASES = new Set(['task_stop', 'taskstop'])

function normalizedToolKey(name: string): string {
  return name.trim().toLowerCase().replace(/[-\s]/g, '_')
}

function canonicalToolName(name: string): string {
  const normalized = name.trim()
  const key = normalizedToolKey(normalized)
  if (BASH_TOOL_ALIASES.has(key)) return 'Bash'
  if (READ_TOOL_ALIASES.has(key)) return 'Read'
  if (GREP_TOOL_ALIASES.has(key)) return 'Grep'
  if (GLOB_TOOL_ALIASES.has(key)) return 'Glob'
  if (EDIT_TOOL_ALIASES.has(key)) return 'Edit'
  if (MULTI_EDIT_TOOL_ALIASES.has(key)) return 'MultiEdit'
  if (WRITE_TOOL_ALIASES.has(key)) return 'Write'
  if (FILE_CHANGE_TOOL_ALIASES.has(key)) return 'FileChange'
  if (key === 'notebook_edit' || key === 'notebookedit') return 'NotebookEdit'
  if (TODO_TOOL_ALIASES.has(key)) return 'TodoWrite'
  if (AGENT_TOOL_ALIASES.has(key)) return 'Agent'
  if (key === 'task') return 'task'
  if (key === 'task_status' || key === 'taskstatus') return 'task_status'
  if (TASK_CREATE_TOOL_ALIASES.has(key)) return 'TaskCreate'
  if (TASK_GET_TOOL_ALIASES.has(key)) return 'TaskGet'
  if (TASK_UPDATE_TOOL_ALIASES.has(key)) return 'TaskUpdate'
  if (TASK_LIST_TOOL_ALIASES.has(key)) return 'TaskList'
  if (TASK_STOP_TOOL_ALIASES.has(key)) return 'TaskStop'
  if (key === 'websearch' || key === 'web_search') return 'WebSearch'
  if (key === 'webfetch' || key === 'web_fetch') return 'WebFetch'
  if (key === 'toolsearch' || key === 'tool_search') return 'ToolSearch'
  if (key === 'agent_switch' || key === 'agentswitch') return 'AgentSwitch'
  return normalized
}

function toolInputRecord(thread: ToolThread): Record<string, unknown> {
  return thread.toolUse.input && typeof thread.toolUse.input === 'object' && !Array.isArray(thread.toolUse.input)
    ? thread.toolUse.input as Record<string, unknown>
    : {}
}

function toolStringParam(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function normalizeToolThreadForTui(thread: ToolThread): ToolThread {
  const originalName = thread.toolUse.name
  const canonicalName = canonicalToolName(originalName)
  const input = toolInputRecord(thread)
  const withInput = (name: string, nextInput: Record<string, unknown>): ToolThread => ({
    ...thread,
    toolUse: {
      ...thread.toolUse,
      name,
      input: nextInput,
    },
  })

  if (canonicalName === 'Write' && typeof input.path === 'string' && typeof input.file_path !== 'string') {
    return withInput('Write', { ...input, file_path: input.path })
  }

  if ((canonicalName === 'Edit' || canonicalName === 'MultiEdit') && typeof input.path === 'string' && Array.isArray(input.edits)) {
    const filePath = input.path
    const edits = input.edits.flatMap((edit): Array<{ file_path?: string; old_string?: string; new_string?: string; replace_all?: boolean }> => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return []
      const record = edit as Record<string, unknown>
      const oldText = typeof record.oldText === 'string' ? record.oldText : typeof record.old_string === 'string' ? record.old_string : undefined
      const newText = typeof record.newText === 'string' ? record.newText : typeof record.new_string === 'string' ? record.new_string : undefined
      const replaceAll = typeof record.replace_all === 'boolean' ? record.replace_all : undefined
      return [{ file_path: filePath, old_string: oldText, new_string: newText, replace_all: replaceAll }]
    })
    return withInput('MultiEdit', { ...input, file_path: filePath, edits })
  }

  if (canonicalName === 'Edit' && typeof input.path === 'string' && typeof input.file_path !== 'string') {
    const oldText = toolStringParam(input, ['oldText', 'old_string'])
    const newText = toolStringParam(input, ['newText', 'new_string'])
    if (oldText != null || newText != null) {
      return withInput('Edit', { ...input, file_path: input.path, old_string: oldText ?? '', new_string: newText ?? '' })
    }
  }

  if (canonicalName === 'Read' && typeof input.path === 'string' && typeof input.file_path !== 'string') {
    return withInput('Read', { ...input, file_path: input.path })
  }

  if (canonicalName !== originalName) {
    return withInput(canonicalName, input)
  }

  return thread
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

const DIFF_TOOL_NAMES = new Set(['FileChange', 'Edit', 'MultiEdit', 'Write'])

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
      const block = normalizeToolThreadForTui(b)
      const name = block.toolUse.name
      if (name === 'TaskCreate') {
        const inp = block.toolUse.input as { activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (!af || !block.result) continue
        const text = resultRawTextOf(block)
        if (!text) continue
        const id = parseCreatedTaskId(text)
        if (id) map.set(id, af)
      } else if (name === 'TaskUpdate') {
        const inp = block.toolUse.input as { taskId?: string; task_id?: string; activeForm?: string }
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
  const normalizedThread = normalizeToolThreadForTui(thread)
  const input = normalizedThread.toolUse.input as { file_path?: unknown }
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

function claudeHookAdditionalContextLines(payload: SystemMessagePayload): TuiTranscriptCardLine[] {
  const direct = typeof payload.additionalContext === 'string' ? payload.additionalContext.trim() : ''
  const hookOutput = payload.hookSpecificOutput && typeof payload.hookSpecificOutput === 'object'
    ? payload.hookSpecificOutput as Record<string, unknown>
    : null
  const nested = typeof hookOutput?.additionalContext === 'string' ? hookOutput.additionalContext.trim() : ''
  const additionalContext = direct || nested
  if (!additionalContext) return []
  const lines = sanitizeLine(additionalContext)
    .split('\n')
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0)
    .slice(0, 4)
  return [
    line('  additional context:', 'system'),
    ...lines.map((entry) => line(`    ${truncateLine(entry)}`, 'dim')),
  ]
}

function resultRawTextOf(thread: ToolThread): string | null {
  const normalizedThread = normalizeToolThreadForTui(thread)
  if (normalizedThread.toolUse.name === 'Read') {
    const summary = readSummaryOf(normalizedThread)
    if (summary?.content) return summary.content
  }
  const content = normalizedThread.result?.content
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

function selectedOptionLabels(
  question: AskUserQuestion,
  answers: AskUserAnswers['answers'],
  rawResult?: string | null,
): Set<string> {
  const raw = answers?.[question.question]
  if (typeof raw === 'string' && raw) {
    // multi-select answers are comma-separated per AskUserQuestionOutput schema
    return new Set(raw.split(',').map((p) => p.trim()).filter(Boolean))
  }
  // Fallback: the tool result is often a plain confirmation string
  // (`...="Blue"`) rather than a JSON answers map — match option labels in it
  // so the answered selection still renders (mirrors the web card).
  if (rawResult) {
    const hits = question.options
      .map((o) => o.label)
      .filter((label) => rawResult.includes(`"${label}"`) || rawResult.includes(`=${label}`))
    if (hits.length > 0) return new Set(hits)
  }
  return new Set()
}

function formatAskUserQuestionTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] {
  const input = thread.toolUse.input as { questions?: Array<Partial<AskUserQuestion>> }
  // Normalize defensively: a streaming/partial tool call can arrive before
  // `options` (or `question`) exists, and downstream code assumes `q.options`
  // is always an array (q.options.slice would otherwise throw).
  const questions: AskUserQuestion[] = (Array.isArray(input.questions) ? input.questions : [])
    .filter((q): q is Partial<AskUserQuestion> => !!q && typeof q === 'object')
    .map((q) => ({
      question: typeof q.question === 'string' ? q.question : '',
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options) ? q.options : [],
    }))
  const raw = resultTextOf(thread)
  const isError = thread.result?.is_error === true
  const parsed = parseAskUserAnswers(raw)
  // A completed, non-error result means the questions were answered — the answer
  // may be a JSON map OR a plain confirmation string, so don't require the map.
  const answered = !!thread.result && !isError

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
      const selected = selectedOptionLabels(q, parsed.answers, raw)
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
        const selected = selectedOptionLabels(q, parsed.answers, raw)
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

    const selected = selectedOptionLabels(q, parsed.answers, raw)
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

function compactOneLine(value: string, maxChars = MAX_PREVIEW_CHARS): string {
  return truncateLine(value.replace(/\s+/g, ' ').trim(), maxChars)
}

function formatDurationMs(value: number): string {
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value / 1000)}s`
}

function parseBashResultMeta(raw: string): { outputLineCount: number; exitCode: number | null; durationMs: number | null } {
  let outputLineCount = 0
  let exitCode: number | null = null
  let durationMs: number | null = null
  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    const exitMatch = trimmed.match(/^exit_code:\s*(-?\d+)$/i)
    if (exitMatch?.[1]) {
      exitCode = Number(exitMatch[1])
      continue
    }
    const parenExitMatch = trimmed.match(/\(exit\s+(-?\d+)\)$/i)
    if (parenExitMatch?.[1]) {
      exitCode = Number(parenExitMatch[1])
      const withoutExit = trimmed.replace(/\s*\(exit\s+-?\d+\)$/i, '').trim()
      if (withoutExit && !withoutExit.startsWith('$ ')) outputLineCount += 1
      continue
    }
    const durationMatch = trimmed.match(/^duration_ms:\s*([0-9.]+)$/i)
    if (durationMatch?.[1]) {
      durationMs = Number(durationMatch[1])
      continue
    }
    if (trimmed.startsWith('$ ')) continue
    outputLineCount += 1
  }
  return { outputLineCount, exitCode, durationMs }
}

function resultLineCount(thread: ToolThread): number {
  const raw = resultTextOf(thread)
  if (!raw) return 0
  return raw.split('\n').filter((entry) => entry.trim().length > 0).length
}

function formatTodoCounts(input: Record<string, unknown>): string | null {
  const todos = Array.isArray(input.todos) ? input.todos : []
  if (todos.length === 0) return null
  const counts = { completed: 0, inProgress: 0, pending: 0, other: 0 }
  for (const todo of todos) {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) {
      counts.other += 1
      continue
    }
    const status = typeof (todo as Record<string, unknown>).status === 'string'
      ? String((todo as Record<string, unknown>).status).toLowerCase()
      : ''
    if (status === 'completed' || status === 'done') counts.completed += 1
    else if (status === 'in_progress' || status === 'running' || status === 'active') counts.inProgress += 1
    else if (status === 'pending' || status === 'todo') counts.pending += 1
    else counts.other += 1
  }
  const parts = [
    counts.completed > 0 ? `${counts.completed} done` : '',
    counts.inProgress > 0 ? `${counts.inProgress} active` : '',
    counts.pending > 0 ? `${counts.pending} pending` : '',
    counts.other > 0 ? `${counts.other} other` : '',
  ].filter(Boolean)
  return parts.join(' · ') || `${todos.length} todo${todos.length === 1 ? '' : 's'}`
}

function previewTool(thread: ToolThread, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  const normalizedThread = normalizeToolThreadForTui(thread)
  const toolName = normalizedThread.toolUse.name

  const coordinatorLines = formatCoordinatorTool(normalizedThread, false)
  if (coordinatorLines) return coordinatorLines

  if (toolName === 'FileChange') {
    return previewFileChange(normalizedThread)
  }

  if (TASK_TOOL_NAMES.has(toolName)) {
    return formatTaskTool(normalizedThread, false, activeForms, taskRegistry)
  }

  if (OPENCODE_TASK_TOOL_NAMES.has(toolName)) {
    return formatOpenCodeTaskTool(normalizedThread, false)
  }

  if (toolName === 'AskUserQuestion') {
    return formatAskUserQuestionTool(normalizedThread, false)
  }

  if (toolName === 'ToolSearch') {
    return formatToolSearchTool(normalizedThread, false)
  }

  const input = toolInputRecord(normalizedThread)

  if (toolName === 'Bash') {
    const command = toolStringParam(input, ['command', 'cmd', 'script']) ?? 'command'
    const isError = normalizedThread.result?.is_error === true
    const raw = resultTextOf(normalizedThread) ?? ''
    const meta = parseBashResultMeta(raw)
    const status = normalizedThread.result
      ? isError
        ? 'ERROR'
        : meta.exitCode != null && meta.exitCode !== 0
          ? `exit ${meta.exitCode}`
          : 'OK'
      : 'running'
    const details = [
      meta.outputLineCount > 0 ? `${meta.outputLineCount} line${meta.outputLineCount === 1 ? '' : 's'}` : '',
      meta.durationMs != null ? formatDurationMs(meta.durationMs) : '',
    ].filter(Boolean)
    return [
      line(`tool Bash: $ ${compactOneLine(command, 120)}`, 'tool'),
      line(`${isError ? '✗' : normalizedThread.result ? '✓' : '…'} ${status}${details.length ? ` · ${details.join(' · ')}` : ''}`, isError ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim'),
    ]
  }

  if (toolName === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos : []
    const counts = formatTodoCounts(input)
    return [
      line(`tool TodoWrite: ${todos.length} todo${todos.length === 1 ? '' : 's'}`, 'tool'),
      line(counts ?? (normalizedThread.result ? '✓ updated' : 'pending'), normalizedThread.result?.is_error ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim'),
    ]
  }

  if (toolName === 'Agent') {
    const description = typeof input.description === 'string' ? input.description : 'agent'
    const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : ''
    const isError = normalizedThread.result?.is_error === true
    const parsed = parseAgentResultJson(normalizedThread.result?.content)
    const resultText = extractAgentResultText(normalizedThread.result?.content)
    const previewText = resultText
      ? truncateLine(resultText.split('\n').find((l) => l.trim()) ?? resultText)
      : normalizedThread.result ? 'done' : 'running…'
    const stats = formatAgentStatsSummary(parsed)
    const lines: TuiTranscriptCardLine[] = [
      line(`agent ${description}${subagentType ? ` [${subagentType}]` : ''}`, 'tool'),
      line(`${isError ? '✗' : normalizedThread.result ? '✓' : '…'} ${previewText}`, isError ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim'),
    ]
    if (stats) lines.push(line(stats, 'dim'))
    return lines
  }

  if (toolName === 'AgentSwitch') {
    const name = toolStringParam(input, ['name']) ?? 'agent'
    const status = toolStringParam(input, ['status']) ?? (normalizedThread.result ? 'completed' : 'pending')
    return [
      line(`agent switch: ${name}`, 'tool'),
      line(
        normalizedThread.result?.is_error
          ? '✗ ERROR'
          : normalizedThread.result
            ? `✓ ${status}`
            : `… ${status}`,
        normalizedThread.result?.is_error ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim',
      ),
    ]
  }

  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
    const filePath = typeof input.file_path === 'string' ? pathBasename(input.file_path) : ''
    const isError = normalizedThread.result?.is_error === true

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
      line(
        isError ? '✗ ERROR' : normalizedThread.result ? `✓ ${summary}` : `… pending · ${summary}`,
        isError ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim',
      ),
    ]
  }

  if (toolName === 'Read') {
    const filePath = typeof input.file_path === 'string' ? pathBasename(input.file_path) : ''
    const pages = typeof input.pages === 'string' && input.pages.trim() ? ` pages ${input.pages.trim()}` : ''
    const isError = normalizedThread.result?.is_error === true
    const resultText = normalizedThread.result
      ? isError ? 'ERROR' : readSummaryStatusText(normalizedThread)
      : 'pending'
    return [
      line(`tool Read${filePath ? `: ${filePath}` : ''}${pages}`, 'tool'),
      line(`${isError ? '✗' : normalizedThread.result ? '✓' : '…'} ${resultText}`, isError ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim'),
    ]
  }

  if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'WebSearch' || toolName === 'WebFetch') {
    const target = toolStringParam(input, ['pattern', 'query', 'url', 'uri', 'path', 'glob']) ?? toolName.toLowerCase()
    const count = resultLineCount(normalizedThread)
    const isError = normalizedThread.result?.is_error === true
    return [
      line(`tool ${toolName}: ${compactOneLine(target, 120)}`, 'tool'),
      line(normalizedThread.result
        ? `${isError ? '✗ ERROR' : '✓ OK'}${count > 1 ? ` · ${count} lines` : ''}`
        : '… pending',
      isError ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim'),
    ]
  }

  const mcpId = mcpToolIdForThread(normalizedThread)
  if (mcpId) {
    const isError = normalizedThread.result?.is_error === true
    const summary = summarizeMcpInput(input)
    const rawResult = extractResultText(normalizedThread.result?.content)
    const resultPreview = normalizedThread.result
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
        `${isError ? '✗' : normalizedThread.result ? '✓' : '…'} ${resultPreview}`,
        isError ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim',
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
    : previewJson(normalizedThread.toolUse.input)

  const resultText = typeof normalizedThread.result?.content === 'string'
    ? truncateLine(normalizedThread.result.content.trim())
    : normalizedThread.result
    ? truncateLine(extractResultText(normalizedThread.result.content)) || 'structured result'
    : 'pending'

  return [
    line(`tool ${toolName}${target ? `: ${target}` : ''}`, 'tool'),
    line(
      normalizedThread.result
        ? `result ${normalizedThread.result.is_error ? 'error' : 'ok'}: ${resultText || 'empty'}`
        : '… pending',
      normalizedThread.result?.is_error ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim',
    ),
  ]
}

function formatBlock(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  switch (block.type) {
    case 'text': {
      const protocolLines = textLinesForProtocolAwareBlock(block.text, false)
      if (protocolLines) return protocolLines
      return block.text.trim()
        ? compactLines(block.text.trim().split('\n')).map((entry) => line(entry))
        : []
    }
    case 'thinking':
      // An empty thinking block carries no information — emitting a bare
      // "thinking" placeholder just painted noise rows (Stream view especially).
      // The expanded formatter already returns [] for this case.
      return block.thinking.trim()
        ? [line(`thinking: ${truncateLine(block.thinking.trim().split('\n')[0])}`, 'thinking')]
        : []
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
    case 'bash_input':
      return [line(`! ${truncateLine(block.command)}`, 'tool')]
    case 'bash_output': {
      const firstLine = (block.stdout || block.stderr).trim().split('\n')[0] ?? ''
      return firstLine ? [line(truncateLine(firstLine), 'dim')] : [line('(no output)', 'dim')]
    }
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
        return [
          line(withClaudeRuntimeSuffix(`hook ${name}${outcome ? ` ${outcome}` : ''}`, block.payload), 'system'),
          ...claudeHookAdditionalContextLines(block.payload),
        ]
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
      if (block.subtype === 'model_refusal_fallback') {
        const from = typeof block.payload.original_model === 'string' ? block.payload.original_model : '?'
        const to = typeof block.payload.fallback_model === 'string' ? block.payload.fallback_model : '?'
        const category = typeof block.payload.api_refusal_category === 'string' ? block.payload.api_refusal_category : ''
        const verb = block.payload.direction === 'revert' ? 'reverted' : 'fell back'
        return [line(`refusal: ${verb} ${from} → ${to}${category ? ` (${category})` : ''}`, 'result_error')]
      }
      if (block.subtype === 'informational') {
        const text = typeof block.payload.content === 'string' && block.payload.content.trim()
          ? block.payload.content.replace(/\s+/g, ' ').trim()
          : 'informational'
        const stopped = block.payload.prevent_continuation === true ? ' · stopped' : ''
        const kind = block.payload.level === 'warning' ? 'result_error'
          : block.payload.level === 'suggestion' ? 'result_ok'
          : 'system'
        return [line(`${truncateLine(text)}${stopped}`, kind)]
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
  /** Spawn-chain depth for subagent messages (1 = spawned by main loop). */
  subagentDepth?: number
  /**
   * A tool on this card has been called but hasn't reported a result yet —
   * true only while a turn streams. Renderers use it to mark the card as
   * still running rather than complete.
   */
  pending?: boolean
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
  if (message.blocks.some((block) => block.type === 'tool_thread' && DIFF_TOOL_NAMES.has(canonicalToolName(block.toolUse.name)))) {
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
    || block.type === 'bash_input'
    || block.type === 'bash_output'
    || block.type === 'claude_system'
    || (block.type === 'text' && isAgentProtocolText(block.text))
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

export function formatTranscriptCard(message: ThreadedMessage, density: TuiDensity = 'balanced', activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCard {
  const baseLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : message.role.toUpperCase()
  const originKind = message.origin?.kind ?? ''
  const isSubagent = originKind.startsWith('subagent:')
  // Origin kind carries the spawn chain (`subagent:parent/child`); repeat the
  // arrow per nesting level for depth-2+ agents.
  const subagentDepth = isSubagent ? originKind.slice('subagent:'.length).split('/').length : 0
  const isPeerSend = message.origin?.subkind === 'peer-send-message'
  const subagentLabel = isSubagent
    ? `${baseLabel} ${'↪'.repeat(Math.min(Math.max(subagentDepth, 1), 3))} sub`
    : isPeerSend ? `${baseLabel} ⇄ peer` : baseLabel
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
    subagentDepth: subagentDepth > 0 ? subagentDepth : undefined,
    pending: message.blocks.some((block) => block.type === 'tool_thread' && !block.result) || undefined,
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

  for (const originalBlock of blocks) {
    const block = originalBlock.type === 'tool_thread'
      ? normalizeToolThreadForTui(originalBlock)
      : originalBlock

    if (block.type === 'tool_thread' && block.toolUse.name === 'Read') {
      const readBlock = readCodeBlockFromTool(block, `read${n++}`)
      if (readBlock) all.push(readBlock)
      lines.push(...formatBlockExpanded(block, activeForms, taskRegistry).filter((l) => l.text.trim()))
      continue
    }

    if (block.type === 'tool_thread' && mcpToolIdForThread(block)) {
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
    const protocolLines = textLinesForProtocolAwareBlock(block.text, true)
    if (protocolLines) {
      lines.push(...protocolLines.filter((l) => l.text.trim()))
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
    case 'text': {
      const protocolLines = textLinesForProtocolAwareBlock(block.text, true)
      if (protocolLines) return protocolLines
      return block.text.trim()
        ? sanitizeLine(block.text).trim().split('\n').map((l) => line(l.trimEnd()))
        : []
    }

    case 'thinking': {
      const content = block.thinking.trim()
      if (!content) return []
      return content
        .split('\n')
        .map((ln) => line(ln.trim(), 'thinking'))
        .filter((entry) => entry.text.length > 0)
    }

    case 'tool_thread': {
      const normalizedBlock = normalizeToolThreadForTui(block)
      const input = toolInputRecord(normalizedBlock)
      const toolName = normalizedBlock.toolUse.name

      const coordinatorLines = formatCoordinatorTool(normalizedBlock, true)
      if (coordinatorLines) return coordinatorLines

      if (TASK_TOOL_NAMES.has(toolName)) {
        return formatTaskTool(normalizedBlock, true, activeForms, taskRegistry)
      }

      if (OPENCODE_TASK_TOOL_NAMES.has(toolName)) {
        return formatOpenCodeTaskTool(normalizedBlock, true)
      }

      if (toolName === 'AskUserQuestion') {
        return formatAskUserQuestionTool(normalizedBlock, true)
      }

      if (toolName === 'ToolSearch') {
        return formatToolSearchTool(normalizedBlock, true)
      }

      if (toolName === 'FileChange') {
        const fcInput = normalizedBlock.toolUse.input as {
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
        const isError = normalizedBlock.result?.is_error === true
        const parsed = parseAgentResultJson(normalizedBlock.result?.content)
        const resultText = extractAgentResultText(normalizedBlock.result?.content)
        const stats = formatAgentStatsSummary(parsed)
        const header = line(`agent ${description}${subagentType ? ` [${subagentType}]` : ''}`, 'tool')
        if (!normalizedBlock.result) return [header, line('running…', 'dim')]
        const resultLines = resultText
          ? sanitizeLine(resultText).split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0).map((l) => line(l, 'agent'))
          : [line(isError ? '✗ ERROR' : '✓ done', isError ? 'result_error' : 'result_ok')]
        return [
          header,
          ...resultLines,
          ...(stats ? [line(stats, 'dim')] : []),
        ]
      }

      if (toolName === 'AgentSwitch') {
        const name = toolStringParam(input, ['name']) ?? 'agent'
        const status = toolStringParam(input, ['status']) ?? (normalizedBlock.result ? 'completed' : 'pending')
        return [
          line(`agent switch: ${name}`, 'tool'),
          line(normalizedBlock.result?.is_error ? '✗ ERROR' : `✓ ${status}`, normalizedBlock.result?.is_error ? 'result_error' : normalizedBlock.result ? 'result_ok' : 'dim'),
        ]
      }

      if (toolName === 'Bash') {
        const command = toolStringParam(input, ['command', 'cmd', 'script']) ?? 'command'
        const isError = normalizedBlock.result?.is_error === true
        const lines: TuiTranscriptCardLine[] = [line(`tool Bash: $ ${compactOneLine(command, 160)}`, 'tool')]
        if (!normalizedBlock.result) return [...lines, line('… running', 'dim')]
        const content = resultRawTextOf(normalizedBlock)
        const meta = parseBashResultMeta(content ?? '')
        lines.push(line(isError ? '✗ ERROR' : meta.exitCode != null && meta.exitCode !== 0 ? `✗ exit ${meta.exitCode}` : '✓ OK', isError || (meta.exitCode != null && meta.exitCode !== 0) ? 'result_error' : 'result_ok'))
        if (content) {
          for (const l of sanitizeLine(content).split('\n')) {
            const trimmed = l.trimEnd()
            if (trimmed.length > 0) lines.push(line(truncateLine(trimmed), 'muted'))
          }
        }
        return lines
      }

      if (toolName === 'TodoWrite') {
        const counts = formatTodoCounts(input)
        const todos = Array.isArray(input.todos) ? input.todos : []
        const lines: TuiTranscriptCardLine[] = [
          line(`tool TodoWrite: ${todos.length} todo${todos.length === 1 ? '' : 's'}`, 'tool'),
        ]
        if (counts) lines.push(line(counts, 'muted'))
        return lines
      }

      if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
        const filePath = typeof input.file_path === 'string' ? input.file_path : ''
        const isError = normalizedBlock.result?.is_error === true
        // Diff content is handled via card.editDiff → <diff> component; only emit header + status here
        return [
          line(`tool ${toolName}${filePath ? `: ${filePath}` : ''}`, 'tool'),
          line(isError ? '✗ ERROR' : '✓ OK', isError ? 'result_error' : 'result_ok'),
        ]
      }

      if (toolName === 'Read') {
        const filePath = typeof input.file_path === 'string' ? input.file_path : ''
        const pages = typeof input.pages === 'string' && input.pages.trim() ? ` pages ${input.pages.trim()}` : ''
        const isError = normalizedBlock.result?.is_error === true
        const summary = readSummaryOf(normalizedBlock)
        const lines: TuiTranscriptCardLine[] = [
          line(`tool Read${filePath ? `: ${filePath}` : ''}${pages}`, 'tool'),
        ]
        if (!normalizedBlock.result) return lines
        lines.push(line(isError ? '✗ ERROR' : `✓ ${summary ? readSummaryStatusText(normalizedBlock) : 'OK'}`, isError ? 'result_error' : 'result_ok'))
        if (summary) {
          for (const entry of formatClaudeReadMetadata(summary)) {
            lines.push(line(`  ${entry}`, entry === 'token cap' ? 'result_error' : 'dim'))
          }
        }
        if (isError) {
          const content = resultRawTextOf(normalizedBlock)
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

      const mcpId = mcpToolIdForThread(normalizedBlock)
      if (mcpId) {
        const isError = normalizedBlock.result?.is_error === true
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
        if (!normalizedBlock.result) {
          lines.push(line('… pending', 'dim'))
          return lines
        }
        const resultText = extractResultText(normalizedBlock.result.content)
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
      const isError = normalizedBlock.result?.is_error === true
      const content = typeof normalizedBlock.result?.content === 'string'
        ? sanitizeLine(normalizedBlock.result.content).trim()
        : Array.isArray(normalizedBlock.result?.content)
        ? sanitizeLine(extractResultText(normalizedBlock.result.content)).trim() || null
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
      } else if (normalizedBlock.result) {
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
    case 'bash_input':
      return [line(`! ${sanitizeLine(block.command).trim()}`, 'tool')]
    case 'bash_output': {
      const lines: TuiTranscriptCardLine[] = []
      if (block.stdout.trim()) {
        lines.push(...sanitizeLine(block.stdout).trim().split('\n').map((l) => line(l.trimEnd(), 'dim')))
      }
      if (block.stderr.trim()) {
        lines.push(...sanitizeLine(block.stderr).trim().split('\n').map((l) => line(l.trimEnd(), 'result_error')))
      }
      return lines.length > 0 ? lines : [line('(no output)', 'dim')]
    }
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
        const stopReason = typeof block.payload.stop_reason === 'string' ? block.payload.stop_reason : ''
        const isRefusal = stopReason === 'refusal'
        const isError = isRefusal || (resultSubtype && resultSubtype !== 'success')
        const head = isRefusal
          ? 'run refused'
          : isError
          ? `run ended: ${resultSubtype.replace(/_/g, ' ')}`
          : 'run completed'
        const lines: TuiTranscriptCardLine[] = [line(head, isError ? 'result_error' : 'result_ok')]
        if (typeof block.payload.num_turns === 'number') lines.push(line(`  ${block.payload.num_turns} turn${block.payload.num_turns === 1 ? '' : 's'}`, 'dim'))
        if (typeof block.payload.duration_ms === 'number') lines.push(line(`  ${(block.payload.duration_ms / 1000).toFixed(1)}s`, 'dim'))
        if (typeof block.payload.total_cost_usd === 'number') lines.push(line(`  $${block.payload.total_cost_usd.toFixed(4)}`, 'dim'))
        if (stopReason) lines.push(line(`  stop: ${stopReason}`, isRefusal ? 'result_error' : 'dim'))
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



import { pathBasename as basename } from '@/lib/projectPaths'

import type { ToolThread } from '@/lib/threading'

import type { ToolResultBlock } from '@/lib/types'
import { extractClaudeReadFileSummary, formatClaudeReadKind, formatClaudeReadRange } from '@/lib/claudeSdkFeatures'

export function canonicalToolName(name: string): string {
  const normalized = name.trim()
  const lower = normalized.toLowerCase().replace(/[-\s]/g, '_')
  if (['bash', 'shell', 'local_shell', 'powershell', 'run_in_terminal', 'command', 'command_execution'].includes(lower)) return 'Bash'
  if (['read', 'read_file', 'open_file', 'view_file', 'cat', 'ls', 'list_dir', 'fs_read'].includes(lower)) return 'Read'
  if (['grep', 'grep_search', 'search', 'semantic_search', 'find', 'find_text', 'rg'].includes(lower)) return 'Grep'
  if (['glob', 'find_files', 'file_search'].includes(lower)) return 'Glob'
  if (['edit', 'str_replace_editor', 'replace_string_in_file', 'insert_edit_into_file', 'update_file'].includes(lower)) return 'Edit'
  if (['multi_edit', 'multiedit'].includes(lower)) return 'MultiEdit'
  if (['write', 'write_file', 'create_file'].includes(lower)) return 'Write'
  if (['filechange', 'file_change'].includes(lower)) return 'FileChange'
  if (['notebook_edit', 'notebookedit'].includes(lower)) return 'NotebookEdit'
  if (['todowrite', 'todo_write', 'todo'].includes(lower)) return 'TodoWrite'
  if (['agent', 'task', 'subtask', 'task_create', 'taskcreate'].includes(lower)) return 'Agent'
  if (['task_status', 'taskstatus', 'task_get', 'taskget', 'task_update', 'taskupdate', 'task_list', 'tasklist', 'task_stop', 'taskstop'].includes(lower)) return 'task_status'
  if (['websearch', 'web_search'].includes(lower)) return 'WebSearch'
  if (['webfetch', 'web_fetch'].includes(lower)) return 'WebFetch'
  if (['toolsearch', 'tool_search'].includes(lower)) return 'ToolSearch'
  return normalized
}

export type McpToolId = { server: string; tool: string }

export function parseMcpToolName(name: string): McpToolId | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const idx = rest.indexOf('__')
  if (idx <= 0) return null
  const server = rest.slice(0, idx)
  const tool = rest.slice(idx + 2)
  if (!server || !tool) return null
  return { server, tool }
}

export function isMcpToolName(name: string): boolean {
  return parseMcpToolName(name) !== null
}

// ── Tool result renderers ─────────────────────────────────────────────────────

export function resultToString(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(b => {
        if ((b as { type: string }).type !== 'text') return JSON.stringify(b)
        const text = (b as { text?: unknown }).text
        if (typeof text === 'string') return text
        const file = (b as { file?: unknown }).file
        if (file && typeof file === 'object' && typeof (file as { content?: unknown }).content === 'string') {
          return (file as { content: string }).content
        }
        return JSON.stringify(b)
      })
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
}

export function toolInputRecord(thread: ToolThread): Record<string, unknown> {
  return thread.toolUse.input && typeof thread.toolUse.input === 'object' && !Array.isArray(thread.toolUse.input)
    ? thread.toolUse.input
    : {}
}

export function toolStringParam(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function toolNumberParam(input: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function agentsCompactOneLine(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function agentsFormatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export type AgentsFileChange = {
  path?: string
  kind?: unknown
  diff?: string
}

export function agentsFileChanges(input: Record<string, unknown>): AgentsFileChange[] {
  const changes = input.changes
  if (!Array.isArray(changes)) return []
  return changes.flatMap((change): AgentsFileChange[] => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return []
    const record = change as Record<string, unknown>
    return [{
      path: typeof record.path === 'string' && record.path.trim() ? record.path.trim() : undefined,
      kind: record.kind,
      diff: typeof record.diff === 'string' ? record.diff : undefined,
    }]
  })
}

function agentsCompactPathTail(value: string | null | undefined, segmentCount: number): string {
  const cleaned = value?.trim().replace(/\\/g, '/') ?? ''
  if (!cleaned) return ''
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length <= segmentCount) return parts.join('/') || cleaned
  return parts.slice(-segmentCount).join('/')
}

export function summarizeAgentsFileChangeKind(kind: unknown): string {
  if (typeof kind === 'string' && kind.trim()) return kind.trim()
  if (kind && typeof kind === 'object' && !Array.isArray(kind)) {
    const record = kind as Record<string, unknown>
    if (typeof record.type === 'string' && record.type.trim()) return record.type.trim()
    if (typeof record.kind === 'string' && record.kind.trim()) return record.kind.trim()
  }
  return ''
}

function agentsFirstDiffHunkLabel(diffText: string | null | undefined): string {
  if (!diffText) return ''
  const hunk = diffText.split('\n').find((line) => line.startsWith('@@ '))
  const match = hunk?.match(/\+(\d+)/)
  return match?.[1] ? `@${match[1]}` : ''
}

export function agentsDiffStats(diffText: string | null | undefined): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  if (!diffText) return { additions, deletions }
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

function agentsFileChangeStatsLabel(changes: AgentsFileChange[]): string {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    const stats = agentsDiffStats(change.diff)
    additions += stats.additions
    deletions += stats.deletions
  }
  return additions > 0 || deletions > 0 ? `+${additions} -${deletions}` : ''
}

function summarizeAgentsFileChange(input: Record<string, unknown>): string {
  const changes = agentsFileChanges(input)
  if (changes.length === 0) return toolStringParam(input, ['status']) ?? 'file change'

  const first = changes[0]
  const pathLabel = agentsCompactPathTail(first.path, 2) || basename(first.path ?? '') || 'file change'
  const kind = summarizeAgentsFileChangeKind(first.kind)
  const hunk = agentsFirstDiffHunkLabel(first.diff)
  const parts = [pathLabel]
  if (changes.length > 1) parts.push(`+${changes.length - 1} more`)
  if (kind) parts.push(kind)
  if (hunk) parts.push(hunk)
  return parts.join(' · ')
}

function agentsOutputText(thread: ToolThread): string {
  return thread.result ? resultToString(thread.result.content).trim() : ''
}

function agentsResultLineCount(raw: string): number {
  if (!raw) return 0
  return raw.split('\n').filter((line) => line.trim().length > 0).length
}

function agentsBashResultMeta(raw: string): { outputLineCount: number; exitCode: number | null; durationMs: number | null } {
  let exitCode: number | null = null
  let durationMs: number | null = null
  let outputLineCount = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
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

function agentsTodoCounts(input: Record<string, unknown>): { completed: number; active: number; pending: number; total: number } {
  const todos = Array.isArray(input.todos) ? input.todos : []
  const counts = { completed: 0, active: 0, pending: 0, total: 0 }
  for (const todo of todos) {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) continue
    counts.total += 1
    const status = (todo as Record<string, unknown>).status
    if (status === 'completed') counts.completed += 1
    else if (status === 'in_progress') counts.active += 1
    else counts.pending += 1
  }
  return counts
}

export function agentsEditStats(input: Record<string, unknown>): { additions: number; deletions: number } | null {
  if (Array.isArray(input.edits)) {
    let additions = 0
    let deletions = 0
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue
      const record = edit as Record<string, unknown>
      const oldText = typeof record.oldText === 'string' ? record.oldText : typeof record.old_string === 'string' ? record.old_string : ''
      const newText = typeof record.newText === 'string' ? record.newText : typeof record.new_string === 'string' ? record.new_string : ''
      if (oldText) deletions += lineCount(oldText)
      if (newText) additions += lineCount(newText)
    }
    return additions > 0 || deletions > 0 ? { additions, deletions } : null
  }
  const oldText = toolStringParam(input, ['oldText', 'old_string'])
  const newText = toolStringParam(input, ['newText', 'new_string'])
  if (!oldText && !newText) return null
  return {
    additions: newText ? lineCount(newText) : 0,
    deletions: oldText ? lineCount(oldText) : 0,
  }
}

export function summarizeAgentsTool(thread: ToolThread): string {
  const originalName = thread.toolUse.name
  const name = canonicalToolName(originalName)
  const input = toolInputRecord(thread)
  if (name === 'Bash') {
    const command = toolStringParam(input, ['command', 'cmd'])
    return command ? `$ ${agentsCompactOneLine(command, 150)}` : 'shell command'
  }
  if (name === 'Read') {
    const filePath = toolStringParam(input, ['file_path', 'path'])
    const range = [
      toolNumberParam(input, ['offset']) != null ? `@${toolNumberParam(input, ['offset'])}` : null,
      toolNumberParam(input, ['limit']) != null ? `+${toolNumberParam(input, ['limit'])}` : null,
      toolStringParam(input, ['pages']) ? `pages ${toolStringParam(input, ['pages'])}` : null,
    ].filter(Boolean).join(' ')
    return [filePath ?? 'read file', range].filter(Boolean).join(' · ')
  }
  if (name === 'FileChange') return summarizeAgentsFileChange(input)
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write') {
    const path = toolStringParam(input, ['file_path', 'path'])
    const stats = name === 'Write'
      ? (toolStringParam(input, ['content']) ? { additions: lineCount(toolStringParam(input, ['content']) ?? ''), deletions: 0 } : null)
      : agentsEditStats(input)
    const editSize = stats ? ` (-${stats.deletions} +${stats.additions})` : ''
    return `${path ?? 'file change'}${editSize}`
  }
  if (name === 'Grep') {
    const pattern = toolStringParam(input, ['pattern', 'query'])
    const path = toolStringParam(input, ['path', 'include', 'glob'])
    const mode = toolStringParam(input, ['output_mode'])
    const label = pattern ? `/${agentsCompactOneLine(pattern, 80)}/` : 'search'
    return [label, path ? `in ${path}` : null, mode].filter(Boolean).join(' · ')
  }
  if (name === 'Glob') {
    const pattern = toolStringParam(input, ['pattern']) ?? 'glob'
    const path = toolStringParam(input, ['path'])
    return [pattern, path ? `in ${path}` : null].filter(Boolean).join(' · ')
  }
  if (name === 'TodoWrite') {
    const counts = agentsTodoCounts(input)
    return counts.total > 0 ? `${counts.total} todos` : 'todo update'
  }
  if (name === 'WebSearch') return toolStringParam(input, ['query']) ?? 'web search'
  if (name === 'WebFetch') return toolStringParam(input, ['url', 'uri']) ?? 'web fetch'
  if (name === 'ToolSearch') return toolStringParam(input, ['query']) ?? 'tool search'
  if (originalName === 'AgentSwitch') return toolStringParam(input, ['name']) ?? 'agent switch'
  if (isMcpToolName(originalName)) {
    const server = toolStringParam(input, ['server'])
    const summary = Object.keys(input).slice(0, 2).join(', ')
    return [server, summary].filter(Boolean).join(' · ') || 'mcp tool'
  }
  if (name === 'Agent' || name === 'task' || name.startsWith('Task')) {
    return toolStringParam(input, ['description', 'prompt', 'task', 'subject']) ?? 'agent task'
  }
  try {
    return JSON.stringify(input)
  } catch {
    return originalName
  }
}

export function streamToolOutputSummary(thread: ToolThread): string | null {
  const name = canonicalToolName(thread.toolUse.name)
  const raw = agentsOutputText(thread)
  if (!raw) return null
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text || text === 'No visible content') continue
    if (/^[└├│─\s]+$/.test(text) || /^[✓✔]️?\s*(?:OK|done)?$/i.test(text)) continue
    if (/^(?:exit_code|duration_ms):/i.test(text)) continue
    if (name === 'Bash' && text.startsWith('$ ')) continue
    return agentsCompactOneLine(text, 180)
  }
  return null
}

function formatAgentsCount(value: number, unit: string): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k ${unit}`
  return `${value} ${unit}`
}

export function lineCount(value: string): number {
  if (!value) return 0
  return value.split('\n').length
}

export function agentsToolMetaBadges(thread: ToolThread): string[] {
  const originalName = thread.toolUse.name
  const name = canonicalToolName(originalName)
  const input = toolInputRecord(thread)
  const badges: string[] = []
  const status = toolStringParam(input, ['status'])
  if (name === 'FileChange') {
    const changes = agentsFileChanges(input)
    if (changes.length > 0) {
      badges.push(`${changes.length} file${changes.length === 1 ? '' : 's'}`)
      const stats = agentsFileChangeStatsLabel(changes)
      if (stats) badges.push(stats)
    }
    if (!thread.result) badges.push('running')
    else if (thread.result.is_error) badges.push('error')
    else if (badges.length === 0) badges.push(status ?? 'ok')
    return badges.slice(0, 3)
  }

  if (name === 'TodoWrite') {
    const counts = agentsTodoCounts(input)
    if (counts.active > 0) badges.push(`${counts.active} active`)
    if (counts.pending > 0) badges.push(`${counts.pending} pending`)
    if (counts.completed > 0) badges.push(`${counts.completed} done`)
    if (!thread.result) badges.push('running')
    else if (thread.result.is_error) badges.push('error')
    else if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 3)
  }

  const oldText = toolStringParam(input, ['old_string'])
  const newText = toolStringParam(input, ['new_string'])
  const content = toolStringParam(input, ['content'])
  const editStats = name === 'Edit' || name === 'MultiEdit' ? agentsEditStats(input) : null

  if (editStats) {
    badges.push(`+${editStats.additions} -${editStats.deletions}`)
  } else if (oldText || newText) {
    const del = oldText ? lineCount(oldText) : 0
    const add = newText ? lineCount(newText) : 0
    badges.push(`+${add} -${del}`)
  } else if (content && (name === 'Write' || name === 'FileChange')) {
    badges.push(formatAgentsCount(lineCount(content), 'lines'))
  }

  if (!thread.result) {
    badges.push('running')
    return badges
  }

  const output = agentsOutputText(thread)

  if (name === 'Bash') {
    const meta = agentsBashResultMeta(output)
    if (thread.result.is_error) badges.push('error')
    if (status && !/^(completed|success|succeeded)$/i.test(status)) badges.push(status)
    if (meta.exitCode != null && (meta.exitCode !== 0 || thread.result.is_error)) badges.push(`exit ${meta.exitCode}`)
    if (meta.durationMs != null) badges.push(agentsFormatDuration(meta.durationMs))
    if (meta.outputLineCount > 0) badges.push(formatAgentsCount(meta.outputLineCount, 'lines'))
    if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 3)
  }

  if (thread.result.is_error) {
    badges.push('error')
    return badges
  }

  if (name === 'Read') {
    const filePath = toolStringParam(input, ['file_path', 'path']) ?? ''
    const summary = extractClaudeReadFileSummary(thread.result, filePath)
    const range = summary ? formatClaudeReadRange(summary) : null
    const kind = summary ? formatClaudeReadKind(summary) : null
    if (range) badges.push(range)
    if (kind) badges.push(kind)
    if (summary?.truncatedByTokenCap) badges.push('partial')
    if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 3)
  }

  if (name === 'Grep') {
    const count = agentsResultLineCount(output)
    const mode = toolStringParam(input, ['output_mode'])
    badges.push(mode === 'content' || mode === 'count' ? `${count} lines` : `${count} file${count === 1 ? '' : 's'}`)
    return badges.slice(0, 2)
  }

  if (name === 'Glob') {
    const count = agentsResultLineCount(output)
    badges.push(`${count} file${count === 1 ? '' : 's'}`)
    return badges.slice(0, 2)
  }

  if (originalName === 'AgentSwitch') {
    badges.push(status ?? 'done')
    return badges.slice(0, 2)
  }

  if (name === 'WebSearch' || name === 'WebFetch' || name === 'ToolSearch' || isMcpToolName(originalName)) {
    if (status && !/^(completed|success|succeeded)$/i.test(status)) badges.push(status)
    const lines = agentsResultLineCount(output)
    if (lines > 1) badges.push(formatAgentsCount(lines, 'lines'))
    else if (output) badges.push(`${output.length.toLocaleString()} chars`)
    if (badges.length === 0) badges.push('ok')
    return badges.slice(0, 2)
  }

  if (!output) {
    badges.push('ok')
    return badges
  }

  const lines = lineCount(output)
  if (lines > 1) badges.push(formatAgentsCount(lines, 'lines'))
  else badges.push(`${output.length.toLocaleString()} chars`)
  return badges.slice(0, 2)
}

export function normalizeToolThreadForNativeCard(thread: ToolThread): ToolThread {
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
    const edits = input.edits.flatMap((edit): Array<{ old_string?: string; new_string?: string; replace_all?: boolean }> => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return []
      const record = edit as Record<string, unknown>
      const oldText = typeof record.oldText === 'string' ? record.oldText : typeof record.old_string === 'string' ? record.old_string : undefined
      const newText = typeof record.newText === 'string' ? record.newText : typeof record.new_string === 'string' ? record.new_string : undefined
      const replaceAll = typeof record.replace_all === 'boolean' ? record.replace_all : undefined
      return [{ old_string: oldText, new_string: newText, replace_all: replaceAll }]
    })
    return withInput('MultiEdit', { ...input, file_path: input.path, edits })
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

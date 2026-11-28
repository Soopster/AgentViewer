import type { ToolThread } from '../../lib/threading'
import { extractClaudeReadFileSummary } from '../../lib/claudeSdkFeatures'

export type McpToolId = { server: string; tool: string }

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

export function mcpToolIdForThread(thread: ToolThread): McpToolId | null {
  if (thread.toolUse.mcp) return thread.toolUse.mcp
  const encoded = parseMcpToolName(thread.toolUse.name)
  if (encoded) return encoded
  const input = toolInputRecord(thread)
  const server = typeof input.server === 'string' ? input.server.trim() : ''
  return server ? { server, tool: thread.toolUse.name } : null
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

export function normalizedToolKey(name: string): string {
  return name.trim().toLowerCase().replace(/[-\s]/g, '_')
}

// A transcript uses a few dozen tool names and asks for each one several times
// per tool call. Bounded, so an unusual stream of names cannot grow it.
const CANONICAL_TOOL_NAME_CACHE_MAX = 512

const canonicalToolNameCache = new Map<string, string>()

export function canonicalToolName(name: string): string {
  const cached = canonicalToolNameCache.get(name)
  if (cached !== undefined) return cached
  const canonical = resolveCanonicalToolName(name)
  if (canonicalToolNameCache.size >= CANONICAL_TOOL_NAME_CACHE_MAX) canonicalToolNameCache.clear()
  canonicalToolNameCache.set(name, canonical)
  return canonical
}

function resolveCanonicalToolName(name: string): string {
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

export function toolInputRecord(thread: ToolThread): Record<string, unknown> {
  return thread.toolUse.input && typeof thread.toolUse.input === 'object' && !Array.isArray(thread.toolUse.input)
    ? thread.toolUse.input as Record<string, unknown>
    : {}
}

export function toolStringParam(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function normalizeToolThreadForTui(thread: ToolThread): ToolThread {
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

export function extractResultText(content: unknown): string {
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

export function resultTextOf(thread: ToolThread): string | null {
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

export function readInputPathOf(thread: ToolThread): string | undefined {
  const normalizedThread = normalizeToolThreadForTui(thread)
  const input = normalizedThread.toolUse.input as { file_path?: unknown }
  return typeof input.file_path === 'string' ? input.file_path : undefined
}

export function readSummaryOf(thread: ToolThread) {
  return extractClaudeReadFileSummary(thread.result, readInputPathOf(thread))
}

export function resultRawTextOf(thread: ToolThread): string | null {
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

import { summarizeKind, normalizeUnifiedDiff, previewDiff, previewFileChange, synthesizeEditDiff } from './format/diffs'
import { extractMarkdownContent, extractCodeBlocksFromBlocks } from './format/code'
import { formatAskUserQuestionTool } from './format/questions'
import { formatTodoCounts, formatTodoChecklist, formatTodoSubtitle } from './format/todos'
import type {
  TuiTranscriptLineTone, TuiTranscriptCardLine, TuiTranscriptCard, TuiTranscriptCardCategory,
} from './format/types'
import {
  MAX_PREVIEW_CHARS, MAX_BLOCK_LINES, MAX_CARD_LINES,
  sanitizeLine, formatTimestamp, truncateLine, compactLines, previewJson, line, compactOneLine,
} from './format/text'
import {
  type McpToolId, mcpToolIdForThread, normalizeToolThreadForTui, canonicalToolName, toolInputRecord, toolStringParam,
  extractResultText, resultTextOf, readSummaryOf, resultRawTextOf,
} from './format/tools'
import { coordinatorCall, formatCoordinatorTool, coordinatorBriefLines, coordinatorMailLines } from './format/coordinator'
import { textLinesForProtocolAwareBlock, isAgentProtocolText } from './format/protocol'
import {
  TASK_TOOL_NAMES, OPENCODE_TASK_TOOL_NAMES, type TaskActiveForms,
  buildTaskActiveForms, buildTranscriptTaskContext, formatTaskTool, formatOpenCodeTaskTool,
} from './format/tasks'

import { inlineImageBlock } from '../lib/imageContent'
import type { ToolResultBlock } from '../lib/types'
import { readAsyncQuestions } from '../lib/asyncQuestions'
import { mcpResourceLinks } from '../lib/mcpArtifacts'
import { readableContextText } from '../lib/composerContext'
import { getAssistantLabel } from '../lib/provider'
import {
  claudeStartupFailureHint,
  claudeTaskEndCause,
  formatClaudeReadKind,
  formatClaudeReadMetadata,
  formatClaudeReadRange,
  formatClaudeRuntimeCounts,
  formatClaudeRuntimeDetailLines,
} from '../lib/claudeSdkFeatures'
import { pathBasename } from '../lib/projectPaths'
import { computeTurnDurationsMs, type ThreadedBlock, type ThreadedMessage, type ToolThread } from '../lib/threading'
import { buildTaskRegistry, type TaskRegistry } from '../lib/taskRegistry'
import type { ContentBlock, Session, SessionInfo, SystemMessagePayload } from '../lib/types'
import type { TuiDensity } from './theme'
import { fileEditStatsFromToolCalls, type FileEditStat } from '../lib/turnEditStats'

export type {
  TuiTranscriptLineTone, TuiTranscriptCardLine, TuiTranscriptCardCategory,
  TuiTranscriptCodeBlock, TuiTranscriptCard,
} from './format/types'
export {
  buildTaskActiveForms, buildTranscriptTaskContext, type TaskActiveForms, type TranscriptTaskContext,
} from './format/tasks'
export { textNeedsTuiMermaid, ensureTuiMermaidRenderer } from './format/mermaid'

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

const DIFF_TOOL_NAMES = new Set(['FileChange', 'Edit', 'MultiEdit', 'Write'])

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

export function formatDurationMs(value: number): string {
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
    // Unanchored at the start, so the pattern is retried from every `(` in the
    // line; it can only match a line ending in `)`.
    const parenExitMatch = trimmed.charCodeAt(trimmed.length - 1) === 41
      ? trimmed.match(/\(exit\s+(-?\d+)\)$/i)
      : null
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
    const subtitle = formatTodoSubtitle(input)
    return [
      line(`tool TodoWrite: ${todos.length} todo${todos.length === 1 ? '' : 's'}`, 'tool'),
      line(subtitle ?? (normalizedThread.result ? '✓ updated' : 'pending'), normalizedThread.result?.is_error ? 'result_error' : normalizedThread.result ? 'result_ok' : 'dim'),
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

function mcpAppLines(block: ThreadedBlock): TuiTranscriptCardLine[] {
  if (block.type !== 'tool_thread' || !block.toolUse.mcp?.app) return []
  const app = block.toolUse.mcp.app
  return [line(`MCP App (${app.preferredModelDisplayMode}): ${sanitizeLine(app.resourceUri)}`, 'muted'),
    line('Open this tool in the web app for its interactive preview.', 'dim')]
}

function formatBlock(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  const links = block.type === 'tool_thread'
    ? mcpResourceLinks(block.result?.resourceLinks, Array.isArray(block.result?.content) ? block.result.content : [])
    : block.type === 'claude_system' ? mcpResourceLinks(block.payload.resource_links) : []
  const content = [...formatBlockContent(block, activeForms, taskRegistry), ...mcpAppLines(block)]
  if (!links.length) return content
  return [...content, ...links.map(link => line(`artifact: ${sanitizeLine(link.title || link.name)} — ${link.uri}`, 'muted'))]
}

function formatBlockContent(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  switch (block.type) {
    case 'text': {
      const protocolLines = textLinesForProtocolAwareBlock(block.text, false)
      if (protocolLines) return protocolLines
      return block.text.trim()
        ? compactLines(readableContextText(block.text).trim()).map((entry) => line(entry))
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
    case 'coordinator_brief':
      return coordinatorBriefLines(block)
    case 'coordinator_mail':
      return coordinatorMailLines(block, false)
    case 'slash_command':
      return [line(truncateLine(`/${block.command.replace(/^\/+/, '')} ${block.args}`.trim()), 'tool')]
    // Output the user asked for reads in full, capped by density like a reply
    // rather than cut to its first line.
    case 'local_command_stdout':
      return block.stdout.trim()
        ? sanitizeLine(block.stdout).trim().split('\n').map((l) => line(truncateLine(l.trimEnd()), 'dim'))
        : [line('❯', 'dim')]
    case 'bash_input':
      return [line(`! ${truncateLine(block.command)}`, 'tool')]
    case 'bash_output': {
      const output = (block.stdout || block.stderr).trim()
      return output
        ? sanitizeLine(output).split('\n').map((l) => line(truncateLine(l.trimEnd()), 'dim'))
        : [line('(no output)', 'dim')]
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
        const taskEndCause = claudeTaskEndCause(block.payload)
        // Leads rather than trails, so truncating a long summary cannot cut it.
        const cause = taskEndCause ? `stopped (${taskEndCause}) · ` : ''
        return [line(`● ${subagentPrefix}${cause}${truncateLine(withClaudeRuntimeSuffix(text, block.payload))}`, 'thinking')]
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
        return [line(`rate limit ${status}${utilization}${typeof info?.overageEnabled === 'boolean' ? ` · extra usage ${info.overageEnabled ? 'enabled' : 'disabled'}` : ''}`, status === 'rejected' ? 'result_error' : 'system')]
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
        // scope 'local' (subagent/side-question/background fork) leaves the
        // session model unchanged — say so, or this reads as a session-wide
        // swap. Absent on older CLIs; treat as session-wide.
        const scopeNote = block.payload.scope === 'local' ? ' (this response only)' : ''
        return [line(`refusal: ${verb} ${from} → ${to}${scopeNote}${category ? ` (${category})` : ''}`, 'result_error')]
      }
      // Refusal with nothing to fall back to: the turn is over, not degraded.
      if (block.subtype === 'model_refusal_no_fallback') {
        const model = typeof block.payload.original_model === 'string' ? block.payload.original_model : 'model'
        const category = typeof block.payload.api_refusal_category === 'string' ? block.payload.api_refusal_category : ''
        return [line(`refusal: ${model} refused, no fallback${category ? ` (${category})` : ''}`, 'result_error')]
      }
      if (block.subtype === 'worker_shutting_down') {
        const reason = typeof block.payload.reason === 'string' && block.payload.reason ? block.payload.reason : 'unknown'
        return [line(`worker shutting down (${reason.replace(/_/g, ' ')})`, 'result_error')]
      }
      if (block.subtype === 'conversation_reset') {
        const next = typeof block.payload.new_conversation_id === 'string' ? block.payload.new_conversation_id : ''
        const trigger = typeof block.payload.trigger === 'string' ? block.payload.trigger.replace(/_/g, ' ') : ''
        return [line(`conversation reset${trigger ? ` (${trigger})` : ''}${next ? ` → ${next.slice(0, 8)}` : ''}`, 'system')]
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

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

// The label is a function of the local calendar day alone, and a transcript
// spans a handful of days — so format each day once rather than once per card.
const DAY_LABEL_CACHE_MAX = 512
const dayLabelCache = new Map<number, string>()

function formatDayLabel(parsed: Date | null): string | undefined {
  if (!parsed) return undefined
  if (Number.isNaN(parsed.getTime())) return undefined
  const day = parsed.getFullYear() * 10_000 + parsed.getMonth() * 100 + parsed.getDate()
  const cached = dayLabelCache.get(day)
  if (cached !== undefined) return cached
  const label = DAY_LABEL_FORMATTER.format(parsed)
  if (dayLabelCache.size >= DAY_LABEL_CACHE_MAX) dayLabelCache.clear()
  dayLabelCache.set(day, label)
  return label
}

function compactPreviewLines(
  lines: TuiTranscriptCardLine[],
  limit: number,
  emptyText: string,
  emptyTone: TuiTranscriptLineTone,
): TuiTranscriptCardLine[] {
  const visible: TuiTranscriptCardLine[] = []
  let count = 0
  for (const entry of lines) {
    const text = truncateLine(entry.text.trim())
    if (!text) continue
    count++
    if (visible.length < limit) {
      visible.push(text === entry.text ? entry : { text, tone: entry.tone })
    }
  }
  if (count === 0) return [line(emptyText, emptyTone)]
  if (count > limit) visible[limit - 1] = line(`… ${count - (limit - 1)} more`, 'dim')
  return visible
}

function compactCardLines(lines: TuiTranscriptCardLine[], density: TuiDensity): TuiTranscriptCardLine[] {
  return compactPreviewLines(lines, cardLineLimit(density), 'No visible content', 'dim')
}

function compactAutoFoldLines(lines: TuiTranscriptCardLine[]): TuiTranscriptCardLine[] {
  return compactPreviewLines(lines, 2, 'Technical activity', 'muted')
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

type CardBlockAnalysis = {
  category: TuiTranscriptCardCategory
  hasSyntheticEdit: boolean
  pending: boolean
}

function analyzeCardBlocks(message: ThreadedMessage): CardBlockAnalysis {
  let hasDiff = false
  let hasInsight = false
  let hasOperationalBlock = false
  let hasSyntheticEdit = false
  let pending = false

  for (const block of message.blocks) {
    if (block.type === 'tool_thread') {
      const toolName = canonicalToolName(block.toolUse.name)
      hasDiff ||= DIFF_TOOL_NAMES.has(toolName)
      hasSyntheticEdit ||= toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write'
      pending ||= !block.result
      hasOperationalBlock = true
      continue
    }
    if (block.type === 'text') {
      hasInsight ||= INSIGHT_RE.test(block.text)
      hasOperationalBlock ||= isAgentProtocolText(block.text)
      continue
    }
    // A `!command` and a local slash command's output are what the user asked
    // to see — the native CLIs print them inline — so they are conversation,
    // not operational chrome folded behind `e` like the agent's own tool calls.
    hasOperationalBlock ||= block.type === 'task_notification'
      || block.type === 'system_reminder'
      || block.type === 'slash_command'
      || block.type === 'claude_system'
  }

  const category = message.role === 'system'
    ? 'system'
    : hasDiff
    ? 'diff'
    : hasInsight
    ? 'insight'
    : hasOperationalBlock
    ? 'technical'
    : 'conversation'
  return { category, hasSyntheticEdit, pending }
}

function cardSearchText(expandedLines: TuiTranscriptCardLine[]): string {
  return expandedLines.map((entry) => entry.text).join('\n')
}

function cardSearchHaystack(label: string, searchText: string): string {
  return `${label}\n${searchText}`.toLowerCase()
}

// A card's two search strings are its expanded lines over again — 46% of a
// card's bytes — and nothing reads them until a search runs. A card formatted
// with `deferSearchText` carries '' in both (so its key order is unchanged),
// and deferTranscriptCardSearchText makes those two keys derive themselves on
// first read. Every reader sees exactly what an eager card holds.
const deferredSearchCards = new WeakSet<TuiTranscriptCard>()

function settleCardSearchText(card: TuiTranscriptCard, searchText?: string, searchHaystackLower?: string): void {
  deferredSearchCards.delete(card)
  const text = searchText ?? cardSearchText(card.expandedLines)
  Object.defineProperty(card, 'searchText', { value: text, writable: true, enumerable: true, configurable: true })
  Object.defineProperty(card, 'searchHaystackLower', {
    value: searchHaystackLower ?? cardSearchHaystack(card.label, text),
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

const DEFERRED_SEARCH_TEXT: PropertyDescriptor = {
  get(this: TuiTranscriptCard) { settleCardSearchText(this); return this.searchText },
  set(this: TuiTranscriptCard, value: string) { settleCardSearchText(this, value) },
  enumerable: true,
  configurable: true,
}
const DEFERRED_SEARCH_HAYSTACK: PropertyDescriptor = {
  get(this: TuiTranscriptCard) { settleCardSearchText(this); return this.searchHaystackLower },
  set(this: TuiTranscriptCard, value: string) { settleCardSearchText(this, undefined, value) },
  enumerable: true,
  configurable: true,
}

/** Makes a card formatted with `deferSearchText` derive its search strings on
 *  first read. Returns the same card. */
export function deferTranscriptCardSearchText(card: TuiTranscriptCard): TuiTranscriptCard {
  deferredSearchCards.add(card)
  Object.defineProperty(card, 'searchText', DEFERRED_SEARCH_TEXT)
  Object.defineProperty(card, 'searchHaystackLower', DEFERRED_SEARCH_HAYSTACK)
  return card
}

/** `{ ...card, lines, compactSummary }` for a card that may still be deferring
 *  its search strings: a spread would read them, which derives both for every
 *  card of a density switch. The copy defers too, and keeps the key order. */
export function withTranscriptCardPreview(card: TuiTranscriptCard, lines: TuiTranscriptCardLine[], compactSummary: string): TuiTranscriptCard {
  if (!deferredSearchCards.has(card)) return { ...card, lines, compactSummary }
  const copy = {} as Record<string, unknown>
  const source = card as unknown as Record<string, unknown>
  for (const key of Object.keys(card)) {
    copy[key] = key === 'searchText' || key === 'searchHaystackLower' ? '' : source[key]
  }
  copy.lines = lines
  copy.compactSummary = compactSummary
  return deferTranscriptCardSearchText(copy as unknown as TuiTranscriptCard)
}

export function formatTranscriptCard(message: ThreadedMessage, density: TuiDensity = 'balanced', activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry, durationMs?: number, deferSearchText = false): TuiTranscriptCard {
  // Older Codex snapshots encoded attachments as text. Strip those payloads
  // before formatting/searching and carry previews separately from prose.
  const images: string[] = []
  const cleanText = (text: string): string => text.replace(/(?:\[image\]\s*)?data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g, (_match, mime: string, data: string) => {
    images.push(`data:${mime};base64,${data.replace(/\s/g, '')}`)
    return '[image attachment]'
  })
  const collectImage = (block: unknown): void => {
    const image = inlineImageBlock(block)
    if (image?.source) images.push(`data:${image.source.media_type};base64,${image.source.data.replace(/\s/g, '')}`)
  }
  const cleanResult = (result: ToolResultBlock): ToolResultBlock => ({
    ...result,
    content: typeof result.content === 'string' ? cleanText(result.content) : result.content.map((block): ContentBlock => {
      collectImage(block)
      if (block.type === 'text' && typeof block.text === 'string') return { ...block, text: cleanText(block.text) }
      if (block.type === 'tool_result') return cleanResult(block as ToolResultBlock)
      return block
    }),
  })
  message = { ...message, blocks: message.blocks.map(block => {
    collectImage(block)
    if (block.type === 'tool_thread' && block.result) return { ...block, result: cleanResult(block.result) }
    if (block.type === 'text') return { ...block, text: cleanText(block.text) }
    return block
  }) }
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
  const previewLines: TuiTranscriptCardLine[] = []
  for (const block of message.blocks) previewLines.push(...formatBlock(block, activeForms, taskRegistry))
  const { processedLines: expandedLines, codeBlocks, hasMermaidDiagrams } = extractCodeBlocksFromBlocks(message.blocks, (block) => formatBlockExpanded(block, activeForms, taskRegistry))
  const parsedTimestamp = message.timestamp ? new Date(message.timestamp) : null
  const blockAnalysis = analyzeCardBlocks(message)
  const asyncQuestions = message.blocks.some(block => block.type === 'tool_thread' && block.toolUse.input.asyncUserInput === true)
  const category = asyncQuestions ? 'conversation' : blockAnalysis.category
  const autoFold = category !== 'conversation' && category !== 'insight'
  const previewSourceLines = previewLines
  const collapsedLines = asyncQuestions ? expandedLines : hasMermaidDiagrams
    ? compactMermaidLines(expandedLines)
    : autoFold
    ? compactAutoFoldLines(previewSourceLines)
    : compactCardLines(previewSourceLines, density)
  const compactSummary = collapsedLines.map((entry) => entry.text).join(' · ')

  const searchText = deferSearchText ? '' : cardSearchText(expandedLines)
  return {
    asyncQuestions: asyncQuestions ? message.blocks.flatMap(block => block.type === 'tool_thread' ? readAsyncQuestions(block.toolUse.input) : []) : undefined,
    images: images.length ? [...new Set(images)] : undefined,
    key: message.uuid,
    role: message.role,
    provider: message.provider,
    label,
    category,
    autoFold,
    compactSummary,
    usageSummary: formatUsageSummary(message),
    durationLabel: turnDurationLabel(durationMs),
    timestamp: message.timestamp ? formatTimestamp(message.timestamp) : undefined,
    timestampMs: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.getTime() : undefined,
    dayKey: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.toISOString().slice(0, 10) : undefined,
    dayLabel: formatDayLabel(parsedTimestamp),
    lines: collapsedLines,
    expandedLines,
    searchText,
    searchHaystackLower: deferSearchText ? '' : cardSearchHaystack(label, searchText),
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
    editDiff: blockAnalysis.hasSyntheticEdit ? synthesizeEditDiff(message) : undefined,
    markdownContent: !asyncQuestions && (category === 'conversation' || category === 'insight')
      ? extractMarkdownContent(message.blocks)
      : undefined,
    hasMermaidDiagrams,
    subagentDepth: subagentDepth > 0 ? subagentDepth : undefined,
    resumeReason: message.resumeReason,
    pending: !asyncQuestions && blockAnalysis.pending || undefined,
    fileEdits: cardFileEdits(message),
  }
}

function cardFileEdits(message: ThreadedMessage): FileEditStat[] | undefined {
  if (message.role !== 'assistant') return undefined
  const calls: Array<{ name: string; input: Record<string, unknown>; failed: boolean }> = []
  for (const block of message.blocks) {
    if (block.type !== 'tool_thread') continue
    calls.push({ name: block.toolUse.name, input: block.toolUse.input ?? {}, failed: block.result?.is_error === true })
  }
  if (calls.length === 0) return undefined
  const stats = fileEditStatsFromToolCalls(calls)
  return stats.length > 0 ? stats : undefined
}

// The caller must have validated unchanged message content, task context and
// turn duration. Only the collapsed conversation preview depends on density;
// share the expanded lines/code data between variants instead of rebuilding
// and retaining another copy of that content.
export function reformatTranscriptCardDensity(message: ThreadedMessage, density: TuiDensity, previous: TuiTranscriptCard, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCard {
  if (previous.images?.length) {
    const reformatted = formatTranscriptCard(message, density, activeForms, taskRegistry)
    return { ...previous, lines: reformatted.lines, compactSummary: reformatted.compactSummary }
  }
  if (previous.autoFold || previous.hasMermaidDiagrams) return previous
  const previewLines: TuiTranscriptCardLine[] = []
  for (const block of message.blocks) previewLines.push(...formatBlock(block, activeForms, taskRegistry))
  const lines = compactCardLines(previewLines, density)
  return { ...previous, lines, compactSummary: lines.map((entry) => entry.text).join(' · ') }
}

/** How a turn's elapsed time reads on a card; undefined when there is none to show. */
export function turnDurationLabel(durationMs: number | undefined): string | undefined {
  return durationMs != null && durationMs > 0 ? formatDurationMs(durationMs) : undefined
}

/**
 * The card for the same message whose turn now has a different elapsed time.
 * A turn's duration runs to its newest message, so while a turn streams every
 * card in it gets a new duration on each poll — and nothing else about those
 * cards has changed. The caller must have validated unchanged message content,
 * task context and density. Returns `previous` itself when the label reads the
 * same, so a sub-second step does not mint a new card.
 */
export function retimeTranscriptCard(previous: TuiTranscriptCard, durationMs?: number): TuiTranscriptCard {
  const durationLabel = turnDurationLabel(durationMs)
  return durationLabel === previous.durationLabel ? previous : { ...previous, durationLabel }
}

export function formatTranscriptCards(messages: ThreadedMessage[], density: TuiDensity = 'balanced'): TuiTranscriptCard[] {
  const { activeForms, taskRegistry } = buildTranscriptTaskContext(messages)
  const durations = computeTurnDurationsMs(messages)
  return messages.map((message) => formatTranscriptCard(message, density, activeForms, taskRegistry, durations.get(message.uuid)))
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

function formatBlockExpanded(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  const links = block.type === 'tool_thread'
    ? mcpResourceLinks(block.result?.resourceLinks, Array.isArray(block.result?.content) ? block.result.content : [])
    : block.type === 'claude_system' ? mcpResourceLinks(block.payload.resource_links) : []
  const content = [...formatBlockExpandedContent(block, activeForms, taskRegistry), ...mcpAppLines(block)]
  if (!links.length) return content
  return [...content, ...links.map(link => line(`artifact: ${sanitizeLine(link.title || link.name)} — ${link.uri}`, 'muted'))]
}

function formatBlockExpandedContent(block: ThreadedBlock, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  switch (block.type) {
    case 'text': {
      const protocolLines = textLinesForProtocolAwareBlock(block.text, true)
      if (protocolLines) return protocolLines
      return block.text.trim()
        ? sanitizeLine(readableContextText(block.text)).trim().split('\n').map((l) => line(l.trimEnd()))
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
        lines.push(...formatTodoChecklist(input))
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
    case 'coordinator_brief':
      return coordinatorBriefLines(block)
    case 'coordinator_mail':
      return coordinatorMailLines(block, true)
    case 'slash_command':
      return [line(truncateLine(`/${block.command.replace(/^\/+/, '')} ${block.args}`.trim()), 'tool')]
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
        const taskEndCause = claudeTaskEndCause(block.payload)
        const status = typeof block.payload.status === 'string'
          ? ` · ${block.payload.status}${taskEndCause ? ` (${taskEndCause})` : ''}`
          : ''
        return [
          line(`● ${text}${status}`, 'thinking'),
          ...claudeRuntimeDetailCardLines(block.payload),
        ]
      }
      if (block.subtype === 'model_refusal_no_fallback') {
        const model = typeof block.payload.original_model === 'string' ? block.payload.original_model : 'model'
        const category = typeof block.payload.api_refusal_category === 'string' ? block.payload.api_refusal_category : ''
        const explanation = typeof block.payload.api_refusal_explanation === 'string' ? block.payload.api_refusal_explanation.trim() : ''
        return [
          line(`refusal: ${model} refused, no fallback configured`, 'result_error'),
          ...(category ? [line(`  category: ${category}`, 'dim')] : []),
          ...(explanation ? [line(`  ${truncateLine(explanation)}`, 'dim')] : []),
        ]
      }
      if (block.subtype === 'worker_shutting_down') {
        const reason = typeof block.payload.reason === 'string' && block.payload.reason ? block.payload.reason : 'unknown'
        return [line(`worker shutting down`, 'result_error'), line(`  reason: ${reason}`, 'dim')]
      }
      if (block.subtype === 'conversation_reset') {
        const next = typeof block.payload.new_conversation_id === 'string' ? block.payload.new_conversation_id : ''
        const trigger = typeof block.payload.trigger === 'string' ? block.payload.trigger.replace(/_/g, ' ') : ''
        return [
          line(`conversation reset${trigger ? ` (${trigger})` : ''}`, 'system'),
          ...(next ? [line(`  continuing as ${next}`, 'dim')] : []),
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
        if (typeof info?.overageEnabled === 'boolean') lines.push(line(`  extra usage: ${info.overageEnabled ? 'enabled' : 'disabled'}`, 'dim'))
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
        // A first-byte timeout retries with error_status null (SDK 0.3.261);
        // name the cause rather than showing a retry with no reason.
        const noResponse = block.payload.no_response && typeof block.payload.no_response === 'object'
          ? block.payload.no_response as { waited_ms?: unknown }
          : null
        if (noResponse) {
          lines.push(line(typeof noResponse.waited_ms === 'number'
            ? `  no response in ${(noResponse.waited_ms / 1000).toFixed(1)}s`
            : '  no response', 'dim'))
        }
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
        const startupFailureHint = claudeStartupFailureHint(block.payload.startup_failure_reason)
        if (startupFailureHint) lines.push(line(`  fix: ${truncateLine(startupFailureHint)}`, 'system'))
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

/**
 * The whole transcript as plain text with every block expanded — what the
 * reader would show if every card were opened. It exists to hand the
 * conversation back to the terminal's own tools (a pager's search, an editor),
 * which cannot see anything drawn on the alternate screen.
 */
export function formatTranscriptExpandedText(messages: ThreadedMessage[]): string {
  const activeForms = buildTaskActiveForms(messages)
  const taskRegistry = buildTaskRegistry(messages)
  return messages.map((message) => {
    const role = message.role === 'assistant'
      ? getAssistantLabel(message.provider)
      : message.role.toUpperCase()
    const header = `── ${role}${message.timestamp ? ` · ${message.timestamp}` : ''}`
    const body = message.blocks
      .flatMap((b) => formatBlockExpanded(b, activeForms, taskRegistry))
      .map((ln) => ln.text)
    return [header, ...body, ''].join('\n')
  }).join('\n')
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

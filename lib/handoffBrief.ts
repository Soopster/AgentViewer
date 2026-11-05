import { computeAnalytics, fmtCost, fmtDuration, fmtNum } from './analytics'
import type { GitData } from './gitProvider'
import type { Session, ContentBlock, ToolUseBlock } from './types'
import type { ThreadedBlock, ThreadedMessage } from './threading'
import type { TuiSessionDetail } from './tui/service'

export type HandoffBriefInput = {
  session: Session | null
  detail: TuiSessionDetail | null
  git: GitData | null
  gitError?: string | null
  bookmarkIds: ReadonlySet<string>
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, max: number): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function firstLine(value: string): string {
  return value.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((entry) => contentText(entry))
      .filter((entry) => entry.length > 0)
      .join('\n')
      .trim()
  }
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const preferredKeys = ['text', 'thinking', 'stdout', 'content', 'summary', 'description', 'result', 'message', 'error']
  for (const key of preferredKeys) {
    const field = record[key]
    if (typeof field === 'string' && field.trim()) return field.trim()
  }
  return Object.values(record)
    .map((entry) => contentText(entry))
    .filter((entry) => entry.length > 0)
    .join('\n')
    .trim()
}

function blockText(block: ThreadedBlock): string {
  if (block.type === 'text') return block.text.trim()
  if (block.type === 'thinking') return block.thinking.trim()
  if (block.type === 'task_notification') return [block.summary, block.result].filter(Boolean).join(' ').trim()
  if (block.type === 'system_reminder') return block.content.trim()
  if (block.type === 'slash_command') return `/${block.command} ${block.args}`.trim()
  if (block.type === 'local_command_stdout') return block.stdout.trim()
  if (block.type === 'claude_system') {
    const payload = block.payload as Record<string, unknown>
    const summary = typeof payload.summary === 'string'
      ? payload.summary
      : typeof payload.description === 'string'
      ? payload.description
      : ''
    const error = typeof payload.error === 'string' ? payload.error : ''
    return [summary, error].filter(Boolean).join(' ').trim()
  }
  if (block.type === 'tool_thread') {
    const target = toolTarget(block.toolUse)
    const resultText = block.result ? contentText(block.result.content) : ''
    const resultLabel = block.result ? (block.result.is_error ? 'failed' : 'ok') : 'pending'
    return `tool ${block.toolUse.name}${target ? `: ${target}` : ''} (${resultLabel}${resultText ? `, ${truncate(resultText, 80)}` : ''})`
  }
  return ''
}

function toolTarget(toolUse: ToolUseBlock): string {
  const input = toolUse.input as Record<string, unknown>
  if (typeof input.file_path === 'string' && input.file_path.trim()) return input.file_path.trim()
  if (typeof input.command === 'string' && input.command.trim()) return input.command.trim()
  if (typeof input.path === 'string' && input.path.trim()) return input.path.trim()
  if (typeof input.pattern === 'string' && input.pattern.trim()) return input.pattern.trim()
  if (Array.isArray(input.edits) && input.edits.length > 0) {
    for (const edit of input.edits as Array<Record<string, unknown>>) {
      if (typeof edit.file_path === 'string' && edit.file_path.trim()) return edit.file_path.trim()
    }
  }
  return ''
}

function summarizeThread(message: ThreadedMessage): string {
  const collected: string[] = []
  for (const block of message.blocks) {
    const text = blockText(block)
    if (text) collected.push(text)
  }
  const joined = collected.join('\n').trim()
  return firstLine(joined) || truncate(joined, 160) || `${message.role} message`
}

function summarizeLatestAssistant(messages: ThreadedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'assistant') continue
    const text = message.blocks
      .map((block) => blockText(block))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return truncate(firstLine(text) || text, 220)
  }
  return 'No assistant response recorded.'
}

function countByStatus(git: GitData | null): { staged: number; unstaged: number; untracked: number } {
  if (!git) return { staged: 0, unstaged: 0, untracked: 0 }
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const entry of git.status) {
    if (entry.x === '?' && entry.y === '?') {
      untracked += 1
      continue
    }
    if (entry.x !== ' ') staged += 1
    if (entry.y !== ' ') unstaged += 1
  }
  return { staged, unstaged, untracked }
}

function formatStatus(entry: GitData['status'][number]): string {
  if (entry.x === '?' && entry.y === '?') return 'untracked'
  const code = `${entry.x}${entry.y}`.trim()
  return code || 'modified'
}

function collectCommands(messages: ThreadedMessage[]): Array<{ command: string; result: string; isError: boolean }> {
  const commands: Array<{ command: string; result: string; isError: boolean }> = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== 'tool_thread') continue
      const name = block.toolUse.name.toLowerCase()
      if (name !== 'bash' && name !== 'shell' && name !== 'command') continue
      const input = block.toolUse.input as Record<string, unknown>
      const command = typeof input.command === 'string'
        ? input.command.trim()
        : Array.isArray(input.command)
        ? input.command.map((part) => String(part)).join(' ').trim()
        : ''
      if (!command) continue
      commands.push({
        command,
        result: block.result ? truncate(contentText(block.result.content) || (block.result.is_error ? 'failed' : 'ok'), 120) : 'pending',
        isError: block.result?.is_error === true,
      })
    }
  }
  return commands
}

function collectFailures(messages: ThreadedMessage[]): string[] {
  const failures: string[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== 'tool_thread') continue
      if (block.result?.is_error !== true) continue
      const summary = truncate(blockText(block), 160)
      const result = truncate(contentText(block.result.content) || 'failed', 160)
      failures.push(`- ${summary}${result ? ` - ${result}` : ''}`)
    }
  }
  return failures
}

function collectFileChanges(analyticsFiles: Map<string, number>, git: GitData | null): Array<{ path: string; detail: string }> {
  const entries = new Map<string, { count: number; status?: string }>()
  for (const [path, count] of analyticsFiles.entries()) {
    entries.set(path, { count })
  }
  if (git) {
    for (const entry of git.status) {
      const current = entries.get(entry.path) ?? { count: 0 }
      current.status = formatStatus(entry)
      entries.set(entry.path, current)
    }
  }
  return [...entries.entries()]
    .map(([path, value]) => ({
      path,
      detail: [
        value.status ? value.status : null,
        value.count > 0 ? `${value.count} edit${value.count === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => {
      const aCount = analyticsFiles.get(a.path) ?? 0
      const bCount = analyticsFiles.get(b.path) ?? 0
      if (bCount !== aCount) return bCount - aCount
      return a.path.localeCompare(b.path)
    })
}

function collectBookmarks(messages: ThreadedMessage[], bookmarkIds: ReadonlySet<string>): Array<{ label: string; preview: string }> {
  const out: Array<{ label: string; preview: string }> = []
  for (const message of messages) {
    if (!bookmarkIds.has(message.uuid)) continue
    out.push({
      label: message.role === 'assistant' ? 'assistant checkpoint' : message.role === 'user' ? 'user checkpoint' : 'system checkpoint',
      preview: truncate(summarizeThread(message), 180),
    })
  }
  return out
}

export function buildHandoffBriefMarkdown(input: HandoffBriefInput): string {
  const session = input.session
  const detail = input.detail
  const info = detail?.info ?? null
  const messages = detail?.threadedMessages ?? []
  const analytics = computeAnalytics(detail ? { info, threadedMessages: detail.threadedMessages, rawMessages: detail.rawMessages } : null)
  const provider = info?.provider ?? session?.provider ?? 'claude'
  const title = info?.customTitle ?? info?.summary ?? session?.customTitle ?? session?.summary ?? 'Untitled session'
  const cwd = info?.cwd ?? session?.cwd ?? '(unknown cwd)'
  const branch = input.git?.branch ?? info?.gitBranch ?? '(no git branch)'
  const model = info?.currentModel ?? analytics.model ?? 'unknown'
  const duration = fmtDuration(analytics.durationMs)
  const totalTokens = fmtNum(analytics.totalTokens)
  const cost = fmtCost(analytics.cost)
  const statusCounts = countByStatus(input.git)
  const latestOutcome = summarizeLatestAssistant(messages)
  const commands = collectCommands(messages)
  const failures = collectFailures(messages)
  const fileChanges = collectFileChanges(analytics.ops.editsByFile, input.git)
  const bookmarks = collectBookmarks(messages, input.bookmarkIds)

  const lines: string[] = []
  lines.push('# Handoff Brief')
  lines.push('')
  lines.push('## Session')
  lines.push(`- Provider: \`${provider}\``)
  lines.push(`- Title: \`${truncate(title, 96)}\``)
  lines.push(`- CWD: \`${truncate(cwd, 120)}\``)
  lines.push(`- Model: \`${truncate(model, 80)}\``)
  if (info?.firstPrompt) lines.push(`- Prompt: ${truncate(info.firstPrompt, 140)}`)
  lines.push(`- Activity: \`${analytics.messages}\` messages, \`${analytics.toolUses}\` tool uses, \`${analytics.toolErrors}\` tool errors, \`${duration}\`, \`${totalTokens}\` tokens, \`${cost}\``)
  lines.push(`- Git: \`${branch}\`${input.git?.upstream ? ` tracking \`${truncate(input.git.upstream, 80)}\` ↑${input.git.ahead} ↓${input.git.behind}` : ''}`)
  if (input.gitError) {
    lines.push(`- Git status: unavailable (${truncate(input.gitError, 120)})`)
  }
  if (input.git) {
    lines.push(`- Working tree: \`${input.git.status.length}\` changed, \`${statusCounts.staged}\` staged, \`${statusCounts.unstaged}\` unstaged, \`${statusCounts.untracked}\` untracked`)
  }

  lines.push('')
  lines.push('## Outcome')
  lines.push(`> ${latestOutcome}`)

  if (fileChanges.length > 0) {
    lines.push('')
    lines.push('## Changed Files')
    for (const entry of fileChanges.slice(0, 8)) {
      lines.push(`- \`${truncate(entry.path, 96)}\`${entry.detail ? ` - ${entry.detail}` : ''}`)
    }
  }

  if (commands.length > 0) {
    lines.push('')
    lines.push('## Commands / Tests')
    for (const entry of commands.slice(-6)) {
      const tag = /(^|\s)(test|vitest|jest|pytest|cargo test|go test|bun test|npm test|pnpm test|yarn test)(\s|$)/i.test(entry.command)
        ? 'test'
        : 'cmd'
      lines.push(`- \`${truncate(entry.command, 140)}\` (${tag}${entry.isError ? ', failed' : ''})${entry.result ? ` - ${entry.result}` : ''}`)
    }
  }

  if (failures.length > 0) {
    lines.push('')
    lines.push('## Risks / Blockers')
    for (const failure of failures.slice(0, 5)) lines.push(failure)
  }

  if (bookmarks.length > 0) {
    lines.push('')
    lines.push('## Bookmarks')
    for (const bookmark of bookmarks.slice(0, 5)) {
      lines.push(`- ${bookmark.label}: ${bookmark.preview}`)
    }
  }

  lines.push('')
  lines.push('## Next Step')
  if (failures.length > 0) {
    lines.push('- Re-run the failed command(s), inspect the changed files above, and clear the blockers before handing off.')
  } else if (fileChanges.length > 0) {
    lines.push('- Review the changed files and confirm the diff matches the intent before you hand this off or commit.')
  } else {
    lines.push('- Continue from the last checkpoint and capture any missing validation if the work is still in progress.')
  }

  return lines.join('\n')
}

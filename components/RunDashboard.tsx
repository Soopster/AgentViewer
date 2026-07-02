'use client'

import { memo, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FolderGit2,
  GitBranch,
  PlayCircle,
  Search,
  TimerReset,
  Wrench,
} from 'lucide-react'
import type { AgentProvider, ApiMessage, ContentBlock, Session, SessionMessage, ToolResultBlock, ToolUseBlock } from '@/lib/types'
import { getAssistantLabel } from '@/lib/provider'
import { pathBasename } from '@/lib/projectPaths'
import { cn } from '@/lib/utils'

type RunStatus = 'active' | 'paused' | 'failed' | 'recent'

type RunDashboardProps = {
  sessions: Session[]
  selectedSession: Session | null
  messages: SessionMessage[]
  loading: boolean
  providerLabel: string
  scopeLabel: string | null
  onSelectSession: (session: Session) => void
}

type DashboardRow = {
  key: string
  session: Session
  title: string
  provider: AgentProvider
  status: RunStatus
  statusReason: string
  currentTool: string
  elapsed: string
  tokens: string
  cost: string
  branch: string
  worktree: string
  dirty: string
  push: string
  lastEvent: string
  lastActiveMs: number
  issueCount: number
}

const STATUS_META: Record<RunStatus, { label: string; color: string; icon: typeof PlayCircle }> = {
  active: { label: 'Active', color: 'var(--green)', icon: PlayCircle },
  paused: { label: 'Paused', color: 'var(--amber)', icon: TimerReset },
  failed: { label: 'Failed', color: 'var(--red)', icon: AlertTriangle },
  recent: { label: 'Recent', color: 'var(--cyan)', icon: CheckCircle2 },
}

function sessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function titleForSession(session: Session): string {
  return session.customTitle || session.summary || session.firstPrompt || session.sessionId
}

function timestampMs(value?: string | number): number {
  if (value == null) return 0
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatAge(ms: number): string {
  if (ms <= 0) return 'unknown'
  const delta = Math.max(Date.now() - ms, 0)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatElapsed(startMs: number, endMs: number): string {
  if (!startMs || !endMs || endMs < startMs) return 'n/a'
  const minutes = Math.max(1, Math.round((endMs - startMs) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => {
    if (!block || typeof block !== 'object') return ''
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
    if (record.type === 'thinking' && typeof record.thinking === 'string') return record.thinking
    if (record.type === 'tool_use' && typeof record.name === 'string') return record.name
    return ''
  }).filter(Boolean).join(' ')
}

function contentBlocks(message: SessionMessage): ContentBlock[] {
  const content = 'content' in message.message ? message.message.content : undefined
  return Array.isArray(content) ? content : []
}

function apiUsage(message: SessionMessage): ApiMessage['usage'] | undefined {
  const payload = message.message
  if ('role' in payload && (payload.role === 'user' || payload.role === 'assistant')) {
    return (payload as ApiMessage).usage
  }
  return undefined
}

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use' && typeof (block as ToolUseBlock).name === 'string'
}

function isToolResult(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result' && typeof (block as ToolResultBlock).tool_use_id === 'string'
}

function summarizeToolInput(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'query', 'pattern', 'url', 'description']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim().slice(0, 90)
  }
  return ''
}

function activeMessageStats(messages: SessionMessage[]) {
  let currentTool = ''
  let lastEvent = ''
  let issueCount = 0
  let tokens = 0

  for (const message of messages) {
    const usage = apiUsage(message)
    if (usage) {
      tokens += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    }
    const text = textFromContent('content' in message.message ? message.message.content : undefined)
    if (text.trim()) lastEvent = text.replace(/\s+/g, ' ').trim().slice(0, 180)
    for (const block of contentBlocks(message)) {
      if (isToolUse(block)) {
        currentTool = summarizeToolInput(block.input) ? `${block.name} · ${summarizeToolInput(block.input)}` : block.name
      } else if (isToolResult(block) && block.is_error) {
        issueCount += 1
      }
    }
  }

  return {
    currentTool: currentTool || 'idle',
    lastEvent,
    issueCount,
    tokens,
  }
}

function sessionMetaString(session: Session, keys: string[]): string {
  for (const key of keys) {
    const value = session[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function statusForSession(session: Session, active: boolean, issueCount: number, lastActiveMs: number): { status: RunStatus; reason: string } {
  if (issueCount > 0) return { status: 'failed', reason: `${issueCount} tool issue${issueCount === 1 ? '' : 's'}` }
  if (session.isPending) return { status: 'paused', reason: 'pending first turn' }
  if (active || Date.now() - lastActiveMs < 5 * 60_000) return { status: 'active', reason: active ? 'open in pane' : 'recent activity' }
  if (Date.now() - lastActiveMs > 24 * 60 * 60_000) return { status: 'paused', reason: 'idle over 24h' }
  return { status: 'recent', reason: 'completed recently' }
}

function buildRows(sessions: Session[], selectedSession: Session | null, messages: SessionMessage[]): DashboardRow[] {
  const selectedKey = selectedSession ? sessionKey(selectedSession) : ''
  const selectedStats = activeMessageStats(messages)

  return sessions.map((session) => {
    const key = sessionKey(session)
    const isSelected = key === selectedKey
    const lastActiveMs = timestampMs(session.lastModified ?? session.createdAt)
    const createdMs = timestampMs(session.createdAt) || lastActiveMs
    const stats = isSelected ? selectedStats : { currentTool: 'unknown', lastEvent: '', issueCount: 0, tokens: 0 }
    const issueCount = stats.issueCount
    const status = statusForSession(session, isSelected && messages.length > 0, issueCount, lastActiveMs)
    const provider = session.provider ?? 'claude'
    const ahead = sessionMetaString(session, ['ahead', 'gitAhead'])
    const behind = sessionMetaString(session, ['behind', 'gitBehind'])
    const dirty = sessionMetaString(session, ['dirtyFiles', 'changedFiles', 'statusCount'])
    const branch = sessionMetaString(session, ['gitBranch', 'branch']) || 'unknown'

    return {
      key,
      session,
      title: titleForSession(session),
      provider,
      status: status.status,
      statusReason: status.reason,
      currentTool: stats.currentTool,
      elapsed: formatElapsed(createdMs, lastActiveMs),
      tokens: stats.tokens > 0 ? compactNumber(stats.tokens) : 'n/a',
      cost: stats.tokens > 0 ? 'tokens only' : 'n/a',
      branch,
      worktree: session.cwd ? pathBasename(session.cwd) || session.cwd : 'unknown',
      dirty: dirty || 'unknown',
      push: ahead || behind ? `↑${ahead || 0} ↓${behind || 0}` : 'unknown',
      lastEvent: stats.lastEvent || session.summary || session.firstPrompt || 'No event preview available',
      lastActiveMs,
      issueCount,
    }
  }).sort((a, b) => {
    const order: Record<RunStatus, number> = { active: 0, failed: 1, paused: 2, recent: 3 }
    return order[a.status] - order[b.status] || b.lastActiveMs - a.lastActiveMs
  })
}

function providerTone(provider: AgentProvider): string {
  if (provider === 'codex') return 'var(--green)'
  if (provider === 'opencode') return 'var(--cyan)'
  if (provider === 'copilot') return 'var(--violet)'
  if (provider === 'pi') return 'var(--amber)'
  return 'var(--text)'
}

function StatusBadge({ status, reason }: { status: RunStatus; reason: string }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className="av-run-status" style={{ '--av-run-status': meta.color } as CSSProperties} title={reason}>
      <Icon aria-hidden="true" />
      {meta.label}
    </span>
  )
}

const RunRow = memo(function RunRow({
  row,
  selected,
  onSelectSession,
}: {
  row: DashboardRow
  selected: boolean
  onSelectSession: (session: Session) => void
}) {
  return (
    <button
      type="button"
      className={cn('av-run-row', selected && 'av-selected', row.status === 'failed' && 'av-failed')}
      onClick={() => onSelectSession(row.session)}
    >
      <span className="av-run-main">
        <span className="av-run-title-line">
          <StatusBadge status={row.status} reason={row.statusReason} />
          <strong title={row.title}>{row.title}</strong>
          <em style={{ color: providerTone(row.provider) }}>{getAssistantLabel(row.provider)}</em>
        </span>
        <span className="av-run-cause" title={row.statusReason}>
          <CircleHelp aria-hidden="true" />
          Why? {row.statusReason}
        </span>
        <span className="av-run-last" title={row.lastEvent}>{row.lastEvent}</span>
      </span>
      <span className="av-run-cell av-run-tool" title={row.currentTool}>
        <Wrench aria-hidden="true" />
        {row.currentTool}
      </span>
      <span className="av-run-cell av-run-worktree" title={row.session.cwd || row.worktree}>
        <FolderGit2 aria-hidden="true" />
        {row.worktree}
      </span>
      <span className="av-run-cell av-run-branch">
        <GitBranch aria-hidden="true" />
        {row.branch}
      </span>
      <span className="av-run-metrics">
        <span title="Elapsed time"><Clock3 aria-hidden="true" />{row.elapsed}</span>
        <span title="Token estimate">{row.tokens}</span>
        <span title="Cost estimate">{row.cost}</span>
        <span title="Push status">{row.push}</span>
      </span>
      <span className="av-run-age">{formatAge(row.lastActiveMs)}</span>
    </button>
  )
})

export default function RunDashboard({
  sessions,
  selectedSession,
  messages,
  loading,
  providerLabel,
  scopeLabel,
  onSelectSession,
}: RunDashboardProps) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => buildRows(sessions, selectedSession, messages), [messages, selectedSession, sessions])
  const normalizedQuery = query.trim().toLowerCase()
  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return rows
    return rows.filter((row) => [
      row.title,
      row.provider,
      row.status,
      row.currentTool,
      row.worktree,
      row.branch,
      row.lastEvent,
    ].join(' ').toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, rows])
  const stats = useMemo(() => rows.reduce((acc, row) => {
    acc[row.status] += 1
    return acc
  }, { active: 0, paused: 0, failed: 0, recent: 0 } as Record<RunStatus, number>), [rows])
  const selectedKey = selectedSession ? sessionKey(selectedSession) : ''

  return (
    <main className="av-run-dashboard">
      <header className="av-run-header">
        <div>
          <h1>
            <PlayCircle aria-hidden="true" />
            Run Dashboard
          </h1>
          <p>{providerLabel.toUpperCase()} / {scopeLabel ?? 'all projects'} / {rows.length} sessions</p>
        </div>
        <div className="av-run-statbar">
          {(['active', 'failed', 'paused', 'recent'] as const).map((status) => {
            const meta = STATUS_META[status]
            return (
              <span key={status} style={{ '--av-run-status': meta.color } as CSSProperties}>
                {meta.label}
                <b>{stats[status]}</b>
              </span>
            )
          })}
        </div>
      </header>

      <section className="av-run-toolbar">
        <label>
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs, tools, branches, worktrees..." />
        </label>
        <span>{loading ? 'refreshing...' : `${filteredRows.length} shown`}</span>
      </section>

      <section className="av-run-table" aria-label="Run dashboard">
        <div className="av-run-table-head" aria-hidden="true">
          <span>Run</span>
          <span>Current Tool</span>
          <span>Worktree</span>
          <span>Branch</span>
          <span>Telemetry</span>
          <span>Last</span>
        </div>
        {filteredRows.length === 0 ? (
          <div className="av-run-empty">No runs match the current filter.</div>
        ) : filteredRows.map((row) => (
          <RunRow
            key={row.key}
            row={row}
            selected={row.key === selectedKey}
            onSelectSession={onSelectSession}
          />
        ))}
      </section>
    </main>
  )
}

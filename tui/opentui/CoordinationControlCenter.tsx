/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import type { AgentProtocolEvent, ProtocolAgent, ProtocolRun, ProtocolRunSnapshot, ProtocolTask } from '../../lib/agentProtocol'
import type { WorktreeTask } from '../../lib/tui/service'
import { getProviderAccent, type TuiThemePalette } from '../theme'

export type ControlCenterSection = 'overview' | 'team' | 'tasks' | 'events'

type FleetSummary = {
  agents: number
  working: number
  queued: number
  attention: number
  providers: ReadonlyMap<string, number>
}

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  runs: ProtocolRun[]
  runId: string | null
  snapshot: ProtocolRunSnapshot | null
  fleetSnapshots: ReadonlyMap<string, ProtocolRunSnapshot>
  filteredTasks: ProtocolTask[]
  filteredEvents: AgentProtocolEvent[]
  fleet: FleetSummary
  worktreeStats: Map<string, WorktreeTask>
  section: ControlCenterSection
  selectedTask: ProtocolTask | null
  inspectedAgent: ProtocolAgent | null
  selectedEvent: AgentProtocolEvent | null
  selectedLocks: ProtocolRunSnapshot['locks']
  taskFilter: string
  eventFilter: string
  selectedTaskPlanState?: 'awaiting' | 'approved' | 'rejected'
  canCopyJoinCommand: boolean
  now: number
  busy: boolean
  loadError: string | null
  messageTarget: string | null
  messageDraft: string
  pendingLabel: string | null
  onMessageDraft: (value: string) => void
  onSubmitMessage: () => void
  // Mouse navigation. Clicking a pane focuses it, clicking a row selects that
  // row, and the wheel moves the selection within a pane — the same operations
  // the keyboard offers, so neither input mode is second-class.
  onFocusSection?: (section: ControlCenterSection) => void
  onSelectRun?: (runId: string) => void
  onSelectTask?: (taskId: string) => void
  onSelectAgent?: (agentId: string) => void
  onSelectEvent?: (eventIndex: number) => void
  onEventFilter?: (filter: 'all' | 'attention' | 'messages' | 'tasks') => void
  onScrollSection?: (section: ControlCenterSection, delta: number) => void
  onActivateSelection?: (section: ControlCenterSection) => void
}

const PROVIDERS = ['codex', 'claude', 'copilot', 'opencode', 'pi'] as const
const ACTIVE_TASKS = new Set(['claimed', 'planning', 'planned', 'in_progress'])
const TERMINAL_TASKS = new Set(['completed', 'failed', 'cancelled'])
const ATTENTION_EVENTS = new Set(['agent.blocked', 'task.failed', 'lock.denied', 'plan.rejected', 'review.requested', 'phase.reported', 'phase.rejected', 'decision.raised', 'model.drift'])
const STUCK_AGENT_STATUSES = new Set(['blocked', 'failed', 'stopped'])
const ERROR_EVENT_TYPES = new Set(['task.failed', 'agent.blocked'])
const LIVE_AGENT_STATUSES = new Set(['ready', 'idle', 'working', 'blocked'])
const DETAIL_BODY_ROWS = 2
const AGENT_FRESH_MS = 90_000
const AGENT_DEAD_MS = 5 * 60_000

type AgentLiveness = 'fresh' | 'stale' | 'dead'
type EventClass = 'message' | 'finding' | 'task' | 'lock' | 'plan' | 'run'

function paneNumber(section: ControlCenterSection): number {
  return section === 'overview' ? 1 : section === 'tasks' ? 2 : section === 'team' ? 3 : 4
}

function fit(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Word-wrap into exactly `maxLines` cells-wide lines, each padded to `width`.
 *
 * The detail body used a single `<text wrapMode="word">`, whose wrap path does
 * not write the cell a space occupies — so wherever a space fell, the previous
 * frame's glyph survived and the summary rendered as
 * "ReclaimedTtask-3aafterhcc-transcript's", stitched together with leftovers
 * from the coloured agent names drawn above. Emitting pre-wrapped, space-padded
 * lines writes every cell every frame, and also keeps the body inside the
 * region's fixed height instead of silently overflowing it.
 */
function wrapPadded(text: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return []
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= width) { current = candidate; continue }
    if (current) lines.push(current)
    if (lines.length >= maxLines) break
    // A single word longer than the region: hard-split rather than drop it.
    current = word.length <= width ? word : word.slice(0, width)
  }
  if (current && lines.length < maxLines) lines.push(current)
  const clipped = lines.slice(0, maxLines)
  if (lines.length > maxLines || (clipped.length === maxLines && words.length > 0)) {
    const last = clipped[maxLines - 1]
    if (last && last.length === width && text.replace(/\s+/g, ' ').trim().length > clipped.join(' ').length) {
      clipped[maxLines - 1] = `${last.slice(0, Math.max(width - 1, 0))}…`
    }
  }
  // Always return exactly `maxLines`: a shorter body must still write the rows a
  // longer one occupied last frame, otherwise the old text stays on screen.
  while (clipped.length < maxLines) clipped.push('')
  return clipped.map((line) => line.padEnd(width, ' '))
}

function age(iso: string | undefined, now: number): string {
  if (!iso) return '—'
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

function clock(iso: string | undefined): string {
  if (!iso) return '--:--:--'
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? '--:--:--' : parsed.toLocaleTimeString('en-GB', { hour12: false })
}

function elapsed(startIso: string | undefined, end: number | string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const finish = typeof end === 'number' ? end : new Date(end).getTime()
  const seconds = Math.max(0, Math.floor((finish - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

function activitySparkline(events: AgentProtocolEvent[], width: number): string {
  const safeWidth = Math.max(width, 1)
  if (events.length === 0) return '·'.repeat(safeWidth)
  const stamps = events.map((event) => new Date(event.timestamp ?? 0).getTime()).filter(Number.isFinite)
  if (stamps.length === 0) return '▁'.repeat(safeWidth)
  const start = Math.min(...stamps)
  const span = Math.max(Math.max(...stamps) - start, 1)
  const buckets = Array.from({ length: safeWidth }, () => 0)
  for (const stamp of stamps) {
    const index = Math.min(safeWidth - 1, Math.floor(((stamp - start) / span) * safeWidth))
    buckets[index] += 1
  }
  const peak = Math.max(...buckets, 1)
  const bars = '▁▂▃▄▅▆▇█'
  return buckets.map((value) => bars[Math.round((value / peak) * (bars.length - 1))]).join('')
}

function runTitle(run: ProtocolRun): string {
  return run.prompt.split('\n')[0]?.trim() || run.id
}

function visibleWorkflowGroup(runs: ProtocolRun[], selectedRunId: string | null, limit = 4): ProtocolRun[] {
  return visibleWindow(runs, runs.findIndex((run) => run.id === selectedRunId), limit)
}

function visibleWindow<T>(items: T[], selectedIndex: number, limit: number): T[] {
  if (items.length <= limit) return items
  if (selectedIndex < 0) return items.slice(0, limit)
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(limit / 2), items.length - limit))
  return items.slice(start, start + limit)
}

function taskStage(task: ProtocolTask): 'queued' | 'active' | 'verify' {
  const phase = task.phase?.trim().toLowerCase()
  if (phase === 'queued' || phase === 'active' || phase === 'verify') return phase
  if (task.status === 'pending') return 'queued'
  return TERMINAL_TASKS.has(task.status) || task.status === 'blocked' ? 'verify' : 'active'
}

function taskMarker(task: ProtocolTask): string {
  if (task.status === 'completed') return '[x]'
  if (task.status === 'failed' || task.status === 'blocked') return '[!]'
  if (task.status === 'cancelled') return '[-]'
  return ACTIVE_TASKS.has(task.status) ? '[>]' : '[ ]'
}

function workflowTone(run: ProtocolRun, theme: TuiThemePalette): string {
  if (run.status === 'completed') return theme.green
  if (run.status === 'failed' || run.status === 'blocked') return theme.red
  if (run.status === 'running' || run.status === 'synthesizing') return theme.green
  return theme.dim
}

function taskTone(task: ProtocolTask, theme: TuiThemePalette): string {
  if (task.status === 'completed') return theme.green
  if (task.status === 'failed' || task.status === 'blocked') return theme.red
  if (ACTIVE_TASKS.has(task.status)) return theme.cyan
  return theme.dim
}

function agentLiveness(agent: ProtocolAgent, now: number): AgentLiveness {
  if (agent.turnActive) return 'fresh'
  if (!agent.lastSeenAt) return 'dead'
  const heartbeatAge = Math.max(0, now - new Date(agent.lastSeenAt).getTime())
  if (heartbeatAge <= AGENT_FRESH_MS) return 'fresh'
  return heartbeatAge <= AGENT_DEAD_MS ? 'stale' : 'dead'
}

function eventClass(event: AgentProtocolEvent): EventClass {
  if (event.type === 'message' || event.type === 'handoff') return 'message'
  if (event.type === 'finding' || event.type === 'learning') return 'finding'
  if (event.type.startsWith('task.') || event.type.startsWith('agent.') || event.type === 'review.requested' || event.type === 'shutdown.requested') return 'task'
  if (event.type.startsWith('lock.')) return 'lock'
  if (event.type.startsWith('plan.')) return 'plan'
  return 'run'
}

function eventClassLabel(category: EventClass): string {
  return category === 'message' ? 'MSG' : category === 'finding' ? 'FIND' : category.toUpperCase()
}

function eventTone(event: AgentProtocolEvent, theme: TuiThemePalette): string {
  if (event.type === 'task.failed' || event.type === 'plan.rejected') return theme.red
  if (ATTENTION_EVENTS.has(event.type)) return theme.amber
  const category = eventClass(event)
  if (category === 'message') return theme.violet
  if (category === 'finding' || event.type === 'task.completed' || event.type === 'plan.approved') return theme.green
  if (category === 'lock' || category === 'plan') return theme.amber
  if (category === 'run') return theme.pink
  return theme.cyan
}

function lockPathsOverlap(left: string, right: string): boolean {
  if (left === '**' || right === '**') return true
  const normalize = (value: string) => value.replace(/\/\*\*?$/, '').replace(/\/+$/, '')
  const a = normalize(left)
  const b = normalize(right)
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function CoordinationControlCenter({
  theme,
  width,
  height,
  runs,
  runId,
  snapshot,
  fleetSnapshots,
  filteredTasks,
  filteredEvents,
  fleet,
  worktreeStats,
  section,
  selectedTask,
  inspectedAgent,
  selectedEvent,
  selectedLocks,
  taskFilter,
  eventFilter,
  selectedTaskPlanState,
  canCopyJoinCommand,
  now,
  busy,
  loadError,
  messageTarget,
  messageDraft,
  pendingLabel,
  onMessageDraft,
  onSubmitMessage,
  onFocusSection,
  onSelectRun,
  onSelectTask,
  onSelectAgent,
  onSelectEvent,
  onEventFilter,
  onScrollSection,
  onActivateSelection,
}: Props) {
  const popW = Math.max(width - 2, 1)
  const popH = Math.max(height - 2, 1)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = Math.max(popW - 2, 1)
  const headerH = 3
  const metricsH = 4
  const promptH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - metricsH - promptH - footerH - 2, 8)
  const leftW = Math.max(24, Math.floor(innerW * 0.27))
  const rightW = Math.max(31, Math.floor(innerW * 0.29))
  const centerW = Math.max(innerW - leftW - rightW - 2, 20)
  // Keep enough room below for Live Activity's fixed detail region. The
  // inspector has a deliberately reduced compact layout at this height.
  const inspectorH = 12
  const showProviderHealth = innerW >= 165
  const showTaskColumns = centerW >= 58
  const showInspectorDetails = rightW >= 40 && inspectorH >= 20
  const showActivityColumns = rightW >= 40
  const run = snapshot?.run ?? null
  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const locks = snapshot?.locks ?? []
  const messages = snapshot?.messages ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const taskDependentsById = useMemo(() => {
    const dependents = new Map<string, string[]>()
    for (const task of tasks) {
      for (const dependencyId of task.blockedBy) {
        const current = dependents.get(dependencyId)
        if (current) current.push(task.id)
        else dependents.set(dependencyId, [task.id])
      }
    }
    return dependents
  }, [tasks])
  const taskBlockReasonById = useMemo(() => {
    const reasons = new Map<string, string>()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (!event.taskId || reasons.has(event.taskId)) continue
      if (event.type === 'agent.blocked' || event.type === 'task.failed' || event.type === 'plan.rejected' || event.type === 'lock.denied') {
        reasons.set(event.taskId, event.detail ?? event.summary ?? event.type)
      }
    }
    return reasons
  }, [events])
  const taskLockContentionById = useMemo(() => {
    const contention = new Map<string, string[]>()
    const active = locks.filter((lock) => lock.status === 'active')
    for (const denied of locks) {
      if (denied.status !== 'denied' || !denied.taskId) continue
      const holders = active.filter((lock) => lock.agentId !== denied.agentId && lockPathsOverlap(lock.path, denied.path))
      const labels = holders.length > 0
        ? holders.map((lock) => `${lock.path}:${agentsById.get(lock.agentId)?.name ?? lock.agentId}`)
        : [`${denied.path}:denied`]
      const current = contention.get(denied.taskId)
      if (current) current.push(...labels)
      else contention.set(denied.taskId, labels)
    }
    return contention
  }, [agentsById, locks])
  const snapshotsById = useMemo(() => {
    const combined = new Map(fleetSnapshots)
    if (run && snapshot) combined.set(run.id, snapshot)
    return combined
  }, [fleetSnapshots, run, snapshot])
  const groupedRuns = useMemo(() => [
    { label: 'NEEDS ATTENTION', runs: runs.filter((entry) => entry.status === 'blocked' || entry.status === 'failed') },
    { label: 'RUNNING', runs: runs.filter((entry) => ['planning', 'running', 'synthesizing'].includes(entry.status)) },
    { label: 'RECENT', runs: runs.filter((entry) => ['completed', 'stopped'].includes(entry.status)) },
  ], [runs])
  const stagedTasks = useMemo(() => ({
    queued: filteredTasks.filter((task) => taskStage(task) === 'queued'),
    active: filteredTasks.filter((task) => taskStage(task) === 'active'),
    verify: filteredTasks.filter((task) => taskStage(task) === 'verify'),
  }), [filteredTasks])
  const activityFooterH = 1
  // border-top (1) + the DETAIL header (1) + DETAIL_BODY_ROWS. Sized so the
  // header and a two-line body both fit: at 3 the body's second line had no row
  // to live in, so it overlapped the header — the header vanished and its
  // coloured glyphs bled through the body text ("SupervisionGcheckpoint").
  const activityDetailH = 2 + DETAIL_BODY_ROWS
  const eventRows = Math.max(bodyH - inspectorH - activityDetailH - 7, 3)
  const selectedEventIndex = selectedEvent ? filteredEvents.indexOf(selectedEvent) : filteredEvents.length - 1
  const visibleEvents = visibleWindow(filteredEvents, selectedEventIndex, eventRows)
  const latestAgentEvent = inspectedAgent ? [...events].reverse().find((event) => event.agentId === inspectedAgent.id) : undefined
  const agentErrorEvent = inspectedAgent && STUCK_AGENT_STATUSES.has(inspectedAgent.status)
    ? [...events].reverse().find((event) => event.agentId === inspectedAgent.id && ERROR_EVENT_TYPES.has(event.type))
    : undefined
  const inspectedTask = inspectedAgent
    ? (inspectedAgent.taskId ? taskById.get(inspectedAgent.taskId) : undefined)
      ?? tasks.find((task) => task.ownerAgentId === inspectedAgent.id && ACTIVE_TASKS.has(task.status))
      ?? tasks.find((task) => task.ownerAgentId === inspectedAgent.id)
    : undefined
  const topologyAgents = useMemo(() => [
    ...agents.filter((agent) => agent.role === 'lead'),
    ...agents.filter((agent) => agent.role !== 'lead'),
  ], [agents])
  const messageMetaByEvent = useMemo(() => {
    const buckets = new Map<string, ProtocolRunSnapshot['messages']>()
    for (const message of messages) {
      const key = `${message.fromAgentId}\u0000${message.body}`
      const current = buckets.get(key)
      if (current) current.push(message)
      else buckets.set(key, [message])
    }
    const byEvent = new Map<AgentProtocolEvent, {
      kind: ProtocolRunSnapshot['messages'][number]['kind']
      replyRequired: boolean
      unanswered: boolean
      recipient: string
      body: string
    }>()
    for (const event of events) {
      if (event.type !== 'message') continue
      const candidates = buckets.get(`${event.agentId}\u0000${event.summary ?? ''}`) ?? []
      const exact = candidates.filter((message) => message.createdAt === event.timestamp)
      const matching = exact.length > 0 ? exact : candidates
      if (matching.length === 0) continue
      const target = event.to && ['all', 'lead'].includes(event.to)
        ? event.to
        : [...new Set(matching.map((message) => agentsById.get(message.toAgentId)?.name ?? message.toAgentId))].join(',')
      byEvent.set(event, {
        kind: matching[0].kind,
        replyRequired: matching.some((message) => message.replyRequired),
        unanswered: matching.some((message) => message.replyRequired && !message.resolvedAt),
        recipient: target,
        body: matching[0].body,
      })
    }
    return byEvent
  }, [agentsById, events, messages])
  const inspectedMessages = useMemo(() => inspectedAgent
    ? messages.filter((message) => message.fromAgentId === inspectedAgent.id || message.toAgentId === inspectedAgent.id)
    : [], [inspectedAgent, messages])
  const inspectedTasks = useMemo(() => inspectedAgent
    ? tasks.filter((task) => task.ownerAgentId === inspectedAgent.id)
    : [], [inspectedAgent, tasks])
  const inspectedDeniedLocks = useMemo(() => inspectedAgent
    ? locks.filter((lock) => lock.agentId === inspectedAgent.id && lock.status === 'denied')
    : [], [inspectedAgent, locks])
  const agentMailCounts = useMemo(() => {
    const counts = new Map<string, { sent: number; received: number }>()
    for (const agent of agents) counts.set(agent.id, { sent: 0, received: 0 })
    for (const message of messages) {
      const sent = counts.get(message.fromAgentId)
      if (sent) sent.sent += 1
      const received = counts.get(message.toAgentId)
      if (received) received.received += 1
    }
    return counts
  }, [agents, messages])
  const worktree = inspectedAgent?.worktreeBranch && inspectedAgent.worktreePath !== run?.baseCwd
    ? worktreeStats.get(inspectedAgent.worktreePath)
    : undefined
  const completed = tasks.filter((task) => task.status === 'completed').length
  const undelivered = messages.filter((message) => !message.deliveredAt).length
  const unansweredReplies = messages.filter((message) => message.replyRequired && !message.resolvedAt)
  const staleAgents = agents.filter((agent) => LIVE_AGENT_STATUSES.has(agent.status) && agentLiveness(agent, now) !== 'fresh')
  const deniedLocks = locks.filter((lock) => lock.status === 'denied')
  const failedTasks = tasks.filter((task) => task.status === 'failed')
  const openDecisions = tasks.flatMap((task) => task.receipt?.needsDecision ?? []).filter((decision) => decision.status === 'open')
  const pendingControlGates = (run?.phaseReports.filter((report) => report.status === 'awaiting_approval').length ?? 0)
    + (run?.requireReview && run.review.status === 'pending' && tasks.length > 0 && tasks.every((task) => TERMINAL_TASKS.has(task.status)) ? 1 : 0)
  const hasRunAttention = unansweredReplies.length > 0 || staleAgents.length > 0 || deniedLocks.length > 0 || failedTasks.length > 0 || openDecisions.length > 0 || pendingControlGates > 0
  const providerSummary = PROVIDERS.map((provider) => ({ provider, count: fleet.providers.get(provider) ?? 0 }))
  const inspectedAgentIndex = inspectedAgent ? agents.findIndex((agent) => agent.id === inspectedAgent.id) : -1
  const topologyAgentIndex = inspectedAgent ? topologyAgents.findIndex((agent) => agent.id === inspectedAgent.id) : -1
  const inspectedLiveness = inspectedAgent ? agentLiveness(inspectedAgent, now) : 'dead'
  // "external:<agentId>" is a synthetic id with no transcript behind it. Saying
  // so once is the useful part; echoing the raw id only pushed the line past the
  // pane width so it truncated mid-token ("external:external-").
  const inspectedSessionIdentity = inspectedAgent?.sessionId.startsWith('external:')
    ? 'no readable transcript · external MCP participant'
    : inspectedAgent?.sessionId ?? 'no session'
  const inspectedMailSent = inspectedAgent ? inspectedMessages.filter((message) => message.fromAgentId === inspectedAgent.id).length : 0
  const inspectedMailReceived = inspectedMessages.length - inspectedMailSent
  const inspectedCompletedTasks = inspectedTasks.filter((task) => task.status === 'completed')
  const inspectedActiveTasks = inspectedTasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
  const inspectedBlockedReason = agentErrorEvent?.detail ?? agentErrorEvent?.summary
    ?? (inspectedTask ? taskBlockReasonById.get(inspectedTask.id) : undefined)
  const recentInspectedMessages = inspectedMessages.slice(-6).reverse()
  const compactInspectedMessage = recentInspectedMessages[0] ? (() => {
    const message = recentInspectedMessages[0]
    const outbound = message.fromAgentId === inspectedAgent?.id
    const counterpartyId = outbound ? message.toAgentId : message.fromAgentId
    const counterparty = agentsById.get(counterpartyId)?.name ?? counterpartyId
    const marker = message.replyRequired ? (message.resolvedAt ? ' ✓' : ' ?') : ''
    return `${outbound ? '→' : '←'} ${counterparty}  ${message.kind}${marker}`
  })() : null
  // Report where agents ACTUALLY work, not just the run flag: a run created
  // with worktrees enabled can still be staffed by `--shared` workers that all
  // sit in one checkout, and labelling that "isolated checkouts" sends an
  // engineer debugging a cross-lane conflict down the wrong path.
  const checkoutIsShared = run?.useWorktrees === false || (() => {
    const seen = new Set<string>()
    return agents.some((agent) => {
      const dir = agent.worktreePath.replace(/\/+$/, '')
      if (!dir) return false
      if (seen.has(dir)) return true
      seen.add(dir)
      return false
    })
  })()
  const workspace = run?.baseCwd.split('/').filter(Boolean).at(-1) ?? '—'
  const branch = agents.find((agent) => agent.role === 'lead')?.worktreeBranch || 'main'
  const runElapsed = run ? elapsed(run.createdAt, ['completed', 'failed', 'stopped'].includes(run.status) ? run.updatedAt : now) : '—'
  const runSeconds = run ? Math.max(1, Math.floor((new Date(['completed', 'failed', 'stopped'].includes(run.status) ? run.updatedAt : now).getTime() - new Date(run.createdAt).getTime()) / 1000)) : 1
  const eventsPerMinute = events.length > 0 ? (events.length / runSeconds) * 60 : 0
  const activeTasks = tasks.filter((task) => ACTIVE_TASKS.has(task.status)).length
  const blockedTasks = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').length
  const canRerunTask = blockedTasks > 0 && run !== null && !['completed', 'failed', 'stopped'].includes(run.status)
  const assignedTasks = tasks.filter((task) => task.ownerAgentId).length
  const activeLocks = locks.filter((lock) => lock.status === 'active').length
  const lastActivityAge = events.length > 0 ? age(events.at(-1)?.timestamp, now) : '—'
  const topologyLabel = ` TOPOLOGY · ${agents.length} agents · ${snapshot?.messages.length ?? 0} messages `
  // Split the inspector's remaining rows between the mail log and the topology
  // tree instead of hard-coding both. The topology only needs one row per agent,
  // so on a small roster the leftover rows go to mail exchanges — previously
  // they were left blank while the mail log was clipped to a single line.
  // `height` includes the inspector's top/bottom border. Inside it, fixed rows
  // are: header(2), agent/session/state/tasks/locks(5), mail header(1), and
  // topology header(1), plus optional detail rows. Reserve a compact mail row
  // before giving the remainder to topology so the sum can never exceed the
  // actual inner height.
  const inspectorContentRows = Math.max(inspectorH - 2, 0)
  const compactInspector = inspectorH <= 13
  const showCompactLocks = selectedLocks.length > 0 || inspectedDeniedLocks.length > 0
  // Compact: header(2), agent/state/tasks/locks(4), topology header(1).
  // Session and the verbose mail heading are omitted; one combined mail row is
  // budgeted below. Expanded mode retains the complete nine-row fixed set.
  const inspectorFixedRows = (compactInspector ? 6 + (showCompactLocks ? 1 : 0) : 9 + (showInspectorDetails ? 1 : 0)) + (inspectedBlockedReason ? 1 : 0)
  const inspectorFreeRows = Math.max(inspectorContentRows - inspectorFixedRows, 0)
  const compactMailRows = compactInspector ? 1 : 0
  const topologyRows = Math.min(topologyAgents.length, Math.max(inspectorFreeRows - compactMailRows, 0))
  const inspectorMailRows = compactInspector
    ? compactMailRows
    : Math.min(recentInspectedMessages.length, Math.max(inspectorFreeRows - topologyRows, 0))
  const selectedEventAgent = selectedEvent ? agentsById.get(selectedEvent.agentId) : undefined
  const selectedEventMessage = selectedEvent ? messageMetaByEvent.get(selectedEvent) : undefined
  const selectedEventBody = selectedEventMessage?.body ?? selectedEvent?.detail ?? selectedEvent?.summary ?? 'No detail'
  const detailWidth = Math.max(rightW - 4, 8)
  const detailBodyLines = wrapPadded(selectedEventBody, detailWidth, DETAIL_BODY_ROWS)
  const contextualKeys = section === 'overview'
    ? run ? 'j/k workflow · enter board · [/] switch run' : 'n create first workflow'
    : section === 'tasks'
      ? `j/k task${selectedTask?.ownerAgentId ? ' · ↵ transcript' : ''} · / filter${selectedTaskPlanState === 'awaiting' ? ' · a approve · R reject' : selectedTask && (selectedTask.status === 'blocked' || selectedTask.status === 'failed') ? ' · R rerun' : ''} · f fail · m ${selectedTask?.ownerAgentId ? 'owner' : 'lead'}`
      : section === 'team'
        ? `j/k agent${inspectedAgent ? ` · ↵ transcript · x interrupt${run?.useWorktrees === false ? '' : ' · w merge'} · m message${STUCK_AGENT_STATUSES.has(inspectedAgent.status) ? ' · R rerun' : ''}` : ''}`
        : `j/k event${selectedEventAgent ? ' · ↵ transcript' : ''} · g tail · / filter · m ${selectedEventAgent ? 'event agent' : 'lead'}`
  const globalKeys = innerW >= 154
    ? `1-4 focus · tab next · click/wheel · G agent changes · n new · M broadcast · s stop · D delete${run?.useWorktrees === false ? '' : ' · c cleanup'}${canCopyJoinCommand ? ' · i join cmd' : ''} · r refresh · q close`
    : '1-4 focus · tab next · click/wheel · G changes · n new · M all · s stop · r refresh · q close'
  const footerText = `${contextualKeys}  │  ${globalKeys}`
  const promptHint = run?.status === 'blocked' && run.resumeCapsule?.nextAction
    ? fit(`NEXT · ${run.resumeCapsule.nextAction}`, innerW - 2)
    : canRerunTask
    ? '[R] rerun failed/blocked  [M] broadcast  [m] message focused agent'
    : 'Message the current context…  [M] broadcast  [m] message focused agent'
  const activityFooterText = rightW >= 40 ? '4 focus  ·  g tail  ·  / filter  ·  m message' : '4 focus  ·  g tail'
  const metricWidth = Math.max(14, Math.floor((innerW - 4) / 5))
  const attentionCount = hasRunAttention ? Math.max(1, fleet.attention) : fleet.attention
  const metrics = [
    { icon: '◇', label: 'WORKFLOWS', value: runs.length, tone: theme.cyan },
    { icon: '♧', label: 'AGENTS', value: fleet.agents, tone: theme.violet },
    { icon: '∿', label: 'WORKING', value: fleet.working, tone: theme.green },
    { icon: '◷', label: 'QUEUED', value: fleet.queued, tone: theme.amber },
    { icon: '!', label: 'ATTENTION', value: attentionCount, tone: attentionCount > 0 ? theme.red : theme.dim },
  ]

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.surface}
      zIndex={70}
      flexDirection="column"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box height={1} flexDirection="row" alignItems="center" overflow="hidden">
          <text fg={theme.cyan} wrapMode="none">AGENT CONTROL CENTER</text>
          <text fg={theme.dim} wrapMode="none">{'  |  Workspace: '}</text>
          <text fg={theme.text} wrapMode="none">{fit(workspace, 18)}</text>
          <text fg={theme.dim} wrapMode="none">{'  |  Branch: '}</text>
          <text fg={theme.text} wrapMode="none">{fit(branch, 16)}</text>
          <text fg={theme.dim} wrapMode="none">{'  |  Elapsed: '}</text>
          <text fg={theme.text} wrapMode="none">{runElapsed}</text>
          <text fg={theme.dim} wrapMode="none">{'  |  System: '}</text>
          <text fg={fleet.attention > 0 || hasRunAttention ? theme.amber : theme.green} wrapMode="none">{fleet.attention > 0 || hasRunAttention ? 'ATTENTION' : 'HEALTHY'}</text>
          <box flexGrow={1} />
          {showProviderHealth ? providerSummary.map(({ provider, count }) => (
            <box key={provider} marginLeft={1} height={1} flexDirection="row">
              <text fg={getProviderAccent(provider)} wrapMode="none">{`[${provider.toUpperCase()} `}</text>
              <text fg={count > 0 ? theme.green : theme.dim} wrapMode="none">{count > 0 ? '● OK' : '● —'}</text>
              <text fg={getProviderAccent(provider)} wrapMode="none">{']'}</text>
            </box>
          )) : null}
        </box>
        <box height={1} flexDirection="row" alignItems="center" overflow="hidden">
          <text fg={hasRunAttention ? theme.amber : theme.green} wrapMode="none">{hasRunAttention ? `ATTENTION · ${fleet.agents} agents` : `ATTENTION · clear · ${fleet.agents} agents`}</text>
          {/* Compact labels: at 120 cols the long form overran the row, and the
              flexGrow spacer collapsed to 0 so the last counter's VALUE was
              clipped — an attention row that hides the number it exists to show. */}
          <text flexShrink={0} fg={unansweredReplies.length > 0 ? theme.amber : theme.dim} wrapMode="none">{`  replies ${unansweredReplies.length}`}</text>
          <text flexShrink={0} fg={staleAgents.length > 0 ? theme.amber : theme.dim} wrapMode="none">{`  · stale ${staleAgents.length}`}</text>
          <text flexShrink={0} fg={deniedLocks.length > 0 ? theme.amber : theme.dim} wrapMode="none">{`  · denied locks ${deniedLocks.length}`}</text>
          <text flexShrink={0} fg={failedTasks.length > 0 ? theme.red : theme.dim} wrapMode="none">{`  · failed ${failedTasks.length}`}</text>
          <text flexShrink={0} fg={pendingControlGates > 0 || openDecisions.length > 0 ? theme.amber : theme.dim} wrapMode="none">{`  · gates ${pendingControlGates} · decisions ${openDecisions.length}`}</text>
          <box flexGrow={1} minWidth={2} />
          {run ? <text flexShrink={1} fg={checkoutIsShared ? theme.amber : theme.green} wrapMode="none">{checkoutIsShared ? 'shared checkout' : 'isolated checkouts'}</text> : null}
          {busy ? <text fg={theme.amber} wrapMode="none">{'  ·  refreshing'}</text> : null}
        </box>
      </box>

      <box height={metricsH} paddingX={1} paddingTop={1} flexDirection="row" overflow="hidden">
        {metrics.map((metric, index) => (
          <box key={metric.label} width={metricWidth} height={3} marginRight={index === metrics.length - 1 ? 0 : 1} paddingX={1} border borderStyle="single" borderColor={metric.tone} flexDirection="row" alignItems="center" overflow="hidden">
            <text fg={metric.tone} wrapMode="none">{`${metric.icon} `}</text>
            <box flexDirection="column" minWidth={0} overflow="hidden">
              <text fg={metric.tone} wrapMode="none">{String(metric.value)}</text>
              <text fg={theme.dim} wrapMode="none">{fit(metric.label, Math.max(metricWidth - 5, 6))}</text>
            </box>
          </box>
        ))}
      </box>

      <box height={bodyH} minHeight={0} flexDirection="row" overflow="hidden">
        <box width={leftW} height={bodyH} marginRight={1} paddingX={1} border borderStyle="single" borderColor={section === 'overview' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden"
          onMouseUp={() => onFocusSection?.('overview')}
          onMouseScroll={(event) => onScrollSection?.('overview', event.scroll?.direction === 'up' ? -1 : 1)}
        >
          <box height={2} border={['bottom']} borderStyle="single" borderColor={section === 'overview' ? theme.cyan : theme.border} backgroundColor={section === 'overview' ? theme.surface3 : theme.surface} flexDirection="row" alignItems="center">
            <text fg={section === 'overview' ? theme.cyan : theme.text} wrapMode="none">{`[1] WORKFLOWS  ${runs.length}`}</text>
            <box flexGrow={1} />
            <text fg={theme.dim} wrapMode="none">{'▽'}</text>
          </box>
          {runs.length === 0 ? (
            <text fg={loadError ? theme.red : theme.dim} wrapMode="none">{fit(loadError ?? 'No workflows. Press n to start one.', leftW - 2)}</text>
          ) : groupedRuns.filter((group) => group.runs.length > 0).map((group, groupIndex) => (
            <box key={group.label} flexDirection="column">
              {groupIndex > 0 ? <text fg={theme.border} wrapMode="none">{'─'.repeat(Math.max(leftW - 2, 1))}</text> : null}
              <text fg={group.label === 'NEEDS ATTENTION' ? theme.amber : group.label === 'RUNNING' ? theme.green : theme.cyan} wrapMode="none">{group.label}</text>
              {visibleWorkflowGroup(group.runs, runId).map((entry) => {
                const selected = entry.id === runId
                const entrySnapshot = snapshotsById.get(entry.id)
                const entryTasks = entrySnapshot?.tasks ?? []
                const entryDone = entryTasks.filter((task) => task.status === 'completed').length
                const providerNames = entrySnapshot?.agents.map((agent) => agent.provider.toUpperCase()) ?? [entry.provider.toUpperCase()]
                return (
                  <box key={entry.id} height={2} paddingX={1} backgroundColor={selected && section === 'overview' ? theme.cyan : selected ? theme.surface3 : theme.surface} flexDirection="column"
                    onMouseUp={() => { onFocusSection?.('overview'); onSelectRun?.(entry.id) }}
                  >
                    <box height={1} flexDirection="row">
                      <text fg={selected && section === 'overview' ? theme.surface : workflowTone(entry, theme)} wrapMode="none">{selected ? '▶ ' : '● '}</text>
                      <text fg={selected && section === 'overview' ? theme.surface : theme.muted} wrapMode="none">{fit(runTitle(entry), Math.max(leftW - 14, 8))}</text>
                      <box flexGrow={1} />
                      <text fg={selected && section === 'overview' ? theme.surface : theme.dim} wrapMode="none">{`${entryDone}/${entryTasks.length || '—'} ${age(entry.updatedAt, now)}`}</text>
                    </box>
                    <text fg={selected && section === 'overview' ? theme.surface : getProviderAccent(entry.provider)} wrapMode="none">{fit(`   ${[...new Set(providerNames)].join('  ')}`, leftW - 4)}</text>
                  </box>
                )
              })}
            </box>
          ))}
          <box flexGrow={1} />
          <box height={3} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="column">
            <text fg={theme.dim} wrapMode="none">{fit(`Totals: ${runs.length} workflows  ${fleet.agents} agents`, leftW - 2)}</text>
            <text fg={section === 'overview' ? theme.cyan : theme.dim} wrapMode="none">{'1 focus · j/k select · [/] switch'}</text>
          </box>
        </box>

        <box width={centerW} height={bodyH} marginRight={1} paddingX={1} border borderStyle="single" borderColor={section === 'tasks' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden"
          onMouseUp={() => onFocusSection?.('tasks')}
          onMouseScroll={(event) => onScrollSection?.('tasks', event.scroll?.direction === 'up' ? -1 : 1)}
        >
          <box height={2} border={['bottom']} borderStyle="single" borderColor={section === 'tasks' ? theme.cyan : theme.border} backgroundColor={section === 'tasks' ? theme.surface3 : theme.surface} flexDirection="row" alignItems="center">
            <text fg={section === 'tasks' ? theme.cyan : theme.text} wrapMode="none">{`[2] WORK BOARD  ${run ? fit(runTitle(run), Math.max(centerW - 34, 12)) : '—'}`}</text>
            <box flexGrow={1} />
            <text fg={theme.dim} wrapMode="none">{`[${completed}/${tasks.length} done]${taskFilter === 'all' ? '' : ` · ${taskFilter}`}`}</text>
          </box>
          {showTaskColumns ? (
            <box height={2} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
              <text fg={theme.dim} wrapMode="none">{'STAGE    TASK'}</text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">{'ASSIGNED     ELAPSED   STATE'}</text>
            </box>
          ) : null}
          {(['queued', 'active', 'verify'] as const).map((stage, stageIndex) => {
            const stageTasks = stagedTasks[stage]
            const stageLimit = stage === 'active' ? 5 : 4
            const visibleStageTasks = visibleWindow(stageTasks, stageTasks.findIndex((task) => task.id === selectedTask?.id), stageLimit)
            return (
            <box key={stage} flexDirection="column">
              {stageIndex > 0 ? <text fg={theme.border} wrapMode="none">{'· '.repeat(Math.max(Math.floor((centerW - 4) / 2), 1))}</text> : null}
              <text fg={stage === 'active' ? theme.green : stage === 'verify' ? theme.violet : theme.cyan} wrapMode="none">{`${stage.toUpperCase()}  (${stageTasks.length})`}</text>
              {visibleStageTasks.map((task, taskIndex) => {
                const owner = task.ownerAgentId ? agentsById.get(task.ownerAgentId) : null
                const selected = selectedTask?.id === task.id
                const isLast = taskIndex === visibleStageTasks.length - 1
                const branch = isLast ? '└─' : '├─'
                const continuation = isLast ? '  ' : '│ '
                const dependencies = task.blockedBy.map((id) => `${id}:${taskById.get(id)?.status ?? 'missing'}`)
                const dependents = taskDependentsById.get(task.id) ?? []
                const blockReason = taskBlockReasonById.get(task.id)
                const lockContention = taskLockContentionById.get(task.id) ?? []
                const taskDetail = [
                  task.id,
                  task.roleName ? `role: ${task.roleName}` : '',
                  `seat: ${task.seat}`,
                  task.requestedModel ? `requested: ${task.requestedProvider ?? owner?.provider ?? 'provider'}/${task.requestedModel}` : '',
                  task.receipt?.actualModel ? `actual: ${task.receipt.actualProvider}/${task.receipt.actualModel}` : '',
                  task.receipt ? `receipt: ${task.receipt.provenance}${task.receipt.usage?.totalTokens !== undefined ? ` · ${task.receipt.usage.totalTokens} tok` : ''}` : '',
                  task.paths[0] ?? task.status,
                  dependencies.length > 0 ? `← ${dependencies.join(',')}` : '',
                  dependents.length > 0 ? `→ ${dependents.join(',')}` : '',
                  blockReason ? `blocked: ${blockReason}` : '',
                  lockContention.length > 0 ? `locks: ${lockContention.join(',')}` : '',
                ].filter(Boolean).join(' · ')
                return (
                  <box key={task.id} height={2} paddingX={1} backgroundColor={selected && section === 'tasks' ? theme.cyan : selected ? theme.surface3 : theme.surface} flexDirection="column"
                    onMouseUp={() => { onFocusSection?.('tasks'); if (selected && section === 'tasks') onActivateSelection?.('tasks'); else onSelectTask?.(task.id) }}
                  >
                    <box height={1} flexDirection="row" overflow="hidden">
                      <text fg={selected && section === 'tasks' ? theme.surface : theme.dim} wrapMode="none">{`${branch} `}</text>
                      <text fg={selected && section === 'tasks' ? theme.surface : taskTone(task, theme)} wrapMode="none">{`${taskMarker(task)} `}</text>
                      <text fg={selected && section === 'tasks' ? theme.surface : theme.muted} wrapMode="none">{fit(task.title, Math.max(centerW - (showTaskColumns ? 46 : 32), 8))}</text>
                      <box flexGrow={1} />
                      <text fg={selected && section === 'tasks' ? theme.surface : owner ? getProviderAccent(owner.provider) : theme.dim} wrapMode="none">{fit(owner?.name ?? 'unassigned', showTaskColumns ? 12 : 8).padEnd(showTaskColumns ? 12 : 8)}</text>
                      <text fg={selected && section === 'tasks' ? theme.surface : theme.dim} wrapMode="none">{` ${elapsed(task.createdAt, TERMINAL_TASKS.has(task.status) ? task.updatedAt : now).padStart(showTaskColumns ? 7 : 4)}${showTaskColumns ? '  ' : ''}`}</text>
                      {showTaskColumns ? <text fg={selected && section === 'tasks' ? theme.surface : taskTone(task, theme)} wrapMode="none">{fit(task.status === 'in_progress' ? 'working' : task.status, 9).padEnd(9)}</text> : null}
                    </box>
                    <text fg={selected && section === 'tasks' ? theme.surface : blockReason || lockContention.length > 0 ? theme.amber : theme.dim} wrapMode="none">{fit(`${continuation}    ${taskDetail}`, centerW - 4)}</text>
                  </box>
                )
              })}
            </box>
            )
          })}
          <box flexGrow={1} />
          {showTaskColumns ? <box height={7} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" overflow="hidden">
            <box width="48%" paddingX={1} border={['right']} borderStyle="single" borderColor={theme.border} flexDirection="column">
              <text fg={theme.dim} wrapMode="none">THROUGHPUT (events/min)</text>
              <box flexDirection="row">
                <text fg={theme.dim} wrapMode="none">{'3.0 - '}</text>
                <text fg={theme.cyan} wrapMode="none">{activitySparkline(events, Math.max(Math.floor(centerW * 0.18), 10))}</text>
                <text fg={theme.dim} wrapMode="none">{'  '}</text>
                <box flexGrow={1} />
                <text fg={theme.muted} wrapMode="none">{`Now: ${eventsPerMinute.toFixed(1)}`}</text>
              </box>
              <text fg={theme.dim} wrapMode="none">{`1.5 -${' '.repeat(Math.max(Math.floor(centerW * 0.25), 10))}`}</text>
              <box flexDirection="row"><text fg={theme.dim} wrapMode="none">{'0   - '}</text><box flexGrow={1} /><text fg={theme.muted} wrapMode="none">{`Run: ${events.length} events`}</text></box>
            </box>
            <box width="22%" paddingX={1} border={['right']} borderStyle="single" borderColor={theme.border} flexDirection="column">
              <text fg={theme.dim} wrapMode="none">RUN STATE</text>
              <text fg={activeTasks > 0 ? theme.green : theme.muted} wrapMode="none">{`Active:  ${activeTasks}`}</text>
              <text fg={blockedTasks > 0 ? theme.amber : theme.muted} wrapMode="none">{`Blocked: ${blockedTasks}`}</text>
              <text fg={undelivered > 0 ? theme.violet : theme.muted} wrapMode="none">{`Mail:    ${undelivered}`}</text>
            </box>
            <box flexGrow={1} paddingX={1} flexDirection="column">
              <text fg={theme.dim} wrapMode="none">OWNERSHIP</text>
              <text fg={assignedTasks < tasks.length ? theme.amber : theme.muted} wrapMode="none">{`Tasks:  ${assignedTasks}/${tasks.length} assigned`}</text>
              <text fg={activeLocks > 0 ? theme.cyan : theme.muted} wrapMode="none">{`Locks:  ${activeLocks}`}</text>
              <text fg={theme.muted} wrapMode="none">{`Latest: ${lastActivityAge} ago`}</text>
            </box>
          </box> : (
            <box height={7} border={['top']} borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
              <text fg={theme.dim} wrapMode="none">PROGRESS</text>
              <text fg={theme.cyan} wrapMode="none">{`${completed}/${tasks.length} done · elapsed ${runElapsed}`}</text>
              <text fg={theme.dim} wrapMode="none">FLEET</text>
              <text fg={theme.green} wrapMode="none">{`${fleet.working} working · ${fleet.queued} queued · ${fleet.attention} attention`}</text>
              <text fg={theme.dim} wrapMode="none">{`RUN CONTROL  mail ${undelivered}`}</text>
            </box>
          )}
        </box>

        <box width={rightW} height={bodyH} flexDirection="column" overflow="hidden">
          <box height={inspectorH} paddingX={1} border borderStyle="single" borderColor={section === 'team' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden"
            onMouseUp={() => onFocusSection?.('team')}
            onMouseScroll={(event) => onScrollSection?.('team', event.scroll?.direction === 'up' ? -1 : 1)}
          >
            <box height={2} flexShrink={0} border={['bottom']} borderStyle="single" borderColor={section === 'team' ? theme.cyan : theme.border} backgroundColor={section === 'team' ? theme.surface3 : theme.surface} flexDirection="row" alignItems="center">
              <text fg={section === 'team' ? theme.cyan : theme.text} wrapMode="none">[3] AGENT INSPECTOR</text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">{`[${Math.max(inspectedAgentIndex + 1, 0)}/${agents.length}]`}</text>
            </box>
            {inspectedAgent ? (
              <>
                <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.dim} wrapMode="none">Agent:</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={getProviderAccent(inspectedAgent.provider)} wrapMode="none">{fit(`${inspectedAgent.name} · ${String(inspectedAgent.provider).toUpperCase()} · ${inspectedAgent.role}`, rightW - 14)}</text></box></box>
                {!compactInspector ? <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.dim} wrapMode="none">Session:</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={inspectedAgent.sessionId.startsWith('external:') ? theme.amber : theme.muted} wrapMode="none">{fit(`${inspectedSessionIdentity} · ${inspectedAgent.client?.name ?? 'managed'}`, rightW - 14)}</text></box></box> : null}
                <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
                  <box width={10} flexShrink={0}><text fg={theme.dim} wrapMode="none">State:</text></box>
                  <box flexGrow={1} minWidth={0} overflow="hidden"><text fg={inspectedLiveness === 'dead' ? theme.red : inspectedLiveness === 'stale' ? theme.amber : inspectedAgent.turnActive ? theme.green : theme.cyan} wrapMode="none">
                    {fit(`${inspectedAgent.status}${inspectedAgent.turnActive ? ' · streaming' : ''} · ${inspectedAgent.progressEvidence?.signal ?? 'heartbeat'} ${age(inspectedAgent.progressEvidence?.observedAt ?? inspectedAgent.lastSeenAt, now)} ago · ${inspectedLiveness}`, rightW - 14)}
                  </text></box>
                </box>
                <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.dim} wrapMode="none">Tasks:</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={theme.text} wrapMode="none">{fit(`claimed ${inspectedActiveTasks.map((task) => task.id).join(',') || '—'} · completed ${inspectedCompletedTasks.map((task) => task.id).join(',') || '—'}`, rightW - 14)}</text></box></box>
                {!compactInspector || showCompactLocks ? <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.dim} wrapMode="none">Locks:</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={inspectedDeniedLocks.length > 0 ? theme.amber : selectedLocks.length > 0 ? theme.cyan : theme.muted} wrapMode="none">{fit(`held ${selectedLocks.map((lock) => lock.path).join(',') || '—'} · denied ${inspectedDeniedLocks.map((lock) => lock.path).join(',') || '—'}`, rightW - 14)}</text></box></box> : null}
                {inspectedBlockedReason ? (
                  <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.red} wrapMode="none">Blocker:</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={theme.red} wrapMode="none">{fit(inspectedBlockedReason, rightW - 14)}</text></box></box>
                ) : null}
                {showInspectorDetails ? (
                  <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.dim} wrapMode="none">Checkout:</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={theme.muted} wrapMode="none">{fit(`${inspectedAgent.worktreeBranch || 'main'} · ${worktree ? `${worktree.dirtyFiles} dirty, ${worktree.aheadCommits} ahead` : 'shared'} · ${latestAgentEvent?.type ?? 'idle'}`, rightW - 14)}</text></box></box>
                ) : null}
                {!compactInspector ? <box height={1} flexShrink={0} flexDirection="row" overflow="hidden"><box width={10} flexShrink={0}><text fg={theme.violet} wrapMode="none">MAIL</text></box><box flexGrow={1} minWidth={0} overflow="hidden"><text fg={theme.muted} wrapMode="none">{fit(`sent ${inspectedMailSent} · received ${inspectedMailReceived} · latest exchanges`, rightW - 14)}</text></box></box> : null}
                {compactInspector ? (
                  <box height={1} flexShrink={0} overflow="hidden"><text fg={theme.violet} wrapMode="none">{fit(compactInspectedMessage ? `MAIL  ${compactInspectedMessage}` : `MAIL  sent ${inspectedMailSent} · received ${inspectedMailReceived}`, rightW - 4)}</text></box>
                ) : recentInspectedMessages.slice(0, inspectorMailRows).map((message) => {
                  const outbound = message.fromAgentId === inspectedAgent.id
                  const counterpartyId = outbound ? message.toAgentId : message.fromAgentId
                  const counterparty = agentsById.get(counterpartyId)?.name ?? counterpartyId
                  return (
                    // Fixed-width columns with flexShrink={0}: inline spaces in a
                    // shrinking flex row get squeezed out once the content
                    // overflows, which ran the columns together as one word
                    // ("→control-ce…review_requestWork paused").
                    <box key={message.id} height={1} flexDirection="row" overflow="hidden">
                      <text flexShrink={0} fg={outbound ? theme.violet : theme.cyan} wrapMode="none">{outbound ? '  → ' : '  ← '}</text>
                      <box width={12} flexShrink={0} overflow="hidden"><text fg={theme.text} wrapMode="none">{fit(counterparty, 11)}</text></box>
                      <box width={16} flexShrink={0} overflow="hidden"><text fg={message.replyRequired && !message.resolvedAt ? theme.amber : theme.dim} wrapMode="none">{fit(`${message.kind}${message.replyRequired ? message.resolvedAt ? ' ✓' : ' ?' : ''}`, 15)}</text></box>
                      <box flexGrow={1} minWidth={0} overflow="hidden"><text fg={theme.muted} wrapMode="none">{fit(message.body.replace(/\s+/g, ' ').trim(), Math.max(rightW - 36, 6))}</text></box>
                    </box>
                  )
                })}
                <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
                  <text fg={theme.border} wrapMode="none">{'─'}</text>
                  <text fg={theme.cyan} wrapMode="none">{topologyLabel}</text>
                  <text fg={theme.border} wrapMode="none">{'─'.repeat(Math.max(rightW - topologyLabel.length - 3, 1))}</text>
                </box>
                {visibleWindow(topologyAgents, Math.max(topologyAgentIndex, 0), topologyRows).map((agent, index, visible) => {
                  const agentTask = (agent.taskId ? taskById.get(agent.taskId) : undefined)
                    ?? tasks.find((task) => task.ownerAgentId === agent.id && ACTIVE_TASKS.has(task.status))
                    ?? tasks.find((task) => task.ownerAgentId === agent.id)
                  const mail = agentMailCounts.get(agent.id) ?? { sent: 0, received: 0 }
                  const dependencies = agentTask?.blockedBy ?? []
                  const dependents = agentTask ? taskDependentsById.get(agentTask.id) ?? [] : []
                  const branchGlyph = agent.role === 'lead' ? '◆' : index === visible.length - 1 ? '└─' : '├─'
                  const edge = agentTask
                    ? `${agentTask.id}${dependencies.length > 0 ? ` ←${dependencies.join(',')}` : ''}${dependents.length > 0 ? ` →${dependents.join(',')}` : ''}`
                    : agent.role === 'lead' ? run ? runTitle(run) : 'workflow' : 'unassigned'
                  return (
                    <box key={agent.id} height={1} flexShrink={0} flexDirection="row" overflow="hidden"
                      onMouseUp={() => { onFocusSection?.('team'); if (agent.id === inspectedAgent.id && section === 'team') onActivateSelection?.('team'); else onSelectAgent?.(agent.id) }}
                    >
                      <text fg={agent.id === inspectedAgent.id ? theme.cyan : theme.dim} wrapMode="none">{`${agent.id === inspectedAgent.id ? '▶' : ' '} ${branchGlyph} `}</text>
                      <box width={10} flexShrink={0} overflow="hidden"><text fg={getProviderAccent(agent.provider)} wrapMode="none">{fit(agent.name, 10)}</text></box>
                      <text fg={agent.status === 'blocked' || agent.status === 'failed' ? theme.amber : agent.turnActive || agent.status === 'working' ? theme.green : theme.dim} wrapMode="none">{` ${agent.turnActive || agent.status === 'working' ? '●' : '○'} `}</text>
                      <text fg={theme.violet} wrapMode="none">{`m→${mail.sent}←${mail.received} `}</text>
                      <text fg={theme.muted} wrapMode="none">{fit(edge, Math.max(rightW - 29, 8))}</text>
                    </box>
                  )
                })}
              </>
            ) : <text fg={theme.dim} wrapMode="none">No agent selected</text>}
          </box>

          <box flexGrow={1} minHeight={0} marginTop={1} paddingX={1} border borderStyle="single" borderColor={section === 'events' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden"
            onMouseUp={() => onFocusSection?.('events')}
            onMouseScroll={(event) => onScrollSection?.('events', event.scroll?.direction === 'up' ? -1 : 1)}
          >
            <box height={3} border={['bottom']} borderStyle="single" borderColor={section === 'events' ? theme.cyan : theme.border} backgroundColor={section === 'events' ? theme.surface3 : theme.surface} flexDirection="column" overflow="hidden">
              <box height={1} flexDirection="row" alignItems="center">
                <text fg={section === 'events' ? theme.cyan : theme.text} wrapMode="none">ACTIVITY · LIVE</text>
                <box flexGrow={1} />
                <text fg={theme.dim} wrapMode="none">{`${events.length} events · ${Math.max(selectedEventIndex + 1, 0)}/${filteredEvents.length}`}</text>
              </box>
              <box height={1} flexDirection="row" alignItems="center" overflow="hidden">
                <text fg={section === 'events' ? theme.cyan : theme.dim} wrapMode="none">[4] LIVE ACTIVITY</text>
                {showActivityColumns ? (
                  <>
                    {([
                      ['all', 'ALL', events.length],
                      ['attention', 'Attention', events.filter((event) => ATTENTION_EVENTS.has(event.type)).length],
                      ['messages', 'Messages', events.filter((event) => event.type === 'message').length],
                      ['tasks', 'Tasks', events.filter((event) => event.type.startsWith('task.')).length],
                    ] as const).map(([value, label, count]) => (
                      <box key={value} marginLeft={1} paddingX={1} backgroundColor={eventFilter === value ? theme.surface3 : theme.surface}
                        onMouseUp={() => { onFocusSection?.('events'); onEventFilter?.(value) }}>
                        <text fg={eventFilter === value ? theme.cyan : theme.dim} wrapMode="none">{`${label} ${count}`}</text>
                      </box>
                    ))}
                  </>
                ) : null}
              </box>
            </box>
            <box height={eventRows} flexGrow={0} minHeight={0} flexDirection="column" overflow="hidden">
              {visibleEvents.length === 0 ? <text fg={theme.dim} wrapMode="none">No activity yet</text> : visibleEvents.map((event, index) => {
                const message = messageMetaByEvent.get(event)
                const sender = agentsById.get(event.agentId)?.name ?? event.agentId
                const recipient = message?.recipient ?? event.to
                const pair = recipient ? `${sender}→${recipient}` : sender
                const previousEvent = visibleEvents[index - 1]
                const previousMessage = previousEvent ? messageMetaByEvent.get(previousEvent) : undefined
                const previousSender = previousEvent ? agentsById.get(previousEvent.agentId)?.name ?? previousEvent.agentId : ''
                const previousRecipient = previousMessage?.recipient ?? previousEvent?.to
                const previousPair = previousEvent ? `${previousSender}${previousRecipient ? `→${previousRecipient}` : ''}` : ''
                const who = message && showActivityColumns ? `${pair === previousPair ? '│' : '┌'} ${pair}` : pair
                // The reply marker outranks the kind: truncate the kind to keep
                // "!?" (unanswered) visible, never `request…` which hides it.
                const activityMarker = message?.replyRequired ? message.unanswered ? ' ?' : ' ✓' : ''
                const activityKind = message ? message.kind : event.type
                const activityWidth = showActivityColumns ? 14 : 8
                const activityType = message?.unanswered
                  ? 'request ?'
                  : `${fit(activityKind, Math.max(activityWidth - activityMarker.length, 3))}${activityMarker}`
                // The kind column already names the event, so repeating it here
                // spent the widest column restating "agent.heartbeat" instead of
                // showing what happened. Summary only — and when there is none,
                // leave the cell empty rather than printing a dangling "·".
                const activityDetail = `${message?.unanswered && message.recipient ? `→ ${message.recipient} ` : ''}${(event.summary ?? event.detail ?? '').replace(/\s+/g, ' ').trim()}`
                const selected = selectedEvent === event
                const focused = selected && section === 'events'
                return (
                  <box key={`${event.timestamp ?? index}:${index}`} height={1} backgroundColor={focused ? theme.surface3 : theme.surface} flexDirection="row" overflow="hidden"
                    // The feed is windowed, so the row index is not the index
                    // into filteredEvents — map back or clicks select the wrong
                    // event as soon as the list scrolls.
                    onMouseUp={() => {
                      onFocusSection?.('events')
                      if (selected && section === 'events') { onActivateSelection?.('events'); return }
                      const actualIndex = filteredEvents.indexOf(event)
                      if (actualIndex >= 0) onSelectEvent?.(actualIndex)
                    }}
                  >
                    <box width={showActivityColumns ? 9 : 6} overflow="hidden"><text fg={message ? theme.cyan : eventTone(event, theme)} wrapMode="none">{`● ${showActivityColumns ? clock(event.timestamp) : clock(event.timestamp).slice(3)} `}</text></box>
                    <box width={showActivityColumns ? 18 : 10} paddingLeft={1} overflow="hidden"><text fg={message ? theme.violet : eventTone(event, theme)} wrapMode="none">{fit(who, showActivityColumns ? 16 : 9)}</text></box>
                    {/* paddingLeft must stay on both widths: without it a full-width
                        pair ("lead→nova") butts straight against the kind column
                        and reads as one word ("lead→novaresponse"). */}
                    <box width={showActivityColumns ? 16 : 12} paddingLeft={1} overflow="hidden"><text fg={focused ? theme.text : eventTone(event, theme)} wrapMode="none">{activityType}</text></box>
                    <box flexGrow={1} minWidth={0} paddingLeft={1} overflow="hidden"><text fg={focused ? theme.text : theme.muted} wrapMode="none">{fit(activityDetail, Math.max(rightW - (showActivityColumns ? 43 : 26), 5))}</text></box>
                  </box>
                )
              })}
            </box>
            <box height={activityDetailH} paddingX={1} border={['top']} borderStyle="single" borderColor={selectedEvent ? eventTone(selectedEvent, theme) : theme.border} flexDirection="column" overflow="hidden">
              {selectedEvent ? (
                <>
                  {/* Both the header and every body row are padded to the same
                      width: a shorter line must overwrite the cells the previous
                      frame's longer line left behind, or leftovers show through. */}
                  <text fg={selectedEventMessage?.unanswered ? theme.amber : eventTone(selectedEvent, theme)} wrapMode="none">
                    {fit(`DETAIL · ${eventClassLabel(eventClass(selectedEvent))} · ${selectedEvent.type}${selectedEventMessage?.replyRequired ? selectedEventMessage.unanswered ? ' · REPLY REQUIRED · UNANSWERED' : ' · REPLY REQUIRED · ANSWERED' : ''}`, detailWidth).padEnd(detailWidth, ' ')}
                  </text>
                  {detailBodyLines.map((line, index) => (
                    <text key={index} fg={theme.text} wrapMode="none">{line}</text>
                  ))}
                </>
              ) : <text fg={theme.dim} wrapMode="none">Select an event to inspect its full detail</text>}
            </box>
            <box height={activityFooterH} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
              <text fg={theme.dim} wrapMode="none">{activityFooterText}</text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">{`${Math.max(selectedEventIndex + 1, 0)}/${filteredEvents.length}`}</text>
            </box>
          </box>
        </box>
      </box>

      <box height={promptH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border2} alignItems="center" flexDirection="row">
        {messageTarget !== null ? (
          <>
            <text fg={theme.violet} wrapMode="none">{`> ${messageTarget}: `}</text>
            <box flexGrow={1} backgroundColor={theme.surface3}>
              <input focused value={messageDraft} maxLength={400} onInput={onMessageDraft} onSubmit={onSubmitMessage} />
            </box>
          </>
        ) : (
          <>
            <text fg={theme.cyan} wrapMode="none">{'>'}</text>
            <text fg={pendingLabel ? theme.amber : theme.muted} wrapMode="none">{` ${fit(pendingLabel ?? promptHint, innerW - 4)}`}</text>
            <text fg={theme.cyan} wrapMode="none">{' ▌'}</text>
          </>
        )}
      </box>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} alignItems="center" justifyContent="center" overflow="hidden">
        <text fg={theme.dim} wrapMode="none">{fit(`[${paneNumber(section)} ${section.toUpperCase()}]  ${footerText}`, innerW - 2)}</text>
      </box>
    </box>
  )
}

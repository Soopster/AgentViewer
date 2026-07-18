/** @jsxImportSource @opentui/react */
// Terminal-first Agent Operations dashboard for AVP/2 coordinated runs.
// The web dashboard can expose several panels at once; the TUI presents the
// same controls as numbered panes with stable geometry and contextual keys.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TuiThemePalette } from '../theme'
import { getProviderAccent } from '../theme'
import { AGENT_PROTOCOL_VERSION } from '../../lib/agentProtocol'
import type { AgentProtocolEvent, ProtocolAgent, ProtocolRun, ProtocolRunSnapshot, ProtocolTask } from '../../lib/agentProtocol'
import {
  appendTuiProtocolEvent,
  cleanupTuiProtocolRunWorktrees,
  deleteTuiProtocolRun,
  interruptTuiSessionTurn,
  listTuiProtocolRuns,
  listTuiWorktreeTasks,
  mergeTuiWorktreeTask,
  readTuiProtocolRun,
  stopTuiProtocolRun,
  type WorktreeTask,
} from '../../lib/tui/service'

type CoordinationKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  /** Run to show first; latest run when omitted. */
  initialRunId?: string | null
  onOpenSession: (agent: ProtocolAgent) => void
  onNewRun: () => void
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onCopyJoinCommand?: (runId: string) => void
  onKeyHandlerReady: (handler: (key: CoordinationKeyEvent) => void) => void
}

type Section = 'overview' | 'team' | 'tasks' | 'events'
type TaskFilter = 'all' | 'attention' | 'active' | 'done'
type EventFilter = 'all' | 'attention' | 'messages' | 'tasks'

type PendingAction =
  | { kind: 'stop' }
  | { kind: 'delete-run' }
  | { kind: 'merge'; agent: ProtocolAgent; worktree: WorktreeTask }
  | { kind: 'fail-task'; task: ProtocolTask }

const POLL_MS = 2000
const WORKTREE_STATS_MS = 10_000
const SECTIONS: Section[] = ['overview', 'team', 'tasks', 'events']
const SECTION_LABELS: Record<Section, string> = {
  overview: 'Overview',
  team: 'Team',
  tasks: 'Work board',
  events: 'Activity',
}
const TASK_FILTERS: TaskFilter[] = ['all', 'attention', 'active', 'done']
const EVENT_FILTERS: EventFilter[] = ['all', 'attention', 'messages', 'tasks']
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_TASK_STATUSES = new Set(['claimed', 'planning', 'planned', 'in_progress'])
const ATTENTION_EVENT_TYPES = new Set(['agent.blocked', 'task.failed', 'lock.denied', 'plan.rejected', 'review.requested'])
const MESSAGE_EVENT_TYPES = new Set(['message', 'finding', 'learning', 'handoff'])

function statusColor(status: string, theme: TuiThemePalette): string {
  switch (status) {
    case 'completed': case 'done': return theme.green
    case 'blocked': case 'failed': return theme.red
    case 'working': case 'in_progress': case 'running': case 'synthesizing': return theme.amber
    case 'claimed': case 'planning': case 'planned': return theme.cyan
    default: return theme.dim
  }
}

function eventColor(event: AgentProtocolEvent, theme: TuiThemePalette): string {
  if (event.type === 'finding' || event.type === 'learning' || event.type === 'task.completed' || event.type === 'plan.approved') return theme.green
  if (MESSAGE_EVENT_TYPES.has(event.type)) return theme.violet
  if (ATTENTION_EVENT_TYPES.has(event.type)) return theme.red
  return theme.dim
}

function formatAge(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function fitTextLocal(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 0))}…`
}

function wrapLines(text: string, width: number, maxLines: number): string[] {
  if (!text.trim() || width <= 0 || maxLines <= 0) return []
  const lines: string[] = []
  for (const sourceLine of text.split('\n')) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      if (!line) {
        line = word.length > width ? fitTextLocal(word, width) : word
      } else if (line.length + word.length + 1 <= width) {
        line += ` ${word}`
      } else {
        lines.push(line)
        line = word.length > width ? fitTextLocal(word, width) : word
        if (lines.length >= maxLines) return lines
      }
    }
    if (line) lines.push(line)
    if (lines.length >= maxLines) return lines
  }
  return lines
}

function centeredWindowStart(cursor: number, count: number, rows: number): number {
  if (count <= rows) return 0
  return Math.max(0, Math.min(cursor - Math.floor(rows / 2), count - rows))
}

function cycleValue<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current)
  return values[(index + 1) % values.length] ?? values[0]!
}

function taskFilterMatches(task: ProtocolTask, filter: TaskFilter, awaitingPlan: boolean): boolean {
  if (filter === 'attention') return task.status === 'blocked' || task.status === 'failed' || awaitingPlan
  if (filter === 'active') return ACTIVE_TASK_STATUSES.has(task.status)
  if (filter === 'done') return TERMINAL_TASK_STATUSES.has(task.status)
  return true
}

function eventFilterMatches(event: AgentProtocolEvent, filter: EventFilter): boolean {
  if (filter === 'attention') return ATTENTION_EVENT_TYPES.has(event.type)
  if (filter === 'messages') return MESSAGE_EVENT_TYPES.has(event.type)
  if (filter === 'tasks') return event.type.startsWith('task.') || event.type.startsWith('plan.')
  return true
}

export function CoordinationPopover({
  theme,
  width,
  height,
  initialRunId,
  onOpenSession,
  onNewRun,
  onClose,
  onNotice,
  onCopyJoinCommand,
  onKeyHandlerReady,
}: Props) {
  const [runs, setRuns] = useState<ProtocolRun[]>([])
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null)
  const [snapshot, setSnapshot] = useState<ProtocolRunSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [teamIndex, setTeamIndex] = useState(0)
  const [taskIndex, setTaskIndex] = useState(0)
  const [eventIndex, setEventIndex] = useState(-1) // -1 = follow tail
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [worktreeStats, setWorktreeStats] = useState<Map<string, WorktreeTask>>(new Map())
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const refreshRuns = useCallback(async () => {
    const nextRuns = await listTuiProtocolRuns(20)
    setRuns(nextRuns)
    setRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : initialRunId && nextRuns.some((run) => run.id === initialRunId) ? initialRunId : nextRuns[0]?.id ?? null)
    return nextRuns
  }, [initialRunId])

  const refreshSnapshot = useCallback(async (targetRunId: string) => {
    const next = await readTuiProtocolRun(targetRunId)
    setSnapshot(next)
    setLoadError(next ? null : 'Run not found')
    setNow(Date.now())
    if (next) setRuns((current) => current.map((run) => run.id === next.run.id ? next.run : run))
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    void refreshRuns().catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to list runs')
    })
    return () => { cancelled = true }
  }, [refreshRuns])

  useEffect(() => {
    if (!runId) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    const poll = () => {
      void refreshSnapshot(runId).catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load run')
      })
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [refreshSnapshot, runId])

  useEffect(() => {
    const baseCwd = snapshot?.run.baseCwd
    if (!baseCwd) return
    let cancelled = false
    const refresh = () => {
      void listTuiWorktreeTasks(baseCwd).then((tasks) => {
        if (!cancelled) setWorktreeStats(new Map(tasks.map((task) => [task.path, task])))
      }).catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, WORKTREE_STATS_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [snapshot?.run.baseCwd])

  const run = snapshot?.run ?? null
  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const planStates = useMemo(() => {
    const states = new Map<string, 'awaiting' | 'approved' | 'rejected'>()
    for (const event of events) {
      if (!event.taskId) continue
      if (event.type === 'task.planned') states.set(event.taskId, 'awaiting')
      else if (event.type === 'plan.approved') states.set(event.taskId, 'approved')
      else if (event.type === 'plan.rejected') states.set(event.taskId, 'rejected')
    }
    return states
  }, [events])
  const filteredTasks = useMemo(
    () => tasks.filter((task) => taskFilterMatches(task, taskFilter, planStates.get(task.id) === 'awaiting')),
    [planStates, taskFilter, tasks],
  )
  const filteredEvents = useMemo(
    () => events.flatMap((event, sourceIndex) => eventFilterMatches(event, eventFilter) ? [{ event, sourceIndex }] : []),
    [eventFilter, events],
  )
  const clampedTeam = agents.length === 0 ? 0 : Math.min(teamIndex, agents.length - 1)
  const clampedTask = filteredTasks.length === 0 ? 0 : Math.min(taskIndex, filteredTasks.length - 1)
  const clampedEvent = filteredEvents.length === 0 ? 0 : eventIndex < 0 ? filteredEvents.length - 1 : Math.min(eventIndex, filteredEvents.length - 1)
  const selectedAgent = agents[clampedTeam] ?? null
  const selectedTask = filteredTasks[clampedTask] ?? null
  const selectedEventEntry = filteredEvents[clampedEvent] ?? null
  const selectedEvent = selectedEventEntry?.event ?? null
  const selectedOwner = selectedTask?.ownerAgentId ? agentsById.get(selectedTask.ownerAgentId) ?? null : null
  const selectedLocks = selectedAgent ? (snapshot?.locks ?? []).filter((lock) => lock.agentId === selectedAgent.id && lock.status === 'active') : []

  const terminalRun = run ? ['completed', 'failed', 'stopped'].includes(run.status) : false
  const undeliveredMail = (snapshot?.messages ?? []).filter((message) => !message.deliveredAt).length
  const actionableMail = terminalRun ? 0 : undeliveredMail
  const liveCount = agents.filter((agent) => agent.turnActive).length
  const workingCount = agents.filter((agent) => agent.status === 'working' || agent.turnActive).length
  const doneCount = agents.filter((agent) => ['done', 'failed', 'stopped'].includes(agent.status)).length
  const blockedAgents = agents.filter((agent) => agent.status === 'blocked' || agent.status === 'failed')
  const blockedTasks = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed')
  const pendingPlans = tasks.filter((task) => planStates.get(task.id) === 'awaiting')
  const attentionCount = terminalRun ? 0 : blockedAgents.length + blockedTasks.length + pendingPlans.length + actionableMail
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const taskProgress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0
  const lastEventAt = events.at(-1)?.timestamp
  const runIndex = runId ? runs.findIndex((entry) => entry.id === runId) : -1
  const runHealth = run?.status === 'completed'
    ? { label: 'COMPLETED', color: theme.green }
    : run?.status === 'failed'
      ? { label: 'FAILED', color: theme.red }
      : run?.status === 'stopped'
        ? { label: 'STOPPED', color: theme.dim }
        : run?.status === 'blocked' || attentionCount > 0
          ? { label: 'NEEDS ATTENTION', color: theme.red }
          : liveCount > 0 || workingCount > 0
            ? { label: 'ACTIVE', color: theme.amber }
            : { label: 'WAITING', color: theme.cyan }

  const sendTeamMessage = useCallback(async () => {
    const body = messageDraft.trim()
    if (!body || !messageTarget || !runId || busy) return
    setBusy(true)
    try {
      const next = await appendTuiProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: 'user',
        type: 'message',
        to: messageTarget,
        summary: body,
      })
      if (next) setSnapshot(next)
      onNotice('info', `Message sent to ${messageTarget} — delivered live or queued`, 4000)
      setMessageTarget(null)
      setMessageDraft('')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setBusy(false)
    }
  }, [busy, messageDraft, messageTarget, onNotice, runId])

  const reviewPlan = useCallback(async (task: ProtocolTask, approved: boolean) => {
    if (!runId || busy) return
    setBusy(true)
    try {
      const next = await appendTuiProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: 'user',
        type: approved ? 'plan.approved' : 'plan.rejected',
        taskId: task.id,
        summary: approved ? `${task.id} plan approved from Agent Operations` : `${task.id} plan rejected from Agent Operations`,
      })
      if (next) setSnapshot(next)
      onNotice('info', `${task.id} plan ${approved ? 'approved' : 'rejected'}`, 4000)
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to review plan')
    } finally {
      setBusy(false)
    }
  }, [busy, onNotice, runId])

  const runPendingAction = useCallback(async (action: PendingAction) => {
    if (!runId || busy) return
    setBusy(true)
    try {
      if (action.kind === 'stop') {
        const next = await stopTuiProtocolRun(runId)
        setSnapshot(next)
        onNotice('info', 'Run stopped — live turns interrupted', 4000)
      } else if (action.kind === 'delete-run') {
        const result = await deleteTuiProtocolRun(runId)
        onNotice('info', result.keptWorktrees.length > 0
          ? `Run deleted · kept ${result.keptWorktrees.length} worktree${result.keptWorktrees.length === 1 ? '' : 's'} with unmerged work`
          : 'Run deleted — clean worktrees removed', 6000)
        const remaining = runs.filter((entry) => entry.id !== runId)
        setRuns(remaining)
        setRunId(remaining[0]?.id ?? null)
        setSnapshot(null)
        setEventIndex(-1)
        setTaskIndex(0)
        if (remaining.length === 0) setLoadError(null)
      } else if (action.kind === 'merge') {
        const result = await mergeTuiWorktreeTask(action.worktree)
        onNotice('info', result.staged
          ? `Merged ${action.agent.name}'s worktree — staged in the main checkout (⇧U to review)`
          : `${action.agent.name}'s worktree has no changes to merge`, 6000)
        const baseCwd = snapshot?.run.baseCwd
        if (baseCwd) {
          const nextTasks = await listTuiWorktreeTasks(baseCwd).catch(() => [] as WorktreeTask[])
          setWorktreeStats(new Map(nextTasks.map((task) => [task.path, task])))
        }
      } else {
        const next = await appendTuiProtocolEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId,
          agentId: 'user',
          type: 'task.failed',
          taskId: action.task.id,
          summary: `${action.task.id} marked failed from Agent Operations`,
        })
        if (next) setSnapshot(next)
        onNotice('info', `${action.task.id} marked failed`, 4000)
      }
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [busy, onNotice, runId, runs, snapshot?.run.baseCwd])

  const interruptAgentTurn = useCallback(async (agent: ProtocolAgent) => {
    try {
      await interruptTuiSessionTurn({ sessionId: agent.sessionId })
      onNotice('info', `Interrupted ${agent.name}'s turn`, 3500)
    } catch {
      onNotice('info', `${agent.name} has no live turn to interrupt`, 3000)
    }
  }, [onNotice])

  const cleanupRun = useCallback(async () => {
    if (!runId || busy) return
    setBusy(true)
    try {
      const result = await cleanupTuiProtocolRunWorktrees(runId)
      setSnapshot(result.snapshot)
      const removed = result.results.filter((entry) => entry.status === 'removed').length
      const skipped = result.results.filter((entry) => entry.status === 'skipped').length
      const failed = result.results.filter((entry) => entry.status === 'failed').length
      onNotice('info', `Cleaned ${removed} worktree${removed === 1 ? '' : 's'}${skipped || failed ? ` · skipped ${skipped} · failed ${failed}` : ''}`, 5000)
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to clean up worktrees')
    } finally {
      setBusy(false)
    }
  }, [busy, onNotice, runId])

  const refreshAll = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await Promise.all([refreshRuns(), runId ? refreshSnapshot(runId) : Promise.resolve(null)])
      onNotice('info', 'Agent Operations refreshed', 2500)
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }, [busy, onNotice, refreshRuns, refreshSnapshot, runId])

  const switchRun = useCallback((direction: 1 | -1) => {
    if (runs.length < 2 || !runId) return
    const current = Math.max(runs.findIndex((entry) => entry.id === runId), 0)
    const nextIndex = Math.max(0, Math.min(runs.length - 1, current + direction))
    const next = runs[nextIndex]
    if (!next || next.id === runId) return
    setRunId(next.id)
    setSnapshot(null)
    setTeamIndex(0)
    setTaskIndex(0)
    setEventIndex(-1)
  }, [runId, runs])

  const handleKey = useCallback((key: CoordinationKeyEvent) => {
    if (messageTarget !== null) {
      if (key.name === 'escape') {
        setMessageTarget(null)
        setMessageDraft('')
      } else if (key.name === 'return') {
        void sendTeamMessage()
      }
      return
    }
    if (pending) {
      if (key.name === 'y' || key.name === 'return') void runPendingAction(pending)
      else if (key.name === 'n' || key.name === 'escape') setPending(null)
      return
    }
    if (key.name === 'escape' || key.name === 'q') { onClose(); return }
    if (key.name === 'tab') {
      setSection((current) => cycleValue(SECTIONS, current))
      return
    }
    if (key.sequence >= '1' && key.sequence <= '4') {
      const next = SECTIONS[Number.parseInt(key.sequence, 10) - 1]
      if (next) setSection(next)
      return
    }
    if (key.sequence === '[') { switchRun(1); return }
    if (key.sequence === ']') { switchRun(-1); return }
    if (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up') {
      const delta = key.name === 'j' || key.name === 'down' ? 1 : -1
      if (section === 'team') setTeamIndex(Math.max(0, Math.min(clampedTeam + delta, agents.length - 1)))
      else if (section === 'tasks') setTaskIndex(Math.max(0, Math.min(clampedTask + delta, filteredTasks.length - 1)))
      else if (section === 'events') setEventIndex(Math.max(0, Math.min(clampedEvent + delta, filteredEvents.length - 1)))
      else switchRun(delta as 1 | -1)
      return
    }
    if (key.name === 'return') {
      if (section === 'team' && selectedAgent) {
        onOpenSession(selectedAgent)
        onClose()
      } else if (section === 'overview' && runId) {
        setSection('team')
      }
      return
    }
    if (key.name === 'v' && section === 'tasks') {
      setTaskFilter((current) => cycleValue(TASK_FILTERS, current))
      setTaskIndex(0)
      return
    }
    if (key.name === 'v' && section === 'events') {
      setEventFilter((current) => cycleValue(EVENT_FILTERS, current))
      setEventIndex(-1)
      return
    }
    if (key.name === 'm' && key.shift) {
      setMessageTarget('all')
      setMessageDraft('')
      return
    }
    if (key.name === 'i' && runId) {
      onCopyJoinCommand?.(runId)
      return
    }
    if (key.name === 'm') {
      const target = section === 'team' && selectedAgent
        ? selectedAgent.name
        : section === 'tasks' && selectedOwner
          ? selectedOwner.name
          : 'lead'
      setMessageTarget(target)
      setMessageDraft('')
      return
    }
    if (key.name === 's') {
      if (run && ['planning', 'running', 'synthesizing'].includes(run.status)) setPending({ kind: 'stop' })
      else onNotice('info', 'Run is not active', 2500)
      return
    }
    if (key.name === 'd' && key.shift) {
      if (snapshot) setPending({ kind: 'delete-run' })
      return
    }
    if (key.name === 'x' && section === 'team' && selectedAgent) {
      void interruptAgentTurn(selectedAgent)
      return
    }
    if (key.name === 'w' && section === 'team' && selectedAgent) {
      const worktree = worktreeStats.get(selectedAgent.worktreePath)
      if (!worktree) onNotice('info', `${selectedAgent.name} has no merge-ready worktree`, 3000)
      else setPending({ kind: 'merge', agent: selectedAgent, worktree })
      return
    }
    if (key.name === 'a' && section === 'tasks' && selectedTask && planStates.get(selectedTask.id) === 'awaiting') {
      void reviewPlan(selectedTask, true)
      return
    }
    if (key.name === 'r' && section === 'tasks' && selectedTask && planStates.get(selectedTask.id) === 'awaiting') {
      void reviewPlan(selectedTask, false)
      return
    }
    if (key.name === 'f' && section === 'tasks' && selectedTask) {
      if (TERMINAL_TASK_STATUSES.has(selectedTask.status)) onNotice('info', `${selectedTask.id} is already terminal`, 2500)
      else setPending({ kind: 'fail-task', task: selectedTask })
      return
    }
    if (key.name === 'c') { void cleanupRun(); return }
    if (key.name === 'n') { onClose(); onNewRun(); return }
    if (key.name === 'g' && section === 'events') { setEventIndex(-1); return }
    if (key.name === 'r' || (key.name === 'r' && key.shift)) { void refreshAll(); return }
  }, [agents.length, clampedEvent, clampedTask, clampedTeam, cleanupRun, filteredEvents.length, filteredTasks.length, interruptAgentTurn, messageTarget, onClose, onCopyJoinCommand, onNewRun, onNotice, onOpenSession, pending, planStates, refreshAll, reviewPlan, run, runId, runPendingAction, section, selectedAgent, selectedOwner, selectedTask, sendTeamMessage, snapshot, switchRun, worktreeStats])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(Math.max(width - 2, 1), 150)
  const popH = Math.min(Math.max(height - 2, 1), 48)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = Math.max(popW - 4, 1)
  const headerH = 4
  const tabsH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - tabsH - footerH - 2, 8)
  const leftW = Math.max(Math.floor(innerW * 0.42), 1)
  const rightW = Math.max(innerW - leftW - 2, 1)
  const activityLeftW = Math.max(Math.floor(innerW * 0.62), 1)
  const activityRightW = Math.max(innerW - activityLeftW - 2, 1)

  const teamRows = Math.max(bodyH - 2, 4)
  const teamStart = centeredWindowStart(clampedTeam, agents.length, teamRows)
  const visibleAgents = agents.slice(teamStart, teamStart + teamRows)
  const taskRows = Math.max(bodyH - 2, 4)
  const taskStart = centeredWindowStart(clampedTask, filteredTasks.length, taskRows)
  const visibleTasks = filteredTasks.slice(taskStart, taskStart + taskRows)
  const eventRows = Math.max(bodyH - 2, 4)
  const eventStart = centeredWindowStart(clampedEvent, filteredEvents.length, eventRows)
  const visibleEvents = filteredEvents.slice(eventStart, eventStart + eventRows)

  const pendingLabel = pending?.kind === 'stop'
    ? 'Stop run and interrupt every live turn? y/Enter confirm · n/Esc cancel'
    : pending?.kind === 'delete-run'
      ? 'DELETE run ledger? Clean worktrees removed; unmerged work kept. y/Enter · n/Esc'
      : pending?.kind === 'merge'
        ? `Squash-merge ${pending.agent.name}'s worktree into main checkout? y/Enter · n/Esc`
        : pending?.kind === 'fail-task'
          ? `Mark ${pending.task.id} failed? y/Enter · n/Esc`
          : null
  const footerHint = messageTarget !== null
    ? `message -> ${messageTarget} · Enter send · Esc cancel`
    : pendingLabel
      ? pendingLabel
      : section === 'overview'
        ? 'j/k or [/] runs · r refresh · i invite CLI · m lead · M all · s stop · c clean · D delete · n new · q close'
        : section === 'team'
          ? 'j/k select · Enter transcript · m message · M all · x interrupt · w merge · Tab pane · q close'
          : section === 'tasks'
            ? `j/k select · v filter:${taskFilter} · m owner · a approve · r reject · f fail · Tab pane · q close`
            : `j/k events · v filter:${eventFilter} · g live tail · m lead · M all · Tab pane · q close`

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={70}
      flexDirection="column"
      title=" Agent operations "
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box height={1} flexDirection="row" alignItems="center">
          {run ? (
            <>
              <text fg={runHealth.color} wrapMode="none">{runHealth.label}</text>
              <text fg={theme.dim} wrapMode="none">{` · ${String(run.provider).toUpperCase()} · ${formatAge(run.createdAt, now)} ago · `}</text>
              <box flexGrow={1} overflow="hidden">
                <text fg={theme.text} wrapMode="none">{fitTextLocal(run.prompt.split('\n')[0] ?? '', Math.max(innerW - 52, 12))}</text>
              </box>
              {runs.length > 1 ? <text fg={theme.dim} wrapMode="none">{` ${runIndex + 1}/${runs.length}`}</text> : null}
              {busy ? <text fg={theme.amber} wrapMode="none"> busy</text> : null}
            </>
          ) : (
            <text fg={loadError ? theme.red : theme.dim} wrapMode="none">{loadError ?? 'No coordinated runs yet — press n to start one.'}</text>
          )}
        </box>
        <box height={1} flexDirection="row" alignItems="center">
          <text fg={taskProgress === 100 ? theme.green : theme.cyan} wrapMode="none">{`TASKS ${taskProgress}% ${completedTasks}/${tasks.length}`}</text>
          <text fg={theme.dim} wrapMode="none">{'  |  '}</text>
          <text fg={workingCount > 0 ? theme.amber : theme.text} wrapMode="none">{`AGENTS ${agents.length} · ${workingCount} working · ${doneCount} done`}</text>
          <text fg={theme.dim} wrapMode="none">{'  |  '}</text>
          <text fg={attentionCount > 0 ? theme.red : theme.green} wrapMode="none">{`ATTENTION ${attentionCount}`}</text>
          <text fg={theme.dim} wrapMode="none">{'  |  '}</text>
          <text fg={theme.muted} wrapMode="none">{`LAST ${lastEventAt ? formatAge(lastEventAt, now) : '—'}`}</text>
          {liveCount > 0 ? <text fg={theme.amber} wrapMode="none">{`  ● ${liveCount} live`}</text> : null}
          {actionableMail > 0 ? <text fg={theme.violet} wrapMode="none">{`  MAIL ${actionableMail}`}</text> : null}
        </box>
      </box>

      <box height={tabsH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        {SECTIONS.map((item, index) => (
          <box key={item} paddingX={1} marginRight={1} backgroundColor={section === item ? theme.cyan : 'transparent'}>
            <text fg={section === item ? theme.surface : theme.muted} wrapMode="none">{`[${index + 1}] ${SECTION_LABELS[item]}`}</text>
          </box>
        ))}
        <box flexGrow={1} />
        {runs.length > 1 ? <text fg={theme.dim} wrapMode="none">{'[/] run  '}</text> : null}
        <text fg={theme.dim} wrapMode="none">{'Tab panes'}</text>
      </box>

      <box flexGrow={1} minHeight={0} paddingX={1} paddingTop={1} overflow="hidden">
        {section === 'overview' ? (
          <box width={innerW} height={bodyH} flexDirection="column" overflow="hidden">
            {attentionCount > 0 ? (
              <box height={3} border borderStyle="single" borderColor={theme.red} paddingX={1} flexDirection="column">
                <text fg={theme.red} wrapMode="none">{`NEEDS ATTENTION · ${attentionCount}`}</text>
                <text fg={theme.muted} wrapMode="none">
                  {fitTextLocal([
                    pendingPlans.length > 0 ? `${pendingPlans.length} plan${pendingPlans.length === 1 ? '' : 's'} awaiting review` : '',
                    blockedAgents.length > 0 ? `${blockedAgents.length} blocked agent${blockedAgents.length === 1 ? '' : 's'}` : '',
                    blockedTasks.length > 0 ? `${blockedTasks.length} blocked/failed task${blockedTasks.length === 1 ? '' : 's'}` : '',
                    actionableMail > 0 ? `${actionableMail} undelivered message${actionableMail === 1 ? '' : 's'}` : '',
                  ].filter(Boolean).join(' · '), innerW - 4)}
                </text>
              </box>
            ) : (
              <box height={2} flexDirection="row">
                <text fg={terminalRun ? theme.green : theme.cyan} wrapMode="none">{terminalRun ? 'No pending operator actions' : 'Run healthy · no operator action needed'}</text>
              </box>
            )}
            <box marginTop={1} flexDirection="column">
              <text fg={theme.cyan} wrapMode="none">OBJECTIVE</text>
              {wrapLines(run?.prompt ?? '', innerW - 2, 4).map((line, index) => (
                <text key={index} fg={index === 0 ? theme.text : theme.muted} wrapMode="none">{line}</text>
              ))}
            </box>
            {run ? (
              <box marginTop={1} flexDirection="column">
                <text fg={theme.cyan} wrapMode="none">RUN CONTROL</text>
                <text fg={theme.muted} wrapMode="none">{fitTextLocal(`id ${run.id}`, innerW - 2)}</text>
                <text fg={theme.muted} wrapMode="none">{fitTextLocal(`worktree ${run.baseCwd}`, innerW - 2)}</text>
                <text fg={theme.muted} wrapMode="none">{`capacity ${run.maxAgents} · plans ${run.requirePlanApproval ? 'required' : 'off'} · gate ${run.gateCommand || 'off'}`}</text>
              </box>
            ) : null}
            {runs.length > 0 ? (
              <box marginTop={1} flexDirection="column">
                <text fg={theme.cyan} wrapMode="none">{`RECENT RUNS · ${runs.length}`}</text>
                {runs.slice(Math.max(runIndex - 1, 0), Math.max(runIndex - 1, 0) + 4).map((entry) => (
                  <text key={entry.id} fg={entry.id === runId ? theme.text : theme.dim} wrapMode="none">
                    {fitTextLocal(`${entry.id === runId ? '▸' : ' '} ${entry.status.toUpperCase()} ${formatAge(entry.createdAt, now)} ${entry.prompt.split('\n')[0] ?? ''}`, innerW - 2)}
                  </text>
                ))}
              </box>
            ) : null}
            {run?.summary ? (
              <box marginTop={1} flexDirection="column">
                <text fg={theme.green} wrapMode="none">RUN SYNTHESIS</text>
                {wrapLines(run.summary, innerW - 2, 4).map((line, index) => (
                  <text key={index} fg={index === 0 ? theme.text : theme.muted} wrapMode="none">{line}</text>
                ))}
              </box>
            ) : null}
          </box>
        ) : null}

        {section === 'team' ? (
          <box width={innerW} height={bodyH} flexDirection="row" overflow="hidden">
            <box width={leftW} border={['right']} borderStyle="single" borderColor={theme.border} flexDirection="column" overflow="hidden">
              <text fg={theme.cyan} wrapMode="none">{`TEAM · ${agents.length}  ${clampedTeam + 1}/${Math.max(agents.length, 1)}`}</text>
              {visibleAgents.map((agent, visibleIndex) => {
                const absolute = teamStart + visibleIndex
                const selected = absolute === clampedTeam
                const stats = worktreeStats.get(agent.worktreePath)
                const worktreeLabel = stats ? `${stats.aheadCommits > 0 ? ` +${stats.aheadCommits}` : ''}${stats.dirtyFiles > 0 ? ` ~${stats.dirtyFiles}` : ''}` : ''
                return (
                  <box key={agent.id} height={2} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="column">
                    <box height={1} flexDirection="row">
                      <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▸' : ' '}</text>
                      <text fg={agent.role === 'lead' ? theme.amber : getProviderAccent(agent.provider)} wrapMode="none">{agent.role === 'lead' ? '★ ' : '· '}</text>
                      <text fg={selected ? theme.text : theme.muted} wrapMode="none">{fitTextLocal(agent.name, leftW - 18)}</text>
                      <text fg={statusColor(agent.status, theme)} wrapMode="none">{` ${agent.status}`}</text>
                      {agent.turnActive ? <text fg={theme.amber} wrapMode="none">{' ●'}</text> : null}
                    </box>
                    <text fg={theme.dim} wrapMode="none">{fitTextLocal(`   ${agent.taskId ?? 'no task'}${worktreeLabel}`, leftW - 2)}</text>
                  </box>
                )
              })}
            </box>
            <box width={rightW} marginLeft={2} flexDirection="column" overflow="hidden">
              <text fg={theme.cyan} wrapMode="none">AGENT INSPECTOR</text>
              {selectedAgent ? (
                <>
                  <text fg={theme.text} wrapMode="none">{`${selectedAgent.name} · ${selectedAgent.role.toUpperCase()}`}</text>
                  <text fg={statusColor(selectedAgent.status, theme)} wrapMode="none">{`${String(selectedAgent.provider).toUpperCase()} · ${selectedAgent.status}${selectedAgent.turnActive ? ' · streaming' : ''}`}</text>
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.dim} wrapMode="none">TASK</text>
                    <text fg={theme.muted} wrapMode="none">{selectedAgent.taskId ?? 'No task claimed'}</text>
                  </box>
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.dim} wrapMode="none">WORKTREE</text>
                    <text fg={theme.muted} wrapMode="none">{fitTextLocal(selectedAgent.worktreePath || 'shared checkout', rightW - 1)}</text>
                    <text fg={theme.muted} wrapMode="none">{fitTextLocal(selectedAgent.worktreeBranch || 'no branch', rightW - 1)}</text>
                    {(() => {
                      const stats = worktreeStats.get(selectedAgent.worktreePath)
                      return stats ? <text fg={stats.dirtyFiles > 0 || stats.aheadCommits > 0 ? theme.amber : theme.green} wrapMode="none">{`${stats.dirtyFiles} dirty · ${stats.aheadCommits} ahead`}</text> : null
                    })()}
                  </box>
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.dim} wrapMode="none">LOCKS</text>
                    {selectedLocks.length > 0 ? selectedLocks.slice(0, 5).map((lock) => (
                      <text key={lock.id} fg={theme.muted} wrapMode="none">{fitTextLocal(`${lock.mode} ${lock.path}`, rightW - 1)}</text>
                    )) : <text fg={theme.muted} wrapMode="none">No active path locks</text>}
                  </box>
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.dim} wrapMode="none">LAST SEEN</text>
                    <text fg={theme.muted} wrapMode="none">{selectedAgent.lastSeenAt ? `${formatAge(selectedAgent.lastSeenAt, now)} ago` : 'unknown'}</text>
                  </box>
                </>
              ) : <text fg={theme.dim} wrapMode="none">No participants</text>}
            </box>
          </box>
        ) : null}

        {section === 'tasks' ? (
          <box width={innerW} height={bodyH} flexDirection="row" overflow="hidden">
            <box width={leftW} border={['right']} borderStyle="single" borderColor={theme.border} flexDirection="column" overflow="hidden">
              <text fg={theme.cyan} wrapMode="none">{`WORK BOARD · ${taskFilter.toUpperCase()} · ${filteredTasks.length}/${tasks.length}`}</text>
              {visibleTasks.length === 0 ? <text fg={theme.dim} wrapMode="none">No tasks in this view</text> : visibleTasks.map((task, visibleIndex) => {
                const absolute = taskStart + visibleIndex
                const selected = absolute === clampedTask
                const planState = planStates.get(task.id)
                return (
                  <box key={task.id} height={2} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="column">
                    <box height={1} flexDirection="row">
                      <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▸' : ' '}</text>
                      <text fg={statusColor(task.status, theme)} wrapMode="none">{`${task.id} ${task.status}`}</text>
                      {planState === 'awaiting' ? <text fg={theme.red} wrapMode="none">{' PLAN'}</text> : null}
                    </box>
                    <text fg={selected ? theme.text : theme.muted} wrapMode="none">{fitTextLocal(`  ${task.title}`, leftW - 2)}</text>
                  </box>
                )
              })}
            </box>
            <box width={rightW} marginLeft={2} flexDirection="column" overflow="hidden">
              <text fg={theme.cyan} wrapMode="none">TASK INSPECTOR</text>
              {selectedTask ? (
                <>
                  <box flexDirection="row">
                    <text fg={statusColor(selectedTask.status, theme)} wrapMode="none">{`${selectedTask.id} · ${selectedTask.status.toUpperCase()}`}</text>
                    {planStates.get(selectedTask.id) ? <text fg={planStates.get(selectedTask.id) === 'awaiting' ? theme.red : theme.green} wrapMode="none">{` · plan ${planStates.get(selectedTask.id)}`}</text> : null}
                  </box>
                  <text fg={theme.text} wrapMode="none">{fitTextLocal(selectedTask.title, rightW - 1)}</text>
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.dim} wrapMode="none">OWNER</text>
                    <text fg={theme.muted} wrapMode="none">{selectedOwner?.name ?? selectedTask.ownerAgentId ?? 'Unassigned'}</text>
                  </box>
                  {selectedTask.blockedBy.length > 0 ? (
                    <box marginTop={1} flexDirection="column">
                      <text fg={theme.dim} wrapMode="none">DEPENDENCIES</text>
                      <text fg={theme.muted} wrapMode="none">{fitTextLocal(selectedTask.blockedBy.join(', '), rightW - 1)}</text>
                    </box>
                  ) : null}
                  {selectedTask.paths.length > 0 ? (
                    <box marginTop={1} flexDirection="column">
                      <text fg={theme.dim} wrapMode="none">PATHS</text>
                      {selectedTask.paths.slice(0, 4).map((path) => <text key={path} fg={theme.muted} wrapMode="none">{fitTextLocal(path, rightW - 1)}</text>)}
                    </box>
                  ) : null}
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.dim} wrapMode="none">BRIEF</text>
                    {wrapLines(selectedTask.prompt, rightW - 1, 8).map((line, index) => <text key={index} fg={theme.muted} wrapMode="none">{line}</text>)}
                  </box>
                </>
              ) : <text fg={theme.dim} wrapMode="none">No task selected</text>}
            </box>
          </box>
        ) : null}

        {section === 'events' ? (
          <box width={innerW} height={bodyH} flexDirection="row" overflow="hidden">
            <box width={activityLeftW} border={['right']} borderStyle="single" borderColor={theme.border} flexDirection="column" overflow="hidden">
              <text fg={theme.cyan} wrapMode="none">{`ACTIVITY · ${eventFilter.toUpperCase()} · ${filteredEvents.length}/${events.length}${eventIndex < 0 ? ' · LIVE' : ''}`}</text>
              {visibleEvents.length === 0 ? <text fg={theme.dim} wrapMode="none">No events in this view</text> : visibleEvents.map(({ event, sourceIndex }, visibleIndex) => {
                const absolute = eventStart + visibleIndex
                const selected = absolute === clampedEvent
                const who = agentsById.get(event.agentId)?.name ?? event.agentId
                return (
                  <box key={`${event.timestamp ?? sourceIndex}:${sourceIndex}`} height={2} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="column">
                    <box height={1} flexDirection="row">
                      <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▸' : ' '}</text>
                      <text fg={eventColor(event, theme)} wrapMode="none">{fitTextLocal(`${who} · ${event.type}${event.to ? ` -> ${event.to}` : ''}`, activityLeftW - 2)}</text>
                    </box>
                    <text fg={selected ? theme.text : theme.dim} wrapMode="none">{fitTextLocal(`  ${event.summary ?? event.detail ?? ''}`, activityLeftW - 2)}</text>
                  </box>
                )
              })}
            </box>
            <box width={activityRightW} marginLeft={2} flexDirection="column" overflow="hidden">
              <text fg={theme.cyan} wrapMode="none">EVENT INSPECTOR</text>
              {selectedEvent ? (
                <>
                  <text fg={eventColor(selectedEvent, theme)} wrapMode="none">{fitTextLocal(selectedEvent.type, activityRightW - 1)}</text>
                  <text fg={theme.muted} wrapMode="none">{fitTextLocal(`agent ${agentsById.get(selectedEvent.agentId)?.name ?? selectedEvent.agentId}`, activityRightW - 1)}</text>
                  {selectedEvent.taskId ? <text fg={theme.muted} wrapMode="none">{fitTextLocal(`task ${selectedEvent.taskId}`, activityRightW - 1)}</text> : null}
                  {selectedEvent.paths?.length ? <text fg={theme.muted} wrapMode="none">{fitTextLocal(`paths ${selectedEvent.paths.join(', ')}`, activityRightW - 1)}</text> : null}
                  <box marginTop={1} flexDirection="column">
                    {wrapLines(selectedEvent.detail ?? selectedEvent.summary ?? '', activityRightW - 1, 10).map((line, index) => (
                      <text key={index} fg={index === 0 ? theme.text : theme.muted} wrapMode="none">{line}</text>
                    ))}
                  </box>
                </>
              ) : <text fg={theme.dim} wrapMode="none">No event selected</text>}
              {run?.summary ? (
                <box marginTop={1} flexDirection="column">
                  <text fg={theme.green} wrapMode="none">RUN SYNTHESIS</text>
                  {wrapLines(run.summary, activityRightW - 1, 7).map((line, index) => (
                    <text key={index} fg={index === 0 ? theme.text : theme.muted} wrapMode="none">{line}</text>
                  ))}
                </box>
              ) : null}
            </box>
          </box>
        ) : null}
      </box>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        {messageTarget !== null ? (
          <box flexDirection="row" alignItems="center" flexGrow={1}>
            <text fg={theme.violet} wrapMode="none">{`-> ${messageTarget}: `}</text>
            <box flexGrow={1} backgroundColor={theme.surface3}>
              <input focused value={messageDraft} maxLength={400} onInput={(value: string) => setMessageDraft(value)} onSubmit={() => { void sendTeamMessage() }} />
            </box>
          </box>
        ) : (
          <text fg={pendingLabel ? theme.amber : theme.dim} wrapMode="none">{fitTextLocal(footerHint, innerW)}</text>
        )}
      </box>
    </box>
  )
}

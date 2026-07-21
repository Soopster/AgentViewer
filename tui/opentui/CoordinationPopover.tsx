/** @jsxImportSource @opentui/react */
// Terminal-first Agent Operations dashboard for A2A coordinated runs.
// The web dashboard can expose several panels at once; the TUI presents the
// same controls as numbered panes with stable geometry and contextual keys.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RGBA } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import { CoordinationControlCenter } from './CoordinationControlCenter'
import { GitPopover } from './GitPopover'
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
  onSendDiffNoteToComposer?: (prompt: string) => void
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
  | { kind: 'rerun-agent'; agent: ProtocolAgent; task: ProtocolTask | null }

const POLL_MS = 2000
const WORKTREE_STATS_MS = 10_000
const FLEET_LIMIT = 20
const SECTIONS: Section[] = ['overview', 'tasks', 'team', 'events']
const TASK_FILTERS: TaskFilter[] = ['all', 'attention', 'active', 'done']
const EVENT_FILTERS: EventFilter[] = ['all', 'attention', 'messages', 'tasks']
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_TASK_STATUSES = new Set(['claimed', 'planning', 'planned', 'in_progress'])
const ATTENTION_EVENT_TYPES = new Set(['agent.blocked', 'task.failed', 'lock.denied', 'plan.rejected', 'review.requested'])
const STUCK_AGENT_STATUSES = new Set(['blocked', 'failed', 'stopped'])
const MESSAGE_EVENT_TYPES = new Set(['message', 'finding', 'learning', 'handoff'])
const PROVIDERS = ['codex', 'claude', 'copilot', 'opencode', 'pi'] as const

function cycleValue<T>(values: readonly T[], current: T, direction: 1 | -1 = 1): T {
  const index = values.indexOf(current)
  return values[(index + direction + values.length) % values.length] ?? values[0]!
}

// The Agent Operations key handler owns every keystroke while the board is
// open (App.tsx forwards raw keys here instead of letting them reach a
// natively focused OpenTUI <input> — see coordBoardOpen in App.tsx), so the
// message composer has to build its own draft from key events rather than
// relying on the <input>'s built-in typing.
function isPrintable(key: CoordinationKeyEvent): boolean {
  return !key.ctrl && key.sequence.length === 1 && key.sequence >= ' '
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
  onSendDiffNoteToComposer,
  onKeyHandlerReady,
}: Props) {
  const [runs, setRuns] = useState<ProtocolRun[]>([])
  const [fleetSnapshots, setFleetSnapshots] = useState<Map<string, ProtocolRunSnapshot>>(new Map())
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null)
  const [snapshot, setSnapshot] = useState<ProtocolRunSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [teamIndex, setTeamIndex] = useState(0)
  const [taskCursorId, setTaskCursorId] = useState<string | null>(null)
  const [eventIndex, setEventIndex] = useState(-1) // -1 = follow tail
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [worktreeStats, setWorktreeStats] = useState<Map<string, WorktreeTask>>(new Map())
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [gitAgent, setGitAgent] = useState<ProtocolAgent | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const gitKeyHandlerRef = useRef<((key: CoordinationKeyEvent) => void) | null>(null)

  const refreshRuns = useCallback(async () => {
    const nextRuns = await listTuiProtocolRuns(20)
    setRuns(nextRuns)
    setRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : initialRunId && nextRuns.some((run) => run.id === initialRunId) ? initialRunId : nextRuns[0]?.id ?? null)
    const snapshots = await Promise.all(nextRuns.slice(0, FLEET_LIMIT).map((entry) => readTuiProtocolRun(entry.id).catch(() => null)))
    setFleetSnapshots(new Map(snapshots.flatMap((entry) => entry ? [[entry.run.id, entry] as const] : [])))
    return nextRuns
  }, [initialRunId])

  const refreshSnapshot = useCallback(async (targetRunId: string) => {
    const next = await readTuiProtocolRun(targetRunId)
    setSnapshot(next)
    setLoadError(next ? null : 'Run not found')
    setNow(Date.now())
    if (next) {
      setRuns((current) => current.map((run) => run.id === next.run.id ? next.run : run))
      setFleetSnapshots((current) => {
        if (current.get(next.run.id) === next) return current
        const updated = new Map(current)
        updated.set(next.run.id, next)
        return updated
      })
    }
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
  const navigableTasks = useMemo(() => [
    ...filteredTasks.filter((task) => task.status === 'pending'),
    ...filteredTasks.filter((task) => task.status !== 'pending' && !TERMINAL_TASK_STATUSES.has(task.status)),
    ...filteredTasks.filter((task) => TERMINAL_TASK_STATUSES.has(task.status)),
  ], [filteredTasks])
  const navigableRuns = useMemo(() => [
    ...runs.filter((entry) => entry.status === 'blocked' || entry.status === 'failed'),
    ...runs.filter((entry) => ['planning', 'running', 'synthesizing'].includes(entry.status)),
    ...runs.filter((entry) => entry.status === 'completed' || entry.status === 'stopped'),
  ], [runs])
  const filteredEvents = useMemo(
    () => events.flatMap((event, sourceIndex) => eventFilterMatches(event, eventFilter) ? [{ event, sourceIndex }] : []),
    [eventFilter, events],
  )
  const clampedTeam = agents.length === 0 ? 0 : Math.min(teamIndex, agents.length - 1)
  const taskCursorIndex = taskCursorId ? navigableTasks.findIndex((task) => task.id === taskCursorId) : -1
  const clampedTask = navigableTasks.length === 0 ? 0 : Math.max(taskCursorIndex, 0)
  const clampedEvent = filteredEvents.length === 0 ? 0 : eventIndex < 0 ? filteredEvents.length - 1 : Math.min(eventIndex, filteredEvents.length - 1)
  const selectedAgent = agents[clampedTeam] ?? null
  const selectedTask = navigableTasks[clampedTask] ?? null
  const selectedEventEntry = filteredEvents[clampedEvent] ?? null
  const selectedEvent = selectedEventEntry?.event ?? null
  const selectedOwner = selectedTask?.ownerAgentId ? agentsById.get(selectedTask.ownerAgentId) ?? null : null
  const eventAgent = selectedEvent ? agentsById.get(selectedEvent.agentId) ?? null : null
  const defaultAgent = agents.find((agent) => agent.turnActive || agent.status === 'working') ?? selectedAgent
  const inspectedAgent = section === 'tasks' ? selectedOwner ?? defaultAgent : section === 'events' ? eventAgent ?? defaultAgent : section === 'team' ? selectedAgent : defaultAgent
  const selectedLocks = inspectedAgent ? (snapshot?.locks ?? []).filter((lock) => lock.agentId === inspectedAgent.id && lock.status === 'active') : []

  const stuckAgentTask = useCallback((agent: ProtocolAgent) => (
    (agent.taskId ? tasks.find((task) => task.id === agent.taskId) : undefined)
      ?? tasks.find((task) => task.ownerAgentId === agent.id && (task.status === 'blocked' || task.status === 'failed'))
      ?? null
  ), [tasks])

  const fleet = useMemo(() => {
    const snapshots = runs.flatMap((entry) => {
      const current = entry.id === snapshot?.run.id ? snapshot : fleetSnapshots.get(entry.id)
      return current ? [current] : []
    })
    const allAgents = snapshots.flatMap((entry) => entry.agents)
    const allTasks = snapshots.flatMap((entry) => entry.tasks)
    const attention = snapshots.reduce((total, entry) => {
      if (['completed', 'failed', 'stopped'].includes(entry.run.status)) return total
      const planStates = new Map<string, 'awaiting' | 'reviewed'>()
      for (const event of entry.events) {
        if (!event.taskId) continue
        if (event.type === 'task.planned') planStates.set(event.taskId, 'awaiting')
        else if (event.type === 'plan.approved' || event.type === 'plan.rejected') planStates.set(event.taskId, 'reviewed')
      }
      return total
        + entry.agents.filter((agent) => agent.status === 'blocked' || agent.status === 'failed').length
        + entry.tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').length
        + [...planStates.values()].filter((state) => state === 'awaiting').length
        + entry.messages.filter((message) => !message.deliveredAt).length
    }, 0)
    return {
      agents: allAgents.length,
      working: allAgents.filter((agent) => agent.status === 'working' || agent.turnActive).length,
      queued: allTasks.filter((task) => task.status === 'pending').length,
      attention,
      providers: new Map(PROVIDERS.map((provider) => [provider, allAgents.filter((agent) => agent.provider === provider).length])),
    }
  }, [fleetSnapshots, runs, snapshot])

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
          : run?.useWorktrees === false
            ? 'Run deleted · shared checkout left unchanged'
            : 'Run deleted — clean worktrees removed', 6000)
        const remaining = runs.filter((entry) => entry.id !== runId)
        setRuns(remaining)
        setRunId(remaining[0]?.id ?? null)
        setSnapshot(null)
        setEventIndex(-1)
        setTaskCursorId(null)
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
      } else if (action.kind === 'fail-task') {
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
      } else {
        let next = snapshot
        if (action.task) {
          next = await appendTuiProtocolEvent({
            version: AGENT_PROTOCOL_VERSION,
            runId,
            agentId: action.agent.id,
            type: 'task.released',
            taskId: action.task.id,
            summary: `${action.task.id} requeued from Agent Operations to rerun ${action.agent.name}`,
          }) ?? next
        }
        next = await appendTuiProtocolEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId,
          agentId: action.agent.id,
          type: 'agent.ready',
          summary: `${action.agent.name} reset from Agent Operations`,
        }) ?? next
        if (next) setSnapshot(next)
        onNotice('info', `${action.agent.name} reset and ready to rerun`, 4000)
      }
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [busy, onNotice, runId, runs, snapshot])

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
    if (run?.useWorktrees === false) {
      onNotice('info', 'This workflow uses a shared checkout; there are no isolated agent checkouts to clean', 4000)
      return
    }
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
  }, [busy, onNotice, run, runId])

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
    if (navigableRuns.length < 2 || !runId) return
    const current = Math.max(navigableRuns.findIndex((entry) => entry.id === runId), 0)
    const nextIndex = Math.max(0, Math.min(navigableRuns.length - 1, current + direction))
    const next = navigableRuns[nextIndex]
    if (!next || next.id === runId) return
    setRunId(next.id)
    setSnapshot(null)
    setTeamIndex(0)
    setTaskCursorId(null)
    setEventIndex(-1)
  }, [navigableRuns, runId])

  const closeAgentGit = useCallback(() => {
    gitKeyHandlerRef.current = null
    setGitAgent(null)
  }, [])

  const registerAgentGitKeyHandler = useCallback((handler: (key: CoordinationKeyEvent) => void) => {
    gitKeyHandlerRef.current = handler
  }, [])

  const handleKey = useCallback((key: CoordinationKeyEvent) => {
    if (gitAgent) {
      gitKeyHandlerRef.current?.(key)
      return
    }
    if (messageTarget !== null) {
      if (key.name === 'escape') {
        setMessageTarget(null)
        setMessageDraft('')
      } else if (key.name === 'return') {
        void sendTeamMessage()
      } else if (key.name === 'backspace' || key.name === 'delete') {
        setMessageDraft((draft) => draft.slice(0, -1))
      } else if (isPrintable(key)) {
        setMessageDraft((draft) => draft + key.sequence)
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
      setSection((current) => cycleValue(SECTIONS, current, key.shift ? -1 : 1))
      return
    }
    if (key.sequence >= '1' && key.sequence <= '4') {
      const next = SECTIONS[Number.parseInt(key.sequence, 10) - 1]
      if (next) setSection(next)
      return
    }
    if (key.sequence === '[') { switchRun(-1); return }
    if (key.sequence === ']') { switchRun(1); return }
    if (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up') {
      const delta = key.name === 'j' || key.name === 'down' ? 1 : -1
      if (section === 'team') setTeamIndex(Math.max(0, Math.min(clampedTeam + delta, agents.length - 1)))
      else if (section === 'tasks') {
        const nextTaskIndex = Math.max(0, Math.min(clampedTask + delta, navigableTasks.length - 1))
        setTaskCursorId(navigableTasks[nextTaskIndex]?.id ?? null)
      }
      else if (section === 'events') setEventIndex(Math.max(0, Math.min(clampedEvent + delta, filteredEvents.length - 1)))
      else switchRun(delta as 1 | -1)
      return
    }
    if (key.name === 'return') {
      if (section === 'team' && selectedAgent) {
        onOpenSession(selectedAgent)
        onClose()
      } else if (section === 'tasks' && selectedOwner) {
        onOpenSession(selectedOwner)
        onClose()
      } else if (section === 'events' && eventAgent) {
        onOpenSession(eventAgent)
        onClose()
      } else if (section === 'overview' && runId) {
        setSection('tasks')
      }
      return
    }
    if (key.name === 'v' && section === 'tasks') {
      setTaskFilter((current) => cycleValue(TASK_FILTERS, current))
      setTaskCursorId(null)
      return
    }
    if (key.name === 'v' && section === 'events') {
      setEventFilter((current) => cycleValue(EVENT_FILTERS, current))
      setEventIndex(-1)
      return
    }
    if (key.sequence === '/' && section === 'tasks') {
      setTaskFilter((current) => cycleValue(TASK_FILTERS, current))
      setTaskCursorId(null)
      return
    }
    if (key.sequence === '/' && section === 'events') {
      setEventFilter((current) => cycleValue(EVENT_FILTERS, current))
      setEventIndex(-1)
      return
    }
    if (key.name === 'm' && key.shift) {
      setMessageTarget('all')
      setMessageDraft('')
      return
    }
    if (key.name === 'g' && key.shift && inspectedAgent) {
      setGitAgent(inspectedAgent)
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
          : section === 'events' && eventAgent
            ? eventAgent.name
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
      const worktree = selectedAgent.worktreeBranch && selectedAgent.worktreePath !== run?.baseCwd
        ? worktreeStats.get(selectedAgent.worktreePath)
        : undefined
      if (!worktree) onNotice('info', run?.useWorktrees === false
        ? `${selectedAgent.name} uses the shared checkout; no merge step is needed`
        : `${selectedAgent.name} has no merge-ready worktree`, 3000)
      else setPending({ kind: 'merge', agent: selectedAgent, worktree })
      return
    }
    if (key.name === 'a' && section === 'tasks' && selectedTask && planStates.get(selectedTask.id) === 'awaiting') {
      void reviewPlan(selectedTask, true)
      return
    }
    if (key.name === 'r' && key.shift && section === 'tasks' && selectedTask && planStates.get(selectedTask.id) === 'awaiting') {
      void reviewPlan(selectedTask, false)
      return
    }
    if (key.name === 'r' && key.shift && section === 'team' && selectedAgent) {
      if (!STUCK_AGENT_STATUSES.has(selectedAgent.status)) onNotice('info', `${selectedAgent.name} is not stuck`, 2500)
      else setPending({ kind: 'rerun-agent', agent: selectedAgent, task: stuckAgentTask(selectedAgent) })
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
    if (key.name === 'r') { void refreshAll(); return }
  }, [agents.length, clampedEvent, clampedTask, clampedTeam, cleanupRun, eventAgent, filteredEvents.length, gitAgent, inspectedAgent, interruptAgentTurn, messageTarget, navigableTasks.length, onClose, onCopyJoinCommand, onNewRun, onNotice, onOpenSession, pending, planStates, refreshAll, reviewPlan, run, runId, runPendingAction, section, selectedAgent, selectedOwner, selectedTask, sendTeamMessage, snapshot, stuckAgentTask, switchRun, worktreeStats])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const pendingLabel = pending?.kind === 'stop'
    ? 'Stop run and interrupt every live turn? y/Enter confirm · n/Esc cancel'
    : pending?.kind === 'delete-run'
      ? run?.useWorktrees === false
        ? 'DELETE run ledger? Shared checkout left unchanged. y/Enter · n/Esc'
        : 'DELETE run ledger? Clean worktrees removed; unmerged work kept. y/Enter · n/Esc'
      : pending?.kind === 'merge'
        ? `Squash-merge ${pending.agent.name}'s worktree into main checkout? y/Enter · n/Esc`
        : pending?.kind === 'fail-task'
          ? `Mark ${pending.task.id} failed? y/Enter · n/Esc`
          : pending?.kind === 'rerun-agent'
            ? `Rerun ${pending.agent.name}${pending.task ? ` — requeue ${pending.task.id} and reset the agent` : ' — reset the agent to ready'}? y/Enter · n/Esc`
            : null
  const gitAgentUsesWorktree = Boolean(gitAgent?.worktreePath && run?.baseCwd && gitAgent.worktreePath !== run.baseCwd)
  return (
    <>
      <CoordinationControlCenter
        theme={theme}
        width={width}
        height={height}
        runs={navigableRuns}
        runId={runId}
        snapshot={snapshot}
        fleetSnapshots={fleetSnapshots}
        filteredTasks={navigableTasks}
        filteredEvents={filteredEvents.map((entry) => entry.event)}
        fleet={fleet}
        worktreeStats={worktreeStats}
        section={section}
        selectedTask={selectedTask}
        inspectedAgent={inspectedAgent}
        selectedEvent={selectedEvent}
        selectedLocks={selectedLocks}
        taskFilter={taskFilter}
        eventFilter={eventFilter}
        selectedTaskPlanState={selectedTask ? planStates.get(selectedTask.id) : undefined}
        canCopyJoinCommand={Boolean(onCopyJoinCommand && runId)}
        now={now}
        busy={busy}
        loadError={loadError}
        messageTarget={messageTarget}
        messageDraft={messageDraft}
        pendingLabel={pendingLabel}
        onMessageDraft={setMessageDraft}
        onSubmitMessage={() => { void sendTeamMessage() }}
      />
      {gitAgent ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={84}
        />
      ) : null}
      {gitAgent ? (
        <GitPopover
          cwd={gitAgent.worktreePath || run?.baseCwd}
          scopeLabel={`${gitAgent.name} · ${gitAgentUsesWorktree ? (gitAgent.worktreeBranch || 'worktree') : 'shared checkout'}`}
          zIndex={85}
          theme={theme}
          width={width}
          height={height}
          onClose={closeAgentGit}
          onKeyHandlerReady={registerAgentGitKeyHandler}
          onSendDiffNoteToComposer={onSendDiffNoteToComposer}
        />
      ) : null}
    </>
  )
}

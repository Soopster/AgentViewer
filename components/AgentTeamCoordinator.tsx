'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  CircleStop,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  GitMerge,
  Inbox,
  ListFilter,
  Mail,
  MessageSquare,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UsersRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AGENT_PROTOCOL_VERSION } from '@/lib/agentProtocol'
import type { AgentProtocolEvent, ProtocolAgent, ProtocolRun, ProtocolRunSnapshot, ProtocolTask } from '@/lib/agentProtocol'
import type { ProviderSelection, Session } from '@/lib/types'
import type { WorktreeTask } from '@/lib/worktreeTasks'

type Props = {
  provider: ProviderSelection
  selectedSession: Session | null
  onOpenSession: (session: Session) => void
  onSessionsChanged: () => void
}

type WorktreeResponse = { tasks?: WorktreeTask[]; error?: string }
type RunsResponse = { runs?: ProtocolRun[]; error?: string }
type PendingAction =
  | { kind: 'stop' }
  | { kind: 'delete-run' }
  | { kind: 'merge'; agent: ProtocolAgent; worktree: WorktreeTask }
  | { kind: 'fail-task'; task: ProtocolTask }

const POLL_MS = 2000
const WORKTREE_STATS_MS = 10_000
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_TASK_STATUSES = new Set(['claimed', 'planning', 'planned', 'in_progress'])
const ATTENTION_TASK_STATUSES = new Set(['blocked', 'failed', 'planned'])

type TaskFilter = 'all' | 'attention' | 'active' | 'done'
type EventFilter = 'all' | 'attention' | 'messages' | 'tasks'

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('av-coord-filter', active ? 'av-active' : '')}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function firstLine(value: string, fallback = 'Untitled'): string {
  return value.split('\n')[0]?.trim() || fallback
}

function formatAge(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function statusTone(status: string): 'good' | 'warn' | 'bad' | 'info' | 'muted' {
  switch (status) {
    case 'completed':
    case 'done':
      return 'good'
    case 'blocked':
    case 'failed':
      return 'bad'
    case 'working':
    case 'in_progress':
    case 'running':
    case 'synthesizing':
      return 'warn'
    case 'claimed':
    case 'planning':
    case 'planned':
      return 'info'
    default:
      return 'muted'
  }
}

function eventTone(event: AgentProtocolEvent): 'good' | 'warn' | 'bad' | 'info' | 'muted' {
  if (event.type === 'finding' || event.type === 'learning') return 'good'
  if (event.type === 'message') return 'info'
  if (event.type === 'agent.blocked' || event.type === 'task.failed' || event.type === 'lock.denied' || event.type === 'plan.rejected') return 'bad'
  if (event.type === 'plan.approved' || event.type === 'task.completed') return 'good'
  return 'muted'
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

export default function AgentTeamCoordinator({
  provider,
  selectedSession,
  onOpenSession,
  onSessionsChanged,
}: Props) {
  const [runs, setRuns] = useState<ProtocolRun[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ProtocolRunSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedEventIndex, setSelectedEventIndex] = useState(-1)
  const [worktreeStats, setWorktreeStats] = useState<Map<string, WorktreeTask>>(new Map())
  const [notice, setNotice] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [maxAgents, setMaxAgents] = useState(3)
  const [gateCommand, setGateCommand] = useState('')
  const [requirePlanApproval, setRequirePlanApproval] = useState(true)
  const [runQuery, setRunQuery] = useState('')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')

  const eventsListRef = useRef<HTMLDivElement | null>(null)

  const run = snapshot?.run ?? null
  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null
  const undeliveredMail = (snapshot?.messages ?? []).filter((message) => !message.deliveredAt).length
  const terminalRun = run ? ['completed', 'failed', 'stopped'].includes(run.status) : false
  const actionableMail = terminalRun ? 0 : undeliveredMail
  const liveAgents = agents.filter((agent) => agent.turnActive).length
  const blockedAgents = agents.filter((agent) => agent.status === 'blocked' || agent.status === 'failed').length
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const taskProgress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0
  const targetProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
  const baseCwd = selectedSession?.cwd ?? run?.baseCwd ?? ''
  const filteredRuns = useMemo(() => {
    const query = runQuery.trim().toLowerCase()
    if (!query) return runs
    return runs.filter((entry) => (
      entry.prompt.toLowerCase().includes(query)
      || entry.status.toLowerCase().includes(query)
      || String(entry.provider).toLowerCase().includes(query)
      || entry.id.toLowerCase().includes(query)
    ))
  }, [runQuery, runs])
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
  const pendingPlanTasks = useMemo(
    () => tasks.filter((task) => planStates.get(task.id) === 'awaiting'),
    [planStates, tasks],
  )
  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (taskFilter === 'attention') return ATTENTION_TASK_STATUSES.has(task.status) || planStates.get(task.id) === 'awaiting'
    if (taskFilter === 'active') return ACTIVE_TASK_STATUSES.has(task.status)
    if (taskFilter === 'done') return TERMINAL_TASK_STATUSES.has(task.status)
    return true
  }), [planStates, taskFilter, tasks])
  const displayedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null
  const filteredEvents = useMemo(() => events.flatMap((event, index) => {
    const include = eventFilter === 'all'
      || (eventFilter === 'attention' && ['agent.blocked', 'task.failed', 'lock.denied', 'plan.rejected', 'review.requested'].includes(event.type))
      || (eventFilter === 'messages' && ['message', 'finding', 'learning', 'handoff'].includes(event.type))
      || (eventFilter === 'tasks' && (event.type.startsWith('task.') || event.type.startsWith('plan.')))
    return include ? [{ event, index }] : []
  }), [eventFilter, events])
  const selectedEvent = selectedEventIndex < 0
    ? filteredEvents.at(-1)?.event ?? null
    : filteredEvents.find((entry) => entry.index === selectedEventIndex)?.event ?? filteredEvents.at(-1)?.event ?? null
  const attentionTaskCount = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').length
  const attentionCount = terminalRun ? 0 : blockedAgents + attentionTaskCount + pendingPlanTasks.length + actionableMail
  const workingAgents = agents.filter((agent) => agent.status === 'working' || agent.turnActive).length
  const doneAgents = agents.filter((agent) => ['done', 'failed', 'stopped'].includes(agent.status)).length
  const lastEventAt = events.at(-1)?.timestamp
  const runHealth = run?.status === 'completed'
    ? { label: 'Completed', tone: 'good' as const }
    : run?.status === 'failed'
      ? { label: 'Failed', tone: 'bad' as const }
      : run?.status === 'stopped'
        ? { label: 'Stopped', tone: 'muted' as const }
        : run?.status === 'blocked'
          ? { label: 'Blocked', tone: 'bad' as const }
          : attentionCount > 0
            ? { label: 'Needs attention', tone: 'bad' as const }
            : liveAgents > 0 || workingAgents > 0
              ? { label: 'Active', tone: 'warn' as const }
              : { label: 'Waiting', tone: 'info' as const }

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice((current) => current === text ? null : current), 5000)
  }, [])

  const loadRuns = useCallback(async () => {
    const data = await jsonFetch<RunsResponse>('/api/agent-protocol/runs?limit=10')
    const nextRuns = data.runs ?? []
    setRuns(nextRuns)
    setRunId((current) => current ?? nextRuns[0]?.id ?? null)
  }, [])

  const loadSnapshot = useCallback(async (id: string) => {
    const next = await jsonFetch<ProtocolRunSnapshot>(`/api/agent-protocol/runs/${encodeURIComponent(id)}`)
    setSnapshot(next)
    setLoadError(null)
    setSelectedAgentId((current) => current && next.agents.some((agent) => agent.id === current) ? current : next.agents[0]?.id ?? null)
    setSelectedTaskId((current) => current && next.tasks.some((task) => task.id === current) ? current : next.tasks[0]?.id ?? null)
    setSelectedEventIndex((current) => current < 0 ? -1 : Math.min(current, Math.max(next.events.length - 1, 0)))
  }, [])

  const refreshWorktrees = useCallback(async (cwd: string) => {
    if (!cwd) return
    const params = new URLSearchParams({ cwd })
    const data = await jsonFetch<WorktreeResponse>(`/api/worktrees?${params.toString()}`)
    setWorktreeStats(new Map((data.tasks ?? []).map((task) => [task.path, task])))
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadRuns().catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load coordinated runs')
    })
    return () => { cancelled = true }
  }, [loadRuns])

  useEffect(() => {
    if (!runId) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    const poll = () => {
      void loadSnapshot(runId).catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load run')
      })
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [loadSnapshot, runId])

  useEffect(() => {
    const cwd = snapshot?.run.baseCwd
    if (!cwd) return
    let cancelled = false
    const refresh = () => {
      void refreshWorktrees(cwd).catch(() => {
        if (!cancelled) setWorktreeStats(new Map())
      })
    }
    refresh()
    const timer = window.setInterval(refresh, WORKTREE_STATS_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refreshWorktrees, snapshot?.run.baseCwd])

  // Keep the newest event in view while following the tail (index -1). A
  // click on any event pauses the follow; the panel-head button resumes it.
  const followingEvents = selectedEventIndex < 0
  useEffect(() => {
    if (!followingEvents) return
    const list = eventsListRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [followingEvents, filteredEvents.length])

  const appendEvent = useCallback(async (event: AgentProtocolEvent) => {
    const next = await jsonFetch<ProtocolRunSnapshot>(`/api/agent-protocol/runs/${encodeURIComponent(event.runId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    setSnapshot(next)
  }, [])

  const refreshDashboard = useCallback(async () => {
    if (!runId || busyAction) return
    setBusyAction('refresh')
    try {
      await Promise.all([
        loadRuns(),
        loadSnapshot(runId),
        snapshot?.run.baseCwd ? refreshWorktrees(snapshot.run.baseCwd) : Promise.resolve(),
      ])
      showNotice('Dashboard refreshed')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to refresh dashboard')
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, loadRuns, loadSnapshot, refreshWorktrees, runId, showNotice, snapshot?.run.baseCwd])

  const copyJoinCommand = useCallback(async () => {
    if (!run) return
    const command = `agent-viewer coord worker --join ${run.id} --name <name> --provider codex --attach ${window.location.origin}`
    try {
      await navigator.clipboard.writeText(command)
      showNotice('CLI join command copied')
    } catch {
      showNotice(`Run ID: ${run.id}`)
    }
  }, [run, showNotice])

  const reviewPlan = useCallback(async (task: ProtocolTask, approved: boolean) => {
    if (!runId || busyAction) return
    setBusyAction(`plan:${task.id}`)
    try {
      await appendEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: 'user',
        type: approved ? 'plan.approved' : 'plan.rejected',
        taskId: task.id,
        summary: approved ? `${task.id} plan approved from the control dashboard` : `${task.id} plan rejected from the control dashboard`,
      })
      showNotice(`${task.id} plan ${approved ? 'approved' : 'rejected'}`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to review plan')
    } finally {
      setBusyAction(null)
    }
  }, [appendEvent, busyAction, runId, showNotice])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]') === true
      if (event.key === 'Escape') {
        if (messageTarget !== null) setMessageTarget(null)
        else if (pendingAction) setPendingAction(null)
        else if (startOpen && run) setStartOpen(false)
        return
      }
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'n') setStartOpen(true)
      if (event.key.toLowerCase() === 'm' && run) {
        setMessageTarget(selectedAgent?.name ?? 'all')
        setMessageDraft('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [messageTarget, pendingAction, run, selectedAgent?.name, startOpen])

  const startRun = useCallback(async () => {
    const prompt = promptDraft.trim()
    if (!prompt || busyAction) return
    setBusyAction('start')
    try {
      const result = await jsonFetch<{ snapshot: ProtocolRunSnapshot; sessions: Array<{ sessionId: string; provider: Session['provider']; cwd: string; summary: string; isPending: boolean }> }>('/api/agent-protocol/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          baseCwd: baseCwd || undefined,
          provider: targetProvider,
          maxAgents,
          title: prompt.slice(0, 40),
          gateCommand: gateCommand.trim() || undefined,
          requirePlanApproval,
        }),
      })
      setSnapshot(result.snapshot)
      setRunId(result.snapshot.run.id)
      setRuns((prev) => [result.snapshot.run, ...prev.filter((entry) => entry.id !== result.snapshot.run.id)].slice(0, 10))
      setStartOpen(false)
      setPromptDraft('')
      setGateCommand('')
      const lead = result.sessions[0]
      if (lead) {
        onOpenSession({
          sessionId: lead.sessionId,
          provider: lead.provider,
          cwd: lead.cwd,
          summary: lead.summary,
          createdAt: Date.now(),
          lastModified: Date.now(),
          isPending: lead.isPending,
        })
      }
      onSessionsChanged()
      showNotice('Coordinated run started')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to start run')
    } finally {
      setBusyAction(null)
    }
  }, [baseCwd, busyAction, gateCommand, maxAgents, onOpenSession, onSessionsChanged, promptDraft, requirePlanApproval, showNotice, targetProvider])

  const sendMessage = useCallback(async () => {
    const body = messageDraft.trim()
    if (!body || !messageTarget || !runId || busyAction) return
    setBusyAction('message')
    try {
      await appendEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: 'user',
        type: 'message',
        to: messageTarget,
        summary: body,
      })
      setMessageTarget(null)
      setMessageDraft('')
      showNotice(`Message sent to ${messageTarget}`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setBusyAction(null)
    }
  }, [appendEvent, busyAction, messageDraft, messageTarget, runId, showNotice])

  const runPendingAction = useCallback(async () => {
    if (!runId || !pendingAction || busyAction) return
    setBusyAction(pendingAction.kind)
    try {
      if (pendingAction.kind === 'stop') {
        const next = await jsonFetch<ProtocolRunSnapshot>(`/api/agent-protocol/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
        setSnapshot(next)
        showNotice('Run stopped')
      } else if (pendingAction.kind === 'delete-run') {
        const result = await jsonFetch<{ deleted: boolean; keptWorktrees: string[] }>(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' })
        const remaining = runs.filter((entry) => entry.id !== runId)
        setRuns(remaining)
        setRunId(remaining[0]?.id ?? null)
        setSnapshot(null)
        showNotice(result.keptWorktrees.length > 0 ? `Run deleted; kept ${result.keptWorktrees.length} worktree(s)` : 'Run deleted')
      } else if (pendingAction.kind === 'merge') {
        const result = await jsonFetch<{ staged: boolean }>('/api/worktrees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'merge', task: pendingAction.worktree }),
        })
        if (snapshot?.run.baseCwd) await refreshWorktrees(snapshot.run.baseCwd).catch(() => undefined)
        showNotice(result.staged ? `Merged ${pendingAction.agent.name}'s worktree` : `${pendingAction.agent.name}'s worktree had no changes to merge`)
      } else {
        await appendEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId,
          agentId: 'user',
          type: 'task.failed',
          taskId: pendingAction.task.id,
          summary: `${pendingAction.task.id} marked failed from the web coordinator`,
        })
        showNotice(`${pendingAction.task.id} marked failed`)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyAction(null)
      setPendingAction(null)
    }
  }, [appendEvent, busyAction, pendingAction, refreshWorktrees, runId, runs, showNotice, snapshot?.run.baseCwd])

  const cleanupRun = useCallback(async () => {
    if (!runId || busyAction) return
    setBusyAction('cleanup')
    try {
      const result = await jsonFetch<{ results: Array<{ status: string }>; snapshot: ProtocolRunSnapshot }>(`/api/agent-protocol/runs/${encodeURIComponent(runId)}/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setSnapshot(result.snapshot)
      const removed = result.results.filter((entry) => entry.status === 'removed').length
      showNotice(`Cleaned ${removed} worktree${removed === 1 ? '' : 's'}`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to clean up worktrees')
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, runId, showNotice])

  const interruptAgent = useCallback(async (agent: ProtocolAgent) => {
    if (busyAction) return
    setBusyAction(`interrupt:${agent.id}`)
    try {
      await jsonFetch<{ ok: true }>(`/api/sessions/${encodeURIComponent(agent.sessionId)}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: agent.provider }),
      })
      showNotice(`Interrupted ${agent.name}`)
    } catch (err) {
      showNotice(err instanceof Error ? err.message : `${agent.name} has no live turn`)
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, showNotice])

  const openAgentSession = useCallback((agent: ProtocolAgent) => {
    onOpenSession({
      sessionId: agent.sessionId,
      provider: agent.provider,
      cwd: agent.worktreePath || undefined,
      createdAt: Date.now(),
      lastModified: Date.now(),
      summary: `${agent.name} · ${agent.role}`,
    })
  }, [onOpenSession])

  const pendingLabel = pendingAction?.kind === 'stop'
    ? 'Stop this run and interrupt every live teammate turn?'
    : pendingAction?.kind === 'delete-run'
    ? 'Delete this run ledger? Clean worktrees are removed; unmerged ones are kept.'
    : pendingAction?.kind === 'merge'
    ? `Squash-merge ${pendingAction.agent.name}'s worktree into the main checkout?`
    : pendingAction?.kind === 'fail-task'
    ? `Mark ${pendingAction.task.id} failed?`
    : null

  return (
    <main className="av-coord-page" aria-labelledby="agent-operations-title">
      <div className="av-coord-shell av-coord-shell-page">
        <header className="av-coord-header">
          <div className="av-coord-title">
            <UsersRound aria-hidden="true" />
            <div>
              <h2 id="agent-operations-title">Agent Operations</h2>
              <span>{run ? `${firstLine(run.prompt)} · ${String(run.provider).toUpperCase()} · started ${formatAge(run.createdAt)} ago` : 'Start a run or select one from the control rail'}</span>
            </div>
          </div>
          <div className="av-coord-header-actions">
            {liveAgents > 0 ? <span className="av-coord-live-chip"><Activity size={13} /> {liveAgents} live</span> : null}
            {blockedAgents > 0 ? <span className="av-coord-blocked-chip"><AlertTriangle size={13} /> {blockedAgents} blocked</span> : null}
            {run?.requirePlanApproval ? <span className="av-coord-guard"><ShieldCheck size={13} /> plans</span> : null}
            {run?.gateCommand ? <span className="av-coord-guard"><Zap size={13} /> gate</span> : null}
            {actionableMail > 0 ? <span className="av-coord-mail"><Mail size={13} /> {actionableMail}</span> : null}
            {run ? <span className={cn('av-coord-health', `av-tone-${runHealth.tone}`)}>{runHealth.label}</span> : null}
            {run ? (
              <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => void copyJoinCommand()}>
                <ClipboardCopy data-icon="inline-start" aria-hidden="true" /> Invite CLI
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => setStartOpen(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" /> New Run
            </Button>
          </div>
        </header>

        {notice || loadError ? (
          <div className={cn('av-coord-notice', loadError ? 'av-coord-notice-error' : '')} aria-live="polite">
            {loadError ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <span>{loadError ?? notice}</span>
            <button type="button" onClick={() => { setLoadError(null); setNotice(null) }} aria-label="Dismiss notice">
              <X size={13} />
            </button>
          </div>
        ) : null}

        <div className="av-coord-body">
          <aside className="av-coord-runs">
            <div className="av-coord-panel-head">
              <span>Run Control</span>
              <button type="button" onClick={() => void loadRuns()} aria-label="Refresh runs">
                <RefreshCw size={13} />
              </button>
            </div>
            <label className="av-coord-run-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Search runs</span>
              <Input
                type="search"
                name="run-search"
                autoComplete="off"
                value={runQuery}
                onChange={(event) => setRunQuery(event.target.value)}
                placeholder="Search runs…"
                aria-label="Search runs"
              />
            </label>
            <div className="av-coord-run-list">
              {runs.length === 0 ? (
                <button type="button" className="av-coord-empty-run" onClick={() => setStartOpen(true)}>
                  <Plus size={15} /> New run
                </button>
              ) : filteredRuns.length === 0 ? (
                <div className="av-coord-empty-state">No runs match “{runQuery}”.</div>
              ) : filteredRuns.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={cn('av-coord-run-row', entry.id === runId ? 'av-selected' : '')}
                  onClick={() => { setRunId(entry.id); setSelectedEventIndex(-1) }}
                >
                  <span className={cn('av-coord-status', `av-tone-${statusTone(entry.status)}`)}>{entry.status}</span>
                  <strong>{firstLine(entry.prompt)}</strong>
                  <small>{String(entry.provider).toUpperCase()} · {formatAge(entry.createdAt)} ago</small>
                </button>
              ))}
            </div>
            <div className="av-coord-rail-footer">
              <span><kbd>N</kbd> new run</span>
              <span><kbd>M</kbd> message</span>
              <span><kbd>Esc</kbd> dismiss</span>
            </div>
          </aside>

          <main className="av-coord-main">
            {startOpen || !run ? (
              <section className="av-coord-start">
                <div className="av-coord-section-title">
                  <Play size={16} />
                  <h3>New Run</h3>
                </div>
                <label className="av-coord-field av-coord-prompt-field">
                  <span>Prompt</span>
                  <Textarea
                    id="coord-run-prompt"
                    name="run-prompt"
                    autoComplete="off"
                    value={promptDraft}
                    onChange={(event) => setPromptDraft(event.target.value)}
                    placeholder="Describe the outcome, constraints, and acceptance checks…"
                    className="av-coord-textarea"
                    rows={6}
                  />
                </label>
                <div className="av-coord-start-grid">
                  <label className="av-coord-field">
                    <span>Provider</span>
                    <Input name="run-provider" autoComplete="off" value={String(targetProvider).toUpperCase()} readOnly className="av-coord-input" />
                  </label>
                  <label className="av-coord-field">
                    <span>Teammates</span>
                    <Input
                      type="number"
                      name="run-teammates"
                      autoComplete="off"
                      min={1}
                      max={6}
                      value={maxAgents}
                      onChange={(event) => setMaxAgents(Math.max(1, Math.min(6, Number(event.target.value) || 1)))}
                      className="av-coord-input"
                    />
                  </label>
                  <label className="av-coord-field av-coord-wide">
                    <span>Gate command</span>
                    <Input
                      value={gateCommand}
                      name="run-gate-command"
                      autoComplete="off"
                      onChange={(event) => setGateCommand(event.target.value)}
                      placeholder="Example: npx tsc --noEmit"
                      className="av-coord-input"
                    />
                  </label>
                </div>
                <label className="av-coord-check">
                  <Checkbox className="av-coord-checkbox" checked={requirePlanApproval} onCheckedChange={(checked) => setRequirePlanApproval(checked === true)} />
                  <span>Require lead plan approval before implementation</span>
                </label>
                <div className="av-coord-form-actions">
                  {run ? <Button type="button" variant="outline" onClick={() => setStartOpen(false)} className="av-coord-btn">Cancel</Button> : null}
                  <Button type="button" onClick={() => void startRun()} disabled={!promptDraft.trim() || busyAction === 'start'} className="av-coord-btn av-coord-primary">
                    {busyAction === 'start' ? <RefreshCw aria-hidden="true" /> : <Play aria-hidden="true" />} {busyAction === 'start' ? 'Starting…' : 'Start Run'}
                  </Button>
                </div>
              </section>
            ) : (
              <>
                <section className="av-coord-toolbar">
                  <div className="av-coord-run-heading">
                    <span className={cn('av-coord-status', `av-tone-${statusTone(run.status)}`)}>{run.status}</span>
                    <div>
                      <strong>{firstLine(run.prompt)}</strong>
                      <span translate="no">{run.id}</span>
                    </div>
                  </div>
                  <div className="av-coord-toolbar-actions">
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => void refreshDashboard()} disabled={busyAction === 'refresh'}>
                      <RefreshCw data-icon="inline-start" aria-hidden="true" /> {busyAction === 'refresh' ? 'Refreshing…' : 'Refresh'}
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => { setMessageTarget('all'); setMessageDraft('') }}>
                      <Mail data-icon="inline-start" aria-hidden="true" /> Message Team
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => setPendingAction({ kind: 'stop' })} disabled={!['planning', 'running', 'synthesizing'].includes(run.status)}>
                      <CircleStop data-icon="inline-start" aria-hidden="true" /> Stop Run
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => void cleanupRun()} disabled={busyAction === 'cleanup'}>
                      <ShieldCheck data-icon="inline-start" aria-hidden="true" /> {busyAction === 'cleanup' ? 'Cleaning…' : 'Clean Worktrees'}
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn av-danger" onClick={() => setPendingAction({ kind: 'delete-run' })}>
                      <Trash2 data-icon="inline-start" aria-hidden="true" /> Delete
                    </Button>
                  </div>
                </section>

                <section className="av-coord-overview" aria-label="Run overview">
                  <div className="av-coord-metrics">
                    <div className="av-coord-metric">
                      <Workflow aria-hidden="true" />
                      <div><strong>{taskProgress}%</strong><span>{completedTasks}/{tasks.length} tasks complete</span></div>
                      <div className="av-coord-progress-track" aria-label={`${taskProgress}% complete`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskProgress}>
                        <span style={{ width: `${taskProgress}%` }} />
                      </div>
                    </div>
                    <div className="av-coord-metric">
                      <Bot aria-hidden="true" />
                      <div><strong>{agents.length}</strong><span>{workingAgents} working · {doneAgents} done</span></div>
                    </div>
                    <div className={cn('av-coord-metric', attentionCount > 0 ? 'av-needs-attention' : '')}>
                      <Inbox aria-hidden="true" />
                      <div><strong>{attentionCount}</strong><span>{attentionCount === 1 ? 'item needs action' : 'items need action'}</span></div>
                    </div>
                    <div className="av-coord-metric">
                      <Clock3 aria-hidden="true" />
                      <div><strong>{lastEventAt ? formatAge(lastEventAt) : '—'}</strong><span>since last activity</span></div>
                    </div>
                  </div>

                  {attentionCount > 0 ? (
                    <div className="av-coord-attention" aria-label="Needs attention">
                      <div className="av-coord-attention-title"><AlertTriangle aria-hidden="true" /><span>Needs Attention</span></div>
                      <div className="av-coord-attention-items">
                        {pendingPlanTasks.map((task) => (
                          <button key={`plan:${task.id}`} type="button" onClick={() => { setSelectedTaskId(task.id); setTaskFilter('attention') }}>
                            <span className="av-tone-info">Plan</span><strong>{task.id}</strong><small>awaiting approval</small>
                          </button>
                        ))}
                        {agents.filter((agent) => agent.status === 'blocked' || agent.status === 'failed').map((agent) => (
                          <button key={`agent:${agent.id}`} type="button" onClick={() => setSelectedAgentId(agent.id)}>
                            <span className="av-tone-bad">Agent</span><strong>{agent.name}</strong><small>{agent.status}</small>
                          </button>
                        ))}
                        {tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').map((task) => (
                          <button key={`task:${task.id}`} type="button" onClick={() => { setSelectedTaskId(task.id); setTaskFilter('attention') }}>
                            <span className="av-tone-bad">Task</span><strong>{task.id}</strong><small>{task.status}</small>
                          </button>
                        ))}
                        {actionableMail > 0 ? (
                          <button type="button" onClick={() => setEventFilter('messages')}>
                            <span className="av-tone-info">Inbox</span><strong>{actionableMail}</strong><small>undelivered</small>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="av-coord-grid">
                  <div className="av-coord-panel av-coord-team-panel">
                    <div className="av-coord-panel-head">
                      <span>Live Team · {agents.length}</span>
                      <button type="button" onClick={() => { setMessageTarget('all'); setMessageDraft('') }} aria-label="Message all teammates">
                        <Mail size={13} />
                      </button>
                    </div>
                    <div className="av-coord-list">
                      {agents.map((agent) => {
                        const stats = worktreeStats.get(agent.worktreePath)
                        const selected = selectedAgent?.id === agent.id
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            className={cn('av-coord-agent-row', selected ? 'av-selected' : '')}
                            onClick={() => setSelectedAgentId(agent.id)}
                          >
                            <span className="av-coord-agent-mark">{agent.role === 'lead' ? 'LEAD' : 'MATE'}</span>
                            <strong>{agent.name}</strong>
                            <span className={cn('av-coord-status', `av-tone-${agent.turnActive ? 'warn' : statusTone(agent.status)}`)}>
                              {agent.turnActive ? <i className="av-coord-live-dot" aria-label="turn streaming" /> : null}
                              {agent.status}
                            </span>
                            {agent.taskId || agent.lastSeenAt ? (
                              <small>
                                {[
                                  agent.taskId,
                                  agent.turnActive ? 'live now' : agent.lastSeenAt ? `seen ${formatAge(agent.lastSeenAt)} ago` : null,
                                ].filter(Boolean).join(' · ')}
                              </small>
                            ) : null}
                            {stats && (stats.aheadCommits > 0 || stats.dirtyFiles > 0) ? (
                              <em>{stats.aheadCommits > 0 ? `${stats.aheadCommits} commits` : ''}{stats.dirtyFiles > 0 ? ` · ${stats.dirtyFiles} dirty` : ''}</em>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                    {selectedAgent ? (
                      <div className="av-coord-detail av-coord-agent-detail">
                        <div><span>Provider</span><strong>{String(selectedAgent.provider).toUpperCase()}</strong></div>
                        <div><span>Task</span><strong>{selectedAgent.taskId ?? 'No task claimed'}</strong></div>
                        <div><span>Worktree</span><strong title={selectedAgent.worktreePath}>{selectedAgent.worktreePath || 'Shared checkout'}</strong></div>
                        <div className="av-coord-action-row">
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => openAgentSession(selectedAgent)}>
                          <Radio data-icon="inline-start" aria-hidden="true" /> Open Session
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => { setMessageTarget(selectedAgent.name); setMessageDraft('') }}>
                          <MessageSquare data-icon="inline-start" aria-hidden="true" /> Message
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => void interruptAgent(selectedAgent)} disabled={busyAction === `interrupt:${selectedAgent.id}`}>
                          <CircleStop data-icon="inline-start" aria-hidden="true" /> Interrupt
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="av-coord-btn"
                          onClick={() => {
                            const worktree = worktreeStats.get(selectedAgent.worktreePath)
                            if (worktree) setPendingAction({ kind: 'merge', agent: selectedAgent, worktree })
                            else showNotice(`${selectedAgent.name} has no merge-ready worktree`)
                          }}
                        >
                          <GitMerge data-icon="inline-start" aria-hidden="true" /> Merge Work
                        </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="av-coord-panel av-coord-task-panel">
                    <div className="av-coord-panel-head">
                      <span>Work Board</span>
                      <span>{completedTasks}/{tasks.length}</span>
                    </div>
                    <div className="av-coord-filterbar" aria-label="Filter tasks">
                      <ListFilter aria-hidden="true" />
                      {(['all', 'attention', 'active', 'done'] as const).map((filter) => (
                        <FilterButton key={filter} active={taskFilter === filter} onClick={() => setTaskFilter(filter)}>{filter}</FilterButton>
                      ))}
                    </div>
                    <div className="av-coord-list">
                      {filteredTasks.length === 0 ? <div className="av-coord-empty-state">No tasks in this view.</div> : filteredTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          className={cn('av-coord-task-row', displayedTask?.id === task.id ? 'av-selected' : '')}
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          <span className={cn('av-coord-status', `av-tone-${statusTone(task.status)}`)}>{task.status}</span>
                          <strong>{task.id}</strong>
                          <span>{task.title}</span>
                          {planStates.get(task.id) === 'awaiting' ? <small>plan review</small> : null}
                        </button>
                      ))}
                    </div>
                    {displayedTask ? (
                      <div className="av-coord-detail">
                        <div><span>Owner</span><strong>{displayedTask.ownerAgentId ? agentsById.get(displayedTask.ownerAgentId)?.name ?? displayedTask.ownerAgentId : 'unassigned'}</strong></div>
                        {displayedTask.blockedBy.length > 0 ? <div><span>Deps</span><strong>{displayedTask.blockedBy.join(', ')}</strong></div> : null}
                        {displayedTask.paths.length > 0 ? <div><span>Paths</span><strong>{displayedTask.paths.join(', ')}</strong></div> : null}
                        {planStates.get(displayedTask.id) ? <div><span>Plan</span><strong>{planStates.get(displayedTask.id)}</strong></div> : null}
                        <p>{displayedTask.prompt}</p>
                        <div className="av-coord-action-row">
                          {planStates.get(displayedTask.id) === 'awaiting' ? (
                            <>
                              <Button type="button" size="sm" className="av-coord-btn av-coord-primary" onClick={() => void reviewPlan(displayedTask, true)} disabled={busyAction === `plan:${displayedTask.id}`}>
                                <CheckCircle2 data-icon="inline-start" aria-hidden="true" /> Approve Plan
                              </Button>
                              <Button type="button" variant="outline" size="sm" className="av-coord-btn av-danger" onClick={() => void reviewPlan(displayedTask, false)} disabled={busyAction === `plan:${displayedTask.id}`}>
                                <X data-icon="inline-start" aria-hidden="true" /> Reject Plan
                              </Button>
                            </>
                          ) : null}
                          {displayedTask.ownerAgentId ? (
                            <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => { setMessageTarget(agentsById.get(displayedTask.ownerAgentId!)?.name ?? displayedTask.ownerAgentId!); setMessageDraft('') }}>
                              <MessageSquare data-icon="inline-start" aria-hidden="true" /> Message Owner
                            </Button>
                          ) : null}
                          {!TERMINAL_TASK_STATUSES.has(displayedTask.status) ? (
                            <Button type="button" variant="outline" size="sm" className="av-coord-btn av-danger" onClick={() => setPendingAction({ kind: 'fail-task', task: displayedTask })}>
                              <AlertTriangle data-icon="inline-start" aria-hidden="true" /> Mark Failed
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="av-coord-panel av-coord-events-panel">
                    <div className="av-coord-panel-head">
                      <span>Activity{followingEvents ? ' · live' : ' · paused'}</span>
                      <button type="button" onClick={() => setSelectedEventIndex(-1)} aria-label="Follow latest event" title={followingEvents ? 'Following latest event' : 'Resume following latest event'}>
                        <Radio size={13} className={followingEvents ? 'av-coord-follow-on' : undefined} />
                      </button>
                    </div>
                    <div className="av-coord-filterbar" aria-label="Filter activity">
                      <ListFilter aria-hidden="true" />
                      {(['all', 'attention', 'messages', 'tasks'] as const).map((filter) => (
                        <FilterButton key={filter} active={eventFilter === filter} onClick={() => setEventFilter(filter)}>{filter}</FilterButton>
                      ))}
                      <span className="av-coord-filter-count">{filteredEvents.length} events</span>
                    </div>
                    <div className="av-coord-events-content">
                      <div className="av-coord-list" ref={eventsListRef}>
                        {filteredEvents.length === 0 ? <div className="av-coord-empty-state">No activity in this view.</div> : filteredEvents.map(({ event, index }) => {
                          const selected = selectedEvent === event
                          const who = agentsById.get(event.agentId)?.name ?? event.agentId
                          return (
                            <button
                              key={`${event.timestamp ?? index}:${index}`}
                              type="button"
                              className={cn('av-coord-event-row', selected ? 'av-selected' : '')}
                              onClick={() => setSelectedEventIndex(index)}
                            >
                              <span className={cn('av-coord-dot', `av-tone-${eventTone(event)}`)} />
                              <strong>{who}</strong>
                              <span>{event.type}{event.to ? ` -> ${event.to}` : ''}</span>
                              {event.summary ? <small>{event.summary}</small> : null}
                            </button>
                          )
                        })}
                      </div>
                      <aside className="av-coord-event-inspector" aria-label="Selected activity details">
                        {selectedEvent ? (
                          <div className="av-coord-detail">
                            <div><span>Event</span><strong>{selectedEvent.type}</strong></div>
                            {selectedEvent.taskId ? <div><span>Task</span><strong>{selectedEvent.taskId}</strong></div> : null}
                            {selectedEvent.paths && selectedEvent.paths.length > 0 ? <div><span>Paths</span><strong>{selectedEvent.paths.join(', ')}</strong></div> : null}
                            {selectedEvent.detail ? <p>{selectedEvent.detail}</p> : selectedEvent.summary ? <p>{selectedEvent.summary}</p> : null}
                          </div>
                        ) : null}
                        {run.summary ? (
                          <div className="av-coord-summary">
                            <span>Run Synthesis</span>
                            <p>{run.summary}</p>
                          </div>
                        ) : null}
                        {!selectedEvent && !run.summary ? <div className="av-coord-empty-state">Select an event to inspect it.</div> : null}
                      </aside>
                    </div>
                  </div>
                </section>
              </>
            )}
          </main>
        </div>

        {messageTarget !== null ? (
          <div className="av-coord-drawer">
            <div>
              <strong>Message {messageTarget}</strong>
              <button type="button" onClick={() => { setMessageTarget(null); setMessageDraft('') }} aria-label="Cancel message">
                <X size={14} />
              </button>
            </div>
            <Input
              name="coordinator-message"
              autoComplete="off"
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              className="av-coord-input"
              aria-label={`Message ${messageTarget}`}
              placeholder="Write an instruction or ask for an update…"
            />
            <Button type="button" className="av-coord-btn av-coord-primary" onClick={() => void sendMessage()} disabled={!messageDraft.trim() || busyAction === 'message'}>
              <Send data-icon="inline-start" aria-hidden="true" /> {busyAction === 'message' ? 'Sending…' : 'Send Message'}
            </Button>
          </div>
        ) : null}

        {pendingAction && pendingLabel ? (
          <div className="av-coord-confirm">
            <AlertTriangle size={16} />
            <span>{pendingLabel}</span>
            <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button type="button" size="sm" className="av-coord-btn av-coord-primary" onClick={() => void runPendingAction()} disabled={busyAction === pendingAction.kind}>Confirm</Button>
          </div>
        ) : null}
      </div>
    </main>
  )
}

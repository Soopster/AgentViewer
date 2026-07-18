'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  CircleStop,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Clock3,
  GitBranch,
  GitMerge,
  Inbox,
  ListFilter,
  Mail,
  MessageSquare,
  MoreVertical,
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
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AGENT_PROTOCOL_VERSION } from '@/lib/agentProtocol'
import type { AgentProtocolEvent, ProtocolAgent, ProtocolRun, ProtocolRunSnapshot, ProtocolTask } from '@/lib/agentProtocol'
import type { ProviderSelection, Session } from '@/lib/types'
import type { WorktreeTask } from '@/lib/worktreeTasks'

const GitPopover = dynamic(() => import('@/components/GitPopover'), { ssr: false })

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
const PROVIDER_ORDER = ['codex', 'claude', 'copilot', 'opencode', 'pi'] as const
const TASK_GROUP_ORDER = ['queued', 'active', 'verify', 'done'] as const
const TASK_GROUP_TOP = 4
const TASK_GROUP_HEADER_HEIGHT = 34
const TASK_ROW_HEIGHT = 60
const TASK_ROW_GAP = 7
const TASK_GROUP_BOTTOM = 12
const TASK_BOARD_PADDING_TOP = 8

type TaskFilter = 'all' | 'attention' | 'active' | 'done'
type EventFilter = 'all' | 'attention' | 'messages' | 'tasks'

function handleListNavigation(event: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'j', 'k'].includes(event.key)) return
  const target = event.target as HTMLElement
  if (!target.matches('button')) return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const index = buttons.indexOf(target as HTMLButtonElement)
  if (index < 0 || buttons.length < 2) return
  event.preventDefault()
  const delta = event.key === 'ArrowDown' || event.key === 'j' ? 1 : -1
  const next = buttons[(index + delta + buttons.length) % buttons.length]
  next?.focus()
  next?.click()
}

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

function MetricGauge({ value, label }: { value: number; label: string }) {
  const filledSlots = Math.min(Math.max(value, 0), 8)
  return (
    <span className="av-coord-mini-viz" role="img" aria-label={label}>
      {Array.from({ length: 8 }, (_, index) => <i key={index} className={index < filledSlots ? 'av-filled' : undefined} />)}
    </span>
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
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [gitReviewCwd, setGitReviewCwd] = useState<string | null>(null)

  const eventsListRef = useRef<HTMLDivElement | null>(null)
  const globalSearchRef = useRef<HTMLInputElement | null>(null)

  const run = snapshot?.run ?? null
  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null
  const selectedAgentWorktree = selectedAgent?.worktreePath ? worktreeStats.get(selectedAgent.worktreePath) : undefined
  const selectedAgentLatestEvent = useMemo(() => {
    if (!selectedAgent) return null
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.agentId === selectedAgent.id) return events[index] ?? null
    }
    return null
  }, [events, selectedAgent])
  const undeliveredMail = (snapshot?.messages ?? []).filter((message) => !message.deliveredAt).length
  const terminalRun = run ? ['completed', 'failed', 'stopped'].includes(run.status) : false
  const actionableMail = terminalRun ? 0 : undeliveredMail
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const targetProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
  const baseCwd = selectedSession?.cwd ?? run?.baseCwd ?? ''
  const filteredRuns = useMemo(() => {
    const query = runQuery.trim().toLowerCase()
    return runs.filter((entry) => {
      if (providerFilter && String(entry.provider) !== providerFilter) return false
      if (!query) return true
      return entry.prompt.toLowerCase().includes(query)
        || entry.status.toLowerCase().includes(query)
        || String(entry.provider).toLowerCase().includes(query)
        || entry.id.toLowerCase().includes(query)
    })
  }, [providerFilter, runQuery, runs])
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
    const query = runQuery.trim().toLowerCase()
    const owner = task.ownerAgentId ? agentsById.get(task.ownerAgentId) : null
    if (providerFilter && String(owner?.provider ?? run?.provider) !== providerFilter) return false
    if (query && ![task.id, task.title, task.prompt, ...task.paths].some((value) => value.toLowerCase().includes(query))) return false
    if (taskFilter === 'attention') return ATTENTION_TASK_STATUSES.has(task.status) || planStates.get(task.id) === 'awaiting'
    if (taskFilter === 'active') return ACTIVE_TASK_STATUSES.has(task.status)
    if (taskFilter === 'done') return TERMINAL_TASK_STATUSES.has(task.status)
    return true
  }), [agentsById, planStates, providerFilter, run?.provider, runQuery, taskFilter, tasks])
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
  const attentionCount = terminalRun ? 0 : attentionTaskCount + pendingPlanTasks.length + actionableMail
  const workingAgents = agents.filter((agent) => agent.status === 'working' || agent.turnActive).length
  const queuedTasks = tasks.filter((task) => task.status === 'pending').length
  const providerCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const provider of PROVIDER_ORDER) counts.set(provider, 0)
    for (const entry of runs) counts.set(String(entry.provider), (counts.get(String(entry.provider)) ?? 0) + 1)
    return counts
  }, [runs])
  const workspaceOptions = useMemo(() => {
    const options = new Map<string, { cwd: string; runId: string }>()
    for (const entry of runs) {
      if (!options.has(entry.baseCwd)) options.set(entry.baseCwd, { cwd: entry.baseCwd, runId: entry.id })
    }
    return [...options.values()]
  }, [runs])
  const groupedRuns = useMemo(() => ({
    attention: filteredRuns.filter((entry) => entry.status === 'blocked' || entry.status === 'failed'),
    running: filteredRuns.filter((entry) => ['planning', 'running', 'synthesizing'].includes(entry.status)),
    recent: filteredRuns.filter((entry) => ['completed', 'stopped'].includes(entry.status)),
  }), [filteredRuns])
  const groupedTasks = useMemo(() => ({
    queued: filteredTasks.filter((task) => task.status === 'pending'),
    active: filteredTasks.filter((task) => ['claimed', 'planning', 'planned', 'in_progress'].includes(task.status)),
    verify: filteredTasks.filter((task) => ['blocked', 'failed'].includes(task.status)),
    done: filteredTasks.filter((task) => ['completed', 'cancelled'].includes(task.status)),
  }), [filteredTasks])
  const taskRelationships = useMemo(() => {
    const rowCenters = new Map<string, number>()
    let cursor = TASK_BOARD_PADDING_TOP

    for (const group of TASK_GROUP_ORDER) {
      const groupTasks = groupedTasks[group]
      if (groupTasks.length === 0) continue
      const firstRowCenter = cursor + TASK_GROUP_TOP + TASK_GROUP_HEADER_HEIGHT + (TASK_ROW_HEIGHT / 2)
      groupTasks.forEach((task, index) => {
        rowCenters.set(task.id, firstRowCenter + (index * (TASK_ROW_HEIGHT + TASK_ROW_GAP)))
      })
      cursor += TASK_GROUP_TOP + TASK_GROUP_HEADER_HEIGHT
        + (groupTasks.length * (TASK_ROW_HEIGHT + TASK_ROW_GAP)) + TASK_GROUP_BOTTOM
    }

    const edges = filteredTasks.flatMap((task) => task.blockedBy.flatMap((dependencyId) => {
      const fromY = rowCenters.get(dependencyId)
      const toY = rowCenters.get(task.id)
      return fromY === undefined || toY === undefined ? [] : [{ dependencyId, taskId: task.id, fromY, toY }]
    }))

    return { edges, height: cursor }
  }, [filteredTasks, groupedTasks])
  const activityThroughput = useMemo(() => {
    const bucketCount = 21
    const timestamps = events
      .flatMap((event) => {
        if (!event.timestamp) return []
        const timestamp = Date.parse(event.timestamp)
        return Number.isFinite(timestamp) ? [timestamp] : []
      })
      .toSorted((left, right) => left - right)
    const createdAt = run?.createdAt ? Date.parse(run.createdAt) : Number.NaN
    const start = Number.isFinite(createdAt) ? createdAt : timestamps[0]
    const end = timestamps.at(-1)

    if (start === undefined || end === undefined) {
      return { points: '0,48 360,48', label: 'No timestamped activity' }
    }

    const span = Math.max(end - start, 1)
    const buckets = Array.from({ length: bucketCount }, () => 0)
    for (const timestamp of timestamps) {
      const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(((timestamp - start) / span) * bucketCount)))
      buckets[index] += 1
    }
    const peak = Math.max(...buckets, 1)
    const points = buckets.map((count, index) => {
      const x = (index / (bucketCount - 1)) * 360
      const y = 48 - ((count / peak) * 38)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    const elapsedMinutes = Math.max(1, Math.round(span / 60_000))
    return { points, label: `${timestamps.length} timestamped events across ${elapsedMinutes} minutes` }
  }, [events, run?.createdAt])
  const selectTask = useCallback((task: ProtocolTask) => {
    setSelectedTaskId(task.id)
    if (!task.ownerAgentId) return
    const owner = agentsById.get(task.ownerAgentId)
    if (!owner) return
    setSelectedAgentId(owner.id)
    setInspectorCollapsed(false)
  }, [agentsById])
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
    setSelectedAgentId((current) => current && next.agents.some((agent) => agent.id === current)
      ? current
      : next.agents.find((agent) => agent.turnActive || agent.status === 'working')?.id ?? next.agents[0]?.id ?? null)
    setSelectedTaskId((current) => current && next.tasks.some((task) => task.id === current)
      ? current
      : next.tasks.find((task) => ACTIVE_TASK_STATUSES.has(task.status))?.id ?? next.tasks[0]?.id ?? null)
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
        if (editing) target?.blur()
        else if (messageTarget !== null) setMessageTarget(null)
        else if (pendingAction) setPendingAction(null)
        else if (runMenuOpen) setRunMenuOpen(false)
        else if (workspaceMenuOpen) setWorkspaceMenuOpen(false)
        else if (startOpen && run) setStartOpen(false)
        return
      }
      if (!editing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '/') {
        event.preventDefault()
        globalSearchRef.current?.focus()
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
  }, [messageTarget, pendingAction, run, runMenuOpen, selectedAgent?.name, startOpen, workspaceMenuOpen])

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
              <h2 id="agent-operations-title">Agent Control Center</h2>
              <button type="button" className="av-coord-workspace" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-expanded={workspaceMenuOpen} aria-haspopup="menu">
                {run?.baseCwd.split('/').at(-1) || 'agentViewer'} <ChevronDown size={12} aria-hidden="true" />
              </button>
              {workspaceMenuOpen ? (
                <div className="av-coord-workspace-menu" role="menu" aria-label="Workspaces">
                  {workspaceOptions.map((option) => (
                    <button key={option.cwd} type="button" role="menuitem" onClick={() => {
                      setRunId(option.runId)
                      setSelectedEventIndex(-1)
                      setWorkspaceMenuOpen(false)
                    }}>
                      <strong>{option.cwd.split('/').at(-1) || option.cwd}</strong>
                      <small>{option.cwd}</small>
                    </button>
                  ))}
                  {workspaceOptions.length === 0 ? <span>No workspaces yet</span> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="av-coord-header-actions">
            {[...providerCounts.entries()].map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={cn('av-coord-provider-chip', `av-provider-${name}`, providerFilter === name ? 'av-active' : '')}
                aria-pressed={providerFilter === name}
                aria-label={`${count} workflows use ${name}${count > 0 ? '; filter by this provider' : ''}`}
                title={`${count} workflow${count === 1 ? '' : 's'} use ${name}`}
                disabled={count === 0}
                onClick={() => {
                  const nextFilter = providerFilter === name ? null : name
                  setProviderFilter(nextFilter)
                  if (nextFilter) {
                    const nextRun = runs.find((entry) => String(entry.provider) === nextFilter)
                    if (nextRun) setRunId(nextRun.id)
                  }
                }}
              >
                {name} <b>{count}</b>{count > 0 ? <i aria-hidden="true" /> : null}
              </button>
            ))}
            <label className="av-coord-global-search">
              <Search aria-hidden="true" />
              <Input ref={globalSearchRef} type="search" value={runQuery} onChange={(event) => setRunQuery(event.target.value)} placeholder="Search workflows and tasks…" aria-label="Search workflows and tasks" />
              <kbd>⌘K</kbd>
            </label>
            {run ? (
              <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => void copyJoinCommand()}>
                <ClipboardCopy data-icon="inline-start" aria-hidden="true" /> Invite CLI
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => setStartOpen(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" /> New Workflow
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
              <span>Workflows <b>{runs.length}</b></span>
              <button
                type="button"
                onClick={() => {
                  if (providerFilter || runQuery) {
                    setProviderFilter(null)
                    setRunQuery('')
                  } else {
                    globalSearchRef.current?.focus()
                  }
                }}
                aria-label={providerFilter || runQuery ? 'Clear workflow filters' : 'Filter workflows'}
                title={providerFilter || runQuery ? 'Clear workflow filters' : 'Filter workflows'}
              >
                <ListFilter size={13} />
              </button>
            </div>
            <div className="av-coord-run-list" onKeyDown={handleListNavigation}>
              {runs.length === 0 ? (
                <button type="button" className="av-coord-empty-run" onClick={() => setStartOpen(true)}>
                  <Plus size={15} /> New run
                </button>
              ) : filteredRuns.length === 0 ? (
                <div className="av-coord-empty-state">No runs match “{runQuery}”.</div>
              ) : (['attention', 'running', 'recent'] as const).map((group) => groupedRuns[group].length > 0 ? (
                <section key={group} className={`av-coord-run-group av-coord-run-group-${group}`}>
                  <h3><i />{group === 'attention' ? 'Needs attention' : group} <b>{groupedRuns[group].length}</b></h3>
                  {groupedRuns[group].map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={cn('av-coord-run-row', entry.id === runId ? 'av-selected' : '')}
                      onClick={() => { setRunId(entry.id); setSelectedEventIndex(-1) }}
                    >
                      <strong>{firstLine(entry.prompt)}</strong>
                      <span className={cn('av-coord-run-state', `av-tone-${statusTone(entry.status)}`)}>{entry.status}</span>
                      <small><b>{String(entry.provider).toUpperCase()}</b><span>{formatAge(entry.createdAt)} ago</span></small>
                    </button>
                  ))}
                </section>
              ) : null)}
            </div>
            <div className="av-coord-rail-footer">
              <button type="button" onClick={() => { setRunQuery(''); setProviderFilter(null); setTaskFilter('all') }}>View all workflows <span aria-hidden="true">→</span></button>
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
                    <div>
                      <strong>{firstLine(run.prompt)}</strong>
                      <span><b>{run.status}</b> · agentViewer · {run.baseCwd.split('/').at(-1) || run.id} · {formatAge(run.createdAt)}</span>
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
                      <CircleStop data-icon="inline-start" aria-hidden="true" /> Stop
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn av-coord-more" onClick={() => setRunMenuOpen((open) => !open)} aria-label="More workflow actions" aria-expanded={runMenuOpen}>
                      <MoreVertical aria-hidden="true" />
                    </Button>
                    {runMenuOpen ? (
                      <div className="av-coord-run-menu">
                        {displayedTask?.ownerAgentId ? (
                          <button type="button" onClick={() => {
                            setRunMenuOpen(false)
                            setMessageTarget(agentsById.get(displayedTask.ownerAgentId!)?.name ?? displayedTask.ownerAgentId!)
                            setMessageDraft('')
                          }}><MessageSquare aria-hidden="true" /> Message task owner</button>
                        ) : null}
                        {displayedTask && !TERMINAL_TASK_STATUSES.has(displayedTask.status) ? (
                          <button type="button" className="av-danger" onClick={() => { setRunMenuOpen(false); setPendingAction({ kind: 'fail-task', task: displayedTask }) }}><AlertTriangle aria-hidden="true" /> Mark task failed</button>
                        ) : null}
                        <button type="button" onClick={() => { setRunMenuOpen(false); void cleanupRun() }} disabled={busyAction === 'cleanup'}><ShieldCheck aria-hidden="true" /> Clean worktrees</button>
                        <button type="button" className="av-danger" onClick={() => { setRunMenuOpen(false); setPendingAction({ kind: 'delete-run' }) }}><Trash2 aria-hidden="true" /> Delete workflow</button>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="av-coord-overview" aria-label="Run overview">
                  <div className="av-coord-metrics">
                    <div className="av-coord-metric">
                      <Workflow aria-hidden="true" />
                      <div><strong>{runs.length}</strong><span>workflows</span></div>
                      <MetricGauge value={runs.length} label={`${runs.length} workflows loaded`} />
                    </div>
                    <div className="av-coord-metric">
                      <Bot aria-hidden="true" />
                      <div><strong>{agents.length}</strong><span>agents</span></div>
                      <MetricGauge value={agents.length} label={`${agents.length} agents in this workflow`} />
                    </div>
                    <div className="av-coord-metric av-coord-metric-working">
                      <Activity aria-hidden="true" />
                      <div><strong>{workingAgents}</strong><span>working</span></div>
                      <MetricGauge value={workingAgents} label={`${workingAgents} of ${agents.length} agents working`} />
                    </div>
                    <div className="av-coord-metric av-coord-metric-queued">
                      <Clock3 aria-hidden="true" />
                      <div><strong>{queuedTasks}</strong><span>queued</span></div>
                      <MetricGauge value={queuedTasks} label={`${queuedTasks} tasks pending`} />
                    </div>
                    <div className={cn('av-coord-metric', attentionCount > 0 ? 'av-needs-attention' : '')}>
                      <Inbox aria-hidden="true" />
                      <div><strong>{attentionCount}</strong><span>attention</span></div>
                      <MetricGauge value={attentionCount} label={`${attentionCount} attention items shown`} />
                    </div>
                  </div>
                </section>

                <section className="av-coord-grid">
                  <div className={cn('av-coord-panel av-coord-team-panel', inspectorCollapsed ? 'av-collapsed' : '')}>
                    <div className="av-coord-panel-head">
                      <span>Agent Inspector</span>
                      <button type="button" onClick={() => setInspectorCollapsed((collapsed) => !collapsed)} aria-label={inspectorCollapsed ? 'Expand agent inspector' : 'Collapse agent inspector'} aria-expanded={!inspectorCollapsed}>
                        <ChevronDown size={13} className={inspectorCollapsed ? undefined : 'av-coord-chevron-expanded'} />
                      </button>
                    </div>
                    {selectedAgent && !inspectorCollapsed ? (
                      <div className="av-coord-detail av-coord-agent-detail">
                        <div className="av-coord-inspector-title">
                          <span className="av-coord-agent-avatar">{selectedAgent.name.slice(0, 2).toUpperCase()}</span>
                          <NativeSelect
                            className="av-coord-agent-picker"
                            aria-label="Agent to inspect"
                            value={selectedAgent.id}
                            onChange={(event) => setSelectedAgentId(event.target.value)}
                          >
                            {agents.map((agent) => <NativeSelectOption key={agent.id} value={agent.id}>{agent.name}</NativeSelectOption>)}
                          </NativeSelect>
                          <span className={cn('av-coord-status', `av-tone-${selectedAgent.turnActive ? 'good' : statusTone(selectedAgent.status)}`)}>{selectedAgent.turnActive ? 'working' : selectedAgent.status}</span>
                        </div>
                        <div><span>Provider</span><strong>{String(selectedAgent.provider).toUpperCase()}</strong></div>
                        <div><span>Role</span><strong>{selectedAgent.role}</strong></div>
                        <div><span>Task</span><strong>{tasks.find((task) => task.id === selectedAgent.taskId)?.title ?? selectedAgent.taskId ?? 'No task claimed'}</strong></div>
                        <div><span>Current</span><strong title={selectedAgentLatestEvent?.summary}>{selectedAgentLatestEvent?.type.replaceAll('.', ' ') ?? 'Waiting for activity'}</strong></div>
                        <div><span>CWD</span><strong title={selectedAgent.worktreePath}>{selectedAgent.worktreePath || run.baseCwd}</strong></div>
                        <div><span>Branch</span><strong>{selectedAgent.worktreeBranch || 'shared checkout'}</strong></div>
                        <div><span>Changes</span><strong>{selectedAgentWorktree ? `${selectedAgentWorktree.dirtyFiles} files · ${selectedAgentWorktree.aheadCommits} commits ahead` : 'Shared checkout'}</strong></div>
                        <div><span>Parent workflow</span><strong>{firstLine(run.prompt)}</strong></div>
                        <div className="av-coord-action-row">
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => openAgentSession(selectedAgent)}>
                          <Radio data-icon="inline-start" aria-hidden="true" /> Open Session
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => setGitReviewCwd(selectedAgent.worktreePath || run.baseCwd)}>
                          <GitBranch data-icon="inline-start" aria-hidden="true" /> Review Changes{selectedAgentWorktree && selectedAgentWorktree.dirtyFiles > 0 ? ` (${selectedAgentWorktree.dirtyFiles})` : ''}
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => { setMessageTarget(selectedAgent.name); setMessageDraft('') }}>
                          <MessageSquare data-icon="inline-start" aria-hidden="true" /> Message
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn av-danger" onClick={() => void interruptAgent(selectedAgent)} disabled={busyAction === `interrupt:${selectedAgent.id}`}>
                          <CircleStop data-icon="inline-start" aria-hidden="true" /> Stop
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

                  <div className="av-coord-panel av-coord-right-attention" aria-label="Needs attention">
                    <div className="av-coord-panel-head">
                      <span><AlertTriangle aria-hidden="true" /> Attention <b>{attentionCount}</b></span>
                    </div>
                    <div className="av-coord-right-attention-list">
                      {pendingPlanTasks.map((task) => (
                        <button key={`plan:${task.id}`} type="button" onClick={() => { selectTask(task); setTaskFilter('attention') }}>
                          <AlertTriangle aria-hidden="true" /><span><strong>{task.title}</strong><small>Plan is waiting for approval</small></span><b>Open</b>
                        </button>
                      ))}
                      {tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').map((task) => (
                        <button key={`task:${task.id}`} type="button" onClick={() => { selectTask(task); setTaskFilter('attention') }}>
                          <AlertTriangle aria-hidden="true" /><span><strong>{task.title}</strong><small>{task.blockedBy.length > 0 ? `Waiting on ${task.blockedBy.join(', ')}` : task.status}</small></span><b>Open</b>
                        </button>
                      ))}
                      {actionableMail > 0 ? (
                        <button type="button" onClick={() => {
                          setEventFilter('messages')
                          setSelectedEventIndex(-1)
                          window.requestAnimationFrame(() => eventsListRef.current?.querySelector<HTMLButtonElement>('button')?.focus())
                        }}>
                          <Mail aria-hidden="true" /><span><strong>{actionableMail} undelivered message{actionableMail === 1 ? '' : 's'}</strong><small>Open the activity inbox</small></span><b>Open</b>
                        </button>
                      ) : null}
                      {attentionCount === 0 ? <span className="av-coord-no-attention"><CheckCircle2 aria-hidden="true" /> No attention needed</span> : null}
                    </div>
                  </div>

                  <div className="av-coord-panel av-coord-task-panel">
                    <div className="av-coord-panel-head">
                      <span>Work Board</span>
                      <div className="av-coord-board-filters">
                        {taskFilter !== 'all' ? <button type="button" onClick={() => setTaskFilter('all')}>{taskFilter} ×</button> : null}
                        <span>{completedTasks}/{tasks.length}</span>
                      </div>
                    </div>
                    <div className="av-coord-filterbar" aria-label="Filter tasks">
                      <span className="av-coord-board-label">State</span><span className="av-coord-board-label">Task</span><span className="av-coord-board-label">Assigned agent</span><span className="av-coord-board-label">Provider</span><span className="av-coord-board-label">Elapsed</span><span className="av-coord-board-label">Depends on</span>
                    </div>
                    <div className="av-coord-list av-coord-board-list" onKeyDown={handleListNavigation}>
                      {taskRelationships.edges.length > 0 ? (
                        <svg
                          className="av-coord-dependency-graph"
                          viewBox={`0 0 44 ${taskRelationships.height}`}
                          preserveAspectRatio="none"
                          style={{ height: `${taskRelationships.height}px` }}
                          aria-hidden="true"
                        >
                          <defs>
                            <marker id="av-coord-dependency-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                              <path d="M 0 0 L 6 3 L 0 6 z" />
                            </marker>
                          </defs>
                          {taskRelationships.edges.map((edge, index) => {
                            const laneX = 9 + ((index % 3) * 7)
                            return (
                              <path
                                key={`${edge.dependencyId}:${edge.taskId}`}
                                className="av-coord-dependency-edge"
                                d={`M 38 ${edge.fromY} H ${laneX} V ${edge.toY} H 38`}
                                markerEnd="url(#av-coord-dependency-arrow)"
                              />
                            )
                          })}
                        </svg>
                      ) : null}
                      {filteredTasks.length === 0 ? <div className="av-coord-empty-state">No tasks in this view.</div> : TASK_GROUP_ORDER.map((group) => groupedTasks[group].length > 0 ? (
                        <section key={group} className={`av-coord-task-group av-coord-task-group-${group}`}>
                          <h3>{group} <b>{groupedTasks[group].length}</b></h3>
                          {groupedTasks[group].map((task, taskIndex) => {
                            const owner = task.ownerAgentId ? agentsById.get(task.ownerAgentId) : null
                            return (
                              <button key={task.id} type="button" className={cn('av-coord-task-row', taskIndex === groupedTasks[group].length - 1 ? 'av-last' : '', displayedTask?.id === task.id ? 'av-selected' : '')} onClick={() => selectTask(task)}>
                                <span className="av-coord-task-branch" aria-hidden="true" />
                                <span className={cn('av-coord-status', `av-tone-${statusTone(task.status)}`)}>{task.status}</span>
                                <span className="av-coord-task-title"><strong>{task.title}</strong><small>{task.paths[0] ?? task.id}</small></span>
                                <strong>{owner?.name ?? 'unassigned'}</strong>
                                <span className={`av-coord-provider-name av-provider-${owner?.provider ?? run.provider}`}>{String(owner?.provider ?? run.provider).toUpperCase()}</span>
                                <span>{formatAge(task.createdAt)}</span>
                                <span>{task.blockedBy.length > 0 ? task.blockedBy.map((id) => tasks.find((entry) => entry.id === id)?.title ?? id).join(', ') : '—'}</span>
                              </button>
                            )
                          })}
                        </section>
                      ) : null)}
                    </div>
                    {displayedTask && planStates.get(displayedTask.id) === 'awaiting' ? (
                      <div className="av-coord-task-actions" aria-label={`Actions for ${displayedTask.title}`}>
                        <Button type="button" size="sm" className="av-coord-btn av-coord-primary" onClick={() => void reviewPlan(displayedTask, true)} disabled={busyAction === `plan:${displayedTask.id}`}>
                          <CheckCircle2 data-icon="inline-start" aria-hidden="true" /> Approve Plan
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="av-coord-btn av-danger" onClick={() => void reviewPlan(displayedTask, false)} disabled={busyAction === `plan:${displayedTask.id}`}>
                          <X data-icon="inline-start" aria-hidden="true" /> Reject Plan
                        </Button>
                      </div>
                    ) : null}
                    <div className="av-coord-throughput" aria-label="Workflow throughput">
                      <div className="av-coord-throughput-chart">
                        <span>Event throughput</span>
                        <svg viewBox="0 0 360 54" preserveAspectRatio="none" role="img" aria-label={activityThroughput.label}>
                          <title>{activityThroughput.label}</title>
                          <polyline points={activityThroughput.points} />
                        </svg>
                      </div>
                      <div><strong>{events.length}</strong><span>events</span><small>run activity</small></div>
                      <div><strong>{completedTasks}/{tasks.length}</strong><span>tasks</span><small>progress</small></div>
                      <div><strong>{agents.length > 0 ? Math.round((workingAgents / agents.length) * 100) : 0}%</strong><span>agents active</span><small>right now</small></div>
                    </div>
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
                      <div className="av-coord-list" ref={eventsListRef} onKeyDown={handleListNavigation}>
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

        <footer className="av-coord-global-footer" aria-label="Keyboard shortcuts">
          <span><kbd>⌘K</kbd> commands</span>
          <span><kbd>/</kbd> search</span>
          <span><kbd>N</kbd> new workflow</span>
          <span><kbd>J/K</kbd> navigate</span>
        </footer>

        {gitReviewCwd ? <GitPopover open cwd={gitReviewCwd} onClose={() => setGitReviewCwd(null)} /> : null}

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

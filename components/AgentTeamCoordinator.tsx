'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CircleStop,
  CheckCircle2,
  GitMerge,
  Mail,
  MessageSquare,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UsersRound,
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
  open: boolean
  provider: ProviderSelection
  selectedSession: Session | null
  onClose: () => void
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
  open,
  provider,
  selectedSession,
  onClose,
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

  const run = snapshot?.run ?? null
  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null
  const selectedEvent = events.length === 0
    ? null
    : events[selectedEventIndex < 0 ? events.length - 1 : Math.min(selectedEventIndex, events.length - 1)] ?? null
  const undeliveredMail = (snapshot?.messages ?? []).filter((message) => !message.deliveredAt).length
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const taskProgress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0
  const targetProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
  const baseCwd = selectedSession?.cwd ?? run?.baseCwd ?? ''

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
    if (!open) return
    let cancelled = false
    void loadRuns().catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load coordinated runs')
    })
    return () => { cancelled = true }
  }, [loadRuns, open])

  useEffect(() => {
    if (!open || !runId) {
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
  }, [loadSnapshot, open, runId])

  useEffect(() => {
    const cwd = snapshot?.run.baseCwd
    if (!open || !cwd) return
    let cancelled = false
    const refresh = () => {
      void refreshWorktrees(cwd).catch(() => {
        if (!cancelled) setWorktreeStats(new Map())
      })
    }
    refresh()
    const timer = window.setInterval(refresh, WORKTREE_STATS_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [open, refreshWorktrees, snapshot?.run.baseCwd])

  const appendEvent = useCallback(async (event: AgentProtocolEvent) => {
    const next = await jsonFetch<ProtocolRunSnapshot>(`/api/agent-protocol/runs/${encodeURIComponent(event.runId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    setSnapshot(next)
  }, [])

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
    onClose()
  }, [onClose, onOpenSession])

  const pendingLabel = pendingAction?.kind === 'stop'
    ? 'Stop this run and interrupt every live teammate turn?'
    : pendingAction?.kind === 'delete-run'
    ? 'Delete this run ledger? Clean worktrees are removed; unmerged ones are kept.'
    : pendingAction?.kind === 'merge'
    ? `Squash-merge ${pendingAction.agent.name}'s worktree into the main checkout?`
    : pendingAction?.kind === 'fail-task'
    ? `Mark ${pendingAction.task.id} failed?`
    : null

  if (!open) return null

  return (
    <div className="av-coord-overlay" role="dialog" aria-modal="true" aria-label="Agent team coordinator">
      <div className="av-coord-shell">
        <header className="av-coord-header">
          <div className="av-coord-title">
            <UsersRound size={18} />
            <div>
              <h2>Agent Team</h2>
              <span>{run ? `${run.status.toUpperCase()} · ${String(run.provider).toUpperCase()} · ${formatAge(run.createdAt)} ago` : 'No run selected'}</span>
            </div>
          </div>
          <div className="av-coord-header-actions">
            {run?.requirePlanApproval ? <span className="av-coord-guard"><ShieldCheck size={13} /> plans</span> : null}
            {run?.gateCommand ? <span className="av-coord-guard"><Zap size={13} /> gate</span> : null}
            {undeliveredMail > 0 ? <span className="av-coord-mail"><Mail size={13} /> {undeliveredMail}</span> : null}
            <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => setStartOpen(true)}>
              <Plus size={14} /> New
            </Button>
            <Button type="button" variant="ghost" size="icon" className="av-coord-icon" onClick={onClose} aria-label="Close coordinator">
              <X size={18} />
            </Button>
          </div>
        </header>

        {notice || loadError ? (
          <div className={cn('av-coord-notice', loadError ? 'av-coord-notice-error' : '')}>
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
              <span>Runs</span>
              <button type="button" onClick={() => void loadRuns()} aria-label="Refresh runs">
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="av-coord-run-list">
              {runs.length === 0 ? (
                <button type="button" className="av-coord-empty-run" onClick={() => setStartOpen(true)}>
                  <Plus size={15} /> New run
                </button>
              ) : runs.map((entry) => (
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
                    value={promptDraft}
                    onChange={(event) => setPromptDraft(event.target.value)}
                    placeholder="Describe the work for the lead to decompose."
                    className="av-coord-textarea"
                    rows={6}
                  />
                </label>
                <div className="av-coord-start-grid">
                  <label className="av-coord-field">
                    <span>Provider</span>
                    <Input value={String(targetProvider).toUpperCase()} readOnly className="av-coord-input" />
                  </label>
                  <label className="av-coord-field">
                    <span>Teammates</span>
                    <Input
                      type="number"
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
                      onChange={(event) => setGateCommand(event.target.value)}
                      placeholder="npx tsc --noEmit"
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
                    {busyAction === 'start' ? <RefreshCw size={14} /> : <Play size={14} />} Start
                  </Button>
                </div>
              </section>
            ) : (
              <>
                <section className="av-coord-toolbar">
                  <div className="av-coord-progress">
                    <div>
                      <strong>{completedTasks}/{tasks.length}</strong>
                      <span>tasks complete</span>
                    </div>
                    <div className="av-coord-progress-track" aria-label={`${taskProgress}% complete`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskProgress}>
                      <span style={{ width: `${taskProgress}%` }} />
                    </div>
                  </div>
                  <div className="av-coord-toolbar-actions">
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => setPendingAction({ kind: 'stop' })} disabled={!['planning', 'running', 'synthesizing'].includes(run.status)}>
                      <CircleStop size={13} /> Stop
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn" onClick={() => void cleanupRun()} disabled={busyAction === 'cleanup'}>
                      <ShieldCheck size={13} /> Clean
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="av-coord-btn av-danger" onClick={() => setPendingAction({ kind: 'delete-run' })}>
                      <Trash2 size={13} /> Delete
                    </Button>
                  </div>
                </section>

                <section className="av-coord-grid">
                  <div className="av-coord-panel">
                    <div className="av-coord-panel-head">
                      <span>Team</span>
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
                            <span className={cn('av-coord-status', `av-tone-${statusTone(agent.status)}`)}>{agent.status}</span>
                            {agent.taskId ? <small>{agent.taskId}</small> : null}
                            {stats && (stats.aheadCommits > 0 || stats.dirtyFiles > 0) ? (
                              <em>{stats.aheadCommits > 0 ? `+${stats.aheadCommits}` : ''}{stats.dirtyFiles > 0 ? ` ~${stats.dirtyFiles}` : ''}</em>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                    {selectedAgent ? (
                      <div className="av-coord-action-row">
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => openAgentSession(selectedAgent)}>
                          <Radio size={13} /> Open
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => { setMessageTarget(selectedAgent.name); setMessageDraft('') }}>
                          <MessageSquare size={13} /> Message
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="av-coord-btn" onClick={() => void interruptAgent(selectedAgent)} disabled={busyAction === `interrupt:${selectedAgent.id}`}>
                          <CircleStop size={13} /> Interrupt
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
                          <GitMerge size={13} /> Merge
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="av-coord-panel">
                    <div className="av-coord-panel-head">
                      <span>Tasks</span>
                      <span>{completedTasks}/{tasks.length}</span>
                    </div>
                    <div className="av-coord-list">
                      {tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          className={cn('av-coord-task-row', selectedTask?.id === task.id ? 'av-selected' : '')}
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          <span className={cn('av-coord-status', `av-tone-${statusTone(task.status)}`)}>{task.status}</span>
                          <strong>{task.id}</strong>
                          <span>{task.title}</span>
                        </button>
                      ))}
                    </div>
                    {selectedTask ? (
                      <div className="av-coord-detail">
                        <div><span>Owner</span><strong>{selectedTask.ownerAgentId ? agentsById.get(selectedTask.ownerAgentId)?.name ?? selectedTask.ownerAgentId : 'unassigned'}</strong></div>
                        {selectedTask.blockedBy.length > 0 ? <div><span>Deps</span><strong>{selectedTask.blockedBy.join(', ')}</strong></div> : null}
                        {selectedTask.paths.length > 0 ? <div><span>Paths</span><strong>{selectedTask.paths.join(', ')}</strong></div> : null}
                        <p>{selectedTask.prompt}</p>
                        {!['completed', 'failed', 'cancelled'].includes(selectedTask.status) ? (
                          <Button type="button" variant="outline" size="sm" className="av-coord-btn av-danger" onClick={() => setPendingAction({ kind: 'fail-task', task: selectedTask })}>
                            <AlertTriangle size={13} /> Mark failed
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="av-coord-panel">
                    <div className="av-coord-panel-head">
                      <span>Events</span>
                      <button type="button" onClick={() => setSelectedEventIndex(-1)} aria-label="Follow latest event">
                        <Radio size={13} />
                      </button>
                    </div>
                    <div className="av-coord-list">
                      {events.map((event, index) => {
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
                        <span>Synthesis</span>
                        <p>{run.summary}</p>
                      </div>
                    ) : null}
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
            <Input value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} className="av-coord-input" autoFocus />
            <Button type="button" className="av-coord-btn av-coord-primary" onClick={() => void sendMessage()} disabled={!messageDraft.trim() || busyAction === 'message'}>
              <Send size={14} /> Send
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
    </div>
  )
}

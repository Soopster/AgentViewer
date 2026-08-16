'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
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
  Minus,
  MoreVertical,
  Play,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AGENT_PROTOCOL_VERSION } from '@/lib/agentProtocol'
import type { AgentProtocolEvent, PlaybookPhase, PlaybookSummary, PlaybookTask, ProtocolAgent, ProtocolAutonomy, ProtocolRun, ProtocolRunSnapshot, ProtocolTask, RunPlaybook } from '@/lib/agentProtocol'
import type { AgentProvider, ProviderSelection, Session } from '@/lib/types'
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
type PlaybooksResponse = { playbooks: PlaybookSummary[]; invalid: Array<{ file: string; error: string }> }
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

function nonEmptyLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

const NEW_PLAYBOOK_TEMPLATE: RunPlaybook = {
  name: 'new-playbook',
  description: 'Describe when this workflow should be used',
  argsHint: 'Describe the target or outcome',
  maxAgents: 3,
  autonomy: 'medium',
  requireReview: true,
  acceptanceContract: {
    goal: 'Complete the playbook outcome',
    userVisibleAcceptance: [],
    verificationCommands: [],
  },
  phases: [
    {
      title: 'Execute',
      tasks: [{
        key: 'work',
        title: 'Implement {{args}}',
        detail: 'Complete {{args}} with focused changes and proportionate verification.',
        role: 'teammate',
      }],
    },
    {
      title: 'Integrate',
      tasks: [{
        key: 'integrate',
        title: 'Review and integrate',
        detail: 'Review the completed lane, run final verification, and synthesize the result.',
        role: 'lead',
        dependsOn: ['work'],
      }],
    },
  ],
}

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
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(failure.error ?? `HTTP ${response.status}`)
  }
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (data.error) throw new Error(data.error)
  return data
}

function clonePlaybook(playbook: RunPlaybook): RunPlaybook {
  return structuredClone(playbook)
}

function splitPlaybookList(value: string): string[] | undefined {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.length > 0 ? entries : undefined
}

function StructuredPlaybookEditor({
  value,
  busy,
  onChange,
  onSave,
}: {
  value: RunPlaybook
  busy: boolean
  onChange: (value: RunPlaybook) => void
  onSave: () => void
}) {
  const update = (patch: Partial<RunPlaybook>) => onChange({ ...value, ...patch })
  const updatePhase = (phaseIndex: number, patch: Partial<PlaybookPhase>) => update({
    phases: value.phases.map((phase, index) => index === phaseIndex ? { ...phase, ...patch } : phase),
  })
  const updateTask = (phaseIndex: number, taskIndex: number, patch: Partial<PlaybookTask>) => {
    const phase = value.phases[phaseIndex]
    if (!phase) return
    updatePhase(phaseIndex, {
      tasks: phase.tasks.map((task, index) => index === taskIndex ? { ...task, ...patch } : task),
    })
  }
  const addPhase = () => update({
    phases: [...value.phases, {
      title: `Phase ${value.phases.length + 1}`,
      tasks: [{ key: `task-${value.phases.length + 1}`, title: 'New task', detail: 'Describe the task outcome.', role: 'teammate' }],
    }],
  })
  const removePhase = (phaseIndex: number) => {
    if (value.phases.length <= 1) return
    update({ phases: value.phases.filter((_, index) => index !== phaseIndex) })
  }
  const addTask = (phaseIndex: number) => {
    const phase = value.phases[phaseIndex]
    if (!phase) return
    updatePhase(phaseIndex, {
      tasks: [...phase.tasks, {
        key: `task-${phaseIndex + 1}-${phase.tasks.length + 1}`,
        title: 'New task',
        detail: 'Describe the task outcome.',
        role: 'teammate',
      }],
    })
  }
  const removeTask = (phaseIndex: number, taskIndex: number) => {
    const phase = value.phases[phaseIndex]
    if (!phase || phase.tasks.length <= 1) return
    updatePhase(phaseIndex, { tasks: phase.tasks.filter((_, index) => index !== taskIndex) })
  }

  return (
    <div className="av-coord-structured-editor">
      <div className="av-coord-playbook-editor-head">
        <div><strong>Playbook settings</strong><small>Saved as validated repository JSON.</small></div>
        <Button type="button" size="sm" disabled={busy} onClick={onSave}><Save data-icon="inline-start" aria-hidden="true" /> {busy ? 'Saving…' : 'Save playbook'}</Button>
      </div>
      <div className="av-coord-playbook-settings-grid">
        <div className="av-coord-field av-coord-third"><Label htmlFor="playbook-name">Name</Label><Input id="playbook-name" value={value.name} onChange={(event) => update({ name: event.target.value })} placeholder="lowercase-slug" /></div>
        <div className="av-coord-field av-coord-third"><Label htmlFor="playbook-agents">Agent limit</Label><Input id="playbook-agents" type="number" min={2} max={6} value={value.maxAgents ?? 3} onChange={(event) => update({ maxAgents: Math.min(6, Math.max(2, Number(event.target.value) || 2)) })} /></div>
        <div className="av-coord-field av-coord-third"><Label htmlFor="playbook-autonomy">Autonomy</Label><NativeSelect id="playbook-autonomy" value={value.autonomy ?? 'medium'} onChange={(event) => update({ autonomy: event.target.value as ProtocolAutonomy })}><NativeSelectOption value="low">Low · approve phase changes</NativeSelectOption><NativeSelectOption value="medium">Medium · bounded decisions</NativeSelectOption><NativeSelectOption value="high">High · continue automatically</NativeSelectOption></NativeSelect></div>
        <div className="av-coord-field av-coord-wide"><Label htmlFor="playbook-description">Description</Label><Textarea id="playbook-description" rows={3} value={value.description ?? ''} onChange={(event) => update({ description: event.target.value || undefined })} placeholder="When should this workflow be used?" /></div>
        <div className="av-coord-field"><Label htmlFor="playbook-args-hint">Argument guidance <em>optional</em></Label><Textarea id="playbook-args-hint" rows={2} value={value.argsHint ?? ''} onChange={(event) => update({ argsHint: event.target.value || undefined })} placeholder="Example: target path or objective" /></div>
        <div className="av-coord-field"><Label htmlFor="playbook-gate">Completion gate <em>optional</em></Label><Input id="playbook-gate" value={value.gateCommand ?? ''} onChange={(event) => update({ gateCommand: event.target.value || undefined })} placeholder="npx tsc --noEmit" /></div>
        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id="playbook-plan-approval" checked={value.requirePlanApproval === true} onCheckedChange={(checked) => update({ requirePlanApproval: checked === true })} />
          <div><Label htmlFor="playbook-plan-approval">Require teammate plan approval</Label><small>Workers submit a plan before implementation; explicit lead tasks execute directly.</small></div>
        </div>
        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id="playbook-judgment-review" checked={value.requireReview === true} onCheckedChange={(checked) => update({ requireReview: checked === true })} />
          <div><Label htmlFor="playbook-judgment-review">Require judgment review</Label><small>Mechanical verification must be followed by an intent, scope, and risk review.</small></div>
        </div>
        <div className="av-coord-field av-coord-wide"><Label htmlFor="playbook-acceptance-goal">Acceptance goal</Label><Input id="playbook-acceptance-goal" value={value.acceptanceContract?.goal ?? ''} onChange={(event) => update({ acceptanceContract: { ...value.acceptanceContract, goal: event.target.value } })} placeholder="Observable workflow outcome" /></div>
        <div className="av-coord-field"><Label htmlFor="playbook-acceptance-criteria">Acceptance criteria <em>one per line</em></Label><Textarea id="playbook-acceptance-criteria" rows={3} value={value.acceptanceContract?.userVisibleAcceptance?.join('\n') ?? ''} onChange={(event) => update({ acceptanceContract: { ...value.acceptanceContract, userVisibleAcceptance: nonEmptyLines(event.target.value) } })} /></div>
        <div className="av-coord-field"><Label htmlFor="playbook-verification">Verification commands <em>one per line</em></Label><Textarea id="playbook-verification" rows={3} value={value.acceptanceContract?.verificationCommands?.join('\n') ?? ''} onChange={(event) => update({ acceptanceContract: { ...value.acceptanceContract, verificationCommands: nonEmptyLines(event.target.value) } })} /></div>
      </div>

      <div className="av-coord-playbook-phases">
        <div className="av-coord-playbook-section-head"><div><strong>Workflow phases</strong><small>Phases are barriers; every task waits for the preceding phase.</small></div><Button type="button" variant="outline" size="sm" onClick={addPhase}><Plus data-icon="inline-start" aria-hidden="true" /> Add phase</Button></div>
        {value.phases.map((phase, phaseIndex) => (
          <Card key={`phase-${phaseIndex}`} className="av-coord-playbook-phase">
            <CardHeader>
              <div className="av-coord-playbook-phase-head">
                <span>{String(phaseIndex + 1).padStart(2, '0')}</span>
                <Input value={phase.title} aria-label={`Phase ${phaseIndex + 1} title`} onChange={(event) => updatePhase(phaseIndex, { title: event.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Delete phase ${phaseIndex + 1}`} disabled={value.phases.length <= 1} onClick={() => removePhase(phaseIndex)}><Trash2 aria-hidden="true" /></Button>
              </div>
            </CardHeader>
            <CardContent className="av-coord-playbook-task-list">
              {phase.tasks.map((task, taskIndex) => (
                <fieldset key={`task-${taskIndex}`} className="av-coord-playbook-task">
                  <legend>Task {taskIndex + 1}</legend>
                  <div className="av-coord-playbook-task-grid">
                    <div className="av-coord-field"><Label>Key <em>optional</em></Label><Input value={task.key ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { key: event.target.value || undefined })} placeholder="stable-key" /></div>
                    <div className="av-coord-field"><Label>Assigned role</Label><NativeSelect value={task.role ?? 'teammate'} onChange={(event) => updateTask(phaseIndex, taskIndex, { role: event.target.value as PlaybookTask['role'] })}><NativeSelectOption value="teammate">Teammate</NativeSelectOption><NativeSelectOption value="lead">Lead</NativeSelectOption><NativeSelectOption value="any">Any available agent</NativeSelectOption></NativeSelect></div>
                    <div className="av-coord-field"><Label>Seat</Label><NativeSelect value={task.seat ?? (task.role === 'lead' ? 'director' : 'executor')} onChange={(event) => updateTask(phaseIndex, taskIndex, { seat: event.target.value as PlaybookTask['seat'] })}><NativeSelectOption value="director">Director</NativeSelectOption><NativeSelectOption value="executor">Executor</NativeSelectOption><NativeSelectOption value="validator">Validator</NativeSelectOption><NativeSelectOption value="watcher">Watcher</NativeSelectOption></NativeSelect></div>
                    <div className="av-coord-field"><Label>Requested provider <em>optional</em></Label><NativeSelect value={task.provider ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { provider: (event.target.value || undefined) as PlaybookTask['provider'] })}><NativeSelectOption value="">Any provider</NativeSelectOption>{PROVIDER_ORDER.map((entry) => <NativeSelectOption key={entry} value={entry}>{entry.toUpperCase()}</NativeSelectOption>)}</NativeSelect></div>
                    <div className="av-coord-field"><Label>Requested model <em>optional</em></Label><Input value={task.model ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { model: event.target.value || undefined })} placeholder="Provider-native model id" /></div>
                    <div className="av-coord-field"><Label>Effort <em>optional</em></Label><Input value={task.effort ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { effort: event.target.value || undefined })} placeholder="high" /></div>
                    <div className="av-coord-field av-coord-wide"><Label>Title</Label><Input value={task.title} onChange={(event) => updateTask(phaseIndex, taskIndex, { title: event.target.value })} placeholder="Task outcome" /></div>
                    <div className="av-coord-field av-coord-wide"><Label>Instructions</Label><Textarea value={task.detail} rows={4} onChange={(event) => updateTask(phaseIndex, taskIndex, { detail: event.target.value })} placeholder="Full task instructions and acceptance checks" /></div>
                    <div className="av-coord-field"><Label>Write paths <em>comma-separated</em></Label><Input value={task.paths?.join(', ') ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { paths: splitPlaybookList(event.target.value) })} placeholder="lib/example.ts, app/api" /></div>
                    <div className="av-coord-field"><Label>Dependencies <em>task keys</em></Label><Input value={task.dependsOn?.join(', ') ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { dependsOn: splitPlaybookList(event.target.value) })} placeholder="survey, implement" /></div>
                    <div className="av-coord-field av-coord-wide"><Label>Task verification <em>one command per line</em></Label><Textarea value={task.verifyCommands?.join('\n') ?? ''} rows={2} onChange={(event) => updateTask(phaseIndex, taskIndex, { verifyCommands: nonEmptyLines(event.target.value) })} placeholder="npx tsc --noEmit" /></div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" disabled={phase.tasks.length <= 1} onClick={() => removeTask(phaseIndex, taskIndex)}><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete task</Button>
                </fieldset>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addTask(phaseIndex)}><Plus data-icon="inline-start" aria-hidden="true" /> Add task</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function PlaybookManager({
  cwd,
  onClose,
  onChanged,
  onNotice,
}: {
  cwd: string
  onClose: () => void
  onChanged: (playbooks: PlaybookSummary[], preferredName?: string) => void
  onNotice: (message: string) => void
}) {
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([])
  const [invalid, setInvalid] = useState<Array<{ file: string; error: string }>>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [draft, setDraft] = useState<RunPlaybook | null>(null)
  const [deleteName, setDeleteName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (preferredName?: string) => {
    const query = new URLSearchParams({ cwd }).toString()
    const listing = await jsonFetch<PlaybooksResponse>(`/api/agent-protocol/playbooks?${query}`)
    setPlaybooks(listing.playbooks)
    setInvalid(listing.invalid)
    setSelectedName((current) => preferredName
      ?? (current && listing.playbooks.some((entry) => entry.name === current) ? current : listing.playbooks[0]?.name ?? null))
    onChanged(listing.playbooks, preferredName)
  }, [cwd, onChanged])

  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ cwd }).toString()
    void jsonFetch<PlaybooksResponse>(`/api/agent-protocol/playbooks?${query}`).then((listing) => {
      if (cancelled) return
      setPlaybooks(listing.playbooks)
      setInvalid(listing.invalid)
      setSelectedName(listing.playbooks[0]?.name ?? null)
      onChanged(listing.playbooks)
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'Failed to load playbooks')
    })
    return () => { cancelled = true }
  }, [cwd, onChanged])

  const editSelected = useCallback(async () => {
    if (!selectedName || busy) return
    setBusy(true)
    setError(null)
    try {
      const query = new URLSearchParams({ cwd, name: selectedName }).toString()
      const result = await jsonFetch<{ playbook: RunPlaybook }>(`/api/agent-protocol/playbooks?${query}`)
      setEditingName(selectedName)
      setDraft(clonePlaybook(result.playbook))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to open playbook')
    } finally {
      setBusy(false)
    }
  }, [busy, cwd, selectedName])

  const createPlaybook = useCallback(() => {
    setEditingName(null)
    setDraft(clonePlaybook(NEW_PLAYBOOK_TEMPLATE))
    setError(null)
  }, [])

  const savePlaybook = useCallback(async () => {
    if (busy) return
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const result = await jsonFetch<{ playbook: RunPlaybook }>('/api/agent-protocol/playbooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, playbook: draft, previousName: editingName ?? undefined }),
      })
      await load(result.playbook.name)
      setEditingName(null)
      setDraft(null)
      onNotice(`Saved playbook ${result.playbook.name}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save playbook')
    } finally {
      setBusy(false)
    }
  }, [busy, cwd, draft, editingName, load, onNotice])

  const deletePlaybook = useCallback(async () => {
    if (!deleteName || busy) return
    setBusy(true)
    setError(null)
    try {
      await jsonFetch('/api/agent-protocol/playbooks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, name: deleteName }),
      })
      const deleted = deleteName
      setDeleteName(null)
      await load()
      onNotice(`Deleted playbook ${deleted}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to delete playbook')
    } finally {
      setBusy(false)
    }
  }, [busy, cwd, deleteName, load, onNotice])

  const selected = playbooks.find((entry) => entry.name === selectedName) ?? null

  return (
    <Card className="av-coord-playbook-manager">
      <CardHeader>
        <div className="av-coord-playbook-manager-head">
          <div>
            <CardTitle>Playbook manager</CardTitle>
            <CardDescription>Create and maintain reusable Coordinator task graphs stored in this workspace.</CardDescription>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}><ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back to workflow</Button>
        </div>
      </CardHeader>
      <CardContent className="av-coord-playbook-manager-layout">
        <section className="av-coord-playbook-list" aria-label="Saved playbooks">
          <div className="av-coord-playbook-list-head">
            <div><strong>Saved playbooks</strong><small>{playbooks.length} reusable workflow{playbooks.length === 1 ? '' : 's'}</small></div>
            <div className="av-coord-playbook-actions">
              <Button type="button" size="sm" onClick={createPlaybook}><Plus data-icon="inline-start" aria-hidden="true" /> New</Button>
              <Button type="button" variant="outline" size="sm" disabled={!selected || busy} onClick={() => void editSelected()}><Pencil data-icon="inline-start" aria-hidden="true" /> Edit</Button>
            </div>
          </div>
          {playbooks.length === 0 ? <p>No playbooks yet. Create one to seed a workflow without a planning turn.</p> : playbooks.map((entry) => (
            <button
              key={entry.name}
              type="button"
              className={cn('av-coord-playbook-row', 'av-hover-control', entry.name === selectedName && 'av-selected')}
              onClick={() => setSelectedName(entry.name)}
            >
              <strong>{entry.name}</strong>
              <span>{entry.phaseCount} phases · {entry.taskCount} tasks</span>
            </button>
          ))}
          {invalid.length > 0 ? <p className="av-coord-playbook-invalid">{invalid.length} invalid playbook file{invalid.length === 1 ? '' : 's'} detected.</p> : null}
        </section>

        <section className="av-coord-playbook-editor">
          {draft ? (
            <>
              <div className="av-coord-playbook-editor-head">
                <div><strong>{editingName ? `Edit ${editingName}` : 'Create playbook'}</strong><small>Change the name to rename its repository file.</small></div>
              </div>
              <StructuredPlaybookEditor value={draft} busy={busy} onChange={setDraft} onSave={() => void savePlaybook()} />
            </>
          ) : selected ? (
            <>
              <div className="av-coord-playbook-detail">
                <BookOpen aria-hidden="true" />
                <div><strong>{selected.name}</strong><p>{selected.description ?? 'No description'}</p></div>
              </div>
              <dl>
                <div><dt>Phases</dt><dd>{selected.phaseCount}</dd></div>
                <div><dt>Tasks</dt><dd>{selected.taskCount}</dd></div>
                <div><dt>Arguments</dt><dd>{selected.expectsArgs ? selected.argsHint ?? 'Required' : 'Not required'}</dd></div>
                <div><dt>Agents</dt><dd>{selected.maxAgents ?? 'Launcher default'}</dd></div>
                <div><dt>Completion gate</dt><dd>{selected.gateCommand ?? 'Not configured'}</dd></div>
                <div><dt>Autonomy</dt><dd>{selected.autonomy ?? 'medium'}</dd></div>
                <div><dt>Judgment review</dt><dd>{selected.requireReview ? 'Required' : 'Automatic'}</dd></div>
              </dl>
              {deleteName === selected.name ? (
                <div className="av-coord-playbook-delete" role="alert">
                  <span>Delete {selected.name}? This removes its repository JSON file.</span>
                  <div><Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void deletePlaybook()}>Delete</Button><Button type="button" variant="outline" size="sm" onClick={() => setDeleteName(null)}>Cancel</Button></div>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setDeleteName(selected.name)}><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete playbook</Button>
              )}
            </>
          ) : <p>Select a playbook or create a new one.</p>}
        </section>
      </CardContent>
      {error ? <CardFooter><p className="av-coord-playbook-invalid" role="alert">{error}</p></CardFooter> : null}
    </Card>
  )
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
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([])
  const [playbookName, setPlaybookName] = useState('')
  const [playbookArgs, setPlaybookArgs] = useState('')
  const [playbookManagerOpen, setPlaybookManagerOpen] = useState(false)
  const [maxAgents, setMaxAgents] = useState(3)
  const [runProviderOverride, setRunProviderOverride] = useState<AgentProvider | null>(null)
  const [teammateProviderOverride, setTeammateProviderOverride] = useState<AgentProvider[] | null>(null)
  const [gateCommand, setGateCommand] = useState('')
  const [requirePlanApproval, setRequirePlanApproval] = useState(true)
  const [autonomy, setAutonomy] = useState<ProtocolAutonomy>('medium')
  const [requireReview, setRequireReview] = useState(true)
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [nonGoals, setNonGoals] = useState('')
  const [manualQa, setManualQa] = useState('')
  const [escalationTriggers, setEscalationTriggers] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [maxDurationMinutes, setMaxDurationMinutes] = useState('')
  const [useWorktrees, setUseWorktrees] = useState(true)
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
  const selectedAgentWorktree = selectedAgent?.worktreeBranch && selectedAgent.worktreePath !== run?.baseCwd
    ? worktreeStats.get(selectedAgent.worktreePath)
    : undefined
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
  const phaseGate = run?.phaseReports.find((report) => report.status === 'awaiting_approval') ?? null
  const openDecisions = tasks.flatMap((task) => (task.receipt?.needsDecision ?? [])
    .filter((decision) => decision.status === 'open').map((decision) => ({ task, decision })))
  const reviewPending = run?.requireReview === true && run.review.status === 'pending'
    && tasks.length > 0 && tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))
  const recurringLearnings = run?.learningCandidates.filter((candidate) => candidate.status === 'recurring') ?? []
  const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
  const targetProvider = runProviderOverride ?? suggestedProvider
  const teammateProviders = teammateProviderOverride ?? [targetProvider]
  const baseCwd = selectedSession?.cwd ?? run?.baseCwd ?? ''
  const selectedPlaybook = playbooks.find((entry) => entry.name === playbookName) ?? null
  const playbookArgsReady = !selectedPlaybook?.expectsArgs || playbookArgs.trim().length > 0
  const launchReady = Boolean(promptDraft.trim() || selectedPlaybook) && playbookArgsReady
  const playbookArgsHint = selectedPlaybook?.argsHint?.trim()
  const playbookArgsPlaceholder = playbookArgsHint && playbookArgsHint.toLowerCase() !== 'none'
    ? playbookArgsHint
    : selectedPlaybook?.expectsArgs ? 'Enter required JSON or text' : 'Add optional JSON or text'
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
      || (eventFilter === 'attention' && ['agent.blocked', 'task.failed', 'lock.denied', 'plan.rejected', 'review.requested', 'phase.reported', 'phase.rejected', 'decision.raised', 'model.drift'].includes(event.type))
      || (eventFilter === 'messages' && ['message', 'finding', 'learning', 'handoff'].includes(event.type))
      || (eventFilter === 'tasks' && (event.type.startsWith('task.') || event.type.startsWith('plan.')))
    return include ? [{ event, index }] : []
  }), [eventFilter, events])
  const selectedEvent = selectedEventIndex < 0
    ? filteredEvents.at(-1)?.event ?? null
    : filteredEvents.find((entry) => entry.index === selectedEventIndex)?.event ?? filteredEvents.at(-1)?.event ?? null
  const attentionTaskCount = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').length
  const attentionCount = terminalRun ? 0 : attentionTaskCount + pendingPlanTasks.length + actionableMail
    + (phaseGate ? 1 : 0) + (reviewPending ? 1 : 0) + openDecisions.length + recurringLearnings.length
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

  const selectPlaybook = useCallback((name: string, available = playbooks) => {
    setPlaybookName(name)
    setPlaybookArgs('')
    const selected = available.find((entry) => entry.name === name)
    if (!selected) return
    if (selected.maxAgents) setMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
    if (selected.gateCommand !== undefined) setGateCommand(selected.gateCommand)
    if (selected.requirePlanApproval !== undefined) setRequirePlanApproval(selected.requirePlanApproval)
    if (selected.autonomy) setAutonomy(selected.autonomy)
    if (selected.requireReview !== undefined) setRequireReview(selected.requireReview)
  }, [playbooks])

  const handlePlaybooksChanged = useCallback((next: PlaybookSummary[], preferredName?: string) => {
    setPlaybooks(next)
    setPlaybookName((current) => {
      const target = preferredName ?? current
      return target && next.some((entry) => entry.name === target) ? target : ''
    })
    if (preferredName) {
      const selected = next.find((entry) => entry.name === preferredName)
      if (selected?.maxAgents) setMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
      if (selected?.gateCommand !== undefined) setGateCommand(selected.gateCommand)
      if (selected?.requirePlanApproval !== undefined) setRequirePlanApproval(selected.requirePlanApproval)
      if (selected?.autonomy) setAutonomy(selected.autonomy)
      if (selected?.requireReview !== undefined) setRequireReview(selected.requireReview)
    }
  }, [])

  useEffect(() => {
    if (!startOpen && run) return
    let cancelled = false
    const query = new URLSearchParams({ cwd: baseCwd }).toString()
    void jsonFetch<PlaybooksResponse>(`/api/agent-protocol/playbooks?${query}`).then((listing) => {
      if (!cancelled) handlePlaybooksChanged(listing.playbooks)
    }).catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : 'Failed to load playbooks')
    })
    return () => { cancelled = true }
  }, [baseCwd, handlePlaybooksChanged, run, startOpen])

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

  const reviewControlGate = useCallback(async (
    action: 'review-phase' | 'review-run',
    approved: boolean,
    phase?: string,
  ) => {
    if (!runId || busyAction) return
    const key = `${action}:${phase ?? 'run'}`
    setBusyAction(key)
    try {
      const next = await jsonFetch<ProtocolRunSnapshot>(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          approved,
          phase,
          summary: action === 'review-phase'
            ? `${phase} ${approved ? 'approved' : 'rejected'} by the operator`
            : `Judgment review ${approved ? 'approved' : 'rejected'} by the operator`,
        }),
      })
      setSnapshot(next)
      showNotice(action === 'review-phase'
        ? `${phase} ${approved ? 'approved' : 'rejected'}`
        : `Judgment review ${approved ? 'approved' : 'rejected'}`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to review workflow gate')
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, runId, showNotice])

  const resolveDecision = useCallback(async (taskId: string, decisionId: string, suggested?: string) => {
    if (!runId || busyAction) return
    const answer = window.prompt('Decision answer', suggested ?? '')?.trim()
    if (!answer) return
    const key = `decision:${taskId}:${decisionId}`
    setBusyAction(key)
    try {
      await jsonFetch(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-decision', taskId, decisionId, answer }),
      })
      await loadSnapshot(runId)
      showNotice(`Decision ${decisionId} resolved`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to resolve decision')
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, loadSnapshot, runId, showNotice])

  const promoteLearning = useCallback(async (candidateId: string, target: 'playbook' | 'role' | 'project_memory') => {
    if (!runId || busyAction) return
    const key = `learning:${candidateId}`
    setBusyAction(key)
    try {
      await jsonFetch(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote-learning', candidateId, target }),
      })
      await loadSnapshot(runId)
      showNotice('Learning candidate marked for promotion')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to promote learning')
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, loadSnapshot, runId, showNotice])

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
    if ((!prompt && !selectedPlaybook) || !playbookArgsReady || busyAction) return
    let parsedPlaybookArgs: unknown = undefined
    if (playbookArgs.trim()) {
      try { parsedPlaybookArgs = JSON.parse(playbookArgs) } catch { parsedPlaybookArgs = playbookArgs.trim() }
    }
    setBusyAction('start')
    try {
      const result = await jsonFetch<{ snapshot: ProtocolRunSnapshot; sessions: Array<{ sessionId: string; provider: Session['provider']; cwd: string; summary: string; isPending: boolean }> }>('/api/agent-protocol/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          baseCwd: baseCwd || undefined,
          playbookName: selectedPlaybook?.name,
          playbookArgs: parsedPlaybookArgs,
          provider: targetProvider,
          teammateProviders,
          maxAgents,
          title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
          gateCommand: gateCommand.trim() || undefined,
          requirePlanApproval,
          useWorktrees,
          autonomy,
          requireReview,
          acceptanceContract: {
            goal: prompt,
            nonGoals: nonEmptyLines(nonGoals),
            userVisibleAcceptance: nonEmptyLines(acceptanceCriteria),
            verificationCommands: gateCommand.trim() ? [gateCommand.trim()] : [],
            manualQa: nonEmptyLines(manualQa),
            escalationTriggers: nonEmptyLines(escalationTriggers),
          },
          budget: maxTokens.trim() || maxDurationMinutes.trim() ? {
            maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
            maxDurationMinutes: maxDurationMinutes.trim() ? Number(maxDurationMinutes) : undefined,
          } : undefined,
        }),
      })
      setSnapshot(result.snapshot)
      setRunId(result.snapshot.run.id)
      setRuns((prev) => [result.snapshot.run, ...prev.filter((entry) => entry.id !== result.snapshot.run.id)].slice(0, 10))
      setStartOpen(false)
      setPromptDraft('')
      setPlaybookName('')
      setPlaybookArgs('')
      setGateCommand('')
      setAcceptanceCriteria('')
      setNonGoals('')
      setManualQa('')
      setEscalationTriggers('')
      setMaxTokens('')
      setMaxDurationMinutes('')
      setRunProviderOverride(null)
      setTeammateProviderOverride(null)
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
      showNotice(selectedPlaybook
        ? `Playbook ${selectedPlaybook.name} started without a planning turn`
        : 'Coordinated run started')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to start run')
    } finally {
      setBusyAction(null)
    }
  }, [acceptanceCriteria, autonomy, baseCwd, busyAction, escalationTriggers, gateCommand, manualQa, maxAgents, maxDurationMinutes, maxTokens, nonGoals, onOpenSession, onSessionsChanged, playbookArgs, playbookArgsReady, promptDraft, requirePlanApproval, requireReview, selectedPlaybook, showNotice, targetProvider, teammateProviders, useWorktrees])

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
        showNotice(result.keptWorktrees.length > 0
          ? `Run deleted; kept ${result.keptWorktrees.length} worktree(s)`
          : snapshot?.run.useWorktrees === false
            ? 'Run deleted; shared checkout left unchanged'
            : 'Run deleted')
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
  }, [appendEvent, busyAction, pendingAction, refreshWorktrees, runId, runs, showNotice, snapshot?.run.baseCwd, snapshot?.run.useWorktrees])

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
    ? run?.useWorktrees === false
      ? 'Delete this run ledger? The shared checkout is left unchanged.'
      : 'Delete this run ledger? Clean worktrees are removed; unmerged ones are kept.'
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
              <button type="button" className={cn('av-coord-workspace', 'av-hover-control')} onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-expanded={workspaceMenuOpen} aria-haspopup="menu">
                {run?.baseCwd.split('/').at(-1) || 'agentViewer'} <ChevronDown size={12} aria-hidden="true" />
              </button>
              {workspaceMenuOpen ? (
                <div className="av-coord-workspace-menu" role="menu" aria-label="Workspaces">
                  {workspaceOptions.map((option) => (
                    <button key={option.cwd} type="button" role="menuitem" className="av-hover-control" onClick={() => {
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
                className={cn('av-coord-provider-chip', `av-provider-${name}`, providerFilter === name ? 'av-active' : '', 'av-hover-control')}
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
            <button type="button" className="av-hover-control" onClick={() => { setLoadError(null); setNotice(null) }} aria-label="Dismiss notice">
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
                className="av-hover-control"
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
                <button type="button" className={cn('av-coord-empty-run', 'av-hover-control')} onClick={() => setStartOpen(true)}>
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
                      className={cn('av-coord-run-row', entry.id === runId ? 'av-selected' : '', 'av-hover-control')}
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
              <button type="button" className="av-hover-control" onClick={() => { setRunQuery(''); setProviderFilter(null); setTaskFilter('all') }}>View all workflows <span aria-hidden="true">→</span></button>
            </div>
          </aside>

          <div className="av-coord-main">
            {startOpen || !run ? (
              <section className="av-coord-start">
                {playbookManagerOpen ? (
                  <PlaybookManager
                    cwd={baseCwd}
                    onClose={() => setPlaybookManagerOpen(false)}
                    onChanged={handlePlaybooksChanged}
                    onNotice={showNotice}
                  />
                ) : (
                <form
                  className="av-coord-start-form"
                  onSubmit={(event) => { event.preventDefault(); void startRun() }}
                  onKeyDown={(event) => {
                    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter' || !launchReady || busyAction === 'start') return
                    event.preventDefault()
                    void startRun()
                  }}
                >
                  <header className="av-coord-start-hero">
                    <div className="av-coord-start-mark"><Sparkles aria-hidden="true" /></div>
                    <div>
                      <span>Agent operations</span>
                      <h3>Launch a workflow</h3>
                      <p>Define the outcome, choose the runtime, and set the checks the team must satisfy.</p>
                    </div>
                    {run ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setStartOpen(false)} className="av-coord-start-back">
                        <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back to workflow
                      </Button>
                    ) : null}
                  </header>

                  <div className="av-coord-start-layout">
                    <div className="av-coord-start-primary">
                      <Card className="av-coord-start-card av-coord-start-brief">
                        <CardHeader>
                          <div className="av-coord-start-card-heading"><span>01</span><div><CardTitle>Workflow brief</CardTitle><CardDescription>{selectedPlaybook ? 'Add run-specific context, or rely on the selected playbook and its arguments.' : 'Give the lead enough context to build and assign a useful task board.'}</CardDescription></div></div>
                        </CardHeader>
                        <CardContent className="av-coord-contract-fields">
                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-prompt">Outcome and acceptance criteria</Label>
                            <Textarea
                              id="coord-run-prompt"
                              name="run-prompt"
                              autoComplete="off"
                              required={!selectedPlaybook}
                              aria-invalid={promptDraft.length > 0 && !promptDraft.trim()}
                              value={promptDraft}
                              onChange={(event) => setPromptDraft(event.target.value)}
                              placeholder="Example: Audit the session handoff flow. Fix correctness issues, add regression coverage, and finish only when web and TUI type-checks pass."
                              className="av-coord-textarea"
                              rows={8}
                            />
                          </div>
                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-acceptance">Acceptance checks <em>one per line</em></Label>
                            <Textarea id="coord-run-acceptance" className="av-coord-textarea av-coord-contract-textarea" value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} placeholder={'Web and OpenTUI type-checks pass\nThe new behavior is visible in both dashboards'} rows={4} />
                          </div>
                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-non-goals">Non-goals <em>one per line</em></Label>
                            <Textarea id="coord-run-non-goals" className="av-coord-textarea av-coord-contract-textarea" value={nonGoals} onChange={(event) => setNonGoals(event.target.value)} placeholder="Areas the team must leave unchanged" rows={3} />
                          </div>
                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-manual-qa">Manual QA <em>one per line</em></Label>
                            <Textarea id="coord-run-manual-qa" className="av-coord-textarea av-coord-contract-textarea" value={manualQa} onChange={(event) => setManualQa(event.target.value)} placeholder="Open Agent Operations and verify the completed state" rows={3} />
                          </div>
                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-escalation">Escalation triggers <em>one per line</em></Label>
                            <Textarea id="coord-run-escalation" className="av-coord-textarea av-coord-contract-textarea" value={escalationTriggers} onChange={(event) => setEscalationTriggers(event.target.value)} placeholder="Security, data loss, or public API compatibility risk" rows={3} />
                          </div>
                        </CardContent>
                        <CardFooter className="av-coord-start-card-meta">
                          <span>Include constraints, paths in scope, and a concrete definition of done.</span>
                          <b>{promptDraft.length} characters</b>
                        </CardFooter>
                      </Card>

                      <Card className="av-coord-start-card">
                        <CardHeader>
                          <div className="av-coord-start-card-heading"><span>02</span><div><CardTitle>Runtime and controls</CardTitle><CardDescription>Choose who runs the work and how completion is verified.</CardDescription></div></div>
                        </CardHeader>
                        <CardContent className="av-coord-runtime-grid">
                          <div className="av-coord-field av-coord-wide">
                            <Label htmlFor="coord-run-playbook">Playbook</Label>
                            <div className="av-coord-playbook-picker">
                              <NativeSelect
                                id="coord-run-playbook"
                                name="run-playbook"
                                value={playbookName}
                                onChange={(event) => selectPlaybook(event.target.value)}
                                className="av-coord-start-select"
                              >
                                <NativeSelectOption value="">No playbook — lead plans the board</NativeSelectOption>
                                {playbooks.map((entry) => <NativeSelectOption key={entry.name} value={entry.name}>{entry.name} · {entry.phaseCount} phases · {entry.taskCount} tasks</NativeSelectOption>)}
                              </NativeSelect>
                              <Button type="button" variant="outline" className="av-coord-playbook-manage" onClick={() => setPlaybookManagerOpen(true)}><BookOpen data-icon="inline-start" aria-hidden="true" /> Manage playbooks</Button>
                            </div>
                            <small>{selectedPlaybook?.description ?? 'Choose a reusable task graph or let the lead create one from the workflow brief.'}</small>
                          </div>

                          {selectedPlaybook ? (
                            <div className="av-coord-field av-coord-wide" data-invalid={selectedPlaybook.expectsArgs && !playbookArgs.trim() ? '' : undefined}>
                              <Label htmlFor="coord-run-playbook-args">Playbook arguments {selectedPlaybook.expectsArgs ? <em>required</em> : <em>optional</em>}</Label>
                              <Input
                                id="coord-run-playbook-args"
                                value={playbookArgs}
                                name="run-playbook-args"
                                autoComplete="off"
                                aria-invalid={selectedPlaybook.expectsArgs && !playbookArgs.trim()}
                                onChange={(event) => setPlaybookArgs(event.target.value)}
                                placeholder={playbookArgsPlaceholder}
                                className="av-coord-input"
                              />
                              <small>Arguments are added to every task. Plain text fills {'{{args}}'}; JSON objects also support named placeholders such as {'{{args.path}}'}.</small>
                            </div>
                          ) : null}

                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-provider">Lead provider</Label>
                            <NativeSelect
                              id="coord-run-provider"
                              name="run-provider"
                              value={targetProvider}
                              onChange={(event) => setRunProviderOverride(event.target.value as AgentProvider)}
                              className="av-coord-start-select"
                            >
                              {PROVIDER_ORDER.map((providerName) => <NativeSelectOption key={providerName} value={providerName}>{providerName.toUpperCase()}</NativeSelectOption>)}
                            </NativeSelect>
                            <small>The lead session coordinates every task and teammate.</small>
                          </div>

                          <div className="av-coord-field">
                            <Label htmlFor="coord-run-agents">Agent limit</Label>
                            <div className="av-coord-agent-stepper" role="group" aria-label="Maximum agents including the lead">
                              <Button type="button" variant="outline" size="icon" onClick={() => setMaxAgents((current) => Math.max(2, current - 1))} disabled={maxAgents <= 2} aria-label="Remove one agent"><Minus aria-hidden="true" /></Button>
                              <Input
                                id="coord-run-agents"
                                type="number"
                                name="run-agents"
                                autoComplete="off"
                                min={2}
                                max={6}
                                value={maxAgents}
                                onChange={(event) => setMaxAgents(Math.max(2, Math.min(6, Number(event.target.value) || 2)))}
                                className="av-coord-input"
                              />
                              <Button type="button" variant="outline" size="icon" onClick={() => setMaxAgents((current) => Math.min(6, current + 1))} disabled={maxAgents >= 6} aria-label="Add one agent"><Plus aria-hidden="true" /></Button>
                            </div>
                            <small>Includes the lead; increase for independent parallel lanes.</small>
                          </div>

                          <div className="av-coord-policy-grid av-coord-wide">
                            <div className="av-coord-field">
                              <Label htmlFor="coord-run-autonomy">Autonomy</Label>
                              <NativeSelect id="coord-run-autonomy" value={autonomy} onChange={(event) => setAutonomy(event.target.value as ProtocolAutonomy)} className="av-coord-start-select">
                                <NativeSelectOption value="low">Low · approve every phase</NativeSelectOption>
                                <NativeSelectOption value="medium">Medium · gated phases</NativeSelectOption>
                                <NativeSelectOption value="high">High · escalation only</NativeSelectOption>
                              </NativeSelect>
                              <small>Model drift and budget exhaustion always surface.</small>
                            </div>

                            <div className="av-coord-field">
                              <Label htmlFor="coord-run-token-budget">Token budget <em>optional</em></Label>
                              <Input id="coord-run-token-budget" className="av-coord-input" type="number" min={1} value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} placeholder="250000" />
                            </div>

                            <div className="av-coord-field">
                              <Label htmlFor="coord-run-time-budget">Duration budget <em>minutes</em></Label>
                              <Input id="coord-run-time-budget" className="av-coord-input" type="number" min={1} value={maxDurationMinutes} onChange={(event) => setMaxDurationMinutes(event.target.value)} placeholder="240" />
                            </div>
                          </div>

                          <div className="av-coord-field av-coord-wide">
                            <Label>Teammate provider pool</Label>
                            <ToggleGroupPrimitive.Root
                              type="multiple"
                              value={teammateProviders}
                              onValueChange={(next) => setTeammateProviderOverride(next.length > 0 ? next as AgentProvider[] : [targetProvider])}
                              className="av-coord-provider-pool"
                              aria-label="Providers available for teammate agents"
                            >
                              {PROVIDER_ORDER.map((providerName) => {
                                const selected = teammateProviders.includes(providerName)
                                return (
                                  <ToggleGroupPrimitive.Item
                                    key={providerName}
                                    value={providerName}
                                    className={cn(`av-provider-${providerName}`, selected && 'av-selected')}
                                    aria-label={`${selected ? 'Remove' : 'Add'} ${providerName} from teammate provider pool`}
                                  >
                                    <span aria-hidden="true">{selected ? '✓' : '+'}</span>{providerName.toUpperCase()}
                                  </ToggleGroupPrimitive.Item>
                                )
                              })}
                            </ToggleGroupPrimitive.Root>
                            <small>Selected providers are assigned round-robin to teammate sessions. The lead provider can differ from the worker pool.</small>
                          </div>

                          <div className="av-coord-role-guide av-coord-wide">
                            <div><b>Lead</b><span>Plans the board, delegates work, resolves blockers, and synthesizes the final result.</span></div>
                            <div><b>Teammates</b><span>Claim independent worker or verification lanes, publish findings, and message the lead or peers.</span></div>
                          </div>

                          <div className="av-coord-field av-coord-wide">
                            <Label htmlFor="coord-run-gate">Completion gate <em>optional</em></Label>
                            <div className="av-coord-command-input">
                              <Terminal aria-hidden="true" />
                              <Input
                                id="coord-run-gate"
                                value={gateCommand}
                                name="run-gate-command"
                                autoComplete="off"
                                onChange={(event) => setGateCommand(event.target.value)}
                                placeholder="Example: npx tsc --noEmit"
                                className="av-coord-input"
                              />
                            </div>
                            <div className="av-coord-gate-presets" aria-label="Suggested completion gates">
                              {['npx tsc --noEmit', 'npm run tui:check', 'npm run build'].map((command) => <button key={command} type="button" className="av-hover-control" onClick={() => setGateCommand(command)}>{command}</button>)}
                            </div>
                          </div>

                          <div className="av-coord-plan-control av-coord-wide">
                            <Checkbox id="coord-plan-approval" className="av-coord-checkbox" checked={requirePlanApproval} onCheckedChange={(checked) => setRequirePlanApproval(checked === true)} />
                            <div><Label htmlFor="coord-plan-approval">Review the lead plan before implementation</Label><small>The team pauses after planning until you approve or reject the proposed task board.</small></div>
                          </div>

                          <div className="av-coord-plan-control av-coord-wide">
                            <Checkbox id="coord-judgment-review" className="av-coord-checkbox" checked={requireReview} onCheckedChange={(checked) => setRequireReview(checked === true)} />
                            <div><Label htmlFor="coord-judgment-review">Require judgment review after validation</Label><small>The run cannot synthesize until receipts pass and the reviewer approves intent, scope, and risk.</small></div>
                          </div>

                          <div className="av-coord-plan-control av-coord-wide">
                            <Checkbox id="coord-use-worktrees" className="av-coord-checkbox" checked={useWorktrees} onCheckedChange={(checked) => setUseWorktrees(checked === true)} />
                            <div><Label htmlFor="coord-use-worktrees">Use separate teammate checkouts</Label><small>Recommended for parallel edits. Turn this off when every agent should deliberately share the current checkout.</small></div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="av-coord-start-card av-coord-launch-card">
                      <CardHeader>
                        <div className="av-coord-start-card-heading"><span>03</span><div><CardTitle>Launch summary</CardTitle><CardDescription>These settings are applied to the new coordinated run.</CardDescription></div></div>
                      </CardHeader>
                      <CardContent className="av-coord-launch-summary">
                        <div><span>Workspace</span><strong title={baseCwd}>{baseCwd.split('/').at(-1) || 'agentViewer'}</strong></div>
                        <div><span>Playbook</span><strong>{selectedPlaybook?.name ?? 'Lead-planned board'}</strong></div>
                        <div><span>Lead provider</span><strong className={`av-provider-${targetProvider}`}>{String(targetProvider).toUpperCase()}</strong></div>
                        <div><span>Teammate providers</span><strong>{teammateProviders.map((entry) => entry.toUpperCase()).join(' · ')}</strong></div>
                        <div><span>Agent limit</span><strong>{maxAgents} total</strong></div>
                        <div><span>Autonomy</span><strong>{autonomy}</strong></div>
                        <div><span>Checkout mode</span><strong>{useWorktrees ? 'Isolated checkouts' : 'Shared checkout'}</strong></div>
                        <div><span>Plan review</span><strong>{requirePlanApproval ? 'Required' : 'Automatic'}</strong></div>
                        <div><span>Judgment review</span><strong>{requireReview ? 'Required' : 'Optional'}</strong></div>
                        <div><span>Budget</span><strong>{maxTokens || maxDurationMinutes ? `${maxTokens || '∞'} tokens · ${maxDurationMinutes || '∞'} min` : 'Unbounded'}</strong></div>
                        <div><span>Completion gate</span><strong title={gateCommand}>{gateCommand.trim() || 'Not configured'}</strong></div>
                        <div className="av-coord-launch-preview">
                          <span>Brief preview</span>
                          <p>{promptDraft.trim() ? firstLine(promptDraft) : selectedPlaybook ? `Run ${selectedPlaybook.name}` : 'Your workflow outcome will appear here.'}</p>
                        </div>
                        <div className="av-coord-launch-checks">
                          <span><CheckCircle2 aria-hidden="true" /> Lead session created</span>
                          <span><CheckCircle2 aria-hidden="true" /> Teammates assigned by provider pool</span>
                          <span><CheckCircle2 aria-hidden="true" /> {useWorktrees ? 'Separate teammate checkouts' : 'Shared checkout selected'}</span>
                          <span><CheckCircle2 aria-hidden="true" /> {selectedPlaybook ? 'Playbook board seeded without a planning turn' : 'Lead planning and live activity enabled'}</span>
                        </div>
                      </CardContent>
                      <CardFooter className="av-coord-launch-actions">
                        <Button type="submit" size="lg" disabled={!launchReady || busyAction === 'start'} className="av-coord-btn av-coord-primary">
                          {busyAction === 'start' ? <RefreshCw data-icon="inline-start" aria-hidden="true" /> : <Play data-icon="inline-start" aria-hidden="true" />} {busyAction === 'start' ? 'Launching workflow…' : 'Launch workflow'}
                        </Button>
                        <small>{launchReady ? <><kbd>⌘</kbd><kbd>Enter</kbd> to launch</> : selectedPlaybook?.expectsArgs && !playbookArgsReady ? 'Add playbook arguments to continue' : 'Add a workflow brief or select a playbook'}</small>
                      </CardFooter>
                    </Card>
                  </div>
                </form>
                )}
              </section>
            ) : (
              <>
                <section className="av-coord-toolbar">
                  <div className="av-coord-run-heading">
                    <div>
                      <strong>{firstLine(run.prompt)}</strong>
                      <span><b>{run.status}</b> · {run.useWorktrees === false ? 'shared checkout' : 'isolated checkouts'} · {run.baseCwd.split('/').at(-1) || run.id} · {formatAge(run.createdAt)}</span>
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
                          <button type="button" className="av-hover-control" onClick={() => {
                            setRunMenuOpen(false)
                            setMessageTarget(agentsById.get(displayedTask.ownerAgentId!)?.name ?? displayedTask.ownerAgentId!)
                            setMessageDraft('')
                          }}><MessageSquare aria-hidden="true" /> Message task owner</button>
                        ) : null}
                        {displayedTask && !TERMINAL_TASK_STATUSES.has(displayedTask.status) ? (
                          <button type="button" className={cn('av-danger', 'av-hover-control')} onClick={() => { setRunMenuOpen(false); setPendingAction({ kind: 'fail-task', task: displayedTask }) }}><AlertTriangle aria-hidden="true" /> Mark task failed</button>
                        ) : null}
                        {run.useWorktrees !== false ? (
                          <button type="button" className="av-hover-control" onClick={() => { setRunMenuOpen(false); void cleanupRun() }} disabled={busyAction === 'cleanup'}><ShieldCheck aria-hidden="true" /> Clean worktrees</button>
                        ) : null}
                        <button type="button" className={cn('av-danger', 'av-hover-control')} onClick={() => { setRunMenuOpen(false); setPendingAction({ kind: 'delete-run' }) }}><Trash2 aria-hidden="true" /> Delete workflow</button>
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
                      <button type="button" className="av-hover-control" onClick={() => setInspectorCollapsed((collapsed) => !collapsed)} aria-label={inspectorCollapsed ? 'Expand agent inspector' : 'Collapse agent inspector'} aria-expanded={!inspectorCollapsed}>
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
                        {run.useWorktrees !== false ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="av-coord-btn"
                            onClick={() => {
                              const worktree = selectedAgent.worktreeBranch && selectedAgent.worktreePath !== run.baseCwd
                                ? worktreeStats.get(selectedAgent.worktreePath)
                                : undefined
                              if (worktree) setPendingAction({ kind: 'merge', agent: selectedAgent, worktree })
                              else showNotice(`${selectedAgent.name} has no merge-ready worktree`)
                            }}
                          >
                            <GitMerge data-icon="inline-start" aria-hidden="true" /> Merge Work
                          </Button>
                        ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="av-coord-panel av-coord-right-attention" aria-label="Needs attention">
                    <div className="av-coord-panel-head">
                      <span><AlertTriangle aria-hidden="true" /> Attention <b>{attentionCount}</b></span>
                    </div>
                    <div className="av-coord-right-attention-list">
                      {phaseGate ? (
                        <div className="av-coord-attention-gate">
                          <AlertTriangle aria-hidden="true" />
                          <span><strong>{phaseGate.phase} phase gate</strong><small>Review receipts before the next phase starts</small></span>
                          <Button type="button" size="sm" onClick={() => void reviewControlGate('review-phase', true, phaseGate.phase)} disabled={busyAction === `review-phase:${phaseGate.phase}`}>Approve</Button>
                          <Button type="button" size="sm" variant="outline" className="av-danger" onClick={() => void reviewControlGate('review-phase', false, phaseGate.phase)} disabled={busyAction === `review-phase:${phaseGate.phase}`}>Reject</Button>
                        </div>
                      ) : null}
                      {reviewPending ? (
                        <div className="av-coord-attention-gate">
                          <ShieldCheck aria-hidden="true" />
                          <span><strong>Judgment review</strong><small>Mechanical checks passed; review intent, scope, and risk</small></span>
                          <Button type="button" size="sm" onClick={() => void reviewControlGate('review-run', true)} disabled={busyAction === 'review-run:run'}>Approve</Button>
                          <Button type="button" size="sm" variant="outline" className="av-danger" onClick={() => void reviewControlGate('review-run', false)} disabled={busyAction === 'review-run:run'}>Reject</Button>
                        </div>
                      ) : null}
                      {openDecisions.map(({ task, decision }) => (
                        <div className="av-coord-attention-gate" key={`decision:${task.id}:${decision.id}`}>
                          <AlertTriangle aria-hidden="true" /><span><strong>{decision.question}</strong><small>{task.id} · assumed {decision.assumed ?? 'none'}</small></span>
                          <Button type="button" size="sm" onClick={() => void resolveDecision(task.id, decision.id, decision.assumed ?? decision.options[0])} disabled={busyAction === `decision:${task.id}:${decision.id}`}>Resolve</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => selectTask(task)}>Inspect</Button>
                        </div>
                      ))}
                      {recurringLearnings.map((candidate) => (
                        <div className="av-coord-attention-gate" key={`learning:${candidate.id}`}>
                          <Sparkles aria-hidden="true" /><span><strong>{candidate.summary}</strong><small>{candidate.occurrences} occurrences · proposed {candidate.suggestedTarget.replace('_', ' ')}</small></span>
                          <Button type="button" size="sm" onClick={() => void promoteLearning(candidate.id, candidate.suggestedTarget)} disabled={busyAction === `learning:${candidate.id}`}>Promote</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEventFilter('attention')}>Inspect</Button>
                        </div>
                      ))}
                      {pendingPlanTasks.map((task) => (
                        <button key={`plan:${task.id}`} type="button" className="av-hover-control" onClick={() => { selectTask(task); setTaskFilter('attention') }}>
                          <AlertTriangle aria-hidden="true" /><span><strong>{task.title}</strong><small>Plan is waiting for approval</small></span><b>Open</b>
                        </button>
                      ))}
                      {tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').map((task) => (
                        <button key={`task:${task.id}`} type="button" className="av-hover-control" onClick={() => { selectTask(task); setTaskFilter('attention') }}>
                          <AlertTriangle aria-hidden="true" /><span><strong>{task.title}</strong><small>{task.blockedBy.length > 0 ? `Waiting on ${task.blockedBy.join(', ')}` : task.status}</small></span><b>Open</b>
                        </button>
                      ))}
                      {actionableMail > 0 ? (
<button type="button" className="av-hover-control" onClick={() => {
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
                        {taskFilter !== 'all' ? <button type="button" className="av-hover-control" onClick={() => setTaskFilter('all')}>{taskFilter} ×</button> : null}
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
                              <button key={task.id} type="button" className={cn('av-coord-task-row', taskIndex === groupedTasks[group].length - 1 ? 'av-last' : '', displayedTask?.id === task.id ? 'av-selected' : '', 'av-hover-control')} onClick={() => selectTask(task)}>
                                <span className="av-coord-task-branch" aria-hidden="true" />
                                <span className={cn('av-coord-status', `av-tone-${statusTone(task.status)}`)}>{task.status}</span>
                                <span className="av-coord-task-title" title={task.roleDescription}>
                                  <strong>{task.title}</strong>
                                  <small>{task.roleName ? `${task.roleName} · ${task.paths[0] ?? task.id}` : (task.paths[0] ?? task.id)}</small>
                                </span>
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
                    {displayedTask?.receipt ? (
                      <div className="av-coord-receipt" aria-label={`Completion receipt for ${displayedTask.title}`}>
                        <span><b>{displayedTask.seat}</b> · {displayedTask.receipt.provenance}</span>
                        <span>Model <b>{displayedTask.receipt.actualProvider}/{displayedTask.receipt.actualModel ?? 'default'}</b></span>
                        <span>Verify <b>{displayedTask.receipt.verification.filter((entry) => entry.passed).length}/{displayedTask.receipt.verification.length}</b></span>
                        <span>Tokens <b>{displayedTask.receipt.usage?.totalTokens?.toLocaleString() ?? '—'}</b></span>
                        <span>Files <b>{displayedTask.receipt.filesChanged.length}</b></span>
                        <span>Decisions <b>{displayedTask.receipt.needsDecision.filter((entry) => entry.status === 'open').length} open</b></span>
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
                      <button type="button" className="av-hover-control" onClick={() => setSelectedEventIndex(-1)} aria-label="Follow latest event" title={followingEvents ? 'Following latest event' : 'Resume following latest event'}>
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
                              className={cn('av-coord-event-row', selected ? 'av-selected' : '', 'av-hover-control')}
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
                        {!selectedEvent ? (
                          <div className="av-coord-control-summary">
                            <span>Control plane</span>
                            <p><b>{run.autonomy}</b> autonomy · review {run.review.status} · {run.acceptanceContract.userVisibleAcceptance.length} acceptance checks</p>
                            {run.phaseReports.map((report) => <small key={report.phase}>{report.phase}: {report.status} · {report.completedTaskIds.length} done · {report.usage.totalTokens?.toLocaleString() ?? 0} tok</small>)}
                            {run.resumeCapsule ? <small>Next: {run.resumeCapsule.nextAction}</small> : null}
                          </div>
                        ) : null}
                        {!selectedEvent && !run.summary && run.phaseReports.length === 0 ? <div className="av-coord-empty-state">Select an event to inspect it.</div> : null}
                      </aside>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
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
              <button type="button" className="av-hover-control" onClick={() => { setMessageTarget(null); setMessageDraft('') }} aria-label="Cancel message">
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

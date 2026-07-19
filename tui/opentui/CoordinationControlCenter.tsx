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
}

const PROVIDERS = ['codex', 'claude', 'copilot', 'opencode', 'pi'] as const
const ACTIVE_TASKS = new Set(['claimed', 'planning', 'planned', 'in_progress'])
const TERMINAL_TASKS = new Set(['completed', 'failed', 'cancelled'])
const ATTENTION_EVENTS = new Set(['agent.blocked', 'task.failed', 'lock.denied', 'plan.rejected', 'review.requested'])

function paneNumber(section: ControlCenterSection): number {
  return section === 'overview' ? 1 : section === 'tasks' ? 2 : section === 'team' ? 3 : 4
}

function fit(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
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

function eventTone(event: AgentProtocolEvent, theme: TuiThemePalette): string {
  if (ATTENTION_EVENTS.has(event.type)) return theme.amber
  if (event.type === 'task.completed' || event.type === 'plan.approved' || event.type === 'finding') return theme.green
  if (event.type === 'message' || event.type === 'handoff') return theme.violet
  return theme.cyan
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
}: Props) {
  const popW = Math.max(width - 2, 1)
  const popH = Math.max(height - 2, 1)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = Math.max(popW - 2, 1)
  const headerH = 3
  const promptH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - promptH - footerH - 2, 8)
  const leftW = Math.max(24, Math.floor(innerW * 0.27))
  const rightW = Math.max(31, Math.floor(innerW * 0.29))
  const centerW = Math.max(innerW - leftW - rightW - 2, 20)
  const inspectorH = Math.min(24, Math.max(18, Math.floor(bodyH * 0.48)))
  const showProviderHealth = innerW >= 165
  const showTaskColumns = centerW >= 58
  const showInspectorDetails = rightW >= 40 && inspectorH >= 20
  const showActivityColumns = rightW >= 40
  const run = snapshot?.run ?? null
  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
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
  const activityFooterH = 2
  const eventRows = Math.max(bodyH - inspectorH - 7, 4)
  const selectedEventIndex = selectedEvent ? filteredEvents.indexOf(selectedEvent) : filteredEvents.length - 1
  const visibleEvents = visibleWindow(filteredEvents, selectedEventIndex, eventRows)
  const latestAgentEvent = inspectedAgent ? [...events].reverse().find((event) => event.agentId === inspectedAgent.id) : undefined
  const inspectedTask = inspectedAgent
    ? (inspectedAgent.taskId ? taskById.get(inspectedAgent.taskId) : undefined)
      ?? tasks.find((task) => task.ownerAgentId === inspectedAgent.id && ACTIVE_TASKS.has(task.status))
      ?? tasks.find((task) => task.ownerAgentId === inspectedAgent.id)
    : undefined
  const topologyAgents = useMemo(() => [
    ...agents.filter((agent) => agent.role === 'lead'),
    ...agents.filter((agent) => agent.role !== 'lead'),
  ], [agents])
  const messageByEventKey = useMemo(() => {
    const byKey = new Map<string, ProtocolRunSnapshot['messages'][number]>()
    for (const message of snapshot?.messages ?? []) {
      byKey.set(`${message.fromAgentId}\u0000${message.body}`, message)
    }
    return byKey
  }, [snapshot?.messages])
  const worktree = inspectedAgent ? worktreeStats.get(inspectedAgent.worktreePath) : undefined
  const completed = tasks.filter((task) => task.status === 'completed').length
  const undelivered = snapshot?.messages.filter((message) => !message.deliveredAt).length ?? 0
  const providerSummary = PROVIDERS.map((provider) => ({ provider, count: fleet.providers.get(provider) ?? 0 }))
  const inspectedAgentIndex = inspectedAgent ? agents.findIndex((agent) => agent.id === inspectedAgent.id) : -1
  const workspace = run?.baseCwd.split('/').filter(Boolean).at(-1) ?? '—'
  const branch = agents.find((agent) => agent.role === 'lead')?.worktreeBranch || 'main'
  const runElapsed = run ? elapsed(run.createdAt, ['completed', 'failed', 'stopped'].includes(run.status) ? run.updatedAt : now) : '—'
  const runSeconds = run ? Math.max(1, Math.floor((new Date(['completed', 'failed', 'stopped'].includes(run.status) ? run.updatedAt : now).getTime() - new Date(run.createdAt).getTime()) / 1000)) : 1
  const eventsPerMinute = events.length > 0 ? (events.length / runSeconds) * 60 : 0
  const activeTasks = tasks.filter((task) => ACTIVE_TASKS.has(task.status)).length
  const blockedTasks = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed').length
  const assignedTasks = tasks.filter((task) => task.ownerAgentId).length
  const activeLocks = snapshot?.locks.filter((lock) => lock.status === 'active').length ?? 0
  const lastActivityAge = events.length > 0 ? age(events.at(-1)?.timestamp, now) : '—'
  const topologyLabel = ` TOPOLOGY · ${agents.length} agents · ${snapshot?.messages.length ?? 0} messages `
  const selectedEventAgent = selectedEvent ? agentsById.get(selectedEvent.agentId) : undefined
  const contextualKeys = section === 'overview'
    ? run ? 'j/k workflow · enter board · [/] switch run' : 'n create first workflow'
    : section === 'tasks'
      ? `j/k task${selectedTask?.ownerAgentId ? ' · enter owner' : ''} · / filter${selectedTaskPlanState === 'awaiting' ? ' · a approve · R reject' : ''} · f fail · m ${selectedTask?.ownerAgentId ? 'owner' : 'lead'}`
      : section === 'team'
        ? `j/k agent${inspectedAgent ? ' · enter session · x interrupt · w merge · m message' : ''}`
        : `j/k event${selectedEventAgent ? ' · enter session' : ''} · g tail · / filter · m ${selectedEventAgent ? 'event agent' : 'lead'}`
  const globalKeys = innerW >= 154
    ? `1-4 focus · tab next · n new · M broadcast · s stop · D delete · c cleanup${canCopyJoinCommand ? ' · i join cmd' : ''} · r refresh · q close`
    : '1-4 focus · tab next · n new · M all · s stop · r refresh · q close'
  const footerText = `${contextualKeys}  │  ${globalKeys}`
  const activityFooterText = rightW >= 40 ? '4 focus  ·  g tail  ·  / filter  ·  m message' : '4 focus  ·  g tail'

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
          <text fg={fleet.attention > 0 ? theme.amber : theme.green} wrapMode="none">{fleet.attention > 0 ? 'ATTENTION' : 'HEALTHY'}</text>
          <box flexGrow={1} />
          {showProviderHealth ? providerSummary.map(({ provider, count }) => (
            <box key={provider} marginLeft={1} height={1} flexDirection="row">
              <text fg={getProviderAccent(provider)} wrapMode="none">{`[${provider.toUpperCase()} `}</text>
              <text fg={count > 0 ? theme.green : theme.dim} wrapMode="none">{count > 0 ? '● OK' : '● —'}</text>
              <text fg={getProviderAccent(provider)} wrapMode="none">{']'}</text>
            </box>
          )) : null}
        </box>
        <box height={1} flexDirection="row" alignItems="center" justifyContent="center" overflow="hidden">
          <text fg={theme.text} wrapMode="none">{`${runs.length} workflows  ·  ${fleet.agents} agents  ·  `}</text>
          <text fg={theme.green} wrapMode="none">{`${fleet.working} working`}</text>
          <text fg={theme.text} wrapMode="none">{`  ·  ${fleet.queued} queued  ·  `}</text>
          <text fg={fleet.attention > 0 ? theme.amber : theme.green} wrapMode="none">{`${fleet.attention} attention`}</text>
          {busy ? <text fg={theme.amber} wrapMode="none">{'  ·  refreshing'}</text> : null}
        </box>
      </box>

      <box height={bodyH} minHeight={0} flexDirection="row" overflow="hidden">
        <box width={leftW} height={bodyH} marginRight={1} paddingX={1} border borderStyle="single" borderColor={section === 'overview' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden">
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
                  <box key={entry.id} height={2} paddingX={1} backgroundColor={selected && section === 'overview' ? theme.cyan : selected ? theme.surface3 : theme.surface} flexDirection="column">
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

        <box width={centerW} height={bodyH} marginRight={1} paddingX={1} border borderStyle="single" borderColor={section === 'tasks' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden">
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
                return (
                  <box key={task.id} height={2} paddingX={1} backgroundColor={selected && section === 'tasks' ? theme.cyan : selected ? theme.surface3 : theme.surface} flexDirection="column">
                    <box height={1} flexDirection="row" overflow="hidden">
                      <text fg={selected && section === 'tasks' ? theme.surface : theme.dim} wrapMode="none">{`${branch} `}</text>
                      <text fg={selected && section === 'tasks' ? theme.surface : taskTone(task, theme)} wrapMode="none">{`${taskMarker(task)} `}</text>
                      <text fg={selected && section === 'tasks' ? theme.surface : theme.muted} wrapMode="none">{fit(task.title, Math.max(centerW - (showTaskColumns ? 46 : 32), 8))}</text>
                      <box flexGrow={1} />
                      <text fg={selected && section === 'tasks' ? theme.surface : owner ? getProviderAccent(owner.provider) : theme.dim} wrapMode="none">{fit(owner?.name ?? 'unassigned', showTaskColumns ? 12 : 8).padEnd(showTaskColumns ? 12 : 8)}</text>
                      <text fg={selected && section === 'tasks' ? theme.surface : theme.dim} wrapMode="none">{` ${elapsed(task.createdAt, TERMINAL_TASKS.has(task.status) ? task.updatedAt : now).padStart(showTaskColumns ? 7 : 4)}${showTaskColumns ? '  ' : ''}`}</text>
                      {showTaskColumns ? <text fg={selected && section === 'tasks' ? theme.surface : taskTone(task, theme)} wrapMode="none">{fit(task.status === 'in_progress' ? 'working' : task.status, 9).padEnd(9)}</text> : null}
                    </box>
                    <text fg={selected && section === 'tasks' ? theme.surface : theme.dim} wrapMode="none">{fit(`${continuation}    ${task.id} · ${task.paths[0] ?? task.status}${task.blockedBy.length > 0 ? `  ← waits for ${task.blockedBy.join(', ')}` : ''}${tasks.some((candidate) => candidate.blockedBy.includes(task.id)) ? `  → unlocks ${tasks.filter((candidate) => candidate.blockedBy.includes(task.id)).map((candidate) => candidate.id).join(', ')}` : ''}`, centerW - 4)}</text>
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
          <box height={inspectorH} paddingX={1} border borderStyle="single" borderColor={section === 'team' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden">
            <box height={2} border={['bottom']} borderStyle="single" borderColor={section === 'team' ? theme.cyan : theme.border} backgroundColor={section === 'team' ? theme.surface3 : theme.surface} flexDirection="row" alignItems="center">
              <text fg={section === 'team' ? theme.cyan : theme.text} wrapMode="none">[3] AGENT INSPECTOR</text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">{`[${Math.max(inspectedAgentIndex + 1, 0)}/${agents.length}]`}</text>
            </box>
            {inspectedAgent ? (
              <>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Agent:    </text><text fg={getProviderAccent(inspectedAgent.provider)} wrapMode="none">{inspectedAgent.name}</text></box>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Provider: </text><text fg={getProviderAccent(inspectedAgent.provider)} wrapMode="none">{String(inspectedAgent.provider).toUpperCase()}</text></box>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Status:   </text><text fg={inspectedAgent.status === 'blocked' || inspectedAgent.status === 'failed' ? theme.amber : inspectedAgent.turnActive ? theme.green : theme.cyan} wrapMode="none">{`${inspectedAgent.status}${inspectedAgent.turnActive ? ' · streaming' : ''}`}</text></box>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Role:     </text><text fg={theme.muted} wrapMode="none">{inspectedAgent.role}</text></box>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Task:     </text><text fg={theme.text} wrapMode="none">{fit(inspectedTask?.title ?? inspectedAgent.taskId ?? 'unassigned', rightW - 12)}</text></box>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">CWD:      </text><text fg={theme.muted} wrapMode="none">{fit(inspectedAgent.worktreePath, rightW - 12)}</text></box>
                <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Current:  </text><text fg={latestAgentEvent ? eventTone(latestAgentEvent, theme) : theme.dim} wrapMode="none">{fit(latestAgentEvent?.summary ?? latestAgentEvent?.type ?? 'waiting for activity', rightW - 12)}</text></box>
                {showInspectorDetails ? (
                  <>
                    <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Branch:   </text><text fg={theme.muted} wrapMode="none">{fit(`${inspectedAgent.worktreeBranch || 'main'} · ${worktree ? `${worktree.dirtyFiles} dirty, ${worktree.aheadCommits} ahead` : 'shared checkout'}`, rightW - 12)}</text></box>
                    <box flexDirection="row"><text fg={theme.dim} wrapMode="none">Control:  </text><text fg={selectedLocks.length > 0 ? theme.amber : theme.muted} wrapMode="none">{fit(`${selectedLocks.length} locks · seen ${age(inspectedAgent.lastSeenAt ?? inspectedAgent.updatedAt, now)} ago`, rightW - 12)}</text></box>
                  </>
                ) : null}
                <box height={1} flexDirection="row">
                  <text fg={theme.border} wrapMode="none">{'─'}</text>
                  <text fg={theme.cyan} wrapMode="none">{topologyLabel}</text>
                  <text fg={theme.border} wrapMode="none">{'─'.repeat(Math.max(rightW - topologyLabel.length - 3, 1))}</text>
                </box>
                {visibleWindow(topologyAgents, Math.max(inspectedAgentIndex, 0), Math.max(inspectorH - (showInspectorDetails ? 14 : 12), 2)).map((agent, index, visible) => {
                  const agentTask = (agent.taskId ? taskById.get(agent.taskId) : undefined)
                    ?? tasks.find((task) => task.ownerAgentId === agent.id && ACTIVE_TASKS.has(task.status))
                    ?? tasks.find((task) => task.ownerAgentId === agent.id)
                  const branchGlyph = agent.role === 'lead' ? '◆' : index === visible.length - 1 ? '└─' : '├─'
                  return (
                    <box key={agent.id} height={1} flexDirection="row" overflow="hidden">
                      <text fg={agent.id === inspectedAgent.id ? theme.cyan : theme.dim} wrapMode="none">{`${agent.id === inspectedAgent.id ? '▶' : ' '} ${branchGlyph} `}</text>
                      <text fg={getProviderAccent(agent.provider)} wrapMode="none">{fit(agent.name, 11)}</text>
                      <text fg={agent.status === 'blocked' || agent.status === 'failed' ? theme.amber : agent.turnActive || agent.status === 'working' ? theme.green : theme.dim} wrapMode="none">{` ${agent.turnActive || agent.status === 'working' ? '●' : '○'} `}</text>
                      <text fg={theme.muted} wrapMode="none">{fit(agentTask ? `→ ${agentTask.id} ${agentTask.title}` : agent.role === 'lead' ? `→ ${run ? runTitle(run) : 'workflow'}` : '→ unassigned', Math.max(rightW - 24, 8))}</text>
                    </box>
                  )
                })}
              </>
            ) : <text fg={theme.dim} wrapMode="none">No agent selected</text>}
          </box>

          <box flexGrow={1} minHeight={0} marginTop={1} paddingX={1} border borderStyle="single" borderColor={section === 'events' ? theme.cyan : theme.muted} flexDirection="column" overflow="hidden">
            <box height={2} border={['bottom']} borderStyle="single" borderColor={section === 'events' ? theme.cyan : theme.border} backgroundColor={section === 'events' ? theme.surface3 : theme.surface} flexDirection="row" alignItems="center">
              <text fg={section === 'events' ? theme.cyan : theme.text} wrapMode="none">[4] LIVE ACTIVITY</text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">{`[${eventFilter}${section === 'events' ? '' : ' · tail'}]`}</text>
            </box>
            <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">
              {visibleEvents.length === 0 ? <text fg={theme.dim} wrapMode="none">No activity yet</text> : visibleEvents.map((event, index) => {
                const message = messageByEventKey.get(`${event.agentId}\u0000${event.summary ?? ''}`)
                const sender = agentsById.get(event.agentId)?.name ?? event.agentId
                const recipient = message ? (agentsById.get(message.toAgentId)?.name ?? message.toAgentId) : event.to
                const who = recipient ? `${sender}→${recipient}` : sender
                const activityType = message ? `${message.kind}${message.replyRequired ? '!' : ''}` : event.type
                const selected = selectedEvent === event
                const focused = selected && section === 'events'
                return (
                  <box key={`${event.timestamp ?? index}:${index}`} height={1} backgroundColor={focused ? theme.surface3 : theme.surface} flexDirection="row" overflow="hidden">
                    <box width={showActivityColumns ? 9 : 6} overflow="hidden"><text fg={theme.dim} wrapMode="none">{`${showActivityColumns ? clock(event.timestamp) : clock(event.timestamp).slice(3)} `}</text></box>
                    <box width={showActivityColumns ? 18 : 10} paddingLeft={1} overflow="hidden"><text fg={message ? theme.violet : eventTone(event, theme)} wrapMode="none">{fit(who, showActivityColumns ? 16 : 9)}</text></box>
                    <box width={showActivityColumns ? 11 : 9} paddingLeft={1} overflow="hidden"><text fg={focused ? theme.text : eventTone(event, theme)} wrapMode="none">{fit(activityType, showActivityColumns ? 9 : 8)}</text></box>
                    <box flexGrow={1} minWidth={0} paddingLeft={1} overflow="hidden"><text fg={focused ? theme.text : theme.muted} wrapMode="none">{fit(event.summary ?? event.detail ?? '', Math.max(rightW - (showActivityColumns ? 38 : 24), 6))}</text></box>
                  </box>
                )
              })}
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
            <text fg={pendingLabel ? theme.amber : theme.muted} wrapMode="none">{` ${fit(pendingLabel ?? 'Message the current context…  [M] broadcast  [m] message focused agent', innerW - 4)}`}</text>
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

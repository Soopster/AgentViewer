/** @jsxImportSource @opentui/react */
// Interactive mission control for AVP/2 coordinated runs — the TUI equivalent
// of Claude Code's agent panel. Navigate the team, open any teammate's
// transcript, message an agent (or everyone) through the protocol mailbox,
// inspect tasks and the live event feed, switch between runs, stop or clean
// up — all without leaving the popover.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import { getProviderAccent } from '../theme'
import { AGENT_PROTOCOL_VERSION } from '../../lib/agentProtocol'
import type { AgentProtocolEvent, ProtocolAgent, ProtocolRunSnapshot, ProtocolTask } from '../../lib/agentProtocol'
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
  onKeyHandlerReady: (handler: (key: CoordinationKeyEvent) => void) => void
}

type Section = 'team' | 'tasks' | 'events'

type PendingAction =
  | { kind: 'stop' }
  | { kind: 'delete-run' }
  | { kind: 'merge'; agent: ProtocolAgent; worktree: WorktreeTask }
  | { kind: 'fail-task'; task: ProtocolTask }

const POLL_MS = 2000
// Worktree ahead/dirty stats cost git subprocesses per teammate — refresh on
// a slower cadence than the snapshot poll.
const WORKTREE_STATS_MS = 10_000

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
  if (event.type === 'finding' || event.type === 'learning') return theme.green
  if (event.type === 'message') return theme.violet
  if (event.type === 'agent.blocked' || event.type === 'task.failed' || event.type === 'lock.denied') return theme.red
  return theme.dim
}

function formatAge(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
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
  onKeyHandlerReady,
}: Props) {
  const [runIds, setRunIds] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null)
  const [snapshot, setSnapshot] = useState<ProtocolRunSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('team')
  const [teamIndex, setTeamIndex] = useState(0)
  const [taskIndex, setTaskIndex] = useState(0)
  const [eventIndex, setEventIndex] = useState(-1) // -1 = follow tail
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  // Worktree path → ahead/dirty stats for TEAM rows and the merge flow.
  const [worktreeStats, setWorktreeStats] = useState<Map<string, WorktreeTask>>(new Map())
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [now, setNow] = useState(() => Date.now())

  // Discover runs, honoring the requested initial run.
  useEffect(() => {
    let cancelled = false
    void listTuiProtocolRuns(10).then((runs) => {
      if (cancelled) return
      const ids = runs.map((run) => run.id)
      setRunIds(ids)
      setRunId((current) => current ?? ids[0] ?? null)
    }).catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to list runs')
    })
    return () => { cancelled = true }
  }, [])

  // Poll the active run.
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const poll = () => {
      void readTuiProtocolRun(runId).then((next) => {
        if (cancelled) return
        setSnapshot(next)
        setLoadError(next ? null : 'Run not found')
        setNow(Date.now())
      }).catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load run')
      })
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [runId])

  // Ahead/dirty per teammate worktree, for the TEAM rows and merge action.
  useEffect(() => {
    const baseCwd = snapshot?.run.baseCwd
    if (!baseCwd) return
    let cancelled = false
    const refresh = () => {
      void listTuiWorktreeTasks(baseCwd).then((tasks) => {
        if (cancelled) return
        setWorktreeStats(new Map(tasks.map((task) => [task.path, task])))
      }).catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, WORKTREE_STATS_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [snapshot?.run.baseCwd])

  const agents = snapshot?.agents ?? []
  const tasks = snapshot?.tasks ?? []
  const events = snapshot?.events ?? []
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const undeliveredMail = useMemo(
    () => (snapshot?.messages ?? []).filter((message) => !message.deliveredAt).length,
    [snapshot?.messages],
  )

  const clampedTeam = agents.length === 0 ? 0 : Math.min(teamIndex, agents.length - 1)
  const clampedTask = tasks.length === 0 ? 0 : Math.min(taskIndex, tasks.length - 1)
  const clampedEvent = eventIndex < 0 ? events.length - 1 : Math.min(eventIndex, events.length - 1)
  const selectedAgent = agents[clampedTeam] ?? null
  const selectedEvent = events[clampedEvent] ?? null

  const sendTeamMessage = useCallback(async () => {
    const body = messageDraft.trim()
    const target = messageTarget
    if (!body || !target || !runId || busy) return
    setBusy(true)
    try {
      await appendTuiProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: 'user',
        type: 'message',
        to: target,
        summary: body,
      })
      onNotice('info', `Message sent to ${target} — delivered live or wakes them`, 4000)
      setMessageTarget(null)
      setMessageDraft('')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setBusy(false)
    }
  }, [busy, messageDraft, messageTarget, onNotice, runId])

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
        onNotice(
          'info',
          result.keptWorktrees.length > 0
            ? `Run deleted · kept ${result.keptWorktrees.length} worktree${result.keptWorktrees.length === 1 ? '' : 's'} with unmerged work`
            : 'Run deleted — clean worktrees removed',
          6000,
        )
        // Hop to the next remaining run (or the empty state).
        const remaining = runIds.filter((id) => id !== runId)
        setRunIds(remaining)
        setRunId(remaining[0] ?? null)
        setSnapshot(null)
        setEventIndex(-1)
        setExpandedTaskId(null)
        if (remaining.length === 0) setLoadError(null)
      } else if (action.kind === 'merge') {
        const result = await mergeTuiWorktreeTask(action.worktree)
        onNotice(
          'info',
          result.staged
            ? `Merged ${action.agent.name}'s worktree — changes staged in the main checkout (⇧U to review)`
            : `${action.agent.name}'s worktree has no changes to merge`,
          6000,
        )
        const baseCwd = snapshot?.run.baseCwd
        if (baseCwd) {
          const tasks = await listTuiWorktreeTasks(baseCwd).catch(() => [] as WorktreeTask[])
          setWorktreeStats(new Map(tasks.map((task) => [task.path, task])))
        }
      } else {
        // Manual task repair (doc: "task status can lag … update the task
        // status manually"). Recorded as the user's own protocol event.
        await appendTuiProtocolEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId,
          agentId: 'user',
          type: 'task.failed',
          taskId: action.task.id,
          summary: `${action.task.id} marked failed from the board`,
        })
        onNotice('info', `${action.task.id} marked failed`, 4000)
      }
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [busy, onNotice, runId, runIds, snapshot?.run.baseCwd])

  // Doc's agent-panel Esc/x: interrupt the selected teammate's current turn
  // without stopping the run — it re-engages on the next dispatch or message.
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

  const handleKey = useCallback((key: CoordinationKeyEvent) => {
    if (messageTarget !== null) {
      if (key.name === 'escape') {
        setMessageTarget(null)
        setMessageDraft('')
        return
      }
      if (key.name === 'return') void sendTeamMessage()
      // other keys fall through to the focused input
      return
    }
    if (pending) {
      if (key.name === 'y' || key.name === 'return') void runPendingAction(pending)
      else if (key.name === 'n' || key.name === 'escape') setPending(null)
      return
    }
    if (key.name === 'escape' || key.name === 'q') {
      onClose()
      return
    }
    if (key.name === 'tab') {
      setSection((current) => (current === 'team' ? 'tasks' : current === 'tasks' ? 'events' : 'team'))
      return
    }
    if (key.sequence === '[' || key.sequence === ']') {
      if (runIds.length < 2 || !runId) return
      const index = runIds.indexOf(runId)
      const nextIndex = key.sequence === '[' ? Math.min(index + 1, runIds.length - 1) : Math.max(index - 1, 0)
      const next = runIds[nextIndex]
      if (next && next !== runId) {
        setRunId(next)
        setSnapshot(null)
        setEventIndex(-1)
        setExpandedTaskId(null)
      }
      return
    }
    if (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up') {
      const delta = key.name === 'j' || key.name === 'down' ? 1 : -1
      if (section === 'team') setTeamIndex(Math.max(0, Math.min(clampedTeam + delta, agents.length - 1)))
      else if (section === 'tasks') setTaskIndex(Math.max(0, Math.min(clampedTask + delta, tasks.length - 1)))
      else setEventIndex(Math.max(0, Math.min(clampedEvent + delta, events.length - 1)))
      return
    }
    if (key.name === 'return') {
      if (section === 'team' && selectedAgent) {
        onOpenSession(selectedAgent)
        onClose()
      } else if (section === 'tasks' && tasks[clampedTask]) {
        const id = tasks[clampedTask]!.id
        setExpandedTaskId((current) => (current === id ? null : id))
      }
      return
    }
    if (key.name === 'm' && !key.shift) {
      setMessageTarget(section === 'team' && selectedAgent ? selectedAgent.name : 'lead')
      setMessageDraft('')
      return
    }
    if (key.name === 'm' && key.shift) {
      setMessageTarget('all')
      setMessageDraft('')
      return
    }
    if (key.name === 's') {
      const status = snapshot?.run.status
      if (status === 'planning' || status === 'running' || status === 'synthesizing') setPending({ kind: 'stop' })
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
      if (!worktree) {
        onNotice('info', `${selectedAgent.name} has no merge-ready worktree`, 3000)
        return
      }
      setPending({ kind: 'merge', agent: selectedAgent, worktree })
      return
    }
    if (key.name === 'f' && section === 'tasks' && tasks[clampedTask]) {
      const task = tasks[clampedTask]!
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        onNotice('info', `${task.id} is already terminal`, 2500)
        return
      }
      setPending({ kind: 'fail-task', task })
      return
    }
    if (key.name === 'c') {
      void cleanupRun()
      return
    }
    if (key.name === 'n') {
      onClose()
      onNewRun()
      return
    }
    if (key.name === 'g') {
      setEventIndex(-1)
      return
    }
  }, [agents.length, clampedEvent, clampedTask, clampedTeam, cleanupRun, events.length, interruptAgentTurn, messageTarget, onClose, onNewRun, onNotice, onOpenSession, pending, runId, runIds, runPendingAction, section, selectedAgent, sendTeamMessage, snapshot?.run.status, tasks, worktreeStats])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 116)
  const popH = Math.min(height - 4, 40)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4
  const leftW = Math.max(Math.floor(innerW * 0.46), 34)
  const rightW = Math.max(innerW - leftW - 2, 28)
  const headerH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - 2, 8)
  const eventRows = Math.max(bodyH - 3, 4)
  const eventWindowStart = Math.max(0, Math.min(clampedEvent - Math.floor(eventRows / 2), events.length - eventRows))
  const visibleEvents = events.slice(eventWindowStart, eventWindowStart + eventRows)

  const run = snapshot?.run ?? null
  const runIndexLabel = runId && runIds.length > 1 ? ` · run ${runIds.indexOf(runId) + 1}/${runIds.length} ([/] switch)` : ''
  const guardLabel = run
    ? `${run.requirePlanApproval ? ' · plans:on' : ''}${run.gateCommand ? ' · gate:on' : ''}`
    : ''
  const pendingLabel = pending?.kind === 'stop'
    ? 'Stop the run and interrupt every live turn? y/⏎ confirm · n/Esc cancel'
    : pending?.kind === 'delete-run'
    ? 'DELETE this run (team, tasks, events, messages)? Clean worktrees are removed; unmerged ones are kept. y/⏎ · n/Esc'
    : pending?.kind === 'merge'
    ? `Squash-merge ${pending.agent.name}'s worktree into the main checkout (staged)? y/⏎ · n/Esc`
    : pending?.kind === 'fail-task'
    ? `Mark ${pending.task.id} failed? Dependents unblock only on completion. y/⏎ · n/Esc`
    : null
  const footerHint = messageTarget !== null
    ? `message → ${messageTarget} · ⏎ send · Esc cancel`
    : pendingLabel
    ? pendingLabel
    : section === 'team'
    ? '⏎ transcript · m msg · ⇧M all · x interrupt · w merge · ⇥ section · s stop · ⇧D delete · c clean · n new'
    : section === 'tasks'
    ? '⏎ expand · f fail task · m msg lead · ⇥ section · s stop · ⇧D delete · c clean · n new'
    : 'j/k scroll · g tail · m msg lead · ⇥ section · s stop · Esc'

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.cyan}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title=" Agent team "
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        {run ? (
          <>
            <text fg={statusColor(run.status, theme)} wrapMode="none">{run.status.toUpperCase()}</text>
            <text fg={theme.dim} wrapMode="none">
              {fitTextLocal(` · ${String(run.provider).toUpperCase()} · ${formatAge(run.createdAt, now)} ago${guardLabel}${runIndexLabel} · `, 60)}
            </text>
            <box flexGrow={1} overflow="hidden">
              <text fg={theme.muted} wrapMode="none">{run.prompt.split('\n')[0]?.slice(0, Math.max(innerW - 52, 10))}</text>
            </box>
            {busy ? <text fg={theme.amber} wrapMode="none"> busy</text> : null}
            {undeliveredMail > 0 ? <text fg={theme.violet} wrapMode="none">{` ✉ ${undeliveredMail}`}</text> : null}
          </>
        ) : (
          <text fg={loadError ? theme.red : theme.dim} wrapMode="none">{loadError ?? 'No coordinated runs yet — press n to start one.'}</text>
        )}
      </box>

      <box flexGrow={1} paddingX={1} paddingTop={1} flexDirection="row" overflow="hidden">
        <box width={leftW} flexDirection="column" overflow="hidden">
          <text fg={section === 'team' ? theme.cyan : theme.dim} wrapMode="none">
            {`TEAM ${agents.length}${section === 'team' ? ' ◂' : ''}`}
          </text>
          {agents.map((agent, index) => {
            const selected = section === 'team' && index === clampedTeam
            return (
              <box key={agent.id} height={1} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="row">
                <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▸' : ' '}</text>
                <text fg={agent.role === 'lead' ? theme.amber : getProviderAccent(agent.provider)} wrapMode="none">
                  {agent.role === 'lead' ? '★' : '·'}
                </text>
                <text fg={selected ? theme.text : theme.muted} wrapMode="none">{` ${agent.name}`}</text>
                <text fg={statusColor(agent.status, theme)} wrapMode="none">{` ${agent.status}`}</text>
                <text fg={theme.dim} wrapMode="none">{agent.taskId ? ` ${agent.taskId}` : ''}</text>
                {(() => {
                  const stats = worktreeStats.get(agent.worktreePath)
                  if (!stats) return null
                  const parts = [
                    stats.aheadCommits > 0 ? `+${stats.aheadCommits}` : null,
                    stats.dirtyFiles > 0 ? `~${stats.dirtyFiles}` : null,
                  ].filter(Boolean)
                  return parts.length > 0
                    ? <text fg={theme.amber} wrapMode="none">{` ${parts.join(' ')}`}</text>
                    : null
                })()}
              </box>
            )
          })}

          <box marginTop={1}>
            <text fg={section === 'tasks' ? theme.cyan : theme.dim} wrapMode="none">
              {`TASKS ${tasks.filter((task) => task.status === 'completed').length}/${tasks.length}${section === 'tasks' ? ' ◂' : ''}`}
            </text>
          </box>
          <scrollbox
            ref={scrollRef}
            width={leftW}
            height={Math.max(bodyH - agents.length - 3, 4)}
            scrollY
            backgroundColor={theme.surface}
            scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
          >
            <box flexDirection="column">
              {tasks.map((task, index) => {
                const selected = section === 'tasks' && index === clampedTask
                const expanded = task.id === expandedTaskId
                return (
                  <box key={task.id} flexDirection="column" backgroundColor={selected ? theme.surface3 : theme.surface}>
                    <box height={1} flexDirection="row">
                      <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▸' : ' '}</text>
                      <text fg={statusColor(task.status, theme)} wrapMode="none">{`${task.id} ${task.status}`}</text>
                      <text fg={selected ? theme.text : theme.muted} wrapMode="none">
                        {` ${task.title}`.slice(0, Math.max(leftW - task.id.length - task.status.length - 4, 8))}
                      </text>
                    </box>
                    {expanded ? (
                      <box flexDirection="column" paddingLeft={2}>
                        {task.ownerAgentId ? (
                          <text fg={theme.dim} wrapMode="none">{`owner: ${agentsById.get(task.ownerAgentId)?.name ?? task.ownerAgentId}`}</text>
                        ) : null}
                        {task.blockedBy.length > 0 ? (
                          <text fg={theme.dim} wrapMode="none">{`deps: ${task.blockedBy.join(', ')}`}</text>
                        ) : null}
                        {task.paths.length > 0 ? (
                          <text fg={theme.dim} wrapMode="none">{`paths: ${task.paths.join(', ')}`.slice(0, leftW - 3)}</text>
                        ) : null}
                        {task.prompt.split('\n').slice(0, 6).map((line, lineIndex) => (
                          <text key={lineIndex} fg={theme.muted} wrapMode="none">{line.slice(0, leftW - 3) || ' '}</text>
                        ))}
                      </box>
                    ) : null}
                  </box>
                )
              })}
            </box>
          </scrollbox>
        </box>

        <box width={rightW} marginLeft={2} flexDirection="column" overflow="hidden">
          <text fg={section === 'events' ? theme.cyan : theme.dim} wrapMode="none">
            {`EVENTS ${events.length}${eventIndex >= 0 ? '' : ' · live'}${section === 'events' ? ' ◂' : ''}`}
          </text>
          {visibleEvents.map((event, index) => {
            const absolute = eventWindowStart + index
            const selected = section === 'events' && absolute === clampedEvent
            const who = agentsById.get(event.agentId)?.name ?? event.agentId
            return (
              <box key={`${event.timestamp ?? absolute}:${absolute}`} height={1} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="row">
                <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▸' : ' '}</text>
                <text fg={eventColor(event, theme)} wrapMode="none">
                  {`${who} ${event.type}${event.to ? `→${event.to}` : ''} ${event.summary ?? ''}`.slice(0, rightW - 2)}
                </text>
              </box>
            )
          })}
          {selectedEvent?.detail && section === 'events' ? (
            <box marginTop={1} flexDirection="column">
              <text fg={theme.dim} wrapMode="none">{'detail:'}</text>
              {selectedEvent.detail.split('\n').slice(0, 3).map((line, index) => (
                <text key={index} fg={theme.muted} wrapMode="none">{line.slice(0, rightW - 1) || ' '}</text>
              ))}
            </box>
          ) : null}
          {run?.summary ? (
            <box marginTop={1} flexDirection="column">
              <text fg={theme.green} wrapMode="none">SYNTHESIS</text>
              {run.summary.split('\n').filter(Boolean).slice(0, 4).map((line, index) => (
                <text key={index} fg={index === 0 ? theme.text : theme.muted} wrapMode="none">{line.slice(0, rightW - 1)}</text>
              ))}
            </box>
          ) : null}
        </box>
      </box>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        {messageTarget !== null ? (
          <box flexDirection="row" alignItems="center" flexGrow={1}>
            <text fg={theme.violet} wrapMode="none">{`→ ${messageTarget}: `}</text>
            <box flexGrow={1} backgroundColor={theme.surface3}>
              <input
                focused
                value={messageDraft}
                maxLength={400}
                onInput={(value: string) => setMessageDraft(value)}
                onSubmit={() => { void sendTeamMessage() }}
              />
            </box>
          </box>
        ) : (
          <text fg={pendingLabel ? theme.amber : theme.dim} wrapMode="none">{footerHint}</text>
        )}
      </box>
    </box>
  )
}

function fitTextLocal(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 0))}…`
}

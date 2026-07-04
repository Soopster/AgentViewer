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
  listTuiProtocolRuns,
  readTuiProtocolRun,
  stopTuiProtocolRun,
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

const POLL_MS = 2000

function statusColor(status: string, theme: TuiThemePalette): string {
  switch (status) {
    case 'completed': case 'done': return theme.green
    case 'blocked': case 'failed': return theme.red
    case 'working': case 'in_progress': case 'running': case 'synthesizing': return theme.amber
    case 'claimed': case 'planning': return theme.cyan
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
  const [confirmStop, setConfirmStop] = useState(false)
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

  const stopRun = useCallback(async () => {
    if (!runId || busy) return
    setBusy(true)
    try {
      const next = await stopTuiProtocolRun(runId)
      setSnapshot(next)
      onNotice('info', 'Run stopped — live turns interrupted', 4000)
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to stop run')
    } finally {
      setBusy(false)
      setConfirmStop(false)
    }
  }, [busy, onNotice, runId])

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
    if (confirmStop) {
      if (key.name === 'y' || key.name === 'return') void stopRun()
      else if (key.name === 'n' || key.name === 'escape') setConfirmStop(false)
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
      if (status === 'planning' || status === 'running' || status === 'synthesizing') setConfirmStop(true)
      else onNotice('info', 'Run is not active', 2500)
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
  }, [agents.length, clampedEvent, clampedTask, clampedTeam, cleanupRun, confirmStop, events.length, messageTarget, onClose, onNewRun, onNotice, onOpenSession, runId, runIds, section, selectedAgent, sendTeamMessage, snapshot?.run.status, stopRun, tasks])

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
  const footerHint = messageTarget !== null
    ? `message → ${messageTarget} · ⏎ send · Esc cancel`
    : confirmStop
    ? 'Stop the run and interrupt every live turn? y/⏎ confirm · n/Esc cancel'
    : section === 'team'
    ? '⏎ open transcript · m message · ⇧M all · ⇥ section · s stop · c clean · n new · Esc'
    : section === 'tasks'
    ? '⏎ expand task · m msg lead · ⇥ section · s stop · c clean · n new · Esc'
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
              {fitTextLocal(` · ${String(run.provider).toUpperCase()} · ${formatAge(run.createdAt, now)} ago${runIndexLabel} · `, 48)}
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
          <text fg={confirmStop ? theme.red : theme.dim} wrapMode="none">{footerHint}</text>
        )}
      </box>
    </box>
  )
}

function fitTextLocal(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 0))}…`
}

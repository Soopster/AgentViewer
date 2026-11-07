/** @jsxImportSource @opentui/react */
import { useEffect, useImperativeHandle, useMemo, useSyncExternalStore, type Ref, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { ProtocolAgent, ProtocolRunSnapshot } from '../../../lib/agentProtocol'
import type { TuiThemePalette } from '../../theme'
import { getCoordinatorState, subscribeCoordinator, acquireCoordinatorFeed } from '../coordinatorStore'
import { useWorkspaceState } from '../workspaceContext'
import { useEngineeringActions } from './useEngineeringActions'
import type { WorkButton } from './EngineeringWorkSections'
import { coordinationOverview, coordinationRunsForRepository, isFinishedCoordinatorTask } from './coordinationOverview'
import { formatWorkTimestamp } from './workbenchModel'
import type { EngineeringWorkHandle } from './EngineeringWork'

export type EngineeringCoordinationFeed = {
  getSnapshot: () => ReadonlyMap<string, ProtocolRunSnapshot>
  subscribe: (listener: () => void) => () => void
  acquire: () => () => void
}
const COORDINATOR_FEED: EngineeringCoordinationFeed = { getSnapshot: () => getCoordinatorState().snapshots, subscribe: subscribeCoordinator, acquire: acquireCoordinatorFeed }

/** Read-only overview; opening it does not claim tasks, read mail, or change a watched run. */
export function EngineeringCoordination({ root, theme, focused, scrollRef, preferred, onFocus, onOpenCoordinator, onOpenAgent, handleRef, feed = COORDINATOR_FEED }: {
  root: string; theme: TuiThemePalette; focused: boolean; scrollRef: RefObject<ScrollBoxRenderable | null>
  preferred?: ProtocolRunSnapshot | null; onFocus: () => void
  onOpenCoordinator?: (runId?: string) => void; onOpenAgent?: (agent: ProtocolAgent) => void
  handleRef?: Ref<EngineeringWorkHandle | null>; feed?: EngineeringCoordinationFeed
}) {
  const snapshots = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot)
  useEffect(() => feed.acquire(), [feed])
  const runs = useMemo(() => {
    const observed = new Map(snapshots)
    if (preferred && !observed.has(preferred.run.id)) observed.set(preferred.run.id, preferred)
    return coordinationRunsForRepository(observed.values(), root)
  }, [snapshots, preferred, root])
  const [selectedRun, setSelectedRun] = useWorkspaceState<string | null>(`engineering:coordination-run:${root}`, preferred?.run.id ?? null, false)
  const snapshot = runs.find(item => item.run.id === (selectedRun ?? preferred?.run.id)) ?? runs[0]
  const [taskId, setTaskId] = useWorkspaceState<string | null>(`engineering:coordination-task:${snapshot?.run.id ?? root}`, null, false)
  const [agentId, setAgentId] = useWorkspaceState<string | null>(`engineering:coordination-agent:${snapshot?.run.id ?? root}`, null, false)
  const overview = useMemo(() => snapshot ? coordinationOverview(snapshot) : null, [snapshot])
  const task = overview?.tasks.find(item => item.task.id === taskId)
  const agent = snapshot?.agents.find(item => item.id === (agentId ?? task?.owner?.id))
  const actions = useEngineeringActions('engineering-coordination', theme, focused, onFocus, scrollRef, `${selectedRun}:${taskId}:${agentId}`)
  const { button } = actions
  useImperativeHandle(handleRef, () => ({ handleKey: key => focused ? actions.handleKey(key) : false }))
  useEffect(() => {
    if (!taskId && !agentId) return
    const timer = setTimeout(() => scrollRef.current?.scrollChildIntoView('engineering-coordination:details'), 0)
    return () => clearTimeout(timer)
  }, [taskId, agentId, scrollRef])
  const chooseTask = (id: string) => { setTaskId(id); setAgentId(overview?.tasks.find(item => item.task.id === id)?.owner?.id ?? null) }
  return <>
    <text fg={theme.cyan}>Agent coordination</text>
    {button('open', 'Open full Coordinator', () => onOpenCoordinator?.(snapshot?.run.id))}
    {snapshot && overview ? renderCoordinatorSnapshot({ snapshot, overview, task, agent, runs, button, chooseTask, setSelectedRun, setTaskId, setAgentId, onOpenAgent, theme })
      : <text fg={theme.dim}>No Coordinator snapshot observed for this repository yet. Existing runs appear here; this view never creates a run.</text>}

  </>
}

type Overview = ReturnType<typeof coordinationOverview>
type TaskRow = Overview['tasks'][number]
type SnapshotView = {
  snapshot: ProtocolRunSnapshot; overview: Overview; task?: TaskRow; agent?: ProtocolAgent; runs: ProtocolRunSnapshot[]
  button: WorkButton; chooseTask: (id: string) => void; setSelectedRun: (id: string) => void
  setTaskId: (id: string | null) => void; setAgentId: (id: string | null) => void
  onOpenAgent?: (agent: ProtocolAgent) => void; theme: TuiThemePalette
}
function renderCoordinatorSnapshot({ snapshot, overview, task, agent, runs, button, chooseTask, setSelectedRun, setTaskId, setAgentId, onOpenAgent, theme }: SnapshotView) {
  return <>
      <text fg={theme.dim}>Observed runs · repository / agent worktrees</text>
      {runs.map(item => button(`run:${item.run.id}`, `${item.run.id === snapshot.run.id ? '›' : ' '} ${item.run.status}: ${item.run.prompt.split('\n')[0]}`, () => { setSelectedRun(item.run.id); setTaskId(null); setAgentId(null) }))}
      <text fg={theme.dim}>{`Last run update: ${formatWorkTimestamp(Date.parse(snapshot.run.updatedAt))}`}</text>
      <text fg={theme.dim}>{snapshot.run.baseCwd}</text>
      {overview?.idleWarning ? <text fg={theme.amber}>{overview.idleWarning}</text> : null}
      {overview?.budgetWarning ? <text fg={theme.amber}>{overview.budgetWarning}</text> : null}
      <text fg={theme.cyan} marginTop={1}>Who is doing what</text>
      {snapshot.agents.map(item => button(`agent:${item.id}`, `${item.name} · ${item.provider} · ${item.turnActive ? 'live turn' : item.status === 'working' ? 'reported working' : item.status}${item.liveness ? ` · ${item.liveness.status}` : ''}`, () => { setAgentId(item.id); setTaskId(snapshot.tasks.find(task => task.ownerAgentId === item.id && !isFinishedCoordinatorTask(task.status))?.id ?? null) }))}
      <text fg={theme.cyan} marginTop={1}>Task assignments</text>
      {overview.tasks.map(item => <box key={item.task.id} flexDirection="column" flexShrink={0}>
        {button(`task:${item.task.id}`, `${item.task.status} · ${item.owner?.name ?? (item.task.ownerAgentId ? 'Owner not in snapshot' : 'Unassigned')} · ${item.task.title}`, () => chooseTask(item.task.id))}
        <text fg={theme.dim} wrapMode="word">{item.task.paths.length ? `Scope: ${item.task.paths.slice(0, 2).join(', ')}${item.task.paths.length > 2 ? ` (+${item.task.paths.length - 2} more)` : ''}` : 'Scope not declared.'}</text>
      </box>)}
      {renderCoordinatorTask(task, button, chooseTask, theme)}
      {agent ? <>
        <text fg={theme.dim}>{`Worktree: ${agent.worktreePath || 'not recorded'}${agent.worktreeBranch ? ` · ${agent.worktreeBranch}` : ''}`}</text>
        {agent.sessionId && onOpenAgent ? button('open-agent', `Open ${agent.name}'s session`, () => onOpenAgent(agent)) : null}
      </> : null}
      <text fg={theme.cyan} marginTop={1}>Potential overlap · selected run</text>
      {overview?.overlaps.length ? overview.overlaps.map((overlap, index) => <text key={`${overlap.path}:${index}`} fg={theme.amber} wrapMode="word">{`${overlap.path} · ${overlap.owners.join(', ') || 'owners not recorded'} · tasks ${overlap.taskIds.join(', ')}`}</text>)
        : <text fg={theme.dim}>No live scope overlap reported by the Coordinator.</text>}
      <text fg={theme.dim}>Declared/reported scope overlap is not a Git conflict or proof of current hunk ownership.</text>
      {overview?.holdUps.length ? <text fg={theme.cyan}>Bottlenecks</text> : null}
      {overview?.holdUps.map(item => button(`holdup:${item.taskId}`, `${item.title} · holds up ${item.holdsUp}`, () => chooseTask(item.taskId)))}
  </>
}
function renderCoordinatorTask(task: TaskRow | undefined, button: WorkButton, chooseTask: (id: string) => void, theme: TuiThemePalette) {
  return <box id="engineering-coordination:details" flexDirection="column" flexShrink={0}>
      {task ? <>
        <text fg={theme.text} wrapMode="word">{task.task.title}</text>
        <text fg={task.task.status === 'blocked' ? theme.amber : theme.dim}>{`Status: ${task.task.status} · ${task.owner?.name ?? (task.task.ownerAgentId ? 'Owner not in snapshot' : 'Unassigned')}`}</text>
        <text fg={theme.cyan}>Declared file scope</text>
        <text fg={theme.text} wrapMode="word">{task.task.paths.length ? task.task.paths.join('\n') : 'No file scope declared.'}</text>
        <text fg={theme.cyan}>Dependencies / blockers</text>
        {task.dependencies.length ? task.dependencies.map(dependency => dependency.task ? button(`dependency:${dependency.id}`, `${dependency.unresolved ? 'Waiting' : 'Complete'}: ${dependency.task.title} · ${dependency.task.status}`, () => chooseTask(dependency.id)) : <text key={dependency.id} fg={theme.amber}>{`Waiting: ${dependency.id} · missing from snapshot`}</text>)
          : <text fg={theme.dim}>{task.task.status === 'blocked' ? 'Task reports blocked; no dependency was recorded.' : 'No declared task dependencies.'}</text>}
        {task.lastStatus ? <><text fg={theme.cyan}>Latest owner status report</text><text fg={theme.text} wrapMode="word">{task.lastStatus}</text></> : null}
      </> : <text fg={theme.dim}>Select an agent or task for scopes and blockers.</text>}
  </box>
}

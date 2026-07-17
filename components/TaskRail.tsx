'use client'

import { useMemo } from 'react'
import type { TaskGroup, TaskRegistry, TaskState, WorkflowRunSummary } from '@/lib/taskRegistry'
import { groupAndSortTasks, isStoppableTask, splitWorkflowTasks } from '@/lib/taskRegistry'

const STATUS_ICON: Record<TaskState['status'], string> = {
  pending: '○',
  in_progress: '◐',
  paused: 'Ⅱ',
  completed: '✓',
  failed: '×',
  stopped: '■',
}

const STATUS_COLOR: Record<TaskState['status'], string> = {
  pending: 'var(--text-3)',
  in_progress: 'var(--amber)',
  paused: 'var(--yellow)',
  completed: 'var(--green)',
  failed: 'var(--red)',
  stopped: 'var(--text-3)',
}

const GROUP_LABEL: Record<TaskGroup, string> = {
  in_progress: 'IN PROGRESS',
  blocked: 'BLOCKED',
  paused: 'PAUSED',
  pending: 'PENDING',
  failed: 'FAILED',
  stopped: 'STOPPED',
  completed: 'COMPLETED',
}

const STATUS_LABEL: Record<TaskState['status'], string> = {
  pending: 'pending',
  in_progress: 'running',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
}

function compactText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function sameText(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

function taskTitle(task: TaskState): string {
  return compactText(
    task.status === 'in_progress' && task.activeForm
      ? task.activeForm
      : task.subject || task.summary || task.description || task.activeForm,
  ) || `#${task.id}`
}

function taskDetail(task: TaskState, title: string): string {
  const candidates = [task.summary, task.description, task.activeForm, task.error]
    .map(compactText)
    .filter(Boolean)
  return candidates.find((value) => !sameText(value, title)) ?? ''
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tok`
  return `${n} tok`
}

function formatTime(value: string): string {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return ''
  return time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function taskMetaParts(task: TaskState, openBlockers: string[]): string[] {
  const parts = [`#${task.id}`, STATUS_LABEL[task.status]]
  if (task.events.length > 1) parts.push(`${task.events.length} events`)
  if (task.firstSeenAt) {
    const created = formatTime(task.firstSeenAt)
    if (created) parts.push(`created ${created}`)
  }
  if (task.lastUpdatedAt && task.lastUpdatedAt !== task.firstSeenAt) {
    const updated = formatTime(task.lastUpdatedAt)
    if (updated) parts.push(`updated ${updated}`)
  }
  if (task.owner) parts.push(`@${task.owner}`)
  if (task.subagentType) parts.push(task.subagentType)
  else if (task.taskType) parts.push(task.taskType)
  if (task.workflowName) parts.push(task.workflowName)
  if (task.lastToolName) parts.push(`last ${task.lastToolName}`)
  if (task.toolUses != null) parts.push(`${task.toolUses} tool${task.toolUses === 1 ? '' : 's'}`)
  if (task.durationMs != null) parts.push(formatDuration(task.durationMs))
  if (task.totalTokens != null) parts.push(formatTokens(task.totalTokens))
  if (task.pausedMs != null) parts.push(`paused ${formatDuration(task.pausedMs)}`)
  if (task.isBackgrounded) parts.push('background')
  if (openBlockers.length > 0) parts.push(`blocked by ${openBlockers.map((id) => `#${id}`).join(', ')}`)
  if (task.blocks.length > 0) parts.push(`blocks ${task.blocks.map((id) => `#${id}`).join(', ')}`)
  return parts
}

function eventLine(event: TaskState['events'][number]): string {
  const time = event.timestamp ? formatTime(event.timestamp) : ''
  const label = event.kind
  const subject = compactText(event.subject || event.summary || event.description || event.activeForm || event.details)
  const status = event.status ? STATUS_LABEL[event.status] : ''
  return [time, label, status, subject].filter(Boolean).join(' · ')
}

function taskTooltip(task: TaskState, title: string, detail: string, meta: string[]): string {
  const lineage = task.events.map(eventLine).filter(Boolean)
  return [
    title,
    detail,
    task.error ? `Error: ${task.error}` : '',
    task.prompt ? `Prompt: ${task.prompt}` : '',
    task.outputFile ? `Output: ${task.outputFile}` : '',
    meta.join(' · '),
    lineage.length > 0 ? `Lineage:\n${lineage.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

export function TaskRail({
  registry,
  onJumpToEvent,
  onClose,
  onStopTask,
}: {
  registry: TaskRegistry
  onJumpToEvent: (uuid: string) => void
  onClose: () => void
  /** Cancel a running SDK background task via query.stopTask(). Absent when the
   *  viewed provider/session can't stop tasks (only Claude warm sessions can). */
  onStopTask?: (taskId: string) => void
}) {
  const { workflows, rest: nonWorkflowRegistry } = useMemo(() => splitWorkflowTasks(registry), [registry])
  const groups = useMemo(() => groupAndSortTasks(nonWorkflowRegistry), [nonWorkflowRegistry])
  const completedIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of registry.values()) if (t.status === 'completed') set.add(t.id)
    return set
  }, [registry])

  return (
    <aside
      style={{
        flexShrink: 0,
        width: 360,
        borderLeft: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', fontWeight: 500, letterSpacing: '0.08em', flex: 1 }}>
          TASKS
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
          {registry.size}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task panel"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-3)',
            cursor: 'pointer',
            padding: '2px 6px',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {workflows.length > 0 && (
          <section style={{ marginBottom: 4 }}>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: 'var(--text-3)',
                letterSpacing: '0.08em',
                padding: '6px 12px 4px',
              }}
            >
              WORKFLOWS · {workflows.length}
            </div>
            {workflows.map((run) => (
              <WorkflowRunRow
                key={run.id}
                run={run}
                onJump={() => onJumpToEvent(run.latestEventUuid)}
                onStop={onStopTask && run.isStoppable ? () => onStopTask(run.id) : undefined}
              />
            ))}
          </section>
        )}
        {groups.length === 0 && workflows.length === 0 ? (
          <div style={{ padding: '24px 14px', fontSize: 12, color: 'var(--text-3)', textAlign: 'center', fontStyle: 'italic' }}>
            no tasks in this session
          </div>
        ) : (
          groups.map(({ group, tasks }) => (
            <section key={group} style={{ marginBottom: 4 }}>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: '0.08em',
                  padding: '6px 12px 4px',
                }}
              >
                {GROUP_LABEL[group]} · {tasks.length}
              </div>
              {tasks.map((task) => (
                <TaskRailRow
                  key={task.id}
                  task={task}
                  isBlocked={group === 'blocked'}
                  completedIds={completedIds}
                  onJump={() => onJumpToEvent(task.latestEventUuid)}
                  onStop={onStopTask && isStoppableTask(task) ? () => onStopTask(task.id) : undefined}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  )
}

function workflowMetaParts(run: WorkflowRunSummary): string[] {
  const parts = [`#${run.id}`, STATUS_LABEL[run.status]]
  if (run.agentTotal > 0) {
    parts.push(run.agentRunning > 0
      ? `${run.agentCompleted}/${run.agentTotal} agents`
      : `${run.agentTotal} agent${run.agentTotal === 1 ? '' : 's'}`)
    if (run.agentFailed > 0) parts.push(`${run.agentFailed} failed`)
  }
  if (run.toolUses != null) parts.push(`${run.toolUses} tool${run.toolUses === 1 ? '' : 's'}`)
  if (run.durationMs != null) parts.push(formatDuration(run.durationMs))
  if (run.totalTokens != null) parts.push(formatTokens(run.totalTokens))
  return parts
}

function WorkflowRunRow({
  run,
  onJump,
  onStop,
}: {
  run: WorkflowRunSummary
  onJump: () => void
  /** Present only while the workflow run is live on a Claude warm session. */
  onStop?: () => void
}) {
  const meta = workflowMetaParts(run)
  const detail = run.error ?? run.activity ?? ''
  const nameColor = run.status === 'completed'
    ? 'var(--text-3)'
    : run.status === 'failed'
    ? 'var(--red)'
    : 'var(--text)'

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {onStop && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStop() }}
          title={`Stop workflow ${run.name}`}
          aria-label={`Stop workflow ${run.name}`}
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            border: '1px solid var(--red)',
            borderRadius: 4,
            background: 'var(--surface)',
            color: 'var(--red)',
            cursor: 'pointer',
            padding: '1px 6px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            lineHeight: 1.4,
            letterSpacing: '0.04em',
          }}
        >
          ■ stop
        </button>
      )}
      <button
        type="button"
        onClick={onJump}
        title={[run.name, detail, meta.join(' · ')].filter(Boolean).join('\n')}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '7px 12px',
          paddingRight: onStop ? 64 : 12,
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              color: STATUS_COLOR[run.status],
              flexShrink: 0,
              marginTop: 1,
              width: 12,
              textAlign: 'center',
            }}
          >
            {run.status === 'in_progress' ? '⟳' : STATUS_ICON[run.status]}
          </span>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              style={{
                fontSize: 12.5,
                color: nameColor,
                lineHeight: 1.35,
                fontFamily: "'IBM Plex Mono', monospace",
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {run.name}
            </span>
            {detail && (
              <span
                style={{
                  fontSize: 11.5,
                  color: run.error ? 'var(--red)' : 'var(--text-2)',
                  lineHeight: 1.35,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'break-word',
                }}
              >
                {detail}
              </span>
            )}
            {meta.length > 0 && (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 6px', minWidth: 0 }}>
                {meta.map((part) => (
                  <span
                    key={part}
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: 'var(--text-3)',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {part}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  )
}

function TaskRailRow({
  task,
  isBlocked,
  completedIds,
  onJump,
  onStop,
}: {
  task: TaskState
  isBlocked: boolean
  completedIds: Set<string>
  onJump: () => void
  /** Present only for a running SDK background task on a Claude warm session. */
  onStop?: () => void
}) {
  const openBlockers = isBlocked
    ? task.blockedBy.filter((id) => !completedIds.has(id))
    : []
  const title = taskTitle(task)
  const detail = taskDetail(task, title)
  const meta = taskMetaParts(task, openBlockers)
  const subjectColor = task.status === 'completed'
    ? 'var(--text-3)'
    : task.status === 'failed'
    ? 'var(--red)'
    : isBlocked
    ? 'var(--text-2)'
    : 'var(--text)'

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {onStop && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStop() }}
          title={`Stop task #${task.id}`}
          aria-label={`Stop task #${task.id}`}
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            border: '1px solid var(--red)',
            borderRadius: 4,
            background: 'var(--surface)',
            color: 'var(--red)',
            cursor: 'pointer',
            padding: '1px 6px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            lineHeight: 1.4,
            letterSpacing: '0.04em',
          }}
        >
          ■ stop
        </button>
      )}
      <button
      type="button"
      onClick={onJump}
      title={taskTooltip(task, title, detail, meta)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        padding: '7px 12px',
        paddingRight: onStop ? 64 : 12,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            color: STATUS_COLOR[task.status],
            flexShrink: 0,
            marginTop: 1,
            width: 12,
            textAlign: 'center',
          }}
        >
          {STATUS_ICON[task.status]}
        </span>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 12.5,
              color: subjectColor,
              lineHeight: 1.35,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
              textDecoration: task.status === 'completed' ? 'line-through' : 'none',
              fontStyle: task.status === 'in_progress' && task.activeForm ? 'italic' : 'normal',
            }}
          >
            {title}
          </span>
          {detail && (
            <span
              style={{
                fontSize: 11.5,
                color: task.error ? 'var(--red)' : 'var(--text-2)',
                lineHeight: 1.35,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word',
              }}
            >
              {detail}
            </span>
          )}
          {meta.length > 0 && (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 6px', minWidth: 0 }}>
              {meta.map((part) => (
                <span
                  key={part}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {part}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      </button>
    </div>
  )
}

/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import type { ThreadedMessage } from '../../lib/threading'
import {
  buildTaskRegistry,
  groupAndSortTasks,
  type TaskGroup,
  type TaskState,
} from '../../lib/taskRegistry'

type TaskPanelKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  messages: ThreadedMessage[]
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onSelectTask: (eventUuid: string) => void
  onKeyHandlerReady: (handler: (key: TaskPanelKeyEvent) => void) => void
}

const STATUS_ICON: Record<TaskState['status'], string> = {
  pending: '○',
  in_progress: '◐',
  paused: 'Ⅱ',
  completed: '✓',
  failed: '×',
  stopped: '■',
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

type FlatRow =
  | { kind: 'header'; group: TaskGroup; count: number }
  | { kind: 'task'; group: TaskGroup; task: TaskState; openBlockers: string[] }

function flattenGroups(groups: ReturnType<typeof groupAndSortTasks>, completedIds: Set<string>): FlatRow[] {
  const rows: FlatRow[] = []
  for (const { group, tasks } of groups) {
    rows.push({ kind: 'header', group, count: tasks.length })
    for (const task of tasks) {
      const openBlockers = group === 'blocked'
        ? task.blockedBy.filter((id) => !completedIds.has(id))
        : []
      rows.push({ kind: 'task', group, task, openBlockers })
    }
  }
  return rows
}

function statusColor(status: TaskState['status'], theme: TuiThemePalette): string {
  if (status === 'completed') return theme.green
  if (status === 'failed') return theme.red
  if (status === 'in_progress') return theme.amber
  if (status === 'paused') return theme.amber
  return theme.dim
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

function taskMeta(task: TaskState, openBlockers: string[]): string {
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
  return parts.join(' · ')
}

function eventColor(event: TaskState['events'][number], theme: TuiThemePalette): string {
  if (event.status === 'failed') return theme.red
  if (event.status === 'completed') return theme.green
  if (event.status === 'in_progress' || event.kind === 'created') return theme.amber
  return theme.dim
}

function eventKindLabel(kind: TaskState['events'][number]['kind']): string {
  return kind.replace(/_/g, ' ')
}

function eventStatusLabel(status: TaskState['events'][number]['status']): string {
  return status ? STATUS_LABEL[status] : ''
}

function eventMetaLine(event: TaskState['events'][number]): string {
  const parts = [
    event.timestamp ? formatTime(event.timestamp) : '',
    eventKindLabel(event.kind),
    eventStatusLabel(event.status),
  ].filter(Boolean)
  return parts.join(' · ')
}

function taskAnchorId(taskId: string): string {
  return `task-panel-task-${taskId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

function taskEndAnchorId(taskId: string): string {
  return `task-panel-task-end-${taskId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

export function TaskPanelPopover({
  messages,
  theme,
  width,
  height,
  onClose,
  onSelectTask,
  onKeyHandlerReady,
}: Props) {
  const registry = useMemo(() => buildTaskRegistry(messages), [messages])
  const completedIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of registry.values()) if (t.status === 'completed') set.add(t.id)
    return set
  }, [registry])
  const groups = useMemo(() => groupAndSortTasks(registry), [registry])
  const rows = useMemo(() => flattenGroups(groups, completedIds), [groups, completedIds])
  const taskRowIndexes = useMemo(
    () => rows.flatMap((r, i) => (r.kind === 'task' ? [i] : [])),
    [rows],
  )

  const [selectedTaskIdx, setSelectedTaskIdx] = useState(0)
  const clampedSelected = Math.min(Math.max(selectedTaskIdx, 0), Math.max(taskRowIndexes.length - 1, 0))

  // Reset selection if the row count shrinks past the cursor.
  useEffect(() => {
    if (selectedTaskIdx > taskRowIndexes.length - 1) {
      setSelectedTaskIdx(Math.max(taskRowIndexes.length - 1, 0))
    }
  }, [selectedTaskIdx, taskRowIndexes.length])

  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const lastScrolledTaskIdxRef = useRef(clampedSelected)
  const highlightedFlatIdx = taskRowIndexes[clampedSelected] ?? -1
  const highlightedRow = highlightedFlatIdx >= 0 ? rows[highlightedFlatIdx] : undefined
  const highlightedTask = highlightedRow?.kind === 'task' ? highlightedRow.task : undefined

  useEffect(() => {
    if (!highlightedTask) return
    const previousIdx = lastScrolledTaskIdxRef.current
    lastScrolledTaskIdxRef.current = clampedSelected
    const targetId = clampedSelected < previousIdx
      ? taskAnchorId(highlightedTask.id)
      : taskEndAnchorId(highlightedTask.id)
    const timer = setTimeout(() => {
      scrollRef.current?.scrollChildIntoView(targetId)
    }, 0)
    return () => clearTimeout(timer)
  }, [clampedSelected, highlightedTask?.id, highlightedTask?.events.length])

  const handleKey = useCallback((key: TaskPanelKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'j' || key.name === 'down') {
      setSelectedTaskIdx((i) => Math.min(i + 1, Math.max(taskRowIndexes.length - 1, 0)))
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      setSelectedTaskIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (key.name === 'g' && !key.shift) {
      setSelectedTaskIdx(0)
      return
    }
    if (key.name === 'g' && key.shift) {
      setSelectedTaskIdx(Math.max(taskRowIndexes.length - 1, 0))
      return
    }
    if (key.name === 'd') { scrollRef.current?.scrollBy(10); return }
    if (key.name === 'u') { scrollRef.current?.scrollBy(-10); return }
    if (key.name === 'c') {
      const flatIdx = taskRowIndexes[clampedSelected]
      if (flatIdx == null) return
      const row = rows[flatIdx]
      if (row?.kind === 'task') onSelectTask(row.task.createdEventUuid ?? row.task.latestEventUuid)
      return
    }
    if (key.name === 'return' || key.name === 'enter') {
      const flatIdx = taskRowIndexes[clampedSelected]
      if (flatIdx == null) return
      const row = rows[flatIdx]
      if (row?.kind === 'task') onSelectTask(row.task.latestEventUuid)
      return
    }
  }, [clampedSelected, onClose, onSelectTask, rows, taskRowIndexes])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.max(24, width - 16)
  const popH = Math.max(12, Math.min(height - 4, 36))
  const headerH = 3
  const bodyH = popH - headerH - 2
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const contentW = Math.max(12, popW - 4)
  const subjectW = Math.max(10, contentW - 2)

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title=" Tasks "
      titleAlignment="left"
    >
      <box
        height={headerH}
        flexDirection="row"
        paddingX={1}
        border={['bottom']}
        borderStyle="single"
        borderColor={theme.border}
      >
        <text fg={theme.muted}>
          {`${registry.size} task${registry.size === 1 ? '' : 's'}`}
        </text>
        <box flexGrow={1} />
        <text fg={theme.dim}>{'j/k navigate · d/u scroll · enter latest · c create · esc close'}</text>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - 2}
        height={bodyH}
        backgroundColor={theme.surface}
        scrollY
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        {rows.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <text fg={theme.dim}>no tasks in this session</text>
          </box>
        ) : rows.map((row, i) => {
          if (row.kind === 'header') {
            return (
              <box key={`h-${row.group}`} paddingX={1} marginTop={i === 0 ? 0 : 1}>
                <text fg={theme.dim} wrapMode="none">
                  {`${GROUP_LABEL[row.group]} · ${row.count}`}
                </text>
              </box>
            )
          }
          const { task, group, openBlockers } = row
          const isSelected = i === highlightedFlatIdx
          const bg = isSelected ? theme.surface2 : 'transparent'
          const baseFg = task.status === 'completed' ? theme.dim
            : task.status === 'failed' ? theme.red
            : group === 'blocked' ? theme.muted
            : theme.text
          const subject = taskTitle(task)
          const detail = taskDetail(task, subject)
          const meta = taskMeta(task, openBlockers)
          const hasLineage = isSelected && task.events.length > 0
          return (
            <box
              key={`t-${task.id}`}
              flexDirection="column"
              paddingX={1}
              backgroundColor={bg}
            >
              <box id={taskAnchorId(task.id)} flexDirection="row">
                <text fg={statusColor(task.status, theme)} wrapMode="none">
                  {`${STATUS_ICON[task.status]} `}
                </text>
                <box width={subjectW}>
                  <text fg={baseFg} wrapMode="word">
                    {subject}
                  </text>
                </box>
              </box>
              {detail ? (
                <box paddingLeft={2} width={contentW}>
                  <text fg={task.error ? theme.red : theme.muted} wrapMode="word">
                    {detail}
                  </text>
                </box>
              ) : null}
              {meta ? (
                <box id={!hasLineage && isSelected ? taskEndAnchorId(task.id) : undefined} paddingLeft={2} width={contentW}>
                  <text fg={theme.dim} wrapMode="word">
                    {meta}
                  </text>
                </box>
              ) : null}
              {hasLineage ? (
                <box
                  flexDirection="column"
                  paddingLeft={1}
                  marginTop={1}
                  width={contentW}
                  border={['left']}
                  borderStyle="single"
                  borderColor={theme.border}
                >
                  <text fg={theme.cyan} wrapMode="none">lineage</text>
                  {task.events.map((event, eventIndex) => (
                    <box
                      key={`${task.id}:event:${event.uuid}:${eventIndex}`}
                      id={eventIndex === task.events.length - 1 ? taskEndAnchorId(task.id) : undefined}
                      flexDirection="column"
                      width={contentW - 1}
                      marginTop={eventIndex === 0 ? 0 : 1}
                      paddingLeft={1}
                    >
                      <box flexDirection="row">
                        <box width={2}>
                          <text fg={eventColor(event, theme)} wrapMode="none">
                            {eventIndex === task.events.length - 1 ? '◉' : '●'}
                          </text>
                        </box>
                        <text fg={theme.dim} wrapMode="none">
                          {eventMetaLine(event)}
                        </text>
                      </box>
                      <text fg={eventColor(event, theme)} wrapMode="word">
                        {compactText(event.subject || event.summary || event.description || event.activeForm || event.details) || ' '}
                      </text>
                    </box>
                  ))}
                </box>
              ) : null}
            </box>
          )
        })}
      </scrollbox>
    </box>
  )
}

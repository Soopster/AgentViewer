/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import type { TuiThemePalette } from '../theme'
import type { ThreadedMessage } from '../../lib/threading'
import type { Session } from '../../lib/types'
import {
  buildTaskRegistry,
  buildTaskRegistryFromTodos,
  groupAndSortTasks,
  type TaskGroup,
  type TaskState,
  type OpenCodeTodo,
} from '../../lib/taskRegistry'

type Props = {
  messages: ThreadedMessage[]
  todos?: import('../../lib/taskRegistry').OpenCodeTodo[]
  theme: TuiThemePalette
  width: number
  height: number
  session?: Session | null
  onSelectTask: (eventUuid: string) => void
}

const STATUS_GLYPH: Record<TaskState['status'], string> = {
  pending: '○',
  in_progress: '●',
  paused: 'Ⅱ',
  completed: '✓',
  failed: '×',
  stopped: '■',
}

const GROUP_LABEL: Record<TaskGroup, string> = {
  in_progress: 'ACTIVE',
  blocked: 'STUCK',
  paused: 'PAUSED',
  pending: 'PENDING',
  failed: 'FAILED',
  stopped: 'STOPPED',
  completed: 'DONE',
}

function statusColor(status: TaskState['status'], theme: TuiThemePalette): string {
  if (status === 'completed') return theme.green
  if (status === 'failed') return theme.red
  if (status === 'in_progress') return theme.amber
  if (status === 'paused') return theme.amber
  return theme.dim
}

function priorityColor(priority: string | undefined, theme: TuiThemePalette): string {
  if (priority === 'high') return theme.red
  if (priority === 'medium') return theme.amber
  return theme.dim
}

function compactText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function taskTitle(task: TaskState): string {
  return compactText(
    task.status === 'in_progress' && task.activeForm
      ? task.activeForm
      : task.subject || task.summary || task.description || task.activeForm,
  ) || `#${task.id}`
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(max - 1, 0)) + '…'
}

export function TaskSidePanel({
  messages,
  theme,
  width,
  height,
  session,
  todos: liveTodos,
  onSelectTask,
}: Props) {
  const registry = useMemo(() => {
    const r = buildTaskRegistry(messages)
    const todos = liveTodos ?? (session as Record<string, unknown>)?.todos as OpenCodeTodo[] | undefined
    if (Array.isArray(todos) && todos.length > 0) {
      const todosReg = buildTaskRegistryFromTodos(todos)
      for (const [id, task] of todosReg) r.set(id, task)
    }
    return r
  }, [messages, session, liveTodos])
  const groups = useMemo(() => groupAndSortTasks(registry), [registry])

  const inProgressCount = groups.find((g) => g.group === 'in_progress')?.tasks.length ?? 0
  const blockedCount = groups.find((g) => g.group === 'blocked')?.tasks.length ?? 0
  const pendingCount = groups.find((g) => g.group === 'pending')?.tasks.length ?? 0
  const doneCount = groups.find((g) => g.group === 'completed')?.tasks.length ?? 0
  const failedCount = groups.find((g) => g.group === 'failed')?.tasks.length ?? 0

  const innerW = Math.max(width - 4, 10)
  const glyphW = 2
  const priorityW = 1
  const subjectW = Math.max(innerW - glyphW - priorityW, 4)

  return (
    <box
      width={width}
      height={height}
      border
      borderStyle="single"
      borderColor={inProgressCount > 0 ? theme.amber : blockedCount > 0 ? theme.red : doneCount === registry.size ? theme.green : theme.border}
      backgroundColor={theme.surface}
      flexDirection="column"
      title=" Tasks "
      titleAlignment="left"
    >
      <box paddingX={1} paddingTop={1} flexDirection="row">
        <text fg={theme.text} wrapMode="none">
          {`${registry.size}`}
        </text>
        <text fg={theme.dim} wrapMode="none">
          {' task'}{registry.size === 1 ? '' : 's'}
        </text>
        {inProgressCount > 0 ? (
          <text fg={theme.amber} wrapMode="none">{` ·${inProgressCount}`}</text>
        ) : null}
        {blockedCount > 0 ? (
          <text fg={theme.red} wrapMode="none">{` !${blockedCount}`}</text>
        ) : null}
        {failedCount > 0 ? (
          <text fg={theme.red} wrapMode="none">{` ×${failedCount}`}</text>
        ) : null}
        <box flexGrow={1} />
        {pendingCount > 0 ? (
          <text fg={theme.dim} wrapMode="none">{`${pendingCount}`}</text>
        ) : null}
        {doneCount > 0 ? (
          <text fg={theme.green} wrapMode="none">{` ✓${doneCount}`}</text>
        ) : null}
      </box>

      <box flexGrow={1} paddingX={1} overflow="hidden">
        {registry.size === 0 ? (
          <text fg={theme.dim}>no tasks</text>
        ) : (
          <scrollbox
            style={{ height: height - 4 }}
            backgroundColor={theme.surface}
            scrollY
            scrollbarOptions={{
              trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface },
            }}
          >
            {groups.map(({ group, tasks }) => (
              <box key={group} flexDirection="column" marginTop={group === groups[0]?.group ? 0 : 1}>
                <text fg={theme.dim} wrapMode="none">
                  {`${GROUP_LABEL[group]} · ${tasks.length}`}
                </text>
                {tasks.map((task) => {
                  const subject = taskTitle(task)
                  const baseFg = task.status === 'completed' ? theme.dim
                    : task.status === 'failed' ? theme.red
                    : group === 'blocked' ? theme.muted
                    : theme.text
                  const pColor = priorityColor((task as Record<string, unknown>).priority as string | undefined, theme)
                  return (
                    <box
                      key={task.id}
                      flexDirection="row"
                      paddingLeft={1}
                    >
                      <box width={glyphW}>
                        <text fg={statusColor(task.status, theme)} wrapMode="none">
                          {STATUS_GLYPH[task.status]}
                        </text>
                      </box>
                      <box width={priorityW}>
                        {(task as Record<string, unknown>).priority === 'high' ? (
                          <text fg={pColor} wrapMode="none">!</text>
                        ) : null}
                      </box>
                      <text fg={baseFg} wrapMode="none">
                        {truncate(subject, subjectW)}
                      </text>
                    </box>
                  )
                })}
              </box>
            ))}
          </scrollbox>
        )}
      </box>
    </box>
  )
}

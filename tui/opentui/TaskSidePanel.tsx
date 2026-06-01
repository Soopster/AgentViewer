/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import type { TuiThemePalette } from '../theme'
import type { ThreadedMessage, ToolThread } from '../../lib/threading'
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
  tab: 'tasks' | 'agents'
  liveSubagentText?: Record<string, string>
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

// ---------------------------------------------------------------------------
// Agent entry derived from Agent tool threads in the transcript
// ---------------------------------------------------------------------------

type AgentStatus = 'running' | 'completed' | 'failed' | 'unknown'

type AgentEntry = {
  id: string
  description: string
  subagentType: string
  liveText: string
  status: AgentStatus
}

function agentStatusFromResult(result: ToolThread['result']): AgentStatus {
  if (!result) return 'running'
  const raw = result.content
  const text = typeof raw === 'string' ? raw
    : Array.isArray(raw) ? (raw as Array<Record<string, unknown>>).map((c) => c.text ?? '').join('') : ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const s = parsed.status as string | undefined
    if (s === 'completed') return 'completed'
    if (s === 'failed') return 'failed'
  } catch { /* not JSON */ }
  return result ? 'unknown' : 'running'
}

function agentStatusGlyph(status: AgentStatus): string {
  if (status === 'running') return '●'
  if (status === 'completed') return '✓'
  if (status === 'failed') return '×'
  return '?'
}

function agentStatusColor(status: AgentStatus, theme: TuiThemePalette): string {
  if (status === 'running') return theme.amber
  if (status === 'completed') return theme.green
  if (status === 'failed') return theme.red
  return theme.dim
}

export function TaskSidePanel({
  messages,
  theme,
  width,
  height,
  session,
  todos: liveTodos,
  onSelectTask,
  tab,
  liveSubagentText,
}: Props) {
  // ── Tasks ────────────────────────────────────────────────────────────────
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

  // ── Agents ───────────────────────────────────────────────────────────────
  const agents = useMemo((): AgentEntry[] => {
    const seen = new Set<string>()
    const result: AgentEntry[] = []
    for (const msg of messages) {
      for (const block of msg.blocks) {
        if (block.type !== 'tool_thread' || block.toolUse.name !== 'Agent') continue
        if (seen.has(block.toolUse.id)) continue
        seen.add(block.toolUse.id)
        const input = block.toolUse.input as {
          description?: string
          subagent_type?: string
          prompt?: string
        }
        result.push({
          id: block.toolUse.id,
          description: compactText(input.description ?? input.prompt ?? ''),
          subagentType: input.subagent_type ?? '',
          liveText: liveSubagentText?.[block.toolUse.id] ?? '',
          status: agentStatusFromResult(block.result),
        })
      }
    }
    return result
  }, [messages, liveSubagentText])

  const runningAgentCount = agents.filter((a) => a.status === 'running').length
  const doneAgentCount = agents.filter((a) => a.status === 'completed').length

  // ── Layout ───────────────────────────────────────────────────────────────
  const innerW = Math.max(width - 4, 10)
  const glyphW = 2
  const priorityW = 1
  const subjectW = Math.max(innerW - glyphW - priorityW, 4)
  const agentLabelW = Math.max(innerW - glyphW, 4)

  const borderColor = tab === 'agents'
    ? (runningAgentCount > 0 ? theme.amber : doneAgentCount > 0 ? theme.green : theme.border)
    : (inProgressCount > 0 ? theme.amber : blockedCount > 0 ? theme.red : doneCount === registry.size && registry.size > 0 ? theme.green : theme.border)

  return (
    <box
      width={width}
      height={height}
      border
      borderStyle="single"
      borderColor={borderColor}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={tab === 'agents' ? ' Agents ' : ' Tasks '}
      titleAlignment="left"
    >
      {/* Tab header */}
      <box paddingX={1} paddingTop={1} flexDirection="row">
        <text
          fg={tab === 'tasks' ? theme.text : theme.dim}
          wrapMode="none"
        >
          {tab === 'tasks' ? `${registry.size}` : `${agents.length}`}
        </text>
        <text fg={theme.dim} wrapMode="none">
          {tab === 'tasks'
            ? (` task${registry.size === 1 ? '' : 's'}`)
            : (` agent${agents.length === 1 ? '' : 's'}`)}
        </text>
        {tab === 'tasks' && inProgressCount > 0 ? (
          <text fg={theme.amber} wrapMode="none">{` ·${inProgressCount}`}</text>
        ) : null}
        {tab === 'tasks' && blockedCount > 0 ? (
          <text fg={theme.red} wrapMode="none">{` !${blockedCount}`}</text>
        ) : null}
        {tab === 'tasks' && failedCount > 0 ? (
          <text fg={theme.red} wrapMode="none">{` ×${failedCount}`}</text>
        ) : null}
        {tab === 'agents' && runningAgentCount > 0 ? (
          <text fg={theme.amber} wrapMode="none">{` ●${runningAgentCount}`}</text>
        ) : null}
        <box flexGrow={1} />
        {tab === 'tasks' && pendingCount > 0 ? (
          <text fg={theme.dim} wrapMode="none">{`${pendingCount}`}</text>
        ) : null}
        {tab === 'tasks' && doneCount > 0 ? (
          <text fg={theme.green} wrapMode="none">{` ✓${doneCount}`}</text>
        ) : null}
        {tab === 'agents' && doneAgentCount > 0 ? (
          <text fg={theme.green} wrapMode="none">{`✓${doneAgentCount}`}</text>
        ) : null}
      </box>

      {/* Tab selector row */}
      <box paddingX={1} flexDirection="row">
        <text fg={tab === 'tasks' ? theme.cyan : theme.dim} wrapMode="none">tasks</text>
        <text fg={theme.dim} wrapMode="none"> · </text>
        <text fg={tab === 'agents' ? theme.cyan : theme.dim} wrapMode="none">agents</text>
        <text fg={theme.dim} wrapMode="none">  ⇧T cycle</text>
      </box>

      {/* Content */}
      <box flexGrow={1} paddingX={1} overflow="hidden">
        {tab === 'tasks' ? (
          registry.size === 0 ? (
            <text fg={theme.dim}>no tasks</text>
          ) : (
            <scrollbox
              style={{ height: height - 6 }}
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
          )
        ) : (
          agents.length === 0 ? (
            <text fg={theme.dim}>no agents</text>
          ) : (
            <scrollbox
              style={{ height: height - 6 }}
              backgroundColor={theme.surface}
              scrollY
              scrollbarOptions={{
                trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface },
              }}
            >
              {agents.map((agent) => {
                const label = agent.description
                  || (agent.subagentType ? agent.subagentType : '')
                  || 'Agent'
                const activity = agent.liveText
                  ? truncate(agent.liveText.replace(/\s+/g, ' ').trim(), agentLabelW - 4)
                  : null
                return (
                  <box key={agent.id} flexDirection="column" paddingLeft={1} marginTop={1}>
                    <box flexDirection="row">
                      <box width={glyphW}>
                        <text fg={agentStatusColor(agent.status, theme)} wrapMode="none">
                          {agentStatusGlyph(agent.status)}
                        </text>
                      </box>
                      <text
                        fg={agent.status === 'completed' ? theme.dim : agent.status === 'failed' ? theme.red : theme.text}
                        wrapMode="none"
                      >
                        {truncate(label || agent.subagentType || 'Agent', agentLabelW - glyphW)}
                      </text>
                    </box>
                    {agent.subagentType && label !== agent.subagentType ? (
                      <box paddingLeft={glyphW}>
                        <text fg={theme.dim} wrapMode="none">
                          {truncate(`[${agent.subagentType}]`, agentLabelW - glyphW)}
                        </text>
                      </box>
                    ) : null}
                    {activity ? (
                      <box paddingLeft={glyphW}>
                        <text fg={theme.dim} wrapMode="none">
                          {activity}
                        </text>
                      </box>
                    ) : null}
                  </box>
                )
              })}
            </scrollbox>
          )
        )}
      </box>
    </box>
  )
}

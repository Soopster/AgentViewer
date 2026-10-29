import type { ToolThread, ThreadedMessage } from '../../lib/threading'
import { buildTaskRegistry, parseCreatedTaskId, type TaskRegistry } from '../../lib/taskRegistry'
import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'
import { line, truncateLine, MAX_CARD_LINES } from './text'
import { normalizeToolThreadForTui, resultTextOf, resultRawTextOf } from './tools'

export const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TaskStop'])

export const OPENCODE_TASK_TOOL_NAMES = new Set(['task', 'task_status'])

const OPENCODE_TASK_STATE_TONE: Record<string, TuiTranscriptLineTone> = {
  pending: 'dim',
  running: 'thinking',
  completed: 'result_ok',
  error: 'result_error',
  cancelled: 'dim',
}

const TASK_STATUS_ICON: Record<string, string> = {
  completed: '✓',
  in_progress: '◐',
  running: '◐',
  pending: '○',
  paused: 'Ⅱ',
  failed: '×',
  stopped: '■',
  killed: '■',
  deleted: '✗',
}

type TaskListGroupKey = 'in_progress' | 'blocked' | 'paused' | 'pending' | 'failed' | 'stopped' | 'completed' | 'other'

const TASK_LIST_GROUP_ORDER: TaskListGroupKey[] = [
  'in_progress',
  'blocked',
  'paused',
  'pending',
  'failed',
  'stopped',
  'completed',
  'other',
]

const TASK_LIST_GROUP_LABEL: Record<TaskListGroupKey, string> = {
  in_progress: 'IN PROGRESS',
  blocked: 'BLOCKED',
  paused: 'PAUSED',
  pending: 'PENDING',
  failed: 'FAILED',
  stopped: 'STOPPED',
  completed: 'COMPLETED',
  other: 'OTHER',
}

type TaskItem = { id?: string; subject?: string; status?: string; owner?: string; blockedBy?: string[] }

type TaskToolInput = {
  taskId?: string
  task_id?: string
  subject?: string
  description?: string
  activeForm?: string
  status?: string
  owner?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
}

type TaskGetResult = { task?: { id?: string; subject?: string; description?: string; status?: string; blocks?: string[]; blockedBy?: string[] } | null }

type TaskCreateResult = { task?: { id?: string; subject?: string } }

type TaskUpdateResult = { success?: boolean; taskId?: string; updatedFields?: string[]; error?: string; statusChange?: { from?: string; to?: string } }

function parseTaskResultJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export type TaskActiveForms = Map<string, string>

export type TranscriptTaskContext = {
  activeForms?: TaskActiveForms
  taskRegistry?: TaskRegistry
}

/**
 * Scan a thread of messages for TaskCreate/TaskUpdate calls and build a map of
 * taskId → activeForm reflecting the most recent activeForm set for each task.
 * Used by the TaskList renderer to substitute the present-continuous form for
 * tasks that are currently in_progress.
 */
export function buildTaskActiveForms(messages: ThreadedMessage[]): TaskActiveForms {
  const map = new Map<string, string>()
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type !== 'tool_thread') continue
      const block = normalizeToolThreadForTui(b)
      const name = block.toolUse.name
      if (name === 'TaskCreate') {
        const inp = block.toolUse.input as { activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (!af || !block.result) continue
        const text = resultRawTextOf(block)
        if (!text) continue
        const id = parseCreatedTaskId(text)
        if (id) map.set(id, af)
      } else if (name === 'TaskUpdate') {
        const inp = block.toolUse.input as { taskId?: string; task_id?: string; activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        const id = inp.taskId ?? inp.task_id
        if (typeof id === 'string' && af) map.set(id, af)
      }
    }
  }
  return map
}

/**
 * Task-wide state is only consumed by TaskList cards. Avoid rebuilding both
 * full-transcript registries for the overwhelmingly common case where a
 * transcript has no TaskList result to enrich.
 */
export function buildTranscriptTaskContext(messages: ThreadedMessage[]): TranscriptTaskContext {
  const hasTaskList = messages.some((message) => message.blocks.some((block) => (
    block.type === 'tool_thread' && block.toolUse.name === 'TaskList'
  )))
  if (!hasTaskList) return {}
  return {
    activeForms: buildTaskActiveForms(messages),
    taskRegistry: buildTaskRegistry(messages),
  }
}

function parseTaskListPayload(raw: string | null | undefined): TaskItem[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as TaskItem[]
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
      return (parsed as { tasks: TaskItem[] }).tasks
    }
  } catch { /* not JSON */ }
  return null
}

function taskListGroupFor(task: TaskItem, completedSet: Set<string>): TaskListGroupKey {
  const status = task.status ?? 'pending'
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : []
  const openBlockers = blockedBy.filter((id) => !completedSet.has(id))
  if ((status === 'pending' || status === '') && openBlockers.length > 0) return 'blocked'
  if (status === 'in_progress' || status === 'running') return 'in_progress'
  if (status === 'paused') return 'paused'
  if (status === 'pending' || status === '') return 'pending'
  if (status === 'failed') return 'failed'
  if (status === 'stopped' || status === 'killed') return 'stopped'
  if (status === 'completed') return 'completed'
  return 'other'
}

function groupTaskListItems(tasks: TaskItem[], completedSet: Set<string>): Array<{ group: TaskListGroupKey; tasks: TaskItem[] }> {
  const grouped: Record<TaskListGroupKey, TaskItem[]> = {
    in_progress: [],
    blocked: [],
    paused: [],
    pending: [],
    failed: [],
    stopped: [],
    completed: [],
    other: [],
  }
  for (const task of tasks) grouped[taskListGroupFor(task, completedSet)].push(task)
  return TASK_LIST_GROUP_ORDER
    .map((group) => ({ group, tasks: grouped[group] }))
    .filter((entry) => entry.tasks.length > 0)
}

export function formatTaskTool(thread: ToolThread, expanded: boolean, activeForms?: TaskActiveForms, taskRegistry?: TaskRegistry): TuiTranscriptCardLine[] {
  const name = thread.toolUse.name
  const input = thread.toolUse.input as TaskToolInput
  const result = thread.result
  const isError = result?.is_error === true
  const raw = resultTextOf(thread)

  if (name === 'TaskCreate') {
    const subject = (input.subject ?? '').trim() || 'task'
    const createdId = parseCreatedTaskId(raw ?? '')
    const idTag = createdId ? ` #${createdId}` : ''
    const lines: TuiTranscriptCardLine[] = [
      line(`tool TaskCreate${idTag}: ${truncateLine(subject)}`, 'tool'),
    ]
    if (expanded && input.description && input.description.trim()) {
      lines.push(line(truncateLine(input.description.trim()), 'muted'))
    }
    if (expanded && input.activeForm && input.activeForm.trim()) {
      lines.push(line(`active: ${truncateLine(input.activeForm.trim())}`, 'dim'))
    }
    if (result) {
      lines.push(line(isError ? '✗ ERROR' : '✓ created', isError ? 'result_error' : 'result_ok'))
    }
    return lines
  }

  if (name === 'TaskUpdate') {
    const rawId = input.taskId ?? input.task_id ?? ''
    const id = rawId ? `#${rawId}` : ''
    const updateOut = parseTaskResultJson(raw) as TaskUpdateResult | null
    const sc = updateOut?.statusChange
    const statusPill = sc?.from && sc?.to
      ? ` → ${sc.from} → ${sc.to}${TASK_STATUS_ICON[sc.to] ? ` ${TASK_STATUS_ICON[sc.to]}` : ''}`
      : input.status
        ? ` → ${input.status}${TASK_STATUS_ICON[input.status] ? ` ${TASK_STATUS_ICON[input.status]}` : ''}`
        : ''
    const lines: TuiTranscriptCardLine[] = [
      line(`tool TaskUpdate ${id}${statusPill}`.replace(/\s+/g, ' ').trim(), 'tool'),
    ]
    if (Array.isArray(input.addBlockedBy) && input.addBlockedBy.length > 0) {
      lines.push(line(`  +blocked by ${input.addBlockedBy.map((x) => `#${x}`).join(', ')}`, 'dim'))
    }
    if (Array.isArray(input.addBlocks) && input.addBlocks.length > 0) {
      lines.push(line(`  +blocks ${input.addBlocks.map((x) => `#${x}`).join(', ')}`, 'dim'))
    }
    if (expanded && updateOut?.updatedFields && updateOut.updatedFields.length > 0) {
      lines.push(line(`changed: ${updateOut.updatedFields.join(', ')}`, 'dim'))
    }
    if (updateOut?.error) {
      lines.push(line(`✗ ${truncateLine(updateOut.error)}`, 'result_error'))
    } else if (result && isError) {
      lines.push(line('✗ ERROR', 'result_error'))
    }
    return lines
  }

  if (name === 'TaskGet') {
    const rawId = input.taskId ?? input.task_id ?? ''
    const id = rawId ? `#${rawId}` : ''
    const lines: TuiTranscriptCardLine[] = [line(`tool TaskGet ${id}`.trim(), 'tool')]
    if (isError) {
      lines.push(line('✗ ERROR', 'result_error'))
      return lines
    }
    const getOut = parseTaskResultJson(raw) as TaskGetResult | null
    const task = getOut?.task ?? null
    if (task) {
      const icon = TASK_STATUS_ICON[task.status ?? 'pending'] ?? '○'
      const subject = (task.subject ?? '').trim() || '(no subject)'
      lines.push(line(`  ${icon} ${truncateLine(subject)}`, 'muted'))
      if (expanded && task.description && task.description.trim()) {
        lines.push(line(`    ${truncateLine(task.description.trim())}`, 'dim'))
      }
      if (Array.isArray(task.blockedBy) && task.blockedBy.length > 0) {
        lines.push(line(`    ↳ blocked by ${task.blockedBy.map((x) => `#${x}`).join(', ')}`, 'dim'))
      }
      if (Array.isArray(task.blocks) && task.blocks.length > 0) {
        lines.push(line(`    ⤴ blocks ${task.blocks.map((x) => `#${x}`).join(', ')}`, 'dim'))
      }
    } else if (result) {
      lines.push(line('task not found', 'dim'))
    }
    return lines
  }

  if (name === 'TaskList') {
    const tasks = parseTaskListPayload(raw)
    const count = tasks?.length ?? 0
    const lines: TuiTranscriptCardLine[] = [
      line(`tool TaskList: ${count} task${count === 1 ? '' : 's'}`, 'tool'),
    ]
    if (isError) {
      lines.push(line('✗ ERROR', 'result_error'))
      return lines
    }
    if (tasks && tasks.length > 0) {
      const completedSet = new Set(
        tasks.filter((t) => t.status === 'completed' && t.id).map((t) => t.id as string),
      )
      const groups = groupTaskListItems(tasks, completedSet)
      let renderedTasks = 0
      const taskLimit = expanded ? Number.POSITIVE_INFINITY : Math.min(tasks.length, MAX_CARD_LINES - 1)
      for (const { group, tasks: groupTasks } of groups) {
        if (renderedTasks >= taskLimit) break
        lines.push(line(`${TASK_LIST_GROUP_LABEL[group]} · ${groupTasks.length}`, 'dim'))
        for (const t of groupTasks) {
          if (renderedTasks >= taskLimit) break
          renderedTasks += 1
          const status = t.status ?? 'pending'
          const icon = TASK_STATUS_ICON[status] ?? '○'
          const tone: TuiTranscriptLineTone = status === 'completed' ? 'dim' : 'muted'
          const idTag = t.id ? `#${t.id} ` : ''
          const registryTask = t.id ? taskRegistry?.get(t.id) : undefined
          const baseSubject = (t.subject ?? '').trim()
            || registryTask?.subject
            || registryTask?.summary
            || registryTask?.description
            || '(no subject)'
          const activeForm = (status === 'in_progress' || status === 'running') && t.id
            ? activeForms?.get(t.id) ?? registryTask?.activeForm
            : undefined
          const subject = activeForm && activeForm.trim() ? activeForm.trim() : baseSubject
          const owner = t.owner ?? registryTask?.owner
          const ownerTag = owner ? ` @${owner}` : ''
          const taskMeta = [
            registryTask && registryTask.events.length > 1 ? `${registryTask.events.length} events` : '',
            registryTask?.parentTaskId ? `from #${registryTask.parentTaskId}` : '',
            registryTask?.runIds && registryTask.runIds.length > 1 ? `run ${registryTask.runIds.length}` : '',
          ].filter(Boolean)
          const eventCount = taskMeta.join(' · ')
          lines.push(line(`${icon} ${idTag}${truncateLine(subject)}${ownerTag}`, tone))
          if (eventCount) lines.push(line(`  ${eventCount}`, 'dim'))
          if (expanded && Array.isArray(t.blockedBy)) {
            const openBlockers = t.blockedBy.filter((id) => !completedSet.has(id))
            if (openBlockers.length > 0 && status !== 'completed') {
              lines.push(line(`  ↳ blocked by ${openBlockers.map((id) => `#${id}`).join(', ')}`, 'dim'))
            }
          }
        }
      }
      if (!expanded && tasks.length > renderedTasks) {
        lines.push(line(`… ${tasks.length - renderedTasks} more`, 'dim'))
      }
    }
    return lines
  }

  if (name === 'TaskStop') {
    const rawId = input.taskId ?? input.task_id ?? ''
    const id = rawId ? `#${rawId}` : ''
    const lines: TuiTranscriptCardLine[] = [line(`tool TaskStop ${id}`.trim(), 'tool')]
    if (result) {
      lines.push(line(isError ? '✗ ERROR' : '✓ stopped', isError ? 'result_error' : 'result_ok'))
    }
    return lines
  }

  return []
}

type OpenCodeTaskParsed = {
  taskId: string | null
  state: 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | null
  bodyText: string
  isErrorBody: boolean
}

/** Parser for the `task` / `task_status` result envelope. Matches the format
 *  produced by `output()` / `backgroundOutput()` / `format()` in OpenCode's
 *  `packages/opencode/src/tool/{task,task_status}.ts`. */
function parseOpenCodeTaskResult(raw: string): OpenCodeTaskParsed {
  if (!raw) return { taskId: null, state: null, bodyText: '', isErrorBody: false }
  const idMatch = raw.match(/^task_id:\s*(\S+)/m)
  const stateMatch = raw.match(/^state:\s*(\w+)/m)
  const bodyMatch = raw.match(/<task_(result|error)>([\s\S]*?)<\/task_\1>/)
  const state = stateMatch?.[1] as OpenCodeTaskParsed['state'] | undefined
  return {
    taskId: idMatch?.[1] ?? null,
    state: state ?? null,
    bodyText: (bodyMatch?.[2] ?? '').trim(),
    isErrorBody: bodyMatch?.[1] === 'error',
  }
}

type OpenCodeTaskInput = {
  description?: string
  subagent_type?: string
  task_id?: string
  background?: boolean
  wait?: boolean
}

export function formatOpenCodeTaskTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] {
  const name = thread.toolUse.name
  const input = thread.toolUse.input as OpenCodeTaskInput
  const result = thread.result
  const isResultError = result?.is_error === true
  const raw = resultTextOf(thread) ?? ''
  const parsed = parseOpenCodeTaskResult(raw)
  const inferredState: OpenCodeTaskParsed['state'] = parsed.state
    ?? (parsed.isErrorBody || isResultError
      ? 'error'
      : result
        ? 'completed'
        : 'running')
  const isStatus = name === 'task_status'
  const description = (input.description ?? '').trim() || (isStatus ? 'task status' : 'subagent task')
  const subagentTag = input.subagent_type ? ` [@${input.subagent_type}]` : ''
  const taskId = parsed.taskId ?? input.task_id ?? ''
  const shortId = taskId ? ` #${taskId.slice(-8)}` : ''
  const bgMark = (input.background === true || (isStatus && inferredState === 'running')) ? ' ⟳' : ''
  const stateTone = OPENCODE_TASK_STATE_TONE[inferredState ?? 'pending'] ?? 'dim'
  const stateGlyph = inferredState === 'completed'
    ? '✓'
    : inferredState === 'error'
      ? '✗'
      : inferredState === 'cancelled'
        ? '■'
        : inferredState === 'running'
          ? '◐'
          : '…'

  const lines: TuiTranscriptCardLine[] = [
    line(`tool ${name}${bgMark}: ${truncateLine(description)}${subagentTag}${shortId}`, 'tool'),
    line(`${stateGlyph} ${inferredState ?? 'pending'}`, stateTone),
  ]
  if (expanded && parsed.bodyText) {
    for (const ln of parsed.bodyText.split('\n')) {
      lines.push(line(truncateLine(ln), parsed.isErrorBody ? 'result_error' : 'muted'))
    }
  }
  return lines
}

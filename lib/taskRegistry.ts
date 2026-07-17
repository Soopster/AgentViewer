import type { ClaudeSystemBlock, ThreadedMessage, ToolThread } from './threading'
import type { SystemMessagePayload, ToolResultBlock } from './types'

export type OpenCodeTodo = {
  id: string
  content: string
  status: string
  priority: string
}

export type CodexTodo = {
  id?: string
  step: string
  status: string
  activeForm?: string
}

export type TaskStatus = 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'stopped'
export type TaskEventKind = 'created' | 'updated' | 'listed' | 'read' | 'started' | 'progress' | 'notified'

export type TaskEvent = {
  kind: TaskEventKind
  uuid: string
  timestamp?: string
  status?: TaskStatus
  subject?: string
  description?: string
  summary?: string
  activeForm?: string
  owner?: string
  details?: string
  toolName?: string
}

export type TaskState = {
  id: string
  subject: string
  description?: string
  summary?: string
  activeForm?: string
  status: TaskStatus
  owner?: string
  taskType?: string
  subagentType?: string
  workflowName?: string
  /** tool_use id of the Agent/Workflow tool call that started this task — joins task events to transcript tool threads. */
  toolUseId?: string
  prompt?: string
  lastToolName?: string
  outputFile?: string
  error?: string
  totalTokens?: number
  toolUses?: number
  durationMs?: number
  pausedMs?: number
  isBackgrounded?: boolean
  blockedBy: string[]
  blocks: string[]
  firstSeenAt?: string
  lastUpdatedAt?: string
  createdEventUuid?: string
  /** UUID of the most recent ThreadedMessage that touched this task — used for jump-to-event. */
  latestEventUuid: string
  events: TaskEvent[]
}

export type TaskRegistry = Map<string, TaskState>

function resultText(result: ToolResultBlock): string {
  const content = result.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') out += text
    }
  }
  return out
}

function safeParse<T>(text: string): T | null {
  if (!text) return null
  try { return JSON.parse(text) as T } catch { return null }
}

export function parseCreatedTaskId(text: string): string | undefined {
  const parsed = safeParse<{ task?: { id?: string } }>(text)
  const jsonId = parsed?.task?.id
  if (typeof jsonId === 'string' && jsonId.trim()) return jsonId.trim()

  const created = text.match(/\bTask\s+#?([A-Za-z0-9_.:-]+)\s+created\b/i)
  if (created?.[1]) return created[1]

  const hash = text.match(/#([A-Za-z0-9_.:-]+)/)
  return hash?.[1]
}

function normalizeStatus(value: unknown): TaskStatus | undefined {
  if (value === 'pending') return 'pending'
  // Codex's TurnPlanStepStatus serializes as camelCase ("inProgress");
  // Claude/OpenCode/Pi use snake_case. Accept both.
  if (value === 'in_progress' || value === 'inProgress' || value === 'running') return 'in_progress'
  if (value === 'paused') return 'paused'
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  if (value === 'stopped' || value === 'killed' || value === 'cancelled') return 'stopped'
  return undefined
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function readStringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = cleanString(record[key])
    if (value) return value
  }
  return undefined
}

function readNumberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function addUsagePatch(patch: Patch, source: Record<string, unknown>): void {
  const usage = asRecord(source.usage)
  if (!usage) return
  const totalTokens = readNumberField(usage, 'total_tokens', 'totalTokens')
  const toolUses = readNumberField(usage, 'tool_uses', 'toolUses')
  const durationMs = readNumberField(usage, 'duration_ms', 'durationMs')
  if (totalTokens != null) patch.totalTokens = totalTokens
  if (toolUses != null) patch.toolUses = toolUses
  if (durationMs != null) patch.durationMs = durationMs
}

type CodexTodoSnapshotItem = {
  id?: string
  subject: string
  status: TaskStatus
  activeForm?: string
}

function readCodexTodoEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value

  const record = asRecord(value)
  if (!record) return []

  for (const key of ['plan', 'todos', 'tasks']) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }

  for (const key of ['arguments', 'input', 'value']) {
    const nested = typeof record[key] === 'string'
      ? safeParse<unknown>(record[key])
      : record[key]
    const entries = readCodexTodoEntries(nested)
    if (entries.length > 0) return entries
  }

  return []
}

function normalizeCodexTodoSnapshot(value: unknown): CodexTodoSnapshotItem[] {
  return readCodexTodoEntries(value).flatMap((entry) => {
    const record = asRecord(entry)
    if (!record) return []

    const subject = readStringField(record, 'step', 'content', 'subject', 'title', 'description')
    if (!subject) return []

    const status = normalizeStatus(record.status)
    if (!status) return []

    const item: CodexTodoSnapshotItem = { subject, status }
    const id = readStringField(record, 'id', 'taskId', 'task_id')
    const activeForm = readStringField(record, 'activeForm', 'active_form')
    if (id) item.id = id
    if (activeForm) item.activeForm = activeForm
    return [item]
  })
}

function parseCodexTodoMarkdown(text: string): CodexTodoSnapshotItem[] {
  if (!/\[(?: |x|X|~|-)\]/.test(text)) return []

  const planHeading = text.search(/^##\s+(?:Plan|Todos?)\s*$/im)
  if (planHeading < 0) return []

  const body = text.slice(planHeading)
  const items: CodexTodoSnapshotItem[] = []

  for (const rawLine of body.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:(?:[-*]|\d+\.)\s*)?\[( |x|X|~|-)\]\s+(.+?)\s*$/)
    if (!match) continue

    const marker = match[1]
    const subject = match[2].trim()
    if (!subject) continue

    const status: TaskStatus = marker === 'x' || marker === 'X'
      ? 'completed'
      : marker === '~' || marker === '-'
      ? 'in_progress'
      : 'pending'
    items.push({ subject, status })
  }

  return items
}

function upsertCodexTodoSnapshot(
  registry: TaskRegistry,
  items: CodexTodoSnapshotItem[],
  uuid: string,
  timestamp: string | undefined,
  idPrefix: string,
  details: string,
): void {
  const seen = new Set<string>()
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const idPart = item.id ?? String(index)
    const id = `${idPrefix}:${idPart}`
    seen.add(id)
    upsert(registry, id, {
      subject: item.subject,
      status: item.status,
      activeForm: item.activeForm,
    }, uuid, timestamp, {
      kind: 'updated',
      status: item.status,
      subject: item.subject,
      activeForm: item.activeForm,
      details,
    })
  }

  for (const id of [...registry.keys()]) {
    if (id.startsWith(`${idPrefix}:`) && !seen.has(id)) registry.delete(id)
  }
}

function uniqueIds(...lists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    if (!list) continue
    for (const id of list) {
      if (typeof id === 'string' && id && !seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

function isCodexTodoToolName(name: string): boolean {
  return name === 'update_plan' || name.endsWith('.update_plan')
}

function codexTodoIdPrefix(message: ThreadedMessage): string {
  return message.sessionId ? `codex-todo:${message.sessionId}` : 'codex-todo'
}

type Patch = Partial<Omit<TaskState, 'id' | 'latestEventUuid' | 'firstSeenAt' | 'lastUpdatedAt' | 'createdEventUuid' | 'events'>>
type EventPatch = Omit<TaskEvent, 'uuid' | 'timestamp'>

function upsert(
  registry: TaskRegistry,
  id: string,
  patch: Patch,
  uuid: string,
  timestamp?: string,
  event?: EventPatch,
): void {
  const existing = registry.get(id)
  const nextEvent: TaskEvent | null = event ? { ...event, uuid, timestamp } : null
  if (existing) {
    registry.set(id, {
      ...existing,
      ...patch,
      // Always retain stable id and re-merge dependency arrays explicitly via patch
      id: existing.id,
      blockedBy: patch.blockedBy ?? existing.blockedBy,
      blocks: patch.blocks ?? existing.blocks,
      createdEventUuid: existing.createdEventUuid ?? (nextEvent?.kind === 'created' ? uuid : undefined),
      latestEventUuid: uuid,
      lastUpdatedAt: timestamp ?? existing.lastUpdatedAt,
      events: nextEvent ? [...existing.events, nextEvent] : existing.events,
    })
    return
  }
  registry.set(id, {
    ...patch,
    id,
    subject: patch.subject ?? '',
    status: patch.status ?? 'pending',
    blockedBy: patch.blockedBy ?? [],
    blocks: patch.blocks ?? [],
    firstSeenAt: timestamp,
    lastUpdatedAt: timestamp,
    createdEventUuid: nextEvent?.kind === 'created' ? uuid : undefined,
    latestEventUuid: uuid,
    events: nextEvent ? [nextEvent] : [],
  })
}

function upsertFromSystemEvent(
  registry: TaskRegistry,
  payload: SystemMessagePayload,
  uuid: string,
  timestamp?: string,
): void {
  const id = readStringField(payload, 'task_id', 'taskId')
  if (!id) return

  const subtype = payload.subtype
  const patch: Patch = {}
  const existing = registry.get(id)
  const description = readStringField(payload, 'description')
  const summary = readStringField(payload, 'summary')
  const prompt = readStringField(payload, 'prompt')
  const status = normalizeStatus(payload.status)

  if (subtype === 'task_started') {
    patch.status = 'in_progress'
    if (description) patch.subject = description
    patch.description = prompt ?? description
    patch.prompt = prompt
    patch.activeForm = description
  } else if (subtype === 'task_progress') {
    patch.status = 'in_progress'
    if (!existing?.subject) patch.subject = summary ?? description
    if (description) patch.activeForm = description
    if (summary) patch.summary = summary
  } else if (subtype === 'task_updated') {
    const updatePatch = asRecord(payload.patch)
    const patchStatus = normalizeStatus(updatePatch?.status)
    if (patchStatus) patch.status = patchStatus
    const patchDescription = readStringField(updatePatch ?? {}, 'description')
    if (patchDescription) {
      if (!existing?.subject) patch.subject = patchDescription
      patch.summary = patchDescription
      patch.activeForm = patchStatus === 'in_progress' ? patchDescription : existing?.activeForm
    }
    const error = readStringField(updatePatch ?? {}, 'error')
    if (error) patch.error = error
    const durationMs = readNumberField(updatePatch ?? {}, 'duration_ms', 'durationMs')
    const pausedMs = readNumberField(updatePatch ?? {}, 'total_paused_ms', 'totalPausedMs')
    if (durationMs != null) patch.durationMs = durationMs
    if (pausedMs != null) patch.pausedMs = pausedMs
    if (typeof updatePatch?.is_backgrounded === 'boolean') patch.isBackgrounded = updatePatch.is_backgrounded
  } else if (subtype === 'task_notification') {
    patch.status = status ?? 'completed'
    if (!existing?.subject && summary) patch.subject = summary
    if (summary) patch.summary = summary
    patch.outputFile = readStringField(payload, 'output_file', 'outputFile')
  } else {
    return
  }

  if (status && subtype !== 'task_started' && subtype !== 'task_progress') patch.status = status
  // Only overwrite identity fields when the event carries them — progress and
  // notification events usually omit task_type/workflow_name, and clobbering
  // them with undefined loses what task_started established.
  const taskType = readStringField(payload, 'task_type', 'taskType')
  if (taskType) patch.taskType = taskType
  const subagentType = readStringField(payload, 'subagent_type', 'subagentType')
  if (subagentType) patch.subagentType = subagentType
  const workflowName = readStringField(payload, 'workflow_name', 'workflowName')
  if (workflowName) patch.workflowName = workflowName
  const lastToolName = readStringField(payload, 'last_tool_name', 'lastToolName')
  if (lastToolName) patch.lastToolName = lastToolName
  const toolUseId = readStringField(payload, 'tool_use_id', 'toolUseId')
  if (toolUseId) patch.toolUseId = toolUseId
  addUsagePatch(patch, payload)

  const kind: TaskEventKind = subtype === 'task_started'
    ? 'started'
    : subtype === 'task_progress'
    ? 'progress'
    : subtype === 'task_updated'
    ? 'updated'
    : 'notified'
  upsert(registry, id, patch, uuid, timestamp, {
    kind,
    status: patch.status,
    subject: patch.subject,
    description: patch.description,
    summary: patch.summary,
    activeForm: patch.activeForm,
    details: patch.summary ?? patch.description ?? patch.activeForm ?? patch.error,
    toolName: patch.lastToolName,
  })
}

/**
 * Walk a threaded message list and reconstruct the current state of every task
 * the agent has touched. Tasks are derived from Claude Agent SDK task tools,
 * Codex TODO snapshots (`update_plan` / plan text), and provider system events.
 *
 * The result reflects every event seen up to the end of the message list, with
 * each task's `latestEventUuid` pointing at the most recent message that
 * touched it — useful for scrolling the transcript to a task's last activity.
 */
export function buildTaskRegistry(messages: ThreadedMessage[]): TaskRegistry {
  const registry: TaskRegistry = new Map()

  for (const message of messages) {
    for (const block of message.blocks) {
      const uuid = message.uuid
      const ts = message.timestamp

      if (block.type === 'claude_system') {
        upsertFromSystemEvent(registry, (block as ClaudeSystemBlock).payload, uuid, ts)
        continue
      }

      if (message.provider === 'codex' && block.type === 'text') {
        const items = parseCodexTodoMarkdown(block.text)
        if (items.length > 0) {
          upsertCodexTodoSnapshot(
            registry,
            items,
            uuid,
            ts,
            codexTodoIdPrefix(message),
            'Codex Todos',
          )
        }
        continue
      }

      if (block.type !== 'tool_thread') continue
      const thread = block as ToolThread
      const name = thread.toolUse.name

      if (name === 'TaskCreate') {
        const inp = thread.toolUse.input
        if (!thread.result) continue
        const raw = resultText(thread.result)
        const id = parseCreatedTaskId(raw)
        if (typeof id !== 'string' || !id) continue
        const subject = readStringField(inp, 'subject', 'task_subject', 'title')
        const description = readStringField(inp, 'description', 'task_description')
        const activeForm = readStringField(inp, 'activeForm', 'active_form')
        upsert(registry, id, {
          subject,
          description,
          activeForm,
          status: 'pending',
        }, uuid, ts, {
          kind: 'created',
          status: 'pending',
          subject,
          description,
          activeForm,
          details: cleanString(raw),
        })
        continue
      }

      if (name === 'TaskUpdate') {
        const inp = thread.toolUse.input
        const id = readStringField(inp, 'taskId', 'task_id')
        if (typeof id !== 'string' || !id) continue

        // The SDK uses status='deleted' to drop a task. Honor it by removing
        // from the registry so the panel doesn't keep showing stale entries.
        if (inp.status === 'deleted') {
          registry.delete(id)
          continue
        }

        const patch: Patch = {}
        const subject = readStringField(inp, 'subject', 'task_subject', 'title')
        const description = readStringField(inp, 'description', 'task_description')
        const activeForm = readStringField(inp, 'activeForm', 'active_form')
        const owner = readStringField(inp, 'owner', 'assignee')
        if (subject) patch.subject = subject
        if ('description' in inp || 'task_description' in inp) patch.description = description
        if ('activeForm' in inp || 'active_form' in inp) patch.activeForm = activeForm
        const inputStatus = normalizeStatus(inp.status)
        if (inputStatus) patch.status = inputStatus
        if ('owner' in inp || 'assignee' in inp) patch.owner = owner

        const existing = registry.get(id)
        if (Array.isArray(inp.addBlocks) && inp.addBlocks.length > 0) {
          patch.blocks = uniqueIds(existing?.blocks, inp.addBlocks)
        }
        if (Array.isArray(inp.addBlockedBy) && inp.addBlockedBy.length > 0) {
          patch.blockedBy = uniqueIds(existing?.blockedBy, inp.addBlockedBy)
        }

        // statusChange from the result is more authoritative than input.status,
        // because the SDK clamps invalid transitions.
        const raw = thread.result ? resultText(thread.result) : ''
        if (raw) {
          const out = safeParse<{ statusChange?: { to?: string } }>(raw)
          const resultStatus = normalizeStatus(out?.statusChange?.to)
          if (resultStatus) patch.status = resultStatus
        }

        upsert(registry, id, patch, uuid, ts, {
          kind: 'updated',
          status: patch.status,
          subject: patch.subject,
          description: patch.description,
          activeForm: patch.activeForm,
          owner: patch.owner,
          details: cleanString(raw),
        })
        continue
      }

      if (name === 'TaskList') {
        if (!thread.result) continue
        const parsed = safeParse<unknown>(resultText(thread.result))
        const tasksArr: unknown[] = Array.isArray(parsed)
          ? parsed
          : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks))
            ? (parsed as { tasks: unknown[] }).tasks
            : []
        for (const raw of tasksArr) {
          if (!raw || typeof raw !== 'object') continue
          const t = raw as Record<string, unknown>
          const id = readStringField(t, 'id', 'taskId', 'task_id')
          if (!id) continue
          const patch: Patch = {
            blockedBy: Array.isArray(t.blockedBy)
              ? (t.blockedBy as unknown[]).filter((x): x is string => typeof x === 'string')
              : [],
          }
          const subject = readStringField(t, 'subject', 'task_subject', 'title')
          const owner = readStringField(t, 'owner', 'assignee')
          if (subject) patch.subject = subject
          const taskStatus = normalizeStatus(t.status)
          if (taskStatus) patch.status = taskStatus
          if ('owner' in t || 'assignee' in t) patch.owner = owner
          upsert(registry, id, patch, uuid, ts, {
            kind: 'listed',
            status: patch.status,
            subject,
            owner,
            details: 'TaskList snapshot',
          })
        }
        continue
      }

      if (name === 'TaskGet') {
        if (!thread.result) continue
        const parsed = safeParse<{ task?: { id?: string; subject?: string; description?: string; status?: string; blocks?: string[]; blockedBy?: string[] } | null }>(resultText(thread.result))
        const task = parsed?.task
        if (!task || typeof task.id !== 'string' || !task.id) continue
        const patch: Patch = {}
        const subject = readStringField(task, 'subject', 'task_subject', 'title')
        if (subject) patch.subject = subject
        if ('description' in task) patch.description = cleanString(task.description)
        const taskStatus = normalizeStatus(task.status)
        if (taskStatus) patch.status = taskStatus
        if (Array.isArray(task.blocks)) {
          patch.blocks = task.blocks.filter((x): x is string => typeof x === 'string')
        }
        if (Array.isArray(task.blockedBy)) {
          patch.blockedBy = task.blockedBy.filter((x): x is string => typeof x === 'string')
        }
        upsert(registry, task.id, patch, uuid, ts, {
          kind: 'read',
          status: patch.status,
          subject,
          description: patch.description,
          details: 'TaskGet',
        })
        continue
      }

      if (message.provider === 'codex' && isCodexTodoToolName(name)) {
        upsertCodexTodoSnapshot(
          registry,
          normalizeCodexTodoSnapshot(thread.toolUse.input),
          uuid,
          ts,
          codexTodoIdPrefix(message),
          'Codex update_plan',
        )
        continue
      }

      if (name === 'TodoWrite') {
        const inp = thread.toolUse.input as { todos?: Array<{ content: string; status: string; activeForm?: string }> }
        const todos = inp.todos ?? []
        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i]
          if (!todo.content) continue
          const id = `todo:${uuid}:${i}`
          const status = normalizeStatus(todo.status)
          if (!status) continue
          upsert(registry, id, {
            subject: todo.content,
            status,
            activeForm: todo.activeForm,
          }, uuid, ts, {
            kind: 'created',
            status,
            subject: todo.content,
            activeForm: todo.activeForm,
            details: 'TodoWrite',
          })
        }
        continue
      }
    }
  }

  return registry
}

export type CodexPlanStep = CodexTodo

/**
 * Builds a TaskRegistry from Codex TODO snapshots (`turn/plan/updated` and
 * `update_plan`). Codex reports a flat list of steps with simple statuses
 * (pending / inProgress / completed).
 */
export function buildTaskRegistryFromCodexPlan(steps: CodexPlanStep[]): TaskRegistry {
  const registry: TaskRegistry = new Map()
  upsertCodexTodoSnapshot(
    registry,
    normalizeCodexTodoSnapshot({ plan: steps }),
    'codex-todos',
    undefined,
    'codex-todo',
    'Codex Todos',
  )
  return registry
}

/**
 * Builds a TaskRegistry from OpenCode session-level todos (from todo.updated events).
 * These are the canonical live todo list for an OpenCode session.
 */
export function buildTaskRegistryFromTodos(todos: OpenCodeTodo[]): TaskRegistry {
  const registry: TaskRegistry = new Map()
  for (const todo of todos) {
    const subject = todo.content
    const status = normalizeStatus(todo.status) ?? (
      todo.status === 'cancelled' ? 'stopped' as TaskStatus : undefined
    )
    if (!status) continue
    upsert(registry, todo.id, {
      subject,
      status,
    }, `todo:${todo.id}`, undefined, {
      kind: 'updated',
      status,
      subject,
      details: `priority: ${todo.priority}`,
    })
  }
  return registry
}

export type TaskGroup = 'in_progress' | 'blocked' | 'paused' | 'pending' | 'failed' | 'stopped' | 'completed'

/**
 * Rollup of one Claude dynamic Workflow run (the Workflow tool). Workflow runs
 * arrive as SDK background tasks with task_type 'local_workflow' plus the
 * script's meta.name in workflow_name; their spawned agents are separate tasks
 * that share the same workflow_name.
 */
export type WorkflowRunSummary = {
  /** SDK task id of the workflow run (`wf_…`) — valid for stopTask(). */
  id: string
  name: string
  status: TaskStatus
  /** Latest progress line reported by the run. */
  activity?: string
  error?: string
  agentTotal: number
  agentRunning: number
  agentCompleted: number
  agentFailed: number
  totalTokens?: number
  toolUses?: number
  durationMs?: number
  isStoppable: boolean
  latestEventUuid: string
}

function isWorkflowTask(task: TaskState): boolean {
  return task.taskType === 'local_workflow' || task.taskType === 'workflow'
}

/**
 * Separate Claude dynamic Workflow runs from ordinary tasks. `workflows`
 * carries one rollup per run (status, spawned-agent counts, usage);
 * `rest` is the registry without the workflow tasks themselves, ready for
 * groupAndSortTasks so runs don't render twice. Agent tasks stay in `rest` —
 * they are real work rows — but are counted into their run's rollup.
 */
export function splitWorkflowTasks(registry: TaskRegistry): { workflows: WorkflowRunSummary[]; rest: TaskRegistry } {
  const workflowTasks = [...registry.values()].filter(isWorkflowTask)
  if (workflowTasks.length === 0) return { workflows: [], rest: registry }

  const rest: TaskRegistry = new Map()
  for (const [id, task] of registry) {
    if (!isWorkflowTask(task)) rest.set(id, task)
  }

  const workflows = workflowTasks.map((task) => {
    let agentTotal = 0
    let agentRunning = 0
    let agentCompleted = 0
    let agentFailed = 0
    if (task.workflowName) {
      for (const other of rest.values()) {
        if (other.workflowName !== task.workflowName) continue
        agentTotal += 1
        if (other.status === 'in_progress' || other.status === 'pending' || other.status === 'paused') agentRunning += 1
        else if (other.status === 'completed') agentCompleted += 1
        else agentFailed += 1
      }
    }
    return {
      id: task.id,
      name: task.workflowName || compactTaskText(task.subject) || `#${task.id}`,
      status: task.status,
      activity: compactTaskText(
        task.status === 'in_progress'
          ? task.activeForm ?? task.summary ?? task.description
          : task.summary ?? task.description,
      ) || undefined,
      error: task.error,
      agentTotal,
      agentRunning,
      agentCompleted,
      agentFailed,
      totalTokens: task.totalTokens,
      toolUses: task.toolUses,
      durationMs: task.durationMs,
      isStoppable: isStoppableTask(task),
      latestEventUuid: task.latestEventUuid,
    }
  })
  return { workflows, rest }
}

function compactTaskText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

// Event kinds emitted only by the Claude Agent SDK background-task stream
// (task_started/task_progress/task_notification). Todo-list tasks parsed from
// Task-tool input never carry these, so the presence of one means `task.id` is
// a real SDK task_id that `query.stopTask()` can act on. ('updated' is shared
// with the todo path, so it is deliberately excluded.)
const SDK_TASK_EVENT_KINDS: ReadonlySet<TaskEventKind> = new Set(['started', 'progress', 'notified'])

/**
 * True for a still-running Claude SDK background task — the only kind
 * `query.stopTask(taskId)` can cancel. Todo-list entries and already-finished
 * tasks return false. Drives the "stop" affordance in the task panel.
 */
export function isStoppableTask(task: TaskState): boolean {
  if (task.status !== 'in_progress' && task.status !== 'paused') return false
  return task.events.some((event) => SDK_TASK_EVENT_KINDS.has(event.kind))
}

/**
 * Sort tasks for display: in_progress first, then pending tasks with open
 * blockers, then plain pending, then completed. Within a group, sort by most
 * recent activity (descending).
 */
export function groupAndSortTasks(registry: TaskRegistry): Array<{ group: TaskGroup; tasks: TaskState[] }> {
  const completedIds = new Set<string>()
  for (const t of registry.values()) {
    if (t.status === 'completed') completedIds.add(t.id)
  }
  const groups: Record<TaskGroup, TaskState[]> = {
    in_progress: [],
    blocked: [],
    paused: [],
    pending: [],
    failed: [],
    stopped: [],
    completed: [],
  }
  for (const t of registry.values()) {
    if (t.status === 'in_progress') {
      groups.in_progress.push(t)
    } else if (t.status === 'paused') {
      groups.paused.push(t)
    } else if (t.status === 'failed') {
      groups.failed.push(t)
    } else if (t.status === 'stopped') {
      groups.stopped.push(t)
    } else if (t.status === 'completed') {
      groups.completed.push(t)
    } else {
      const openBlockers = t.blockedBy.filter((id) => !completedIds.has(id))
      if (openBlockers.length > 0) groups.blocked.push(t)
      else groups.pending.push(t)
    }
  }
  const byRecency = (a: TaskState, b: TaskState) => {
    const at = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0
    const bt = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0
    return bt - at
  }
  for (const g of Object.values(groups)) g.sort(byRecency)
  const ordered: Array<{ group: TaskGroup; tasks: TaskState[] }> = [
    { group: 'in_progress', tasks: groups.in_progress },
    { group: 'blocked', tasks: groups.blocked },
    { group: 'paused', tasks: groups.paused },
    { group: 'pending', tasks: groups.pending },
    { group: 'failed', tasks: groups.failed },
    { group: 'stopped', tasks: groups.stopped },
    { group: 'completed', tasks: groups.completed },
  ]
  return ordered.filter((entry) => entry.tasks.length > 0)
}

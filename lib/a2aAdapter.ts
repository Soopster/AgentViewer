// Adapter between AgentViewer's internal Coordinator ledger (ProtocolTask /
// ProtocolRunSnapshot, SQLite-backed via lib/agentCoordination.ts) and the
// A2A Protocol 1.0 wire types already declared in lib/agentProtocol.ts.
//
// AgentViewer's Coordinator is a task-board-and-mailbox system, not a
// message-in/message-out chat agent — so the A2A operations map onto it as
// follows, and this is the intentional scope of "A2A conformance" here:
//   message/send, message/stream -> submit a new task to an existing run's
//     board (the run/contextId must already exist; this endpoint does not
//     spin up new agent subprocesses from unauthenticated network input)
//   tasks/get, tasks/list         -> read the board
//   tasks/cancel                  -> cancel a task, releasing its lock/owner
//   tasks/resubscribe             -> re-attach to a task's status stream
//   tasks/pushNotificationConfig/{set,get,list,delete} -> webhook config,
//     fired once by the same process-wide sweep timer that already runs
//     mailbox delivery (see sweepPushNotifications in agentCoordination.ts)
// The extended-card operation is not implemented (no auth model to gate it).
//
// Pure conversion + protocol-shape logic only; Node-side I/O beyond `fetch`-
// free SSE streaming stays in lib/agentCoordination.ts.

import {
  cancelProtocolTask,
  createProtocolTaskAdmin,
  deleteProtocolPushConfig,
  getProtocolPushConfig,
  listProtocolPushConfigs,
  readProtocolRun,
  setProtocolPushConfig,
} from './agentCoordination'
import { taskStateFromStatus } from './agentProtocol'
import type {
  A2AAgentCard,
  A2AArtifact,
  A2ATask,
  A2ATaskState,
  A2ATaskStatus,
  ProtocolTask,
} from './agentProtocol'

export const A2A_TERMINAL_STATES = new Set<A2ATaskState>([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
])

function resultArtifact(task: ProtocolTask): A2AArtifact | undefined {
  if (!task.resultSummary && !task.resultDetail) return undefined
  return {
    artifactId: `${task.id}-result`,
    name: 'result',
    parts: [
      { text: [task.resultSummary, task.resultDetail].filter(Boolean).join('\n\n') },
    ],
  }
}

export function protocolTaskToA2A(task: ProtocolTask): A2ATask {
  const status: A2ATaskStatus = {
    state: taskStateFromStatus(task.status),
    timestamp: task.updatedAt,
  }
  const artifact = resultArtifact(task)
  return {
    id: task.id,
    contextId: task.runId,
    status,
    artifacts: artifact ? [artifact] : undefined,
    metadata: {
      title: task.title,
      prompt: task.prompt,
      paths: task.paths,
      blockedBy: task.blockedBy,
      phase: task.phase,
      ownerAgentId: task.ownerAgentId,
    },
  }
}

function firstTextPart(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const parts = (message as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return ''
  for (const part of parts) {
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text
    }
  }
  return ''
}

/** Extracts the plain-text payload from an A2A Message, ignoring non-text parts. */
export function extractMessageText(message: unknown): string {
  return firstTextPart(message).trim()
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const title = firstLine.slice(0, 80)
  return title || 'A2A task'
}

/**
 * `message/send` / `message/stream`: submits the message text as a new task
 * on the run's board. Requires the run (A2A contextId) to already exist —
 * AgentViewer's coordinator only accepts new work into a run a user already
 * started from the web UI, TUI, or coord_create_run, never spawns one itself
 * from an inbound A2A message.
 */
export async function submitA2AMessageAsTask(runId: string, message: unknown): Promise<ProtocolTask> {
  const text = extractMessageText(message)
  if (!text) throw new Error('message.parts must include at least one text part')
  return createProtocolTaskAdmin(runId, { title: deriveTitle(text), detail: text })
}

export async function getA2ATask(runId: string, taskId: string): Promise<ProtocolTask | null> {
  const snapshot = await readProtocolRun(runId)
  return snapshot?.tasks.find((task) => task.id === taskId) ?? null
}

export async function listA2ATasks(
  runId: string,
  filter?: { status?: string },
): Promise<ProtocolTask[]> {
  const snapshot = await readProtocolRun(runId)
  if (!snapshot) throw new Error('Coordinator run not found')
  const tasks = snapshot.tasks
  if (!filter?.status) return tasks
  const wantedState = filter.status
  return tasks.filter((task) => taskStateFromStatus(task.status) === wantedState)
}

export async function cancelA2ATask(runId: string, taskId: string, reason?: string): Promise<ProtocolTask> {
  return cancelProtocolTask(runId, taskId, reason)
}

function sseChunk(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

const STREAM_POLL_MS = 750
const STREAM_MAX_MS = 5 * 60_000

/**
 * Streams `message/stream` / `tasks/resubscribe` updates as Server-Sent
 * Events: an initial `{task}` frame, then one `{statusUpdate}` frame per
 * state transition until a terminal state (or the timeout) closes the
 * stream. Polls the SQLite ledger rather than hooking the in-process
 * notifier — consistent with this app's existing 2s poll-based live-update
 * pattern (see app/page.tsx) and avoids adding cross-module event-emitter
 * surface for a single consumer.
 */
export function streamA2ATaskUpdates(
  rpcId: unknown,
  runId: string,
  taskId: string,
  initial: ProtocolTask,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      let lastState = taskStateFromStatus(initial.status)
      controller.enqueue(sseChunk({
        jsonrpc: '2.0',
        id: rpcId,
        result: { task: protocolTaskToA2A(initial) },
      }))
      if (A2A_TERMINAL_STATES.has(lastState)) {
        controller.close()
        return
      }
      const deadline = Date.now() + STREAM_MAX_MS
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS))
        const snapshot = await readProtocolRun(runId).catch(() => null)
        const task = snapshot?.tasks.find((entry) => entry.id === taskId)
        if (!task) break
        const state = taskStateFromStatus(task.status)
        if (state === lastState) continue
        lastState = state
        const final = A2A_TERMINAL_STATES.has(state)
        controller.enqueue(sseChunk({
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            statusUpdate: {
              taskId: task.id,
              contextId: task.runId,
              status: { state, timestamp: task.updatedAt },
              final,
            },
          },
        }))
        if (final) break
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  })
}

// --- JSON-RPC 2.0 dispatch (spec §3) ---
//
// Exposed at two routes that share this one handler: a per-run convenience
// path (/api/a2a/[runId], runId from the URL) and the card-advertised global
// endpoint (/api/a2a, contextId taken from the request body) — the latter is
// what makes the Agent Card's `url` a real, directly-invokable endpoint
// rather than a `{runId}` template, which the spec doesn't support.

export type A2AJsonRpcRequest = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

function rpcJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function rpcError(id: unknown, code: number, message: string, status = 200): Response {
  return rpcJson({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status)
}

function rpcResult(id: unknown, result: unknown): Response {
  return rpcJson({ jsonrpc: '2.0', id, result })
}

function contextIdFromParams(rpcParams: Record<string, unknown>): string | undefined {
  if (typeof rpcParams.contextId === 'string' && rpcParams.contextId) return rpcParams.contextId
  const message = rpcParams.message
  if (message && typeof message === 'object' && typeof (message as { contextId?: unknown }).contextId === 'string') {
    return (message as { contextId: string }).contextId
  }
  return undefined
}

/**
 * Handles one A2A JSON-RPC request. `pathRunId` comes from the URL for the
 * per-run route; omit it for the global route, where the caller must supply
 * `contextId` (or `message.contextId`) in `params` instead.
 */
export async function handleA2AJsonRpc(body: A2AJsonRpcRequest | null, pathRunId?: string): Promise<Response> {
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError((body as { id?: unknown } | null)?.id, -32600, 'Invalid Request: expected a JSON-RPC 2.0 envelope', 400)
  }
  const { id, method } = body
  const rpcParams = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>
  const runId = pathRunId ?? contextIdFromParams(rpcParams)
  if (!runId) return rpcError(id, -32602, 'contextId (Coordinator runId) is required', 400)

  try {
    if (method === 'message/send' || method === 'message/stream') {
      const task = await submitA2AMessageAsTask(runId, rpcParams.message)
      if (method === 'message/stream') return streamA2ATaskUpdates(id, runId, task.id, task)
      return rpcResult(id, { task: protocolTaskToA2A(task) })
    }

    if (method === 'tasks/get') {
      const taskId = String(rpcParams.id ?? '')
      const task = await getA2ATask(runId, taskId)
      if (!task) return rpcError(id, -32001, 'Task not found')
      return rpcResult(id, protocolTaskToA2A(task))
    }

    if (method === 'tasks/list') {
      const status = typeof rpcParams.status === 'string' ? rpcParams.status : undefined
      const tasks = await listA2ATasks(runId, { status })
      return rpcResult(id, { tasks: tasks.map(protocolTaskToA2A) })
    }

    if (method === 'tasks/cancel') {
      const taskId = String(rpcParams.id ?? '')
      const reason = typeof rpcParams.reason === 'string' ? rpcParams.reason : undefined
      const task = await cancelA2ATask(runId, taskId, reason)
      return rpcResult(id, protocolTaskToA2A(task))
    }

    if (method === 'tasks/resubscribe') {
      const taskId = String(rpcParams.id ?? '')
      const task = await getA2ATask(runId, taskId)
      if (!task) return rpcError(id, -32001, 'Task not found')
      return streamA2ATaskUpdates(id, runId, task.id, task)
    }

    // Field names below are AgentViewer's best-effort interpretation of the
    // spec's PushNotificationConfig operations (§3.1.7-10): {taskId, config}
    // for set, {taskId, id} for get/delete, {taskId} for list. Fired once,
    // by sweepPushNotifications, when the task reaches a terminal state.
    if (method === 'tasks/pushNotificationConfig/set') {
      const taskId = String(rpcParams.taskId ?? '')
      const config = (rpcParams.pushNotificationConfig ?? rpcParams.config ?? {}) as Record<string, unknown>
      const url = typeof config.url === 'string' ? config.url : ''
      const token = typeof config.token === 'string' ? config.token : undefined
      const configId = typeof config.id === 'string' ? config.id : undefined
      const saved = await setProtocolPushConfig(runId, taskId, { url, token, id: configId })
      return rpcResult(id, { taskId, pushNotificationConfig: saved })
    }

    if (method === 'tasks/pushNotificationConfig/get') {
      const taskId = String(rpcParams.taskId ?? '')
      const configId = String(rpcParams.id ?? rpcParams.pushNotificationConfigId ?? '')
      const config = await getProtocolPushConfig(runId, taskId, configId)
      if (!config) return rpcError(id, -32001, 'Push notification config not found')
      return rpcResult(id, { taskId, pushNotificationConfig: config })
    }

    if (method === 'tasks/pushNotificationConfig/list') {
      const taskId = String(rpcParams.taskId ?? '')
      const configs = await listProtocolPushConfigs(runId, taskId)
      return rpcResult(id, { configs: configs.map((config) => ({ taskId, pushNotificationConfig: config })) })
    }

    if (method === 'tasks/pushNotificationConfig/delete') {
      const taskId = String(rpcParams.taskId ?? '')
      const configId = String(rpcParams.id ?? rpcParams.pushNotificationConfigId ?? '')
      const deleted = await deleteProtocolPushConfig(runId, taskId, configId)
      if (!deleted) return rpcError(id, -32001, 'Push notification config not found')
      return rpcResult(id, {})
    }

    return rpcError(id, -32601, `Method not found: ${method}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Coordinator error'
    const code = /not found/i.test(message) ? -32001 : -32000
    return rpcError(id, code, message)
  }
}

export function buildCoordinatorAgentCard(baseUrl: string): A2AAgentCard {
  return {
    protocolVersion: '0.3.0',
    name: 'agent-viewer-coordinator',
    description: 'Multi-CLI task-board coordinator for Claude, Codex, OpenCode, Copilot, and Pi. '
      + 'Submits messages as tasks onto an existing Coordinator run’s board (pass its id as '
      + '`contextId` on message/send, or `id` on tasks/get|list|cancel|resubscribe); does not '
      + 'start new runs or spawn agent processes from inbound A2A messages.',
    url: `${baseUrl}/api/a2a`,
    preferredTransport: 'JSONRPC',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'submit-task',
        name: 'Submit task to Coordinator run',
        description: 'Adds a message as a new task on an existing multi-agent Coordinator run’s '
          + 'board, where any teammate CLI (Claude/Codex/OpenCode/Copilot/Pi) can claim and complete it.',
        tags: ['coordination', 'multi-agent', 'task-board'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
  }
}

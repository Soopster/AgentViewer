// A gated A2A 1.0 JSON-RPC facade over the SQLite-backed Coordinator core.
// CLI agents continue to use coord_* MCP tools and the app continues to use
// persistent AHP sessions internally; this module is only the external wire
// adapter. It never starts a Coordinator run or launches an agent process.

import {
  cancelProtocolTask,
  createProtocolTaskAdmin,
  deleteProtocolPushConfig,
  getProtocolPushConfig,
  listProtocolPushConfigs,
  listProtocolTasksForFacade,
  readProtocolRun,
  setProtocolPushConfig,
} from './agentCoordination'
import type { ProtocolPushConfig } from './agentCoordination'
import { A2A_COORDINATION_EXTENSION_URI, taskStateFromStatus } from './agentProtocol'
import type {
  A2AAgentCard,
  A2AArtifact,
  A2AMessage,
  A2ATask,
  A2ATaskState,
  A2ATaskStatus,
  ProtocolTask,
  ProtocolTaskStatus,
} from './agentProtocol'

export const A2A_PROTOCOL_VERSION = '1.0' as const
export const A2A_TERMINAL_STATES = new Set<A2ATaskState>([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
])

const TASK_ID_SEPARATOR = ':'
const STREAM_POLL_MS = 750

function resultArtifact(task: ProtocolTask): A2AArtifact | undefined {
  if (!task.resultSummary && !task.resultDetail) return undefined
  return {
    artifactId: `${externalTaskId(task)}-result`,
    name: 'result',
    parts: [{ text: [task.resultSummary, task.resultDetail].filter(Boolean).join('\n\n') }],
  }
}

function externalTaskId(task: Pick<ProtocolTask, 'runId' | 'id'>): string {
  return `${task.runId}${TASK_ID_SEPARATOR}${task.id}`
}

function taskAddress(id: unknown, pathRunId?: string): { runId: string; taskId: string } | null {
  const value = typeof id === 'string' ? id.trim() : ''
  if (!value) return null
  const separator = value.lastIndexOf(TASK_ID_SEPARATOR)
  if (separator > 0 && separator < value.length - 1) {
    return { runId: value.slice(0, separator), taskId: value.slice(separator + 1) }
  }
  return pathRunId ? { runId: pathRunId, taskId: value } : null
}

function taskHistory(task: ProtocolTask, historyLength?: number): A2AMessage[] | undefined {
  if (historyLength !== undefined && historyLength <= 0) return undefined
  const history: A2AMessage[] = []
  if (task.prompt) {
    history.push({
      messageId: `${externalTaskId(task)}-request`,
      contextId: task.runId,
      taskId: externalTaskId(task),
      role: 'ROLE_USER',
      parts: [{ text: task.prompt }],
    })
  }
  const resultText = [task.resultSummary, task.resultDetail].filter(Boolean).join('\n\n')
  if (resultText) {
    history.push({
      messageId: `${externalTaskId(task)}-result`,
      contextId: task.runId,
      taskId: externalTaskId(task),
      role: 'ROLE_AGENT',
      parts: [{ text: resultText }],
    })
  }
  if (!history.length) return undefined
  return historyLength !== undefined ? history.slice(-historyLength) : history
}

export function protocolTaskToA2A(task: ProtocolTask, includeArtifacts = true, includeExtensionMetadata = true, historyLength?: number): A2ATask {
  const status: A2ATaskStatus = {
    state: taskStateFromStatus(task.status),
    timestamp: task.updatedAt,
  }
  const artifact = includeArtifacts ? resultArtifact(task) : undefined
  return {
    id: externalTaskId(task),
    contextId: task.runId,
    status,
    artifacts: artifact ? [artifact] : undefined,
    history: taskHistory(task, historyLength),
    metadata: includeExtensionMetadata ? {
      coordinatorTaskId: task.id,
      title: task.title,
      prompt: task.prompt,
      paths: task.paths,
      blockedBy: task.blockedBy,
      phase: task.phase,
      ownerAgentId: task.ownerAgentId,
    } : undefined,
  }
}

export function extractMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const parts = (message as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part): part is { text: string } => Boolean(
      part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string',
    ))
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function deriveTitle(text: string): string {
  return text.split('\n')[0]?.trim().slice(0, 80) || 'A2A task'
}

export async function submitA2AMessageAsTask(runId: string, message: unknown): Promise<ProtocolTask> {
  const candidate = message as { messageId?: unknown; role?: unknown } | null
  if (!candidate || typeof candidate.messageId !== 'string' || !candidate.messageId.trim()) {
    throw new Error('message.messageId is required')
  }
  if (candidate.role !== 'ROLE_USER') throw new Error('message.role must be ROLE_USER')
  const text = extractMessageText(message)
  if (!text) throw new Error('message.parts must include at least one text part')
  return createProtocolTaskAdmin(runId, { title: deriveTitle(text), detail: text })
}

async function getTask(address: { runId: string; taskId: string }): Promise<ProtocolTask | null> {
  const snapshot = await readProtocolRun(address.runId)
  return snapshot?.tasks.find((task) => task.id === address.taskId) ?? null
}

function statusesForState(state: string | undefined): ProtocolTaskStatus[] | undefined {
  if (!state) return undefined
  const states: ProtocolTaskStatus[] = [
    'pending', 'claimed', 'planning', 'planned', 'in_progress', 'blocked',
    'completed', 'failed', 'cancelled',
  ]
  const matches = states.filter((status) => taskStateFromStatus(status) === state)
  return matches.length ? matches : []
}

function parseHistoryLength(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('historyLength must be a non-negative integer')
  return parsed
}

function encodePageToken(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function decodePageToken(token: unknown): number {
  if (!token) return 0
  if (typeof token !== 'string') throw new Error('pageToken must be a string')
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { offset?: unknown }
    if (!Number.isInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error()
    return Number(parsed.offset)
  } catch {
    throw new Error('pageToken is invalid')
  }
}

function sseChunk(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

async function waitForTerminalTask(
  address: { runId: string; taskId: string },
  initial: ProtocolTask,
  signal?: AbortSignal,
): Promise<ProtocolTask> {
  let task = initial
  while (!A2A_TERMINAL_STATES.has(taskStateFromStatus(task.status))) {
    if (signal?.aborted) throw new Error('Request aborted')
    await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS))
    const current = await getTask(address)
    if (!current) throw new Error('Task not found')
    task = current
  }
  return task
}

export function streamA2ATaskUpdates(
  rpcId: unknown,
  address: { runId: string; taskId: string },
  initial: ProtocolTask,
  includeExtensionMetadata = true,
  historyLength?: number,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      let lastState = taskStateFromStatus(initial.status)
      controller.enqueue(sseChunk({ jsonrpc: '2.0', id: rpcId, result: { task: protocolTaskToA2A(initial, true, includeExtensionMetadata, historyLength) } }))
      if (A2A_TERMINAL_STATES.has(lastState)) {
        controller.close()
        return
      }
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS))
        const task = await getTask(address).catch(() => null)
        if (!task) break
        const state = taskStateFromStatus(task.status)
        if (state === lastState) continue
        lastState = state
        if (A2A_TERMINAL_STATES.has(state)) {
          controller.enqueue(sseChunk({ jsonrpc: '2.0', id: rpcId, result: { task: protocolTaskToA2A(task, true, includeExtensionMetadata, historyLength) } }))
          break
        }
        controller.enqueue(sseChunk({
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            statusUpdate: {
              taskId: externalTaskId(task),
              contextId: task.runId,
              status: { state, timestamp: task.updatedAt },
            },
          },
        }))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'A2A-Version': A2A_PROTOCOL_VERSION,
      Connection: 'keep-alive',
    },
  })
}

export type A2AJsonRpcRequest = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

function rpcJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'A2A-Version': A2A_PROTOCOL_VERSION,
      ...headers,
    },
  })
}

function rpcError(id: unknown, code: number, message: string, status = 200): Response {
  return rpcJson({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status)
}

function rpcResult(id: unknown, result: unknown): Response {
  return rpcJson({ jsonrpc: '2.0', id, result })
}

function contextIdFromParams(params: Record<string, unknown>): string | undefined {
  if (typeof params.contextId === 'string' && params.contextId) return params.contextId
  const message = params.message
  if (message && typeof message === 'object' && typeof (message as { contextId?: unknown }).contextId === 'string') {
    return (message as { contextId: string }).contextId
  }
  return undefined
}

function pushConfigToA2A(config: ProtocolPushConfig): Record<string, unknown> {
  return {
    id: config.id,
    taskId: externalTaskId({ runId: config.runId, id: config.taskId }),
    url: config.url,
    ...(config.token ? { token: config.token } : {}),
    ...(config.authentication ? { authentication: config.authentication } : {}),
  }
}

function validatePushUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Push notification url must be an absolute URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Push notification url must use HTTP or HTTPS')
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Push notification url must use HTTPS in production')
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.') || hostname.startsWith('169.254.')
    || hostname.startsWith('10.') || hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    throw new Error('Push notification url must not target a local or private address')
  }
  return url.toString()
}

export async function handleA2AJsonRpc(
  body: A2AJsonRpcRequest | null,
  pathRunId?: string,
  signal?: AbortSignal,
  includeExtensionMetadata = true,
): Promise<Response> {
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body?.id, -32600, 'Invalid Request: expected a JSON-RPC 2.0 envelope', 400)
  }
  const { id, method } = body
  const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>

  try {
    if (method === 'SendMessage' || method === 'SendStreamingMessage') {
      const runId = pathRunId ?? contextIdFromParams(params)
      if (!runId) return rpcError(id, -32602, 'message.contextId (Coordinator run id) is required', 400)
      const message = params.message && typeof params.message === 'object'
        ? params.message as Record<string, unknown>
        : undefined
      if (message && typeof message.taskId === 'string' && message.taskId) {
        return rpcError(id, -32004, 'Continuing an existing task through SendMessage is not supported')
      }
      const task = await submitA2AMessageAsTask(runId, params.message)
      const address = { runId, taskId: task.id }
      const configuration = params.configuration && typeof params.configuration === 'object'
        ? params.configuration as Record<string, unknown>
        : {}
      const historyLength = parseHistoryLength(configuration.historyLength)
      if (method === 'SendStreamingMessage') return streamA2ATaskUpdates(id, address, task, includeExtensionMetadata, historyLength)
      const result = configuration.returnImmediately === true
        ? task
        : await waitForTerminalTask(address, task, signal)
      return rpcResult(id, { task: protocolTaskToA2A(result, true, includeExtensionMetadata, historyLength) })
    }

    if (method === 'ListTasks') {
      const pageSizeValue = params.pageSize === undefined ? 50 : Number(params.pageSize)
      if (!Number.isInteger(pageSizeValue) || pageSizeValue < 1 || pageSizeValue > 100) {
        return rpcError(id, -32602, 'pageSize must be an integer from 1 to 100', 400)
      }
      const offset = decodePageToken(params.pageToken)
      const statuses = statusesForState(typeof params.status === 'string' ? params.status : undefined)
      if (statuses?.length === 0) return rpcError(id, -32602, 'status is not a valid TaskState', 400)
      const updatedAfter = typeof params.statusTimestampAfter === 'string' ? params.statusTimestampAfter : undefined
      if (updatedAfter && Number.isNaN(Date.parse(updatedAfter))) {
        return rpcError(id, -32602, 'statusTimestampAfter must be an ISO 8601 timestamp', 400)
      }
      const historyLength = parseHistoryLength(params.historyLength)
      const result = await listProtocolTasksForFacade({
        runId: pathRunId ?? (typeof params.contextId === 'string' ? params.contextId : undefined),
        statuses,
        updatedAfter,
        offset,
        limit: pageSizeValue,
      })
      const nextOffset = offset + result.tasks.length
      return rpcResult(id, {
        tasks: result.tasks.map((task) => protocolTaskToA2A(task, params.includeArtifacts === true, includeExtensionMetadata, historyLength)),
        nextPageToken: nextOffset < result.total ? encodePageToken(nextOffset) : '',
        pageSize: pageSizeValue,
        totalSize: result.total,
      })
    }

    if (method === 'GetTask' || method === 'CancelTask' || method === 'SubscribeToTask') {
      const address = taskAddress(params.id, pathRunId)
      if (!address) return rpcError(id, -32602, 'A globally scoped task id is required', 400)
      if (method === 'GetTask') {
      const task = await getTask(address)
      const historyLength = parseHistoryLength(params.historyLength)
      return task ? rpcResult(id, protocolTaskToA2A(task, true, includeExtensionMetadata, historyLength)) : rpcError(id, -32001, 'Task not found')
      }
      if (method === 'CancelTask') {
        const metadata = params.metadata && typeof params.metadata === 'object'
          ? params.metadata as Record<string, unknown>
          : undefined
        const reason = typeof metadata?.reason === 'string'
          ? metadata.reason
          : typeof metadata?.note === 'string'
            ? metadata.note
            : 'Cancelled through A2A 1.0'
        const task = await cancelProtocolTask(address.runId, address.taskId, reason)
        return rpcResult(id, protocolTaskToA2A(task, true, includeExtensionMetadata))
      }
      const task = await getTask(address)
      if (!task) return rpcError(id, -32001, 'Task not found')
      if (A2A_TERMINAL_STATES.has(taskStateFromStatus(task.status))) return rpcError(id, -32004, 'Cannot subscribe to a terminal task')
      return streamA2ATaskUpdates(id, address, task, includeExtensionMetadata)
    }

    if (method === 'CreateTaskPushNotificationConfig') {
      const address = taskAddress(params.taskId, pathRunId)
      if (!address) return rpcError(id, -32602, 'taskId is required', 400)
      const url = validatePushUrl(typeof params.url === 'string' ? params.url : '')
      const token = typeof params.token === 'string' ? params.token : undefined
      const configId = typeof params.id === 'string' ? params.id : undefined
      const authenticationValue = params.authentication && typeof params.authentication === 'object'
        ? params.authentication as Record<string, unknown>
        : undefined
      const authentication = authenticationValue && typeof authenticationValue.scheme === 'string'
        ? {
            scheme: authenticationValue.scheme,
            credentials: typeof authenticationValue.credentials === 'string'
              ? authenticationValue.credentials
              : undefined,
          }
        : undefined
      if (authenticationValue && !authentication?.scheme.trim()) {
        return rpcError(id, -32602, 'authentication.scheme is required', 400)
      }
      const saved = await setProtocolPushConfig(address.runId, address.taskId, {
        url,
        token,
        id: configId,
        authentication,
      })
      return rpcResult(id, pushConfigToA2A(saved))
    }

    if (method === 'GetTaskPushNotificationConfig') {
      const configId = typeof params.id === 'string' ? params.id : ''
      const taskAddressValue = taskAddress(params.taskId, pathRunId)
      if (!taskAddressValue) return rpcError(id, -32602, 'taskId is required', 400)
      const config = await getProtocolPushConfig(taskAddressValue.runId, taskAddressValue.taskId, configId)
      return config ? rpcResult(id, pushConfigToA2A(config)) : rpcError(id, -32001, 'Push notification config not found')
    }

    if (method === 'ListTaskPushNotificationConfigs') {
      const address = taskAddress(params.taskId, pathRunId)
      if (!address) return rpcError(id, -32602, 'taskId is required', 400)
      const configs = await listProtocolPushConfigs(address.runId, address.taskId)
      const pageSizeValue = params.pageSize === undefined ? 50 : Number(params.pageSize)
      if (!Number.isInteger(pageSizeValue) || pageSizeValue < 1 || pageSizeValue > 100) {
        return rpcError(id, -32602, 'pageSize must be an integer from 1 to 100', 400)
      }
      const offset = decodePageToken(params.pageToken)
      const page = configs.slice(offset, offset + pageSizeValue)
      const nextOffset = offset + page.length
      return rpcResult(id, {
        configs: page.map(pushConfigToA2A),
        nextPageToken: nextOffset < configs.length ? encodePageToken(nextOffset) : '',
      })
    }

    if (method === 'DeleteTaskPushNotificationConfig') {
      const configId = typeof params.id === 'string' ? params.id : ''
      const taskAddressValue = taskAddress(params.taskId, pathRunId)
      if (!taskAddressValue) return rpcError(id, -32602, 'taskId is required', 400)
      const deleted = await deleteProtocolPushConfig(taskAddressValue.runId, taskAddressValue.taskId, configId)
      void deleted
      return rpcResult(id, {})
    }

    if (method === 'GetExtendedAgentCard') return rpcError(id, -32007, 'Extended Agent Card is not configured')
    return rpcError(id, -32601, `Method not found: ${method}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Coordinator error'
    if (/already (completed|failed|cancelled)|already TASK_STATE/i.test(message)) {
      return rpcError(id, -32002, 'Task is not cancelable')
    }
    const code = /not found/i.test(message) ? -32001 : -32602
    return rpcError(id, code, message, code === -32602 ? 400 : 200)
  }
}

export function isA2AFacadeEnabled(): boolean {
  return process.env.AGENT_VIEWER_A2A_ENABLED === '1'
}

function tokensEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let mismatch = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

export async function handleA2AHttpRequest(request: Request, pathRunId?: string): Promise<Response> {
  if (!isA2AFacadeEnabled()) return rpcJson({ error: 'Not Found' }, 404)
  const configuredToken = process.env.AGENT_VIEWER_A2A_TOKEN?.trim()
  if (!configuredToken) return rpcJson({ error: 'A2A facade is enabled but AGENT_VIEWER_A2A_TOKEN is not configured' }, 503)
  const authorization = request.headers.get('authorization') ?? ''
  const suppliedToken = /^Bearer /i.test(authorization) ? authorization.slice(7) : ''
  if (!tokensEqual(suppliedToken, configuredToken)) {
    return rpcJson({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return rpcError(null, -32005, 'Content type not supported', 415)
  }
  const body = await request.json().catch(() => null) as A2AJsonRpcRequest | null
  if (!body) return rpcError(null, -32700, 'Parse error', 400)
  if (request.headers.get('a2a-version') !== A2A_PROTOCOL_VERSION) {
    return rpcError(body.id, -32009, `A2A-Version ${A2A_PROTOCOL_VERSION} is required`, 400)
  }
  const extensionsHeader = request.headers.get('a2a-extensions')
  const includeExtensionMetadata = extensionsHeader === null
    || extensionsHeader.split(',').map((uri) => uri.trim()).includes(A2A_COORDINATION_EXTENSION_URI)
  return handleA2AJsonRpc(body, pathRunId, request.signal, includeExtensionMetadata)
}

export function buildCoordinatorAgentCard(baseUrl: string): A2AAgentCard {
  const origin = baseUrl.replace(/\/$/, '')
  return {
    name: 'agent-viewer-coordinator',
    description: 'A gated A2A 1.0 facade over Agent Viewer Coordinator. It submits work to an existing '
      + 'durable run; CLI hosts continue to use MCP and the Coordinator retains persistent AHP internally.',
    supportedInterfaces: [
      { url: `${origin}/api/a2a`, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION },
    ],
    version: '1.0.0',
    documentationUrl: 'https://github.com/Soopster/AgentViewer',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extendedAgentCard: false,
      extensions: [{
        uri: A2A_COORDINATION_EXTENSION_URI,
        description: 'Coordinator task-board metadata exposed on A2A Task objects.',
        required: false,
      }],
    },
    securitySchemes: {
      bearerAuth: {
        httpAuthSecurityScheme: {
          scheme: 'Bearer',
          bearerFormat: 'opaque',
          description: 'Token configured by AGENT_VIEWER_A2A_TOKEN.',
        },
      },
    },
    securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [{
      id: 'submit-coordinator-task',
      name: 'Submit Coordinator task',
      description: 'Adds a user message as a task on an existing multi-agent Coordinator run.',
      tags: ['coordination', 'multi-agent', 'task-board'],
      examples: ['Submit this implementation objective to the existing Coordinator run identified by message.contextId.'],
      inputModes: ['text/plain'],
      outputModes: ['application/json'],
    }],
  }
}

export function handleA2AAgentCardRequest(request: Request): Response {
  if (!isA2AFacadeEnabled()) return rpcJson({ error: 'Not Found' }, 404)
  if (!process.env.AGENT_VIEWER_A2A_TOKEN?.trim()) {
    return rpcJson({ error: 'A2A facade is enabled but AGENT_VIEWER_A2A_TOKEN is not configured' }, 503)
  }
  return rpcJson(buildCoordinatorAgentCard(new URL(request.url).origin))
}

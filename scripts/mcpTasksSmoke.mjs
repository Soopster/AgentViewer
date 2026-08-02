import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

let runStatus = 'running'
let planAwaitingReview = false
let reviewedPlan = null
const daemon = createServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let value = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { value += chunk })
    request.on('end', () => resolve(value ? JSON.parse(value) : null))
  })
  response.setHeader('Content-Type', 'application/json')
  if (request.url !== '/api/agent-protocol/external') {
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
    return
  }

  const participant = {
    runId: 'run-tasks',
    agentId: 'agent-tasks',
    token: 'token-tasks',
    name: 'tasks-lead',
    role: 'lead',
    provider: 'codex',
    cwd: '/tmp/tasks',
    serverProtocolVersion: 2,
    negotiatedProtocolVersion: 2,
    capabilities: {},
  }
  const snapshot = {
    run: { id: 'run-tasks', prompt: 'durable run', status: runStatus, maxAgents: 2, leadAgentId: participant.agentId },
    agents: [participant],
    tasks: planAwaitingReview ? [{
      id: 'plan-task',
      runId: 'run-tasks',
      title: 'Implement durable workflow',
      prompt: 'Ship the task adapter',
      status: 'planned',
      targetRole: 'teammate',
      paths: [],
      blockedBy: [],
    }] : [],
    locks: [],
    messages: [],
    events: planAwaitingReview ? [{
      type: 'task.planned',
      taskId: 'plan-task',
      summary: 'Persist before returning the task handle',
      detail: 'Resume the runner after a bridge restart.',
    }] : [],
  }
  const actionable = {
    runStatus,
    claimableTasks: [],
    inboxCount: 0,
    urgentCount: 0,
    statusCount: 0,
    replyRequiredCount: 0,
    plansAwaitingReview: planAwaitingReview ? ['plan-task'] : [],
    myTask: null,
    allTasksTerminal: false,
  }
  if (body?.action === 'create_run') {
    response.end(JSON.stringify({ participant, snapshot, instructions: 'lead instructions' }))
    return
  }
  if (body?.action === 'status') {
    response.end(JSON.stringify({ snapshot, actionable, cursor: 'task-event-0', phases: [] }))
    return
  }
  if (body?.action === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, body.cursor === 'cancel-test' ? 2_000 : 100))
    response.end(JSON.stringify({
      changed: true,
      timedOut: false,
      cursor: 'task-event-1',
      snapshot,
      inbox: { messages: [], nextCursor: null },
      events: [],
      actionable,
    }))
    return
  }
  if (body?.action === 'review_plan') {
    reviewedPlan = body
    planAwaitingReview = false
    runStatus = 'completed'
    response.end(JSON.stringify({ accepted: true, snapshot, actionable }))
    return
  }
  response.end(JSON.stringify({ snapshot, actionable, cursor: 'task-event-0' }))
})

daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const address = daemon.address()
if (!address || typeof address === 'string') throw new Error('MCP Tasks smoke daemon did not bind')

const testDir = await mkdtemp(path.join(tmpdir(), 'agent-viewer-mcp-tasks-'))
const identityFile = path.join(testDir, 'identity.json')
const taskFile = path.join(testDir, 'tasks.json')
const launcher = fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url))
const taskCapabilities = { extensions: { 'io.modelcontextprotocol/tasks': {} } }
const clientInfo = { name: 'agent-viewer-mcp-tasks-smoke', version: '1.0.0' }

function envelope(capabilities = taskCapabilities) {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': clientInfo,
    'io.modelcontextprotocol/clientCapabilities': capabilities,
  }
}

async function rawClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, 'mcp', '--attach', String(address.port)],
    stderr: 'pipe',
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_IDENTITY_FILE: identityFile,
      AGENT_VIEWER_MCP_TASK_FILE: taskFile,
      AGENT_VIEWER_COORD_TRANSPORT: 'http',
    },
  })
  const pending = new Map()
  let nextId = 1
  transport.onmessage = (message) => {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    waiter.resolve(message)
  }
  transport.onerror = (error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  await transport.start()
  async function request(method, params = {}, capabilities = taskCapabilities) {
    const id = nextId++
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    await transport.send({
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: envelope(capabilities) },
    })
    return response
  }
  const discovered = await request('server/discover')
  if (!discovered.result?.capabilities?.extensions?.['io.modelcontextprotocol/tasks']) {
    throw new Error('MCP bridge did not advertise the Tasks extension')
  }
  return { transport, request }
}

async function pollTask(client, taskId, status, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await client.request('tasks/get', { taskId })
    if (response.error) throw new Error(response.error.message)
    if (response.result?.status === status) return response.result
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`MCP task ${taskId} did not reach ${status}`)
}

let client
try {
  client = await rawClient()
  const created = await client.request('tools/call', {
    name: 'coord_create_run',
    arguments: { prompt: 'durable run', name: 'tasks-lead', provider: 'codex', cwd: '/tmp/tasks' },
  })
  if (created.result?.resultType !== 'complete') throw new Error('Coordinator run was not created before task testing')

  const wait = await client.request('tools/call', {
    name: 'coord_wait',
    arguments: { cursor: 'restart-test', timeout_ms: 5_000 },
  })
  if (wait.result?.resultType !== 'task' || wait.result?.status !== 'working') {
    throw new Error('Tasks-capable coord_wait did not return a CreateTaskResult')
  }
  const restartTaskId = wait.result.taskId
  await client.transport.close()

  client = await rawClient()
  const resumed = await pollTask(client, restartTaskId, 'completed')
  if (resumed.result?.structuredContent?.cursor !== 'task-event-1') {
    throw new Error('Persisted coord_wait task did not resume with its final tool result')
  }
  if ((await stat(taskFile)).mode & 0o077) throw new Error('MCP task ledger is not mode 0600')

  const denied = await client.request('tasks/get', { taskId: restartTaskId }, { extensions: {} })
  if (denied.error?.code !== -32003) throw new Error(`tasks/get did not require per-request Tasks capability: ${JSON.stringify(denied)}`)

  const cancellable = await client.request('tools/call', {
    name: 'coord_wait',
    arguments: { cursor: 'cancel-test', timeout_ms: 5_000 },
  })
  if (cancellable.result?.resultType !== 'task') throw new Error('Cancellable wait did not create an MCP task')
  const cancelled = await client.request('tasks/cancel', { taskId: cancellable.result.taskId })
  if (cancelled.result?.resultType !== 'complete') throw new Error('tasks/cancel was not acknowledged')
  await pollTask(client, cancellable.result.taskId, 'cancelled')

  const updated = await client.request('tasks/update', {
    taskId: restartTaskId,
    inputResponses: { already_done: { action: 'accept' } },
  })
  if (updated.result?.resultType !== 'complete') throw new Error(`tasks/update was not acknowledged: ${JSON.stringify(updated)}`)

  runStatus = 'running'
  planAwaitingReview = true
  const awaited = await client.request('tools/call', { name: 'coord_await_run', arguments: {} })
  if (awaited.result?.resultType !== 'task') throw new Error('coord_await_run did not return a durable task handle')
  const inputRequired = await pollTask(client, awaited.result.taskId, 'input_required')
  const [inputKey, inputRequest] = Object.entries(inputRequired.inputRequests ?? {})[0] ?? []
  if (!inputKey || inputRequest?.method !== 'elicitation/create') {
    throw new Error('coord_await_run did not surface a plan review as input_required')
  }
  const planUpdated = await client.request('tasks/update', {
    taskId: awaited.result.taskId,
    inputResponses: {
      [inputKey]: {
        action: 'accept',
        content: { approved: true, summary: 'Plan is appropriately scoped' },
      },
    },
  })
  if (planUpdated.result?.resultType !== 'complete' || reviewedPlan?.approved !== true) {
    throw new Error('tasks/update did not apply the outstanding Coordinator plan review')
  }
  const terminal = await pollTask(client, awaited.result.taskId, 'completed')
  if (terminal.result?.structuredContent?.actionable?.runStatus !== 'completed') {
    throw new Error('coord_await_run did not return the terminal Coordinator status')
  }

  const missing = await client.request('tasks/get', { taskId: 'missing-task' })
  if (missing.error?.code !== -32602) throw new Error('Unknown MCP task did not return Invalid params')
} finally {
  await client?.transport.close().catch(() => {})
  daemon.close()
}

console.log('Durable MCP Tasks extension smoke passed')

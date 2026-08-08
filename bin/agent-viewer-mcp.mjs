#!/usr/bin/env node

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
} from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  CoordinatorAhpClient,
  coordinatorTransport,
} from './agent-viewer-ahp-client.mjs'
import {
  DurableMcpTaskStore,
  isTerminalMcpTask,
  taskSeed,
} from './agent-viewer-mcp-task-store.mjs'
import { COORDINATOR_MCP_TOOL_NAMES } from './agent-viewer-coordinator-tools.mjs'

const PROVIDERS = ['claude', 'codex', 'opencode', 'copilot', 'pi']
const EXTERNAL_COORD_PROTOCOL_VERSION = 2
const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui'
const MCP_SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'
const MCP_TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'
const COORDINATOR_APP_URI = 'ui://agent-viewer/coordinator-dashboard.html'
const COORDINATOR_SKILL_INDEX_URI = 'skill://index.json'
const COORDINATOR_SKILL_URI = 'skill://coordinate-agents/SKILL.md'
const coordinatorAppHtml = await readFile(new URL('./agent-viewer-coordinator-app.html', import.meta.url), 'utf8')
const coordinatorSkillMarkdown = await readFile(new URL('../.agents/skills/coordinate-agents/SKILL.md', import.meta.url), 'utf8')
const coordinatorSkillDescription = coordinatorSkillMarkdown.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  ?? 'Operate an Agent Viewer Coordinator run through the agent-viewer MCP.'
const DEFAULT_MCP_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_MCP_TASK_POLL_INTERVAL_MS = 2_000
const MISSING_REQUIRED_TASK_CAPABILITY = -32003
const MCP_TASK_METHODS = new Set(['tasks/get', 'tasks/update', 'tasks/cancel'])
const taskStores = new Map()
const taskRunners = new Map()
const IDEMPOTENT_COORDINATOR_ACTIONS = new Set([
  'claim_task',
  'complete_task',
  'create_task',
  'fail_task',
  'finalize_run',
  'finding',
  'handoff_task',
  'progress',
  'read_inbox',
  'release_task',
  'request_locks',
  'review_plan',
  'save_playbook',
  'send_message',
  'submit_plan',
])
const requestIdField = z.string().min(1).max(160).optional().describe('Stable idempotency key; the bridge generates one when omitted, or reuse your explicit value across separate retries')
const baseUrl = normalizeBaseUrl(
  process.env.AGENT_VIEWER_MCP_URL
    ?? process.env.AGENT_VIEWER_ATTACH
    ?? 'http://127.0.0.1:3000',
)
const bridgeCwd = process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd()
const ahpClient = new CoordinatorAhpClient({
  attachUrl: baseUrl,
  title: 'Agent Viewer MCP bridge',
})
let coordinatorCursor = null
let coordinatorIdentityFile = process.env.AGENT_VIEWER_COORD_IDENTITY_FILE?.trim() || null
let coordinatorIdentity = (() => {
  const runId = process.env.AGENT_VIEWER_COORD_RUN_ID?.trim()
  const agentId = process.env.AGENT_VIEWER_COORD_AGENT_ID?.trim()
  const token = process.env.AGENT_VIEWER_COORD_TOKEN?.trim()
  return runId && agentId && token ? { runId, agentId, token } : null
})()

function coordinatorNegotiation() {
  return {
    client: { name: 'agent-viewer-mcp', version: '1.3.0', protocolVersion: EXTERNAL_COORD_PROTOCOL_VERSION },
    capabilities: {
      unattended: process.env.AGENT_VIEWER_COORD_WORKER === '1',
      sessionResume: true,
      maxParallelTasks: 1,
      tools: [...COORDINATOR_MCP_TOOL_NAMES],
    },
  }
}

if (!coordinatorIdentity && coordinatorIdentityFile) {
  try {
    const saved = JSON.parse(await readFile(coordinatorIdentityFile, 'utf8'))
    if (saved?.runId && saved?.agentId && saved?.token) coordinatorIdentity = saved
  } catch {
    // coord_resume can repair a missing or invalid identity file.
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '')
  if (/^\d+$/.test(trimmed)) return `http://127.0.0.1:${trimmed}`
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`
  return trimmed
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(value && typeof value === 'object' && !Array.isArray(value)
      ? { structuredContent: value }
      : {}),
  }
}

function taskStorePath() {
  const configured = process.env.AGENT_VIEWER_MCP_TASK_FILE?.trim()
  if (configured) return path.resolve(configured)
  if (coordinatorIdentityFile) return `${coordinatorIdentityFile}.mcp-tasks.json`
  if (coordinatorIdentity) {
    return path.join(
      os.homedir(),
      '.agent-viewer',
      'coordinator',
      coordinatorIdentity.runId,
      `${coordinatorIdentity.agentId}.mcp-tasks.json`,
    )
  }
  throw new Error('Join, create, or resume a Coordinator run before creating an MCP task')
}

async function taskStore() {
  const file = taskStorePath()
  let store = taskStores.get(file)
  if (!store) {
    store = new DurableMcpTaskStore(file)
    taskStores.set(file, store)
  }
  await store.load()
  return store
}

function supportsMcpTasks(ctx) {
  const capabilities = ctx?.mcpReq?.envelope?.[CLIENT_CAPABILITIES_META_KEY]
  return Boolean(capabilities?.extensions?.[MCP_TASKS_EXTENSION])
}

function requireMcpTasks(ctx) {
  if (supportsMcpTasks(ctx)) return
  throw new ProtocolError(
    MISSING_REQUIRED_TASK_CAPABILITY,
    'Missing required client capability',
    { requiredCapabilities: { extensions: { [MCP_TASKS_EXTENSION]: {} } } },
  )
}

function coordinatorRunStatus(result) {
  return result?.actionable?.runStatus
    ?? result?.snapshot?.run?.status
    ?? result?.run?.status
    ?? null
}

function coordinatorTaskStatusMessage(result) {
  const snapshot = result?.snapshot ?? result
  const runStatus = coordinatorRunStatus(result) ?? 'unknown'
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : []
  const terminal = tasks.filter((task) => ['completed', 'failed', 'cancelled'].includes(task.status)).length
  return tasks.length > 0
    ? `Coordinator run ${runStatus}: ${terminal}/${tasks.length} tasks terminal.`
    : `Coordinator run ${runStatus}; waiting for board activity.`
}

function planReviewInput(status, taskId) {
  const snapshot = status?.snapshot ?? status
  const task = snapshot?.tasks?.find?.((entry) => entry.id === taskId)
  const plan = [...(snapshot?.events ?? [])].reverse().find((event) => (
    event.type === 'task.planned' && event.taskId === taskId
  ))
  const planText = [plan?.summary, plan?.detail].filter(Boolean).join('\n\n')
  return {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: `Review the submitted plan for ${task?.title ?? taskId}.${planText ? `\n\n${planText}` : ''}`,
      requestedSchema: {
        type: 'object',
        properties: {
          approved: { type: 'boolean', title: 'Approve plan' },
          summary: { type: 'string', title: 'Review summary' },
          detail: { type: 'string', title: 'Detailed guidance' },
        },
        required: ['approved'],
        additionalProperties: false,
      },
    },
  }
}

function taskToolError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function taskBelongsToCurrentParticipant(record) {
  return Boolean(
    coordinatorIdentity
    && record?.operation?.runId === coordinatorIdentity.runId
    && record?.operation?.agentId === coordinatorIdentity.agentId,
  )
}

async function updateTaskIfActive(store, taskId, update) {
  return store.update(taskId, (current) => (
    isTerminalMcpTask(current) ? null : (typeof update === 'function' ? update(current) : update)
  ))
}

async function runCoordinatorWaitTask(store, record) {
  const operation = record.operation
  const { snapshot: _snapshot, ...compact } = await coordinatorRequest('wait', {
    cursor: operation.cursor,
    timeoutMs: operation.timeoutMs,
  })
  await updateTaskIfActive(store, record.taskId, {
    status: 'completed',
    statusMessage: compact.timedOut
      ? 'Coordinator wait completed without a board change.'
      : 'Coordinator board activity is ready.',
    result: textResult(compact),
  })
}

async function runCoordinatorAwaitTask(store, record) {
  let cursor = record.operation.cursor
  while (true) {
    const current = await store.getRecord(record.taskId)
    if (!current || isTerminalMcpTask(current)) return

    const status = await coordinatorRequest('status')
    const runStatus = coordinatorRunStatus(status)
    if (['completed', 'failed', 'stopped'].includes(runStatus)) {
      await updateTaskIfActive(store, record.taskId, {
        status: 'completed',
        statusMessage: `Coordinator run reached terminal status ${runStatus}.`,
        result: textResult(status),
      })
      return
    }

    const plansAwaitingReview = status?.actionable?.plansAwaitingReview ?? []
    if (plansAwaitingReview.length > 0) {
      const inputRequests = {}
      const planInputTasks = {}
      for (const taskId of plansAwaitingReview) {
        const key = `plan-review:${taskId}:${randomUUID()}`
        inputRequests[key] = planReviewInput(status, taskId)
        planInputTasks[key] = taskId
      }
      await updateTaskIfActive(store, record.taskId, (task) => ({
        status: 'input_required',
        statusMessage: `${plansAwaitingReview.length} Coordinator plan review${plansAwaitingReview.length === 1 ? ' requires' : 's require'} input.`,
        inputRequests,
        operation: { ...task.operation, planInputTasks },
      }))
      return
    }

    await updateTaskIfActive(store, record.taskId, (task) => ({
      statusMessage: coordinatorTaskStatusMessage(status),
      operation: { ...task.operation, cursor: status?.cursor ?? cursor },
    }))
    cursor = status?.cursor ?? cursor

    const waited = await coordinatorRequest('wait', {
      cursor,
      timeoutMs: 25_000,
    })
    cursor = waited?.cursor ?? cursor
    await updateTaskIfActive(store, record.taskId, (task) => ({
      statusMessage: coordinatorTaskStatusMessage(waited),
      operation: { ...task.operation, cursor },
    }))
  }
}

async function runMcpTask(store, record) {
  const runnerKey = `${store.filePath}\0${record.taskId}`
  if (taskRunners.has(runnerKey) || isTerminalMcpTask(record)) return
  const runner = (async () => {
    try {
      if (!taskBelongsToCurrentParticipant(record)) {
        throw new Error('The persisted MCP task belongs to a different Coordinator participant')
      }
      if (record.operation.kind === 'coord-wait') await runCoordinatorWaitTask(store, record)
      else if (record.operation.kind === 'coord-await-run') await runCoordinatorAwaitTask(store, record)
      else throw new Error(`Unsupported persisted MCP task operation: ${record.operation.kind}`)
    } catch (error) {
      await updateTaskIfActive(store, record.taskId, {
        status: 'completed',
        statusMessage: 'The asynchronous Coordinator operation returned an error.',
        result: taskToolError(error),
      })
    }
  })().finally(() => taskRunners.delete(runnerKey))
  taskRunners.set(runnerKey, runner)
}

async function createMcpTask(operation, statusMessage, { ttlMs = DEFAULT_MCP_TASK_TTL_MS } = {}) {
  const store = await taskStore()
  if (operation.kind === 'coord-await-run') {
    const existing = await store.findActive((task) => (
      task.operation?.kind === operation.kind
      && task.operation?.runId === operation.runId
      && task.operation?.agentId === operation.agentId
    ))
    if (existing) {
      void runMcpTask(store, existing)
      return taskSeed(existing)
    }
  }
  const seed = await store.create({
    operation,
    statusMessage,
    ttlMs,
    pollIntervalMs: DEFAULT_MCP_TASK_POLL_INTERVAL_MS,
  })
  const record = await store.getRecord(seed.taskId)
  if (record) void runMcpTask(store, record)
  return seed
}

function installMcpTasksHandlers(server) {
  const protocol = server.server
  const resolveCodec = protocol._negotiatedWireCodec?.bind(protocol)
  if (!resolveCodec) throw new Error('The installed MCP server does not expose the codec seam required by ext-tasks')
  const taskCodecs = new WeakMap()
  protocol._negotiatedWireCodec = () => {
    const codec = resolveCodec()
    if (codec.era !== '2026-07-28') return codec
    let extended = taskCodecs.get(codec)
    if (!extended) {
      extended = new Proxy(codec, {
        get(target, property, receiver) {
          if (property === 'hasRequestMethod') {
            return (method) => MCP_TASK_METHODS.has(method) || target.hasRequestMethod(method)
          }
          return Reflect.get(target, property, receiver)
        },
      })
      taskCodecs.set(codec, extended)
    }
    return extended
  }

  const taskIdParams = z.object({ taskId: z.string().min(1) })
  const resultSchema = z.looseObject({})
  protocol.setRequestHandler('tasks/get', { params: taskIdParams, result: resultSchema }, async ({ taskId }, ctx) => {
    requireMcpTasks(ctx)
    const store = await taskStore()
    const record = await store.getRecord(taskId)
    if (!record) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Failed to retrieve task: Task not found')
    if (!isTerminalMcpTask(record)) void runMcpTask(store, record)
    return await store.get(taskId)
  })
  protocol.setRequestHandler('tasks/update', {
    // MCP v2 lifts inputResponses into ctx.mcpReq before custom-method
    // validation, so keep the wire field optional here and consume the lifted
    // view when Coordinator adapters begin surfacing input_required tasks.
    params: z.object({ taskId: z.string().min(1), inputResponses: z.record(z.string(), z.unknown()).optional() }),
    result: resultSchema,
  }, async ({ taskId, inputResponses: inlineInputResponses }, ctx) => {
    requireMcpTasks(ctx)
    const store = await taskStore()
    const record = await store.getRecord(taskId)
    if (!record) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Failed to update task: Task not found')
    }
    const inputResponses = ctx.mcpReq.inputResponses ?? inlineInputResponses ?? {}
    if (record.status === 'input_required') {
      const remainingRequests = { ...(record.inputRequests ?? {}) }
      const remainingPlanTasks = { ...(record.operation?.planInputTasks ?? {}) }
      for (const [key, response] of Object.entries(inputResponses)) {
        const planTaskId = remainingPlanTasks[key]
        if (!planTaskId || !remainingRequests[key]) continue
        const accepted = response?.action === 'accept'
        const content = response?.content && typeof response.content === 'object' ? response.content : {}
        await coordinatorRequest('review_plan', {
          taskId: planTaskId,
          approved: accepted && content.approved === true,
          summary: typeof content.summary === 'string' ? content.summary : undefined,
          detail: typeof content.detail === 'string' ? content.detail : undefined,
          requestId: `mcp-task-${record.taskId.slice(0, 36)}-${key.slice(-36)}`,
        })
        delete remainingRequests[key]
        delete remainingPlanTasks[key]
      }
      const hasOutstandingInput = Object.keys(remainingRequests).length > 0
      await store.update(taskId, (task) => ({
        status: hasOutstandingInput ? 'input_required' : 'working',
        statusMessage: hasOutstandingInput
          ? `${Object.keys(remainingRequests).length} Coordinator plan reviews still require input.`
          : 'Plan reviews submitted; monitoring the Coordinator run.',
        inputRequests: hasOutstandingInput ? remainingRequests : undefined,
        operation: { ...task.operation, planInputTasks: remainingPlanTasks },
      }))
      if (!hasOutstandingInput) {
        const resumed = await store.getRecord(taskId)
        if (resumed) void runMcpTask(store, resumed)
      }
    }
    // Unknown and already-satisfied keys are intentionally ignored.
    return { resultType: 'complete' }
  })
  protocol.setRequestHandler('tasks/cancel', { params: taskIdParams, result: resultSchema }, async ({ taskId }, ctx) => {
    requireMcpTasks(ctx)
    const store = await taskStore()
    if (!await store.requestCancellation(taskId)) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Failed to cancel task: Task not found')
    }
    return { resultType: 'complete' }
  })
}

async function requestJson(path, init, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload && typeof payload.error === 'string'
        ? payload.error
        : `${response.status} ${response.statusText}`
      throw new Error(`Agent Viewer request failed: ${detail}`)
    }
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Agent Viewer did not respond at ${baseUrl}`)
    }
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach Agent Viewer at ${baseUrl}. Start \`npx agent-viewer web\` first.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function resolveSessionId(value) {
  const explicit = typeof value === 'string' ? value.trim() : ''
  const configured = process.env.AGENT_VIEWER_SESSION_ID?.trim() ?? ''
  const sessionId = explicit || configured
  if (!sessionId) {
    throw new Error('session_id is required for the CLI bridge (or set AGENT_VIEWER_SESSION_ID)')
  }
  return sessionId
}

async function persistCoordinatorIdentity(participant) {
  coordinatorIdentityFile ??= path.join(
    os.homedir(),
    '.agent-viewer',
    'coordinator',
    participant.runId,
    `${participant.agentId}.json`,
  )
  await mkdir(path.dirname(coordinatorIdentityFile), { recursive: true, mode: 0o700 })
  await writeFile(coordinatorIdentityFile, `${JSON.stringify({
    runId: participant.runId,
    agentId: participant.agentId,
    token: participant.token,
  }, null, 2)}\n`, { mode: 0o600 })
  await chmod(coordinatorIdentityFile, 0o600)
}

async function bindCoordinatorParticipant(result) {
  const participant = result?.participant
  if (participant?.runId && participant?.agentId && participant?.token) {
    coordinatorIdentity = {
      runId: participant.runId,
      agentId: participant.agentId,
      token: participant.token,
    }
    coordinatorCursor = null
    await persistCoordinatorIdentity(participant)
    return {
      ...result,
      // The first model turn needs the current board, not a replay of a mature
      // run's history. Status/wait and inbox provide the incremental context.
      ...(result.snapshot ? {
        snapshot: { ...result.snapshot, messages: [], events: [] },
      } : {}),
      participant: { ...participant, token: undefined },
      identityFile: coordinatorIdentityFile,
      autonomy: `Run agent-viewer coord worker --identity ${JSON.stringify(coordinatorIdentityFile)} --attach ${JSON.stringify(baseUrl)} for unattended operation.`,
    }
  }
  return result
}

// A bound bridge speaks for exactly one participant. A confused model that
// re-joins mid-run would fork a duplicate identity and orphan the original
// (observed live: a resumed worker created a stray teammate) — refuse instead.
// A binding to a TERMINAL run is spent, not sacred: a lead that finalized one
// run must be able to create or join the next without restarting its CLI, so
// check the run's status before refusing and auto-unbind when it is finished.
async function requireUnboundBridge(tool) {
  if (!coordinatorIdentity) return
  let runStatus = null
  try {
    const status = await coordinatorRequest('status')
    runStatus = status?.actionable?.runStatus ?? status?.snapshot?.run?.status ?? null
  } catch (error) {
    // Unknown run/participant (pruned or deleted ledger rows) is a dead
    // binding; anything else (daemon unreachable) keeps the refusal below.
    if (/unknown|not found|no such/i.test(String(error?.message ?? ''))) runStatus = 'stopped'
  }
  if (['completed', 'failed', 'stopped'].includes(runStatus)) {
    coordinatorIdentity = null
    coordinatorCursor = null
    if (!process.env.AGENT_VIEWER_COORD_IDENTITY_FILE?.trim()) coordinatorIdentityFile = null
    return
  }
  throw new Error(
    `This bridge is already bound to run ${coordinatorIdentity.runId} as participant ${coordinatorIdentity.agentId}. `
    + `Use coord_status/coord_wait to continue that run; use coord_resume only to rebind explicitly. ${tool} is for unbound bridges.`,
  )
}

async function coordinatorRequest(action, payload = {}, requireIdentity = true) {
  if (requireIdentity && !coordinatorIdentity) {
    throw new Error('Join, create, or resume a Coordinator run before using participant tools')
  }
  const body = {
    ...(coordinatorIdentity ?? {}),
    ...payload,
  }
  if (IDEMPOTENT_COORDINATOR_ACTIONS.has(action) && !body.requestId) {
    body.requestId = `mcp-${randomUUID()}`
  }
  const result = coordinatorTransport() === 'http'
    ? await requestJson('/api/agent-protocol/external', {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      }, action === 'wait' ? 65_000 : 10_000)
    : await ahpClient.request(action, body, action === 'wait' ? 65_000 : 10_000)
  // status/wait return the latest event cursor; remembering it here keeps the
  // next coord_wait from waking on state this bridge has already seen.
  if (result && typeof result.cursor === 'string' && result.cursor) {
    coordinatorCursor = result.cursor
  }
  return result
}

function createMcpServer() {
const server = new McpServer(
  {
    name: 'agent-viewer',
    title: 'Agent Viewer Coordinator',
    version: '2.0.0',
    description: 'Durable multi-provider task coordination, mailboxes, path locks, session search, and transcript access.',
    websiteUrl: 'https://github.com/Soopster/AgentViewer',
  },
  {
    capabilities: {
      extensions: {
        [MCP_UI_EXTENSION]: { mimeTypes: ['text/html;profile=mcp-app'] },
        [MCP_SKILLS_EXTENSION]: {},
        [MCP_TASKS_EXTENSION]: {},
      },
    },
    cacheHints: {
      'server/discover': { ttlMs: 60_000, cacheScope: 'public' },
      'resources/list': { ttlMs: 60_000, cacheScope: 'public' },
      'resources/read': { ttlMs: 60_000, cacheScope: 'public' },
      'prompts/list': { ttlMs: 60_000, cacheScope: 'public' },
      'tools/list': { ttlMs: 5_000, cacheScope: 'private' },
    },
    instructions: [
      'Agent Viewer Coordinator is a shared multi-CLI task board and mailbox for agents from any provider (Claude, Codex, OpenCode, Copilot, Pi).',
      'Create or join a run, then read status and inbox; claim one task, lock paths before editing, report progress, and complete it or release unfinished work.',
      'Teammates run in other CLI processes and see only the board and mailbox — communicate deliberately: answer reply_required mail promptly, publish reusable discoveries with coord_publish_finding, and message teammates whose lanes your work affects.',
      'Use coord_wait instead of polling while idle, prefer coord worker for unattended runs, and never disclose participant capabilities or bypass completion gates.',
      'Coordinator calls use a persistent AHP connection by default. The bridge restores run subscriptions after disconnects and safely retries reads or idempotent mutations once.',
      'Narrate every mailbox exchange to your own terminal, one line each: "<- <sender>: <message>" on receipt, "-> <recipient>: <message>" after sending. '
        + 'Your human is watching this terminal, not the board — silence reads as dead, even mid-task.',
      'If any coord_* call throws (network error, timeout, daemon unreachable), wait ~2s and retry the SAME call — do not ask the user whether to retry, the answer is always yes. '
        + 'Keep your runId/agentId/token; do not re-create or re-join. If retries keep failing, coord_resume rebinds after the daemon or your own process comes back.',
    ].join(' '),
  },
)

installMcpTasksHandlers(server)

server.registerResource('Agent Viewer Coordinator skill index', COORDINATOR_SKILL_INDEX_URI, {
  title: 'Agent Viewer Coordinator skills',
  description: 'SEP-2640-compatible index of Agent Viewer skills available over MCP Resources.',
  mimeType: 'application/json',
  cacheHint: { ttlMs: 60_000, cacheScope: 'public' },
}, async (uri) => ({
  contents: [{
    uri: uri.href,
    mimeType: 'application/json',
    text: JSON.stringify([{
      name: 'coordinate-agents',
      description: coordinatorSkillDescription,
      type: 'skill-md',
      url: COORDINATOR_SKILL_URI,
    }]),
  }],
}))

server.registerResource('Coordinate agents skill', COORDINATOR_SKILL_URI, {
  title: 'Coordinate agents',
  description: 'Progressively disclosed operating instructions for Agent Viewer Coordinator.',
  mimeType: 'text/markdown',
  cacheHint: { ttlMs: 60_000, cacheScope: 'public' },
  _meta: {
    'io.modelcontextprotocol.skills/frontmatter': {
      name: 'coordinate-agents',
      description: coordinatorSkillDescription,
    },
  },
}, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'text/markdown', text: coordinatorSkillMarkdown }],
}))

server.registerResource('Agent Viewer Coordinator dashboard', COORDINATOR_APP_URI, {
  title: 'Coordinator dashboard',
  description: 'Interactive MCP App for inspecting the current Coordinator board returned by coord_status.',
  mimeType: 'text/html;profile=mcp-app',
  cacheHint: { ttlMs: 60_000, cacheScope: 'public' },
}, async (uri) => ({
  contents: [{
    uri: uri.href,
    mimeType: 'text/html;profile=mcp-app',
    text: coordinatorAppHtml,
    _meta: { ui: { prefersBorder: true, csp: {} } },
  }],
}))

server.registerPrompt('coordinate_agents', {
  title: 'Coordinate agents',
  description: 'Start or resume a reliable Agent Viewer Coordinator workflow.',
  argsSchema: z.object({
    objective: z.string().min(1).describe('The overall objective for the coordinated run'),
    role: z.enum(['lead', 'teammate']).optional().describe('Defaults to lead'),
  }),
}, ({ objective, role }) => ({
  description: 'Coordinator workflow prompt backed by the coordinate-agents skill resource.',
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `${role === 'teammate' ? 'Join' : 'Lead'} an Agent Viewer Coordinator run for this objective:\n\n${objective}\n\nRead ${COORDINATOR_SKILL_URI} first, then follow its task, mailbox, lock, progress, and completion rules.`,
    },
  }],
}))

server.registerTool('search_sessions', {
  description: 'Search Agent Viewer\'s persistent cross-provider session index. Returns session IDs and matching transcript snippets.',
  inputSchema: {
    query: z.string().min(1).describe('Text to search for'),
    limit: z.number().int().min(1).max(20).optional(),
    provider: z.enum(['all', ...PROVIDERS]).optional(),
    current_project_only: z.boolean().optional().describe('Restrict results to the bridge process working directory'),
  },
  annotations: { readOnlyHint: true },
}, async ({ query, limit, provider, current_project_only }) => {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit ?? 10),
    includeWorktrees: 'true',
  })
  if (provider) params.set('provider', provider)
  if (current_project_only) params.set('dir', process.cwd())
  const result = await requestJson(`/api/session-index/search?${params}`)
  return textResult({
    total: result.total,
    results: Array.isArray(result.results)
      ? result.results.map(({ session, matches }) => ({
          provider: session?.provider,
          session_id: session?.sessionId,
          title: session?.customTitle ?? session?.title,
          cwd: session?.cwd,
          matches: Array.isArray(matches)
            ? matches.map((match) => ({
                message_uuid: match.uuid,
                role: match.type,
                snippet: match.snippet,
                timestamp: match.timestamp,
              }))
            : [],
        }))
      : [],
  })
})

server.registerTool('get_session_transcript', {
  description: 'Read a session transcript from any Agent Viewer provider. Returns full-fidelity canonical messages, including text, reasoning, tool calls, tool results, and system events.',
  inputSchema: {
    session_id: z.string().min(1).optional().describe('Required unless AGENT_VIEWER_SESSION_ID is configured'),
    provider: z.enum(PROVIDERS).optional().describe('Provider returned by search_sessions; defaults to Agent Viewer\'s active provider'),
    offset: z.number().int().min(0).optional().describe('Zero-based message offset; defaults to 0'),
    limit: z.number().int().min(1).max(500).optional().describe('Messages to return; defaults to 100'),
    tail: z.boolean().optional().describe('Read the newest messages instead of starting at offset'),
  },
  annotations: { readOnlyHint: true },
}, async ({ session_id, provider, offset, limit, tail }) => {
  const sessionId = resolveSessionId(session_id)
  const params = new URLSearchParams({
    offset: String(offset ?? 0),
    limit: String(limit ?? 100),
  })
  if (provider) params.set('provider', provider)
  if (tail) params.set('tail', '1')

  const result = await requestJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`,
  )
  const messages = Array.isArray(result.messages) ? result.messages : []
  const resultOffset = Number.isFinite(result.offset) ? result.offset : (offset ?? 0)
  const total = Number.isFinite(result.total) ? result.total : resultOffset + messages.length
  const nextOffset = resultOffset + messages.length

  return textResult({
    session_id: sessionId,
    provider: provider ?? result.provider,
    offset: resultOffset,
    total,
    has_more: nextOffset < total,
    next_offset: nextOffset < total ? nextOffset : null,
    messages,
  })
})

server.registerTool('set_bookmark', {
  description: 'Add or remove a local Agent Viewer bookmark for a transcript message.',
  inputSchema: {
    message_uuid: z.string().min(1),
    session_id: z.string().optional().describe('Required unless AGENT_VIEWER_SESSION_ID is configured'),
    provider: z.enum(PROVIDERS).optional(),
    bookmarked: z.boolean().optional().describe('False removes the bookmark; defaults to true'),
    label: z.string().max(120).optional(),
    preview: z.string().max(500).optional(),
  },
}, async ({ message_uuid, session_id, provider, bookmarked, label, preview }) => {
  const sessionId = resolveSessionId(session_id)
  const result = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`, {
    method: 'POST',
    body: JSON.stringify({
      provider,
      uuid: message_uuid,
      bookmarked: bookmarked !== false,
      meta: { label, preview },
    }),
  })
  return textResult({
    session_id: sessionId,
    message_uuid,
    bookmarked: Array.isArray(result.ids) && result.ids.includes(message_uuid),
  })
})

server.registerTool('post_attention', {
  description: 'Post an item to the live Agent Viewer human-attention inbox.',
  inputSchema: {
    title: z.string().min(1).max(160),
    detail: z.string().max(1000).optional(),
    session_id: z.string().optional().describe('Required unless AGENT_VIEWER_SESSION_ID is configured'),
    provider: z.enum(PROVIDERS).optional(),
  },
}, async ({ title, detail, session_id, provider }) => {
  const sessionId = resolveSessionId(session_id)
  const result = await requestJson('/api/sessions/running', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      provider: provider ?? 'claude',
      title,
      detail,
    }),
  })
  return textResult(result.attention)
})

server.registerTool('coord_list_runs', {
  description: 'List recent Agent Viewer Coordinator runs that an external CLI can join.',
  inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  annotations: { readOnlyHint: true },
}, async ({ limit }) => {
  const result = await coordinatorRequest('list_runs', { limit: limit ?? 20 }, false)
  return textResult(result)
})

server.registerTool('coord_create_run', {
  description: 'Create a Coordinator run and bind this CLI as its lead. Seed the whole board from a saved playbook (playbook_name + args) or an inline playbook object — phases become dependency barriers and no planning turn is needed — or omit both and add tasks with coord_create_task.',
  inputSchema: {
    prompt: z.string().min(1).optional().describe('Run objective; optional when a playbook is supplied'),
    name: z.string().min(1).max(80).describe('Human-readable name for this CLI participant'),
    provider: z.enum(PROVIDERS).optional().describe('Defaults to codex'),
    max_agents: z.number().int().min(2).max(16).optional(),
    cwd: z.string().min(1).optional().describe('Working checkout; defaults to this CLI project directory'),
    gate_command: z.string().max(1000).optional(),
    require_plan_approval: z.boolean().optional(),
    playbook_name: z.string().min(1).max(64).optional().describe('Saved playbook in <cwd>/.agent-viewer/playbooks/ to seed the board from'),
    playbook: z.record(z.string(), z.unknown()).optional().describe('Inline playbook object: { name, description?, phases: [{ title, tasks: [{ key?, title, detail, paths?, dependsOn? }] }] }'),
    args: z.unknown().optional().describe('Interpolated into {{args}} / {{args.<key>}} in playbook task text'),
  },
}, async ({ prompt, name, provider, max_agents, cwd, gate_command, require_plan_approval, playbook_name, playbook, args }) => {
  await requireUnboundBridge('coord_create_run')
  const result = await bindCoordinatorParticipant(await coordinatorRequest('create_run', {
    prompt,
    name,
    provider: provider ?? 'codex',
    maxAgents: max_agents,
    cwd: cwd ?? bridgeCwd,
    gateCommand: gate_command,
    requirePlanApproval: require_plan_approval,
    playbookName: playbook_name,
    playbook,
    args,
    ...coordinatorNegotiation(),
  }, false))
  return textResult(result)
})

server.registerTool('coord_list_playbooks', {
  description: 'List saved Coordinator playbooks (reusable run definitions) for a checkout. Run one with coord_create_run playbook_name + args.',
  inputSchema: {
    cwd: z.string().min(1).optional().describe('Checkout to search; defaults to this CLI project directory'),
  },
  annotations: { readOnlyHint: true },
}, async ({ cwd }) => textResult(await coordinatorRequest('list_playbooks', { cwd: cwd ?? bridgeCwd }, false)))

server.registerTool('coord_save_playbook', {
  description: 'Lead-only: save the current run\'s task board as a reusable playbook under <run cwd>/.agent-viewer/playbooks/<name>.json, preserving phases and dependencies so the run can be replayed with coord_create_run.',
  inputSchema: {
    playbook_name: z.string().min(1).max(64).describe('Lowercase slug (a-z, 0-9, hyphens)'),
    description: z.string().max(500).optional(),
    args_hint: z.string().max(500).optional().describe('Guidance for what to pass as args when replaying'),
    request_id: requestIdField,
  },
}, async ({ playbook_name, description, args_hint, request_id }) => textResult(await coordinatorRequest('save_playbook', {
  playbookName: playbook_name,
  description,
  argsHint: args_hint,
  requestId: request_id,
})))

server.registerTool('coord_join_run', {
  description: 'Join a Coordinator run and bind this CLI as a named teammate. Omit run_id to auto-join the newest joinable run, preferring one whose checkout matches this CLI\'s project directory; use coord_list_runs first only when you need to pick between several live runs.',
  inputSchema: {
    run_id: z.string().min(1).optional().describe('Explicit run to join; omit to discover the newest joinable run for this checkout'),
    name: z.string().min(1).max(80),
    provider: z.enum(PROVIDERS).optional().describe('Defaults to codex'),
    cwd: z.string().min(1).optional().describe('Working checkout; defaults to this CLI project directory'),
  },
}, async ({ run_id, name, provider, cwd }) => {
  await requireUnboundBridge('coord_join_run')
  const result = await bindCoordinatorParticipant(await coordinatorRequest('join_run', {
    runId: run_id,
    name,
    provider: provider ?? 'codex',
    cwd: cwd ?? bridgeCwd,
    ...coordinatorNegotiation(),
  }, false))
  return textResult(result)
})

server.registerTool('coord_resume', {
  description: 'Restore this MCP bridge participant identity after reconnecting or restarting a CLI.',
  inputSchema: {
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    token: z.string().min(1),
  },
}, async ({ run_id, agent_id, token }) => {
  coordinatorIdentity = { runId: run_id, agentId: agent_id, token }
  try {
    const result = await bindCoordinatorParticipant(await coordinatorRequest('resume', coordinatorNegotiation()))
    return textResult(result)
  } catch (error) {
    coordinatorIdentity = null
    throw error
  }
})

server.registerTool('coord_status', {
  description: 'Read the shared task board, roster, locks, recent events, and an `actionable` digest (claimable tasks, inbox count, plans awaiting review, own task state) for this participant.',
  annotations: { readOnlyHint: true },
  _meta: { ui: { resourceUri: COORDINATOR_APP_URI, visibility: ['model', 'app'] } },
}, async () => textResult(await coordinatorRequest('status')))

server.registerTool('coord_wait', {
  description: 'Block until another participant changes the run (your own writes do not wake you). Returns the events that occurred plus an `actionable` digest saying what you can do now. Prefer this over repeated status polling. '
    + 'Tasks-capable MCP clients receive a durable asynchronous handle for non-zero waits; other clients retain the blocking result. An empty/timed-out result is normal — call it again. If it THROWS instead (network error, timeout), that is a real disconnect: wait ~2s and retry the same call rather than giving up or re-joining.',
  inputSchema: {
    cursor: z.string().min(1).optional().describe('Opaque cursor from the previous coord_wait; normally omit because this bridge remembers it'),
    timeout_ms: z.number().int().min(0).max(55_000).optional().describe('Defaults to 25000 milliseconds'),
  },
  annotations: { readOnlyHint: true },
}, async ({ cursor, timeout_ms }, ctx) => {
  if (supportsMcpTasks(ctx) && timeout_ms !== 0) {
    return createMcpTask({
      kind: 'coord-wait',
      runId: coordinatorIdentity?.runId,
      agentId: coordinatorIdentity?.agentId,
      cursor: cursor ?? coordinatorCursor ?? undefined,
      timeoutMs: timeout_ms,
    }, 'Waiting durably for another participant to change the Coordinator run.')
  }
  const { snapshot: _snapshot, ...compact } = await coordinatorRequest('wait', {
    cursor: cursor ?? coordinatorCursor ?? undefined,
    timeoutMs: timeout_ms,
  })
  return textResult(compact)
})

server.registerTool('coord_await_run', {
  description: 'Create a durable MCP Task that monitors this participant\'s Coordinator run until it reaches completed, failed, or stopped. '
    + 'Pending lead plan reviews surface as input_required elicitations and tasks/update applies the user\'s response. Use this for an unattended run or an external supervisor that continues working independently; interactive leads should keep acting on coord_status/coord_wait instead of passively awaiting their own work. Requires io.modelcontextprotocol/tasks.',
  inputSchema: {
    ttl_ms: z.number().int().min(60_000).max(30 * 24 * 60 * 60 * 1000).optional()
      .describe('How long the durable task handle is retained; defaults to seven days'),
  },
}, async ({ ttl_ms }, ctx) => {
  if (!supportsMcpTasks(ctx)) {
    return {
      ...textResult({
        error: 'coord_await_run requires a client request that declares io.modelcontextprotocol/tasks',
      }),
      isError: true,
    }
  }
  if (!coordinatorIdentity) {
    return {
      ...textResult({ error: 'Join, create, or resume a Coordinator run before awaiting it' }),
      isError: true,
    }
  }
  return createMcpTask({
    kind: 'coord-await-run',
    runId: coordinatorIdentity.runId,
    agentId: coordinatorIdentity.agentId,
    cursor: coordinatorCursor ?? undefined,
  }, 'Monitoring the Coordinator run until it reaches a terminal state.', {
    ttlMs: ttl_ms ?? DEFAULT_MCP_TASK_TTL_MS,
  })
})

server.registerTool('coord_create_task', {
  description: 'Add a task with dependencies and expected write paths to the shared board. Any participant may add discovered work; the lead may also add tasks during synthesis, which reopens the run. On playbook boards, pass the phase title the task belongs to so progress rollups stay accurate. '
    + 'Use role_name/role_description to give the lane a specialization — a persona the claiming teammate should adopt for this task (e.g. "Explorer" / "read-only research, report findings, propose no edits"). This is invented per task as you distribute work, not a fixed role: the same run can have an Explorer lane, a Refactorer lane, and a Reviewer lane at once, and later tasks can define new specializations entirely. '
    + 'The result includes `similarTasks` when this looks like it may duplicate existing work — not blocking, but check before assuming it\'s new.',
  inputSchema: {
    title: z.string().min(1).max(160),
    detail: z.string().min(1).max(8000),
    paths: z.array(z.string().min(1)).max(100).optional(),
    depends_on: z.array(z.string().min(1)).max(100).optional(),
    phase: z.string().min(1).max(120).optional().describe('Playbook phase title this task belongs to (rollup grouping; barriers are not re-derived mid-run)'),
    role: z.enum(['lead', 'teammate', 'any']).optional().describe('Participant role responsible for this task; defaults to teammate'),
    role_name: z.string().min(1).max(80).optional().describe('Specialization label the claiming teammate should adopt for this task, e.g. "Explorer" or "Refactorer" — your own invented persona, not a fixed enum'),
    role_description: z.string().min(1).max(1000).optional().describe('What this specialization means: scope, approach, constraints. Shown to the teammate when it works this task.'),
    request_id: requestIdField,
  },
}, async ({ title, detail, paths, depends_on, phase, role, role_name, role_description, request_id }) => textResult(await coordinatorRequest('create_task', {
  title,
  detail,
  paths,
  dependsOn: depends_on,
  phase,
  targetRole: role,
  roleName: role_name,
  roleDescription: role_description,
  requestId: request_id,
})))

server.registerTool('coord_claim_task', {
  description: 'Atomically claim a specific pending task, or the next unblocked task when task_id is omitted.',
  inputSchema: { task_id: z.string().min(1).optional(), request_id: requestIdField },
}, async ({ task_id, request_id }) => textResult(await coordinatorRequest('claim_task', { taskId: task_id, requestId: request_id })))

server.registerTool('coord_release_task', {
  description: 'Return a claimed task to the board without failing it, releasing its locks so another participant can claim it. Owners hand back work they cannot finish; the lead can also release a wedged or failed task to requeue it.',
  inputSchema: {
    task_id: z.string().min(1),
    reason: z.string().max(1000).optional(),
    request_id: requestIdField,
  },
}, async ({ task_id, reason, request_id }) => textResult(await coordinatorRequest('release_task', {
  taskId: task_id,
  reason,
  requestId: request_id,
})))

server.registerTool('coord_read_inbox', {
  description: 'Read and acknowledge direct Coordinator mailbox messages for this participant. '
    + 'Any message with replyRequired=true needs a coord_send_message reply before you do anything else — '
    + 'the sender treats silence as dropped, not busy. Print one line per message to your own terminal, '
    + '"<- <fromAgentId>: <body>" — the human watching this terminal cannot see the mailbox otherwise.',
  inputSchema: {
    after: z.string().min(1).optional().describe('Message cursor returned by the previous call'),
    limit: z.number().int().min(1).max(200).optional(),
    acknowledge: z.boolean().optional().describe('Defaults to true'),
  },
}, async ({ after, limit, acknowledge }) => textResult(await coordinatorRequest('read_inbox', {
  after,
  limit,
  acknowledge,
})))

server.registerTool('coord_send_message', {
  description: 'Send a typed direct message. Status messages are batched; reply-required requests remain actionable until answered with in_reply_to. '
    + 'The result includes `delivery`: each recipient\'s liveness (fresh/stale/dead) at send time. If stale or dead, do not assume silence means '
    + 'ignored — escalate to the lead or route around them instead of waiting on a reply that may never come. '
    + 'Print one line to your own terminal after sending, "-> <to>: <one-line summary>" — this is the only way the human watching this terminal sees you communicating.',
  inputSchema: {
    to: z.string().min(1),
    message: z.string().min(1).max(8000),
    kind: z.enum(['request', 'response', 'status', 'finding', 'handoff', 'review_request', 'review_result']).optional(),
    priority: z.enum(['urgent', 'normal', 'status']).optional(),
    reply_required: z.boolean().optional(),
    correlation_id: z.string().min(1).max(160).optional(),
    in_reply_to: z.string().min(1).optional(),
    request_id: requestIdField,
  },
}, async ({ to, message, kind, priority, reply_required, correlation_id, in_reply_to, request_id }) => textResult(await coordinatorRequest('send_message', {
  to,
  message,
  kind,
  priority,
  replyRequired: reply_required,
  correlationId: correlation_id,
  inReplyTo: in_reply_to,
  requestId: request_id,
})))

server.registerTool('coord_handoff_task', {
  description: 'Checkpoint owned work after a provider/CLI failure or bounded supervisor stop, release its locks, and return it to the board. The lead receives an urgent durable handoff.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
    failure_class: z.enum(['rate_limited', 'authentication_failed', 'context_exhausted', 'approval_blocked', 'cli_missing', 'transient_transport', 'provider_failure', 'provider_timeout', 'supervisor_stopped']),
    request_id: requestIdField,
  },
}, async ({ task_id, summary, detail, failure_class, request_id }) => textResult(await coordinatorRequest('handoff_task', {
  taskId: task_id,
  summary,
  detail,
  failureClass: failure_class,
  requestId: request_id,
})))

server.registerTool('coord_request_locks', {
  description: 'Request write locks for paths needed by the current task. Returns explicit `granted` and `denied` (with the conflicting holder) lists; do not edit paths that were denied.',
  inputSchema: { paths: z.array(z.string().min(1)).min(1).max(100), request_id: requestIdField },
}, async ({ paths, request_id }) => textResult(await coordinatorRequest('request_locks', { paths, requestId: request_id })))

server.registerTool('coord_progress', {
  description: 'Report working, idle, blocked, ready, or heartbeat state for this participant. '
    + 'On a task running longer than ~2 minutes, call with status="heartbeat" every ~2 minutes — silence past that window '
    + 'reads to the lead as stalled, not just slow.',
  inputSchema: {
    status: z.enum(['ready', 'working', 'idle', 'blocked', 'heartbeat']),
    task_id: z.string().min(1).optional(),
    summary: z.string().max(1000).optional(),
    detail: z.string().max(8000).optional(),
    request_id: requestIdField,
  },
}, async ({ status, task_id, summary, detail, request_id }) => textResult(await coordinatorRequest('progress', {
  status,
  taskId: task_id,
  summary,
  detail,
  requestId: request_id,
})))

server.registerTool('coord_publish_finding', {
  description: 'Publish reusable knowledge, a handoff, or a review request into the shared Coordinator event log.',
  inputSchema: {
    kind: z.enum(['finding', 'learning', 'handoff', 'review.requested']),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
    task_id: z.string().min(1).optional(),
    request_id: requestIdField,
  },
}, async ({ kind, summary, detail, task_id, request_id }) => textResult(await coordinatorRequest('finding', {
  kind,
  summary,
  detail,
  taskId: task_id,
  requestId: request_id,
})))

server.registerTool('coord_query_context', {
  description: 'Search this run\'s findings, learnings, and task outcomes for text relevant to a question — a lexical lookup, not full recall. Use this instead of re-reading all of coord_status when you only need context on one topic (e.g. "what did we decide about auth?"), especially after rejoining a long-running run.',
  annotations: { readOnlyHint: true },
  inputSchema: {
    query: z.string().min(1).max(300),
    limit: z.number().int().min(1).max(20).optional(),
  },
}, async ({ query, limit }) => textResult(await coordinatorRequest('query_context', { query, limit })))

server.registerTool('coord_submit_plan', {
  description: 'Submit the plan for a claimed task when the run requires lead approval.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
    request_id: requestIdField,
  },
}, async ({ task_id, summary, detail, request_id }) => textResult(await coordinatorRequest('submit_plan', {
  taskId: task_id,
  summary,
  detail,
  requestId: request_id,
})))

server.registerTool('coord_review_plan', {
  description: 'Lead-only: approve or reject a teammate plan and notify its owner.',
  inputSchema: {
    task_id: z.string().min(1),
    approved: z.boolean(),
    summary: z.string().max(1000).optional(),
    detail: z.string().max(8000).optional(),
    request_id: requestIdField,
  },
}, async ({ task_id, approved, summary, detail, request_id }) => textResult(await coordinatorRequest('review_plan', {
  taskId: task_id,
  approved,
  summary,
  detail,
  requestId: request_id,
})))

server.registerTool('coord_complete_task', {
  description: 'Complete an owned task through plan approval, path-lock, and quality-gate validation.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
    request_id: requestIdField,
  },
}, async ({ task_id, summary, detail, request_id }) => textResult(await coordinatorRequest('complete_task', {
  taskId: task_id,
  summary,
  detail,
  requestId: request_id,
})))

server.registerTool('coord_fail_task', {
  description: 'Mark an owned task failed with a reason so the board can continue to synthesis.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
    request_id: requestIdField,
  },
}, async ({ task_id, summary, detail, request_id }) => textResult(await coordinatorRequest('fail_task', {
  taskId: task_id,
  summary,
  detail,
  requestId: request_id,
})))

server.registerTool('coord_finalize_run', {
  description: 'Lead-only: finalize a run after every task is completed, failed, or cancelled.',
  inputSchema: { summary: z.string().min(1).max(16000), request_id: requestIdField },
}, async ({ summary, request_id }) => textResult(await coordinatorRequest('finalize_run', { summary, requestId: request_id })))

return server
}

void serveStdio(createMcpServer, {
  legacy: 'serve',
  onerror: (error) => console.error(`[agent-viewer-mcp] ${error.message}`),
})

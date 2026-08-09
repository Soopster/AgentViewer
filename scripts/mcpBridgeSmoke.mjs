import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const seen = []
let coordinatorTask = null
let coordinatorMessage = null
const daemon = createServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let value = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { value += chunk })
    request.on('end', () => resolve(value ? JSON.parse(value) : null))
  })
  seen.push({ method: request.method, url: request.url, body })
  response.setHeader('Content-Type', 'application/json')

  if (request.url?.startsWith('/api/session-index/search?')) {
    response.end(JSON.stringify({
      total: 1,
      results: [{
        session: { provider: 'claude', sessionId: 'session-1', title: 'Bridge smoke', cwd: '/tmp/project' },
        matches: [{ uuid: 'message-1', type: 'assistant', snippet: 'matching text', timestamp: '2026-07-18T00:00:00Z' }],
      }],
    }))
    return
  }
  if (request.url?.startsWith('/api/sessions/session-1/messages?')) {
    response.end(JSON.stringify({
      sessionId: 'session-1',
      provider: 'claude',
      offset: 0,
      total: 2,
      messages: [{
        type: 'user',
        uuid: 'message-1',
        session_id: 'session-1',
        parent_tool_use_id: null,
        timestamp: '2026-07-18T00:00:00Z',
        provider: 'claude',
        message: { role: 'user', content: 'matching text' },
      }],
    }))
    return
  }
  if (request.url === '/api/sessions/session-1/bookmarks') {
    response.end(JSON.stringify({ ids: ['message-1'] }))
    return
  }
  if (request.url === '/api/sessions/running') {
    response.end(JSON.stringify({ attention: { id: 'attention-1', ...body } }))
    return
  }
  if (request.url === '/.well-known/agent-card.json') {
    response.end(JSON.stringify({
      name: 'agent-viewer-coordinator',
      description: 'A gated A2A 1.0 facade over Agent Viewer Coordinator.',
      supportedInterfaces: [{
        url: `http://127.0.0.1:${daemon.address().port}/api/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      }],
      version: '1.0.0',
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['application/json'],
      skills: [{ id: 'submit-coordinator-task', name: 'Submit Coordinator task', description: 'Submit work.', tags: ['coordination'] }],
    }))
    return
  }
  if (request.url === '/api/agent-protocol/external') {
    const participant = body?.agentId === 'external-claude'
      ? { runId: 'run-1', agentId: 'external-claude', token: 'token-claude', name: 'claude-cli', role: 'teammate', provider: 'claude', cwd: '/tmp/claude', serverProtocolVersion: 2, negotiatedProtocolVersion: body?.client?.protocolVersion ?? 1, capabilities: body?.capabilities ?? {} }
      : { runId: 'run-1', agentId: 'external-codex', token: 'token-codex', name: 'codex-cli', role: 'lead', provider: 'codex', cwd: '/tmp/codex', serverProtocolVersion: 2, negotiatedProtocolVersion: body?.client?.protocolVersion ?? 1, capabilities: body?.capabilities ?? {} }
    const snapshot = {
      run: { id: 'run-1', prompt: 'ship together', status: 'running', provider: 'codex', baseCwd: '/tmp/codex', maxAgents: 4, leadAgentId: 'external-codex' },
      agents: [participant],
      tasks: coordinatorTask ? [coordinatorTask] : [],
      locks: [],
      messages: coordinatorMessage ? [coordinatorMessage] : [],
      events: [],
    }
    if (body?.action === 'create_run') {
      response.end(JSON.stringify({ participant, snapshot, instructions: 'lead instructions' }))
      return
    }
    if (body?.action === 'list_runs') {
      response.end(JSON.stringify({ runs: [snapshot.run] }))
      return
    }
    if (body?.action === 'join_run') {
      const joined = { ...participant, agentId: 'external-claude', token: 'token-claude', name: 'claude-cli', role: 'teammate', provider: 'claude', cwd: '/tmp/claude' }
      response.end(JSON.stringify({ participant: joined, snapshot: { ...snapshot, agents: [joined] }, instructions: 'teammate instructions' }))
      return
    }
    if (body?.action === 'create_task') {
      coordinatorTask = { id: 'task-1', runId: 'run-1', title: body.title, prompt: body.detail, status: 'pending', paths: body.paths ?? [], blockedBy: [], createdAt: '2026-07-18T00:00:00Z', updatedAt: '2026-07-18T00:00:00Z' }
      response.end(JSON.stringify({ ...snapshot, tasks: [coordinatorTask] }))
      return
    }
    if (body?.action === 'claim_task') {
      coordinatorTask = { ...coordinatorTask, status: 'claimed', ownerAgentId: 'external-claude' }
      response.end(JSON.stringify({ task: coordinatorTask, snapshot: { ...snapshot, tasks: [coordinatorTask] } }))
      return
    }
    if (body?.action === 'send_message') {
      coordinatorMessage = {
        id: 'mail-1',
        runId: 'run-1',
        fromAgentId: 'external-codex',
        toAgentId: 'external-claude',
        body: body.message,
        kind: body.kind ?? 'request',
        priority: body.priority ?? 'normal',
        replyRequired: body.replyRequired === true,
        correlationId: body.correlationId,
        inReplyTo: body.inReplyTo,
        createdAt: '2026-07-18T00:00:00Z',
      }
      response.end(JSON.stringify({ ...snapshot, messages: [coordinatorMessage] }))
      return
    }
    if (body?.action === 'read_inbox') {
      response.end(JSON.stringify({ messages: coordinatorMessage ? [coordinatorMessage] : [], nextCursor: coordinatorMessage?.id ?? null }))
      return
    }
    if (body?.action === 'wait') {
      response.end(JSON.stringify({ changed: true, timedOut: false, cursor: 'event-1', snapshot, inbox: { messages: [], nextCursor: null } }))
      return
    }
    if (body?.action === 'complete_task') {
      coordinatorTask = { ...coordinatorTask, status: 'completed' }
      response.end(JSON.stringify({ accepted: true, snapshot: { ...snapshot, tasks: [coordinatorTask] } }))
      return
    }
    response.end(JSON.stringify(snapshot))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'not found' }))
})

daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const address = daemon.address()
if (!address || typeof address === 'string') throw new Error('Smoke daemon did not bind a TCP port')

const launcher = fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url))
const identityDir = await mkdtemp(path.join(tmpdir(), 'agent-viewer-mcp-smoke-'))
const leadIdentityFile = path.join(identityDir, 'lead.json')
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher, 'mcp', '--attach', String(address.port)],
  stderr: 'pipe',
  env: {
    ...process.env,
    AGENT_VIEWER_COORD_IDENTITY_FILE: leadIdentityFile,
    AGENT_VIEWER_COORD_TRANSPORT: 'http',
  },
})
const client = new Client(
  { name: 'agent-viewer-mcp-smoke', version: '1.0.0' },
  {
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
        'io.modelcontextprotocol/skills': {},
      },
    },
    versionNegotiation: { mode: { pin: '2026-07-28' } },
  },
)

try {
  await client.connect(transport)
  if (client.getProtocolEra() !== 'modern' || client.getNegotiatedProtocolVersion() !== '2026-07-28') {
    throw new Error('Bridge did not negotiate the MCP 2026-07-28 protocol era')
  }
  if (client.getServerVersion()?.websiteUrl !== 'https://github.com/Soopster/AgentViewer') {
    throw new Error('Bridge server identity did not advertise the Agent Viewer repository')
  }
  const extensions = client.getServerCapabilities()?.extensions
  if (!extensions?.['io.modelcontextprotocol/ui']
    || !extensions?.['io.modelcontextprotocol/skills']
    || !extensions?.['io.modelcontextprotocol/tasks']) {
    throw new Error('Bridge did not advertise the MCP Apps, Skills, and Tasks extensions through server/discover')
  }
  const listed = await client.listTools()
  const names = new Set(listed.tools.map((tool) => tool.name))
  const requiredTools = [
    'get_session_transcript', 'post_attention', 'search_sessions', 'set_bookmark',
    'coord_list_runs', 'coord_create_run', 'coord_join_run', 'coord_resume', 'coord_status', 'coord_wait', 'coord_await_run', 'coord_create_task',
    'coord_claim_task', 'coord_read_inbox', 'coord_send_message', 'coord_request_locks',
    'coord_progress', 'coord_publish_finding', 'coord_submit_plan', 'coord_review_plan',
    'coord_complete_task', 'coord_handoff_task', 'coord_fail_task', 'coord_finalize_run',
  ]
  const missingTools = requiredTools.filter((name) => !names.has(name))
  if (missingTools.length > 0) {
    throw new Error(`Bridge tools missing: ${missingTools.join(',')}`)
  }
  for (const a2aMethod of ['SendMessage', 'SendStreamingMessage', 'GetTask', 'ListTasks', 'CancelTask']) {
    if (names.has(a2aMethod)) throw new Error(`A2A peer operation leaked into MCP tools: ${a2aMethod}`)
  }
  const statusTool = listed.tools.find((tool) => tool.name === 'coord_status')
  if (statusTool?._meta?.ui?.resourceUri !== 'ui://agent-viewer/coordinator-dashboard.html') {
    throw new Error('coord_status did not advertise its MCP App resource')
  }

  const resources = await client.listResources()
  const resourceUris = new Set(resources.resources.map((resource) => resource.uri))
  for (const uri of [
    'skill://index.json',
    'skill://coordinate-agents/SKILL.md',
    'a2a://agent-viewer/coordinator/agent-card.json',
    'ui://agent-viewer/coordinator-dashboard.html',
  ]) {
    if (!resourceUris.has(uri)) throw new Error(`Bridge resource missing: ${uri}`)
  }
  const skill = await client.readResource({ uri: 'skill://coordinate-agents/SKILL.md' })
  if (!skill.contents.some((entry) => (
    entry.text?.includes('## Multi-agent startup invariant')
    && entry.text?.includes('## Shared-checkout guardrails')
    && entry.text?.includes('## Autonomous coordination loop')
    && entry.text?.includes('## MCP discovery and host features')
    && entry.text?.includes('## A2A and MCP boundary')
    && entry.text?.includes('structuredContent')
    && entry.text?.includes('ui://agent-viewer/coordinator-dashboard.html')
    && entry.text?.includes('tasks/get')
  ))) {
    throw new Error('Coordinator skill resource did not expose the canonical Agent Viewer workflow')
  }
  const a2aCard = await client.readResource({ uri: 'a2a://agent-viewer/coordinator/agent-card.json' })
  const a2aCardPayload = JSON.parse(a2aCard.contents.find((entry) => entry.mimeType === 'application/json')?.text ?? '{}')
  if (a2aCardPayload.supportedInterfaces?.[0]?.protocolVersion !== '1.0'
    || a2aCardPayload.skills?.[0]?.id !== 'submit-coordinator-task') {
    throw new Error('MCP A2A Agent Card resource did not proxy live peer-agent discovery')
  }
  const app = await client.readResource({ uri: 'ui://agent-viewer/coordinator-dashboard.html' })
  if (!app.contents.some((entry) => entry.mimeType === 'text/html;profile=mcp-app' && entry.text?.includes('ui/initialize'))) {
    throw new Error('Coordinator MCP App resource was not readable as a self-contained view')
  }
  const prompts = await client.listPrompts()
  if (!prompts.prompts.some((prompt) => prompt.name === 'coordinate_agents')) {
    throw new Error('Coordinator workflow prompt was not discoverable')
  }

  const search = await client.callTool({
    name: 'search_sessions',
    arguments: { query: 'matching', current_project_only: true },
  })
  const searchPayload = JSON.parse(search.content?.[0]?.text ?? '{}')
  if (searchPayload.results?.[0]?.session_id !== 'session-1') {
    throw new Error('Search result was not mapped through the bridge')
  }

  const transcript = await client.callTool({
    name: 'get_session_transcript',
    arguments: { session_id: 'session-1', provider: 'claude', limit: 1 },
  })
  const transcriptPayload = JSON.parse(transcript.content?.[0]?.text ?? '{}')
  if (transcriptPayload.messages?.[0]?.message?.content !== 'matching text') {
    throw new Error('Transcript messages were not mapped through the bridge')
  }
  if (transcriptPayload.has_more !== true || transcriptPayload.next_offset !== 1) {
    throw new Error('Transcript pagination metadata was not mapped through the bridge')
  }
  if (!seen.some((entry) => (
    entry.method === 'GET'
    && entry.url === '/api/sessions/session-1/messages?offset=0&limit=1&provider=claude'
  ))) {
    throw new Error('Bridge did not request the selected provider transcript')
  }

  const bookmark = await client.callTool({
    name: 'set_bookmark',
    arguments: { session_id: 'session-1', message_uuid: 'message-1', provider: 'claude' },
  })
  const bookmarkPayload = JSON.parse(bookmark.content?.[0]?.text ?? '{}')
  if (bookmarkPayload.bookmarked !== true) throw new Error('Bookmark mutation did not round-trip')

  const attention = await client.callTool({
    name: 'post_attention',
    arguments: { session_id: 'session-1', title: 'Review this', detail: 'Bridge smoke' },
  })
  const attentionPayload = JSON.parse(attention.content?.[0]?.text ?? '{}')
  if (attentionPayload.id !== 'attention-1') throw new Error('Attention mutation did not round-trip')

  if (!seen.some((entry) => entry.method === 'POST' && entry.url === '/api/sessions/running')) {
    throw new Error('Bridge did not post attention to the Agent Viewer daemon')
  }

  const created = await client.callTool({
    name: 'coord_create_run',
    arguments: { prompt: 'ship together', name: 'codex-cli', provider: 'codex', cwd: '/tmp/codex' },
  })
  const createdPayload = JSON.parse(created.content?.[0]?.text ?? '{}')
  if (createdPayload.participant?.agentId !== 'external-codex') throw new Error('Codex CLI did not bind as Coordinator lead')
  if (createdPayload.participant?.negotiatedProtocolVersion !== 2) throw new Error('Coordinator protocol version was not negotiated')
  if (createdPayload.participant?.token) throw new Error('Coordinator capability leaked through MCP output')
  if (createdPayload.snapshot?.events?.length || createdPayload.snapshot?.messages?.length) {
    throw new Error('Coordinator create echoed historical events or messages into the initial MCP result')
  }
  const savedLeadIdentity = JSON.parse(await readFile(leadIdentityFile, 'utf8'))
  if (savedLeadIdentity.token !== 'token-codex') throw new Error('Coordinator capability was not persisted')
  if ((await stat(leadIdentityFile)).mode & 0o077) throw new Error('Coordinator identity file is not mode 0600')
  const createRequest = seen.find((entry) => entry.url === '/api/agent-protocol/external' && entry.body?.action === 'create_run')
  if (createRequest?.body?.client?.protocolVersion !== 2 || !Array.isArray(createRequest?.body?.capabilities?.tools)) {
    throw new Error('MCP bridge did not advertise its protocol version and capabilities')
  }
  const runs = await client.callTool({ name: 'coord_list_runs', arguments: { limit: 5 } })
  const runsPayload = JSON.parse(runs.content?.[0]?.text ?? '{}')
  if (runsPayload.runs?.[0]?.id !== 'run-1') throw new Error('Legacy Coordinator run discovery did not round-trip')

  const waited = await client.callTool({ name: 'coord_wait', arguments: { timeout_ms: 0 } })
  const waitedPayload = JSON.parse(waited.content?.[0]?.text ?? '{}')
  if (waited.structuredContent?.cursor !== waitedPayload.cursor) {
    throw new Error('Coordinator result did not provide structuredContent alongside its text fallback')
  }
  if (waitedPayload.cursor !== 'event-1') throw new Error('Coordinator wait cursor did not round-trip')
  if ('snapshot' in waitedPayload) throw new Error('Coordinator wait leaked the full board snapshot into the MCP result')

  const teammateIdentityFile = path.join(identityDir, 'teammate.json')
  const secondTransport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, 'mcp', '--attach', String(address.port)],
    stderr: 'pipe',
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_IDENTITY_FILE: teammateIdentityFile,
      AGENT_VIEWER_COORD_TRANSPORT: 'http',
    },
  })
  const secondClient = new Client(
    { name: 'agent-viewer-mcp-smoke-claude', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  try {
    await secondClient.connect(secondTransport)
    const joined = await secondClient.callTool({
      name: 'coord_join_run',
      arguments: { run_id: 'run-1', name: 'claude-cli', provider: 'claude', cwd: '/tmp/claude' },
    })
    const joinedPayload = JSON.parse(joined.content?.[0]?.text ?? '{}')
    if (joinedPayload.participant?.agentId !== 'external-claude') throw new Error('Claude CLI did not bind as Coordinator teammate')

    await client.callTool({
      name: 'coord_create_task',
      arguments: { title: 'Implement bridge', detail: 'Add the shared workflow', paths: ['lib/bridge.ts'] },
    })
    const generatedIdempotencyKey = seen.find((entry) => (
      entry.url === '/api/agent-protocol/external'
      && entry.body?.action === 'create_task'
    ))?.body?.requestId
    if (typeof generatedIdempotencyKey !== 'string' || !generatedIdempotencyKey.startsWith('mcp-')) {
      throw new Error('MCP bridge did not supply an idempotency key for an omitted mutation request_id')
    }
    const claimed = await secondClient.callTool({ name: 'coord_claim_task', arguments: { task_id: 'task-1' } })
    const claimedPayload = JSON.parse(claimed.content?.[0]?.text ?? '{}')
    if (claimedPayload.task?.ownerAgentId !== 'external-claude') throw new Error('External teammate did not claim the shared task')

    await client.callTool({
      name: 'coord_send_message',
      arguments: {
        to: 'claude-cli',
        message: 'Please finish task-1',
        kind: 'review_request',
        priority: 'urgent',
        reply_required: true,
        correlation_id: 'review-task-1',
      },
    })
    const typedMessageRequest = seen.find((entry) => (
      entry.url === '/api/agent-protocol/external'
      && entry.body?.action === 'send_message'
      && entry.body?.correlationId === 'review-task-1'
    ))
    if (typedMessageRequest?.body?.kind !== 'review_request'
      || typedMessageRequest?.body?.priority !== 'urgent'
      || typedMessageRequest?.body?.replyRequired !== true) {
      throw new Error('Typed Coordinator mailbox fields did not cross the MCP bridge')
    }
    const inbox = await secondClient.callTool({ name: 'coord_read_inbox', arguments: {} })
    const inboxPayload = JSON.parse(inbox.content?.[0]?.text ?? '{}')
    if (inboxPayload.messages?.[0]?.body !== 'Please finish task-1') throw new Error('Coordinator mailbox did not cross CLI processes')

    const completed = await secondClient.callTool({
      name: 'coord_complete_task',
      arguments: { task_id: 'task-1', summary: 'Bridge implemented' },
    })
    const completedPayload = JSON.parse(completed.content?.[0]?.text ?? '{}')
    if (completedPayload.accepted !== true) throw new Error('External teammate completion did not round-trip')

    if (!seen.some((entry) => (
      entry.url === '/api/agent-protocol/external'
      && entry.body?.action === 'claim_task'
      && entry.body?.agentId === 'external-claude'
      && entry.body?.token === 'token-claude'
    ))) {
      throw new Error('Coordinator capability was not bound to the second CLI process')
    }
  } finally {
    await secondClient.close().catch(() => {})
  }

  const legacyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, 'mcp', '--attach', String(address.port)],
    stderr: 'pipe',
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_IDENTITY_FILE: path.join(identityDir, 'legacy.json'),
      AGENT_VIEWER_COORD_TRANSPORT: 'http',
    },
  })
  const legacyClient = new Client({ name: 'agent-viewer-mcp-legacy-smoke', version: '1.0.0' })
  try {
    await legacyClient.connect(legacyTransport)
    if (legacyClient.getProtocolEra() !== 'legacy') throw new Error('Bridge did not preserve legacy MCP clients')
    const legacyTools = await legacyClient.listTools()
    if (!legacyTools.tools.some((tool) => tool.name === 'coord_status')) {
      throw new Error('Legacy MCP client could not discover Coordinator tools')
    }
  } finally {
    await legacyClient.close().catch(() => {})
  }
} finally {
  await client.close().catch(() => {})
  daemon.close()
}

console.log('CLI MCP bridge smoke passed')

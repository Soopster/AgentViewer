import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { COORDINATOR_MCP_TOOL_NAMES } from '../bin/agent-viewer-coordinator-tools.mjs'

const SESSION_MCP_TOOL_NAMES = Object.freeze([
  'search_sessions',
  'list_sessions',
  'message_session',
  'get_session_transcript',
  'set_bookmark',
  'post_attention',
])

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
  if (request.url === '/api/agents?exclude=sender-session') {
    response.end(JSON.stringify({
      sessions: [{
        sessionId: 'recipient-session',
        name: 'recipient-c0ffee42',
        provider: 'codex',
        running: false,
        cwd: '/tmp/project',
        title: 'Recipient',
      }],
    }))
    return
  }
  if (request.url === '/api/agents/message') {
    response.end(JSON.stringify({
      delivered: true,
      mode: 'queued',
      targetSessionId: body.to,
      targetProvider: 'codex',
      targetName: 'recipient-c0ffee42',
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
  const actualToolNames = listed.tools.map((tool) => tool.name).sort()
  const expectedToolNames = [...SESSION_MCP_TOOL_NAMES, ...COORDINATOR_MCP_TOOL_NAMES].sort()
  if (JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames)) {
    const actual = new Set(actualToolNames)
    const expected = new Set(expectedToolNames)
    const missing = expectedToolNames.filter((name) => !actual.has(name))
    const unexpected = actualToolNames.filter((name) => !expected.has(name))
    throw new Error(`Bridge tool inventory drifted (missing: ${missing.join(',') || 'none'}; unexpected: ${unexpected.join(',') || 'none'})`)
  }
  const names = new Set(actualToolNames)
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
    'skill://coordinate-agents/references/protocol-and-hosts.md',
    'skill://coordinate-agents/references/playbooks-and-memory.md',
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
    && entry.text?.includes('references/protocol-and-hosts.md')
    && entry.text?.includes('references/playbooks-and-memory.md')
  ))) {
    throw new Error('Coordinator skill resource did not expose the canonical Agent Viewer workflow')
  }
  const protocolReference = await client.readResource({ uri: 'skill://coordinate-agents/references/protocol-and-hosts.md' })
  if (!protocolReference.contents.some((entry) => (
    entry.text?.includes('## MCP discovery and host features')
    && entry.text?.includes('## A2A and MCP boundary')
    && entry.text?.includes('structuredContent')
    && entry.text?.includes('ui://agent-viewer/coordinator-dashboard.html')
    && entry.text?.includes('tasks/get')
  ))) {
    throw new Error('Coordinator protocol reference did not expose the canonical MCP host workflow')
  }
  const playbookReference = await client.readResource({ uri: 'skill://coordinate-agents/references/playbooks-and-memory.md' })
  if (!playbookReference.contents.some((entry) => (
    entry.text?.includes('coord_save_playbook')
    && entry.text?.includes('coord_remember')
    && entry.text?.includes('coord_save_role')
  ))) {
    throw new Error('Coordinator playbook reference did not expose the canonical reusable-workflow guidance')
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

  const sessions = await client.callTool({
    name: 'list_sessions',
    arguments: { exclude_session_id: 'sender-session' },
  })
  const sessionsPayload = JSON.parse(sessions.content?.[0]?.text ?? '{}')
  if (sessionsPayload.sessions?.[0]?.session_id !== 'recipient-session') {
    throw new Error('Cross-session discovery was not mapped through the MCP bridge')
  }
  const message = await client.callTool({
    name: 'message_session',
    arguments: {
      to: 'recipient-session',
      text: 'Please respond to this handoff',
      from_session_id: 'sender-session',
      from_name: 'Sender',
    },
  })
  const messagePayload = JSON.parse(message.content?.[0]?.text ?? '{}')
  if (messagePayload.delivered !== true || messagePayload.targetSessionId !== 'recipient-session') {
    throw new Error('Cross-session message was not accepted through the MCP bridge')
  }
  if (!seen.some((entry) => entry.url === '/api/agents/message'
    && entry.body?.to === 'recipient-session'
    && entry.body?.fromSessionId === 'sender-session')) {
    throw new Error('MCP bridge did not send the cross-session message with exact session identities')
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
    arguments: {
      prompt: 'ship together', name: 'codex-cli', provider: 'codex', cwd: '/tmp/codex',
      autonomy: 'medium', require_review: true, budget: { maxTokens: 12000, maxDurationMinutes: 10 },
      acceptance_contract: {
        goal: 'Ship the bridge', userVisibleAcceptance: ['CLI receipt is visible'],
        verificationCommands: ['npm run smoke'], escalationTriggers: ['model drift'],
      },
    },
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
  if (createRequest?.body?.autonomy !== 'medium'
    || createRequest?.body?.requireReview !== true
    || createRequest?.body?.budget?.maxTokens !== 12000
    || createRequest?.body?.acceptanceContract?.goal !== 'Ship the bridge') {
    throw new Error('Coordinator run policy did not cross the MCP bridge')
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
      arguments: {
        title: 'Implement bridge', detail: 'Add the shared workflow', paths: ['lib/bridge.ts'],
        seat: 'executor', requested_provider: 'claude', requested_model: 'claude-opus-4-1',
        requested_effort: 'high', verify_commands: ['npm run smoke'],
      },
    })
    const generatedIdempotencyKey = seen.find((entry) => (
      entry.url === '/api/agent-protocol/external'
      && entry.body?.action === 'create_task'
    ))?.body?.requestId
    if (typeof generatedIdempotencyKey !== 'string' || !generatedIdempotencyKey.startsWith('mcp-')) {
      throw new Error('MCP bridge did not supply an idempotency key for an omitted mutation request_id')
    }
    const createTaskRequest = seen.find((entry) => entry.url === '/api/agent-protocol/external' && entry.body?.action === 'create_task')
    if (createTaskRequest?.body?.seat !== 'executor'
      || createTaskRequest?.body?.requestedModel !== 'claude-opus-4-1'
      || createTaskRequest?.body?.verifyCommands?.[0] !== 'npm run smoke') {
      throw new Error('Coordinator seat, model provenance, or verification policy did not cross the MCP bridge')
    }
    const claimed = await secondClient.callTool({ name: 'coord_claim_task', arguments: { task_id: 'task-1' } })
    const claimedPayload = JSON.parse(claimed.content?.[0]?.text ?? '{}')
    if (claimedPayload.task?.ownerAgentId !== 'external-claude') throw new Error('External teammate did not claim the shared task')

    const detailedFinding = 'ranked hotspot evidence\n'.repeat(500)
    if (detailedFinding.length <= 8000) throw new Error('Detailed finding smoke did not exceed the former schema limit')
    await secondClient.callTool({
      name: 'coord_publish_finding',
      arguments: {
        kind: 'finding',
        task_id: 'task-1',
        summary: 'Heap-profiler audit',
        detail: detailedFinding,
      },
    })
    const findingRequest = seen.find((entry) => (
      entry.url === '/api/agent-protocol/external'
      && entry.body?.action === 'finding'
      && entry.body?.summary === 'Heap-profiler audit'
    ))
    if (findingRequest?.body?.detail !== detailedFinding) {
      throw new Error('Detailed Coordinator finding did not cross the MCP bridge unchanged')
    }

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
      arguments: {
        task_id: 'task-1', summary: 'Bridge implemented', actual_model: 'claude-opus-4-1',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, durationMs: 1200 },
        files_changed: ['lib/bridge.ts'], commands_run: ['npm run smoke'],
        needs_decision: [{ id: 'decision-1', question: 'Ship now?', options: ['yes'], assumed: 'yes', impactIfWrong: 'Delayed release', status: 'open' }],
      },
    })
    const completedPayload = JSON.parse(completed.content?.[0]?.text ?? '{}')
    if (completedPayload.accepted !== true) throw new Error('External teammate completion did not round-trip')
    const completionRequest = seen.find((entry) => entry.url === '/api/agent-protocol/external' && entry.body?.action === 'complete_task')
    if (completionRequest?.body?.actualModel !== 'claude-opus-4-1'
      || completionRequest?.body?.usage?.totalTokens !== 150
      || completionRequest?.body?.needsDecision?.[0]?.id !== 'decision-1') {
      throw new Error('Coordinator task receipt did not cross the MCP bridge')
    }

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

  await client.callTool({ name: 'coord_review_phase', arguments: { phase: 'implementation', approved: true, summary: 'Receipts reviewed' } })
  await client.callTool({ name: 'coord_review_run', arguments: { approved: true, summary: 'Intent and scope reviewed' } })
  await client.callTool({ name: 'coord_resolve_decision', arguments: { task_id: 'task-1', decision_id: 'decision-1', answer: 'yes' } })
  await client.callTool({ name: 'coord_promote_learning', arguments: { candidate_id: 'learning-1', target: 'playbook' } })
  await client.callTool({ name: 'coord_spawn_teammate', arguments: { provider: 'claude' } })
  for (const action of ['review_phase', 'review_run', 'resolve_decision', 'promote_learning', 'spawn_teammate']) {
    if (!seen.some((entry) => entry.url === '/api/agent-protocol/external' && entry.body?.action === action)) {
      throw new Error(`Coordinator ${action} did not cross the MCP bridge`)
    }
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

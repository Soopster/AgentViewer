// The `acp` provider: an agent known only by its command is a real provider —
// it has an adapter, sessions, a roster identity, and the panel can staff one.
//
// Run with bun. The agent here is hand-written: it speaks ACP on stdio and, on
// each prompt, calls a coord_* tool through whatever MCP server it was handed
// in session/new, the way a real agent would.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.argv[2] !== 'child') {
  const dir = mkdtempSync(path.join(tmpdir(), 'acp-provider-'))
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_VIEWER_COORD_HOME: path.join(dir, 'coord-home') }
  delete env.AGENT_VIEWER_ACP_COMMAND
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', dir], { stdio: 'inherit', env, timeout: 90_000 })
  assert.equal(child.status, 0, 'acp provider smoke child failed')
  console.log('ACP provider smoke passed (an unconfigured agent lists nothing and says why; a configured one runs a turn; two instances are two agents; a staffed teammate reaches the Coordinator through its own MCP server, as itself)')
} else {
  const dir = process.argv[3]!
  process.chdir(dir)
  const seenPath = path.join(dir, 'seen.jsonl')
  const agentPath = path.join(dir, 'fake agent.mjs')
  writeFileSync(agentPath, `import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const label = process.argv[2] ?? 'default'
const out = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
let servers = []
async function callTool(server, name, args) {
  const child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] })
  const pending = new Map()
  createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); pending.get(m.id)?.(m) })
  const rpc = (id, method, params) => new Promise((resolve) => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n') })
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } })
  const listed = await rpc(2, 'tools/list', {})
  const called = await rpc(3, 'tools/call', { name, arguments: args })
  child.kill()
  return { tools: listed.result.tools.map((tool) => tool.name), result: called.result }
}
createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const persists = label === 'gemini' || label === 'goose'
  if (message.method === 'initialize') out({ id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: persists ? { loadSession: true, sessionCapabilities: { list: {} } } : {} } })
  else if (message.method === 'session/list') out({ id: message.id, result: { sessions: [{ sessionId: 'saved-' + label, title: label + ' session', cwd: process.cwd(), updatedAt: '2026-01-01T00:00:00Z' }] } })
  else if (message.method === 'session/load') {
    out({ method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'history of ' + label } } } })
    out({ id: message.id, result: {} })
  }
  else if (message.method === 'session/new') { servers = message.params.mcpServers ?? []; out({ id: message.id, result: { sessionId: 'native-' + label } }) }
  else if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId
    let said = 'hello from ' + label
    const record = { label, servers: servers.map((server) => server.name) }
    if (servers[0]) {
      const answer = await callTool(servers[0], 'coord_status', {})
      record.tools = answer.tools
      record.status = answer.result
      said = 'status read'
    }
    appendFileSync(${JSON.stringify(seenPath)}, JSON.stringify(record) + '\\n')
    out({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: said } } } })
    out({ id: message.id, result: { stopReason: 'end_turn' } })
  } else out({ id: message.id, error: { code: -32601, message: 'unsupported' } })
})
`)
  const command = (label: string) => JSON.stringify([process.execPath, agentPath, label])
  const seen = () => existsSync(seenPath) ? readFileSync(seenPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  async function drain(response: Response): Promise<string> {
    assert.ok(response.body, 'the turn returned no stream')
    return await new Response(response.body).text()
  }

  const { getSessionAdapter, assertAllAdapterCapabilities } = await import('../lib/adapters/registry')
  const { isAgentProvider, isAcpProvider, getProviderCapabilities } = await import('../lib/provider')
  const { CUSTOM_ACP_UNCONFIGURED } = await import('../lib/acpAgentSpawn')
  const backend = await import('../lib/sessionBackend')
  const instances = await import('../lib/providerInstances')

  // --- It is a provider, everywhere a provider is checked.
  assert.ok(isAgentProvider('acp') && isAcpProvider('acp'))
  assert.equal(getProviderCapabilities('acp').respondToPermission, true)
  await assertAllAdapterCapabilities()
  const adapter = await getSessionAdapter('acp')
  assert.equal(adapter.provider, 'acp')

  // --- Unconfigured: nothing to list, no spawn attempted, and a turn says what to do.
  assert.deepEqual(await instances.withProviderInstance('acp', 'acp', () => adapter.listSessions!({ limit: 10, offset: 0 } as never)), [])
  const refused = await drain(await instances.withProviderInstance('acp', 'acp', () => backend.streamViewSessionTurn({
    sessionId: 'unconfigured', provider: 'acp', signal: new AbortController().signal, body: { message: 'hi', cwd: dir },
  })))
  assert.ok(refused.includes(CUSTOM_ACP_UNCONFIGURED.slice(0, 40)), `an unconfigured agent did not explain itself: ${refused}`)

  // --- Configured through the environment: a turn runs against the user's command.
  process.env.AGENT_VIEWER_ACP_COMMAND = command('env')
  const created = await backend.createNewViewSession({ provider: 'acp', cwd: dir })
  assert.equal(created.provider, 'acp')
  const turn = await drain(await instances.withProviderInstance('acp', 'acp', () => backend.streamViewSessionTurn({
    sessionId: created.sessionId, provider: 'acp', signal: new AbortController().signal, body: { message: 'hi', cwd: dir },
  })))
  assert.ok(turn.includes('hello from env'), `the configured agent did not answer: ${turn}`)
  assert.ok(turn.includes('"provider":"acp"'), 'the transcript rows are not attributed to the acp provider')
  assert.deepEqual(seen().at(-1), { label: 'env', servers: [] }, 'an ordinary chat must not be handed Coordinator tools')

  // --- Two instances are two agents, each with its own command.
  await instances.writeProviderInstancesFile({ version: 1, instances: [
    { id: 'gemini', provider: 'acp', displayName: 'Gemini', executable: command('gemini') },
    { id: 'goose', provider: 'acp', displayName: 'Goose', executable: command('goose') },
  ] })
  const listed = (await instances.listProviderInstanceSummaries()).filter((instance) => instance.provider === 'acp')
  assert.deepEqual(listed.map((instance) => [instance.id, instance.displayName]), [['acp', 'ACP agent'], ['gemini', 'Gemini'], ['goose', 'Goose']])
  assert.ok(!JSON.stringify(listed).includes(agentPath), 'an instance summary leaked its command')
  for (const id of ['gemini', 'goose']) {
    const reply = await drain(await instances.withProviderInstance(id, 'acp', () => backend.streamViewSessionTurn({
      sessionId: `chat-${id}`, provider: 'acp', signal: new AbortController().signal, body: { message: 'hi', cwd: dir },
    })))
    assert.ok(reply.includes(`hello from ${id}`), `instance ${id} did not run its own command: ${reply}`)
  }

  // Their saved sessions are listed and read per agent: one agent's list
  // served as the other's would open sessions that agent has never heard of.
  for (const id of ['gemini', 'goose']) {
    const sessions = await instances.withProviderInstance(id, 'acp', () => adapter.listSessions!({ limit: 10, offset: 0 } as never))
    assert.deepEqual(sessions.map((session) => [session.sessionId, session.summary, session.provider]), [[`saved-${id}`, `${id} session`, 'acp']], `instance ${id} listed another agent's sessions`)
    const history = await instances.withProviderInstance(id, 'acp', () => adapter.readAllMessages!(`saved-${id}`))
    assert.ok(JSON.stringify(history.messages).includes(`history of ${id}`), `instance ${id} did not replay its own history`)
  }
  assert.deepEqual(await instances.withProviderInstance('acp', 'acp', () => adapter.listSessions!({ limit: 10, offset: 0 } as never)), [], 'the default agent advertises no listing and must list nothing')

  // --- The panel can staff one: a managed teammate gets coord_* over MCP, bound to itself.
  const coord = await import('../lib/agentCoordination')
  await coord.configureInteractiveCoordinator({ sessionId: created.sessionId, provider: 'acp', cwd: dir })
  const lead = await coord.sessionCoordinatorIdentity(created.sessionId, 'acp')
  const before = seen().length
  const delegated = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', requestedProvider: 'acp', title: 'Inspect fixture', detail: 'Read-only review' })
  assert.equal(delegated.delegation?.provider, 'acp', 'the teammate was not staffed from the acp provider')
  const deadline = Date.now() + 30_000
  while (seen().length === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  const record = seen().at(-1)
  assert.ok(seen().length > before, 'the staffed teammate never ran a turn')
  assert.deepEqual(record.servers, ['agent-viewer'], 'the teammate was not handed the Coordinator MCP server')
  assert.ok(record.tools.includes('coord_complete_task') && record.tools.includes('coord_read_inbox'), 'the MCP server does not list the tool contract')
  assert.ok(!record.status.isError, `coord_status failed for the teammate: ${JSON.stringify(record.status)}`)
  const status = JSON.parse(record.status.content[0].text)
  assert.equal(status.run?.id ?? status.snapshot?.run?.id, lead.runId, 'the teammate read a different run')
  assert.ok(JSON.stringify(status).includes(delegated.delegation!.agentId), 'the teammate is not on the board it read')

  // The credential is in a private file, never in the agent's argv or environment.
  const bindings = path.join(dir, '.agent-viewer-data', 'agent-coordination', 'session-bindings')
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
  const token = controller.sdkIdentities.get(delegated.delegation!.agentId)!.token
  const bindingFile = spawnSync('grep', ['-rl', token, bindings], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)
  assert.equal(bindingFile.length, 1, 'the teammate credential should live in exactly one binding file')
  assert.equal(statSync(bindingFile[0]!).mode & 0o777, 0o600)

  await coord.stopProtocolRun(lead.runId).catch(() => {})
  process.exit(0)
}

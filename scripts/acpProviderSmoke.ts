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
  console.log('ACP provider smoke passed (an unconfigured agent lists nothing and says why; a configured one runs a turn on a chosen model; two instances are two agents, each session routed to its own; a staffed teammate reaches the Coordinator as itself, through its MCP server or the shell client; only an exact call of that client is approved without a person; a stuck teammate is not re-run forever)')
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
let model = 'm-default'
const configOptions = () => [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: [{ group: 'g', name: 'Group', options: [{ value: 'm-default', name: 'Default' }, { value: 'm-fast', name: 'Fast' }] }] }]
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
// An agent that ignores the MCP server it is handed, as GitHub Copilot's ACP
// mode does: it reaches the Coordinator through the shell client named in its
// prompt, asking permission for each command first.
const answers = new Map()
let prompts = 0
const ask = (sessionId, command) => new Promise((resolve) => {
  const id = 'perm-' + answers.size
  answers.set(id, resolve)
  out({ id, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: id, kind: 'execute', title: 'Check the board', rawInput: { command } }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Allow' }, { optionId: 'no', kind: 'reject_once', name: 'Reject' }] } })
})
const sh = (command) => new Promise((resolve) => { let text = ''; const child = spawn('sh', ['-c', command]); child.stdout.on('data', (chunk) => { text += chunk }); child.on('close', () => resolve(text)) })
createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === undefined) { answers.get(message.id)?.(message.result?.outcome?.optionId); return }
  const persists = label === 'gemini' || label === 'goose'
  if (message.method === 'initialize') out({ id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: persists ? { loadSession: true, sessionCapabilities: { list: {} } } : {} } })
  else if (message.method === 'session/list') out({ id: message.id, result: { sessions: [{ sessionId: 'saved-' + label, title: label + ' session', cwd: process.cwd(), updatedAt: '2026-01-01T00:00:00Z' }] } })
  else if (message.method === 'session/load') {
    out({ method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'history of ' + label } } } })
    out({ id: message.id, result: {} })
  }
  else if (message.method === 'session/new') { servers = message.params.mcpServers ?? []; out({ id: message.id, result: { sessionId: 'native-' + label, configOptions: configOptions() } }) }
  else if (message.method === 'session/set_config_option') { model = message.params.value; out({ id: message.id, result: { configOptions: configOptions() } }) }
  else if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId
    let said = 'hello from ' + label + ' on ' + model
    const record = { label, servers: servers.map((server) => server.name) }
    const client = /session client[^:]*: (.+?) TOOL_NAME/.exec(message.params.prompt.map((part) => part.text ?? '').join(''))?.[1]
    if (label === 'asker' && prompts++ > 0) { record.repeat = true; said = 'still stuck' }
    else if (label === 'asker' && client) {
      const plain = client + " coord_status '{}'"
      record.plain = await ask(sessionId, plain)
      record.status = record.plain === 'yes' ? await sh(plain) : null
      // The same call with a second command after it is not the client's call.
      record.chained = await ask(sessionId, plain + '; echo extra')
      said = 'asked'
    } else if (servers[0]) {
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

  // --- Its models are the ones it advertised, and the composer's choice is applied.
  const offered = await instances.withProviderInstance('acp', 'acp', () => adapter.readModels!(created.sessionId))
  assert.deepEqual(offered.models.map((entry) => entry.value), ['m-default', 'm-fast'], 'grouped model options were not flattened into the list')
  assert.equal(offered.currentModel, 'm-default')
  const send = (sessionId: string, model: string) => instances.withProviderInstance('acp', 'acp', async () => drain(await backend.streamViewSessionTurn({
    sessionId, provider: 'acp', signal: new AbortController().signal, body: { message: 'hi', cwd: dir, model },
  })))
  assert.ok((await send(created.sessionId, 'm-fast')).includes('hello from env on m-fast'), 'the chosen model was not applied before the prompt')
  assert.equal((await instances.withProviderInstance('acp', 'acp', () => adapter.readModels!(created.sessionId))).currentModel, 'm-fast')
  const unknown = await send(created.sessionId, 'm-missing')
  assert.ok(unknown.includes('does not offer the model') && !unknown.includes('hello from'), `a model the agent never offered was sent anyway: ${unknown}`)
  // A session not yet started is offered the agent's last list, with no current model.
  const cold = await instances.withProviderInstance('acp', 'acp', () => adapter.readModels!('not-started'))
  assert.deepEqual([cold.models.length, cold.currentModel], [2, null])

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


  // --- A caller that names no agent (the TUI) still reaches the right one.
  // Naming only `acp` lists every configured agent's sessions, each under its
  // agent's name, and a session is then read and prompted through the agent
  // that listed it.
  const reads = await import('../lib/sessionReads')
  const everyAgent = await reads.listViewSessions({ provider: 'acp', limit: 20, offset: 0 } as never)
  assert.deepEqual(everyAgent.map((session) => [session.sessionId, session.providerInstanceId, session.providerDisplayName]).sort(),
    [['saved-gemini', 'gemini', 'Gemini'], ['saved-goose', 'goose', 'Goose']], 'naming no agent did not list every agent\'s sessions')
  const routed = await reads.listViewSessionMessageWindow('saved-goose', { limit: 10, offset: 0 } as never, 'acp')
  assert.ok(JSON.stringify(routed.messages).includes('history of goose'), 'a session was not read through the agent that listed it')
  const routedTurn = await drain(await backend.streamViewSessionTurn({ sessionId: 'saved-gemini', provider: 'acp', signal: new AbortController().signal, body: { message: 'hi', cwd: dir } }))
  assert.ok(routedTurn.includes('hello from gemini'), `a session was not prompted through the agent that listed it: ${routedTurn}`)
  // An agent the caller did name is never overridden by what was remembered.
  // (Goose's saved session has no live turn, so this read can only come from an agent.)
  const named = await instances.withProviderInstance('gemini', 'acp', () => reads.listViewSessionMessageWindow('saved-goose', { limit: 10, offset: 0 } as never, 'acp'))
  assert.ok(!JSON.stringify(named.messages).includes('history of goose'), 'a named agent was overridden by the remembered one')
  // A new chat started for an agent stays with it.
  const { createTuiSession } = await import('../lib/tui/service')
  const fresh = await createTuiSession({ provider: 'acp', cwd: dir, providerInstanceId: 'goose' })
  assert.equal(fresh.providerInstanceId, 'goose')
  const freshTurn = await drain(await backend.streamViewSessionTurn({ sessionId: fresh.sessionId, provider: 'acp', signal: new AbortController().signal, body: { message: 'hi', cwd: dir } }))
  assert.ok(freshTurn.includes('hello from goose'), `a new chat did not go to the agent it was created for: ${freshTurn}`)

  // In the merged view a session the native adapter also lists is shown once, natively.
  assert.deepEqual(reads.dropAcpDuplicates([
    { sessionId: 'ses_1', provider: 'acp' }, { sessionId: 'ses_1', provider: 'opencode' }, { sessionId: 'only-acp', provider: 'acp' },
  ]).map((session) => `${session.provider}:${session.sessionId}`), ['opencode:ses_1', 'acp:only-acp'])

  // Choosing an ACP provider survives being saved and read back.
  const providerState = await import('../lib/providerState')
  await providerState.setConfiguredProviderTarget({ provider: 'acp', providerInstanceId: 'gemini' })
  assert.deepEqual(await providerState.getConfiguredProviderTarget(), { provider: 'acp', providerInstanceId: 'gemini' })

  // --- The TUI's instance picker: one row per further instance, the list
  // narrowed to the one picked, and the choice saved.
  const tui = await import('../lib/tui/service')
  assert.deepEqual((await tui.readTuiProviderInstances()).choices.filter((choice) => choice.provider === 'acp'), [
    { provider: 'acp', providerInstanceId: 'gemini', label: 'Gemini' }, { provider: 'acp', providerInstanceId: 'goose', label: 'Goose' },
  ], 'the picker did not offer each configured agent')
  assert.deepEqual((await tui.readTuiSessions('acp', 'goose')).map((session) => session.sessionId), ['saved-goose'], 'a picked agent did not narrow the list to its own sessions')
  await tui.writeTuiProvider('acp', 'goose')
  assert.equal((await tui.readTuiProviderInstances()).selected, 'goose', 'the picked agent was not saved')
  await tui.writeTuiProvider('acp')
  assert.equal((await tui.readTuiProviderInstances()).selected, null, 'the bare provider row did not clear the picked agent')
  // A row carries its instance, and a send honours it before any listing has
  // recorded the session (one just created, or whose pending id just changed).
  const unlisted = await drain(await tui.streamTuiSessionTurn({ sessionId: 'never-listed', provider: 'acp', providerInstanceId: 'goose' } as never, { message: 'hi', cwd: dir }))
  assert.ok(unlisted.includes('hello from goose'), `a row's own instance was not used for its turn: ${unlisted}`)
  // The pairing is per provider: the same id under another provider is another session.
  const sessionInstances = await import('../lib/sessionInstances')
  assert.equal(sessionInstances.sessionInstanceId('acp', 'never-listed'), 'goose')
  assert.equal(sessionInstances.sessionInstanceId('claude', 'never-listed'), undefined, 'an instance was remembered across providers')
  await providerState.setConfiguredProvider('claude')

  // --- The panel can staff one: a managed teammate gets coord_* over MCP, bound to itself.
  const coord = await import('../lib/agentCoordination')
  await coord.configureInteractiveCoordinator({ sessionId: created.sessionId, provider: 'acp', cwd: dir })
  const lead = await coord.sessionCoordinatorIdentity(created.sessionId, 'acp')
  const before = seen().length
  // Each configured agent is its own staffing choice; one with no command is not offered.
  const { readCoordinatorStaffing } = await import('../lib/coordinatorCapabilities')
  const { coordinatorInstanceLabel } = await import('../lib/coordinatorInteractiveState')
  const staffing = await readCoordinatorStaffing()
  assert.deepEqual(staffing.filter((choice) => choice.provider === 'acp').map((choice) => choice.label), ['ACP agent', 'Gemini', 'Goose'])
  const envCommand = process.env.AGENT_VIEWER_ACP_COMMAND
  delete process.env.AGENT_VIEWER_ACP_COMMAND
  assert.deepEqual((await readCoordinatorStaffing()).filter((choice) => choice.provider === 'acp').map((choice) => choice.label), ['Gemini', 'Goose'], 'an agent with no command was offered for staffing')
  process.env.AGENT_VIEWER_ACP_COMMAND = envCommand
  assert.ok(!JSON.stringify(staffing).includes(agentPath), 'a staffing choice leaked its command')

  // Staffed by instance: the teammate is Goose, runs Goose's command, and is named as Goose.
  const delegated = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', requestedProvider: 'acp', requestedProviderInstanceId: 'goose', title: 'Inspect fixture', detail: 'Read-only review' })
  assert.equal(delegated.delegation?.provider, 'acp', 'the teammate was not staffed from the acp provider')
  const staffed = (await coord.readProtocolRun(lead.runId))!.agents.find((agent) => agent.id === delegated.delegation!.agentId)!
  assert.equal(staffed.providerInstanceId, 'goose')
  assert.equal(coordinatorInstanceLabel(staffed, staffing), 'Goose', 'the roster cannot name the teammate\'s agent')
  assert.equal(coordinatorInstanceLabel({ provider: 'acp', providerInstanceId: 'acp' }, staffing), null, 'a default instance already goes by its provider\'s name')
  const deadline = Date.now() + 30_000
  while (seen().length === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  const record = seen().at(-1)
  assert.ok(seen().length > before, 'the staffed teammate never ran a turn')
  assert.equal(record.label, 'goose', 'the teammate ran another instance\'s command')
  assert.deepEqual(record.servers, ['agent-viewer'], 'the teammate was not handed the Coordinator MCP server')
  assert.ok(record.tools.includes('coord_complete_task') && record.tools.includes('coord_read_inbox'), 'the MCP server does not list the tool contract')
  assert.ok(!record.status.isError, `coord_status failed for the teammate: ${JSON.stringify(record.status)}`)
  const status = JSON.parse(record.status.content[0].text)
  assert.equal(status.run?.id ?? status.snapshot?.run?.id, lead.runId, 'the teammate read a different run')
  assert.ok(JSON.stringify(status).includes(delegated.delegation!.agentId), 'the teammate is not on the board it read')

  // --- An agent that ignores its MCP server still gets in, through the shell
  // client, and is not asked about that client's own calls — only about those.
  await instances.writeProviderInstancesFile({ version: 1, instances: [
    { id: 'gemini', provider: 'acp', displayName: 'Gemini', executable: command('gemini') },
    { id: 'goose', provider: 'acp', displayName: 'Goose', executable: command('goose') },
    { id: 'asker', provider: 'acp', displayName: 'Asker', executable: command('asker') },
  ] })
  const pool = await import('../lib/acpClientPool')
  const askerTask = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', requestedProvider: 'acp', requestedProviderInstanceId: 'asker', teammateName: 'asker', title: 'Ask first', detail: 'Read-only review' })
  const askerId = askerTask.delegation!.agentId
  const askerSession = () => coord.readProtocolRun(lead.runId).then((snapshot) => snapshot!.agents.find((agent) => agent.id === askerId)!.sessionId)
  const askDeadline = Date.now() + 30_000
  let queued: ReturnType<typeof pool.acpPendingRequests> = []
  while (queued.length === 0 && Date.now() < askDeadline) { await new Promise((resolve) => setTimeout(resolve, 50)); queued = pool.acpPendingRequests(await askerSession()) }
  assert.equal(queued.length, 1, 'the chained command should be the one request waiting for a person')
  assert.ok(JSON.stringify(queued[0]!.params).includes('; echo extra'), 'the wrong request reached a person')
  pool.respondAcpPermissionDecision(await askerSession(), queued[0]!.id, 'reject')
  const askerRecord = () => seen().find((entry) => entry.label === 'asker')
  while (!askerRecord() && Date.now() < askDeadline) await new Promise((resolve) => setTimeout(resolve, 50))
  const asked = askerRecord()
  assert.ok(asked, 'the asking teammate never finished its turn')
  assert.equal(asked.plain, 'yes', 'the session client\'s own call was not approved for the teammate')
  assert.equal(asked.chained, 'no')
  assert.ok(String(asked.status).includes(askerId), `the shell client did not read the board as the teammate: ${asked.status}`)
  // It never reads its inbox or finishes its task. That is a turn, one nudge,
  // and one more turn for the mail still waiting — not a fresh turn on every
  // five-second sweep for as long as the host is up. Two sweeps pass here.
  await new Promise((resolve) => setTimeout(resolve, 12_000))
  const askerTurns = seen().filter((entry) => entry.label === 'asker').length
  assert.ok(askerTurns <= 3, `a teammate that makes no progress was run ${askerTurns} times`)

  const { isCoordinatorClientInvocation } = await import('../lib/coordinatorSessionClient')
  for (const tail of [" coord_status '{}' && rm -rf x", ' coord_status "$(id)"', " coord_status '{}' > out", ' other_tool', " coord_status '{}' '{}'", '']) {
    assert.equal(isCoordinatorClientInvocation(`node c.mjs b.json${tail}`, 'node c.mjs b.json'), false, `matched: ${tail}`)
  }
  assert.ok(isCoordinatorClientInvocation(`node c.mjs b.json coord_send_message '{"message":"it'\\''s done"}'`, 'node c.mjs b.json'))

  // The credential is in a private file, never in the agent's argv or environment.
  const bindings = path.join(dir, '.agent-viewer-data', 'agent-coordination', 'session-bindings')
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
  const token = controller.sdkIdentities.get(delegated.delegation!.agentId)!.token
  const bindingFile = spawnSync('grep', ['-rl', token, bindings], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)
  // One binding for the MCP server and one for the shell client, both private.
  // This failed once in many runs and not again; say what was on disk if it does.
  if (bindingFile.length !== 2) console.error('binding files found:', spawnSync('find', [path.join(dir, '.agent-viewer-data'), path.join(dir, 'coord-home'), '-type', 'f'], { encoding: 'utf8' }).stdout, token.slice(0, 6))
  assert.equal(bindingFile.length, 2, `the teammate credential should live in its two binding files only: ${bindingFile}`)
  for (const file of bindingFile) assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.ok(!readFileSync(seenPath, 'utf8').includes(token), 'the credential reached the agent')

  await coord.stopProtocolRun(lead.runId).catch(() => {})
  process.exit(0)
}

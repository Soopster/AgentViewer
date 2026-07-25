import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const testCwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-ahp-'))
process.chdir(testCwd)
execFileSync('git', ['init', '-q'], { cwd: testCwd })
execFileSync('git', ['config', 'user.email', 'ahp-smoke@example.test'], { cwd: testCwd })
execFileSync('git', ['config', 'user.name', 'AHP Smoke'], { cwd: testCwd })
writeFileSync(path.join(testCwd, 'README.md'), 'AHP smoke\n')
writeFileSync(path.join(testCwd, '.gitignore'), '.agent-viewer-data/\n')
execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: testCwd })
execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: testCwd })

const { CoordinatorAhpHost } = await import('../lib/ahpHost')
const { AhpClient, InMemoryTransport } = await import('@microsoft/agent-host-protocol/client')
const { WebSocketTransport } = await import('@microsoft/agent-host-protocol/ws')

type Frame = Record<string, any>
const frames: Frame[] = []
const host = new CoordinatorAhpHost()
const connection = host.createConnection((message) => frames.push(message))
const exchanges: Array<{ method: string; params: Record<string, unknown>; response: Frame }> = []

async function request(id: number, method: string, params: Record<string, unknown>): Promise<Frame> {
  const before = frames.length
  await connection.handle({ jsonrpc: '2.0', id, method, params })
  const response = frames.slice(before).find((frame) => frame.id === id)
  assert.ok(response, `${method} did not respond`)
  exchanges.push({ method, params, response })
  return response
}

const initialized = await request(1, 'initialize', {
  channel: 'ahp-root://',
  protocolVersions: ['0.7.0', '0.6.0'],
  clientId: 'smoke-client',
  clientInfo: { name: 'ahp-smoke', title: 'AHP smoke client' },
  initialSubscriptions: ['ahp-root://'],
})
assert.equal(initialized.result.protocolVersion, '0.7.0')
assert.equal(initialized.result.serverSeq, 0)
assert.equal(initialized.result.snapshots[0].resource, 'ahp-root://')
assert.equal(initialized.result.snapshots[0].state.agents.length, 5)

const unsupported = await request(2, 'initialize', {
  channel: 'ahp-root://',
  protocolVersions: ['9.0.0'],
  clientId: 'other',
})
assert.equal(unsupported.error.code, -32600, 'a second initialize must be rejected as an invalid request')

const unsupportedFrames: Frame[] = []
const unsupportedConnection = host.createConnection((message) => unsupportedFrames.push(message))
await unsupportedConnection.handle({
  jsonrpc: '2.0',
  id: 20,
  method: 'initialize',
  params: {
    channel: 'ahp-root://',
    protocolVersions: ['9.0.0'],
    clientId: 'unsupported-client',
  },
})
assert.equal(unsupportedFrames.find((frame) => frame.id === 20)?.error.code, -32005)
unsupportedConnection.close()

const workspaceUri = pathToFileURL(`${process.cwd()}${path.sep}`).href
const readmeUri = new URL('README.md', workspaceUri).href
const resourcesUri = new URL('ahp-resources/', workspaceUri).href
const resourceFileUri = new URL('ahp-resources/value.txt', workspaceUri).href
const copiedFileUri = new URL('ahp-resources/copied.txt', workspaceUri).href
const movedFileUri = new URL('ahp-resources/moved.txt', workspaceUri).href

const deniedBeforeGrant = await request(200, 'resourceRead', {
  channel: 'ahp-root://',
  uri: readmeUri,
  encoding: 'utf-8',
})
assert.equal(deniedBeforeGrant.error.code, -32009)
assert.equal(deniedBeforeGrant.error.data.request.uri, readmeUri)
assert.equal(deniedBeforeGrant.error.data.request.read, true)
assert.ok((await request(201, 'resourceRequest', {
  channel: 'ahp-root://',
  uri: workspaceUri,
  read: true,
  write: true,
})).result)

const rootListing = await request(21, 'resourceList', { channel: 'ahp-root://', uri: workspaceUri })
assert.ok(rootListing.result, JSON.stringify(rootListing.error))
assert.ok(rootListing.result.entries.some((entry: Frame) => entry.name === 'README.md' && entry.type === 'file'))
const resolvedReadme = await request(22, 'resourceResolve', { channel: 'ahp-root://', uri: readmeUri })
assert.equal(resolvedReadme.result.type, 'file')
assert.ok(resolvedReadme.result.etag)
const readme = await request(23, 'resourceRead', {
  channel: 'ahp-root://',
  uri: readmeUri,
  encoding: 'utf-8',
})
assert.equal(readme.result.data, 'AHP smoke\n')

assert.equal((await request(24, 'resourceMkdir', { channel: 'ahp-root://', uri: resourcesUri })).result != null, true)
await request(25, 'resourceWrite', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  data: 'alpha',
  encoding: 'utf-8',
})
const firstVersion = await request(26, 'resourceResolve', { channel: 'ahp-root://', uri: resourceFileUri })
await request(27, 'resourceWrite', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  data: '-omega',
  encoding: 'utf-8',
  mode: 'append',
  ifMatch: firstVersion.result.etag,
})
await request(28, 'resourceWrite', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  data: '+',
  encoding: 'utf-8',
  mode: 'insert',
  position: 5,
})
const edited = await request(29, 'resourceRead', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  encoding: 'utf-8',
})
assert.equal(edited.result.data, 'alpha+-omega')
assert.equal((await request(219, 'resourceWrite', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  data: 'stale',
  encoding: 'utf-8',
  ifMatch: firstVersion.result.etag,
})).error.code, -32011)
assert.equal((await request(220, 'resourceWrite', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  data: 'duplicate',
  encoding: 'utf-8',
  createOnly: true,
})).error.code, -32010)

const createdWatch = await request(202, 'createResourceWatch', {
  channel: 'ahp-root://',
  uri: resourcesUri,
  recursive: true,
  includes: { items: ['*.txt'] },
})
assert.match(createdWatch.result.channel, /^ahp-resource-watch:\//)
const watchChannel = createdWatch.result.channel
const watchSubscription = await request(203, 'subscribe', { channel: watchChannel })
assert.equal(watchSubscription.result.snapshot.resource, watchChannel)
assert.match(watchSubscription.result.snapshot.state.root, /\/ahp-resources$/)
assert.equal(watchSubscription.result.snapshot.state.recursive, true)
await new Promise((resolve) => setTimeout(resolve, 50))
await request(204, 'resourceWrite', {
  channel: 'ahp-root://',
  uri: resourceFileUri,
  data: 'watched',
  encoding: 'utf-8',
})
const watchAction = await new Promise<Frame>((resolve, reject) => {
  const deadline = Date.now() + 3_000
  const poll = () => {
    const found = frames.find((frame) =>
      frame.method === 'action'
      && frame.params.channel === watchChannel
      && frame.params.action.type === 'resourceWatch/changed')
    if (found) return resolve(found)
    if (Date.now() >= deadline) return reject(new Error('resource watch action timed out'))
    setTimeout(poll, 20)
  }
  poll()
})
assert.equal(watchAction.params.action.changes.items[0].uri, resourceFileUri)
await connection.handle({
  jsonrpc: '2.0',
  method: 'unsubscribe',
  params: { channel: watchChannel },
})
const releasedWatch = await request(205, 'subscribe', { channel: watchChannel })
assert.equal(releasedWatch.error.code, -32008)

const terminalChannel = 'ahp-terminal:/smoke'
assert.equal((await request(206, 'createTerminal', {
  channel: terminalChannel,
  claim: { kind: 'client', clientId: 'smoke-client' },
  name: 'AHP smoke shell',
  cwd: workspaceUri,
  cols: 100,
  rows: 28,
})).result, null)
const terminalSubscription = await request(207, 'subscribe', { channel: terminalChannel })
assert.equal(terminalSubscription.result.snapshot.resource, terminalChannel)
assert.equal(terminalSubscription.result.snapshot.state.title, 'AHP smoke shell')
assert.equal(terminalSubscription.result.snapshot.state.isPty, false)
await connection.handle({
  jsonrpc: '2.0',
  method: 'dispatchAction',
  params: {
    channel: terminalChannel,
    clientSeq: 8,
    action: { type: 'terminal/titleChanged', title: 'Renamed shell' },
  },
})
await connection.handle({
  jsonrpc: '2.0',
  method: 'dispatchAction',
  params: {
    channel: terminalChannel,
    clientSeq: 9,
    action: { type: 'terminal/input', data: "printf 'AHP_TERMINAL_OK\\n'\n" },
  },
})
const terminalOutput = await new Promise<Frame>((resolve, reject) => {
  const deadline = Date.now() + 3_000
  const poll = () => {
    const found = frames.find((frame) =>
      frame.method === 'action'
      && frame.params.channel === terminalChannel
      && frame.params.action.type === 'terminal/data'
      && frame.params.action.data.includes('AHP_TERMINAL_OK'))
    if (found) return resolve(found)
    if (Date.now() >= deadline) return reject(new Error('terminal output action timed out'))
    setTimeout(poll, 20)
  }
  poll()
})
assert.match(terminalOutput.params.action.data, /AHP_TERMINAL_OK/)
assert.equal((await request(208, 'disposeTerminal', { channel: terminalChannel })).result, null)
const missingTerminal = await request(209, 'subscribe', { channel: terminalChannel })
assert.equal(missingTerminal.error.code, -32008)

assert.equal((await request(30, 'resourceCopy', {
  channel: 'ahp-root://',
  source: resourceFileUri,
  destination: copiedFileUri,
})).result != null, true)
assert.equal((await request(31, 'resourceMove', {
  channel: 'ahp-root://',
  source: copiedFileUri,
  destination: movedFileUri,
})).result != null, true)
assert.equal((await request(32, 'resourceDelete', {
  channel: 'ahp-root://',
  uri: resourcesUri,
  recursive: true,
})).result != null, true)
const deniedOutside = await request(33, 'resourceRead', {
  channel: 'ahp-root://',
  uri: new URL('file:///etc/passwd').href,
})
assert.equal(deniedOutside.error.code, -32009)

const sessionChannel = 'ahp-session:/ahp-smoke-run'
const beforeCreate = frames.length
const created = await request(3, 'createSession', {
  channel: sessionChannel,
  provider: 'codex',
  workingDirectories: [`file://${testCwd}`],
  config: { objective: 'Verify AHP Coordinator interoperability', maxAgents: 3 },
})
assert.equal(created.result, null)
const createFrames = frames.slice(beforeCreate)
const added = createFrames.find((frame) => frame.method === 'root/sessionAdded')
assert.equal(added?.params.channel, 'ahp-root://')
assert.equal(added?.params.summary.resource, sessionChannel)

const listed = await request(4, 'listSessions', {
  channel: 'ahp-root://',
  limit: 1,
})
assert.equal(listed.result.items.length, 1)
assert.equal(listed.result.items[0].resource, sessionChannel)
assert.equal(listed.result.items[0].workingDirectories[0], `file://${testCwd}`)

const subscribed = await request(5, 'subscribe', { channel: sessionChannel })
assert.equal(subscribed.result.snapshot.resource, sessionChannel)
assert.equal(subscribed.result.snapshot.state.lifecycle, 'ready')
assert.equal(subscribed.result.snapshot.state.chats.length, 1)
assert.equal(subscribed.result.snapshot.state.activeClients[0].clientId, 'smoke-client')
assert.ok(subscribed.result.snapshot.state._meta['dev.agent-viewer.coordinator'])
const chatChannel = subscribed.result.snapshot.state.defaultChat
assert.equal((await request(210, 'ping', { channel: 'ahp-root://' })).result, null)
const resolvedConfig = await request(211, 'resolveSessionConfig', {
  channel: 'ahp-root://',
  provider: 'codex',
  workingDirectory: workspaceUri,
  config: { maxAgents: 3 },
})
assert.equal(resolvedConfig.result.values.maxAgents, 3)
assert.deepEqual((await request(212, 'sessionConfigCompletions', {
  channel: 'ahp-root://',
  property: 'objective',
  query: 'verify',
})).result.items, [])
assert.deepEqual((await request(213, 'completions', {
  channel: chatChannel,
  kind: 'userMessage',
  text: '@worker',
  offset: 7,
})).result.items, [])
assert.deepEqual((await request(214, 'fetchTurns', { channel: chatChannel })).result, {})
assert.equal((await request(215, 'authenticate', {
  channel: 'ahp-root://',
  resource: 'unadvertised',
  token: 'test-token',
})).error.code, -32602)
assert.equal((await request(216, 'createChat', {
  channel: sessionChannel,
  chat: 'ahp-chat:/unsupported',
})).error.code, -32601)
assert.equal((await request(217, 'disposeChat', {
  channel: chatChannel,
})).error.code, -32601)
assert.equal((await request(218, 'invokeChangesetOperation', {
  channel: 'ahp-changeset:/unsupported',
  operationId: 'unsupported',
})).error.code, -32601)

const seqBeforeAction = frames
  .filter((frame) => frame.method === 'action')
  .map((frame) => Number(frame.params.serverSeq))
  .reduce((maximum, value) => Math.max(maximum, value), 0)
await connection.handle({
  jsonrpc: '2.0',
  method: 'dispatchAction',
  params: {
    channel: sessionChannel,
    clientSeq: 7,
    action: { type: 'session/titleChanged', title: 'optimistic title' },
  },
})
const rejected = frames
  .filter((frame) => frame.method === 'action')
  .find((frame) => frame.params.origin?.clientSeq === 7)
assert.equal(rejected?.params.channel, sessionChannel)
assert.equal(rejected?.params.origin.clientId, 'smoke-client')
assert.match(rejected?.params.rejectionReason ?? '', /not writable/)
assert.ok(rejected.params.serverSeq > seqBeforeAction)

// Model a dropped transport before reconnecting with the same durable client
// identity. The reconnect must cancel the active-client departure grace.
connection.close()
const reconnectFrames: Frame[] = []
const reconnect = host.createConnection((message) => reconnectFrames.push(message))
await reconnect.handle({
  jsonrpc: '2.0',
  id: 6,
  method: 'reconnect',
  params: {
    channel: 'ahp-root://',
    clientId: 'smoke-client',
    lastSeenServerSeq: rejected.params.serverSeq - 1,
    subscriptions: [sessionChannel],
  },
})
const reconnected = reconnectFrames.find((frame) => frame.id === 6)
assert.equal(reconnected?.result.type, 'replay')
assert.equal(reconnected?.result.actions.length, 1)
assert.equal(reconnected?.result.actions[0].origin.clientSeq, 7)

const persistedClients = path.join(
  testCwd,
  '.agent-viewer-data',
  'agent-coordination',
  'ahp-clients.json',
)
assert.equal(statSync(persistedClients).mode & 0o077, 0)

// A restarted host has durable protocol negotiation state but no in-memory
// action buffer. It must return fresh snapshots, never an incorrect empty
// replay for a sequence gap it cannot prove it retained.
const restartedHost = new CoordinatorAhpHost()
const restartedFrames: Frame[] = []
const restartedConnection = restartedHost.createConnection((message) => restartedFrames.push(message))
await restartedConnection.handle({
  jsonrpc: '2.0',
  id: 8,
  method: 'reconnect',
  params: {
    channel: 'ahp-root://',
    clientId: 'smoke-client',
    lastSeenServerSeq: rejected.params.serverSeq,
    subscriptions: [sessionChannel],
  },
})
const restarted = restartedFrames.find((frame) => frame.id === 8)
assert.equal(restarted?.result.type, 'snapshot')
assert.equal(restarted?.result.snapshots[0].resource, sessionChannel)
await restartedConnection.handle({
  jsonrpc: '2.0',
  method: 'unsubscribe',
  params: { channel: sessionChannel },
})
await restartedConnection.handle({
  jsonrpc: '2.0',
  id: 11,
  method: 'subscribe',
  params: { channel: sessionChannel },
})
const afterUnsubscribe = restartedFrames.find((frame) => frame.id === 11)
assert.equal(
  afterUnsubscribe?.result.snapshot.state.activeClients.some(
    (client: Frame) => client.clientId === 'smoke-client',
  ),
  false,
)

reconnect.close()
restartedConnection.close()

// Exercise the host through Microsoft's published TypeScript client, not just
// hand-authored JSON-RPC frames. The published package currently speaks 0.6.
const [referenceClientTransport, referenceServerTransport] = InMemoryTransport.pair()
const referenceHost = new CoordinatorAhpHost()
const referenceConnection = referenceHost.createConnection((message) => referenceServerTransport.send(message))
const referenceServerLoop = (async () => {
  for (;;) {
    const frame = await referenceServerTransport.recv()
    if (!frame) return
    const message = frame.kind === 'parsed'
      ? frame.message
      : JSON.parse(frame.kind === 'text' ? frame.text : Buffer.from(frame.data).toString('utf8'))
    await referenceConnection.handle(message)
  }
})()
const referenceClient = new AhpClient(referenceClientTransport)
referenceClient.connect()
const referenceInitialized = await referenceClient.initialize({
  clientId: 'official-typescript-client',
  protocolVersions: ['0.6.0'],
  initialSubscriptions: ['ahp-root://'],
})
assert.equal(referenceInitialized.protocolVersion, '0.6.0')
assert.equal(referenceInitialized.snapshots[0]?.resource, 'ahp-root://')
const referenceSession = await referenceClient.subscribe(sessionChannel)
assert.equal(referenceSession.result.snapshot?.resource, sessionChannel)
await referenceClient.resourceRequest({ uri: workspaceUri, read: true })
const referenceRead = await referenceClient.resourceRead({ uri: readmeUri, encoding: 'utf-8' as never })
assert.equal(referenceRead.data, 'AHP smoke\n')
await referenceClient.shutdown()
referenceConnection.close()
await referenceServerLoop

const framed = spawn(process.execPath, ['run', path.join(repoRoot, 'bin/agent-viewer-ahp.ts')], {
  cwd: testCwd,
  stdio: ['pipe', 'pipe', 'pipe'],
})
let framedOutput = ''
let framedError = ''
framed.stdout.setEncoding('utf8')
framed.stderr.setEncoding('utf8')
framed.stdout.on('data', (chunk) => { framedOutput += chunk })
framed.stderr.on('data', (chunk) => { framedError += chunk })
framed.stdin.end(`${JSON.stringify({
  jsonrpc: '2.0',
  id: 9,
  method: 'initialize',
  params: {
    channel: 'ahp-root://',
    protocolVersions: ['0.7.0'],
    clientId: 'framed-smoke',
    initialSubscriptions: ['ahp-root://'],
  },
})}\n${JSON.stringify({
  jsonrpc: '2.0',
  id: 10,
  method: 'listSessions',
  params: { channel: 'ahp-root://', limit: 10 },
})}\n`)
const framedExit = await new Promise<number | null>((resolve) => framed.once('exit', resolve))
assert.equal(framedExit, 0, framedError)
const framedResponses = framedOutput.trim().split('\n').map((line) => JSON.parse(line))
const framedResponse = framedResponses.find((frame) => frame.id === 9)
assert.equal(framedResponse?.result.protocolVersion, '0.7.0')
assert.ok(framedResponses.find((frame) => frame.id === 10)?.result.items.length >= 1)

// Exercise the transport shipped by Microsoft's TypeScript client against
// Agent Viewer's standalone WebSocket endpoint.
const portProbe = createServer()
await new Promise<void>((resolve, reject) => {
  portProbe.once('error', reject)
  portProbe.listen(0, '127.0.0.1', resolve)
})
const probeAddress = portProbe.address()
assert.ok(probeAddress && typeof probeAddress === 'object')
const websocketPort = probeAddress.port
await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()))
const websocketHost = spawn(process.execPath, [
  'run',
  path.join(repoRoot, 'bin/agent-viewer-ahp.ts'),
  '--ws',
  `127.0.0.1:${websocketPort}`,
], {
  cwd: testCwd,
  stdio: ['ignore', 'ignore', 'pipe'],
})
websocketHost.stderr.setEncoding('utf8')
const websocketUrl = await new Promise<string>((resolve, reject) => {
  let stderr = ''
  const timeout = setTimeout(() => reject(new Error(`WebSocket host did not start: ${stderr}`)), 3_000)
  websocketHost.stderr.on('data', (chunk) => {
    stderr += chunk
    const match = /listening on (ws:\/\/[^\s]+)/.exec(stderr)
    if (!match) return
    clearTimeout(timeout)
    resolve(match[1]!)
  })
  websocketHost.once('exit', (code) => {
    clearTimeout(timeout)
    reject(new Error(`WebSocket host exited before startup (${code}): ${stderr}`))
  })
})
const websocketTransport = await WebSocketTransport.connect(websocketUrl)
const websocketClient = new AhpClient(websocketTransport)
websocketClient.connect()
const websocketInitialized = await websocketClient.initialize({
  clientId: 'official-websocket-client',
  protocolVersions: ['0.6.0'],
  initialSubscriptions: ['ahp-root://'],
})
assert.equal(websocketInitialized.protocolVersion, '0.6.0')
assert.equal(websocketInitialized.snapshots[0]?.resource, 'ahp-root://')
await websocketClient.shutdown()
websocketHost.kill('SIGTERM')
assert.equal(await new Promise<number | null>((resolve) => websocketHost.once('exit', resolve)), 0)

const schemaDirectory = process.env.AHP_SCHEMA_DIR
if (schemaDirectory) {
  const [{ default: Ajv2020 }] = await Promise.all([import('ajv/dist/2020.js')])
  const schemaFiles = ['actions', 'commands', 'errors', 'notifications', 'state']
  const schemas = new Map<string, Frame>()
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  for (const name of schemaFiles) {
    const schema = JSON.parse(readFileSync(path.join(schemaDirectory, `${name}.schema.json`), 'utf8'))
    // The upstream 0.7 schema currently marks ActionEnvelope.origin required,
    // while the normative TypeScript type and round-trip fixture 025 require
    // server-originated envelopes to omit it. Validate the normative wire form.
    if (schema.$defs?.ActionEnvelope?.required) {
      schema.$defs.ActionEnvelope.required = schema.$defs.ActionEnvelope.required
        .filter((field: string) => field !== 'origin')
    }
    schemas.set(name, schema)
    ajv.addSchema(schema)
  }
  const validateDefinition = (schemaName: string, definition: string, value: unknown, label: string) => {
    const schema = schemas.get(schemaName)!
    assert.ok(schema.$defs[definition], `AHP schema definition missing: ${definition}`)
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` })
    assert.ok(validate(value), `${label}: ${ajv.errorsText(validate.errors, { separator: '\n' })}`)
  }
  const resultDefinition = (method: string, result: Frame): string | undefined => {
    if (method === 'reconnect') {
      return result?.type === 'replay' ? 'ReconnectReplayResult' : 'ReconnectSnapshotResult'
    }
    const definition = `${method[0]!.toUpperCase()}${method.slice(1)}Result`
    return schemas.get('commands')!.$defs[definition] ? definition : undefined
  }
  for (const { method, params, response } of exchanges) {
    const paramsDefinition = `${method[0]!.toUpperCase()}${method.slice(1)}Params`
    validateDefinition('commands', paramsDefinition, params, `${method} params`)
    if (response.result !== undefined) {
      const definition = resultDefinition(method, response.result)
      if (definition) validateDefinition('commands', definition, response.result, `${method} result`)
      else assert.equal(response.result, null, `${method} must return null`)
    }
  }
  const notificationDefinitions: Record<string, [string, string]> = {
    action: ['commands', 'ActionEnvelope'],
    'root/sessionAdded': ['notifications', 'SessionAddedParams'],
    'root/sessionRemoved': ['notifications', 'SessionRemovedParams'],
    'root/sessionSummaryChanged': ['notifications', 'SessionSummaryChangedParams'],
    'root/progress': ['notifications', 'ProgressParams'],
    'auth/required': ['notifications', 'AuthRequiredParams'],
  }
  for (const frame of frames.filter((value) => value.method && value.id === undefined)) {
    const target = notificationDefinitions[frame.method]
    if (target) validateDefinition(target[0], target[1], frame.params, `${frame.method} notification`)
  }
  console.log('AHP 0.7 schema validation passed')
}

console.log('AHP Coordinator smoke passed')

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const testCwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-a2a-facade-'))
process.chdir(testCwd)
execFileSync('git', ['init', '-q'], { cwd: testCwd })

const coordinationDir = path.join(testCwd, '.agent-viewer-data', 'agent-coordination')
mkdirSync(coordinationDir, { recursive: true })
const { Database } = await (0, eval)('import("bun:sqlite")') as {
  Database: new (file: string) => {
    exec(sql: string): void
    prepare(sql: string): { all(): Array<Record<string, unknown>> }
    close(): void
  }
}
const databaseFile = path.join(coordinationDir, 'coordination.sqlite')
const legacyDb = new Database(databaseFile)
legacyDb.exec(`
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta (key, value) VALUES ('schema_version', '13');
  CREATE TABLE protocol_push_configs (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL,
    url TEXT NOT NULL, token TEXT, created_at TEXT NOT NULL, fired_at TEXT
  );
`)
legacyDb.close()

const coordination = await import('../lib/agentCoordination')
const a2a = await import('../lib/a2aAdapter')
const externalActions = await import('../lib/agentCoordinationExternal')
await coordination.readProtocolRun('migration-probe')

const migratedDb = new Database(databaseFile)
const migratedColumns = new Set(migratedDb.prepare("SELECT name FROM pragma_table_info('protocol_push_configs')")
  .all().map((row) => String(row.name)))
migratedDb.close()
assert.ok(migratedColumns.has('auth_scheme'))
assert.ok(migratedColumns.has('auth_credentials'))
assert.ok(migratedColumns.has('last_task_updated_at'))

delete process.env.AGENT_VIEWER_A2A_ENABLED
delete process.env.AGENT_VIEWER_A2A_TOKEN
const disabled = await a2a.handleA2AHttpRequest(new Request('http://localhost/api/a2a', { method: 'POST' }))
assert.equal(disabled.status, 404)

process.env.AGENT_VIEWER_A2A_ENABLED = '1'
process.env.AGENT_VIEWER_A2A_TOKEN = 'facade-smoke-token'

const cardResponse = a2a.handleA2AAgentCardRequest(new Request('http://localhost/.well-known/agent-card.json'))
assert.equal(cardResponse.status, 200)
const card = await cardResponse.json() as Record<string, unknown>
assert.equal(card.protocolVersion, undefined)
assert.deepEqual(card.supportedInterfaces, [{
  url: 'http://localhost/api/a2a',
  protocolBinding: 'JSONRPC',
  protocolVersion: '1.0',
}])
assert.deepEqual(card.securityRequirements, [{ schemes: { bearerAuth: { list: [] } } }])

const run = await coordination.createExternalProtocolRun({
  prompt: 'A2A facade smoke run',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'A2A smoke lead',
  maxAgents: 2,
})
const runId = run.snapshot.run.id
const teammate = await coordination.joinExternalProtocolRun({
  runId,
  provider: 'codex',
  participantName: 'MCP worker',
  cwd: testCwd,
})

function request(body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/a2a', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer facade-smoke-token',
      'A2A-Version': '1.0',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const unauthorized = await a2a.handleA2AHttpRequest(request(
  { jsonrpc: '2.0', id: 'unauthorized', method: 'ListTasks', params: {} },
  { Authorization: 'Bearer wrong-token' },
))
assert.equal(unauthorized.status, 401)

const wrongVersion = await a2a.handleA2AHttpRequest(request(
  { jsonrpc: '2.0', id: 'version', method: 'ListTasks', params: {} },
  { 'A2A-Version': '0.3' },
))
assert.equal(wrongVersion.status, 400)
assert.equal((await wrongVersion.json()).error.code, -32009)

const send = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0',
  id: 'send',
  method: 'SendMessage',
  params: {
    message: {
      messageId: 'message-1',
      contextId: runId,
      role: 'ROLE_USER',
      parts: [{ text: 'Verify the gated A2A facade' }],
    },
    configuration: { returnImmediately: true },
  },
}))
assert.equal(send.status, 200)
const sendBody = await send.json() as {
  result: { task: { id: string; contextId: string; metadata: { coordinatorTaskId: string } } }
}
assert.equal(sendBody.result.task.contextId, runId)
assert.match(sendBody.result.task.id, new RegExp(`^${runId}:task-`))

const get = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0', id: 'get', method: 'GetTask', params: { id: sendBody.result.task.id },
}))
assert.equal((await get.json()).result.id, sendBody.result.task.id)

const list = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0', id: 'list', method: 'ListTasks', params: { contextId: runId, pageSize: 1 },
}))
const listBody = await list.json()
assert.equal(listBody.result.pageSize, 1)
assert.equal(listBody.result.totalSize, 1)
assert.equal(listBody.result.tasks[0].artifacts, undefined)

const pushCreate = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0',
  id: 'push-create',
  method: 'CreateTaskPushNotificationConfig',
  params: {
    taskId: sendBody.result.task.id,
    url: 'https://webhook.example.test/a2a',
    token: 'verification-token',
    authentication: { scheme: 'Bearer', credentials: 'delivery-token' },
  },
}))
const pushConfig = (await pushCreate.json()).result
assert.equal(pushConfig.taskId, sendBody.result.task.id)
assert.deepEqual(pushConfig.authentication, { scheme: 'Bearer', credentials: 'delivery-token' })

const pushList = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0',
  id: 'push-list',
  method: 'ListTaskPushNotificationConfigs',
  params: { taskId: sendBody.result.task.id },
}))
assert.equal((await pushList.json()).result.configs.length, 1)

for (const id of ['push-delete', 'push-delete-again']) {
  const deleted = await a2a.handleA2AHttpRequest(request({
    jsonrpc: '2.0',
    id,
    method: 'DeleteTaskPushNotificationConfig',
    params: { taskId: sendBody.result.task.id, id: pushConfig.id },
  }))
  assert.deepEqual((await deleted.json()).result, {})
}

const continuation = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0',
  id: 'continuation',
  method: 'SendMessage',
  params: {
    message: {
      messageId: 'message-2',
      contextId: runId,
      taskId: sendBody.result.task.id,
      role: 'ROLE_USER',
      parts: [{ text: 'Continue' }],
    },
    configuration: { returnImmediately: true },
  },
}))
assert.equal((await continuation.json()).error.code, -32004)

const legacy = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0', id: 'legacy', method: 'tasks/get', params: { id: sendBody.result.task.id },
}))
assert.equal((await legacy.json()).error.code, -32601)

const cancelCandidate = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0',
  id: 'send-cancel-candidate',
  method: 'SendMessage',
  params: {
    message: {
      messageId: 'message-3',
      contextId: runId,
      role: 'ROLE_USER',
      parts: [{ text: 'Cancel this separate task' }],
    },
    configuration: { returnImmediately: true },
  },
}))
const cancelTaskId = (await cancelCandidate.json()).result.task.id

const participant = teammate.participant
const claimedThroughMcpCore = await externalActions.executeExternalCoordinatorAction({
  action: 'claim_task',
  runId: participant.runId,
  agentId: participant.agentId,
  token: participant.token,
  taskId: sendBody.result.task.metadata.coordinatorTaskId,
}) as { task: { id: string; status: string } }
assert.equal(claimedThroughMcpCore.task.status, 'claimed')
await externalActions.executeExternalCoordinatorAction({
  action: 'complete_task',
  runId: participant.runId,
  agentId: participant.agentId,
  token: participant.token,
  taskId: claimedThroughMcpCore.task.id,
  summary: 'The MCP-backed worker completed the A2A-created task.',
})
const completedThroughA2A = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0', id: 'completed-get', method: 'GetTask', params: { id: sendBody.result.task.id },
}))
assert.equal((await completedThroughA2A.json()).result.status.state, 'TASK_STATE_COMPLETED')

const cancelled = await a2a.handleA2AHttpRequest(request({
  jsonrpc: '2.0', id: 'cancel', method: 'CancelTask', params: { id: cancelTaskId },
}))
assert.equal((await cancelled.json()).result.status.state, 'TASK_STATE_CANCELED')

console.log('Gated A2A 1.0 facade smoke passed')

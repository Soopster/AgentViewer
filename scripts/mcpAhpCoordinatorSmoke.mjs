import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const repoRoot = process.cwd()
const testCwd = await mkdtemp(path.join(tmpdir(), 'agent-viewer-mcp-ahp-'))
const launcher = fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url))
const ahpEntrypoint = fileURLToPath(new URL('../bin/agent-viewer-ahp.ts', import.meta.url))
const workerEntrypoint = fileURLToPath(new URL('../bin/agent-viewer-coord-worker.mjs', import.meta.url))
const bun = process.env.BUN_PATH || 'bun'
const fakeCodex = path.join(testCwd, 'fake-codex.mjs')

await writeFile(fakeCodex, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: '019-ahp-worker-smoke' }))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'bounded AHP tick complete' } }))
`)
await chmod(fakeCodex, 0o700)

await writeFile(path.join(testCwd, '.gitignore'), '.agent-viewer-data/\n')
await writeFile(path.join(testCwd, 'README.md'), 'MCP over AHP smoke\n')
await new Promise((resolve, reject) => {
  const child = spawn('git', ['init', '-q'], { cwd: testCwd })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`git init exited ${code}`)))
})
await new Promise((resolve, reject) => {
  const child = spawn('git', ['add', '.gitignore', 'README.md'], { cwd: testCwd })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`git add exited ${code}`)))
})
await new Promise((resolve, reject) => {
  const child = spawn('git', [
    '-c', 'user.name=AHP Smoke',
    '-c', 'user.email=ahp-smoke@example.test',
    'commit', '-qm', 'baseline',
  ], { cwd: testCwd })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`git commit exited ${code}`)))
})

const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const probeAddress = portProbe.address()
assert.ok(probeAddress && typeof probeAddress === 'object')
const websocketPort = probeAddress.port
await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()))
const attachPort = websocketPort - 1

async function startAhpHost() {
  const child = spawn(bun, ['run', ahpEntrypoint, '--ws', `127.0.0.1:${websocketPort}`], {
    cwd: testCwd,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`AHP host did not start: ${stderr}`)), 5_000)
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (!stderr.includes(`ws://127.0.0.1:${websocketPort}`)) return
      clearTimeout(timer)
      resolve()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`AHP host exited during startup (${code}): ${stderr}`))
    })
  })
  return child
}

async function stopAhpHost(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

function createMcpClient(name, identityFile) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, 'mcp', '--attach', String(attachPort), '--identity', identityFile],
    stderr: 'pipe',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: testCwd,
    },
  })
  return {
    client: new Client({ name, version: '1.0.0' }),
    transport,
  }
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  const text = result.content?.find?.((entry) => entry.type === 'text')?.text ?? '{}'
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  return JSON.parse(text)
}

let ahpHost
const leadIdentity = path.join(testCwd, 'lead-identity.json')
const teammateIdentity = path.join(testCwd, 'teammate-identity.json')
const lead = createMcpClient('mcp-ahp-lead', leadIdentity)
const teammate = createMcpClient('mcp-ahp-teammate', teammateIdentity)

try {
  ahpHost = await startAhpHost()
  await lead.client.connect(lead.transport)
  await teammate.client.connect(teammate.transport)

  const before = await call(lead.client, 'coord_list_runs', { limit: 5 })
  assert.deepEqual(before.runs, [], 'coord_list_runs must use the empty AHP host, not an HTTP fallback')

  const created = await call(lead.client, 'coord_create_run', {
    prompt: 'Prove reliable multi-agent coordination over default AHP',
    name: 'ahp-lead',
    provider: 'codex',
    cwd: testCwd,
    max_agents: 2,
  })
  const runId = created.participant?.runId
  assert.ok(runId)
  assert.equal(created.participant.capabilities?.ahpClientId?.length > 0, true)
  assert.equal((await stat(leadIdentity)).mode & 0o077, 0)

  const listed = await call(lead.client, 'coord_list_runs', { limit: 5 })
  assert.equal(listed.runs.some((run) => run.id === runId), true)

  const joined = await call(teammate.client, 'coord_join_run', {
    run_id: runId,
    name: 'ahp-teammate',
    provider: 'codex',
    cwd: testCwd,
  })
  assert.equal(joined.participant.role, 'teammate')
  assert.equal(joined.participant.capabilities?.ahpClientId?.length > 0, true)
  assert.equal((await stat(teammateIdentity)).mode & 0o077, 0)

  await assert.rejects(
    call(lead.client, 'coord_create_task', {
      title: 'Reject invalid dependency',
      detail: 'A typo in depends_on must not create permanently unclaimable work.',
      depends_on: ['task-999'],
      request_id: 'ahp-smoke-invalid-dependency',
    }),
    /does not identify an existing task/,
  )
  const afterInvalidDependency = await call(lead.client, 'coord_status')
  assert.equal(afterInvalidDependency.snapshot.tasks.length, 0, 'invalid dependencies must not mutate the board')

  const createdTask = await call(lead.client, 'coord_create_task', {
    title: 'Verify the AHP lane',
    detail: 'Claim the task, exchange durable mail, publish a finding, and complete it.',
    request_id: 'ahp-smoke-create-task',
  })
  const taskId = createdTask.task?.id
  assert.ok(taskId)
  const retriedTask = await call(lead.client, 'coord_create_task', {
    title: 'Verify the AHP lane',
    detail: 'Claim the task, exchange durable mail, publish a finding, and complete it.',
    request_id: 'ahp-smoke-create-task',
  })
  assert.equal(retriedTask.task?.id, taskId, 'AHP mutation retries must replay the cached result')
  const afterRetry = await call(lead.client, 'coord_status')
  assert.equal(afterRetry.snapshot.tasks.filter((task) => task.id === taskId).length, 1)
  const claimed = await call(teammate.client, 'coord_claim_task', { task_id: taskId })
  assert.equal(claimed.task?.ownerAgentId, joined.participant.agentId)
  await assert.rejects(
    call(lead.client, 'coord_progress', {
      status: 'working',
      task_id: taskId,
      summary: 'A stale non-owner must not steal this task through progress',
    }),
    /does not own the task/,
  )
  const afterRejectedProgress = await call(lead.client, 'coord_status')
  assert.equal(
    afterRejectedProgress.snapshot.tasks.find((task) => task.id === taskId)?.ownerAgentId,
    joined.participant.agentId,
    'rejected non-owner progress must preserve the authoritative task owner',
  )

  await call(lead.client, 'coord_send_message', {
    to: 'ahp-teammate',
    message: `Please verify ${taskId}`,
    kind: 'request',
    reply_required: true,
    correlation_id: `verify-${taskId}`,
  })
  const teammateInbox = await call(teammate.client, 'coord_read_inbox')
  const request = teammateInbox.messages?.find((message) => message.body === `Please verify ${taskId}`)
  assert.ok(request)
  await call(teammate.client, 'coord_send_message', {
    to: 'ahp-lead',
    message: `${taskId} is underway`,
    kind: 'response',
    in_reply_to: request.id,
  })
  const leadInbox = await call(lead.client, 'coord_read_inbox')
  assert.equal(leadInbox.messages?.some((message) => message.body === `${taskId} is underway`), true)

  // Advance the teammate's wait cursor, then restart the host while its next
  // long poll is in flight. The same call must reconnect automatically,
  // preserve the AHP client ID/subscription, and wake on the lead's next event.
  await call(teammate.client, 'coord_wait', { timeout_ms: 0 })
  const interruptedWait = call(teammate.client, 'coord_wait', { timeout_ms: 55_000 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await stopAhpHost(ahpHost)
  ahpHost = await startAhpHost()
  const leadAfterRestart = await call(lead.client, 'coord_status')
  await call(lead.client, 'coord_send_message', {
    to: 'ahp-teammate',
    message: 'AHP host restarted; continue the lane',
    kind: 'request',
  })
  const resumedWait = await interruptedWait
  assert.equal(resumedWait.changed, true)
  assert.equal(resumedWait.actionable?.inboxCount > 0, true)
  const recoveryInbox = await call(teammate.client, 'coord_read_inbox')
  assert.equal(recoveryInbox.messages?.some((message) => (
    message.body === 'AHP host restarted; continue the lane'
  )), true)
  const teammateAfterRestart = await call(teammate.client, 'coord_status')
  for (const status of [leadAfterRestart, teammateAfterRestart]) {
    assert.equal(status.snapshot.run.id, runId)
    const connected = status.snapshot.agents.filter((agent) => agent.capabilities?.ahpClientId)
    assert.equal(connected.length, 2, 'both AHP participants must remain active after host restart')
  }

  // Supervisor shutdown must be different from an accidental transport loss:
  // closing a long-poll socket after abort may not trigger the safe-wait retry
  // and reconnect for another 55 seconds.
  const { CoordinatorAhpClient } = await import('../bin/agent-viewer-ahp-client.mjs')
  const shutdownClient = new CoordinatorAhpClient({
    attachUrl: `http://127.0.0.1:${attachPort}`,
    clientId: 'shutdown-abort-smoke',
    title: 'AHP shutdown abort smoke',
  })
  const shutdownRun = await shutdownClient.request('create_run', {
    prompt: 'Abort an in-flight AHP Coordinator wait promptly',
    cwd: testCwd,
    provider: 'codex',
    name: 'shutdown-abort-smoke',
    maxAgents: 2,
    client: { name: 'shutdown-abort-smoke', protocolVersion: 2 },
  })
  const shutdownCursor = await shutdownClient.request('wait', {
    ...shutdownRun.participant,
    timeoutMs: 0,
  })
  const shutdownAbort = new AbortController()
  const shutdownWait = shutdownClient.request('wait', {
    ...shutdownRun.participant,
    cursor: shutdownCursor.cursor,
    timeoutMs: 55_000,
  }, 65_000, shutdownAbort.signal)
  await new Promise((resolve) => setTimeout(resolve, 50))
  shutdownAbort.abort(new Error('supervisor shutdown'))
  shutdownClient.close()
  await assert.rejects(
    Promise.race([
      shutdownWait,
      new Promise((_, reject) => setTimeout(() => reject(new Error('AHP shutdown wait did not abort promptly')), 2_000)),
    ]),
    /supervisor shutdown/,
  )
  const retiredShutdownLead = await shutdownClient.request('leave_run', {
    ...shutdownRun.participant,
    reason: 'AHP shutdown smoke retired its bounded participant',
    requestId: 'ahp-shutdown-leave',
  })
  assert.equal(retiredShutdownLead.runStatus, 'failed')
  shutdownClient.close()

  // A bounded supervisor can finish its model turn while still owning a task.
  // Exercise the real worker process so the smoke also proves that the AHP
  // socket opened for its shutdown checkpoint is closed and the OS process
  // exits instead of merely writing an "exiting" worker record.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      workerEntrypoint,
      '--identity', teammateIdentity,
      '--attach', String(attachPort),
      '--once',
    ], {
      cwd: testCwd,
      env: { ...process.env, CODEX_PATH: fakeCodex },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`bounded AHP worker did not exit: ${stderr}`))
    }, 15_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`bounded AHP worker exited ${code}: ${stderr}`))
    })
  })
  const afterStoppedHandoff = await call(lead.client, 'coord_status')
  assert.equal(afterStoppedHandoff.snapshot.tasks.find((task) => task.id === taskId)?.status, 'pending')
  assert.equal(afterStoppedHandoff.snapshot.tasks.find((task) => task.id === taskId)?.ownerAgentId, undefined)
  assert.equal(
    afterStoppedHandoff.snapshot.agents.find((agent) => agent.id === joined.participant.agentId)?.status,
    'stopped',
  )
  const reclaimed = await call(lead.client, 'coord_claim_task', {
    task_id: taskId,
    request_id: 'ahp-smoke-lead-reclaim-after-handoff',
  })
  assert.equal(reclaimed.task?.ownerAgentId, created.participant.agentId)

  await call(lead.client, 'coord_progress', {
    status: 'working',
    task_id: taskId,
    summary: 'AHP reconnect and mailbox verified',
  })
  await call(lead.client, 'coord_publish_finding', {
    kind: 'finding',
    task_id: taskId,
    summary: 'Default AHP preserved the participant and mailbox across restart',
  })
  const completed = await call(lead.client, 'coord_complete_task', {
    task_id: taskId,
    summary: 'Verified the default AHP multi-agent path',
  })
  assert.equal(completed.accepted, true)

  const finalStatus = await call(lead.client, 'coord_status')
  assert.equal(finalStatus.snapshot.tasks.find((task) => task.id === taskId)?.status, 'completed')
  assert.equal(finalStatus.snapshot.events.some((event) => (
    event.agentId === created.participant.agentId && event.type === 'finding'
  )), true)
  const finalized = await call(lead.client, 'coord_finalize_run', {
    summary: 'Two MCP clients coordinated through default AHP and recovered from a host restart.',
  })
  assert.equal(finalized.run.status, 'completed')

  const savedLead = JSON.parse(await readFile(leadIdentity, 'utf8'))
  const savedTeammate = JSON.parse(await readFile(teammateIdentity, 'utf8'))
  assert.equal(savedLead.runId, runId)
  assert.equal(savedTeammate.runId, runId)
  await chmod(leadIdentity, 0o600)
} finally {
  await lead.client.close().catch(() => {})
  await teammate.client.close().catch(() => {})
  await stopAhpHost(ahpHost).catch(() => {})
}

console.log('Default AHP multi-agent MCP smoke passed')

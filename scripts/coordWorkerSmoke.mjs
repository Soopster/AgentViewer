import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeWorkerRecord } from '../bin/agent-viewer-coord-state.mjs'

process.env.AGENT_VIEWER_COORD_TRANSPORT = 'http'

const testDir = await mkdtemp(path.join(tmpdir(), 'agent-viewer-coord-worker-'))
const spawnedChildren = new Set()
function spawn(...args) {
  const child = nodeSpawn(...args)
  spawnedChildren.add(child)
  child.once('exit', () => spawnedChildren.delete(child))
  return child
}
const smokeDeadline = setTimeout(() => {
  for (const child of spawnedChildren) {
    try { child.kill('SIGKILL') } catch {}
  }
  console.error('Coordinator worker smoke exceeded its 90s global deadline')
  process.exit(1)
}, 90_000)
const fakeCodex = path.join(testDir, 'fake-codex.mjs')
const failingCodex = path.join(testDir, 'failing-codex.mjs')
const rateLimitedCodex = path.join(testDir, 'rate-limited-codex.mjs')
const zeroExitErrorPi = path.join(testDir, 'zero-exit-error-pi.mjs')
const continuationCodex = path.join(testDir, 'continuation-codex.mjs')
const shutdownCodex = path.join(testDir, 'shutdown-codex.mjs')
const oversizedCodex = path.join(testDir, 'oversized-codex.mjs')
const slowVersionCli = path.join(testDir, 'slow-version-cli.mjs')
const identityFile = path.join(testDir, 'identity.json')
const startIdentityFile = path.join(testDir, 'start-identity.json')
const terminalIdentityFile = path.join(testDir, 'terminal-identity.json')
const onceFailureIdentityFile = path.join(testDir, 'once-failure-identity.json')
const ownershipRecoveryIdentityFile = path.join(testDir, 'ownership-recovery-identity.json')
const preclaimFailureIdentityFile = path.join(testDir, 'preclaim-failure-identity.json')
const zeroExitErrorIdentityFile = path.join(testDir, 'zero-exit-error-identity.json')
const onceFailedOwnedIdentityFile = path.join(testDir, 'once-failed-owned-identity.json')
const onceOwnedIdentityFile = path.join(testDir, 'once-owned-identity.json')
const onceCheckpointRecoveryIdentityFile = path.join(testDir, 'once-checkpoint-recovery-identity.json')
const handoffIdentityFile = path.join(testDir, 'handoff-identity.json')
const continuationIdentityFile = path.join(testDir, 'continuation-identity.json')
const shutdownIdentityFile = path.join(testDir, 'shutdown-identity.json')
const timeoutIdentityFile = path.join(testDir, 'timeout-identity.json')
const inactivityIdentityFile = path.join(testDir, 'inactivity-identity.json')
const activeTerminalIdentityFile = path.join(testDir, 'active-terminal-identity.json')
const oversizedIdentityFile = path.join(testDir, 'oversized-identity.json')
const activeDeletedIdentityFile = path.join(testDir, 'active-deleted-identity.json')
const coordHome = path.join(testDir, 'coord-home')
const codexArgsFile = path.join(testDir, 'codex-args.json')
const continuationCountFile = path.join(testDir, 'continuation-count.txt')
const shutdownReadyFile = path.join(testDir, 'shutdown-ready.txt')
const shutdownMarkerFile = path.join(testDir, 'shutdown-marker.txt')
const timeoutReadyFile = path.join(testDir, 'timeout-ready.txt')
const timeoutMarkerFile = path.join(testDir, 'timeout-marker.txt')
const inactivityReadyFile = path.join(testDir, 'inactivity-ready.txt')
const inactivityMarkerFile = path.join(testDir, 'inactivity-marker.txt')
const activeTerminalReadyFile = path.join(testDir, 'active-terminal-ready.txt')
const activeTerminalMarkerFile = path.join(testDir, 'active-terminal-marker.txt')
const activeDeletedReadyFile = path.join(testDir, 'active-deleted-ready.txt')
const activeDeletedMarkerFile = path.join(testDir, 'active-deleted-marker.txt')
await writeFile(fakeCodex, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.CODEX_ARGS_FILE, JSON.stringify(process.argv.slice(2)))
console.log(JSON.stringify({ type: 'thread.started', thread_id: '019-worker-smoke' }))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'tick complete' } }))
`)
await chmod(fakeCodex, 0o700)
await writeFile(failingCodex, `#!/usr/bin/env node
process.exit(1)
`)
await chmod(failingCodex, 0o700)
await writeFile(rateLimitedCodex, `#!/usr/bin/env node
console.error('429 rate limit exceeded; quota window exhausted')
process.exit(1)
`)
await chmod(rateLimitedCodex, 0o700)
await writeFile(zeroExitErrorPi, `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'turn_end',
  message: { stopReason: 'error', errorMessage: 'Your credit balance is too low to access the API.' },
}))
process.exit(0)
`)
await chmod(zeroExitErrorPi, 0o700)
await writeFile(continuationCodex, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
let count = 0
try { count = Number(readFileSync(process.env.CONTINUATION_COUNT_FILE, 'utf8')) || 0 } catch {}
count += 1
writeFileSync(process.env.CONTINUATION_COUNT_FILE, String(count))
console.log(JSON.stringify({ type: 'thread.started', thread_id: '019-worker-continuation' }))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'continuation tick complete' } }))
`)
await chmod(continuationCodex, 0o700)
await writeFile(shutdownCodex, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.SHUTDOWN_READY_FILE, String(process.pid))
console.log(JSON.stringify({ type: 'thread.started', thread_id: '019-worker-shutdown-durable' }))
process.on('SIGTERM', () => {
  writeFileSync(process.env.SHUTDOWN_MARKER_FILE, 'term received')
})
setInterval(() => {}, 1_000)
`)
await chmod(shutdownCodex, 0o700)
await writeFile(oversizedCodex, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: '019-worker-after-oversized-frame' }))
process.stdout.write('x'.repeat(12_000))
await new Promise((resolve) => setTimeout(resolve, 50))
process.stdout.write(JSON.stringify({ thread_id: 'poisoned-session-from-discarded-tail' }) + '\\n')
`)
await chmod(oversizedCodex, 0o700)
await writeFile(slowVersionCli, `#!/usr/bin/env node
process.on('SIGTERM', () => {})
setTimeout(() => process.exit(0), 1_200)
`)
await chmod(slowVersionCli, 0o700)
await writeFile(path.join(testDir, '.gitignore'), '.agent-viewer-data/\n')
await writeFile(path.join(testDir, 'README.md'), 'worker smoke\n')
execFileSync('git', ['init', '-q'], { cwd: testDir })
execFileSync('git', ['config', 'user.email', 'worker-smoke@example.test'], { cwd: testDir })
execFileSync('git', ['config', 'user.name', 'Worker Smoke'], { cwd: testDir })
execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: testDir })
execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: testDir })

const requests = []
let handoffMode = false
let continuationMode = false
let onceOwnedMode = false
let onceFailedOwnedMode = false
let ownershipRecoveryMode = false
let ownershipWaitFailuresRemaining = 0
let onceCheckpointRecoveryWaits = 0
let shutdownMode = false
let timeoutMode = false
let inactivityMode = false
let deletedMode = false

async function waitForFile(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await readFile(file, 'utf8') } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${file}`)
}

async function waitForJsonValue(file, key, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (value?.[key] === expected) return value
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${key}=${expected} in ${file}`)
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`command timed out: ${args.join(' ')}`))
    }, 15_000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      code === 0 ? resolve(stdout) : reject(new Error(`command exited ${code}: ${stderr || stdout}`))
    })
  })
}
const snapshot = {
  run: { id: 'run-worker', prompt: 'smoke goal', status: 'running', provider: 'codex', baseCwd: testDir, maxAgents: 4, leadAgentId: 'lead-worker' },
  agents: [], tasks: [], locks: [], messages: [], events: [],
}
const daemon = createServer(async (request, response) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = raw ? JSON.parse(raw) : {}
  requests.push(body)
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('X-Agent-Viewer-Coord-Protocol', '2')
  if (body.action === 'join_run') {
    if (body.name === 'rejected-worker') {
      response.statusCode = 409
      response.end(JSON.stringify({ error: 'run is full' }))
      return
    }
    response.end(JSON.stringify({
      participant: {
        runId: 'run-worker', agentId: 'lead-worker', token: 'worker-secret', name: body.name,
        role: body.name === 'lead-continuation-worker' ? 'lead' : 'teammate', provider: body.provider, cwd: body.cwd,
      },
      snapshot,
    }))
    return
  }
  if (body.action === 'create_run') {
    response.end(JSON.stringify({
      participant: {
        runId: 'run-worker', agentId: 'lead-worker', token: 'worker-secret', name: body.name,
        role: 'lead', provider: body.provider, cwd: body.cwd,
      },
      snapshot,
    }))
    return
  }
  if (body.action === 'wait') {
    if (body.name === 'once-checkpoint-recovery-worker') {
      onceCheckpointRecoveryWaits += 1
      if (onceCheckpointRecoveryWaits === 1 || onceCheckpointRecoveryWaits === 2) {
        response.statusCode = 503
        response.end(JSON.stringify({ error: 'temporary checkpoint outage' }))
        return
      }
    }
    if (ownershipRecoveryMode && ownershipWaitFailuresRemaining > 0) {
      ownershipWaitFailuresRemaining -= 1
      response.statusCode = 503
      response.end(JSON.stringify({ error: 'temporary Coordinator outage' }))
      return
    }
    if (deletedMode) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Coordinator run not found' }))
      return
    }
    let continuationCount = 0
    if (continuationMode) {
      try { continuationCount = Number(await readFile(continuationCountFile, 'utf8')) || 0 } catch {}
    }
    const continuationComplete = continuationMode && continuationCount >= 3
    response.end(JSON.stringify({
      changed: false,
      timedOut: true,
      cursor: null,
      snapshot,
      inbox: { messages: [], nextCursor: null },
      events: [],
      actionable: {
        runStatus: continuationComplete ? 'completed' : snapshot.run.status,
        inboxCount: 0,
        urgentCount: 0,
        statusCount: 0,
        replyRequiredCount: 0,
        claimableTasks: continuationMode && body.role === 'lead' && continuationCount === 1
          ? [{ id: 'task-lead-integration', title: 'Lead integration' }]
          : [],
        plansAwaitingReview: [],
        myTask: onceOwnedMode
          ? { id: 'task-once-owned', status: 'in_progress', planState: 'approved' }
          : onceFailedOwnedMode
          ? { id: 'task-once-failed-owned', status: 'in_progress', planState: 'approved' }
          : ownershipRecoveryMode
          ? { id: 'task-ownership-recovery', status: 'in_progress', planState: 'approved' }
          : timeoutMode
          ? { id: 'task-timeout', status: 'in_progress', planState: 'approved' }
          : inactivityMode
          ? { id: 'task-inactivity', status: 'in_progress', planState: 'approved' }
          : shutdownMode
          ? { id: 'task-shutdown', status: 'in_progress', planState: 'approved' }
          : handoffMode
          ? { id: 'task-handoff', status: 'in_progress', planState: 'approved' }
          : continuationMode && continuationCount === 2
            ? { id: 'task-continuation', status: 'in_progress', planState: 'approved' }
            : null,
        allTasksTerminal: continuationComplete || snapshot.run.status === 'completed',
      },
    }))
    return
  }
  if (body.action === 'handoff_task') {
    response.end(JSON.stringify({ runStatus: 'running', task: { id: body.taskId, status: 'pending' } }))
    return
  }
  if (body.action === 'leave_run') {
    response.end(JSON.stringify({ runStatus: 'running', actionable: { runStatus: 'running' } }))
    return
  }
  response.end(JSON.stringify(snapshot))
})
daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const address = daemon.address()
if (!address || typeof address === 'string') throw new Error('worker smoke daemon did not bind')

const worker = fileURLToPath(new URL('../bin/agent-viewer-coord-worker.mjs', import.meta.url))
const admin = fileURLToPath(new URL('../bin/agent-viewer-coord-admin.mjs', import.meta.url))

let invalidOptionRejected = false
try {
  await runNode([worker, '--join', 'run-worker', '--name', 'typo-worker', '--provder', 'codex'], process.env)
} catch (error) {
  invalidOptionRejected = String(error).includes('Unknown argument: --provder')
}
if (!invalidOptionRejected) throw new Error('worker silently accepted an unknown option')

let ignoredModeOptionRejected = false
try {
  await runNode([worker, '--start', 'smoke', '--name', 'lead', '--shared'], process.env)
} catch (error) {
  ignoredModeOptionRejected = String(error).includes('--shared requires --join')
}
if (!ignoredModeOptionRejected) throw new Error('worker silently accepted a mode option that has no effect')

// Isolated joins create local git state before registration so the submitted
// cwd is accurate. A rejected join must roll that state back completely.
let rejectedJoinFailed = false
try {
  await runNode([
    worker, '--join', 'run-worker', '--name', 'rejected-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--once',
  ], { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: fakeCodex })
} catch (error) {
  rejectedJoinFailed = String(error).includes('run is full')
}
if (!rejectedJoinFailed) throw new Error('rejected isolated join did not surface the Coordinator error')
const rejectedWorktree = path.join(testDir, '.agent-viewer-data', 'coord-worktrees', 'run-worker', 'rejected-worker')
if (await stat(rejectedWorktree).then(() => true).catch(() => false)) {
  throw new Error('rejected isolated join leaked its worktree')
}
const rejectedBranch = execFileSync('git', ['branch', '--list', 'agent-viewer/coord/run-work/rejected-worker'], { cwd: testDir, encoding: 'utf8' })
if (rejectedBranch.trim()) throw new Error('rejected isolated join leaked its branch')

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--start', 'seeded smoke', '--name', 'start-worker', '--provider=codex',
    '--attach', String(address.port), '--cwd', testDir, '--once', '--identity', startIdentityFile,
    '--playbook', 'release-smoke', '--args', '{"release":"next"}', '--max-agents', '8',
    '--gate-command', 'npm run verify', '--require-plan-approval', '--require-review',
    '--autonomy', 'low', '--token-budget', '24000', '--duration-budget', '2.5',
    '--acceptance', '{"goal":"Ship the worker","userVisibleAcceptance":["receipt visible"]}',
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: fakeCodex, CODEX_ARGS_FILE: codexArgsFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`start worker exited ${code}: ${stderr}`)))
})
const createRequest = requests.find((request) => request.action === 'create_run')
if (createRequest?.maxAgents !== 8
  || createRequest?.gateCommand !== 'npm run verify'
  || createRequest?.requirePlanApproval !== true
  || createRequest?.requireReview !== true
  || createRequest?.autonomy !== 'low'
  || createRequest?.budget?.maxTokens !== 24000
  || createRequest?.budget?.maxDurationMinutes !== 2.5
  || createRequest?.acceptanceContract?.goal !== 'Ship the worker'
  || createRequest?.playbookName !== 'release-smoke'
  || createRequest?.args?.release !== 'next') {
  throw new Error('worker start controls were not forwarded to Coordinator run creation')
}

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'worker-smoke', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--once', '--identity', identityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: fakeCodex, CODEX_ARGS_FILE: codexArgsFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`)))
})

const state = JSON.parse(await readFile(identityFile, 'utf8'))
if (state.token !== 'worker-secret') throw new Error('worker did not persist its capability')
if (state.providerSessionId !== '019-worker-smoke') throw new Error('worker did not persist the Codex session id')
if ((await stat(identityFile)).mode & 0o077) throw new Error('worker identity is not mode 0600')
const joinRequest = requests.find((request) => request.action === 'join_run' && request.name === 'worker-smoke')
if (!joinRequest) throw new Error('worker did not join the Coordinator run')
if (joinRequest.client?.protocolVersion !== 2 || joinRequest.capabilities?.unattended !== true) {
  throw new Error('worker did not negotiate protocol v2 with unattended capabilities')
}
if (!state.cwd.includes(`${path.sep}coord-worktrees${path.sep}`)) throw new Error('joined worker did not use an isolated worktree')
const codexArgs = JSON.parse(await readFile(codexArgsFile, 'utf8'))
if (!codexArgs.some((arg) => typeof arg === 'string' && arg.includes(path.join(state.cwd, '.agents', 'skills', 'coordinate-agents', 'SKILL.md')))) {
  throw new Error('worker prompt did not provide the checkout-local coordination skill path')
}
const approvalConfigIndex = codexArgs.indexOf('mcp_servers.agent-viewer.default_tools_approval_mode="approve"')
if (approvalConfigIndex < 1 || codexArgs[approvalConfigIndex - 1] !== '-c') {
  throw new Error('worker did not pre-approve Agent Viewer MCP tools for unattended Codex ticks')
}
const gitCommonDirIndex = codexArgs.indexOf('--add-dir')
const grantedGitDir = gitCommonDirIndex >= 0 ? codexArgs[gitCommonDirIndex + 1] : null
if (!grantedGitDir || await realpath(grantedGitDir) !== await realpath(path.join(testDir, '.git'))) {
  throw new Error('isolated Codex worker did not grant its repository Git metadata directory')
}

// Provider output is hostile input: oversized unterminated/JSON frames must not
// stay resident, while durable logs rotate to a fixed two-file budget.
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'oversized-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', oversizedIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: oversizedCodex,
      AGENT_VIEWER_COORD_PROVIDER_FRAME_MAX_BYTES: '1024',
      AGENT_VIEWER_COORD_WORKER_LOG_MAX_BYTES: '4096',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`oversized worker exited ${code}: ${stderr}`)))
})
const oversizedState = JSON.parse(await readFile(oversizedIdentityFile, 'utf8'))
if (oversizedState.providerSessionId !== '019-worker-after-oversized-frame') {
  throw new Error('oversized frame tail poisoned the durable provider session id')
}
for (const file of [oversizedState.logFile, `${oversizedState.logFile}.1`]) {
  if ((await stat(file)).size > 4096) throw new Error(`worker log exceeded its configured bound: ${file}`)
}

// `coord logs --follow` must survive the same rotation: drain bytes appended
// to the old inode immediately before rename, then continue at offset zero in
// the replacement active file.
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [admin, 'logs', 'oversized-worker', '--follow', '-n', '1'], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let rotated = false
  let timeout
  const finish = (error) => {
    if (timeout) clearTimeout(timeout)
    child.kill('SIGTERM')
    error ? reject(error) : resolve()
  }
  child.stdout.on('data', async (chunk) => {
    stdout += chunk
    if (!rotated) {
      rotated = true
      try {
        const active = await readFile(oversizedState.logFile, 'utf8')
        await writeFile(oversizedState.logFile, `${active}rotation-gap-marker\n`)
        await rm(`${oversizedState.logFile}.1`, { force: true })
        await rename(oversizedState.logFile, `${oversizedState.logFile}.1`)
        await writeFile(oversizedState.logFile, 'new-active-marker\n')
      } catch (error) {
        finish(error)
      }
    }
    if (stdout.includes('rotation-gap-marker') && stdout.includes('new-active-marker')) finish()
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', finish)
  child.on('exit', (code, signal) => {
    if (code && signal !== 'SIGTERM') finish(new Error(`coord logs follow exited ${code}: ${stderr}`))
  })
  timeout = setTimeout(() => finish(new Error(`coord logs follow missed rotation: ${stdout}\n${stderr}`)), 5_000)
})

// A lead must wake for both a newly claimable integration lane and work it
// already owns. Before this regression fix lead workers ignored both states,
// so single-lead playbooks and dependent integration tasks stalled.
continuationMode = true
const continuationStartedAt = Date.now()
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'lead-continuation-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', continuationIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: continuationCodex,
      CONTINUATION_COUNT_FILE: continuationCountFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`continuation worker exited ${code}: ${stderr}`)))
})
continuationMode = false
if (Number(await readFile(continuationCountFile, 'utf8')) !== 3) {
  throw new Error('lead claimable/owned work did not trigger immediate continuation ticks')
}
if (Date.now() - continuationStartedAt > 10_000) {
  throw new Error('actionable continuation waited instead of running immediately')
}

// A successful --once turn can still claim a task. It must atomically return
// that lease instead of exiting and leaving stale recovery to rescue it later.
onceOwnedMode = true
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'once-owned-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', onceOwnedIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: fakeCodex, CODEX_ARGS_FILE: codexArgsFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`once-owned worker exited ${code}: ${stderr}`)))
})
onceOwnedMode = false
const onceOwnedHandoff = requests.find((request) => request.action === 'handoff_task' && request.taskId === 'task-once-owned')
if (onceOwnedHandoff?.failureClass !== 'supervisor_stopped') {
  throw new Error('successful --once worker did not checkpoint newly owned work before exiting')
}

// The bounded exit checkpoint must survive a brief daemon outage instead of
// leaving its task leased until stale recovery.
onceOwnedMode = true
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'once-checkpoint-recovery-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', onceCheckpointRecoveryIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: fakeCodex, CODEX_ARGS_FILE: codexArgsFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`once checkpoint recovery worker exited ${code}: ${stderr}`)))
})
onceOwnedMode = false
if (onceCheckpointRecoveryWaits < 3) {
  throw new Error('bounded exit checkpoint did not retry transient Coordinator failures')
}
const recoveredOnceHandoff = requests.filter((request) => (
  request.action === 'handoff_task' && request.taskId === 'task-once-owned'
)).at(-1)
if (recoveredOnceHandoff?.failureClass !== 'supervisor_stopped') {
  throw new Error('bounded exit checkpoint did not hand off after Coordinator recovery')
}

// A long-lived supervisor must stop its active provider child and atomically
// return owned work when the process receives the signal used by coord restart.
shutdownMode = true
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'shutdown-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', shutdownIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: shutdownCodex,
      SHUTDOWN_READY_FILE: shutdownReadyFile,
      SHUTDOWN_MARKER_FILE: shutdownMarkerFile,
      AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS: '150',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`shutdown worker exited ${code}: ${stderr}`)))
  Promise.all([
    waitForFile(shutdownReadyFile),
    // This must become durable before the provider turn exits; otherwise a
    // crash here would restart a fresh native conversation.
    waitForJsonValue(shutdownIdentityFile, 'providerSessionId', '019-worker-shutdown-durable'),
  ]).then(() => child.kill('SIGTERM'), reject)
})
shutdownMode = false
if ((await readFile(shutdownMarkerFile, 'utf8')) !== 'term received') {
  throw new Error('supervisor shutdown did not first ask its active provider child to stop gracefully')
}
const shutdownProviderPid = Number(await readFile(shutdownReadyFile, 'utf8'))
try {
  process.kill(shutdownProviderPid, 0)
  throw new Error('supervisor shutdown left its signal-resistant provider child running')
} catch (error) {
  if (error?.code !== 'ESRCH') throw error
}
const shutdownHandoff = requests.find((request) => request.action === 'handoff_task' && request.taskId === 'task-shutdown')
if (shutdownHandoff?.failureClass !== 'supervisor_stopped') {
  throw new Error('supervisor shutdown did not checkpoint owned work before exiting')
}

// A provider that never exits must hit a bounded turn deadline, have its
// process group terminated, and immediately return its owned task.
timeoutMode = true
const timeoutStartedAt = Date.now()
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'timeout-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', timeoutIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: shutdownCodex,
      SHUTDOWN_READY_FILE: timeoutReadyFile,
      SHUTDOWN_MARKER_FILE: timeoutMarkerFile,
      AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS: '750',
      AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS: '150',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`timeout worker exited ${code}: ${stderr}`)))
})
timeoutMode = false
if (Date.now() - timeoutStartedAt > 5_000) throw new Error('provider turn deadline did not stop the worker promptly')
if ((await readFile(timeoutMarkerFile, 'utf8')) !== 'term received') {
  throw new Error('provider turn deadline did not first ask the provider to stop gracefully')
}
const timeoutProviderPid = Number(await readFile(timeoutReadyFile, 'utf8'))
try {
  process.kill(timeoutProviderPid, 0)
  throw new Error('provider turn deadline left its signal-resistant child running')
} catch (error) {
  if (error?.code !== 'ESRCH') throw error
}
const timeoutHandoff = requests.find((request) => request.action === 'handoff_task' && request.taskId === 'task-timeout')
if (timeoutHandoff?.failureClass !== 'provider_timeout') {
  throw new Error('provider turn deadline did not checkpoint owned work as provider_timeout')
}

// A provider can remain alive forever without producing another byte. The
// inactivity watchdog must return its lease well before the absolute deadline.
inactivityMode = true
const inactivityStartedAt = Date.now()
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'inactivity-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', inactivityIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: shutdownCodex,
      SHUTDOWN_READY_FILE: inactivityReadyFile,
      SHUTDOWN_MARKER_FILE: inactivityMarkerFile,
      AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS: '5000',
      AGENT_VIEWER_COORD_PROVIDER_INACTIVITY_TIMEOUT_MS: '500',
      AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS: '150',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`inactivity worker exited ${code}: ${stderr}`)))
})
inactivityMode = false
if (Date.now() - inactivityStartedAt > 3_000) throw new Error('provider inactivity watchdog waited for the absolute deadline')
if ((await readFile(inactivityMarkerFile, 'utf8')) !== 'term received') {
  throw new Error('provider inactivity watchdog did not first ask the provider to stop gracefully')
}
const inactivityHandoff = requests.find((request) => request.action === 'handoff_task' && request.taskId === 'task-inactivity')
if (inactivityHandoff?.failureClass !== 'provider_timeout') {
  throw new Error('provider inactivity watchdog did not checkpoint owned work as provider_timeout')
}

// Run stop/finalization must interrupt a provider that is still inside its
// model turn; waiting for providerTick to return would permit post-stop writes.
snapshot.run.status = 'running'
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'active-terminal-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', activeTerminalIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: shutdownCodex,
      SHUTDOWN_READY_FILE: activeTerminalReadyFile,
      SHUTDOWN_MARKER_FILE: activeTerminalMarkerFile,
      AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS: '5000',
      AGENT_VIEWER_COORD_PROVIDER_INACTIVITY_TIMEOUT_MS: '5000',
      AGENT_VIEWER_COORD_RUN_CHECK_INTERVAL_MS: '100',
      AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS: '150',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`active terminal worker exited ${code}: ${stderr}`)))
  waitForFile(activeTerminalReadyFile).then(() => { snapshot.run.status = 'completed' }, reject)
})
if ((await readFile(activeTerminalMarkerFile, 'utf8')) !== 'term received') {
  throw new Error('terminal run monitor did not interrupt the active provider process')
}

// Deletion is also terminal, but its authoritative read becomes a 404. The
// worker should stop the provider and exit cleanly without misclassifying that
// expected absence as a transport failure.
snapshot.run.status = 'running'
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'active-deleted-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', activeDeletedIdentityFile,
  ], {
    env: {
      ...process.env,
      AGENT_VIEWER_COORD_HOME: coordHome,
      CODEX_PATH: shutdownCodex,
      SHUTDOWN_READY_FILE: activeDeletedReadyFile,
      SHUTDOWN_MARKER_FILE: activeDeletedMarkerFile,
      AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS: '5000',
      AGENT_VIEWER_COORD_PROVIDER_INACTIVITY_TIMEOUT_MS: '5000',
      AGENT_VIEWER_COORD_RUN_CHECK_INTERVAL_MS: '100',
      AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS: '150',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`active deleted worker exited ${code}: ${stderr}`)))
  waitForFile(activeDeletedReadyFile).then(() => { deletedMode = true }, reject)
})
deletedMode = false
if ((await readFile(activeDeletedMarkerFile, 'utf8')) !== 'term received') {
  throw new Error('deleted run monitor did not interrupt the active provider process')
}

// Even when the provider CLI is persistently broken, the worker must notice
// that another participant finalized the run and exit instead of retrying
// forever without another Coordinator read.
snapshot.run.status = 'completed'
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'terminal-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', terminalIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: failingCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`terminal worker exited ${code}: ${stderr}`)))
})
if (!requests.some((request) => request.action === 'wait')) {
  throw new Error('failed provider tick did not check whether the Coordinator run was terminal')
}

snapshot.run.status = 'running'

// A failed bounded turn may have claimed work before the CLI failed. Unlike an
// unowned failure, it must return that task immediately on its first failure.
onceFailedOwnedMode = true
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'once-failed-owned-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', onceFailedOwnedIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: failingCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`failed owned --once worker exited ${code}: ${stderr}`)))
})
onceFailedOwnedMode = false
const onceFailedOwnedHandoff = requests.find((request) => (
  request.action === 'handoff_task' && request.taskId === 'task-once-failed-owned'
))
if (onceFailedOwnedHandoff?.failureClass !== 'provider_failure') {
  throw new Error('failed --once worker did not return newly owned work on its first provider failure')
}

// If the ownership read itself is temporarily unavailable after a provider
// failure, never infer that the worker is unowned. Recover the authoritative
// task state first, then checkpoint the task instead of retiring the agent.
ownershipRecoveryMode = true
ownershipWaitFailuresRemaining = 2
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'ownership-recovery-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', ownershipRecoveryIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: failingCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ownership recovery worker exited ${code}: ${stderr}`)))
})
ownershipRecoveryMode = false
const ownershipRecoveryHandoff = requests.find((request) => (
  request.action === 'handoff_task' && request.taskId === 'task-ownership-recovery'
))
if (ownershipRecoveryHandoff?.failureClass !== 'provider_failure') {
  throw new Error('worker did not preserve and hand off ownership after transient status-read failures')
}
if (requests.some((request) => request.action === 'leave_run' && request.name === 'ownership-recovery-worker')) {
  throw new Error('worker retired after transient status-read failures despite owning a task')
}

// --once is a bounded automation primitive: an unowned provider failure must
// return control immediately instead of entering the supervisor retry loop.
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'once-failure-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', onceFailureIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: failingCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code !== 1) reject(new Error(`failed --once worker exited ${code}: ${stderr}`))
    else if (!stderr.includes('worker retired after provider_failure')) reject(new Error(`failed --once worker omitted its retirement error: ${stderr}`))
    else resolve()
  })
})
if (!requests.some((request) => request.action === 'leave_run' && request.name === 'once-failure-worker')) {
  throw new Error('failed unowned --once worker left a live roster participant behind')
}

// Some provider CLIs (notably Pi) report a terminal API error in JSON but exit
// with status 0. The supervisor must treat the structured turn as failed or it
// will immediately spend another provider turn forever on unchanged work.
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'zero-exit-error-worker', '--provider', 'pi',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', zeroExitErrorIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, PI_PATH: zeroExitErrorPi },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code !== 1) reject(new Error(`zero-exit provider error worker exited ${code}: ${stderr}`))
    else if (!stderr.includes('worker retired after rate_limited')) {
      reject(new Error(`zero-exit provider error was not classified: ${stderr}`))
    } else resolve()
  })
})
if (!requests.some((request) => request.action === 'leave_run' && request.name === 'zero-exit-error-worker')) {
  throw new Error('zero-exit provider error left a misleading live participant behind')
}

// A durable startup/provider failure before claim must retire the participant
// and exit instead of retrying forever as a misleading `ready` executor.
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'preclaim-failure-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--identity', preclaimFailureIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: rateLimitedCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error(`pre-claim provider failure retried forever: ${stderr}`))
  }, 5_000)
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('exit', (code) => {
    clearTimeout(timer)
    code === 1 ? resolve() : reject(new Error(`pre-claim failure worker exited ${code}: ${stderr}`))
  })
})
if (!requests.some((request) => request.action === 'leave_run' && request.name === 'preclaim-failure-worker')) {
  throw new Error('durable pre-claim provider failure did not retire its participant')
}

// A classified durable provider failure with owned work checkpoints and
// hands the task back instead of entering the retry loop.
handoffMode = true
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'handoff-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', handoffIdentityFile,
  ], {
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordHome, CODEX_PATH: rateLimitedCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => code === 0
    ? resolve()
    : reject(new Error(`handoff worker exited ${code}: ${stderr}`)))
})
const handoffRequest = requests.find((request) => request.action === 'handoff_task' && request.taskId === 'task-handoff')
if (handoffRequest?.taskId !== 'task-handoff' || handoffRequest?.failureClass !== 'rate_limited') {
  throw new Error('classified provider failure did not trigger an atomic task handoff')
}

// Registry, logs, restart, and read-only doctor are real CLI surfaces.
const launcher = fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url))
const adminEnv = {
  ...process.env,
  AGENT_VIEWER_COORD_HOME: coordHome,
  CODEX_PATH: fakeCodex,
  CLAUDE_PATH: slowVersionCli,
  OPENCODE_PATH: fakeCodex,
  COPILOT_PATH: fakeCodex,
  COPILOT_CLI_PATH: fakeCodex,
  PI_PATH: slowVersionCli,
  AGENT_VIEWER_COORD_CLI_TIMEOUT_MS: '1000',
  CODEX_ARGS_FILE: codexArgsFile,
}
async function expectAdminFailure(commandArgs, marker) {
  try {
    await runNode([launcher, 'coord', ...commandArgs], adminEnv)
  } catch (error) {
    if (String(error).includes(marker)) return
    throw error
  }
  throw new Error(`coord ${commandArgs[0]} unexpectedly accepted invalid arguments`)
}
await expectAdminFailure(['workers', '--limt', '3'], 'Unknown workers option: --limt')
await expectAdminFailure(['doctor', '--limit', 'many'], '--limit must be an integer from 1 to 1000')
await expectAdminFailure(['workers', '--status', 'strale'], '--status must be one of:')
process.env.AGENT_VIEWER_COORD_HOME = coordHome
await writeWorkerRecord(path.join(testDir, 'stale-worker.json'), {
  runId: 'stale-run',
  agentId: 'stale-worker',
  name: 'stale-worker',
  provider: 'codex',
  cwd: testDir,
  pid: 999_999,
  status: 'running',
  heartbeatAt: new Date(0).toISOString(),
})
const workerList = JSON.parse(execFileSync(process.execPath, [launcher, 'coord', 'workers', '--json'], {
  env: adminEnv,
  encoding: 'utf8',
}))
if (!workerList.some((record) => record.identityFile === identityFile && record.logFile)) {
  throw new Error('coord workers omitted the persistent worker registration')
}
const staleWorkers = JSON.parse(execFileSync(process.execPath, [launcher, 'coord', 'workers', '--json', '--status', 'stale'], {
  env: adminEnv,
  encoding: 'utf8',
}))
if (staleWorkers.length !== 1 || staleWorkers[0]?.name !== 'stale-worker') {
  throw new Error('coord workers --status stale did not use computed worker liveness')
}
const runningWorkers = JSON.parse(execFileSync(process.execPath, [launcher, 'coord', 'workers', '--json', '--status', 'running'], {
  env: adminEnv,
  encoding: 'utf8',
}))
if (runningWorkers.some((record) => record.name === 'stale-worker')) {
  throw new Error('coord workers --status running included a dead stale registration')
}
const logOutput = execFileSync(process.execPath, [launcher, 'coord', 'logs', identityFile, '-n', '20'], {
  env: adminEnv,
  encoding: 'utf8',
})
if (!logOutput.includes('worker starting') || !logOutput.includes('worker exiting')) {
  throw new Error('coord logs did not read the registered worker lifecycle log')
}
const rotatedLogOutput = execFileSync(process.execPath, [launcher, 'coord', 'logs', oversizedIdentityFile, '-n', '10000'], {
  env: adminEnv,
  encoding: 'utf8',
})
if (!rotatedLogOutput.includes('rotation-gap-marker') || !rotatedLogOutput.includes('new-active-marker')) {
  throw new Error('coord logs did not combine the retained rotated and active worker logs')
}
const doctorStartedAt = Date.now()
const doctor = JSON.parse(await runNode([
  launcher, 'coord', 'doctor', '--json', '--attach', String(address.port), '--identity', identityFile, '--limit', '1',
], adminEnv))
if (Date.now() - doctorStartedAt > 1_800) {
  throw new Error('coord doctor checked unavailable provider CLIs sequentially')
}
if (!doctor.ok || doctor.checks?.protocol?.serverExpected !== 2) {
  throw new Error('coord doctor did not report a healthy negotiated setup')
}
if (doctor.checks?.workers?.length !== 1 || doctor.checks?.workerSummary?.total <= doctor.checks.workers.length) {
  throw new Error('coord doctor did not bound worker detail while preserving the full summary')
}
const piDoctor = doctor.checks?.providerClis?.find((entry) => entry.name === 'pi')
if (piDoctor?.ok !== false || !String(piDoctor?.error ?? '').includes('ETIMEDOUT')) {
  throw new Error('coord doctor reported a timed-out provider CLI as healthy')
}
snapshot.run.status = 'completed'
const preFailoverIdentity = JSON.parse(await readFile(identityFile, 'utf8'))
await writeFile(identityFile, `${JSON.stringify({
  ...preFailoverIdentity,
  lastFailureClass: 'rate_limited',
  lastError: 'previous provider exhausted its quota',
}, null, 2)}\n`, { mode: 0o600 })
const restartOutput = execFileSync(process.execPath, [
  launcher, 'coord', 'restart', identityFile, '--provider', 'copilot',
], {
  env: adminEnv,
  encoding: 'utf8',
})
if (!restartOutput.includes('Restarted')) throw new Error('coord restart did not relaunch the selected worker')
await new Promise((resolve) => setTimeout(resolve, 750))
const failedOverIdentity = JSON.parse(await readFile(identityFile, 'utf8'))
if (failedOverIdentity.provider !== 'copilot') {
  throw new Error('coord restart did not persist the requested provider failover')
}
if (failedOverIdentity.lastFailureClass || failedOverIdentity.lastError) {
  throw new Error('coord restart retained stale failure metadata from the previous provider')
}

daemon.close()
clearTimeout(smokeDeadline)

console.log('Coordinator worker smoke passed')

import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const testDir = await mkdtemp(path.join(tmpdir(), 'agent-viewer-coord-worker-'))
const fakeCodex = path.join(testDir, 'fake-codex.mjs')
const failingCodex = path.join(testDir, 'failing-codex.mjs')
const identityFile = path.join(testDir, 'identity.json')
const terminalIdentityFile = path.join(testDir, 'terminal-identity.json')
const onceFailureIdentityFile = path.join(testDir, 'once-failure-identity.json')
const codexArgsFile = path.join(testDir, 'codex-args.json')
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
await writeFile(path.join(testDir, '.gitignore'), '.agent-viewer-data/\n')
await writeFile(path.join(testDir, 'README.md'), 'worker smoke\n')
execFileSync('git', ['init', '-q'], { cwd: testDir })
execFileSync('git', ['config', 'user.email', 'worker-smoke@example.test'], { cwd: testDir })
execFileSync('git', ['config', 'user.name', 'Worker Smoke'], { cwd: testDir })
execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: testDir })
execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: testDir })

const requests = []
const snapshot = {
  run: { id: 'run-worker', prompt: 'smoke goal', status: 'running', provider: 'codex', baseCwd: testDir, maxAgents: 4, leadAgentId: 'lead-worker' },
  agents: [], tasks: [], locks: [], messages: [], events: [],
}
const daemon = createServer(async (request, response) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  requests.push(body)
  response.setHeader('Content-Type', 'application/json')
  if (body.action === 'join_run') {
    response.end(JSON.stringify({
      participant: {
        runId: 'run-worker', agentId: 'lead-worker', token: 'worker-secret', name: body.name,
        role: 'teammate', provider: body.provider, cwd: body.cwd,
      },
      snapshot,
    }))
    return
  }
  if (body.action === 'wait') {
    response.end(JSON.stringify({
      changed: false,
      timedOut: true,
      cursor: null,
      snapshot,
      inbox: { messages: [], nextCursor: null },
      events: [],
      actionable: { runStatus: snapshot.run.status, inboxCount: 0, claimableTasks: [], plansAwaitingReview: [], myTask: null, allTasksTerminal: snapshot.run.status === 'completed' },
    }))
    return
  }
  response.end(JSON.stringify(snapshot))
})
daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const address = daemon.address()
if (!address || typeof address === 'string') throw new Error('worker smoke daemon did not bind')

const worker = fileURLToPath(new URL('../bin/agent-viewer-coord-worker.mjs', import.meta.url))
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'worker-smoke', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--once', '--identity', identityFile,
  ], {
    env: { ...process.env, CODEX_PATH: fakeCodex, CODEX_ARGS_FILE: codexArgsFile },
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
if (requests[0]?.action !== 'join_run') throw new Error('worker did not join the Coordinator run')
if (!state.cwd.includes(`${path.sep}coord-worktrees${path.sep}`)) throw new Error('joined worker did not use an isolated worktree')
const codexArgs = JSON.parse(await readFile(codexArgsFile, 'utf8'))
const approvalConfigIndex = codexArgs.indexOf('mcp_servers.agent-viewer.default_tools_approval_mode="approve"')
if (approvalConfigIndex < 1 || codexArgs[approvalConfigIndex - 1] !== '-c') {
  throw new Error('worker did not pre-approve Agent Viewer MCP tools for unattended Codex ticks')
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
    env: { ...process.env, CODEX_PATH: failingCodex },
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

// --once is a bounded automation primitive: a failed provider invocation must
// return control immediately instead of entering the supervisor retry loop.
snapshot.run.status = 'running'
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    worker, '--join', 'run-worker', '--name', 'once-failure-worker', '--provider', 'codex',
    '--attach', String(address.port), '--cwd', testDir, '--shared', '--once', '--identity', onceFailureIdentityFile,
  ], {
    env: { ...process.env, CODEX_PATH: failingCodex },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code !== 1) reject(new Error(`failed --once worker exited ${code}: ${stderr}`))
    else if (!stderr.includes('Coordinator tick failed:')) reject(new Error(`failed --once worker omitted its error: ${stderr}`))
    else resolve()
  })
})

daemon.close()

console.log('Coordinator worker smoke passed')

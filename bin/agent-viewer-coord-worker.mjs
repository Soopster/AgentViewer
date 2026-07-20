#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  coordinatorStateRoot,
  workerLogPath,
  writeWorkerRecord,
} from './agent-viewer-coord-state.mjs'

function usage(message) {
  if (message) console.error(message)
  console.log(`Usage:
  agent-viewer coord worker --start <goal> --name <name> [--provider codex|claude|opencode|copilot|pi]
  agent-viewer coord worker --join <run-id|latest> --name <name> [--provider codex|claude|opencode|copilot|pi]
  agent-viewer coord worker --identity <file> [--provider codex|claude|opencode|copilot|pi]

Options:
  --attach <url>       Agent Viewer web daemon (default http://127.0.0.1:3000)
  --cwd <path>         Source checkout (default current directory)
  --shared             Join in the current checkout instead of an isolated worktree
  --once               Run one CLI tick and exit
  --identity <file>    Durable 0600 participant and provider-session state
  --model <id>         Provider model override (e.g. sonnet, gpt-5.2-codex, openai-codex/gpt-5.2-codex)
  --playbook <name>    With --start: seed the board from a saved playbook
  --args <value>       With --playbook: args interpolated into task text (JSON or string)
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(args) {
  const options = { provider: 'codex', cwd: process.cwd(), shared: false, once: false }
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === '--shared') options.shared = true
    else if (key === '--once') options.once = true
    else if (key === '--help' || key === '-h') options.help = true
    else if (key?.startsWith('--')) {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
      options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
      index += 1
    } else throw new Error(`Unknown argument: ${key}`)
  }
  return options
}

function normalizeUrl(value) {
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `http://${value.replace(/\/+$/, '')}`
}

async function api(baseUrl, action, body, timeoutMs = 65_000) {
  const response = await fetch(`${baseUrl}/api/agent-protocol/external`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `${response.status} ${response.statusText}`)
  return payload
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    child.on('error', reject)
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)))
  })
}

async function isolatedWorktree(cwd, runId, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'worker'
  const target = path.join(cwd, '.agent-viewer-data', 'coord-worktrees', runId, slug)
  const branch = `agent-viewer/coord/${runId.slice(0, 8)}/${slug}`
  await mkdir(path.dirname(target), { recursive: true })
  await run('git', ['worktree', 'add', '-b', branch, target, 'HEAD'], { cwd, stdio: 'inherit' })
  return target
}

async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

function identityFileFor(state) {
  return path.join(coordinatorStateRoot(), state.runId, `${state.agentId}.json`)
}

async function workerLog(state, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    await mkdir(path.dirname(state.logFile), { recursive: true, mode: 0o700 })
    await appendFile(state.logFile, line, { mode: 0o600 })
  } catch { /* logging must never stop coordination */ }
}

function classifyProviderFailure(error) {
  const text = `${error?.message || error}\n${error?.providerOutput || ''}`.toLowerCase()
  if (error?.code === 'ENOENT' || /enoent|command not found|not recognized as/.test(text)) return 'cli_missing'
  if (/rate.?limit|quota|usage limit|too many requests|429/.test(text)) return 'rate_limited'
  if (/unauthori[sz]ed|authentication|not logged in|invalid api key|401|403/.test(text)) return 'authentication_failed'
  if (/context (window|length)|maximum context|context.*exceed|too many tokens/.test(text)) return 'context_exhausted'
  if (/approval|permission.*denied|not approved|requires approval/.test(text)) return 'approval_blocked'
  if (/econnreset|econnrefused|timed? out|temporar|network|socket|transport/.test(text)) return 'transient_transport'
  return 'provider_failure'
}

function workerNegotiation() {
  return {
    client: { name: 'agent-viewer-coord-worker', version: '1.0.0', protocolVersion: 2 },
    capabilities: {
      unattended: true,
      sessionResume: true,
      filesystemWrite: true,
      git: true,
      maxParallelTasks: 1,
      tools: ['coord_*'],
    },
  }
}

function mcpConfig(state, baseUrl) {
  const entry = fileURLToPath(new URL('./agent-viewer.mjs', import.meta.url))
  return {
    command: process.execPath,
    args: [entry, 'mcp', '--attach', baseUrl, '--identity', state.identityFile],
  }
}

function tickPrompt(state) {
  const checkoutGuidance = state.checkoutMode === 'isolated'
    ? `You are working in an isolated git worktree at ${state.cwd}; stay within granted paths and leave integration to the lead.`
    : `You are working in the shared checkout at ${state.cwd}; keep writes inside granted non-overlapping paths, preserve existing changes, and do not reset or clean files owned by another participant.`
  return [
    `Continue Coordinator run ${state.runId} as ${state.name || state.agentId} (${state.role || 'participant'}).`,
    'You are ALREADY bound to this run: never call coord_create_run, coord_join_run, or coord_list_runs — start with coord_status and act on its actionable digest.',
    'Use the coordinate-agents skill and the agent-viewer coord_* MCP tools now.',
    checkoutGuidance,
    'Drain the inbox, then perform every immediately actionable role-appropriate step, including implementation and verification.',
    'Coordinate actively — teammates run in other CLIs and cannot see your terminal: answer reply_required mail first, publish reusable discoveries with coord_publish_finding, and send coord_send_message whenever your progress, blockers, or findings affect another lane.',
    'If your task work will take several steps, call coord_read_inbox again partway through rather than only at the start — a reply_required message from the lead can arrive mid-task and change your plan; you will not be woken for it until you check.',
    'Use stable request_id values before retrying mutations. If no action is ready, return control to the supervisor; do not poll or sleep.',
    'If all tasks are terminal and you are lead, review results and finalize the run. Never print participant credentials.',
  ].join(' ')
}

async function providerTick(state, baseUrl) {
  const config = mcpConfig(state, baseUrl)
  const prompt = tickPrompt(state)
  let command
  let args
  const extraEnv = {}
  if (state.provider === 'claude') {
    command = process.env.CLAUDE_PATH || 'claude'
    args = [
      '-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'auto',
      // Headless ticks have no human to approve MCP calls: without this
      // pre-allow, permission-mode auto stalls every coordinator tool call
      // and the tick burns its whole turn asking nobody for access.
      '--allowedTools', 'mcp__agent-viewer__*',
      ...(state.model ? ['--model', state.model] : []),
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { 'agent-viewer': config } }),
      state.providerSessionId ? '--resume' : '--session-id', state.providerSessionId || randomUUID(),
      prompt,
    ]
    state.providerSessionId ||= args[args.indexOf('--session-id') + 1]
  } else if (state.provider === 'opencode') {
    command = process.env.OPENCODE_PATH || 'opencode'
    // OpenCode reads MCP servers from its config file; OPENCODE_CONFIG points
    // at a worker-owned file so the project's opencode.json stays untouched.
    const configFile = `${state.identityFile}.opencode.json`
    await writeFile(configFile, JSON.stringify({
      mcp: {
        'agent-viewer': { type: 'local', command: [config.command, ...config.args], enabled: true },
      },
    }, null, 2), { mode: 0o600 })
    extraEnv.OPENCODE_CONFIG = configFile
    // Headless ticks cannot answer permission prompts; --auto approves
    // anything not explicitly denied by the user's permission config.
    args = [
      'run', '--format', 'json', '--auto',
      ...(state.model ? ['--model', state.model] : []),
      ...(state.providerSessionId ? ['--session', state.providerSessionId] : []),
      prompt,
    ]
  } else if (state.provider === 'copilot') {
    command = process.env.COPILOT_CLI_PATH || 'copilot'
    args = [
      '-p', prompt,
      // Non-interactive mode requires --allow-all-tools; worktree .git files
      // point outside the checkout, so path verification must not prompt either.
      '--allow-all-tools', '--allow-all-paths', '--no-ask-user', '--no-auto-update',
      '--output-format', 'json',
      ...(state.model ? ['--model', state.model] : []),
      '--additional-mcp-config', JSON.stringify({
        mcpServers: { 'agent-viewer': { type: 'local', command: config.command, args: config.args, tools: ['*'] } },
      }),
      ...(state.providerSessionId ? ['--resume', state.providerSessionId] : []),
    ]
  } else if (state.provider === 'pi') {
    command = process.env.PI_PATH || 'pi'
    // Pi reaches MCP through the pi-mcp-adapter extension; directTools with no
    // prefix registers coord_* as first-class tools instead of a proxy.
    const configFile = `${state.identityFile}.mcp.json`
    await writeFile(configFile, JSON.stringify({
      mcpServers: {
        'agent-viewer': { command: config.command, args: config.args, directTools: true },
      },
      settings: { toolPrefix: 'none' },
    }, null, 2), { mode: 0o600 })
    // Pi creates the session for a supplied id, so resume needs no output parsing.
    state.providerSessionId ||= randomUUID()
    args = [
      '-p', '--mode', 'json', '--mcp-config', configFile,
      ...(state.model ? ['--model', state.model] : []),
      '--session-id', state.providerSessionId, prompt,
    ]
  } else {
    command = process.env.CODEX_PATH || 'codex'
    const configArgs = [
      '-c', `mcp_servers.agent-viewer.command=${JSON.stringify(config.command)}`,
      '-c', `mcp_servers.agent-viewer.args=${JSON.stringify(config.args)}`,
      '-c', 'mcp_servers.agent-viewer.required=true',
      // Headless ticks cannot answer Codex's per-MCP-tool approval prompt.
      // `approval_policy="never"` covers command approvals, while MCP servers
      // have their own tool approval mode. Trust only this Coordinator server;
      // all other configured MCP servers retain the user's normal policy.
      '-c', 'mcp_servers.agent-viewer.default_tools_approval_mode="approve"',
      '-c', 'approval_policy="never"',
      '-c', 'sandbox_mode="workspace-write"',
      ...(state.model ? ['-c', `model=${JSON.stringify(state.model)}`] : []),
    ]
    args = state.providerSessionId
      ? ['exec', ...configArgs, 'resume', '--json', state.providerSessionId, prompt]
      : ['exec', ...configArgs, '--json', '--sandbox', 'workspace-write', prompt]
  }

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: state.cwd,
      env: {
        ...process.env,
        ...extraEnv,
        AGENT_VIEWER_ATTACH: baseUrl,
        AGENT_VIEWER_COORD_IDENTITY_FILE: state.identityFile,
        AGENT_VIEWER_COORD_WORKER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buffered = ''
    let providerOutput = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      void appendFile(state.logFile, chunk).catch(() => {})
      providerOutput = `${providerOutput}${chunk.toString()}`.slice(-16_000)
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() || ''
      for (const line of lines) {
        try {
          const event = JSON.parse(line)
          // codex: thread_id · claude: session_id · opencode: sessionID (also
          // nested under info/part) · copilot: sessionId
          const sessionId = event.thread_id || event.session_id || event.sessionID || event.sessionId
            || event.info?.sessionID || event.part?.sessionID
          if (typeof sessionId === 'string' && sessionId) state.providerSessionId = sessionId
        } catch { /* provider text or partial JSON */ }
      }
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      void appendFile(state.logFile, chunk).catch(() => {})
      providerOutput = `${providerOutput}${chunk.toString()}`.slice(-16_000)
    })
    const heartbeat = setInterval(() => {
      void api(baseUrl, 'progress', {
        runId: state.runId,
        agentId: state.agentId,
        token: state.token,
        status: 'heartbeat',
        requestId: `heartbeat-${Date.now()}`,
      }, 10_000).catch(() => {})
    }, 45_000)
    heartbeat.unref()
    child.on('error', (error) => {
      clearInterval(heartbeat)
      error.providerOutput = providerOutput
      reject(error)
    })
    child.on('exit', (code, signal) => {
      clearInterval(heartbeat)
      if (code === 0) resolve()
      else {
        const error = new Error(`${command} exited ${code ?? signal}`)
        error.providerOutput = providerOutput
        reject(error)
      }
    })
  })
}

let options
try { options = parseArgs(process.argv.slice(2)) } catch (error) { usage(error.message) }
if (!options || options.help) usage()
if (!['codex', 'claude', 'opencode', 'copilot', 'pi'].includes(options.provider)) usage('--provider must be codex, claude, opencode, copilot, or pi')

let baseUrl = normalizeUrl(options.attach || 'http://127.0.0.1:3000')
let state
let loadedIdentity = false
if (options.identity && !options.start && !options.join) {
  loadedIdentity = true
  state = JSON.parse(await readFile(path.resolve(options.identity), 'utf8'))
  state.identityFile = path.resolve(options.identity)
  state.provider ||= options.provider
  state.cwd ||= options.cwd
  state.checkoutMode ||= state.cwd.includes(`${path.sep}coord-worktrees${path.sep}`) ? 'isolated' : 'shared'
  if (options.model) state.model = options.model
  if (!options.attach && state.attach) baseUrl = normalizeUrl(state.attach)
} else {
  if (!options.name || (!options.start && !options.join) || (options.start && options.join)) {
    usage('Provide --name and exactly one of --start or --join')
  }
  let cwd = path.resolve(options.cwd)
  // `--join latest` (or `auto`) discovers the newest joinable run server-side.
  const joinRunId = ['latest', 'auto'].includes(options.join ?? '') ? undefined : options.join
  if (options.join && !options.shared) {
    cwd = await isolatedWorktree(cwd, joinRunId ?? `latest-${Date.now().toString(36)}`, options.name)
  }
  let playbookArgs = options.args
  if (typeof playbookArgs === 'string') {
    try { playbookArgs = JSON.parse(playbookArgs) } catch { /* keep as plain string */ }
  }
  const result = await api(baseUrl, options.start ? 'create_run' : 'join_run', {
    ...(options.start
      ? { prompt: options.start, playbookName: options.playbook, args: playbookArgs }
      : { runId: joinRunId }),
    name: options.name,
    provider: options.provider,
    cwd,
    ...workerNegotiation(),
  })
  state = {
    ...result.participant,
    cwd,
    attach: baseUrl,
    checkoutMode: options.join && !options.shared ? 'isolated' : 'shared',
  }
  if (options.model) state.model = options.model
  state.identityFile = path.resolve(options.identity || identityFileFor(state))
}
state.attach = baseUrl
state.logFile ||= workerLogPath(state.identityFile)
if (loadedIdentity) {
  const resumed = await api(baseUrl, 'resume', { ...state, ...workerNegotiation() })
  if (resumed?.participant) {
    state = { ...state, ...resumed.participant, identityFile: state.identityFile, logFile: state.logFile, attach: baseUrl }
  }
}
await saveState(state.identityFile, state)
console.error(`Coordinator ${state.runId}: ${state.name || state.agentId} (${state.role || 'participant'})`)
console.error(`Identity: ${state.identityFile}`)
await workerLog(state, `worker starting pid=${process.pid} provider=${state.provider} run=${state.runId}`)
const workerInstanceId = randomUUID()
await writeWorkerRecord(state.identityFile, {
  runId: state.runId,
  agentId: state.agentId,
  name: state.name,
  role: state.role,
  provider: state.provider,
  cwd: state.cwd,
  attach: baseUrl,
  logFile: state.logFile,
  pid: process.pid,
  workerInstanceId,
  heartbeatAt: new Date().toISOString(),
  status: 'running',
  startedAt: new Date().toISOString(),
})
const heartbeatTimer = setInterval(() => {
  void writeWorkerRecord(state.identityFile, {
    pid: process.pid,
    workerInstanceId,
    heartbeatAt: new Date().toISOString(),
  }).catch((error) => {
    void workerLog(state, `worker heartbeat failed: ${error instanceof Error ? error.message : error}`)
  })
}, 5_000)
heartbeatTimer.unref?.()

function isTerminal(wait) {
  const status = wait?.actionable?.runStatus ?? wait?.snapshot?.run?.status
  return ['completed', 'failed', 'stopped'].includes(status)
}

// A provider tick is a full model turn; only spend one when the wait's
// actionable digest shows work for this role. Leads act on mail, submitted
// plans, and a finished board (never on unclaimed tasks — those are for
// teammates); teammates act on mail, claimable tasks, or their owned task.
// Daemons that predate the digest omit it — then every wake ticks, as before.
function shouldTick(actionable, role) {
  if (!actionable) return true
  if ((actionable.inboxCount ?? 0) > 0) return true
  if ((actionable.replyRequiredCount ?? 0) > 0) return true
  if (role === 'lead') {
    return (actionable.plansAwaitingReview?.length ?? 0) > 0
      || actionable.allTasksTerminal === true
      || actionable.runStatus === 'synthesizing'
  }
  return (actionable.claimableTasks?.length ?? 0) > 0 || Boolean(actionable.myTask)
}

let cursor = null
let failures = 0
let finalStatus = 'stopped'
const role = state.role === 'lead' ? 'lead' : 'teammate'
outer: for (;;) {
  try {
    await providerTick(state, baseUrl)
    failures = 0
    await saveState(state.identityFile, state)
  } catch (error) {
    failures += 1
    const failureClass = classifyProviderFailure(error)
    state.lastFailureClass = failureClass
    state.lastError = error.message
    await workerLog(state, `provider tick failed class=${failureClass} attempt=${failures}: ${error.message}`)
    await writeWorkerRecord(state.identityFile, {
      status: 'retrying',
      failureClass,
      failures,
      lastError: error.message,
    })
    // A broken provider CLI must not strand the supervisor forever after the
    // run was stopped or completed by another participant.
    let current
    try {
      current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 })
      cursor = current.cursor
      if (isTerminal(current)) break
    } catch { /* retain the provider error and retry when the daemon is unavailable */ }
    const durableFailure = failureClass !== 'transient_transport'
      && (failureClass !== 'provider_failure' || failures >= 3)
    const ownedTask = current?.actionable?.myTask
    if (ownedTask && durableFailure) {
      const summary = `${state.provider} worker checkpointed ${ownedTask.id} after ${failureClass}`
      try {
        await api(baseUrl, 'handoff_task', {
          ...state,
          taskId: ownedTask.id,
          summary,
          detail: `Provider CLI error: ${error.message}`,
          failureClass,
          requestId: `worker-handoff-${ownedTask.id}-${failureClass}`,
        })
        finalStatus = 'handed_off'
        await workerLog(state, `${summary}; task returned to board`)
        console.error(`${summary}; task returned to board`)
        break
      } catch (handoffError) {
        await workerLog(state, `automatic handoff failed: ${handoffError.message}`)
      }
    }
    if (options.once) {
      console.error(`Coordinator tick failed: ${error.message}`)
      process.exitCode = 1
      break
    }
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5))
    console.error(`Coordinator tick failed: ${error.message}; retrying in ${delay}ms`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    continue
  }
  if (options.once) break
  const current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 })
  cursor = current.cursor
  if (isTerminal(current)) break
  for (;;) {
    const next = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 55_000 })
    cursor = next.cursor
    if (isTerminal(next)) break outer
    if (shouldTick(next.actionable, role)) break
  }
}

await saveState(state.identityFile, state)
clearInterval(heartbeatTimer)
await writeWorkerRecord(state.identityFile, {
  status: finalStatus,
  pid: process.pid,
  stoppedAt: new Date().toISOString(),
  failures,
  failureClass: state.lastFailureClass,
  lastError: state.lastError,
})
await workerLog(state, `worker exiting status=${finalStatus}`)

#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFile, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  coordinatorStateRoot,
  workerLogPath,
  writeWorkerRecord,
} from './agent-viewer-coord-state.mjs'
import {
  CoordinatorAhpClient,
  coordinatorTransport,
} from './agent-viewer-ahp-client.mjs'

const ahpClients = new Map()
const shutdownController = new AbortController()
const PROVIDER_STOP_GRACE_MS = Math.max(100, Number(process.env.AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS) || 2_000)
const PROVIDER_TURN_TIMEOUT_MS = Math.max(100, Number(process.env.AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS) || 30 * 60_000)
const PROVIDER_INACTIVITY_TIMEOUT_MS = Math.max(100, Number(process.env.AGENT_VIEWER_COORD_PROVIDER_INACTIVITY_TIMEOUT_MS) || 10 * 60_000)
const RUN_CHECK_INTERVAL_MS = Math.max(100, Number(process.env.AGENT_VIEWER_COORD_RUN_CHECK_INTERVAL_MS) || 5_000)
const PROVIDER_FRAME_MAX_BYTES = Math.max(1_024, Number(process.env.AGENT_VIEWER_COORD_PROVIDER_FRAME_MAX_BYTES) || 1024 * 1024)
const WORKER_LOG_MAX_BYTES = Math.max(4_096, Number(process.env.AGENT_VIEWER_COORD_WORKER_LOG_MAX_BYTES) || 10 * 1024 * 1024)
let logWriteChain = Promise.resolve()
let shutdownRequested = false
let shutdownSignal = null
let activeProviderChild = null
let activeProviderKillTimer = null
let resolveShutdown
const shutdownRequestedPromise = new Promise((resolve) => { resolveShutdown = resolve })

function closeAhpClients() {
  for (const client of ahpClients.values()) client.close()
  ahpClients.clear()
}

function supervisorStoppedError() {
  const error = new Error(`Coordinator worker stopping${shutdownSignal ? ` after ${shutdownSignal}` : ''}`)
  error.code = 'COORDINATOR_WORKER_STOPPING'
  return error
}

function providerChildRunning(child) {
  return child?.exitCode === null && child?.signalCode === null
}

function signalProviderChild(child, signal) {
  if (!providerChildRunning(child)) return
  let signaled = false
  if (process.platform !== 'win32' && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, signal)
      signaled = true
    } catch { /* process group may already be gone */ }
  }
  if (!signaled) {
    try { child.kill(signal) } catch { /* child may have exited between checks */ }
  }
}

function clearProviderChild(child) {
  if (activeProviderChild !== child) return
  activeProviderChild = null
  if (activeProviderKillTimer) clearTimeout(activeProviderKillTimer)
  activeProviderKillTimer = null
}

function requestShutdown(reason, providerSignal = 'SIGTERM') {
  if (shutdownRequested) return
  shutdownRequested = true
  shutdownSignal = reason
  shutdownController.abort(supervisorStoppedError())
  closeAhpClients()
  if (providerChildRunning(activeProviderChild)) {
    const child = activeProviderChild
    signalProviderChild(child, providerSignal)
    activeProviderKillTimer = setTimeout(() => {
      if (activeProviderChild === child && providerChildRunning(child)) signalProviderChild(child, 'SIGKILL')
    }, PROVIDER_STOP_GRACE_MS)
    activeProviderKillTimer.unref?.()
  }
  resolveShutdown?.()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => requestShutdown(signal, signal))
}

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

Lifecycle environment (milliseconds):
  AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS        Absolute provider-turn limit (default 1800000)
  AGENT_VIEWER_COORD_PROVIDER_INACTIVITY_TIMEOUT_MS  No-output limit (default 600000)
  AGENT_VIEWER_COORD_PROVIDER_STOP_GRACE_MS          Grace before SIGKILL (default 2000)
  AGENT_VIEWER_COORD_RUN_CHECK_INTERVAL_MS           Terminal-run poll interval (default 5000)
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(args) {
  const options = { provider: 'codex', providerExplicit: false, cwd: process.cwd(), shared: false, once: false }
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (key === '--shared') options.shared = true
    else if (key === '--once') options.once = true
    else if (key === '--help' || key === '-h') options.help = true
    else if (key?.startsWith('--')) {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
      const optionName = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      options[optionName] = value
      if (optionName === 'provider') options.providerExplicit = true
      index += 1
    } else throw new Error(`Unknown argument: ${key}`)
  }
  return options
}

function normalizeUrl(value) {
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `http://${value.replace(/\/+$/, '')}`
}

async function api(baseUrl, action, body, timeoutMs = 65_000, allowDuringShutdown = false) {
  if (shutdownRequested && !allowDuringShutdown) throw supervisorStoppedError()
  if (coordinatorTransport() === 'ahp') {
    let client = ahpClients.get(baseUrl)
    if (!client) {
      client = new CoordinatorAhpClient({
        attachUrl: baseUrl,
        title: 'Agent Viewer Coordinator worker',
      })
      ahpClients.set(baseUrl, client)
    }
    return client.request(action, body, timeoutMs, allowDuringShutdown ? undefined : shutdownController.signal)
  }
  const response = await fetch(`${baseUrl}/api/agent-protocol/external`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    signal: allowDuringShutdown
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([AbortSignal.timeout(timeoutMs), shutdownController.signal]),
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
    await appendWorkerLog(state, line)
  } catch { /* logging must never stop coordination */ }
}

function appendWorkerLog(state, chunk) {
  const requested = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  const data = requested.length > WORKER_LOG_MAX_BYTES
    ? requested.subarray(requested.length - WORKER_LOG_MAX_BYTES)
    : requested
  const pending = logWriteChain.then(async () => {
    await mkdir(path.dirname(state.logFile), { recursive: true, mode: 0o700 })
    const currentSize = await stat(state.logFile).then((entry) => entry.size).catch(() => 0)
    if (currentSize > 0 && currentSize + data.length > WORKER_LOG_MAX_BYTES) {
      const rotated = `${state.logFile}.1`
      await rm(rotated, { force: true })
      await rename(state.logFile, rotated)
    }
    await appendFile(state.logFile, data, { mode: 0o600 })
    await chmod(state.logFile, 0o600)
  })
  logWriteChain = pending.catch(() => {})
  return pending
}

function classifyProviderFailure(error) {
  const text = `${error?.message || error}\n${error?.providerOutput || ''}`.toLowerCase()
  if (error?.code === 'COORDINATOR_PROVIDER_TURN_TIMEOUT') return 'provider_timeout'
  if (error?.code === 'ENOENT' || /enoent|command not found|not recognized as/.test(text)) return 'cli_missing'
  if (/rate.?limit|quota|usage limit|too many requests|429/.test(text)) return 'rate_limited'
  if (/unauthori[sz]ed|authentication|not logged in|invalid api key|401|403/.test(text)) return 'authentication_failed'
  if (/context (window|length)|maximum context|context.*exceed|too many tokens/.test(text)) return 'context_exhausted'
  if (/approval|permission.*denied|not approved|requires approval/.test(text)) return 'approval_blocked'
  if (/econnreset|econnrefused|timed? out|temporar|network|socket|transport/.test(text)) return 'transient_transport'
  return 'provider_failure'
}

function isTerminalCoordinatorError(error) {
  return /Coordinator (run|participant) not found/i.test(String(error?.message || error))
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
  const skillPath = path.join(state.cwd, '.agents', 'skills', 'coordinate-agents', 'SKILL.md')
  const checkoutGuidance = state.checkoutMode === 'isolated'
    ? `You are working in an isolated git worktree at ${state.cwd}; stay within granted paths and leave integration to the lead.`
    : `You are working in the shared checkout at ${state.cwd}; keep writes inside granted non-overlapping paths, preserve existing changes, and do not reset or clean files owned by another participant.`
  const roleGuidance = state.role === 'lead'
    ? 'You are the lead: supervise and delegate before implementing. Never claim a teammate lane merely because it is claimable; claim only an explicit lead integration/review task, or perform board work yourself when no teammate is available.'
    : 'You are a teammate: answer reply-required mail first, then continue your owned task or claim one unblocked teammate lane. Complete, release, or hand off owned work before going idle.'
  return [
    `Continue Coordinator run ${state.runId} as ${state.name || state.agentId} (${state.role || 'participant'}).`,
    'You are ALREADY bound to this run: never call coord_create_run, coord_join_run, or coord_list_runs — start with coord_status and act on its actionable digest.',
    `Read and follow the coordinate-agents skill at ${skillPath} if it exists, then use the agent-viewer coord_* MCP tools now. Do not search outside this checkout for the skill; these supervisor instructions are sufficient if the file is absent.`,
    checkoutGuidance,
    roleGuidance,
    'Drain the inbox, then perform every immediately actionable role-appropriate step, including implementation and verification.',
    'Coordinate actively — teammates run in other CLIs and cannot see your terminal: answer reply_required mail first, publish reusable discoveries with coord_publish_finding, and send coord_send_message whenever your progress, blockers, or findings affect another lane.',
    'If you are the lead, maintain an explicit status view for every teammate from coord_status: active task, working/blocked/idle state, latest update, and terminal task result. Do not interrupt healthy work; unblock, reassign, or add work when the board shows a real need.',
    'If blocked, report blocked with coord_progress and include the exact obstacle; the Coordinator will alert the lead. Also message the teammate best placed to help, check the inbox for guidance, and report working again as soon as you can resume.',
    'If your task work will take several steps, call coord_read_inbox again partway through rather than only at the start — a reply_required message from the lead can arrive mid-task and change your plan; you will not be woken for it until you check.',
    'Use stable request_id values before retrying mutations. If no action is ready, return control to the supervisor; do not poll or sleep.',
    'If all tasks are terminal and you are lead, review every durable task result, synthesize the run, and finalize it. Never print participant credentials.',
  ].join(' ')
}

async function providerTick(state, baseUrl) {
  if (shutdownRequested) throw supervisorStoppedError()
  const config = mcpConfig(state, baseUrl)
  const prompt = tickPrompt(state)
  const previousProviderSessionId = state.providerSessionId
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
    command = process.env.COPILOT_CLI_PATH || process.env.COPILOT_PATH || 'copilot'
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

  // Claude and Pi allocate their resumable id before launch. Persist it before
  // starting the provider so a supervisor crash during the first turn cannot
  // orphan the native conversation.
  if (state.providerSessionId && state.providerSessionId !== previousProviderSessionId) {
    await saveState(state.identityFile, state)
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
      detached: process.platform !== 'win32',
    })
    activeProviderChild = child
    let buffered = ''
    let droppingOversizedFrame = false
    let providerOutput = ''
    let sessionStateSave = Promise.resolve()
    let turnTimedOut = false
    let providerTimeoutDetail = null
    let timeoutKillTimer = null
    let runCheckInFlight = false
    let lastProviderActivityAt = Date.now()
    const beginProviderTimeout = (detail) => {
      if (turnTimedOut) return
      turnTimedOut = true
      providerTimeoutDetail = detail
      signalProviderChild(child, 'SIGTERM')
      timeoutKillTimer = setTimeout(() => {
        if (providerChildRunning(child)) signalProviderChild(child, 'SIGKILL')
      }, PROVIDER_STOP_GRACE_MS)
      timeoutKillTimer.unref?.()
    }
    const turnTimeoutTimer = setTimeout(() => {
      beginProviderTimeout(`exceeded the ${PROVIDER_TURN_TIMEOUT_MS}ms Coordinator provider-turn deadline`)
    }, PROVIDER_TURN_TIMEOUT_MS)
    turnTimeoutTimer.unref?.()
    const inactivityTimer = setInterval(() => {
      if (Date.now() - lastProviderActivityAt < PROVIDER_INACTIVITY_TIMEOUT_MS || turnTimedOut) return
      beginProviderTimeout(`produced no output for ${PROVIDER_INACTIVITY_TIMEOUT_MS}ms`)
    }, Math.min(5_000, Math.max(50, Math.floor(PROVIDER_INACTIVITY_TIMEOUT_MS / 2))))
    inactivityTimer.unref?.()
    const runCheckTimer = setInterval(async () => {
      if (runCheckInFlight || shutdownRequested) return
      runCheckInFlight = true
      try {
        const current = await api(baseUrl, 'wait', { ...state, cursor: null, timeoutMs: 0 }, 10_000)
        if (isTerminal(current)) requestShutdown('terminal Coordinator run', 'SIGTERM')
      } catch (error) {
        if (isTerminalCoordinatorError(error)) requestShutdown('deleted Coordinator run', 'SIGTERM')
      } finally {
        runCheckInFlight = false
      }
    }, RUN_CHECK_INTERVAL_MS)
    runCheckTimer.unref?.()
    const clearTurnTimers = () => {
      clearTimeout(turnTimeoutTimer)
      clearInterval(inactivityTimer)
      clearInterval(runCheckTimer)
      if (timeoutKillTimer) clearTimeout(timeoutKillTimer)
    }
    const providerTimeoutError = () => {
      const error = new Error(`${command} ${providerTimeoutDetail ?? 'exceeded its Coordinator provider-turn limit'}`)
      error.code = 'COORDINATOR_PROVIDER_TURN_TIMEOUT'
      error.providerOutput = providerOutput
      return error
    }
    child.stdout.on('data', (chunk) => {
      lastProviderActivityAt = Date.now()
      process.stdout.write(chunk)
      void appendWorkerLog(state, chunk).catch(() => {})
      providerOutput = `${providerOutput}${chunk.toString()}`.slice(-16_000)
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() || ''
      for (const line of lines) {
        if (droppingOversizedFrame) {
          droppingOversizedFrame = false
          continue
        }
        if (Buffer.byteLength(line) > PROVIDER_FRAME_MAX_BYTES) continue
        try {
          const event = JSON.parse(line)
          // codex: thread_id · claude: session_id · opencode: sessionID (also
          // nested under info/part) · copilot: sessionId
          const sessionId = event.thread_id || event.session_id || event.sessionID || event.sessionId
            || event.info?.sessionID || event.part?.sessionID
          if (typeof sessionId === 'string' && sessionId && sessionId !== state.providerSessionId) {
            state.providerSessionId = sessionId
            // Serialize identity writes because providers can repeat the session
            // id across several events in the same stdout burst.
            sessionStateSave = sessionStateSave.then(() => saveState(state.identityFile, state))
          }
        } catch { /* provider text or partial JSON */ }
      }
      if (Buffer.byteLength(buffered) > PROVIDER_FRAME_MAX_BYTES) {
        providerOutput = `${providerOutput}\n[provider frame discarded: exceeded ${PROVIDER_FRAME_MAX_BYTES} bytes]`.slice(-16_000)
        buffered = ''
        // Bytes through the next newline still belong to the discarded frame.
        // Treating that tail as fresh JSON would let a hostile split frame
        // overwrite durable provider identity.
        droppingOversizedFrame = true
      }
    })
    child.stderr.on('data', (chunk) => {
      lastProviderActivityAt = Date.now()
      process.stderr.write(chunk)
      void appendWorkerLog(state, chunk).catch(() => {})
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
    child.on('error', async (error) => {
      clearInterval(heartbeat)
      clearTurnTimers()
      clearProviderChild(child)
      error.providerOutput = providerOutput
      try {
        await sessionStateSave
        reject(turnTimedOut ? providerTimeoutError() : error)
      } catch (saveError) {
        reject(saveError)
      }
    })
    child.on('exit', async (code, signal) => {
      clearInterval(heartbeat)
      clearTurnTimers()
      clearProviderChild(child)
      try {
        await sessionStateSave
        if (turnTimedOut) reject(providerTimeoutError())
        else if (code === 0) resolve()
        else {
          const error = new Error(`${command} exited ${code ?? signal}`)
          error.providerOutput = providerOutput
          reject(error)
        }
      } catch (saveError) {
        reject(saveError)
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
  if (options.providerExplicit && state.provider !== options.provider) {
    state.provider = options.provider
    // Session identifiers are provider-native and cannot be resumed by a
    // different CLI. Preserve the Coordinator identity, but start a fresh
    // provider conversation for the failover supervisor.
    delete state.providerSessionId
  } else {
    state.provider ||= options.provider
  }
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

async function retryDelay(delay) {
  if (shutdownRequested) return
  let timer
  await Promise.race([
    new Promise((resolve) => { timer = setTimeout(resolve, delay) }),
    shutdownRequestedPromise,
  ])
  if (timer) clearTimeout(timer)
}

function isTerminal(wait) {
  const status = wait?.actionable?.runStatus ?? wait?.snapshot?.run?.status
  return ['completed', 'failed', 'stopped'].includes(status)
}

// A provider tick is a full model turn; only spend one when the wait's
// actionable digest shows work for this role. Leads also wake for claimable
// work so they can assign it or claim an explicit integration lane; their
// prompt keeps ordinary teammate lanes delegated. Teammates act on mail,
// claimable tasks, or their owned task.
// Daemons that predate the digest omit it — then every wake ticks, as before.
function shouldTick(actionable, role) {
  if (!actionable) return true
  if ((actionable.inboxCount ?? 0) > 0) return true
  if ((actionable.replyRequiredCount ?? 0) > 0) return true
  if (role === 'lead') {
    return (actionable.plansAwaitingReview?.length ?? 0) > 0
      || Boolean(actionable.myTask)
      || (actionable.claimableTasks?.length ?? 0) > 0
      || actionable.allTasksTerminal === true
      || actionable.runStatus === 'synthesizing'
  }
  return (actionable.claimableTasks?.length ?? 0) > 0 || Boolean(actionable.myTask)
}

let cursor = null
let providerFailures = 0
let coordinatorFailures = 0
let finalStatus = 'stopped'
const role = state.role === 'lead' ? 'lead' : 'teammate'

async function leaveRunBeforeExit(reason, status = 'stopped') {
  await api(baseUrl, 'leave_run', {
    ...state,
    reason,
    requestId: `worker-leave-${workerInstanceId}`,
  }, 10_000, true)
  finalStatus = status
  await workerLog(state, `${reason}; participant retired from the active roster`)
}

async function checkpointForSupervisorStop(detail) {
  try {
    const current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 }, 10_000, true)
    cursor = current.cursor
    const ownedTask = current?.actionable?.myTask
    if (isTerminal(current)) return
    if (!ownedTask) {
      await leaveRunBeforeExit(
        `${state.provider} worker retired before supervisor shutdown: ${detail}`,
      )
      return
    }
    const summary = `${state.provider} worker checkpointed ${ownedTask.id} before supervisor shutdown`
    await api(baseUrl, 'handoff_task', {
      ...state,
      taskId: ownedTask.id,
      summary,
      detail,
      failureClass: 'supervisor_stopped',
      requestId: `worker-handoff-${ownedTask.id}-supervisor-stopped-${workerInstanceId}`,
    }, 10_000, true)
    finalStatus = 'handed_off'
    await workerLog(state, `${summary}; task returned to board`)
  } catch (error) {
    if (isTerminalCoordinatorError(error)) return
    state.lastFailureClass = 'transient_transport'
    state.lastError = error.message
    process.exitCode = 1
    await workerLog(state, `supervisor shutdown could not verify or hand off owned work: ${error.message}`)
  }
}

outer: for (;;) {
  if (shutdownRequested) {
    await checkpointForSupervisorStop(`Supervisor received ${shutdownSignal ?? 'a shutdown request'} before the next provider turn.`)
    break
  }
  try {
    const recoveringProvider = providerFailures > 0
    await providerTick(state, baseUrl)
    providerFailures = 0
    if (recoveringProvider) {
      delete state.lastFailureClass
      delete state.lastError
      await writeWorkerRecord(state.identityFile, {
        status: 'running',
        failures: coordinatorFailures,
        failureClass: undefined,
        lastError: undefined,
        recoveredAt: new Date().toISOString(),
      })
    }
    await saveState(state.identityFile, state)
  } catch (error) {
    if (shutdownRequested) {
      await checkpointForSupervisorStop(`Supervisor received ${shutdownSignal ?? 'a shutdown request'} and stopped the active provider turn.`)
      break
    }
    providerFailures += 1
    const failureClass = classifyProviderFailure(error)
    state.lastFailureClass = failureClass
    state.lastError = error.message
    await workerLog(state, `provider tick failed class=${failureClass} attempt=${providerFailures}: ${error.message}`)
    await writeWorkerRecord(state.identityFile, {
      status: 'retrying',
      failureClass,
      failures: providerFailures,
      lastError: error.message,
    })
    // A broken provider CLI must not strand the supervisor forever after the
    // run was stopped or completed by another participant.
    let current
    try {
      current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 })
      cursor = current.cursor
      if (isTerminal(current)) break
    } catch (waitError) {
      if (isTerminalCoordinatorError(waitError)) break
      // Retain the provider error and retry when the daemon is unavailable.
    }
    // Transient transport failures deserve retries, but not an infinite lease
    // on owned work. After a bounded retry window, checkpoint exactly like a
    // persistent provider failure so another healthy teammate can take over.
    const durableFailure = failureClass === 'transient_transport'
      ? providerFailures >= 5
      : (failureClass !== 'provider_failure' || providerFailures >= 3)
    const ownedTask = current?.actionable?.myTask
    if (ownedTask && (durableFailure || options.once)) {
      const summary = `${state.provider} worker checkpointed ${ownedTask.id} after ${failureClass}`
      try {
        await api(baseUrl, 'handoff_task', {
          ...state,
          taskId: ownedTask.id,
          summary,
          detail: `Provider CLI error: ${error.message}`,
          failureClass,
          requestId: `worker-handoff-${ownedTask.id}-${failureClass}-${workerInstanceId}`,
        })
        finalStatus = 'handed_off'
        await workerLog(state, `${summary}; task returned to board`)
        console.error(`${summary}; task returned to board`)
        break
      } catch (handoffError) {
        await workerLog(state, `automatic handoff failed: ${handoffError.message}`)
      }
    }
    if (!ownedTask && (durableFailure || options.once)) {
      const reason = `${state.provider} worker retired after ${failureClass}: ${error.message}`
      try {
        await leaveRunBeforeExit(reason, 'failed')
        process.exitCode = 1
        console.error(reason)
        break
      } catch (leaveError) {
        await workerLog(state, `automatic participant retirement failed: ${leaveError.message}`)
      }
    }
    if (options.once) {
      console.error(`Coordinator tick failed: ${error.message}`)
      process.exitCode = 1
      break
    }
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(providerFailures - 1, 5))
    console.error(`Coordinator tick failed: ${error.message}; retrying in ${delay}ms`)
    await retryDelay(delay)
    continue
  }
  if (shutdownRequested) {
    await checkpointForSupervisorStop(`Supervisor received ${shutdownSignal ?? 'a shutdown request'} after the provider turn.`)
    break
  }
  if (options.once) {
    // A single model turn may claim work before returning. Exiting with that
    // lease still attached strands the task until stale recovery, so a bounded
    // worker must checkpoint it explicitly before it stops.
    try {
      const current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 })
      cursor = current.cursor
      const ownedTask = current?.actionable?.myTask
      if (!isTerminal(current) && ownedTask) {
        const summary = `${state.provider} worker checkpointed ${ownedTask.id} after its bounded --once turn`
        await api(baseUrl, 'handoff_task', {
          ...state,
          taskId: ownedTask.id,
          summary,
          detail: 'The bounded supervisor completed its single provider turn while the task was still owned.',
          failureClass: 'supervisor_stopped',
          requestId: `worker-handoff-${ownedTask.id}-supervisor-stopped-${workerInstanceId}`,
        })
        finalStatus = 'handed_off'
        await workerLog(state, `${summary}; task returned to board`)
      } else if (!isTerminal(current)) {
        await leaveRunBeforeExit(`${state.provider} worker completed its bounded --once turn without owned work`)
      }
    } catch (error) {
      state.lastFailureClass = 'transient_transport'
      state.lastError = error.message
      await workerLog(state, `bounded worker could not verify or hand off owned work: ${error.message}`)
      console.error(`Coordinator --once handoff check failed: ${error.message}`)
      process.exitCode = 1
    }
    break
  }
  try {
    const current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 })
    if (coordinatorFailures > 0) {
      coordinatorFailures = 0
      if (providerFailures === 0) {
        delete state.lastFailureClass
        delete state.lastError
        await writeWorkerRecord(state.identityFile, {
          status: 'running',
          failures: 0,
          failureClass: undefined,
          lastError: undefined,
          recoveredAt: new Date().toISOString(),
        })
      }
    }
    cursor = current.cursor
    if (isTerminal(current)) break
    // The provider turn may have claimed a task, received mail, or left owned
    // work open. Act on that returned digest immediately instead of entering a
    // 55-second long poll and adding avoidable coordination latency.
    if (shouldTick(current.actionable, role)) continue
    for (;;) {
      const next = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 55_000 })
      cursor = next.cursor
      if (isTerminal(next)) break outer
      if (shouldTick(next.actionable, role)) break
    }
  } catch (error) {
    if (shutdownRequested) {
      await checkpointForSupervisorStop(`Supervisor received ${shutdownSignal ?? 'a shutdown request'} while waiting for Coordinator work.`)
      break
    }
    if (isTerminalCoordinatorError(error)) break
    coordinatorFailures += 1
    state.lastFailureClass = 'transient_transport'
    state.lastError = error.message
    await workerLog(state, `coordinator wait failed attempt=${coordinatorFailures}: ${error.message}`)
    await writeWorkerRecord(state.identityFile, {
      status: 'retrying',
      failureClass: 'transient_transport',
      failures: coordinatorFailures,
      lastError: error.message,
    })
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(coordinatorFailures - 1, 5))
    console.error(`Coordinator wait failed: ${error.message}; retrying in ${delay}ms`)
    await retryDelay(delay)
  }
}

await saveState(state.identityFile, state)
clearInterval(heartbeatTimer)
await writeWorkerRecord(state.identityFile, {
  status: finalStatus,
  pid: process.pid,
  stoppedAt: new Date().toISOString(),
  failures: providerFailures + coordinatorFailures,
  failureClass: state.lastFailureClass,
  lastError: state.lastError,
})
await workerLog(state, `worker exiting status=${finalStatus}`)
// A shutdown checkpoint can create a fresh AHP client after requestShutdown()
// closed the original one. Always close the final transport set so a recorded
// "worker exiting" state also means the supervisor process can actually exit.
closeAhpClients()

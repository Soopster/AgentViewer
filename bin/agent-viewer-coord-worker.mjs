#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function usage(message) {
  if (message) console.error(message)
  console.log(`Usage:
  agent-viewer coord worker --start <goal> --name <name> [--provider codex|claude]
  agent-viewer coord worker --join <run-id> --name <name> [--provider codex|claude]
  agent-viewer coord worker --identity <file> [--provider codex|claude]

Options:
  --attach <url>       Agent Viewer web daemon (default http://127.0.0.1:3000)
  --cwd <path>         Source checkout (default current directory)
  --shared             Join in the current checkout instead of an isolated worktree
  --once               Run one CLI tick and exit
  --identity <file>    Durable 0600 participant and provider-session state
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
  return path.join(os.homedir(), '.agent-viewer', 'coordinator', state.runId, `${state.agentId}.json`)
}

function mcpConfig(state, baseUrl) {
  const entry = fileURLToPath(new URL('./agent-viewer.mjs', import.meta.url))
  return {
    command: process.execPath,
    args: [entry, 'mcp', '--attach', baseUrl, '--identity', state.identityFile],
  }
}

function tickPrompt(state) {
  return [
    `Continue Coordinator run ${state.runId} as ${state.name || state.agentId} (${state.role || 'participant'}).`,
    'Use the coordinate-agents skill and the agent-viewer coord_* MCP tools now.',
    'Drain the inbox, read status, and perform every immediately actionable role-appropriate step, including implementation and verification.',
    'Use stable request_id values before retrying mutations. If no action is ready, return control to the supervisor; do not poll or sleep.',
    'If all tasks are terminal and you are lead, review results and finalize the run. Never print participant credentials.',
  ].join(' ')
}

async function providerTick(state, baseUrl) {
  const config = mcpConfig(state, baseUrl)
  const prompt = tickPrompt(state)
  let command
  let args
  if (state.provider === 'claude') {
    command = process.env.CLAUDE_PATH || 'claude'
    args = [
      '-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'auto',
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { 'agent-viewer': config } }),
      state.providerSessionId ? '--resume' : '--session-id', state.providerSessionId || randomUUID(),
      prompt,
    ]
    state.providerSessionId ||= args[args.indexOf('--session-id') + 1]
  } else {
    command = process.env.CODEX_PATH || 'codex'
    const configArgs = [
      '-c', `mcp_servers.agent-viewer.command=${JSON.stringify(config.command)}`,
      '-c', `mcp_servers.agent-viewer.args=${JSON.stringify(config.args)}`,
      '-c', 'mcp_servers.agent-viewer.required=true',
      '-c', 'approval_policy="never"',
      '-c', 'sandbox_mode="workspace-write"',
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
        AGENT_VIEWER_ATTACH: baseUrl,
        AGENT_VIEWER_COORD_IDENTITY_FILE: state.identityFile,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let buffered = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() || ''
      for (const line of lines) {
        try {
          const event = JSON.parse(line)
          const sessionId = event.thread_id || event.session_id
          if (typeof sessionId === 'string' && sessionId) state.providerSessionId = sessionId
        } catch { /* provider text or partial JSON */ }
      }
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
    child.on('error', (error) => { clearInterval(heartbeat); reject(error) })
    child.on('exit', (code, signal) => {
      clearInterval(heartbeat)
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`))
    })
  })
}

let options
try { options = parseArgs(process.argv.slice(2)) } catch (error) { usage(error.message) }
if (!options || options.help) usage()
if (!['codex', 'claude'].includes(options.provider)) usage('--provider must be codex or claude')

let baseUrl = normalizeUrl(options.attach || 'http://127.0.0.1:3000')
let state
if (options.identity && !options.start && !options.join) {
  state = JSON.parse(await readFile(path.resolve(options.identity), 'utf8'))
  state.identityFile = path.resolve(options.identity)
  state.provider ||= options.provider
  state.cwd ||= options.cwd
  if (!options.attach && state.attach) baseUrl = normalizeUrl(state.attach)
} else {
  if (!options.name || (!options.start && !options.join) || (options.start && options.join)) {
    usage('Provide --name and exactly one of --start or --join')
  }
  let cwd = path.resolve(options.cwd)
  if (options.join && !options.shared) cwd = await isolatedWorktree(cwd, options.join, options.name)
  const result = await api(baseUrl, options.start ? 'create_run' : 'join_run', {
    ...(options.start ? { prompt: options.start } : { runId: options.join }),
    name: options.name,
    provider: options.provider,
    cwd,
  })
  state = { ...result.participant, cwd, attach: baseUrl }
  state.identityFile = path.resolve(options.identity || identityFileFor(state))
}
state.attach = baseUrl
await saveState(state.identityFile, state)
console.error(`Coordinator ${state.runId}: ${state.name || state.agentId} (${state.role || 'participant'})`)
console.error(`Identity: ${state.identityFile}`)

let cursor = null
let failures = 0
for (;;) {
  try {
    await providerTick(state, baseUrl)
    failures = 0
    await saveState(state.identityFile, state)
  } catch (error) {
    failures += 1
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5))
    console.error(`Coordinator tick failed: ${error.message}; retrying in ${delay}ms`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    continue
  }
  if (options.once) break
  const current = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 0 })
  cursor = current.cursor
  if (['completed', 'failed', 'stopped'].includes(current.snapshot.run.status)) break
  const next = await api(baseUrl, 'wait', { ...state, cursor, timeoutMs: 55_000 })
  cursor = next.cursor
  if (['completed', 'failed', 'stopped'].includes(next.snapshot.run.status)) break
}

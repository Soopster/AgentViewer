#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { open, readFile, stat, watch } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  coordinatorStateRoot,
  inspectIdentity,
  listWorkerRecords,
  managedWorkerProcess,
  processAlive,
  resolveWorkerRecord,
  workerLogPath,
  writeWorkerRecord,
} from './agent-viewer-coord-state.mjs'

const args = process.argv.slice(2)
const command = args[0]
const PROVIDER_CHECK_TIMEOUT_MS = Math.max(100, Number(process.env.AGENT_VIEWER_COORD_CLI_TIMEOUT_MS) || 5_000)
const WORKER_STOP_TIMEOUT_MS = Math.max(500, Number(process.env.AGENT_VIEWER_COORD_STOP_TIMEOUT_MS) || 25_000)

function option(name, fallback) {
  const direct = args.indexOf(name)
  if (direct >= 0) return args[direct + 1] ?? fallback
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}

const COMMAND_OPTIONS = {
  doctor: { flags: new Set(['--json']), values: new Set(['--attach', '--identity', '--limit']), positionals: 0 },
  workers: { flags: new Set(['--json']), values: new Set(['--run', '--status', '--limit']), positionals: 0 },
  restart: { flags: new Set(), values: new Set(['--provider']), positionals: 1 },
  logs: { flags: new Set(['-f', '--follow']), values: new Set(['-n']), positionals: 1 },
}

function validateCommandArgs() {
  const spec = COMMAND_OPTIONS[command]
  if (!spec) return
  let positionals = 0
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (spec.flags.has(arg)) continue
    const equals = arg.indexOf('=')
    const optionName = equals > 0 ? arg.slice(0, equals) : arg
    if (spec.values.has(optionName)) {
      const value = equals > 0 ? arg.slice(equals + 1) : args[index + 1]
      if (!value || (equals < 0 && value.startsWith('-'))) usage(`${optionName} requires a value`)
      if (equals < 0) index += 1
      continue
    }
    if (arg.startsWith('-')) usage(`Unknown ${command} option: ${arg}`)
    positionals += 1
    if (positionals > spec.positionals) usage(`Unexpected ${command} argument: ${arg}`)
  }
  if (positionals < spec.positionals) usage(`coord ${command} requires a worker selector`)
}

function boundedIntegerOption(name, fallback, minimum, maximum) {
  const raw = option(name)
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw)) usage(`${name} must be an integer from ${minimum} to ${maximum}`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    usage(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function normalizeUrl(value) {
  const input = String(value || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  if (/^\d+$/.test(input)) return `http://127.0.0.1:${input}`
  return /^https?:\/\//.test(input) ? input : `http://${input}`
}

function usage(message) {
  if (message) console.error(message)
  console.log(`Usage:
  agent-viewer coord doctor [--json] [--attach <url>] [--identity <file>] [--limit <n>]
  agent-viewer coord workers [--json] [--run <run-id>] [--status <status>] [--limit <n>]
  agent-viewer coord restart <agent-id|name|identity-file> [--provider codex|claude|opencode|copilot|pi]
  agent-viewer coord logs <agent-id|name|identity-file> [-n <lines>] [-f]
`)
  process.exit(message ? 1 : 0)
}

function executableCheck(name, ...envNames) {
  const executable = envNames.map((envName) => process.env[envName]).find(Boolean) || name
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer
    const child = spawn(executable, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const finish = (status, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const ok = !error && !timedOut && status === 0
      resolve({
        name,
        executable,
        ok,
        version: ok ? String(stdout || stderr).trim().split('\n')[0] : undefined,
        error: timedOut
          ? `ETIMEDOUT after ${PROVIDER_CHECK_TIMEOUT_MS}ms`
          : error?.message || (!ok ? stderr.trim() || `exit ${status}` : undefined),
      })
    }
    child.stdout?.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-16_000) })
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000) })
    child.on('error', (error) => finish(null, error))
    child.on('exit', (status) => finish(status))
    timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, PROVIDER_CHECK_TIMEOUT_MS)
    timer.unref?.()
  })
}

async function daemonCheck(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/provider`, { signal: AbortSignal.timeout(5_000) })
    return { ok: response.ok, status: response.status, error: response.ok ? undefined : await response.text() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function protocolCheck(baseUrl, identityFile) {
  if (!identityFile) {
    return { ok: true, serverExpected: 2, minimumCompatible: 1, observedServer: null, negotiated: null, detail: 'identity not supplied; live negotiation not probed' }
  }
  try {
    const identity = JSON.parse(await readFile(identityFile, 'utf8'))
    const response = await fetch(`${baseUrl}/api/agent-protocol/external`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', runId: identity.runId, agentId: identity.agentId, token: identity.token }),
      signal: AbortSignal.timeout(5_000),
    })
    const payload = await response.json().catch(() => null)
    const observedServer = Number(response.headers.get('x-agent-viewer-coord-protocol')) || null
    const negotiated = payload?.snapshot?.agents?.find?.((agent) => agent.id === identity.agentId)?.client?.protocolVersion ?? 1
    return {
      ok: response.ok && observedServer !== null && observedServer >= 1 && negotiated <= observedServer,
      serverExpected: 2,
      minimumCompatible: 1,
      observedServer,
      negotiated,
      error: response.ok ? undefined : payload?.error || `${response.status} ${response.statusText}`,
    }
  } catch (error) {
    return { ok: false, serverExpected: 2, minimumCompatible: 1, error: error instanceof Error ? error.message : String(error) }
  }
}

async function doctor() {
  const json = args.includes('--json')
  const identityFile = option('--identity', process.env.AGENT_VIEWER_COORD_IDENTITY_FILE)
  const limit = boundedIntegerOption('--limit', 20, 1, 1_000)
  const records = await listWorkerRecords()
  const identity = identityFile ? await inspectIdentity(path.resolve(identityFile)) : null
  const scopedRecords = identity?.runId
    ? records.filter((record) => record.runId === identity.runId)
    : records
  const baseUrl = normalizeUrl(option('--attach', process.env.AGENT_VIEWER_ATTACH || identity?.attach))
  const providerClis = await Promise.all([
    executableCheck('codex', 'CODEX_PATH'),
    executableCheck('claude', 'CLAUDE_PATH'),
    executableCheck('opencode', 'OPENCODE_PATH'),
    executableCheck('copilot', 'COPILOT_CLI_PATH', 'COPILOT_PATH'),
    executableCheck('pi', 'PI_PATH'),
  ])
  const workerSummary = {
    total: scopedRecords.length,
    alive: scopedRecords.filter((record) => record.alive).length,
    stale: scopedRecords.filter((record) => record.stale).length,
    shown: Math.min(scopedRecords.length, limit),
  }
  const checks = {
    daemon: await daemonCheck(baseUrl),
    protocol: await protocolCheck(baseUrl, identityFile ? path.resolve(identityFile) : null),
    providerClis,
    identity: identityFile ? { file: path.resolve(identityFile), ...identity, secureMode: identity?.mode === 0o600 } : null,
    workerSummary,
    workers: scopedRecords.slice(0, limit).map(({ token: _token, ...record }) => record),
  }
  const failures = [
    !checks.daemon.ok && 'daemon',
    !checks.protocol.ok && 'protocol',
    checks.identity && (!checks.identity.ok || !checks.identity.secureMode) && 'identity',
    checks.identity?.provider && !providerClis.find((cli) => cli.name === checks.identity.provider)?.ok && `provider-cli:${checks.identity.provider}`,
    scopedRecords.some((record) => record.stale) && 'stale-workers',
  ].filter(Boolean)
  const report = {
    ok: failures.length === 0,
    cwd: process.cwd(),
    attach: baseUrl,
    stateRoot: coordinatorStateRoot(),
    failures,
    checks,
  }
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`Coordinator doctor: ${report.ok ? 'ok' : 'needs attention'}`)
    console.log(`Daemon: ${checks.daemon.ok ? 'reachable' : `unreachable (${checks.daemon.error})`}`)
    for (const cli of checks.providerClis) console.log(`${cli.name}: ${cli.ok ? cli.version : `unavailable (${cli.error})`}`)
    if (checks.identity) console.log(`Identity: ${checks.identity.ok && checks.identity.secureMode ? 'valid 0600' : 'invalid or insecure'}`)
    console.log(`Workers: ${workerSummary.total} registered, ${workerSummary.alive} alive, ${workerSummary.stale} stale${workerSummary.shown < workerSummary.total ? ` (${workerSummary.shown} shown; use --limit)` : ''}`)
  }
  if (!report.ok) process.exitCode = 1
}

async function workers() {
  const runId = option('--run')
  const status = option('--status')
  const validStatuses = new Set(['running', 'starting', 'retrying', 'stopped', 'handed_off', 'failed', 'corrupt', 'stale'])
  if (status && !validStatuses.has(status)) usage(`--status must be one of: ${[...validStatuses].join(', ')}`)
  const limit = boundedIntegerOption('--limit', 100, 1, 1_000)
  const records = (await listWorkerRecords())
    .filter((record) => !runId || record.runId === runId)
    .filter((record) => {
      if (!status) return true
      if (status === 'stale') return record.stale
      if (['running', 'starting', 'retrying'].includes(status)) return !record.stale && record.status === status
      return record.status === status
    })
    .slice(0, limit)
  if (args.includes('--json')) {
    console.log(JSON.stringify(records.map(({ token: _token, ...record }) => record), null, 2))
    return
  }
  if (records.length === 0) {
    console.log('No Coordinator workers registered.')
    return
  }
  for (const record of records) {
    console.log([
      record.alive ? 'running' : record.stale ? 'stale' : record.status || 'stopped',
      record.name || record.agentId || 'unknown',
      record.provider || 'unknown',
      record.runId || 'unknown-run',
      `pid=${record.pid || '-'}`,
      record.identityFile,
    ].join('\t'))
  }
}

async function restart() {
  const selector = args[1]
  if (!selector || selector.startsWith('-')) usage('coord restart requires a worker selector')
  const provider = option('--provider')
  if (provider && !['codex', 'claude', 'opencode', 'copilot', 'pi'].includes(provider)) {
    usage('--provider must be codex, claude, opencode, copilot, or pi')
  }
  const record = await resolveWorkerRecord(selector)
  if (!record.identityFile) throw new Error('Worker record has no identity file')
  if (processAlive(Number(record.pid))) {
    const verifiedWorker = managedWorkerProcess(Number(record.pid), record)
    if (!verifiedWorker) {
      throw new Error(`Refusing to signal pid ${record.pid}: it is not the recorded Agent Viewer Coordinator worker`)
    } else {
      process.kill(Number(record.pid), 'SIGTERM')
      const deadline = Date.now() + WORKER_STOP_TIMEOUT_MS
      while (processAlive(Number(record.pid)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (processAlive(Number(record.pid))) {
        throw new Error(
          `Worker pid ${record.pid} did not stop within ${WORKER_STOP_TIMEOUT_MS}ms; refusing to start a duplicate supervisor`,
        )
      }
    }
  }
  const launcher = fileURLToPath(new URL('./agent-viewer.mjs', import.meta.url))
  const child = spawn(process.execPath, [
    launcher, 'coord', 'worker', '--identity', record.identityFile,
    ...(provider ? ['--provider', provider] : []),
  ], {
    cwd: record.cwd || process.cwd(),
    detached: true,
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordinatorStateRoot() },
    stdio: 'ignore',
  })
  child.unref()
  await writeWorkerRecord(record.identityFile, {
    status: 'starting',
    pid: child.pid,
    ...(provider ? { provider } : {}),
    restartRequestedAt: new Date().toISOString(),
  })
  console.log(`Restarted ${record.name || record.agentId} as pid ${child.pid}.`)
}

async function logs() {
  const selector = args[1]
  if (!selector || selector.startsWith('-')) usage('coord logs requires a worker selector')
  const record = await resolveWorkerRecord(selector)
  const file = record.logFile || workerLogPath(record.identityFile)
  const rotatedFile = `${file}.1`
  const count = boundedIntegerOption('-n', 100, 1, 10_000)
  let offset = 0
  let activeIdentity = null
  async function printTail(initial) {
    let content = ''
    let identity = null
    try { content = await readFile(file, 'utf8') } catch (error) {
      if (initial) throw new Error(`Cannot read worker log ${file}: ${error instanceof Error ? error.message : error}`)
      return
    }
    try {
      const entry = await stat(file)
      identity = `${entry.dev}:${entry.ino}`
    } catch {}
    if (initial) {
      const rotated = await readFile(rotatedFile, 'utf8').catch(() => '')
      const lines = `${rotated}${content}`.split('\n')
      process.stdout.write(`${lines.slice(Math.max(0, lines.length - count - 1)).join('\n')}\n`)
    } else if ((activeIdentity && identity !== activeIdentity) || content.length < offset) {
      // Rotation renames the previous active file to .1. Drain anything that
      // arrived after our last offset, then continue from the new active file.
      const rotated = await readFile(rotatedFile, 'utf8').catch(() => '')
      if (rotated.length > offset) process.stdout.write(rotated.slice(offset))
      if (content) process.stdout.write(content)
    } else if (content.length > offset) {
      process.stdout.write(content.slice(offset))
    }
    offset = content.length
    activeIdentity = identity
  }
  await printTail(true)
  if (!args.includes('-f') && !args.includes('--follow')) return
  const handle = await open(file, 'r')
  await handle.close()
  const controller = new AbortController()
  const stopFollowing = () => controller.abort()
  process.once('SIGINT', stopFollowing)
  process.once('SIGTERM', stopFollowing)
  try {
    const directory = path.dirname(file)
    const activeName = path.basename(file)
    const rotatedName = path.basename(rotatedFile)
    for await (const event of watch(directory, { signal: controller.signal })) {
      if (event.filename === activeName || event.filename === rotatedName) await printTail(false)
    }
  } catch (error) {
    if (error?.name !== 'AbortError') throw error
  } finally {
    process.removeListener('SIGINT', stopFollowing)
    process.removeListener('SIGTERM', stopFollowing)
  }
}

try {
  validateCommandArgs()
  if (command === 'doctor') await doctor()
  else if (command === 'workers') await workers()
  else if (command === 'restart') await restart()
  else if (command === 'logs') await logs()
  else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

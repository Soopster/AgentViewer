#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { open, readFile, stat } from 'node:fs/promises'
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

function normalizeUrl(value) {
  const input = String(value || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  if (/^\d+$/.test(input)) return `http://127.0.0.1:${input}`
  return /^https?:\/\//.test(input) ? input : `http://${input}`
}

function usage(message) {
  if (message) console.error(message)
  console.log(`Usage:
  agent-viewer coord doctor [--json] [--attach <url>] [--identity <file>]
  agent-viewer coord workers [--json] [--run <run-id>] [--status <status>] [--limit <n>]
  agent-viewer coord restart <agent-id|name|identity-file> [--provider codex|claude|opencode|copilot|pi]
  agent-viewer coord logs <agent-id|name|identity-file> [-n <lines>] [-f]
`)
  process.exit(message ? 1 : 0)
}

function executableCheck(name, ...envNames) {
  const executable = envNames.map((envName) => process.env[envName]).find(Boolean) || name
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: PROVIDER_CHECK_TIMEOUT_MS })
  const ok = !result.error && result.status === 0
  return {
    name,
    executable,
    ok,
    version: ok ? String(result.stdout || result.stderr).trim().split('\n')[0] : undefined,
    error: result.error?.message || (!ok ? String(result.stderr || '').trim() || `exit ${result.status}` : undefined),
  }
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
  const records = await listWorkerRecords()
  const identity = identityFile ? await inspectIdentity(path.resolve(identityFile)) : null
  const scopedRecords = identity?.runId
    ? records.filter((record) => record.runId === identity.runId)
    : records
  const baseUrl = normalizeUrl(option('--attach', process.env.AGENT_VIEWER_ATTACH || identity?.attach))
  const providerClis = [
    executableCheck('codex', 'CODEX_PATH'),
    executableCheck('claude', 'CLAUDE_PATH'),
    executableCheck('opencode', 'OPENCODE_PATH'),
    executableCheck('copilot', 'COPILOT_CLI_PATH', 'COPILOT_PATH'),
    executableCheck('pi', 'PI_PATH'),
  ]
  const checks = {
    daemon: await daemonCheck(baseUrl),
    protocol: await protocolCheck(baseUrl, identityFile ? path.resolve(identityFile) : null),
    providerClis,
    identity: identityFile ? { file: path.resolve(identityFile), ...identity, secureMode: identity?.mode === 0o600 } : null,
    workers: scopedRecords.map(({ token: _token, ...record }) => record),
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
    console.log(`Workers: ${scopedRecords.length} registered, ${scopedRecords.filter((record) => record.alive).length} alive, ${scopedRecords.filter((record) => record.stale).length} stale`)
  }
  if (!report.ok) process.exitCode = 1
}

async function workers() {
  const runId = option('--run')
  const status = option('--status')
  const requestedLimit = Number(option('--limit', '100'))
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 1_000)) : 100
  const records = (await listWorkerRecords())
    .filter((record) => !runId || record.runId === runId)
    .filter((record) => !status || record.status === status)
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
  const count = Math.max(1, Math.min(10_000, Number(option('-n', 100)) || 100))
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
  setInterval(() => { void printTail(false) }, 500)
}

try {
  if (command === 'doctor') await doctor()
  else if (command === 'workers') await workers()
  else if (command === 'restart') await restart()
  else if (command === 'logs') await logs()
  else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

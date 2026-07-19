#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { open, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  coordinatorStateRoot,
  inspectIdentity,
  listWorkerRecords,
  processAlive,
  resolveWorkerRecord,
  workerLogPath,
  writeWorkerRecord,
} from './agent-viewer-coord-state.mjs'

const args = process.argv.slice(2)
const command = args[0]

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
  agent-viewer coord workers [--json]
  agent-viewer coord restart <agent-id|name|identity-file>
  agent-viewer coord logs <agent-id|name|identity-file> [-n <lines>] [-f]
`)
  process.exit(message ? 1 : 0)
}

function executableCheck(name, envName) {
  const executable = process.env[envName] || name
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5_000 })
  return {
    name,
    executable,
    ok: result.status === 0,
    version: result.status === 0 ? String(result.stdout || result.stderr).trim().split('\n')[0] : undefined,
    error: result.error?.message || (result.status !== 0 ? String(result.stderr || '').trim() || `exit ${result.status}` : undefined),
  }
}

function managedWorkerProcess(pid) {
  if (process.platform === 'win32') return false
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 2_000 })
  const commandLine = String(result.stdout || '')
  return result.status === 0 && (
    commandLine.includes('agent-viewer-coord-worker.mjs')
    || (commandLine.includes('agent-viewer.mjs') && commandLine.includes('coord') && commandLine.includes('worker'))
  )
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
  const baseUrl = normalizeUrl(option('--attach', process.env.AGENT_VIEWER_ATTACH))
  const identityFile = option('--identity', process.env.AGENT_VIEWER_COORD_IDENTITY_FILE)
  const records = await listWorkerRecords()
  const identity = identityFile ? await inspectIdentity(path.resolve(identityFile)) : null
  const providerClis = [
    executableCheck('codex', 'CODEX_PATH'),
    executableCheck('claude', 'CLAUDE_PATH'),
    executableCheck('opencode', 'OPENCODE_PATH'),
    executableCheck('copilot', 'COPILOT_PATH'),
    executableCheck('pi', 'PI_PATH'),
  ]
  const checks = {
    daemon: await daemonCheck(baseUrl),
    protocol: await protocolCheck(baseUrl, identityFile ? path.resolve(identityFile) : null),
    providerClis,
    identity: identityFile ? { file: path.resolve(identityFile), ...identity, secureMode: identity?.mode === 0o600 } : null,
    workers: records.map(({ token: _token, ...record }) => record),
  }
  const failures = [
    !checks.daemon.ok && 'daemon',
    !checks.protocol.ok && 'protocol',
    checks.identity && (!checks.identity.ok || !checks.identity.secureMode) && 'identity',
    checks.identity?.provider && !providerClis.find((cli) => cli.name === checks.identity.provider)?.ok && `provider-cli:${checks.identity.provider}`,
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
    console.log(`Workers: ${records.length} registered, ${records.filter((record) => record.alive).length} alive`)
  }
  if (!report.ok) process.exitCode = 1
}

async function workers() {
  const records = await listWorkerRecords()
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
      record.alive ? 'running' : record.status || 'stopped',
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
  const record = await resolveWorkerRecord(selector)
  if (!record.identityFile) throw new Error('Worker record has no identity file')
  if (record.alive && processAlive(Number(record.pid))) {
    if (!managedWorkerProcess(Number(record.pid))) {
      throw new Error(`Refusing to signal pid ${record.pid}: it is not an Agent Viewer Coordinator worker`)
    }
    process.kill(Number(record.pid), 'SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const launcher = fileURLToPath(new URL('./agent-viewer.mjs', import.meta.url))
  const child = spawn(process.execPath, [launcher, 'coord', 'worker', '--identity', record.identityFile], {
    cwd: record.cwd || process.cwd(),
    detached: true,
    env: { ...process.env, AGENT_VIEWER_COORD_HOME: coordinatorStateRoot() },
    stdio: 'ignore',
  })
  child.unref()
  await writeWorkerRecord(record.identityFile, { status: 'starting', pid: child.pid, restartRequestedAt: new Date().toISOString() })
  console.log(`Restarted ${record.name || record.agentId} as pid ${child.pid}.`)
}

async function logs() {
  const selector = args[1]
  if (!selector || selector.startsWith('-')) usage('coord logs requires a worker selector')
  const record = await resolveWorkerRecord(selector)
  const file = record.logFile || workerLogPath(record.identityFile)
  const count = Math.max(1, Math.min(10_000, Number(option('-n', 100)) || 100))
  let offset = 0
  async function printTail(initial) {
    let content = ''
    try { content = await readFile(file, 'utf8') } catch (error) {
      if (initial) throw new Error(`Cannot read worker log ${file}: ${error instanceof Error ? error.message : error}`)
      return
    }
    if (initial) {
      const lines = content.split('\n')
      process.stdout.write(`${lines.slice(Math.max(0, lines.length - count - 1)).join('\n')}\n`)
    } else if (content.length > offset) {
      process.stdout.write(content.slice(offset))
    }
    offset = content.length
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

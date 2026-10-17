// The background daemon a TUI can attach to, so closing the window does not
// stop the work (herdr's server/client split). `agent-viewer --daemon` starts
// one if none is answering and attaches; `agent-viewer daemon stop` ends it.
//
// The daemon is the ordinary `agent-viewer web` process, detached. Nothing here
// decides what it hosts: turns started through an attached TUI run server-side,
// which is what lets them outlive the client.

import { spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DAEMON_START_TIMEOUT_MS = 90_000
const PROBE_TIMEOUT_MS = 1_500

export function daemonStateDir() {
  return path.resolve(process.env.AGENT_VIEWER_DAEMON_HOME || path.join(os.homedir(), '.agent-viewer', 'daemon'))
}

export function daemonRecordPath(port) {
  return path.join(daemonStateDir(), `${port}.json`)
}

export function daemonLogPath(port) {
  return path.join(daemonStateDir(), `${port}.log`)
}

/**
 * What is answering on this port: an agent-viewer daemon, something else, or
 * nothing. "Something else" must never be attached to or started over.
 */
export async function probeDaemon(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const status = response.ok ? await response.json().catch(() => null) : null
    if (status?.name === 'agent-viewer') return { state: 'running', version: status.version, protocol: status.protocol }
    return { state: 'foreign' }
  } catch (error) {
    // A refused connection is a free port; a timeout is a listener that is not ours or not ready.
    const code = error?.cause?.code
    return { state: code === 'ECONNREFUSED' ? 'absent' : 'unresponsive' }
  }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

async function readRecord(port) {
  try { return JSON.parse(await readFile(daemonRecordPath(port), 'utf8')) } catch { return null }
}

function spawnWebDaemon(port) {
  const launcher = fileURLToPath(new URL('./agent-viewer.mjs', import.meta.url))
  // A built app starts in a fraction of the time and memory of the dev server.
  const built = existsSync(fileURLToPath(new URL('../.next/BUILD_ID', import.meta.url)))
  const log = openSync(daemonLogPath(port), 'a')
  // The daemon hosts the work itself; an attach target inherited from this
  // shell would make it a client of some other daemon.
  const env = { ...process.env }
  delete env.AGENT_VIEWER_ATTACH
  delete env.AGENT_VIEWER_DAEMON
  const child = spawn(process.execPath, [launcher, 'web', '--port', String(port), ...(built ? ['--production'] : [])], {
    detached: true,
    stdio: ['ignore', log, log],
    env,
  })
  child.unref()
  return child.pid
}

/**
 * Make sure a daemon answers on `port`, starting one if the port is free.
 * Returns its URL and whether this call started it.
 */
export async function ensureDaemon({ port = 3000, timeoutMs = DAEMON_START_TIMEOUT_MS, start = spawnWebDaemon, onWait } = {}) {
  const url = `http://127.0.0.1:${port}`
  const first = await probeDaemon(port)
  if (first.state === 'running') return { url, started: false, version: first.version }
  if (first.state === 'foreign') throw new Error(`Port ${port} is answering, but not as agent-viewer. Pass --port <n> to run the daemon elsewhere.`)
  const record = await readRecord(port)
  // A daemon still booting has a live record and no listener yet: wait for it
  // rather than starting a second one against the same port.
  const booting = first.state === 'absent' && record?.pid && processAlive(record.pid)
  if (first.state === 'unresponsive' && !booting && !(record?.pid && processAlive(record.pid))) {
    throw new Error(`Port ${port} is held by something that does not answer as agent-viewer. Pass --port <n> to run the daemon elsewhere.`)
  }
  let pid = record?.pid
  if (!booting && first.state === 'absent') {
    await mkdir(daemonStateDir(), { recursive: true, mode: 0o700 })
    pid = await start(port)
    await writeFile(daemonRecordPath(port), `${JSON.stringify({ pid, port, startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
  }
  onWait?.()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const probe = await probeDaemon(port)
    if (probe.state === 'running') return { url, started: !booting, version: probe.version }
    if (pid && !processAlive(pid)) throw new Error(`The daemon exited while starting. See ${daemonLogPath(port)}.`)
    if (Date.now() >= deadline) throw new Error(`The daemon did not answer on port ${port} within ${Math.round(timeoutMs / 1000)}s. See ${daemonLogPath(port)}.`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

export async function daemonStatus(port = 3000) {
  const [probe, record] = await Promise.all([probeDaemon(port), readRecord(port)])
  return {
    port,
    state: probe.state,
    version: probe.version,
    // Only a daemon this command started has a record; one run by hand is still attachable.
    pid: record?.pid && processAlive(record.pid) ? record.pid : undefined,
    managed: Boolean(record?.pid && processAlive(record.pid)),
    log: daemonLogPath(port),
  }
}

/** Stop a daemon this command started. One run by hand is not ours to kill. */
export async function stopDaemon(port = 3000, graceMs = 8_000) {
  const record = await readRecord(port)
  if (!record?.pid || !processAlive(record.pid)) {
    await rm(daemonRecordPath(port), { force: true })
    return { stopped: false, reason: (await probeDaemon(port)).state === 'running' ? 'not-managed' : 'not-running' }
  }
  // The daemon leads its own process group (detached), so the web server and
  // its sidecar go with it.
  const signal = (name) => { try { process.kill(-record.pid, name) } catch { try { process.kill(record.pid, name) } catch {} } }
  signal('SIGTERM')
  const deadline = Date.now() + graceMs
  while (processAlive(record.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  if (processAlive(record.pid)) signal('SIGKILL')
  await rm(daemonRecordPath(port), { force: true })
  return { stopped: true, pid: record.pid }
}

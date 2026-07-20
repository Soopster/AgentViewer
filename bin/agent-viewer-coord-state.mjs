import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function coordinatorStateRoot() {
  return path.resolve(process.env.AGENT_VIEWER_COORD_HOME || path.join(os.homedir(), '.agent-viewer', 'coordinator'))
}

export function workerRecordPath(identityFile) {
  const key = Buffer.from(path.resolve(identityFile)).toString('base64url')
  return path.join(coordinatorStateRoot(), 'workers', `${key}.worker.json`)
}

export function workerLogPath(identityFile) {
  const key = Buffer.from(path.resolve(identityFile)).toString('base64url')
  return path.join(coordinatorStateRoot(), 'workers', `${key}.worker.log`)
}

const workerRecordWrites = new Map()

async function writeWorkerRecordNow(identityFile, patch) {
  const file = workerRecordPath(identityFile)
  let current = {}
  try { current = JSON.parse(await readFile(file, 'utf8')) } catch { /* first write or corrupt stale record */ }
  const record = { ...current, ...patch, identityFile: path.resolve(identityFile), updatedAt: new Date().toISOString() }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
  return record
}

export async function writeWorkerRecord(identityFile, patch) {
  const file = workerRecordPath(identityFile)
  const previous = workerRecordWrites.get(file) ?? Promise.resolve()
  const pending = previous.catch(() => {}).then(() => writeWorkerRecordNow(identityFile, patch))
  workerRecordWrites.set(file, pending)
  try {
    return await pending
  } finally {
    if (workerRecordWrites.get(file) === pending) workerRecordWrites.delete(file)
  }
}

async function collectRecordFiles(directory, output) {
  let entries = []
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectRecordFiles(absolute, output)
    else if (entry.isFile() && entry.name.endsWith('.worker.json')) output.push(absolute)
  }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readProcessDetails(pid) {
  if (!processAlive(pid)) return { commandLine: '', startedAt: null }
  if (process.platform === 'win32') {
    const script = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress)`
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 2_000,
      windowsHide: true,
    })
    if (result.status !== 0) return { commandLine: '', startedAt: null }
    try {
      const details = JSON.parse(String(result.stdout || '{}'))
      return {
        commandLine: String(details.CommandLine || ''),
        startedAt: Number.isFinite(Date.parse(details.CreationDate)) ? Date.parse(details.CreationDate) : null,
      }
    } catch {
      return { commandLine: '', startedAt: null }
    }
  }
  const command = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 2_000 })
  const started = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 2_000 })
  return {
    commandLine: command.status === 0 ? String(command.stdout || '').trim() : '',
    startedAt: started.status === 0 && Number.isFinite(Date.parse(String(started.stdout || '').trim()))
      ? Date.parse(String(started.stdout || '').trim())
      : null,
  }
}

/**
 * A PID alone is not a worker identity: after a crash the OS can reuse it for
 * an unrelated process. Verify both the executable command and, when present,
 * the recorded process start time before reporting or signalling a worker.
 */
export function managedWorkerProcess(pid, record = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  const details = readProcessDetails(pid)
  const commandMatches = details.commandLine.includes('agent-viewer-coord-worker.mjs')
    || (details.commandLine.includes('agent-viewer.mjs') && details.commandLine.includes('coord') && details.commandLine.includes('worker'))
  if (!commandMatches) return false
  const recordedStartedAt = Date.parse(String(record.startedAt || ''))
  if (Number.isFinite(recordedStartedAt) && details.startedAt !== null) {
    // Process launch and record persistence are not atomic, but should be
    // within a minute even on a heavily loaded machine.
    if (Math.abs(details.startedAt - recordedStartedAt) > 60_000) return false
  }
  return true
}

function freshWorkerHeartbeat(pid, record) {
  if (!processAlive(pid)) return false
  const heartbeatAt = Date.parse(String(record.heartbeatAt || ''))
  return Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt >= 0 && Date.now() - heartbeatAt <= 20_000
}

export async function listWorkerRecords(root = coordinatorStateRoot()) {
  const files = []
  await collectRecordFiles(root, files)
  const records = []
  for (const file of files) {
    try {
      const record = JSON.parse(await readFile(file, 'utf8'))
      const pid = Number(record.pid)
      const heartbeatAlive = freshWorkerHeartbeat(pid, record)
      const processVerified = heartbeatAlive ? false : managedWorkerProcess(pid, record)
      const alive = heartbeatAlive || processVerified
      const stale = !alive && ['running', 'starting', 'retrying'].includes(record.status)
      records.push({
        ...record,
        recordFile: file,
        alive,
        stale,
        liveness: heartbeatAlive ? 'heartbeat' : processVerified ? 'process' : 'none',
      })
    } catch {
      records.push({ recordFile: file, status: 'corrupt', alive: false })
    }
  }
  return records.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
}

export async function resolveWorkerRecord(selector, root = coordinatorStateRoot()) {
  const records = await listWorkerRecords(root)
  const resolved = path.resolve(selector || '.')
  const exact = records.find((record) => record.identityFile && path.resolve(record.identityFile) === resolved)
  if (exact) return exact
  const matches = records.filter((record) => (
    record.agentId === selector
    || record.name === selector
    || record.runId === selector
    || String(record.identityFile ?? '').endsWith(`${path.sep}${selector}.json`)
  ))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error(`Worker selector is ambiguous: ${selector}`)
  throw new Error(`Coordinator worker not found: ${selector}`)
}

export async function inspectIdentity(file) {
  try {
    const [raw, metadata] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    const value = JSON.parse(raw)
    return {
      ok: Boolean(value.runId && value.agentId && value.token),
      mode: metadata.mode & 0o777,
      runId: value.runId,
      agentId: value.agentId,
      provider: value.provider,
      attach: value.attach,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

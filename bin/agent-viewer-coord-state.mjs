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

export async function writeWorkerRecord(identityFile, patch) {
  const file = workerRecordPath(identityFile)
  let current = {}
  try { current = JSON.parse(await readFile(file, 'utf8')) } catch { /* first write or corrupt stale record */ }
  const record = { ...current, ...patch, identityFile: path.resolve(identityFile), updatedAt: new Date().toISOString() }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
  return record
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

export async function listWorkerRecords(root = coordinatorStateRoot()) {
  const files = []
  await collectRecordFiles(root, files)
  const records = []
  for (const file of files) {
    try {
      const record = JSON.parse(await readFile(file, 'utf8'))
      records.push({ ...record, recordFile: file, alive: processAlive(Number(record.pid)) })
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

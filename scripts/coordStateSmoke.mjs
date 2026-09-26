import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const smokeRoot = mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-state-smoke-'))
const outsideLog = path.join(tmpdir(), `agent-viewer-coord-outside-${process.pid}.log`)
process.env.AGENT_VIEWER_COORD_HOME = smokeRoot
process.env.AGENT_VIEWER_COORD_WORKER_RETENTION_DAYS = '1'

const {
  listWorkerRecords,
  workerLogPath,
  workerRecordPath,
  writeWorkerRecord,
} = await import('../bin/agent-viewer-coord-state.mjs')

const identityFile = path.join(smokeRoot, 'identity.json')
// The marker argument makes this child look like the actual worker command to
// `ps`, while keeping the smoke hermetic and independent of a running daemon.
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', 'agent-viewer-coord-worker.mjs'], {
  stdio: 'ignore',
})
const processInspectionAvailable = process.platform === 'win32'
  || spawnSync('ps', ['-p', String(process.pid), '-o', 'command='], { encoding: 'utf8' }).status === 0

try {
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  await writeWorkerRecord(identityFile, {
    pid: child.pid,
    status: 'running',
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  })
  let [record] = await listWorkerRecords()
  if (processInspectionAvailable && (!record?.alive || record.stale)) {
    throw new Error(`Managed worker was not recognized: ${JSON.stringify(record)}`)
  }

  // Heartbeat and status updates happen concurrently in the real supervisor;
  // both patches must survive rather than racing through the same temp file.
  await Promise.all([
    writeWorkerRecord(identityFile, { smokeLeft: true }),
    writeWorkerRecord(identityFile, { smokeRight: true }),
  ])
  ;[record] = await listWorkerRecords()
  if (!record?.smokeLeft || !record?.smokeRight) {
    throw new Error(`Concurrent record patches were lost: ${JSON.stringify(record)}`)
  }

  // A matching command at the same PID is still not the same worker when the
  // recorded process start belongs to an old instance (PID reuse).
  await writeWorkerRecord(identityFile, {
    startedAt: '2000-01-01T00:00:00.000Z',
    heartbeatAt: '2000-01-01T00:00:00.000Z',
  })
  ;[record] = await listWorkerRecords()
  if (record?.alive || !record?.stale) {
    throw new Error(`Reused worker PID was not marked stale: ${JSON.stringify(record)}`)
  }

  // An unrelated live process must never satisfy a stale worker record, even
  // when a forged heartbeat is fresh.
  await writeWorkerRecord(identityFile, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  })
  ;[record] = await listWorkerRecords()
  if (record?.alive || !record?.stale || record?.liveness !== 'none') {
    throw new Error(`Unrelated live PID was reported as a worker: ${JSON.stringify(record)}`)
  }

  // Terminal records, identities, and bounded logs age out together.
  const expiredIdentity = path.join(smokeRoot, 'expired', 'worker.json')
  mkdirSync(path.dirname(expiredIdentity), { recursive: true })
  writeFileSync(expiredIdentity, '{}\n', { mode: 0o600 })
  await writeWorkerRecord(expiredIdentity, { status: 'stopped', pid: 0 })
  writeFileSync(workerLogPath(expiredIdentity), 'old log\n')
  const expiredRecordFile = workerRecordPath(expiredIdentity)
  const expiredRecord = JSON.parse(readFileSync(expiredRecordFile, 'utf8'))
  expiredRecord.updatedAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
  writeFileSync(expiredRecordFile, `${JSON.stringify(expiredRecord, null, 2)}\n`, { mode: 0o600 })
  await listWorkerRecords()
  if ([expiredRecordFile, expiredIdentity, workerLogPath(expiredIdentity)].some(existsSync)) {
    throw new Error('Expired terminal worker state was not pruned')
  }

  // A tampered record cannot turn retention into arbitrary-file deletion via
  // its persisted logFile field.
  writeFileSync(outsideLog, 'preserve me\n')
  const tamperedIdentity = path.join(smokeRoot, 'tampered.json')
  writeFileSync(tamperedIdentity, '{}\n', { mode: 0o600 })
  await writeWorkerRecord(tamperedIdentity, { status: 'stopped', pid: 0, logFile: outsideLog })
  const tamperedRecordFile = workerRecordPath(tamperedIdentity)
  const tamperedRecord = JSON.parse(readFileSync(tamperedRecordFile, 'utf8'))
  tamperedRecord.updatedAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
  writeFileSync(tamperedRecordFile, `${JSON.stringify(tamperedRecord, null, 2)}\n`, { mode: 0o600 })
  await listWorkerRecords()
  if (readFileSync(outsideLog, 'utf8') !== 'preserve me\n') {
    throw new Error('Worker retention deleted a log outside its state root')
  }

  console.log('Coordinator worker-state liveness and retention smoke passed')
} finally {
  child.kill('SIGTERM')
  rmSync(smokeRoot, { recursive: true, force: true })
  rmSync(outsideLog, { force: true })
}

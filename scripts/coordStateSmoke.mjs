import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const smokeRoot = mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-state-smoke-'))
process.env.AGENT_VIEWER_COORD_HOME = smokeRoot

const {
  listWorkerRecords,
  writeWorkerRecord,
} = await import('../bin/agent-viewer-coord-state.mjs')

const identityFile = path.join(smokeRoot, 'identity.json')
// The marker argument makes this child look like the actual worker command to
// `ps`, while keeping the smoke hermetic and independent of a running daemon.
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', 'agent-viewer-coord-worker.mjs'], {
  stdio: 'ignore',
})

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
  if (!record?.alive || record.stale) {
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

  // An unrelated live process must never satisfy a stale worker record.
  await writeWorkerRecord(identityFile, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: '2000-01-01T00:00:00.000Z',
  })
  ;[record] = await listWorkerRecords()
  if (record?.alive || !record?.stale) {
    throw new Error(`Unrelated live PID was reported as a worker: ${JSON.stringify(record)}`)
  }

  console.log('Coordinator worker-state liveness smoke passed')
} finally {
  child.kill('SIGTERM')
  rmSync(smokeRoot, { recursive: true, force: true })
}

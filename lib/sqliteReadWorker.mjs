// Read-only SQLite executor worker. Runs the heavy LIKE/FTS scans for session
// search off the main event loop (node:sqlite is synchronous, so on the main
// thread a ~300ms search blocks every other request). Deliberately a *dumb*
// executor: it runs whatever parameterized SELECT the main thread sends and
// returns the raw rows. All SQL building, row mapping, scoring, and snippeting
// stay in lib/sessionPersistence.ts — this file never duplicates query logic.
//
// Plain .mjs (not TS) so Node's worker_threads can load it directly from disk
// without a compile step, and so Next/Turbopack never bundles it (which would
// reintroduce the node:sqlite require-shim problem the eval trick works around).
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'

const DB_FILE = workerData?.dbFile
let db = null

function getDb() {
  if (db) return db
  // Open read-write-capable (default) rather than readOnly: a readOnly handle
  // to a WAL database can fail to create the -shm mapping. We only ever run
  // SELECTs here, and WAL supports multiple connections, so this is safe.
  db = new DatabaseSync(DB_FILE)
  db.exec('PRAGMA cache_size = -8192; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 0;')
  return db
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    const { id, sql, params } = msg ?? {}
    try {
      const rows = getDb().prepare(sql).all(...(params ?? []))
      parentPort.postMessage({ id, rows })
    } catch (err) {
      // Drop the connection so a transient/stale-handle error self-heals on the
      // next query; the main thread falls back to a synchronous read meanwhile.
      try { db?.close() } catch { /* ignore */ }
      db = null
      parentPort.postMessage({ id, error: err?.message ?? String(err) })
    }
  })
}

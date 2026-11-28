// Shared Node/Bun storage, also consumed by the dependency-free inspection CLI.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
export const INSPECTION_STALE_MS = 15_000
export function inspectionDir() {
  return process.env.AGENT_VIEWER_INSPECTION_DIR || path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `agent-viewer-${typeof process.getuid === 'function' ? process.getuid() : os.userInfo().username}`, 'inspection')
}
export function writeAppInspection(value) {
  if (!/^(web|tui)-[a-zA-Z0-9-]{1,100}$/.test(value?.app?.instanceId ?? '')) throw new Error('Invalid app instance id')
  const dir = inspectionDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${value.app.instanceId}.json`)
  if (Number.isSafeInteger(value.revision)) {
    try { const previous = JSON.parse(readFileSync(file, 'utf8')); if (previous.revision >= value.revision) return } catch { /* first publication */ }
  }
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, pid: process.pid, daemon: value.app.renderer === 'web' ? { pid: process.pid, port: process.env.PORT ?? null } : null, updatedAt: Date.now(), ...value }), { mode: 0o600 })
  renameSync(tmp, file)
}
export function readAppInspections(instanceId, now = Date.now()) {
  const dir = inspectionDir()
  let names
  try { names = readdirSync(dir) } catch { return [] }
  return names.filter(name => /^(web|tui)-[a-zA-Z0-9-]{1,100}\.json$/.test(name)).flatMap(name => {
    try {
      const file = path.join(dir, name)
      if (statSync(file).size > 2_000_000) return []
      const value = JSON.parse(readFileSync(file, 'utf8'))
      if (value.version !== 1 || !value.app?.instanceId || !Number.isFinite(value.updatedAt) || (instanceId && value.app.instanceId !== instanceId)) return []
      return [{ ...value, stale: now - value.updatedAt > INSPECTION_STALE_MS }]
    } catch { return [] }
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

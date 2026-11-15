import { mkdir, chmod, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isAgentProvider } from '../provider'
import { isPluginEnabled } from '../plugins/enablement'
import { projectMemoryContext, type ProjectMemoryService, type ProjectMemorySnapshot, type MemoryOperation } from '../plugins/projectMemory'
import type { PluginBeforeTurnContext } from '../plugins/behavior'
type DB = { exec(sql: string): void; prepare(sql: string): { get(...args: (string | number)[]): unknown; run(...args: (string | number)[]): unknown } }
const short = z.string().min(1).max(512), key = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
const version = z.number().int().min(0)
const source = z.strictObject({ provider: z.string().refine(isAgentProvider), providerInstanceId: short.optional(), sessionId: short, messageUuid: short.optional() })
const operationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('save'), note: z.strictObject({ id: key, expectedVersion: version, title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000), kind: z.enum(['decision', 'convention', 'lesson']), pinned: z.boolean(), source: source.optional() }) }),
  z.strictObject({ type: z.literal('review'), id: key, expectedVersion: version, reviewed: z.boolean() }),
  z.strictObject({ type: z.literal('delete'), id: key, expectedVersion: version }),
  z.strictObject({ type: z.literal('settings'), autoRecall: z.boolean(), expectedSequence: version }),
])
const defaultDirectory = () => process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR || path.join(homedir(), '.agent-viewer', 'project-memory')
export function createProjectMemory(directory: () => string = defaultDirectory): ProjectMemoryService & { file(cwd: string): Promise<string> } {
  const databases = new Map<string, Promise<DB>>()
  const file = async (cwd: string) => path.join(directory(), `${createHash('sha256').update(await realpath(cwd)).digest('hex')}.sqlite`)
  const database = async (cwd: string) => {
    const location = await file(cwd)
    let pending = databases.get(location)
    if (!pending) {
      pending = (async () => {
        await mkdir(path.dirname(location), { recursive: true, mode: 0o700 })
        const db: DB = process.versions.bun ? new (await (0, eval)('import("bun:sqlite")')).Database(location, { create: true }) : new (await (0, eval)('import("node:sqlite")')).DatabaseSync(location)
        await chmod(location, 0o600)
        db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS memory(id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS note_versions(id TEXT PRIMARY KEY, version INTEGER NOT NULL)')
        return db
      })()
      databases.set(location, pending); pending.catch(() => databases.delete(location))
    }
    return pending
  }
  const read = (db: DB): ProjectMemorySnapshot => { const row = db.prepare('SELECT snapshot FROM memory WHERE id=1').get() as { snapshot: string } | undefined; return row ? JSON.parse(row.snapshot) : { sequence: 0, autoRecall: false, notes: [] } }
  return {
    file,
    async read(cwd, signal) { signal?.throwIfAborted(); const result = read(await database(cwd)); signal?.throwIfAborted(); return result },
    async mutate(cwd, requestId, raw, signal) {
      if (!isPluginEnabled('project-memory')) throw new Error('Project Memory is disabled')
      key.parse(requestId); const operation = operationSchema.parse(raw) as MemoryOperation, db = await database(cwd)
      signal?.throwIfAborted(); db.exec('BEGIN IMMEDIATE')
      try {
        const snapshot = read(db)
        if (!db.prepare('SELECT id FROM receipts WHERE id=?').get(requestId)) {
          if (operation.type === 'settings') {
            if (snapshot.sequence !== operation.expectedSequence) throw new Error('Memory settings changed. Refresh first.')
            snapshot.autoRecall = operation.autoRecall
          } else {
            const id = operation.type === 'save' ? operation.note.id : operation.id, existing = snapshot.notes.find(note => note.id === id), expected = operation.type === 'save' ? operation.note.expectedVersion : operation.expectedVersion
            const saved = db.prepare('SELECT version FROM note_versions WHERE id=?').get(id) as { version: number } | undefined
            if ((!existing && saved) || (saved?.version ?? existing?.version ?? 0) !== expected) throw new Error('Memory note changed. Refresh before editing.')
            if (operation.type === 'save') {
              if (!existing && snapshot.notes.length >= 500) throw new Error('Project memory is limited to 500 notes')
              const now = Date.now(), { expectedVersion: _expected, ...note } = operation.note
              snapshot.notes = [{ ...note, version: expected + 1, reviewed: false, createdAt: existing?.createdAt ?? now, updatedAt: now }, ...snapshot.notes.filter(item => item.id !== id)]
            } else if (!existing) throw new Error('Memory note not found')
            else if (operation.type === 'delete') snapshot.notes = snapshot.notes.filter(note => note.id !== id)
            else { existing.reviewed = operation.reviewed; existing.version++; existing.updatedAt = Date.now() }
            db.prepare('INSERT INTO note_versions(id,version) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(id, expected + 1)
          }
          snapshot.sequence++
          db.prepare('INSERT INTO memory(id,snapshot) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot').run(JSON.stringify(snapshot))
          db.prepare('INSERT INTO receipts(id) VALUES (?)').run(requestId)
        }
        db.exec('COMMIT'); return snapshot
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
}
export const nativeProjectMemory = createProjectMemory()
/** Lazy, opt-in context retrieval on the ordinary shared send path. */
export async function recallProjectMemory(context: PluginBeforeTurnContext): Promise<string | null> {
  const message = context.body.message
  if (typeof message !== 'string' || !message.trim() || message.trimStart().startsWith('/') || message.includes('<agent_viewer_project_memory>')) return null
  try { await stat(defaultDirectory()) } catch { return null }
  let cwd = typeof context.body.cwd === 'string' ? context.body.cwd : undefined
  if (!cwd) {
    const [{ withProviderInstance }, { readViewSessionInfo }] = await Promise.all([import('../providerInstances'), import('../sessionReads')])
    const target = context.target
    try { cwd = (await withProviderInstance(target.providerInstanceId ?? target.provider, target.provider, () => readViewSessionInfo(target.sessionId, target.provider)))?.cwd } catch { return null }
  }
  context.signal.throwIfAborted()
  if (!cwd) return null
  try { await stat(await nativeProjectMemory.file(cwd)) } catch { return null }
  const recalled = projectMemoryContext(await nativeProjectMemory.read(cwd, context.signal), message)
  return recalled ? `${message}\n\n<agent_viewer_project_memory>\n${recalled}\n</agent_viewer_project_memory>` : null
}

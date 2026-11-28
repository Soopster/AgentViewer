import { mkdir, chmod, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isAgentProvider } from '../provider'
import { isPluginEnabled } from '../plugins/enablement'
import { isAgentNote, memoryTitleKey, projectMemoryRecall, type ProjectMemoryService, type ProjectMemorySnapshot, type MemoryOperation } from '../plugins/projectMemory'
import { findRepoRoot } from '../worktreeTasks'
import type { PluginBeforeTurnContext } from '../plugins/behavior'
type DB = { exec(sql: string): void; prepare(sql: string): { get(...args: (string | number)[]): unknown; run(...args: (string | number)[]): unknown } }
const short = z.string().min(1).max(512), key = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
const version = z.number().int().min(0)
const source = z.strictObject({ provider: z.string().refine(isAgentProvider), providerInstanceId: short.optional(), sessionId: short, messageUuid: short.optional() })
const operationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('save'), note: z.strictObject({ id: key, expectedVersion: version, title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000), kind: z.enum(['decision', 'convention', 'lesson']), pinned: z.boolean(), source: source.optional() }) }),
  z.strictObject({ type: z.literal('review'), id: key, expectedVersion: version, reviewed: z.boolean() }),
  z.strictObject({ type: z.literal('delete'), id: key, expectedVersion: version }),
  z.strictObject({ type: z.literal('settings'), autoRecall: z.boolean().optional(), agentMemory: z.boolean().optional(), expectedSequence: version }),
  z.strictObject({ type: z.literal('agent-remember'), title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4_000), kind: z.enum(['decision', 'convention', 'lesson']), source: source.optional() }),
  z.strictObject({ type: z.literal('agent-forget'), title: z.string().trim().min(1).max(200) }),
])
/** Agent notes are capped below the store's own limit, so agents cannot crowd out what people write. */
export const AGENT_NOTE_LIMIT = 200
const NOTE_LIMIT = 500
const EMPTY: ProjectMemorySnapshot = Object.freeze({ sequence: 0, autoRecall: false, notes: [] }) as ProjectMemorySnapshot
const defaultDirectory = () => process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR || path.join(homedir(), '.agent-viewer', 'project-memory')
export type NativeProjectMemory = ProjectMemoryService & {
  file(cwd: string): Promise<string>
  /** The stored snapshot, or the empty default when the project has none. Never creates a store. */
  peek(cwd: string, signal?: AbortSignal): Promise<ProjectMemorySnapshot>
}
const exists = (file: string) => stat(file).then(() => true, () => false)
export function createProjectMemory(directory: () => string = defaultDirectory): NativeProjectMemory {
  const databases = new Map<string, Promise<DB>>()
  const roots = new Map<string, string>()
  const hashed = (key: string) => path.join(directory(), `${createHash('sha256').update(key).digest('hex')}.sqlite`)
  // One memory per repository: worktrees and subdirectories share it. A store kept under the exact directory
  // (how stores were keyed before) is still used when the repository has none of its own.
  const file = async (cwd: string) => {
    const real = await realpath(cwd)
    let root = roots.get(real)
    if (!root) { root = (await findRepoRoot(real)) ?? real; if (roots.size > 500) roots.clear(); roots.set(real, root) }
    const primary = hashed(root)
    if (root === real || databases.has(primary) || await exists(primary)) return primary
    const legacy = hashed(real)
    return databases.has(legacy) || await exists(legacy) ? legacy : primary
  }
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
  const read = (db: DB): ProjectMemorySnapshot => { const row = db.prepare('SELECT snapshot FROM memory WHERE id=1').get() as { snapshot: string } | undefined; return row ? JSON.parse(row.snapshot) : structuredClone(EMPTY) }
  return {
    file,
    async peek(cwd, signal) {
      const location = await file(cwd); signal?.throwIfAborted()
      if (!databases.has(location) && !await exists(location)) return structuredClone(EMPTY)
      return read(await database(cwd))
    },
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
            if (operation.autoRecall !== undefined) snapshot.autoRecall = operation.autoRecall
            if (operation.agentMemory !== undefined) snapshot.agentMemory = operation.agentMemory
          } else if (operation.type === 'agent-remember') {
            const wanted = memoryTitleKey(operation.title), now = Date.now()
            const existing = snapshot.notes.find(note => isAgentNote(note) && memoryTitleKey(note.title) === wanted)
            if (existing) {
              Object.assign(existing, { title: operation.title, body: operation.body, kind: operation.kind, version: existing.version + 1, updatedAt: now }, operation.source ? { source: operation.source } : {})
              snapshot.notes = [existing, ...snapshot.notes.filter(note => note !== existing)]
              db.prepare('INSERT INTO note_versions(id,version) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(existing.id, existing.version)
            } else {
              if (snapshot.notes.filter(isAgentNote).length >= AGENT_NOTE_LIMIT) throw new Error(`This project already holds ${AGENT_NOTE_LIMIT} agent memories. Forget outdated ones or fold several into one before adding another.`)
              if (snapshot.notes.length >= NOTE_LIMIT) throw new Error(`Project memory is limited to ${NOTE_LIMIT} notes`)
              const id = crypto.randomUUID()
              snapshot.notes = [{ id, version: 1, title: operation.title, body: operation.body, kind: operation.kind, pinned: false, reviewed: false, author: 'agent', ...(operation.source ? { source: operation.source } : {}), createdAt: now, updatedAt: now }, ...snapshot.notes]
              db.prepare('INSERT INTO note_versions(id,version) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(id, 1)
            }
          } else if (operation.type === 'agent-forget') {
            const wanted = memoryTitleKey(operation.title), matching = snapshot.notes.filter(note => memoryTitleKey(note.title) === wanted)
            const target = matching.find(isAgentNote)
            if (!target) throw new Error(matching.length ? `"${operation.title}" was written by a person; agents can only forget their own memories` : `No agent memory titled "${operation.title}"`)
            snapshot.notes = snapshot.notes.filter(note => note !== target)
            db.prepare('INSERT INTO note_versions(id,version) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(target.id, target.version + 1)
          } else {
            const id = operation.type === 'save' ? operation.note.id : operation.id, existing = snapshot.notes.find(note => note.id === id), expected = operation.type === 'save' ? operation.note.expectedVersion : operation.expectedVersion
            const saved = db.prepare('SELECT version FROM note_versions WHERE id=?').get(id) as { version: number } | undefined
            if ((!existing && saved) || (saved?.version ?? existing?.version ?? 0) !== expected) throw new Error('Memory note changed. Refresh before editing.')
            if (operation.type === 'save') {
              if (!existing && snapshot.notes.length >= NOTE_LIMIT) throw new Error(`Project memory is limited to ${NOTE_LIMIT} notes`)
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

type TurnTarget = PluginBeforeTurnContext['target']
const sessionKey = (target: TurnTarget) => `${target.provider}\u0000${target.providerInstanceId ?? ''}\u0000${target.sessionId}`
/** Per session in this process: which notes it has been shown (`id@version`) and its working directory. */
const sessions = new Map<string, { seen: Set<string>; cwd?: string }>()
const SESSION_LIMIT = 500
function sessionState(target: TurnTarget): { state: { seen: Set<string>; cwd?: string }; first: boolean } {
  const key = sessionKey(target), existing = sessions.get(key)
  if (existing) { sessions.delete(key); sessions.set(key, existing); return { state: existing, first: false } }
  const state = { seen: new Set<string>() }
  sessions.set(key, state)
  if (sessions.size > SESSION_LIMIT) sessions.delete(sessions.keys().next().value!)
  return { state, first: true }
}
/** Forget what sessions were shown (tests, and a plugin reload). */
export function resetProjectMemorySessions(): void { sessions.clear() }

/** The session's working directory: the turn's own, else the one its provider recorded. */
export async function resolveTurnCwd(target: TurnTarget, bodyCwd?: unknown): Promise<string | undefined> {
  if (typeof bodyCwd === 'string' && bodyCwd) return bodyCwd
  const known = sessions.get(sessionKey(target))?.cwd
  if (known) return known
  const [{ withProviderInstance }, { readViewSessionInfo }] = await Promise.all([import('../providerInstances'), import('../sessionReads')])
  try { return (await withProviderInstance(target.providerInstanceId ?? target.provider, target.provider, () => readViewSessionInfo(target.sessionId, target.provider)))?.cwd ?? undefined } catch { return undefined }
}

/**
 * Context for a turn on the ordinary shared send path. A session's first turn gets the memory protocol and an index
 * of what is remembered; every turn gets the bodies of relevant notes it has not already been shown, and nothing when
 * there are none, so memory does not pile up in a long conversation.
 */
export async function recallProjectMemory(context: PluginBeforeTurnContext, service: NativeProjectMemory = nativeProjectMemory): Promise<string | null> {
  const message = context.body.message
  if (typeof message !== 'string' || !message.trim() || message.trimStart().startsWith('/') || message.includes('<agent_viewer_project_memory>')) return null
  const cwd = await resolveTurnCwd(context.target, context.body.cwd)
  context.signal.throwIfAborted()
  if (!cwd) return null
  let snapshot: ProjectMemorySnapshot
  try { snapshot = await service.peek(cwd, context.signal) } catch (error) { if (context.signal.aborted) throw error; return null }
  const { state, first } = sessionState(context.target)
  state.cwd = cwd
  const recalled = projectMemoryRecall(snapshot, message, { first: first || context.body.isPendingSession === true, seen: state.seen })
  for (const key of recalled.keys) state.seen.add(key)
  return recalled.text ? `${message}\n\n<agent_viewer_project_memory>\n${recalled.text}\n</agent_viewer_project_memory>` : null
}

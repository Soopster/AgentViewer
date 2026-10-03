import { chmod, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { anchorNote, reconcileNote, reviewDocument, reviewDigest } from './document'
import { emptyReview, reviewRangeKey, type ReviewRequest, type ReviewSnapshot, type ReviewNote, type ReviewTarget } from './types'
import { reviewRequestSchema, reviewSourceSchema } from './schema'
import { readTuiDiffReviewState, tuiDiffReviewStorageKey } from '../tuiDiffReviewState'

type Database = { exec(sql: string): void; prepare(sql: string): { get(...args: (string | number)[]): unknown; all(...args: (string | number)[]): unknown[]; run(...args: (string | number)[]): unknown } }
const databases = new Map<string, Promise<Database>>()

/** Keep every process and surface in the same repository-scoped transactional store. */
async function database(cwd: string): Promise<Database> {
  const canonical = await realpath(cwd)
  let pending = databases.get(canonical)
  if (!pending) {
    pending = (async () => {
      const directory = process.env.AGENT_VIEWER_REVIEW_DIR || path.join(homedir(), '.agent-viewer', 'reviews')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const file = path.join(directory, `${reviewDigest(canonical)}.sqlite`)
      // Same bundler-safe runtime selection as sessionPersistence.ts.
      const db: Database = process.versions.bun
        ? new (await (0, eval)('import("bun:sqlite")')).Database(file, { create: true })
        : new (await (0, eval)('import("node:sqlite")')).DatabaseSync(file)
      await chmod(file, 0o600)
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reviews (source TEXT PRIMARY KEY, snapshot TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0)')
      const columns = db.prepare('PRAGMA table_info(reviews)').all() as { name: string }[]
      if (!columns.some(column => column.name === 'sequence')) db.exec('ALTER TABLE reviews ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0')
      return db
    })()
    databases.set(canonical, pending)
    pending.catch(() => databases.delete(canonical))
  }
  return pending
}

function read(db: Database, source: string): ReviewSnapshot {
  const row = db.prepare('SELECT snapshot FROM reviews WHERE source=?').get(source) as { snapshot: string } | undefined
  return row ? JSON.parse(row.snapshot) : emptyReview(source)
}

export async function readReview(cwd: string, source: string): Promise<ReviewSnapshot> {
  return read(await database(cwd), reviewSourceSchema.parse(source))
}

/** Idle polling reads one integer, without decoding or transporting a large diff. */
export async function readReviewIfChanged(cwd: string, source: string, after?: number): Promise<ReviewSnapshot | null> {
  reviewSourceSchema.parse(source)
  const db = await database(cwd)
  const row = db.prepare('SELECT sequence FROM reviews WHERE source=?').get(source) as { sequence: number } | undefined
  if (after !== undefined && row?.sequence === after) return null
  return read(db, source)
}

export async function listReviews(cwd: string) {
  const rows = (await database(cwd)).prepare('SELECT snapshot FROM reviews').all() as { snapshot: string }[]
  return rows.map(row => JSON.parse(row.snapshot) as ReviewSnapshot).map(state => ({
    source: state.source, revision: state.document.revision,
    files: state.document.files, notes: state.notes.length,
    views: state.views.filter(view => Date.now() - view.seenAt < 15000),
  }))
}

/** Apply one idempotent operation under a SQLite write transaction; never replace another client's snapshot. */
export async function mutateReview(input: ReviewRequest): Promise<ReviewSnapshot> {
  const request = reviewRequestSchema.parse(input)
  const db = await database(request.cwd)
  db.exec('BEGIN IMMEDIATE')
  try {
    const state = read(db, request.source)
    if (state.receipts.includes(request.requestId)) { db.exec('COMMIT'); return state }
    const now = Date.now()
    if (request.publish) {
      const { patch, viewId, surface, close } = request.publish
      if (patch !== undefined) {
        const document = reviewDocument(patch)
        if (document.revision !== state.document.revision) {
          state.document = document
          state.notes = state.notes.map(note => reconcileNote(document, note))
          state.decisions = state.decisions.filter(decision => document.hunks.some(hunk => hunk.id === decision.hunkId))
        }
        if (!state.migrated) {
          const legacy = readTuiDiffReviewState(tuiDiffReviewStorageKey(request.cwd, request.source))
          for (const note of legacy.notes) {
            const migrated: ReviewNote = { ...note, id: randomUUID(), author: 'user', replies: [], resolved: false,
              createdAt: now, updatedAt: now, version: 1, resolution: 'stale' }
            // Legacy line-only notes cannot prove which revision the author saw.
            state.notes.push(reconcileNote(document, migrated))
          }
          state.migrated = true
        }
      }
      const previous = state.views.find(view => view.id === viewId)
      state.views = state.views.filter(view => view.id !== viewId && now - view.seenAt < 60000)
      if (!close) state.views.push({ ...previous, id: viewId, surface, seenAt: now, revision: patch === undefined ? previous?.revision ?? '' : state.document.revision })
    }
    const operation = request.operation
    if (operation) {
      if ('revision' in operation && operation.revision !== state.document.revision) throw new Error('Review changed. Read the current review and retry.')
      if (operation.type === 'note') {
        const previous = operation.id ? state.notes.find(note => note.id === operation.id) : undefined
        if (operation.id && !previous) throw new Error('Note no longer exists')
        if (previous && previous.version !== operation.expectedVersion) throw new Error('Note changed. Read its current version before editing.')
        if (previous && previous.author !== operation.author) throw new Error('Reply to another author instead of editing their note')
        if (!previous && state.notes.some(note => note.resolution === 'active' && reviewRangeKey(note.filePath, note.range) === reviewRangeKey(operation.filePath, operation.range))) throw new Error('A thread exists at that range. Reply to it instead.')
        if (!previous && state.notes.length >= 1000) throw new Error('Review note limit reached')
        const note = anchorNote(state.document, {
          ...operation, id: previous?.id ?? randomUUID(), replies: previous?.replies ?? [], resolved: previous?.resolved ?? false,
          createdAt: previous?.createdAt ?? now, updatedAt: now, version: (previous?.version ?? 0) + 1, resolution: 'active',
        })
        state.notes = [...state.notes.filter(item => item.id !== note.id), note]
      } else if (operation.type === 'reply' || operation.type === 'resolve' || operation.type === 'delete') {
        const note = state.notes.find(item => item.id === operation.noteId)
        if (!note) throw new Error('Note no longer exists')
        if ('expectedVersion' in operation && note.version !== operation.expectedVersion) throw new Error('Note changed. Read its current version before editing.')
        if (operation.type === 'delete') state.notes = state.notes.filter(item => item !== note)
        else {
          if (operation.type === 'reply') {
            if (note.replies.length >= 200) throw new Error('Reply limit reached')
            note.replies.push({ id: request.requestId, text: operation.text, author: operation.author, createdAt: now })
          } else note.resolved = operation.resolved
          note.updatedAt = now; note.version++
        }
      } else if (operation.type === 'decision') {
        if (!state.document.hunks.some(hunk => hunk.id === operation.hunkId)) throw new Error('Hunk no longer exists')
        state.decisions = state.decisions.filter(item => item.hunkId !== operation.hunkId)
        if (operation.status !== 'unreviewed') state.decisions.push({ hunkId: operation.hunkId, status: operation.status, rationale: operation.rationale ?? '', updatedAt: now })
      } else if (operation.type === 'navigate') {
        const view = state.views.find(item => item.id === operation.viewId && now - item.seenAt < 15000)
        if (!view || view.revision !== state.document.revision) throw new Error('Target view is closed or showing an older diff')
        const note = operation.target.noteId ? state.notes.find(item => item.id === operation.target.noteId) : undefined
        if (operation.target.noteId && (!note || note.resolution !== 'active')) throw new Error('Note has no verified current code anchor')
        const target: ReviewTarget = note ? { filePath: note.filePath, range: note.range, noteId: note.id } : operation.target
        if (!state.document.files.includes(target.filePath)) throw new Error('File is not in the current review')
        if (target.hunkId && !state.document.hunks.some(hunk => hunk.id === target.hunkId && hunk.filePath === target.filePath)) throw new Error('Hunk no longer exists')
        view.navigation = { id: request.requestId, target, requestedAt: now }
      } else {
        const navigation = state.views.find(view => view.id === operation.viewId)?.navigation
        if (navigation?.id === operation.navigationId) navigation.appliedAt = now
      }
    }
    state.sequence++
    state.receipts = [...state.receipts.slice(-1999), request.requestId]
    db.prepare('INSERT INTO reviews(source,snapshot,sequence) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET snapshot=excluded.snapshot,sequence=excluded.sequence').run(request.source, JSON.stringify(state), state.sequence)
    db.exec('COMMIT')
    return state
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

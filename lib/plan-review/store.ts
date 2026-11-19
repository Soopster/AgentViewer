import { mkdir, realpath, chmod } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { latestPlan, restorePlanAnchor, type PlanReview, type PlanSource } from '../plugins/planReview'
type DB = { exec(sql: string): void; prepare(sql: string): { get(...args: (string | number)[]): unknown; all(...args: (string | number)[]): unknown[]; run(...args: (string | number)[]): unknown } }
const connections = new Map<string, Promise<DB>>()
export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
async function database(cwd: string): Promise<DB> {
  const canonical = await realpath(cwd)
  const root = process.env.AGENT_VIEWER_PLAN_REVIEW_DIR || path.join(homedir(), '.agent-viewer', 'plan-reviews')
  const key = path.join(root, `${digest(canonical)}.sqlite`)
  let pending = connections.get(key)
  if (!pending) {
    pending = (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 })
      const db: DB = process.versions.bun
        ? new (await (0, eval)('import("bun:sqlite")')).Database(key, { create: true })
        : new (await (0, eval)('import("node:sqlite")')).DatabaseSync(key)
      await chmod(key, 0o600)
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, review_id TEXT NOT NULL)')
      return db
    })()
    connections.set(key, pending)
    pending.catch(() => connections.delete(key))
  }
  return pending
}
function get(db: DB, id: string): PlanReview {
  const row = db.prepare('SELECT snapshot FROM plans WHERE id=?').get(id) as { snapshot: string } | undefined
  if (!row) throw new Error('Plan review not found')
  return JSON.parse(row.snapshot)
}
function put(db: DB, review: PlanReview) {
  db.prepare('INSERT INTO plans(id,snapshot) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot').run(review.id, JSON.stringify(review))
}
export async function readPlans(cwd: string): Promise<PlanReview[]> {
  const db = await database(cwd)
  return (db.prepare('SELECT snapshot FROM plans ORDER BY rowid DESC').all() as { snapshot: string }[]).map(row => JSON.parse(row.snapshot) as PlanReview)
}
export async function readPlan(cwd: string, id: string): Promise<PlanReview> { return get(await database(cwd), id) }
export function planSourceKey(source: PlanSource) {
  const target = [source.target.provider, source.target.providerInstanceId ?? source.target.provider, source.target.sessionId]
  return JSON.stringify(source.kind === 'file' ? ['file', source.path, ...target] : [...target, ...(source.automatic || source.kind === 'native' ? ['plan'] : ['message', source.messageId])])
}
export async function publishPlan(cwd: string, source: PlanSource, text: string): Promise<PlanReview> {
  if (!text.trim() || text.length > 500_000) throw new Error('Plan must contain between 1 and 500,000 characters')
  const db = await database(cwd), id = digest(planSourceKey(source))
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare('SELECT snapshot FROM plans WHERE id=?').get(id) as { snapshot: string } | undefined
    const review: PlanReview = row ? JSON.parse(row.snapshot) : { id, title: '', sequence: 0, revisions: [], annotations: [], decisions: [], drafts: {}, deliveries: [] }
    const previous = review.revisions.at(-1)
    if (previous?.text !== text || previous.source.permissionToken !== source.permissionToken) {
      const hash = digest(`${review.revisions.length}\n${text}\n${source.permissionToken ?? ''}`)
      review.revisions.push({ hash, text, source, createdAt: Date.now() })
      if (previous) review.annotations.push(...review.annotations.filter(note => note.revision === previous.hash).map(note => ({ ...note, id: digest(`${hash}:${note.id}`), revision: hash, ...(note.anchor ? { anchor: restorePlanAnchor(note.anchor, text) } : {}) })))
      review.title = text.match(/^#\s+(.+)$/m)?.[1] ?? text.split('\n').find(line => line.trim())?.slice(0, 100) ?? 'Plan'
      review.sequence++
      put(db, review)
    }
    db.exec('COMMIT'); return review
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
/** Optimistic, transactional, idempotent mutation shared by both renderer processes. */
export async function changePlan(cwd: string, id: string, revision: string | undefined, sequence: number | undefined, requestId: string, change: (review: PlanReview) => void): Promise<PlanReview> {
  const db = await database(cwd)
  db.exec('BEGIN IMMEDIATE')
  try {
    const receipt = db.prepare('SELECT review_id FROM receipts WHERE id=?').get(requestId) as { review_id: string } | undefined
    if (receipt && receipt.review_id !== id) throw new Error('Request ID belongs to another review')
    const review = get(db, id)
    if (!receipt) {
      if ((revision !== undefined && latestPlan(review).hash !== revision) || (sequence !== undefined && review.sequence !== sequence)) throw new Error('Review changed. Refresh before retrying.')
      change(review); review.sequence++
      put(db, review)
      db.prepare('INSERT INTO receipts(id,review_id) VALUES (?,?)').run(requestId, id)
    }
    db.exec('COMMIT'); return review
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

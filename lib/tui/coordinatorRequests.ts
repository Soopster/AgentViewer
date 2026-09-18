import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { TuiSessionCoordinationRequest } from './service'
import { getAttachBaseUrl } from './remote'

// Journal only unresolved submissions, without provider bindings or transcripts.
// Immutable files let separate TUI clients settle their own requests without
// overwriting or deleting another client's pending work.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'coordinator-requests-v1')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function coordinatorRequestScope(provider: string, sessionId: string): string {
  return JSON.stringify([getAttachBaseUrl() ?? `local:${process.cwd()}`, provider, sessionId])
}
const directory = (scope: string) => path.join(DATA_DIR, hash(scope))
const filename = (scope: string, requestId: string) => path.join(directory(scope), `${hash(requestId)}.json`)
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

type RecordEntry = { version: 1; scope: string; createdAt: number; request: TuiSessionCoordinationRequest }
const ACTIONS = new Set(['disable', 'enable', 'settings', 'reconcile', 'resume-agent', 'interrupt-agent', 'delegate', 'message', 'review-plan', 'decision'])
function readEntry(file: string, scope: string): RecordEntry {
  const entry = JSON.parse(readFileSync(file, 'utf8')) as RecordEntry
  if (entry?.version !== 1 || entry.scope !== scope || !Number.isFinite(entry.createdAt)
    || !entry.request || !ACTIONS.has(entry.request.action) || typeof entry.request.detail !== 'string'
    || typeof entry.request.requestId !== 'string' || !entry.request.requestId
    || (entry.request.teammateProvider !== undefined && typeof entry.request.teammateProvider !== 'string')
    || filename(scope, entry.request.requestId) !== file) {
    throw new Error('Unconfirmed Coordinator request journal is invalid; inspect it before sending more work')
  }
  return entry
}

export function readPendingCoordinatorRequest(scope: string): TuiSessionCoordinationRequest | null {
  let files: string[]
  try { files = readdirSync(directory(scope)) } catch (error) { if (isMissing(error)) return null; throw error }
  const entries: RecordEntry[] = []
  for (const file of files.filter(file => file.endsWith('.json'))) {
    try { entries.push(readEntry(path.join(directory(scope), file), scope)) }
    catch (error) { if (!isMissing(error)) throw error }
  }
  entries.sort((a, b) => a.createdAt - b.createdAt || a.request.requestId.localeCompare(b.request.requestId))
  return entries[0]?.request ?? null
}

export class PendingCoordinatorRequestError extends Error {
  constructor(readonly request: TuiSessionCoordinationRequest) {
    super('A previous submission is unconfirmed. Inspect the task history, then retry the same request.')
  }
}

/** Complete durable write before any provider/API submission may begin. */
export function reserveCoordinatorRequest(scope: string, request: TuiSessionCoordinationRequest): void {
  const pending = readPendingCoordinatorRequest(scope)
  if (pending && JSON.stringify(pending) !== JSON.stringify(request)) throw new PendingCoordinatorRequestError(pending)
  if (pending) return
  mkdirSync(directory(scope), { recursive: true, mode: 0o700 })
  const file = filename(scope, request.requestId)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, scope, createdAt: Date.now(), request } satisfies RecordEntry))
      fsyncSync(fd)
    } finally { closeSync(fd) }
    // Publish a complete file without replacing another client's reservation.
    try { linkSync(temporary, file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = readEntry(file, scope).request
      if (JSON.stringify(existing) !== JSON.stringify(request)) throw new PendingCoordinatorRequestError(existing)
    }
  } finally { try { unlinkSync(temporary) } catch (error) { if (!isMissing(error)) throw error } }
}

/** Clear only this exact request after confirmation or explicit inspection. */
export function clearCoordinatorRequest(scope: string, requestId: string): void {
  try { unlinkSync(filename(scope, requestId)) } catch (error) { if (!isMissing(error)) throw error }
}

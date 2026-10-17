import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Which teammate results the user has reviewed, per conversation — herdr's
// "done" vs "idle": a finished agent stays flagged until someone looks.
// Presentation only; it never acknowledges model mail. Kept on disk because an
// in-memory list re-flagged every result in every team after a TUI restart.
// The web keeps the same markers in localStorage.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'coordinator-reviewed-v1')
const LIMIT = 500
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const fileFor = (scope: string) => path.join(DATA_DIR, `${createHash('sha256').update(scope).digest('hex')}.json`)

type StoredMarkers = { state: 'missing' } | { state: 'unreadable' } | { state: 'ok'; reviewed: string[] }

function readStored(scope: string): StoredMarkers {
  let text: string
  try { text = readFileSync(fileFor(scope), 'utf8') } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' }
  }
  try {
    const parsed = JSON.parse(text) as { scope?: string; reviewed?: unknown }
    if (parsed.scope !== scope || !Array.isArray(parsed.reviewed)) return { state: 'unreadable' }
    return { state: 'ok', reviewed: parsed.reviewed.filter((entry): entry is string => typeof entry === 'string').slice(-LIMIT) }
  } catch {
    return { state: 'unreadable' }
  }
}

export function readCoordinatorReviewed(scope: string): string[] {
  // Unreadable markers only re-show results; they never block work.
  const stored = readStored(scope)
  return stored.state === 'ok' ? stored.reviewed : []
}

/**
 * Merge rather than overwrite: two TUI clients on the same conversation must
 * not erase each other's markers. Temp-and-rename, so a torn write cannot
 * leave unparseable JSON that reads back as "nothing reviewed".
 */
export function writeCoordinatorReviewed(scope: string, reviewed: readonly string[]): string[] {
  const stored = readStored(scope)
  const merged = [...new Set([...(stored.state === 'ok' ? stored.reviewed : []), ...reviewed])].slice(-LIMIT)
  const file = fileFor(scope)
  // Herdr #4125: state that cannot be loaded is preserved before anything
  // replaces it, and left untouched if it cannot be preserved. Reading it as
  // empty and writing over it would destroy the one copy worth recovering.
  if (stored.state === 'unreadable') {
    try {
      mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 })
      copyFileSync(file, path.join(BACKUP_DIR, `${path.basename(file, '.json')}.${Date.now()}.json`))
    } catch {
      return merged
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(temporary, JSON.stringify({ scope, reviewed: merged }), { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    try { unlinkSync(temporary) } catch { /* nothing was written */ }
  }
  return merged
}

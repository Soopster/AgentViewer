import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Which teammate results the user has reviewed, per conversation — herdr's
// "done" vs "idle": a finished agent stays flagged until someone looks.
// Presentation only; it never acknowledges model mail. Kept on disk because an
// in-memory list re-flagged every result in every team after a TUI restart.
// The web keeps the same markers in localStorage.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'coordinator-reviewed-v1')
const LIMIT = 500
const fileFor = (scope: string) => path.join(DATA_DIR, `${createHash('sha256').update(scope).digest('hex')}.json`)

export function readCoordinatorReviewed(scope: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(scope), 'utf8')) as { scope?: string; reviewed?: unknown }
    if (parsed.scope !== scope || !Array.isArray(parsed.reviewed)) return []
    return parsed.reviewed.filter((entry): entry is string => typeof entry === 'string').slice(-LIMIT)
  } catch {
    // Missing or unreadable markers only re-show results; never block work.
    return []
  }
}

/**
 * Merge rather than overwrite: two TUI clients on the same conversation must
 * not erase each other's markers. Temp-and-rename, so a torn write cannot
 * leave unparseable JSON that reads back as "nothing reviewed".
 */
export function writeCoordinatorReviewed(scope: string, reviewed: readonly string[]): string[] {
  const merged = [...new Set([...readCoordinatorReviewed(scope), ...reviewed])].slice(-LIMIT)
  const file = fileFor(scope)
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

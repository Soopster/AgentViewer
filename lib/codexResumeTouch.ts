// codex-cli's thread/resume bumps a thread's `updatedAt`, and `updatedAt` is
// what the session list reports as `lastModified`. This app resumes threads
// that nobody worked in — to learn a model, to prewarm a selection, before a
// rollback — so merely opening a Codex session made it read as active a
// minute ago (and wear the rail's "written elsewhere" mark).
//
// The bump each resume leaves is recorded here, and a listing that sees a
// thread still at exactly that `updatedAt` reports the thread's last turn
// (`recencyAt`) instead. Any real work moves `updatedAt` past the recorded
// value and the override drops itself, so it can only hide a time this app
// caused — the rule lib/claudeResumeTouch.ts applies to Claude's mtime.
//
// Kept in a file, not memory: in the TUI the main isolate resumes threads and
// the transcript worker (another isolate) lists them; the web server and a
// second TUI share it the same way.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const TOUCH_FILE = path.join(process.cwd(), '.agent-viewer-data', 'codex-resume-touches.json')
const TOUCH_LIMIT = 512

/** Thread key → the `updatedAt` (seconds) our resume left behind. */
let touches = new Map<string, number>()
let fileStamp = ''

function load(): void {
  try {
    const stat = statSync(TOUCH_FILE)
    const stamp = `${stat.mtimeMs}:${stat.size}`
    if (stamp === fileStamp) return
    fileStamp = stamp
    const parsed = JSON.parse(readFileSync(TOUCH_FILE, 'utf8')) as { entries?: Record<string, unknown> }
    const next = new Map<string, number>()
    for (const [key, value] of Object.entries(parsed.entries ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) next.set(key, value)
    }
    touches = next
  } catch {
    // No file yet, or a torn one: no override, which reports Codex's own time.
  }
}

/** Record the `updatedAt` a resume of this thread left. */
export function recordCodexResumeTouch(threadKey: string, updatedAt: number): void {
  if (!Number.isFinite(updatedAt)) return
  load()
  touches.delete(threadKey)
  touches.set(threadKey, updatedAt)
  while (touches.size > TOUCH_LIMIT) {
    const oldest = touches.keys().next().value
    if (oldest === undefined) break
    touches.delete(oldest)
  }
  try {
    mkdirSync(path.dirname(TOUCH_FILE), { recursive: true })
    const temporary = `${TOUCH_FILE}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, entries: Object.fromEntries(touches) }))
    renameSync(temporary, TOUCH_FILE)
    const stat = statSync(TOUCH_FILE)
    fileStamp = `${stat.mtimeMs}:${stat.size}`
  } catch {
    // Unrecorded, the session reads as touched — the old behaviour, no worse.
  }
}

/**
 * The thread's last activity in seconds: `updatedAt`, unless that is exactly
 * the bump one of our resumes left, in which case its last turn.
 */
export function codexActivityUpdatedAt(threadKey: string, thread: { updatedAt: number; recencyAt?: number | null }): number {
  load()
  const touched = touches.get(threadKey)
  if (touched === undefined || touched !== thread.updatedAt || thread.recencyAt == null) return thread.updatedAt
  return Math.min(thread.recencyAt, thread.updatedAt)
}

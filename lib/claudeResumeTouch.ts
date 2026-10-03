// Resuming a session in the warm pool rewrites its transcript: the CLI writes
// the same bytes back (verified — identical size and sha256 before and after)
// but the file's mtime moves, and mtime is what `listSessions` reports as
// `lastModified`. OpenTUI now defers existing-session pool prewarm until the
// composer is engaged, but other prewarm callers can still resume without a
// turn; without this fallback that would jump the session to the top of every
// list ordered by last activity, in the app and in `claude --resume` alike.
//
// Read-only control queries avoid this with `persistSession: false`
// (lib/sdkControlQuery.ts). A pool entry cannot: the turn it is being warmed
// for has to persist, and the SDK has no way to turn persistence on later.
//
// So the touch is recorded here and subtracted at read time. The override is
// pinned to the exact post-resume mtime and file size, so any real write — a
// turn on this session, an append by an external `claude` sharing it — moves
// one of them and the override drops itself on the next read. It can only ever
// hide a timestamp we caused.

import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import { claudeSessionStoreOptions } from './claudeSessionStore'
import { currentProviderInstanceId } from './providerInstances'

type ResumeTouch = {
  /** The mtime the session had before we resumed it. */
  restore: number
  /** The mtime our resume left behind; the override applies only at this value. */
  touched: number
  /** Undefined for store-backed sessions, where the SDK reports no file size. */
  fileSize?: number
}

// Bounded: one small record per session prewarmed in this process.
const TOUCH_CACHE_MAX = 256
const touches = new Map<string, ResumeTouch>()

function touchKey(sessionId: string): string {
  return `${currentProviderInstanceId('claude')}:${sessionId}`
}

function readInfo(sessionId: string) {
  return getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => null)
}

/**
 * The pre-resume time to restore. Read through any touch already recorded, so a
 * session resumed twice (the pool sweeps an idle entry, the user comes back)
 * restores the last time it was really written, not the previous resume.
 */
async function readRestorePoint(sessionId: string) {
  const info = await readInfo(sessionId)
  return info ? withoutClaudeResumeTouch(info) : null
}

/**
 * Run a resume-bearing prewarm, recording the mtime it moves so reads can
 * report the session's real last-activity time. Best-effort throughout: if
 * either metadata read fails, or the resume left the mtime alone, nothing is
 * recorded and the SDK's own numbers are reported unchanged.
 */
export async function withClaudeResumeTouchRecorded<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  const before = await readRestorePoint(sessionId)
  const result = await run()
  if (!before) return result
  // The rewrite lands before the query reports initialization (measured), but
  // give it a couple of beats rather than racing a slower machine.
  for (let attempt = 0; attempt < 3; attempt++) {
    const after = await readInfo(sessionId)
    if (after && after.lastModified !== before.lastModified) {
      if (after.fileSize === before.fileSize) {
        const key = touchKey(sessionId)
        touches.delete(key)
        touches.set(key, { restore: before.lastModified, touched: after.lastModified, fileSize: after.fileSize })
        while (touches.size > TOUCH_CACHE_MAX) {
          const oldest = touches.keys().next().value
          if (oldest === undefined) break
          touches.delete(oldest)
        }
      }
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return result
}

/**
 * Report the session's last-activity time with our own resume touch removed.
 * Returns the input untouched unless it matches a recorded touch exactly.
 */
export function withoutClaudeResumeTouch<T extends { sessionId: string; lastModified: number; fileSize?: number }>(info: T): T {
  const key = touchKey(info.sessionId)
  const touch = touches.get(key)
  if (!touch) return info
  if (info.lastModified !== touch.touched || info.fileSize !== touch.fileSize) {
    // Something really did write to this session; the touch is history.
    touches.delete(key)
    return info
  }
  return { ...info, lastModified: touch.restore }
}

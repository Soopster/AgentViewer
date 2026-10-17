// A change token for the local Claude transcript corpus, and the list cache it
// gates.
//
// Listing sessions is not a metadata lookup: the SDK derives each entry's
// summary, first prompt and branch from the transcript itself, so a 200-session
// page reads 200 files (~300ms and ~44MB of allocation here, measured). The
// sidebar polls that every 5s forever, and a JS engine keeps its allocator
// arenas mapped long after the garbage in them is collected — so a viewer left
// open overnight ratchets its resident size up on nothing but idle polls.
//
// The corpus itself answers "has anything changed?" far more cheaply than
// re-deriving it: one stat per transcript, 601 files in 1-2ms with no
// measurable allocation. Every write that can change a listed field — a new
// turn, a rename, a tag, a delete, a resume — changes that file's size or
// mtime, because the SDK stores all of it in the transcript.
//
// It is a gate, never a source: a token is only ever compared to a previous
// token, and any doubt returns null, which re-derives. Specifically null when a
// session store is configured (the corpus is then not the truth), when the
// projects root is unreadable, and when it holds no transcripts at all — the
// three cases where a sweep's silence could be mistaken for "nothing changed".
// Entries also expire, so a configuration this sweep is blind to shows a stale
// sidebar for one extra poll rather than indefinitely.

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configuredClaudeSessionStore } from './claudeSessionStore'
import type { Session } from './types'

/** A backstop for a change the sweep cannot see, not a routine refresh: when a
 *  token exists it is already exact, so expiring often just pays the full
 *  re-derive on a timer — at 15s the transcript worker allocated a 45MB burst
 *  every fourth poll while the app sat idle. Long enough to be rare, short
 *  enough that an unforeseen blind spot self-corrects. */
const LIST_CACHE_TTL_MS = 5 * 60_000
/** One entry per distinct list shape (params + config dir). A handful of shapes
 *  exist — the sidebar's, the project feed's, each provider instance's. */
const LIST_CACHE_MAX = 8

function claudeProjectsRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR
  return join(configDir && configDir.length > 0 ? configDir : join(homedir(), '.claude'), 'projects')
}

/**
 * Size+mtime of every transcript in the corpus, folded into one string. Null
 * when the corpus is not the authority (a session store is configured) or the
 * sweep found nothing to compare — see the header.
 */
export async function readClaudeCorpusToken(): Promise<string | null> {
  if (configuredClaudeSessionStore()) return null
  const root = claudeProjectsRoot()
  let projects: string[]
  try {
    projects = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }
  const parts: string[] = []
  await Promise.all(projects.map(async (project) => {
    let files: string[]
    try {
      files = (await readdir(join(root, project), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => entry.name)
    } catch {
      return
    }
    await Promise.all(files.map(async (file) => {
      try {
        const info = await stat(join(root, project, file))
        parts.push(`${project}/${file}:${info.size}:${info.mtimeMs}`)
      } catch {
        // A transcript that vanished mid-sweep is a change in itself; leaving it
        // out of the token is what makes the next comparison notice.
      }
    }))
  }))
  if (parts.length === 0) return null
  parts.sort()
  return `${parts.length}:${foldToken(parts.join('|'))}`
}

// The token is compared, never inspected, so a fold is enough — and folding
// keeps one string in memory instead of one per transcript.
function foldToken(value: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(36)}${h2.toString(36)}`
}

type ListCacheEntry = { token: string; sessions: Session[]; ts: number }

const listCache = new Map<string, ListCacheEntry>()

export function claudeListCacheKey(params: {
  limit?: number
  offset?: number
  dir?: string
  includeWorktrees?: boolean
}): string {
  return [
    process.env.CLAUDE_CONFIG_DIR ?? '',
    params.limit ?? '',
    params.offset ?? '',
    params.dir ?? '',
    params.includeWorktrees === undefined ? '' : String(params.includeWorktrees),
  ].join('|')
}

/** The cached page for this key when the corpus has not changed since it was
 *  stored. Copies are handed out: callers decorate sessions in place (provider
 *  instance, inbox state), and a shared array would accumulate their edits. */
export function readClaudeListCache(key: string, token: string | null): Session[] | null {
  if (!token) return null
  const entry = listCache.get(key)
  if (!entry || entry.token !== token) return null
  if (Date.now() - entry.ts > LIST_CACHE_TTL_MS) {
    listCache.delete(key)
    return null
  }
  listCache.delete(key)
  listCache.set(key, entry)
  return entry.sessions.map((session) => ({ ...session }))
}

export function writeClaudeListCache(key: string, token: string | null, sessions: Session[]): Session[] {
  if (!token) return sessions
  listCache.delete(key)
  listCache.set(key, { token, sessions: sessions.map((session) => ({ ...session })), ts: Date.now() })
  while (listCache.size > LIST_CACHE_MAX) {
    const oldest = listCache.keys().next().value
    if (oldest === undefined) break
    listCache.delete(oldest)
  }
  return sessions
}

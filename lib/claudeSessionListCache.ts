// The Claude session list, re-derived only where the corpus changed.
//
// Listing sessions is not a metadata lookup: the SDK derives each entry's
// summary, first prompt and branch from the transcript itself, so a 157-session
// page reads every listed file — ~220ms and ~117MB of transient allocation
// here, measured. A JS engine keeps its allocator arenas mapped long after the
// garbage in them is collected, so that one derive set the TUI's boot peak
// (worker footprint 25MB → 183MB), and every repeat ratchets resident size.
//
// The corpus answers "what changed?" far more cheaply than re-deriving it: one
// stat per transcript, ~560 files in 1-2ms. Every write that can change a listed
// field — a new turn, a rename, a tag, a delete, a resume — changes that file's
// size or mtime, because the SDK stores all of it in the transcript. Three
// answers follow from comparing two sweeps:
//
//  - Nothing changed: the cached page is the answer.
//  - Only transcripts already on the page changed — a running turn appending to
//    its own transcript, which is what every 5s poll sees while any Claude turn
//    is live: each is re-read with getSessionInfo (~0.5ms, one file) and the
//    page re-sorted. getSessionInfo derives exactly the fields the list entry
//    carries (0 differences over 157 sessions, checked), so a patched page is
//    the page a full derive would return.
//  - A transcript the page does not list changed. The list drops a transcript
//    whose head or tail yields nothing to show (a sidechain, or a 64KB tail that
//    is one giant tool result) — and that is not a fixed property: a live
//    session can fall out of the list and back in as it grows. This session's
//    own transcript and a claude-mem observer's are both like that here, and
//    both are written continuously, so treating any such change as "derive"
//    re-derived on every poll. getSessionInfo builds its answer with the very
//    function that drops them, so it is asked: still nothing means still
//    excluded, and the page stands; an answer means the file may now enter the
//    page, which is a full derive.
//  - Anything else (a transcript added or removed, or a session continued in
//    another): a full derive. The list applies a few more rules this module
//    does not reproduce, so it never guesses which side of them a file is on.
//
// The page and the sweep it was derived from are also kept on disk, so a fresh
// process — the TUI's transcript worker at launch — patches yesterday's page
// instead of re-deriving the whole corpus.
//
// It is a gate, never a source: any doubt re-derives. Specifically when a
// session store is configured (the corpus is then not the truth), when the
// projects root is unreadable, and when it holds no transcripts at all — the
// three cases where a sweep's silence could be mistaken for "nothing changed".
// Entries also expire, so a configuration this sweep is blind to shows a stale
// sidebar for one extra poll rather than indefinitely.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configuredClaudeSessionStore } from './claudeSessionStore'

/** A backstop for a change the sweep cannot see, not a routine refresh: when a
 *  sweep exists it is already exact, so expiring often just pays the full
 *  re-derive on a timer — at 15s the transcript worker allocated a 45MB burst
 *  every fourth poll while the app sat idle. Long enough to be rare, short
 *  enough that an unforeseen blind spot self-corrects. Patching does not renew
 *  it: a page that has only ever been patched still re-derives on schedule. */
const LIST_CACHE_TTL_MS = 5 * 60_000
/** One entry per distinct list shape (params + config dir). A handful of shapes
 *  exist — the sidebar's, the project feed's, each provider instance's. */
const LIST_CACHE_MAX = 8
/** More changed transcripts than this and one full derive is cheaper than the
 *  per-file reads (each is a separate open of the same kind of file). */
const PATCH_MAX_CHANGED = 24
/** A patched page is written back at most this often: while a turn runs every
 *  poll patches, and the snapshot only has to be close enough to patch from. */
const SNAPSHOT_WRITE_INTERVAL_MS = 60_000
const SNAPSHOT_FILE = join(process.cwd(), '.agent-viewer-data', 'claude-session-list.json')
const SNAPSHOT_VERSION = 1
/** The SDK reads a transcript's last 64KB for the fields a list entry carries,
 *  and for the marker below. */
const TRANSCRIPT_TAIL_BYTES = 65536
/** A session continued in another is dropped from the list (the SDK's own
 *  rule), and getSessionInfo does not apply it — so a transcript that gained the
 *  marker cannot be patched. */
const CONTINUED_IN_MARKER = '"type":"continued-in"'

/** What a list entry is made of, as far as this cache needs to know. */
export type ClaudeListEntry = { sessionId: string; lastModified: number; cwd?: string }

/** One sweep of the corpus: `project/file.jsonl` → `size:mtime`. */
export type ClaudeCorpus = { token: string; stamps: Map<string, string> }

function claudeProjectsRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR
  return join(configDir && configDir.length > 0 ? configDir : join(homedir(), '.claude'), 'projects')
}

/**
 * Size+mtime of every transcript in the corpus. Null when the corpus is not
 * the authority (a session store is configured) or the sweep found nothing to
 * compare — see the header.
 */
export async function readClaudeCorpus(): Promise<ClaudeCorpus | null> {
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
  const stamps = new Map<string, string>()
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
        stamps.set(`${project}/${file}`, `${info.size}:${info.mtimeMs}`)
      } catch {
        // A transcript that vanished mid-sweep is a change in itself; leaving it
        // out of the sweep is what makes the next comparison notice.
      }
    }))
  }))
  if (stamps.size === 0) return null
  return { token: corpusToken(stamps), stamps }
}

function corpusToken(stamps: Map<string, string>): string {
  const parts = [...stamps].map(([file, stamp]) => `${file}:${stamp}`).sort()
  return `${parts.length}:${foldToken(parts.join('|'))}`
}

// The token is compared, never inspected, so a fold is enough.
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

type ListCacheEntry<T extends ClaudeListEntry> = {
  token: string
  stamps: Map<string, string>
  /** The SDK's own entries, before any caller decoration. */
  entries: T[]
  /** When the page was last fully derived (the TTL counts from here). */
  derivedAt: number
  /** When the page last reached the snapshot file. */
  savedAt: number
}

const listCache = new Map<string, ListCacheEntry<ClaudeListEntry>>()
let snapshotLoaded = false

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

/**
 * The page for this list shape, as cheaply as the corpus allows: cached when
 * nothing changed, patched when only listed transcripts changed, and derived
 * from scratch otherwise. `readEntry` must answer what the list would carry for
 * one session (getSessionInfo), and null when it cannot.
 *
 * Copies are handed out: callers decorate entries in place (provider instance,
 * inbox state), and shared objects would accumulate their edits.
 */
export async function readClaudeListPage<T extends ClaudeListEntry>(options: {
  key: string
  /** Pages past the first can shift by a patched entry crossing their edge. */
  patchable: boolean
  corpus: ClaudeCorpus | null
  derive: () => Promise<T[]>
  readEntry: (entry: T) => Promise<T | null>
  /** Whether a session the page does not list now has an entry at all. */
  hasEntry: (sessionId: string) => Promise<boolean>
}): Promise<T[]> {
  const { key, corpus } = options
  if (!corpus) return options.derive()
  loadSnapshot()
  const now = Date.now()
  const cached = listCache.get(key) as ListCacheEntry<T> | undefined
  const fresh = cached && now - cached.derivedAt <= LIST_CACHE_TTL_MS ? cached : undefined
  if (fresh && fresh.token === corpus.token) {
    listCache.delete(key)
    listCache.set(key, fresh)
    return fresh.entries.map((entry) => ({ ...entry }))
  }
  let entries: T[] | null = null
  let derivedAt = now
  if (fresh && options.patchable) {
    entries = await patchClaudeListPage(fresh, corpus, options.readEntry, options.hasEntry)
    if (entries) derivedAt = fresh.derivedAt
  }
  if (!entries) entries = await options.derive()
  const savedAt = fresh?.savedAt ?? 0
  const entry: ListCacheEntry<T> = { token: corpus.token, stamps: corpus.stamps, entries, derivedAt, savedAt }
  listCache.delete(key)
  listCache.set(key, entry as unknown as ListCacheEntry<ClaudeListEntry>)
  while (listCache.size > LIST_CACHE_MAX) {
    const oldest = listCache.keys().next().value
    if (oldest === undefined) break
    listCache.delete(oldest)
  }
  if (derivedAt === now || now - savedAt >= SNAPSHOT_WRITE_INTERVAL_MS) {
    entry.savedAt = now
    saveSnapshot()
  }
  return entries.map((item) => ({ ...item }))
}

/**
 * The previous page with every changed transcript re-read, or null when the
 * change is anything a patch cannot answer exactly (see the header).
 */
export async function patchClaudeListPage<T extends ClaudeListEntry>(
  previous: { stamps: Map<string, string>; entries: T[] },
  corpus: ClaudeCorpus,
  readEntry: (entry: T) => Promise<T | null>,
  hasEntry: (sessionId: string) => Promise<boolean>,
): Promise<T[] | null> {
  if (previous.stamps.size !== corpus.stamps.size) return null
  const changedIds: string[] = []
  const filesPerId = new Map<string, number>()
  for (const [file, stamp] of corpus.stamps) {
    const before = previous.stamps.get(file)
    if (before === undefined) return null
    const id = sessionIdOfFile(file)
    filesPerId.set(id, (filesPerId.get(id) ?? 0) + 1)
    if (before !== stamp) changedIds.push(id)
  }
  if (changedIds.length > PATCH_MAX_CHANGED) return null
  const byId = new Map(previous.entries.map((entry, index) => [entry.sessionId, index]))
  const next = previous.entries.slice()
  for (const id of changedIds) {
    // One id stored under two projects: which copy the list shows is the SDK's call.
    if (filesPerId.get(id) !== 1) return null
    const index = byId.get(id)
    if (index === undefined) {
      // Excluded before; excluded still unless it now yields an entry.
      if (await hasEntry(id)) return null
      continue
    }
    if (await transcriptTailIncludes(id, corpus, CONTINUED_IN_MARKER)) return null
    const updated = await readEntry(next[index])
    if (!updated || updated.sessionId !== id) return null
    next[index] = updated
  }
  return next.sort(compareListEntries)
}

/** The SDK's page order: newest first, ties by session id, descending. */
function compareListEntries(left: ClaudeListEntry, right: ClaudeListEntry): number {
  if (right.lastModified !== left.lastModified) return right.lastModified - left.lastModified
  return right.sessionId < left.sessionId ? -1 : right.sessionId > left.sessionId ? 1 : 0
}

async function transcriptTailIncludes(sessionId: string, corpus: ClaudeCorpus, marker: string): Promise<boolean> {
  const file = [...corpus.stamps.keys()].find((key) => sessionIdOfFile(key) === sessionId)
  if (!file) return true
  try {
    const handle = await open(join(claudeProjectsRoot(), file), 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      return buffer.includes(marker)
    } finally {
      await handle.close()
    }
  } catch {
    // Unreadable now: the full derive decides what it is.
    return true
  }
}

function sessionIdOfFile(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1)
  return name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : name
}

// ─── Snapshot ────────────────────────────────────────────────────────────────
// A plain file beside the app's other state: the web server and every TUI
// worker read and write it, and each entry carries the sweep it was derived
// from, so a stale or foreign one is just a bigger patch — or a full derive.

type SnapshotEntry = { token: string; stamps: Record<string, string>; entries: ClaudeListEntry[]; derivedAt: number }

function loadSnapshot(): void {
  if (snapshotLoaded) return
  snapshotLoaded = true
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as { version?: number; pages?: Record<string, SnapshotEntry> }
    if (parsed.version !== SNAPSHOT_VERSION || !parsed.pages) return
    for (const [key, page] of Object.entries(parsed.pages)) {
      if (listCache.has(key) || !Array.isArray(page.entries) || typeof page.token !== 'string') continue
      listCache.set(key, {
        token: page.token,
        stamps: new Map(Object.entries(page.stamps ?? {})),
        entries: page.entries,
        // A snapshot of any age patches exactly; the TTL restarts with this
        // process, which is when a blind spot would have had its chance.
        derivedAt: Date.now(),
        savedAt: Date.now(),
      })
    }
  } catch {
    // No snapshot, or a torn one: the first list derives, as before.
  }
}

function saveSnapshot(): void {
  try {
    const pages: Record<string, SnapshotEntry> = {}
    for (const [key, page] of listCache) {
      pages[key] = { token: page.token, stamps: Object.fromEntries(page.stamps), entries: page.entries, derivedAt: page.derivedAt }
    }
    mkdirSync(join(SNAPSHOT_FILE, '..'), { recursive: true })
    const temporary = `${SNAPSHOT_FILE}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: SNAPSHOT_VERSION, pages }))
    renameSync(temporary, SNAPSHOT_FILE)
  } catch {
    // Best-effort: without a snapshot the next process derives once.
  }
}

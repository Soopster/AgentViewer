import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'composer-drafts')
const FILE = path.join(DATA_DIR, 'drafts.json')
const QUEUE_FILE = path.join(DATA_DIR, 'queue-v1.json')
const STASH_FILE = path.join(DATA_DIR, 'stash-v1.json')

type DraftStore = Record<string, { text: string }>

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function readStoreSync(): DraftStore {
  try {
    if (!existsSync(FILE)) return {}
    const raw = readFileSync(FILE, 'utf-8')
    return JSON.parse(raw) as DraftStore
  } catch {
    return {}
  }
}

const writeQueue = new Set<string>()
let writeTimer: ReturnType<typeof setTimeout> | null = null

function flushWrites(): void {
  writeTimer = null
  if (writeQueue.size === 0) return
  const keys = [...writeQueue]
  writeQueue.clear()
  const store = readStoreSync()
  for (const key of keys) {
    const entry = pendingDrafts.get(key)
    if (!entry) continue
    pendingDrafts.delete(key)
    if (entry.text.trim()) {
      store[key] = { text: entry.text }
    } else {
      delete store[key]
    }
  }
  ensureDir()
  writeFileSync(FILE, JSON.stringify(store), 'utf-8')
}

const pendingDrafts = new Map<string, { text: string }>()

export function scheduleWriteComposerDraft(storageKey: string, text: string): void {
  pendingDrafts.set(storageKey, { text })
  writeQueue.add(storageKey)
  if (!writeTimer) writeTimer = setTimeout(flushWrites, 300)
}

export function readComposerDraft(storageKey: string): string {
  const pending = pendingDrafts.get(storageKey)
  if (pending) return pending.text
  const store = readStoreSync()
  return store[storageKey]?.text ?? ''
}

/**
 * A debounced, atomically-written JSON list file. Both the follow-up queue and
 * the composer stash hold durable arrays of composer entries whose only
 * difference is the file and the cap, so they share one implementation: a torn
 * write of either reads back as unparseable JSON, which is indistinguishable
 * from "nothing queued" and would silently drop work the user believed was kept.
 */
function createJsonListStore(file: string, options: { delayMs: number; max?: number }) {
  let state: unknown[] | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function readSync(): unknown[] {
    try {
      if (!existsSync(file)) return []
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { version?: unknown; entries?: unknown }
      return parsed.version === 1 && Array.isArray(parsed.entries) ? parsed.entries : []
    } catch {
      return []
    }
  }

  function flush(): boolean {
    timer = null
    if (!state) return true
    try {
      ensureDir()
      const temporaryFile = `${file}.${process.pid}.tmp`
      writeFileSync(temporaryFile, JSON.stringify({ version: 1, entries: state }), 'utf-8')
      renameSync(temporaryFile, file)
      return true
    } catch {
      // best-effort; the in-memory list remains authoritative for this process
      return false
    }
  }

  return {
    read<T>(isEntry: (value: unknown) => value is T): T[] {
      if (!state) state = readSync()
      return state.filter(isEntry)
    },
    write<T>(entries: T[]): void {
      // The cap keeps the newest, which is the end of the list for both callers.
      state = options.max !== undefined && entries.length > options.max
        ? entries.slice(entries.length - options.max)
        : entries
      if (!timer) timer = setTimeout(flush, options.delayMs)
    },
    flushWrites(): boolean {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return flush()
    },
  }
}

const queueStore = createJsonListStore(QUEUE_FILE, { delayMs: 100 })

export function readComposerQueue<T>(isEntry: (value: unknown) => value is T): T[] {
  return queueStore.read(isEntry)
}

export function scheduleWriteComposerQueue<T>(entries: T[]): void {
  queueStore.write(entries)
}

export function flushComposerQueueWrites(): boolean {
  return queueStore.flushWrites()
}

// --- Composer stash (durable shelved drafts, newest last) ---

/**
 * Deep enough that shelving is never a decision about what to discard, bounded
 * so a stash nobody prunes cannot grow without limit. Matches opencode's
 * `MAX_STASH_ENTRIES`.
 */
export const COMPOSER_STASH_MAX = 50

const stashStore = createJsonListStore(STASH_FILE, { delayMs: 100, max: COMPOSER_STASH_MAX })

export function readComposerStash<T>(isEntry: (value: unknown) => value is T): T[] {
  return stashStore.read(isEntry)
}

export function scheduleWriteComposerStash<T>(entries: T[]): void {
  stashStore.write(entries)
}

export function flushComposerStashWrites(): boolean {
  return stashStore.flushWrites()
}

// --- Sent history (global, text-only, persisted across restarts) ---

const SENT_HISTORY_FILE = path.join(DATA_DIR, 'sent-history.json')
const SENT_HISTORY_MAX = 200

type SentHistoryStore = { entries: string[] }

function readSentHistorySync(): string[] {
  try {
    if (!existsSync(SENT_HISTORY_FILE)) return []
    const raw = readFileSync(SENT_HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as SentHistoryStore
    return Array.isArray(parsed.entries) ? parsed.entries.filter((e) => typeof e === 'string') : []
  } catch {
    return []
  }
}

let sentHistoryCache: string[] | null = null
let sentHistoryWriteTimer: ReturnType<typeof setTimeout> | null = null

function flushSentHistory(): void {
  sentHistoryWriteTimer = null
  if (!sentHistoryCache) return
  try {
    ensureDir()
    writeFileSync(SENT_HISTORY_FILE, JSON.stringify({ entries: sentHistoryCache }), 'utf-8')
  } catch {
    // best-effort; history is non-critical
  }
}

/** Returns persisted sent messages, oldest first. */
export function readComposerSentHistory(): string[] {
  if (!sentHistoryCache) sentHistoryCache = readSentHistorySync()
  return [...sentHistoryCache]
}

/** Appends a sent message (text-only), de-duping consecutive repeats, capped. */
export function appendComposerSentHistory(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  if (!sentHistoryCache) sentHistoryCache = readSentHistorySync()
  if (sentHistoryCache[sentHistoryCache.length - 1] === trimmed) return
  sentHistoryCache.push(trimmed)
  if (sentHistoryCache.length > SENT_HISTORY_MAX) {
    sentHistoryCache = sentHistoryCache.slice(sentHistoryCache.length - SENT_HISTORY_MAX)
  }
  if (!sentHistoryWriteTimer) sentHistoryWriteTimer = setTimeout(flushSentHistory, 300)
}

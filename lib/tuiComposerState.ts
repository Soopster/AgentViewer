import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'composer-drafts')
const FILE = path.join(DATA_DIR, 'drafts.json')

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

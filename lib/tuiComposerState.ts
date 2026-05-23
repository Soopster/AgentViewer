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
  const store = readStoreSync()
  return store[storageKey]?.text ?? ''
}

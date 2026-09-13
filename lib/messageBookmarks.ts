import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProvider } from './types'

// Bookmarks are local-only state — like tags/title overrides, providers cannot
// store per-message metadata of their own, so Agent Viewer mirrors them here.
// One flat JSON file under .agent-viewer-data/, keyed by `${provider}::${sessionId}`.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const BOOKMARK_FILE = path.join(DATA_DIR, 'message-bookmarks.json')

export type MessageBookmark = {
  provider: AgentProvider
  sessionId: string
  /** The bookmarked message's uuid — matches ThreadedMessage.uuid / TUI card key. */
  uuid: string
  role?: 'user' | 'assistant' | 'system'
  /** Short header label (e.g. "user", "assistant", a tool name). */
  label?: string
  /** Text snippet shown in the global bookmarks list. */
  preview?: string
  /** Session title at bookmark time, so the global list reads well without a re-fetch. */
  sessionTitle?: string
  /** Original message timestamp (ISO), when known. */
  messageTimestamp?: string
  /** Epoch ms when the bookmark was created. */
  createdAt: number
}

type BookmarkStore = Record<string, MessageBookmark[]>

let storeCache: BookmarkStore | null = null

function storeKey(provider: AgentProvider | undefined, sessionId: string): string {
  return `${provider ?? 'claude'}::${sessionId}`
}

function sanitizeBookmark(value: unknown): MessageBookmark | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.uuid !== 'string' || typeof record.sessionId !== 'string') return null
  const provider = (typeof record.provider === 'string' ? record.provider : 'claude') as AgentProvider
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0
  return {
    provider,
    sessionId: record.sessionId,
    uuid: record.uuid,
    role: record.role === 'user' || record.role === 'assistant' || record.role === 'system' ? record.role : undefined,
    label: typeof record.label === 'string' ? record.label : undefined,
    preview: typeof record.preview === 'string' ? record.preview : undefined,
    sessionTitle: typeof record.sessionTitle === 'string' ? record.sessionTitle : undefined,
    messageTimestamp: typeof record.messageTimestamp === 'string' ? record.messageTimestamp : undefined,
    createdAt,
  }
}

async function loadStore(): Promise<BookmarkStore> {
  if (storeCache !== null) return storeCache
  try {
    const contents = await readFile(BOOKMARK_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') {
      storeCache = {}
      return storeCache
    }
    const store: BookmarkStore = {}
    for (const [key, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const records = list.map(sanitizeBookmark).filter((entry): entry is MessageBookmark => entry !== null)
      if (records.length > 0) store[key] = records
    }
    storeCache = store
    return storeCache
  } catch {
    storeCache = {}
    return storeCache
  }
}

async function saveStore(store: BookmarkStore): Promise<void> {
  storeCache = store
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(BOOKMARK_FILE, JSON.stringify(store, null, 2), 'utf8')
}

export async function getSessionBookmarks(
  provider: AgentProvider | undefined,
  sessionId: string,
): Promise<MessageBookmark[]> {
  const store = await loadStore()
  return store[storeKey(provider, sessionId)] ?? []
}

export async function getSessionBookmarkIds(
  provider: AgentProvider | undefined,
  sessionId: string,
): Promise<string[]> {
  const records = await getSessionBookmarks(provider, sessionId)
  return records.map((record) => record.uuid)
}

export type SetMessageBookmarkInput = {
  provider: AgentProvider | undefined
  sessionId: string
  uuid: string
  bookmarked: boolean
  /** Metadata captured at bookmark time; ignored when removing. */
  meta?: Partial<Pick<MessageBookmark, 'role' | 'label' | 'preview' | 'sessionTitle' | 'messageTimestamp'>>
}

/** Add or remove a single message bookmark; returns the session's updated list. */
export async function setMessageBookmark(input: SetMessageBookmarkInput): Promise<MessageBookmark[]> {
  const { provider, sessionId, uuid, bookmarked, meta } = input
  const store = await loadStore()
  const key = storeKey(provider, sessionId)
  const existing = store[key] ?? []

  if (bookmarked) {
    if (existing.some((record) => record.uuid === uuid)) return existing
    const record: MessageBookmark = {
      provider: provider ?? 'claude',
      sessionId,
      uuid,
      role: meta?.role,
      label: meta?.label,
      preview: meta?.preview,
      sessionTitle: meta?.sessionTitle,
      messageTimestamp: meta?.messageTimestamp,
      createdAt: Date.now(),
    }
    const next = [...existing, record]
    store[key] = next
    await saveStore(store)
    return next
  }

  const next = existing.filter((record) => record.uuid !== uuid)
  if (next.length === existing.length) return existing
  if (next.length === 0) delete store[key]
  else store[key] = next
  await saveStore(store)
  return next
}

/** Every bookmark across all sessions/providers, newest first. Backs the global view. */
export async function listAllBookmarks(): Promise<MessageBookmark[]> {
  const store = await loadStore()
  const all: MessageBookmark[] = []
  for (const list of Object.values(store)) all.push(...list)
  all.sort((a, b) => b.createdAt - a.createdAt)
  return all
}

/** Drop every bookmark for a session (used when a session is deleted). */
export async function removeSessionBookmarks(
  provider: AgentProvider | undefined,
  sessionId: string,
): Promise<void> {
  const store = await loadStore()
  const key = storeKey(provider, sessionId)
  if (!(key in store)) return
  delete store[key]
  await saveStore(store)
}

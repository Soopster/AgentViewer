import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const TAG_FILE = path.join(DATA_DIR, 'opencode-tags.json')

type TagStore = Record<string, string[]>

let storeCache: TagStore | null = null

async function loadTagStore(): Promise<TagStore> {
  if (storeCache !== null) return storeCache
  try {
    const contents = await readFile(TAG_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') {
      storeCache = {}
      return storeCache
    }
    const store: TagStore = {}
    for (const [sessionId, tags] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(tags)) continue
      store[sessionId] = tags.filter((value): value is string => typeof value === 'string')
    }
    storeCache = store
    return storeCache
  } catch {
    storeCache = {}
    return storeCache
  }
}

async function saveTagStore(store: TagStore): Promise<void> {
  storeCache = store
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(TAG_FILE, JSON.stringify(store, null, 2), 'utf8')
}

export async function getOpenCodeStoredTag(sessionId: string): Promise<string | null> {
  const store = await loadTagStore()
  const tags = store[sessionId] ?? []
  return tags.length > 0 ? tags.join(', ') : null
}

export async function setOpenCodeStoredTag(sessionId: string, value: string | null): Promise<void> {
  const store = await loadTagStore()
  const tags = (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  if (tags.length === 0) {
    delete store[sessionId]
  } else {
    store[sessionId] = tags
  }

  await saveTagStore(store)
}

export async function getOpenCodeStoredTagsForSessions(sessionIds: string[]): Promise<Record<string, string | null>> {
  const store = await loadTagStore()
  const result: Record<string, string | null> = {}
  for (const sessionId of sessionIds) {
    const tags = store[sessionId] ?? []
    result[sessionId] = tags.length > 0 ? tags.join(', ') : null
  }
  return result
}

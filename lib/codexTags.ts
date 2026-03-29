import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const TAG_FILE = path.join(DATA_DIR, 'codex-tags.json')

type TagStore = Record<string, string[]>

async function loadTagStore(): Promise<TagStore> {
  try {
    const contents = await readFile(TAG_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const store: TagStore = {}
    for (const [threadId, tags] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(tags)) continue
      store[threadId] = tags.filter((value): value is string => typeof value === 'string')
    }
    return store
  } catch {
    return {}
  }
}

async function saveTagStore(store: TagStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(TAG_FILE, JSON.stringify(store, null, 2), 'utf8')
}

export async function getCodexStoredTag(sessionId: string): Promise<string | null> {
  const store = await loadTagStore()
  const tags = store[sessionId] ?? []
  return tags.length > 0 ? tags.join(', ') : null
}

export async function setCodexStoredTag(sessionId: string, value: string | null): Promise<void> {
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

export async function getCodexStoredTagsForSessions(sessionIds: string[]): Promise<Record<string, string | null>> {
  const store = await loadTagStore()
  const result: Record<string, string | null> = {}
  for (const sessionId of sessionIds) {
    const tags = store[sessionId] ?? []
    result[sessionId] = tags.length > 0 ? tags.join(', ') : null
  }
  return result
}

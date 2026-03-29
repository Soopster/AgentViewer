import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const METADATA_FILE = path.join(DATA_DIR, 'copilot-metadata.json')

type StoredMetadata = {
  title?: string
  tag?: string
}

type MetadataStore = Record<string, StoredMetadata>

let storeCache: MetadataStore | null = null

async function loadMetadataStore(): Promise<MetadataStore> {
  if (storeCache !== null) return storeCache
  try {
    const contents = await readFile(METADATA_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') {
      storeCache = {}
      return storeCache
    }
    const store: MetadataStore = {}
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      store[sessionId] = {
        title: typeof record.title === 'string' && record.title.trim() ? record.title : undefined,
        tag: typeof record.tag === 'string' && record.tag.trim() ? record.tag : undefined,
      }
    }
    storeCache = store
    return storeCache
  } catch {
    storeCache = {}
    return storeCache
  }
}

async function saveMetadataStore(store: MetadataStore): Promise<void> {
  storeCache = store
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(METADATA_FILE, JSON.stringify(store, null, 2), 'utf8')
}

function entryOrNull(entry?: StoredMetadata): { title: string | null; tag: string | null } {
  return {
    title: entry?.title ?? null,
    tag: entry?.tag ?? null,
  }
}

export async function getCopilotStoredMetadata(sessionId: string): Promise<{ title: string | null; tag: string | null }> {
  const store = await loadMetadataStore()
  return entryOrNull(store[sessionId])
}

export async function getCopilotStoredMetadataForSessions(
  sessionIds: string[],
): Promise<Record<string, { title: string | null; tag: string | null }>> {
  const store = await loadMetadataStore()
  const result: Record<string, { title: string | null; tag: string | null }> = {}
  for (const sessionId of sessionIds) {
    result[sessionId] = entryOrNull(store[sessionId])
  }
  return result
}

async function updateMetadata(sessionId: string, updater: (entry: StoredMetadata) => StoredMetadata): Promise<void> {
  const store = await loadMetadataStore()
  const next = updater(store[sessionId] ?? {})
  if (!next.title && !next.tag) {
    delete store[sessionId]
  } else {
    store[sessionId] = next
  }
  await saveMetadataStore(store)
}

export async function setCopilotStoredTitle(sessionId: string, title: string | null): Promise<void> {
  await updateMetadata(sessionId, (entry) => ({
    ...entry,
    title: title?.trim() ? title.trim() : undefined,
  }))
}

export async function setCopilotStoredTag(sessionId: string, tag: string | null): Promise<void> {
  await updateMetadata(sessionId, (entry) => ({
    ...entry,
    tag: tag?.trim() ? tag.trim() : undefined,
  }))
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  sanitizeChannelBridgeOutbox,
  type ChannelBridgeOutboxEntry,
  type ChannelBridgeOutboxStorage,
} from './channelBridgeOutbox'
import type { AgentProvider } from './types'

// Bridge messages are local-only, read-only history of sent/reply messages.
// Stored one flat JSON file under .agent-viewer-data/, keyed by `${provider}::${sessionId}`.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const BRIDGE_MESSAGES_FILE = path.join(DATA_DIR, 'bridge-messages.json')
const CHANNEL_OUTBOX_FILE = path.join(DATA_DIR, 'channel-bridge-outbox.json')

export type BridgeMessage = {
  provider: AgentProvider
  sessionId: string
  kind: 'sent' | 'reply'
  text: string
  timestamp: string
}

type BridgeMessageStore = Record<string, BridgeMessage[]>

let storeCache: BridgeMessageStore | null = null
let outboxCache: ChannelBridgeOutboxEntry[] | null = null

function storeKey(provider: AgentProvider | undefined, sessionId: string): string {
  return `${provider ?? 'claude'}::${sessionId}`
}

function sanitizeBridgeMessage(value: unknown): BridgeMessage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.text !== 'string' || typeof record.sessionId !== 'string') return null
  const kind = record.kind === 'sent' || record.kind === 'reply' ? record.kind : null
  if (!kind) return null
  const provider = (typeof record.provider === 'string' ? record.provider : 'claude') as AgentProvider
  return {
    provider,
    sessionId: record.sessionId,
    kind,
    text: record.text,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString(),
  }
}

async function loadStore(): Promise<BridgeMessageStore> {
  if (storeCache !== null) return storeCache
  try {
    const contents = await readFile(BRIDGE_MESSAGES_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') {
      storeCache = {}
      return storeCache
    }
    const store: BridgeMessageStore = {}
    for (const [key, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const records = list.map(sanitizeBridgeMessage).filter((entry): entry is BridgeMessage => entry !== null)
      if (records.length > 0) store[key] = records
    }
    storeCache = store
    return storeCache
  } catch {
    storeCache = {}
    return storeCache
  }
}

async function saveStore(store: BridgeMessageStore): Promise<void> {
  storeCache = store
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(BRIDGE_MESSAGES_FILE, JSON.stringify(store, null, 2), 'utf8')
  } catch (err) {
    console.error('[bridge-messages] Failed to save:', err)
  }
}

export async function loadBridgeMessagesForSession(provider: AgentProvider | undefined, sessionId: string): Promise<BridgeMessage[]> {
  if (provider && provider !== 'claude') return []
  const store = await loadStore()
  const key = storeKey(provider, sessionId)
  return store[key] ?? []
}

export async function addBridgeMessage(provider: AgentProvider | undefined, sessionId: string, kind: 'sent' | 'reply', text: string, timestamp?: string): Promise<void> {
  if (provider && provider !== 'claude') {
    throw new Error('The channel bridge is only available for Claude sessions')
  }
  const store = await loadStore()
  const key = storeKey(provider, sessionId)
  const message: BridgeMessage = {
    provider: provider ?? 'claude',
    sessionId,
    kind,
    text,
    timestamp: timestamp ?? new Date().toISOString(),
  }
  if (!store[key]) store[key] = []
  store[key].push(message)
  await saveStore(store)
}

export async function clearBridgeMessagesForSession(provider: AgentProvider | undefined, sessionId: string): Promise<void> {
  if (provider && provider !== 'claude') return
  const store = await loadStore()
  const key = storeKey(provider, sessionId)
  delete store[key]
  await saveStore(store)
}

async function loadChannelBridgeFileOutbox(): Promise<ChannelBridgeOutboxEntry[]> {
  if (outboxCache) return outboxCache
  try {
    outboxCache = sanitizeChannelBridgeOutbox(JSON.parse(await readFile(CHANNEL_OUTBOX_FILE, 'utf8')))
  } catch {
    outboxCache = []
  }
  return outboxCache
}

async function saveChannelBridgeFileOutbox(entries: ChannelBridgeOutboxEntry[]): Promise<void> {
  const next = sanitizeChannelBridgeOutbox(entries)
  await mkdir(DATA_DIR, { recursive: true })
  const temporaryPath = path.join(DATA_DIR, `.channel-bridge-outbox.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporaryPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, CHANNEL_OUTBOX_FILE)
  outboxCache = next
}

export const channelBridgeFileOutboxStorage: ChannelBridgeOutboxStorage = {
  load: loadChannelBridgeFileOutbox,
  save: saveChannelBridgeFileOutbox,
}

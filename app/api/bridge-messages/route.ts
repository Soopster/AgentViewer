import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { AgentProvider } from '@/lib/types'
import { sessionIdentityKey } from '@/lib/sessionIdentity'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const BRIDGE_MESSAGES_FILE = path.join(DATA_DIR, 'bridge-messages.json')

export type BridgeMessage = {
  provider: AgentProvider
  sessionId: string
  providerInstanceId?: string
  kind: 'sent' | 'reply'
  text: string
  timestamp: string
}

type BridgeMessageStore = Record<string, BridgeMessage[]>

declare global {
  // Next development reloads must share the queue with requests already writing.
  // eslint-disable-next-line no-var
  var __agentViewerBridgeMessageWrites: Map<string, Promise<void>> | undefined
}

const writeQueues = globalThis.__agentViewerBridgeMessageWrites
  ?? (globalThis.__agentViewerBridgeMessageWrites = new Map())

function serializeWrite(work: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(BRIDGE_MESSAGES_FILE) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(work)
  // Retain a settled tail so one failed append cannot reject the next append.
  const settled = operation.then(() => {}, () => {})
  writeQueues.set(BRIDGE_MESSAGES_FILE, settled)
  return operation.finally(() => {
    if (writeQueues.get(BRIDGE_MESSAGES_FILE) === settled) writeQueues.delete(BRIDGE_MESSAGES_FILE)
  })
}

function storeKey(provider: AgentProvider | undefined, sessionId: string, providerInstanceId?: string): string {
  // Preserve default-connection history without exposing it to configured accounts.
  return !providerInstanceId || providerInstanceId === (provider ?? 'claude')
    ? `${provider ?? 'claude'}::${sessionId}`
    : sessionIdentityKey({ provider, providerInstanceId, sessionId })
}

async function loadStore(): Promise<BridgeMessageStore> {
  try {
    const contents = await readFile(BRIDGE_MESSAGES_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const store: BridgeMessageStore = {}
    for (const [key, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const records = list.filter((entry): entry is BridgeMessage => {
        if (!entry || typeof entry !== 'object') return false
        const record = entry as Record<string, unknown>
        return typeof record.text === 'string' && typeof record.sessionId === 'string' &&
          (record.kind === 'sent' || record.kind === 'reply')
      })
      if (records.length > 0) store[key] = records
    }
    return store
  } catch {
    return {}
  }
}

async function saveStore(store: BridgeMessageStore): Promise<void> {
  const temporary = `${BRIDGE_MESSAGES_FILE}.${process.pid}.${randomUUID()}.tmp`
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: 'utf8', flag: 'wx' })
    // Readers see either complete version, never a truncated in-place rewrite.
    await rename(temporary, BRIDGE_MESSAGES_FILE)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const provider = searchParams.get('provider') as AgentProvider | undefined
  const sessionId = searchParams.get('sessionId')
  const providerInstanceId = searchParams.get('providerInstanceId') || undefined

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }
  if (provider && provider !== 'claude') {
    return NextResponse.json({ error: 'The channel bridge is only available for Claude sessions' }, { status: 400 })
  }

  const store = await loadStore()
  const key = storeKey(provider, sessionId, providerInstanceId)
  const messages = store[key] ?? []

  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>
  const provider = body.provider as AgentProvider | undefined
  const sessionId = body.sessionId as string | undefined
  const providerInstanceId = typeof body.providerInstanceId === 'string' ? body.providerInstanceId : undefined
  const kind = body.kind as 'sent' | 'reply' | undefined
  const text = body.text as string | undefined
  const timestamp = body.timestamp as string | undefined

  if (!sessionId || !kind || !text) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (provider && provider !== 'claude') {
    return NextResponse.json({ error: 'The channel bridge is only available for Claude sessions' }, { status: 400 })
  }

  const key = storeKey(provider, sessionId, providerInstanceId)
  const message: BridgeMessage = {
    provider: provider ?? 'claude',
    providerInstanceId,
    sessionId,
    kind,
    text,
    timestamp: timestamp ?? new Date().toISOString(),
  }

  try {
    await serializeWrite(async () => {
      const store = await loadStore()
      if (!store[key]) store[key] = []
      store[key].push(message)
      await saveStore(store)
    })
  } catch (error) {
    console.error('[bridge-messages-api] Failed to save:', error)
    return NextResponse.json({ error: 'Failed to save bridge messages' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

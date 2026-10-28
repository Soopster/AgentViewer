import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { AgentProvider } from '@/lib/types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const BRIDGE_MESSAGES_FILE = path.join(DATA_DIR, 'bridge-messages.json')

export type BridgeMessage = {
  provider: AgentProvider
  sessionId: string
  kind: 'sent' | 'reply'
  text: string
  timestamp: string
}

type BridgeMessageStore = Record<string, BridgeMessage[]>

function storeKey(provider: AgentProvider | undefined, sessionId: string): string {
  return `${provider ?? 'claude'}::${sessionId}`
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
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(BRIDGE_MESSAGES_FILE, JSON.stringify(store, null, 2), 'utf8')
  } catch (err) {
    console.error('[bridge-messages-api] Failed to save:', err)
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const provider = searchParams.get('provider') as AgentProvider | undefined
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }
  if (provider && provider !== 'claude') {
    return NextResponse.json({ error: 'The channel bridge is only available for Claude sessions' }, { status: 400 })
  }

  const store = await loadStore()
  const key = storeKey(provider, sessionId)
  const messages = store[key] ?? []

  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>
  const provider = body.provider as AgentProvider | undefined
  const sessionId = body.sessionId as string | undefined
  const kind = body.kind as 'sent' | 'reply' | undefined
  const text = body.text as string | undefined
  const timestamp = body.timestamp as string | undefined

  if (!sessionId || !kind || !text) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (provider && provider !== 'claude') {
    return NextResponse.json({ error: 'The channel bridge is only available for Claude sessions' }, { status: 400 })
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

  return NextResponse.json({ success: true })
}

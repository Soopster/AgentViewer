import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProvider, ProviderInstanceId, SessionInboxState } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INBOX_FILE = path.join(DATA_DIR, 'session-inbox.json')

type InboxFile = { version: 1; states: Record<string, SessionInboxState> }

export function sessionInboxKey(provider: AgentProvider, sessionId: string, providerInstanceId?: ProviderInstanceId): string {
  return `${providerInstanceId ?? provider}:${provider}:${sessionId}`
}

let readPromise: Promise<InboxFile> | null = null
let writeChain: Promise<void> = Promise.resolve()

async function readInboxFile(): Promise<InboxFile> {
  try {
    const parsed = JSON.parse(await readFile(INBOX_FILE, 'utf8')) as Partial<InboxFile>
    if (parsed.version === 1 && parsed.states && typeof parsed.states === 'object') {
      return { version: 1, states: parsed.states as Record<string, SessionInboxState> }
    }
  } catch { /* first run or a partially written optional file */ }
  return { version: 1, states: {} }
}

async function currentInboxFile(): Promise<InboxFile> {
  if (!readPromise) readPromise = readInboxFile()
  return readPromise
}

function queueWrite(file: InboxFile): Promise<void> {
  readPromise = Promise.resolve(file)
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(INBOX_FILE, JSON.stringify(file, null, 2), 'utf8')
  })
  return writeChain
}

export async function readSessionInboxState(
  provider: AgentProvider,
  sessionId: string,
  providerInstanceId?: ProviderInstanceId,
): Promise<SessionInboxState | undefined> {
  const file = await currentInboxFile()
  return file.states[sessionInboxKey(provider, sessionId, providerInstanceId)]
}

export async function readSessionInboxStates(
  sessions: Array<{ provider?: AgentProvider; sessionId: string; providerInstanceId?: ProviderInstanceId }>,
): Promise<Map<string, SessionInboxState>> {
  const file = await currentInboxFile()
  const result = new Map<string, SessionInboxState>()
  for (const session of sessions) {
    const provider = session.provider ?? 'claude'
    const key = sessionInboxKey(provider, session.sessionId, session.providerInstanceId)
    const state = file.states[key]
    if (state) result.set(key, state)
  }
  return result
}

export type SessionInboxAction = 'pin' | 'unpin' | 'settle' | 'reopen' | 'snooze' | 'unsnooze'

export async function updateSessionInboxState(args: {
  provider: AgentProvider
  sessionId: string
  providerInstanceId?: ProviderInstanceId
  action: SessionInboxAction
  snoozedUntil?: number
}): Promise<SessionInboxState> {
  const file = await currentInboxFile()
  const key = sessionInboxKey(args.provider, args.sessionId, args.providerInstanceId)
  const previous = file.states[key] ?? {}
  const now = Date.now()
  let next: SessionInboxState = { ...previous }
  if (args.action === 'pin') next = { ...next, pinnedAt: previous.pinnedAt ?? now, pinOrder: previous.pinOrder ?? now }
  if (args.action === 'unpin') { delete next.pinnedAt; delete next.pinOrder }
  if (args.action === 'settle') { next = { ...next, settledAt: now }; delete next.snoozedUntil }
  if (args.action === 'reopen') { delete next.settledAt; delete next.snoozedUntil }
  if (args.action === 'snooze') {
    const until = Number.isFinite(args.snoozedUntil) ? Math.max(now + 1000, args.snoozedUntil as number) : now + 60 * 60 * 1000
    next = { ...next, snoozedUntil: until }; delete next.settledAt
  }
  if (args.action === 'unsnooze') delete next.snoozedUntil
  if (Object.keys(next).length === 0) delete file.states[key]
  else file.states[key] = next
  await queueWrite(file)
  return next
}

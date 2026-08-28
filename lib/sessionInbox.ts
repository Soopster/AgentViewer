import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProvider, LinkedPullRequest, ProviderInstanceId, SessionInboxState } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INBOX_FILE = path.join(DATA_DIR, 'session-inbox.json')

type InboxFile = {
  version: 1
  states: Record<string, SessionInboxState>
  /** Settle a session when its linked pull request merges. On by default, but
   *  explicitly recorded so it can be turned off — auto-settling work someone
   *  is still looking at is worse than leaving it in the list. */
  autoSettleMergedPrs?: boolean
}

export function sessionInboxKey(provider: AgentProvider, sessionId: string, providerInstanceId?: ProviderInstanceId): string {
  return `${providerInstanceId ?? provider}:${provider}:${sessionId}`
}

let readPromise: Promise<InboxFile> | null = null
let writeChain: Promise<void> = Promise.resolve()

async function readInboxFile(): Promise<InboxFile> {
  try {
    const parsed = JSON.parse(await readFile(INBOX_FILE, 'utf8')) as Partial<InboxFile>
    if (parsed.version === 1 && parsed.states && typeof parsed.states === 'object') {
      return {
        version: 1,
        states: parsed.states as Record<string, SessionInboxState>,
        autoSettleMergedPrs: parsed.autoSettleMergedPrs !== false,
      }
    }
  } catch { /* first run or a partially written optional file */ }
  return { version: 1, states: {}, autoSettleMergedPrs: true }
}

export async function readAutoSettleMergedPrs(): Promise<boolean> {
  return (await currentInboxFile()).autoSettleMergedPrs !== false
}

export async function setAutoSettleMergedPrs(enabled: boolean): Promise<boolean> {
  const file = await currentInboxFile()
  file.autoSettleMergedPrs = enabled
  await queueWrite(file)
  return enabled
}

/** Every session that has a pull request linked, for the background sweep. */
export async function listLinkedPullRequestSessions(): Promise<Array<{
  key: string
  provider: AgentProvider
  sessionId: string
  providerInstanceId?: ProviderInstanceId
  linkedPr: LinkedPullRequest
}>> {
  const file = await currentInboxFile()
  const rows: Array<{ key: string; provider: AgentProvider; sessionId: string; providerInstanceId?: ProviderInstanceId; linkedPr: LinkedPullRequest }> = []
  for (const [key, state] of Object.entries(file.states)) {
    if (!state.linkedPr) continue
    // Key layout is `<instance|provider>:<provider>:<sessionId>`; the session
    // id itself can contain ':' (opencode), so split only the first two.
    const first = key.indexOf(':')
    const second = key.indexOf(':', first + 1)
    if (first === -1 || second === -1) continue
    const instancePart = key.slice(0, first)
    const provider = key.slice(first + 1, second) as AgentProvider
    const sessionId = key.slice(second + 1)
    rows.push({
      key,
      provider,
      sessionId,
      providerInstanceId: instancePart === provider ? undefined : (instancePart as ProviderInstanceId),
      linkedPr: state.linkedPr,
    })
  }
  return rows
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

/** Records what the host says about an already-linked PR, and settles the
 *  session the first time that PR reports as merged.
 *
 *  Settling is one-shot by design: it only fires on the transition into
 *  MERGED, so a user who deliberately reopens a settled session is not
 *  re-settled on the next refresh. Returns whether it settled anything, so
 *  callers can avoid a pointless write. */
export async function recordLinkedPullRequestState(args: {
  provider: AgentProvider
  sessionId: string
  providerInstanceId?: ProviderInstanceId
  state: string
  autoSettle: boolean
}): Promise<{ settled: boolean }> {
  const file = await currentInboxFile()
  const key = sessionInboxKey(args.provider, args.sessionId, args.providerInstanceId)
  const previous = file.states[key]
  if (!previous?.linkedPr) return { settled: false }
  const state = args.state.toUpperCase()
  const wasMerged = previous.linkedPr.state === 'MERGED'
  const next: SessionInboxState = {
    ...previous,
    linkedPr: { ...previous.linkedPr, state, checkedAt: Date.now() },
  }
  const settled = args.autoSettle && state === 'MERGED' && !wasMerged && !previous.settledAt
  if (settled) {
    next.settledAt = Date.now()
    delete next.snoozedUntil
  }
  file.states[key] = next
  await queueWrite(file)
  return { settled }
}

export type SessionInboxAction = 'pin' | 'unpin' | 'settle' | 'reopen' | 'snooze' | 'unsnooze' | 'link-pr' | 'unlink-pr'

export async function updateSessionInboxState(args: {
  provider: AgentProvider
  sessionId: string
  providerInstanceId?: ProviderInstanceId
  action: SessionInboxAction
  snoozedUntil?: number
  linkedPr?: LinkedPullRequest
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
  if (args.action === 'link-pr' && args.linkedPr) next = { ...next, linkedPr: args.linkedPr }
  if (args.action === 'unlink-pr') delete next.linkedPr
  if (Object.keys(next).length === 0) delete file.states[key]
  else file.states[key] = next
  await queueWrite(file)
  return next
}

/**
 * Cross-session messaging for every provider Agent Viewer can run.
 *
 * Claude Code's agent-team messaging gives each session a discoverable name
 * and automatically delivers direct messages. Agent Viewer provides the same
 * useful contract without relying on tmux, Unix sockets, or platform-specific
 * inbox paths: discovery uses provider SDKs, live delivery uses each provider's
 * steering primitive, and idle delivery starts a detached turn that is drained
 * in this process. The same path therefore works on Windows, macOS, and Linux.
 */
import { randomUUID } from 'node:crypto'
import type { AgentProvider, Session } from './types'
import { getRunningSessionInfo, listRunningSessionRefs, steerRunningSessionIdempotent } from './sessionRuntime'

export type AddressableSession = {
  sessionId: string
  provider: AgentProvider
  name: string
  cwd?: string
  title?: string
  running: boolean
}

export type SendCrossSessionMessageResult = {
  delivered: boolean
  mode: 'steered' | 'queued' | 'not_found' | 'error' | 'throttled'
  targetSessionId?: string
  targetProvider?: AgentProvider
  targetName?: string
  error?: string
}

const PROVIDERS: readonly AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']
const RECENT_WINDOW_MS = 6 * 60 * 60 * 1000
const MAX_PER_PROVIDER = 30
const MAX_LISTED = 30
const MAX_MESSAGE_CHARS = 20_000
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 10
const REPEAT_SUPPRESS_MS = 5_000

const rateBySender = new Map<string, { windowStart: number; count: number }>()
const lastMessageBySender = new Map<string, { key: string; at: number }>()

function shortId(sessionId: string): string {
  const compact = sessionId.replace(/[^a-zA-Z0-9]/g, '')
  return (compact || sessionId).slice(0, 6)
}

function folderName(cwd?: string): string | undefined {
  if (!cwd) return undefined
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1]
}

function baseName(session: Pick<Session, 'customTitle' | 'summary' | 'cwd' | 'provider'>): string {
  const title = session.customTitle?.trim() || session.summary?.trim()
  const value = title || folderName(session.cwd) || session.provider || 'session'
  // Names are command-safe on every shell and terminal. Preserve Unicode
  // letters and numbers, but collapse punctuation and whitespace so a title
  // containing a URL or Windows path never becomes an awkward address.
  const safe = value.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '')
  return (safe || session.provider || 'session').slice(0, 40)
}

export function addressableSessionName(session: Pick<Session, 'sessionId' | 'customTitle' | 'summary' | 'cwd' | 'provider'>): string {
  return `${baseName(session)}-${shortId(session.sessionId)}`
}

async function listRecentSessions(): Promise<Session[]> {
  // Keep this import lazy: Claude's integrated MCP server imports this module
  // while sessionBackend itself is still wiring claudePool. A static import
  // here would create a provider-startup cycle.
  const { listViewSessions } = await import('./sessionBackend')
  const results = await Promise.allSettled(PROVIDERS.map((provider) => (
    listViewSessions({ provider, limit: MAX_PER_PROVIDER, offset: 0 })
  )))
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
}

/** Running turns first, followed by sessions active in the last six hours. */
export async function listAddressableSessions(excludeSessionId?: string): Promise<AddressableSession[]> {
  const runningProviders = new Map(listRunningSessionRefs().map((ref) => [ref.sessionId, ref.provider]))
  const recent = await listRecentSessions()
  const byId = new Map<string, AddressableSession>()
  const cutoff = Date.now() - RECENT_WINDOW_MS

  for (const session of recent) {
    if (!session.sessionId || session.sessionId === excludeSessionId || !session.provider) continue
    const running = runningProviders.has(session.sessionId)
    const modified = typeof session.lastModified === 'number' ? session.lastModified : undefined
    if (!running && (!modified || modified < cutoff)) continue
    byId.set(session.sessionId, {
      sessionId: session.sessionId,
      provider: session.provider,
      name: addressableSessionName(session),
      cwd: session.cwd,
      title: session.customTitle || session.summary,
      running,
    })
  }

  // A just-created running session may not have reached durable provider
  // history yet. It is still messageable by a stable session-id-based name.
  for (const [sessionId, provider] of runningProviders) {
    if (sessionId === excludeSessionId || byId.has(sessionId)) continue
    byId.set(sessionId, {
      sessionId,
      provider,
      name: addressableSessionName({ sessionId, provider }),
      running: true,
    })
  }

  return [...byId.values()]
    .sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name))
    .slice(0, MAX_LISTED)
}

/** Best-effort display name for an MCP tool that only knows its own id. */
export async function describeSelf(sessionId: string): Promise<string> {
  const sessions = await listRecentSessions()
  const match = sessions.find((session) => session.sessionId === sessionId)
  return match ? addressableSessionName(match) : `session-${shortId(sessionId)}`
}

function uniqueMatch(sessions: AddressableSession[], predicate: (session: AddressableSession) => boolean): AddressableSession | undefined {
  const matches = sessions.filter(predicate)
  return matches.length === 1 ? matches[0] : undefined
}

/** Exact names/ids always win; fuzzy input is accepted only when unambiguous. */
export function resolveAddressableSession(sessions: AddressableSession[], query: string): AddressableSession | undefined {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return undefined
  return sessions.find((session) => session.sessionId === query)
    ?? sessions.find((session) => session.name.toLowerCase() === normalized)
    ?? uniqueMatch(sessions, (session) => session.name.toLowerCase().startsWith(normalized))
    ?? uniqueMatch(sessions, (session) => session.title?.toLowerCase().includes(normalized) === true)
}

function isThrottled(senderKey: string, toName: string, text: string): boolean {
  const now = Date.now()
  const key = `${toName}\u0000${text}`
  const last = lastMessageBySender.get(senderKey)
  if (last && last.key === key && now - last.at < REPEAT_SUPPRESS_MS) return true
  lastMessageBySender.set(senderKey, { key, at: now })

  const rate = rateBySender.get(senderKey)
  if (!rate || now - rate.windowStart >= RATE_WINDOW_MS) {
    rateBySender.set(senderKey, { windowStart: now, count: 1 })
    return false
  }
  rate.count += 1
  return rate.count > RATE_LIMIT
}

async function drainDetachedTurn(response: Response): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return
  try {
    while (!(await reader.read()).done) {
      // Draining keeps provider resources and session persistence alive. The
      // destination transcript remains the canonical place to read the reply.
    }
  } finally {
    reader.releaseLock()
  }
}

export async function sendCrossSessionMessage(params: {
  fromSessionId?: string
  fromName: string
  toName: string
  text: string
}): Promise<SendCrossSessionMessageResult> {
  const text = params.text.trim()
  if (!text) return { delivered: false, mode: 'error', error: 'Message text is required' }
  if (text.length > MAX_MESSAGE_CHARS) {
    return { delivered: false, mode: 'error', error: `Message exceeds ${MAX_MESSAGE_CHARS.toLocaleString()} characters` }
  }

  const senderKey = params.fromSessionId || `ui:${params.fromName}`
  if (isThrottled(senderKey, params.toName, text)) {
    return { delivered: false, mode: 'throttled', error: 'Too many messages sent recently; the message was dropped to break a possible loop' }
  }

  const sessions = await listAddressableSessions(params.fromSessionId)
  const target = resolveAddressableSession(sessions, params.toName)
  if (!target) return { delivered: false, mode: 'not_found', error: 'No unique addressable session matched that name' }

  const fromName = params.fromName.trim() || (params.fromSessionId ? `session-${shortId(params.fromSessionId)}` : 'Agent Viewer')
  const wrapped = `[Message from session "${fromName}" via Agent Viewer cross-session messaging]\n${text}`
  const running = getRunningSessionInfo(target.sessionId)
  if (running.running && running.canSteer) {
    try {
      const result = await steerRunningSessionIdempotent(target.sessionId, wrapped, undefined, randomUUID())
      if (result.delivered) {
        return {
          delivered: true,
          mode: 'steered',
          targetSessionId: target.sessionId,
          targetProvider: target.provider,
          targetName: target.name,
        }
      }
    } catch (error) {
      // Starting a second turn while the first still owns the session is unsafe.
      if (getRunningSessionInfo(target.sessionId).running) {
        return { delivered: false, mode: 'error', error: error instanceof Error ? error.message : 'The running session rejected the message' }
      }
    }
  } else if (running.running) {
    return { delivered: false, mode: 'error', error: `${target.provider} is busy and cannot accept a message during this operation` }
  }

  try {
    const { streamViewSessionTurn } = await import('./sessionBackend')
    const response = await streamViewSessionTurn({
      sessionId: target.sessionId,
      signal: new AbortController().signal,
      provider: target.provider,
      body: {
        message: wrapped,
        provider: target.provider,
        cwd: target.cwd,
        detachOnClientAbort: true,
      },
    })
    if (!response.ok) {
      return { delivered: false, mode: 'error', error: `Failed to start turn: HTTP ${response.status}` }
    }
    void drainDetachedTurn(response).catch(() => {})
    return {
      delivered: true,
      mode: 'queued',
      targetSessionId: target.sessionId,
      targetProvider: target.provider,
      targetName: target.name,
    }
  } catch (error) {
    return { delivered: false, mode: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

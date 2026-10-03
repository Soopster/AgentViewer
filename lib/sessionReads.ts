// The read half of the session router.
//
// Every read/metadata op — list, session info, title/tag, delete, transcript
// window, subagents, models, composer options, slash commands, diagnostics —
// routes through a `SessionAdapter` (lib/adapters/types.ts). This module owns
// that routing plus the shared work each read ends with: provider-instance
// provenance, inbox ordering, and the search-index mirror. Adapters return only
// their provider's own data.
//
// **It exists as its own module for memory** (load-bearing). These routers used
// to live in lib/sessionBackend.ts, whose other half is the send path — every
// provider's client, harness, and SDK. Reading a session therefore evaluated
// the machinery for sending one: ~72MB of physical footprint against ~16MB for
// the read path's own dependencies. That mattered twice over in the TUI, whose
// transcript Worker is a separate JS VM that only ever reads and was paying the
// send path's cost in full, on top of the main isolate's copy.
//
// So: **nothing here may import lib/sessionBackend.ts, any provider client, or
// any provider SDK.** Adapters load on demand (lib/adapters/registry.ts), so a
// process materializes only the providers it actually talks to. sessionBackend
// re-exports everything below, so its own callers are unaffected.

// Type-only, so it is erased at runtime and does not put a provider SDK back
// into this module's graph — the whole point of the file.
import type { ContextTier as CopilotContextTier } from '@github/copilot-sdk'
import type {
  AgentProvider,
  ContextUsage,
  Session,
  SessionComposerOptions,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
  SubagentSummary,
} from './types'
import type { MessageListParams, SessionMessageWindow } from './adapters/types'
import { getSessionAdapter, unsupported } from './adapters/registry'
import { PROVIDER_MANAGED_PERMISSION_OPTIONS } from './adapters/shared'
import { getConfiguredProvider } from './providerState'
import {
  currentProviderInstanceId,
  listProviderInstances,
  resolveProviderInstance,
  withProviderInstance,
  type ProviderInstance,
} from './providerInstances'
import { readSessionInboxStates } from './sessionInbox'
import {
  removePersistedSession,
  syncPersistedSessionMessages,
  syncPersistedSessions,
} from './sessionPersistence'
import { timeAsync } from './perfLog'
import { withTimeout } from './withTimeout'
import { PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS } from './providerWarmup'

export type ListParams = {
  limit: number
  offset: number
  dir?: string
  includeWorktrees?: boolean
  provider?: AgentProvider | 'all'
  providerInstanceId?: string
}

export type ViewSessionModels = {
  models: SessionModelInfo[]
  currentModel: string | null
  currentContextTier?: CopilotContextTier | null
  contextUsage: ContextUsage | null
}

export async function resolveProvider(provider?: AgentProvider): Promise<AgentProvider> {
  const resolved = provider ?? await getConfiguredProvider()
  if (resolved === 'all') {
    throw new Error('provider is required when all providers are active')
  }
  return resolved
}

// ── Transcript windowing ─────────────────────────────────────────────────────

function tailWindow(messages: SessionMessage[], limit: number, replace: boolean): SessionMessageWindow {
  const total = messages.length
  const offset = Math.max(total - limit, 0)
  return { offset, total, messages: messages.slice(offset), ...(replace ? { replace: true } : {}) }
}

export function windowForParams(messages: SessionMessage[], params: MessageListParams): SessionMessageWindow {
  const total = messages.length
  if (params.tail) return tailWindow(messages, params.limit, false)
  const offset = Math.max(params.offset, 0)
  // A caller that names the uuid it expects at `offset` is asking us to prove
  // its cursor still means what it meant. If the transcript was rewritten
  // underneath it, hand back a replace-tail rather than a window it would
  // merge into the wrong place. See MessageListParams.expectUuid.
  if (params.expectUuid && offset < total && messages[offset]?.uuid !== params.expectUuid) {
    return tailWindow(messages, params.limit, true)
  }
  return { offset, total, messages: messages.slice(offset, offset + params.limit) }
}

// ── Search-index mirroring ───────────────────────────────────────────────────

// Session list polling usually returns the same metadata every few seconds.
// Avoid opening the SQLite index for identical pages while keeping the cache
// brief enough that different views still refresh opportunistically.
const SESSION_LIST_PERSIST_TTL = 30_000
type SessionListPersistCacheEntry = { signature: string; ts: number }
const persistedSessionListSignatures = new Map<string, SessionListPersistCacheEntry>()

function prunePersistedSessionListSignatures() {
  const deadline = Date.now() - SESSION_LIST_PERSIST_TTL * 3
  for (const [key, entry] of persistedSessionListSignatures) {
    if (entry.ts < deadline) persistedSessionListSignatures.delete(key)
  }
}

function sessionsPersistSignature(sessions: Session[]): string {
  return JSON.stringify(sessions.map((session) => [
    session.provider ?? 'claude',
    session.sessionId,
    session.summary ?? '',
    session.customTitle ?? '',
    session.firstPrompt ?? '',
    session.cwd ?? '',
    session.tag ?? '',
    session.createdAt ?? '',
    session.lastModified ?? '',
  ]))
}

async function syncSessionsBestEffort(sessions: Session[]): Promise<void> {
  if (sessions.length === 0) return

  const listKey = sessions.map((session) => `${session.providerInstanceId ?? session.provider ?? 'claude'}:${session.sessionId}`).join('|')
  const signature = sessionsPersistSignature(sessions)
  const cached = persistedSessionListSignatures.get(listKey)
  if (cached && cached.signature === signature && Date.now() - cached.ts < SESSION_LIST_PERSIST_TTL) return

  try {
    await syncPersistedSessions(sessions)
    prunePersistedSessionListSignatures()
    persistedSessionListSignatures.set(listKey, { signature, ts: Date.now() })
  } catch {
    // The viewer should keep working if the local analytics index is unreadable.
  }
}

// Tracks the last signature we successfully persisted for each session, so that
// repeated polls (SSE pump @ 1.5 s, GET fallback @ 2 s) don't open a SQLite write
// transaction every tick when nothing has actually changed.
// LRU-capped: a long-running dev server mints a fresh session id on every
// `claude`/`codex` invocation, so an uncapped map grows one entry per distinct
// session forever (a slow but unbounded leak on idle long-open tabs). The cap is
// far above the working set; evicting a cold session just costs one redundant
// no-op re-sync the next time it's polled.
const PERSISTED_MESSAGES_SIGNATURE_MAX = 512
const persistedMessagesSignature = new Map<string, string>()

function rememberPersistedMessagesSignature(key: string, signature: string): void {
  if (persistedMessagesSignature.has(key)) persistedMessagesSignature.delete(key)
  persistedMessagesSignature.set(key, signature)
  while (persistedMessagesSignature.size > PERSISTED_MESSAGES_SIGNATURE_MAX) {
    const oldest = persistedMessagesSignature.keys().next().value
    if (oldest === undefined) break
    persistedMessagesSignature.delete(oldest)
  }
}

function messagesPersistSignature(messages: SessionMessage[]): string {
  if (messages.length === 0) return '0::'
  const last = messages[messages.length - 1]
  return `${messages.length}:${last.uuid ?? ''}:${last.timestamp ?? ''}`
}

async function syncMessagesBestEffort(
  provider: AgentProvider,
  sessionId: string,
  messages: SessionMessage[],
): Promise<void> {
  const key = `${currentProviderInstanceId(provider)}:${provider}:${sessionId}`
  const durableMessages = messages.filter((message) => message.ephemeral !== true)
  const signature = messagesPersistSignature(durableMessages)
  if (persistedMessagesSignature.get(key) === signature) {
    // Refresh LRU recency so an actively-polled (but unchanged) session isn't
    // evicted by a burst of newly-created session ids.
    rememberPersistedMessagesSignature(key, signature)
    return
  }
  try {
    await syncPersistedSessionMessages(provider, sessionId, durableMessages)
    rememberPersistedMessagesSignature(key, signature)
  } catch {
    // Persistence is opportunistic and must not break live provider reads.
  }
}

export async function removePersistedSessionBestEffort(provider: AgentProvider, sessionId: string, providerInstanceId?: string): Promise<void> {
  try {
    await removePersistedSession(provider, sessionId, providerInstanceId)
  } catch {
    // Local index cleanup is opportunistic and should not mask provider deletes.
  }
}

/** Drop the list-signature cache. The index rebuild clears the SQLite mirror
 *  out from under it, so every cached "already persisted this page" answer is
 *  stale by definition. */
export function clearPersistedSessionListSignatures(): void {
  persistedSessionListSignatures.clear()
}

/** Sizes of the two write-avoidance caches, for the memory diagnostics readout. */
export function persistSignatureCacheDiagnostics(): { messages: number; sessionLists: number } {
  return {
    messages: persistedMessagesSignature.size,
    sessionLists: persistedSessionListSignatures.size,
  }
}

// ── Provider-instance provenance ─────────────────────────────────────────────

export function applyProviderInstance<T extends Session | SessionMessage | SessionInfo>(
  value: T,
  instance: ProviderInstance,
): T {
  return {
    ...value,
    provider: instance.provider,
    providerInstanceId: instance.id,
    providerDisplayName: instance.displayName,
    ...(instance.accentColor ? { providerAccentColor: instance.accentColor } : {}),
  }
}

// Provider adapters deliberately cache their normalized SessionMessage object
// graphs. Adding provider-instance provenance with an unconditional object
// spread discarded that identity on every poll, forcing downstream threading
// and virtual-row caches to redo work even when the transcript was unchanged.
// Cache one lightweight variant per raw message+instance without mutating the
// adapter-owned object (Claude/Codex instances can legitimately share ids).
const providerInstanceMessageVariants = new WeakMap<SessionMessage, Map<string, SessionMessage>>()
function messageForProviderInstance(message: SessionMessage, instanceId: string): SessionMessage {
  if (message.providerInstanceId === instanceId) return message
  let variants = providerInstanceMessageVariants.get(message)
  if (!variants) {
    variants = new Map<string, SessionMessage>()
    providerInstanceMessageVariants.set(message, variants)
  }
  const cached = variants.get(instanceId)
  if (cached) return cached
  const marked = { ...message, providerInstanceId: instanceId }
  variants.set(instanceId, marked)
  return marked
}

async function applyInboxStates(sessions: Session[]): Promise<Session[]> {
  const states = await readSessionInboxStates(sessions)
  const decorated = sessions.map((session) => {
    const provider = session.provider ?? 'claude'
    const key = `${session.providerInstanceId ?? provider}:${provider}:${session.sessionId}`
    const inbox = states.get(key)
    if (!inbox) return session
    // Snoozes expire naturally; keep the persisted state so the next explicit
    // snooze can still be audited, but expose only currently active snoozes.
    return inbox.snoozedUntil && inbox.snoozedUntil <= Date.now()
      ? { ...session, inbox: { ...inbox, snoozedUntil: undefined } }
      : { ...session, inbox }
  })
  return decorated
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      const rank = (session: Session) => {
        if (session.inbox?.pinnedAt) return 0
        if (session.inbox?.snoozedUntil && session.inbox.snoozedUntil > Date.now()) return 2
        if (session.inbox?.settledAt) return 3
        return 1
      }
      const rankDiff = rank(a.session) - rank(b.session)
      if (rankDiff !== 0) return rankDiff
      if (rank(a.session) === 0) return (a.session.inbox?.pinOrder ?? 0) - (b.session.inbox?.pinOrder ?? 0)
      return a.index - b.index
    })
    .map(({ session }) => session)
}

// ── Read routers ─────────────────────────────────────────────────────────────

export function listViewSessions(params: ListParams): Promise<Session[]> {
  return timeAsync('listViewSessions', () => listViewSessionsImpl(params))
}

async function listViewSessionsImpl(params: ListParams): Promise<Session[]> {
  const provider = params.provider ?? await getConfiguredProvider()

  // Every listing ends the same way — stamp instance identity, apply inbox
  // ordering, mirror into the search index — so that tail lives here once
  // instead of in each adapter.
  const finish = async (sessions: Session[]): Promise<Session[]> => {
    const decorated = await applyInboxStates(sessions)
    await syncSessionsBestEffort(decorated)
    return decorated
  }

  if (provider === 'all') {
    const combinedLimit = params.limit + params.offset
    // ACP sessions are transient and unlistable, so they cannot contribute to
    // an aggregated view; excluding them here keeps the fan-out honest rather
    // than relying on each adapter to return nothing.
    const instances = (await listProviderInstances()).filter((instance) =>
      instance.provider !== 'claude-acp' && instance.provider !== 'codex-acp'
    )
    const pages = await Promise.all(instances.map((instance) => withProviderInstance(
      instance.id,
      instance.provider,
      async () => {
        const adapter = await getSessionAdapter(instance.provider)
        if (!adapter.listSessions) return []
        const page = await adapter.listSessions({
          ...params,
          provider: instance.provider,
          providerInstanceId: instance.id,
          limit: combinedLimit,
          offset: 0,
        })
        return page.map((session) => applyProviderInstance(session, instance))
      },
    )))
    const merged = pages.flat()
      .sort((a, b) => {
        const aTime = Number(a.lastModified ?? a.createdAt ?? 0)
        const bTime = Number(b.lastModified ?? b.createdAt ?? 0)
        return bTime - aTime
      })
      .slice(params.offset, params.offset + params.limit)
    return finish(merged)
  }

  const instance = await resolveProviderInstance(params.providerInstanceId, provider)
  if (currentProviderInstanceId(provider) !== instance.id) {
    return withProviderInstance(instance.id, provider, () => listViewSessionsImpl({
      ...params,
      provider,
      providerInstanceId: instance.id,
    }))
  }

  const adapter = await getSessionAdapter(provider)
  if (!adapter.listSessions) return []
  const page = await adapter.listSessions(params)
  return finish(page.map((session) => applyProviderInstance(session, instance)))
}

export async function readViewSessionInfo(sessionId: string, providerOverride?: AgentProvider): Promise<SessionInfo | null> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if (!adapter.readSessionInfo) return null
  return adapter.readSessionInfo(sessionId)
}

export async function patchViewSession(sessionId: string, body: Record<string, unknown>, providerOverride?: AgentProvider): Promise<void> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if ('title' in body) {
    if (body.title !== null && body.title !== undefined && typeof body.title !== 'string') {
      throw new Error('title must be a string')
    }
    if (!adapter.setTitle) unsupported(provider, 'setTitle')
    await adapter.setTitle(sessionId, (body.title as string | null | undefined) ?? null)
    return
  }
  if ('tag' in body) {
    if (body.tag !== null && body.tag !== undefined && typeof body.tag !== 'string') {
      throw new Error('tag must be a string or null')
    }
    if (!adapter.setTag) unsupported(provider, 'setTag')
    await adapter.setTag(sessionId, (body.tag as string | null | undefined) ?? null)
    return
  }
  throw new Error('title or tag required')
}

export async function deleteViewSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if (!adapter.deleteSession) unsupported(provider, 'deleteSession')
  await adapter.deleteSession(sessionId)
  // Index removal is the router's job: every provider that can delete needs it,
  // and an adapter that forgot would leave the session searchable forever.
  await removePersistedSessionBestEffort(provider, sessionId, currentProviderInstanceId(provider))
}

export function listViewSessionMessageWindow(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessageWindow> {
  return timeAsync('listViewSessionMessageWindow', () => listViewSessionMessageWindowImpl(sessionId, params, providerOverride))
}

async function listViewSessionMessageWindowImpl(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessageWindow> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if (!adapter.readAllMessages) unsupported(provider, 'readAllMessages')
  const { messages: raw, externalWriter } = await adapter.readAllMessages(sessionId)
  const instanceId = currentProviderInstanceId(provider)
  const messages = raw.map((message) => messageForProviderInstance(message, instanceId))
  await syncMessagesBestEffort(provider, sessionId, messages)
  const window = windowForParams(messages, params)
  return externalWriter ? { ...window, externalWriter: true } : window
}

export async function listViewSessionMessages(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessage[]> {
  const { messages } = await listViewSessionMessageWindow(sessionId, params, providerOverride)
  return messages
}

export async function getViewSubagentMessages(
  sessionId: string,
  agentId: string,
  providerOverride?: AgentProvider,
): Promise<SessionMessage[]> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  // A provider without subagents genuinely has none — empty is the answer, not
  // a failure to look.
  if (!adapter.readSubagentMessages) return []
  return adapter.readSubagentMessages(sessionId, agentId)
}

/**
 * Lightweight per-subagent summary (message count + aggregate token usage,
 * not full content) for sidebar nesting. Claude subagents aren't real
 * top-level sessions, so this is how the sidebar learns they exist at all.
 */
export async function getClaudeSubagentSummaries(sessionId: string, providerOverride?: AgentProvider): Promise<SubagentSummary[]> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if (!adapter.readSubagentSummaries) return []
  return adapter.readSubagentSummaries(sessionId)
}

// Model discovery is read-only but can be one of the slowest control-plane
// calls on custom endpoints. Share concurrent web/TUI reads for the same
// provider session so a cold catalog/auth handshake happens once, and bound it
// with the explicit-model allowance so a dead endpoint cannot leave the
// composer in `modelsLoading` forever.
const sessionModelReadsInFlight = new Map<string, Promise<ViewSessionModels>>()

export async function readViewSessionModels(sessionId: string, providerOverride?: AgentProvider): Promise<ViewSessionModels> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  // A provider with no model-listing RPC (ACP) degrades the picker to "no
  // choices" rather than failing the whole session view around it.
  if (!adapter.readModels) return { models: [], currentModel: null, contextUsage: null }
  const key = `${currentProviderInstanceId(provider)}:${provider}:${sessionId}`
  const existing = sessionModelReadsInFlight.get(key)
  if (existing) return existing
  const read = withTimeout(
    adapter.readModels(sessionId),
    PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
    `${provider} model discovery`,
  )
  sessionModelReadsInFlight.set(key, read)
  try {
    return await read
  } finally {
    if (sessionModelReadsInFlight.get(key) === read) sessionModelReadsInFlight.delete(key)
  }
}

export async function readViewSessionComposerOptions(sessionId: string, providerOverride?: AgentProvider): Promise<SessionComposerOptions> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  // The default is the honest answer for a provider whose CLI owns its own
  // approval policy and exposes no knob for us to drive.
  if (!adapter.readComposerOptions) {
    return {
      permissionModes: PROVIDER_MANAGED_PERMISSION_OPTIONS,
      currentPermissionMode: 'native',
    }
  }
  return adapter.readComposerOptions(sessionId)
}

export async function readViewSessionSlashCommands(sessionId: string, providerOverride?: AgentProvider): Promise<Array<{ command: string; description: string; argumentHint?: string }>> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if (!adapter.readSlashCommands) return []
  return adapter.readSlashCommands(sessionId)
}

export async function readViewSessionDiagnostics(sessionId: string, providerOverride?: AgentProvider): Promise<{ sections: SessionDiagnosticSection[]; currentModel: string | null }> {
  const provider = await resolveProvider(providerOverride)
  const adapter = await getSessionAdapter(provider)
  if (!adapter.readDiagnostics) unsupported(provider, 'readDiagnostics')
  return adapter.readDiagnostics(sessionId)
}

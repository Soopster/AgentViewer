import { NextResponse } from 'next/server'

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
import { readFile } from 'node:fs/promises'
import { basename, extname, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  deleteSession as deleteClaudeSession,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
  listSessions,
  query,
  renameSession,
  resolveSettings,
  tagSession,
  type CanUseTool,
  type ElicitationResult as ClaudeElicitationResult,
  type OnUserDialog,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  acquireClaudeSession,
  adoptClaudeSession,
  type ClaudeBridgeBox,
  type ClaudeElicitationHandler,
  type ClaudePoolEntry,
  claudePoolSize,
  CLAUDE_QUERY_ENV,
  claudeIntegratedQueryExtensions,
  claudeIntegratedMcpServers,
  createInputStream,
  effortToSdk,
  interruptClaudeQuery,
  logClaudeSubprocessStderr,
  peekClaudeSession,
  queueClaudeReadStateSeeds,
  recycleClaudeSession,
} from './claudePool'
import {
  claudeDynamicMcpServerNames,
  clearClaudeDynamicMcpServers,
  getClaudeDynamicMcpServers,
  parseClaudeDynamicMcpServers,
  setClaudeDynamicMcpServers,
} from './claudeDynamicMcp'
import { deleteClaudeHookEvents, listClaudeHookEvents } from './claudeHookEvents'
import {
  broadcastClaudeMessage,
  broadcastClaudeRecycled,
  broadcastClaudeTurnEnd,
  broadcastClaudeTurnStart,
} from './claudeHarness'
import { getClaudeCommandsOverride, noteClaudeCommandsChanged } from './claudeCommandsStore'
import { claudeAgentPolicyOptions, claudeQueryBudgetOptions, parseClaudeAgentPolicy, type ClaudeAgentPolicy } from './claudeRuntimePolicy'
import { claudeSessionPersistenceQueryOptions, claudeSessionStoreOptions } from './claudeSessionStore'
import { claudeProcessSpawnOptions, claudeProcessTransportStatus } from './claudeProcessSpawner'
import { dispatchCoordinatorCodexToolCall } from './agentCoordinationSdkTools'
import {
  broadcastLiveSessionActivity,
  broadcastLiveSessionRecycled,
  broadcastLiveSessionTurnEnd,
  broadcastLiveSessionTurnStart,
} from './liveSessionHarness'
import type { ContentBlockParam as ClaudeContentBlockParam } from '@anthropic-ai/sdk/resources'
import {
  approveAll,
  type ContextTier as CopilotContextTier,
  type GetAuthStatusResponse as CopilotGetAuthStatusResponse,
  type GetStatusResponse as CopilotGetStatusResponse,
  type MessageOptions as CopilotMessageOptions,
  type ModelInfo as CopilotModelInfo,
  type PermissionRequest as CopilotPermissionRequest,
  type PermissionRequestResult as CopilotPermissionRequestResult,
  type ElicitationContext as CopilotElicitationContext,
  type ElicitationResult as CopilotElicitationResult,
  type SessionEvent as CopilotSessionEvent,
  type SessionMetadata as CopilotSessionMetadata,
} from '@github/copilot-sdk'
import { backgroundRunningSession, clearRunningSession, clearWaitingSession, getRunningSession, getRunningSessionInfo, getSessionRuntimeDiagnostics, interruptRunningSession, listRunningSessionRefs, listWaitingSessions, setRunningSession, steerRunningSessionIdempotent } from './sessionRuntime'
import {
  acpPendingRequests,
  acquireAcpSession,
  closeAcpSession,
  declineAcpElicitation,
  interruptAcpSession,
  isAcpSessionAlive,
  peekAcpSession,
  readAcpMessagesSince,
  resolveAcpElicitation,
  respondAcpPermissionDecision,
  sendAcpPrompt,
} from './acpClientPool'
import { mapAcpBufferedMessages } from './acpMapper'
import { listViewerAttention } from './viewerAttention'
import { createTurnCheckpoint } from './checkpoints'
import { isNativeComposerCommandText } from './composerCommands'
import { buildCodexComposerInput } from './codexComposerInput'
import {
  appendPortableComposerContext,
  assertComposerAttachmentsSupported,
  planComposerAttachments,
  resolveLocalComposerAttachmentPath,
} from './composerAttachments'
import { getProviderCapabilities } from './provider'
import { getConfiguredProvider } from './providerState'
import type {
  AgentProvider,
  ContextUsage,
  Session,
  SessionComposerAgentOption,
  SessionComposerOptions,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
  SendAttachment,
  ReasoningEffortLevel,
  SubagentSummary,
} from './types'

type CopilotReasoningEffort = Extract<ReasoningEffortLevel, 'low' | 'medium' | 'high' | 'xhigh'>

import { consumeReadModelsWarmQuery, createSessionControlQuery, openPrompt } from './sdkControlQuery'
import { acquireCopilotSession, copilotIntegrationDiagnostics, copilotPoolSize, copilotSessionConfigOverrides, evictCopilotSession, getCopilotClient, setCopilotElicitationHandler, setCopilotPermissionHandler, steerCopilotSession } from './copilotClient'
import { timeAsync } from './perfLog'
import { registerDiagnosticsReporter } from './runtimeDiagnostics'
import {
  deriveCopilotState,
  mapCopilotDiagnosticsToSections,
  mapCopilotEventsToSessionMessages,
  mapCopilotModelsToSessionModels,
  mapCopilotSessionToInfo,
  mapCopilotSessionToSession,
  mapCopilotUsageToContextUsage,
} from './copilotMapper'
import {
  getCopilotStoredMetadata,
  getCopilotStoredMetadataForSessions,
  setCopilotStoredTag,
  setCopilotStoredTitle,
} from './copilotMetadata'
import { getCodexClient } from './codexClient'
import { compactStableFingerprint } from './compactFingerprint'
import type {
  CodexNotification,
  CodexRequestParams,
  CodexResponseFor,
  CodexKnownServerRequest,
  CodexServerRequest,
  CodexThread,
  CodexThreadResumeResponse,
  CodexThreadTokenUsage,
} from './codexProtocol'
import type {
  DynamicToolSpec,
  ErrorNotification,
  ThreadStatusChangedNotification,
  ThreadTokenUsageUpdatedNotification,
  TurnCompletedNotification,
  TurnStartedNotification,
} from './codex-schema/v2'
import {
  advanceCodexTurnOutputUsage,
  mapCodexDiagnosticsToSections,
  mapCodexModelsToSessionModels,
  mapCodexThreadToMessages,
  mapCodexThreadToSession,
  mapCodexThreadToSessionInfo,
  mapCodexTokenUsageToContextUsage,
} from './codexMapper'
import { getCodexStoredTag, getCodexStoredTagsForSessions, setCodexStoredTag } from './codexTags'
import { getOpenCodeClient, getOpenCodeV2Client } from './opencodeClient'
import { getOpenCodeProjectDiagnostics, getOpenCodeSessionSnapshot, subscribeToOpenCodeEvents } from './opencodeHarness'
import { getCodexProjectDiagnostics, subscribeToCodexEvents } from './codexHarness'
import {
  currentOpenCodeModelValue,
  decodeOpenCodeModelValue,
  firstOpenCodePrompt,
  mapOpenCodeContextUsage,
  mapOpenCodeDiagnosticsToSections,
  mapOpenCodeMessagesToSessionMessages,
  mapOpenCodeModelsToSessionModels,
  mapOpenCodeSessionToInfo,
  mapOpenCodeSessionToSession,
  summarizeOpenCodeDiffs,
  updateOpenCodeTurnOutputUsage,
} from './opencodeMapper'
import { getOpenCodeStoredTag, getOpenCodeStoredTagsForSessions, setOpenCodeStoredTag } from './opencodeTags'
import type {
  Agent as OpenCodeAgent,
  Command as OpenCodeCommand,
  ConfigProvidersResponse as OpenCodeConfigProvidersResponse,
  Event as OpenCodeEvent,
  FileDiff as OpenCodeFileDiff,
  AgentPartInput as OpenCodeAgentPartInput,
  FilePartInput as OpenCodeFilePartInput,
  FormatterStatus as OpenCodeFormatterStatus,
  LspStatus as OpenCodeLspStatus,
  McpStatus as OpenCodeMcpStatus,
  Message as OpenCodeMessage,
  Part as OpenCodePart,
  Session as OpenCodeSession,
  TextPartInput as OpenCodeTextPartInput,
} from '@opencode-ai/sdk'
import type { QuestionRequest as OpenCodeQuestionRequest } from '@opencode-ai/sdk/v2'
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import { normalizeProjectPath, sameProjectPath } from './projectPaths'
import {
  beginPiSessionOperation,
  compactPiSession,
  createPiAgentSession,
  deletePiSession,
  evictPiAgentSession,
  forkPiSession,
  getPiSessionEntries,
  getPiSessionMessages,
  listPiSessions,
  openPiAgentSession,
  piPoolSize,
  piSessionEntryCacheDiagnostics,
  piSessionOperationCount,
  refreshPiSessionCache,
  setPiSessionName,
} from './piClient'
import {
  cancelPendingPiUiRequests,
  createPiUiBridge,
  ensurePiExtensionUiBound,
  installPiUiHandler,
  listPendingPiUiPayloads,
  pendingPiUiRequestCount,
  respondPiUiPermission,
  respondPiUiQuestion,
  type PiUiHandler,
} from './piExtensionUi'
import {
  mapPiDiagnosticsToSections,
  mapPiEntriesToSessionMessages,
  mapPiMessagesToSessionMessages,
  mapPiModelsToSessionModels,
  piAgentMessageDuplicateKey,
  piAgentMessageFingerprint,
  mapPiSessionToInfo,
  mapPiSessionToSession,
  currentPiModelValue,
  decodePiModelValue,
} from './piMapper'
import { reducePiTurnLifecycle } from './piTurnLifecycle'
import {
  getPiStoredMetadata,
  getPiStoredMetadataForSessions,
  setPiStoredTag,
  setPiStoredTitle,
} from './piMetadata'
import {
  appendLmstudioTurn,
  createLmstudioSession,
  deleteLmstudioSession,
  getLmstudioSession,
  listLmstudioModels,
  listLmstudioSessions,
  lmstudioBaseUrl,
  patchLmstudioSession,
  streamLmstudioChatCompletion,
} from './lmstudioClient'
import {
  mapLmstudioSessionToInfo,
  mapLmstudioSessionToMessages,
  mapLmstudioSessionToSession,
} from './lmstudioMapper'
import { normalizeClaudeHistoryMessages } from './claudeMapper'
import {
  clearPersistedSessionIndex,
  readPersistedIndexStats,
  removePersistedSession,
  syncPersistedSessionMessages,
  syncPersistedSessions,
  type PersistedIndexStats,
} from './sessionPersistence'

// Only meaningful when deployed as a Vercel serverless/edge function (ignored
// by the self-hosted `npm run start` Node server this app normally runs as).
// Set generously so a Claude turn that legitimately runs long — a big test
// suite, a multi-file refactor — isn't truncated mid-stream on that platform.
export const maxDuration = 3600

// Session info rarely changes between polls — cache for 20 s to avoid repeating
// filesystem I/O on every 5-second session list refresh. Bounded by LRU so the
// long-lived dev server cannot accumulate entries for every session ever listed.
//
// The cap MUST stay >= the session-list limit (500): listClaudeSessions calls
// getCachedSessionInfo for every listed session, so a cap below the list size
// thrashes the LRU and every poll re-reads the overflow from disk. With 128 and
// a 300+ session corpus, ~60% of sessions missed the cache on every 5 s poll,
// making listViewSessions ~300ms (measured). 640 covers the 500 limit with
// headroom; entries are small metadata records, so the memory cost is ~1 MB.
const SESSION_INFO_TTL = 20_000
const SESSION_INFO_CACHE_MAX = 640
type SessionInfoCacheEntry = { result: Awaited<ReturnType<typeof getSessionInfo>>; ts: number }
const sessionInfoCache = new Map<string, SessionInfoCacheEntry>()

function pruneSessionInfoCache() {
  const deadline = Date.now() - SESSION_INFO_TTL * 3
  for (const [key, entry] of sessionInfoCache) {
    if (entry.ts < deadline) sessionInfoCache.delete(key)
  }
}

function touchSessionInfoCache(sessionId: string, entry: SessionInfoCacheEntry): void {
  if (sessionInfoCache.has(sessionId)) sessionInfoCache.delete(sessionId)
  sessionInfoCache.set(sessionId, entry)
  while (sessionInfoCache.size > SESSION_INFO_CACHE_MAX) {
    const oldest = sessionInfoCache.keys().next().value
    if (oldest === undefined) break
    sessionInfoCache.delete(oldest)
  }
}

async function getCachedSessionInfo(sessionId: string, dir: string | undefined): Promise<Awaited<ReturnType<typeof getSessionInfo>>> {
  const cached = sessionInfoCache.get(sessionId)
  if (cached && Date.now() - cached.ts < SESSION_INFO_TTL) {
    touchSessionInfoCache(sessionId, cached)
    return cached.result
  }
  const result = await getSessionInfo(sessionId, {
    ...(dir ? { dir } : {}),
    ...claudeSessionStoreOptions(),
  })
  touchSessionInfoCache(sessionId, { result, ts: Date.now() })
  return result
}

// Per-session cache of mapped+sorted messages. Lets idle polls skip the
// normalize/dedup/sort pipeline when the underlying transcript is unchanged.
// Each call computes a cheap raw signature; on match we return the cached
// array (slice happens at the call site). On mismatch we re-map and store.
// LRU-capped because each entry holds a fully normalized message array — a
// large session can be MBs (base64 images included), so this cache is the
// single largest deliberate server retainer. 4 keeps the active session (LRU
// touch on every poll) plus a few recently viewed ones resident; anything
// beyond that re-maps once on revisit instead of pinning MBs indefinitely.
const MAPPED_MESSAGE_TTL = 60_000
const MAPPED_MESSAGE_CACHE_MAX = 4
type MappedMessageCacheEntry = {
  signature: string
  messages: SessionMessage[]
  ts: number
}
const mappedMessageCache = new Map<string, MappedMessageCacheEntry>()

function pruneMappedMessageCache() {
  const deadline = Date.now() - MAPPED_MESSAGE_TTL * 3
  for (const [key, entry] of mappedMessageCache) {
    if (entry.ts < deadline) mappedMessageCache.delete(key)
  }
}

function readMappedMessagesCache(key: string, signature: string): SessionMessage[] | null {
  const cached = mappedMessageCache.get(key)
  if (cached && cached.signature === signature) {
    cached.ts = Date.now()
    // Touch LRU order so the active session stays resident under cap.
    mappedMessageCache.delete(key)
    mappedMessageCache.set(key, cached)
    return cached.messages
  }
  return null
}

function readLatestMappedMessagesCache(key: string): SessionMessage[] | null {
  const cached = mappedMessageCache.get(key)
  if (!cached) return null
  cached.ts = Date.now()
  mappedMessageCache.delete(key)
  mappedMessageCache.set(key, cached)
  return cached.messages
}

function writeMappedMessagesCache(key: string, signature: string, messages: SessionMessage[]): SessionMessage[] {
  pruneMappedMessageCache()
  if (mappedMessageCache.has(key)) mappedMessageCache.delete(key)
  mappedMessageCache.set(key, { signature, messages, ts: Date.now() })
  while (mappedMessageCache.size > MAPPED_MESSAGE_CACHE_MAX) {
    const oldest = mappedMessageCache.keys().next().value
    if (oldest === undefined) break
    mappedMessageCache.delete(oldest)
  }
  return messages
}

function windowForParams(messages: SessionMessage[], params: MessageListParams): SessionMessageWindow {
  const total = messages.length
  if (params.tail) {
    const offset = Math.max(total - params.limit, 0)
    return { offset, total, messages: messages.slice(offset) }
  }
  const offset = Math.max(params.offset, 0)
  return { offset, total, messages: messages.slice(offset, offset + params.limit) }
}

const OPENCODE_OPTIONS = {
  responseStyle: 'data' as const,
  throwOnError: true as const,
}

// OpenCode streams complete on a `session.idle` event. If that event is dropped
// (e.g. the shared harness subscription reconnects across a heartbeat gap), the
// consume loop would otherwise wait forever. After this much total silence the
// watchdog probes session.status to confirm the turn really finished.
const OPENCODE_WATCHDOG_IDLE_MS = 30000
const CODEX_WATCHDOG_IDLE_MS = 30000
const COPILOT_TURN_INACTIVITY_MS = 300_000

function openCodeData<T>(response: T | { data: T }): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data
  }
  return response as T
}

type ListParams = {
  limit: number
  offset: number
  dir?: string
  includeWorktrees?: boolean
  provider?: AgentProvider | 'all'
}

type MessageListParams = {
  limit: number
  offset: number
  tail?: boolean
}

export type SessionMessageWindow = {
  offset: number
  total: number
  messages: SessionMessage[]
}

type ProjectMessageBatchParams = {
  dir: string
  includeWorktrees: boolean
  provider?: AgentProvider | 'all'
  offsets: Record<string, number>
  initialLimit: number
  incrementalLimit: number
}

type SendMessageParams = {
  sessionId: string
  signal: AbortSignal
  body: Record<string, unknown>
  provider?: AgentProvider
}

type ForkParams = {
  sessionId: string
  body: Record<string, unknown>
  provider?: AgentProvider
}

type RewindParams = {
  sessionId: string
  body: Record<string, unknown>
  provider?: AgentProvider
}

type SessionActionParams = {
  sessionId: string
  body: Record<string, unknown>
  provider?: AgentProvider
}

type RebuildSessionIndexParams = {
  provider?: AgentProvider | 'all'
  dir?: string
  includeWorktrees?: boolean
}

export type SessionIndexRebuildError = {
  provider: AgentProvider
  sessionId?: string
  message: string
}

export type SessionIndexRebuildResult = {
  startedAt: string
  finishedAt: string
  provider: AgentProvider | 'all'
  scannedProviders: AgentProvider[]
  sessions: number
  messages: number
  errors: SessionIndexRebuildError[]
  stats: PersistedIndexStats
}

const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'max', 'xhigh'] as const
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const PI_SLASH_COMMANDS = [
  { command: '/help', description: 'Show available AgentViewer Pi commands' },
  { command: '/model', description: 'Show or switch the active model', argumentHint: '[provider/model]' },
  { command: '/thinking', description: 'Show or change thinking effort', argumentHint: `[${PI_THINKING_LEVELS.join('|')}]` },
  { command: '/compact', description: 'Compact conversation history', argumentHint: '[instructions]' },
  { command: '/name', description: 'Set the session display name', argumentHint: '<name>' },
  { command: '/session', description: 'Show session usage and cost' },
  { command: '/reload', description: 'Reload Pi extensions, skills, prompts, settings, and context files' },
] as const
const INDEX_REBUILD_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio']
const INDEX_REBUILD_PAGE_SIZE = 500
const INDEX_REBUILD_MESSAGE_LIMIT = 100_000
const INDEX_REBUILD_MESSAGE_CONCURRENCY = 4

function sortMessagesChronologically(messages: SessionMessage[]): SessionMessage[] {
  return messages.toSorted((a, b) => {
    const aTimestamp = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
    const bTimestamp = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
    if (!Number.isNaN(aTimestamp) && !Number.isNaN(bTimestamp) && aTimestamp !== bTimestamp) {
      return aTimestamp - bTimestamp
    }
    return 0
  })
}

function withOriginKind(messages: SessionMessage[], originKind: string): SessionMessage[] {
  return messages.map((message) => ({
    ...message,
    origin: message.origin ?? { kind: originKind },
  }))
}

/**
 * Walk parent_agent_id links (SDK 0.3.202+) up to the main loop and return the
 * spawn chain as a `/`-joined path (`parentId/childId`), outermost first.
 * Depth-1 agents (parent null or unknown) return just their own id, preserving
 * the historical `subagent:<agentId>` origin shape.
 */
function claudeSubagentSpawnPath(agentId: string, parentByAgent: Map<string, string | null>): string {
  const path = [agentId]
  let current = parentByAgent.get(agentId) ?? null
  while (current && !path.includes(current) && path.length < 16) {
    path.unshift(current)
    current = parentByAgent.get(current) ?? null
  }
  return path.join('/')
}

function claudeSubagentParentId(rawMessages: unknown[]): string | null {
  const first = rawMessages[0] as { parent_agent_id?: string | null } | undefined
  return typeof first?.parent_agent_id === 'string' ? first.parent_agent_id : null
}

/** Indent each subagent under its spawner so the diagnostics list reads as a tree. */
function formatClaudeSubagentTree(agentIds: string[], parentByAgent: Map<string, string | null>): string[] {
  const idSet = new Set(agentIds)
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const id of agentIds) {
    const parent = parentByAgent.get(id)
    if (parent && idSet.has(parent) && parent !== id) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id])
    } else {
      roots.push(id)
    }
  }
  const items: string[] = []
  const visited = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (visited.has(id)) return
    visited.add(id)
    items.push(depth === 0 ? id : `${'  '.repeat(depth - 1)}└ ${id}`)
    for (const child of childrenOf.get(id) ?? []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  // Cyclic parent metadata leaves no roots; emit whatever the DFS missed so
  // every listed agent still appears.
  for (const id of agentIds) visit(id, 0)
  return items
}

async function readClaudeSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const [mainRaw, subagentIds] = await Promise.all([
    getSessionMessages(sessionId, {
      includeSystemMessages: true,
      ...claudeSessionStoreOptions(),
    }),
    listSubagents(sessionId, claudeSessionStoreOptions()).catch(() => [] as string[]),
  ])

  const lastMain = mainRaw.at(-1) as { uuid?: string } | undefined
  const signature = `${mainRaw.length}:${lastMain?.uuid ?? ''}:${subagentIds.length}:${subagentIds.at(-1) ?? ''}`
  const cached = readMappedMessagesCache(`claude:${sessionId}`, signature)
  if (cached) return cached

  const subagentRaw = await Promise.all(
    subagentIds.map(async (agentId) => ({
      agentId,
      messages: await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
        .catch(() => [] as SessionMessage[]),
    })),
  )

  // parent_agent_id (SDK 0.3.202+) names the subagent that spawned each agent,
  // null for agents spawned by the main loop. Encode the spawn chain into the
  // origin kind (`subagent:parent/child`) so renderers can show nesting depth.
  const parentByAgent = new Map<string, string | null>()
  for (const { agentId, messages } of subagentRaw) {
    parentByAgent.set(agentId, claudeSubagentParentId(messages as unknown[]))
  }
  const subagentMessages = subagentRaw.map(({ agentId, messages }) =>
    withOriginKind(
      normalizeClaudeHistoryMessages(messages as unknown[]),
      `subagent:${claudeSubagentSpawnPath(agentId, parentByAgent)}`,
    ),
  )

  const deduped = new Map<string, SessionMessage>()
  for (const message of [
    ...normalizeClaudeHistoryMessages(mainRaw as unknown[]),
    ...subagentMessages.flat(),
  ]) {
    deduped.set(`${message.provider ?? 'claude'}:${message.uuid}`, message)
  }

  const messages = sortMessagesChronologically([...deduped.values()])
  return writeMappedMessagesCache(`claude:${sessionId}`, signature, messages)
}

function claudeLatencyDiagnosticItems(rawMessages: unknown[]): string[] {
  const results = rawMessages
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    .filter((value) => value.type === 'result' && value.subtype === 'success')
    .slice(-20)
  if (results.length === 0) return ['No Claude result timing samples']
  const samples = (key: string) => results
    .map((result) => result[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const median = (values: number[]) => {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const formatMs = (value: number | null) => value == null ? null : `${Math.round(value)}ms`
  const items = [`${results.length} recent result sample${results.length === 1 ? '' : 's'}`]
  const timing: Array<[string, number]> = []
  for (const [label, key] of [['TTFT', 'ttft_ms'], ['API', 'duration_api_ms'], ['Request', 'time_to_request_ms']] as const) {
    const value = median(samples(key))
    if (value != null) timing.push([label, value])
  }
  if (timing.length > 0) items.push(...timing.map(([label, value]) => `${label} median ${formatMs(value)}`))
  const latest = results.at(-1)
  if (typeof latest?.api_error_status === 'number') items.push(`Latest API status HTTP ${latest.api_error_status}`)
  const modelUsage = latest?.modelUsage && typeof latest.modelUsage === 'object' ? latest.modelUsage as Record<string, unknown> : null
  if (modelUsage) {
    const models = Object.values(modelUsage).flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const entry = value as Record<string, unknown>
      const model = typeof entry.canonicalModel === 'string' ? entry.canonicalModel : typeof entry.model === 'string' ? entry.model : null
      const provider = typeof entry.provider === 'string' ? entry.provider : null
      return model ? [provider ? `${provider}/${model}` : model] : []
    })
    if (models.length > 0) items.push(`Models ${[...new Set(models)].join(', ')}`)
  }
  return items
}

/**
 * Absolute paths the session has authoritatively observed through Claude's
 * native Read tool. Restore flows use this set to repair the resumed Query's
 * edit-safety cache without granting read state for unrelated files.
 */
export async function readClaudeObservedFilePaths(sessionId: string, cwd: string): Promise<string[]> {
  const messages = await readClaudeSessionMessages(sessionId)
  const observed = new Set<string>()
  for (let messageIndex = messages.length - 1; messageIndex >= 0 && observed.size < 200; messageIndex -= 1) {
    const content = messages[messageIndex]?.message.content
    if (!Array.isArray(content)) continue
    for (let blockIndex = content.length - 1; blockIndex >= 0 && observed.size < 200; blockIndex -= 1) {
      const block = content[blockIndex]
      if (block?.type !== 'tool_use' || String(block.name).toLowerCase() !== 'read') continue
      const input = block.input && typeof block.input === 'object'
        ? block.input as Record<string, unknown>
        : {}
      const rawPath = typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
        ? input.path
        : ''
      if (rawPath) observed.add(resolvePath(cwd, rawPath))
    }
  }
  return [...observed]
}

function parseEffort(body: Record<string, unknown>): ReasoningEffortLevel | undefined {
  const effort = typeof body.effort === 'string' ? body.effort.trim() : ''
  return REASONING_EFFORT_LEVELS.includes(effort as typeof REASONING_EFFORT_LEVELS[number])
    ? effort as typeof REASONING_EFFORT_LEVELS[number]
    : undefined
}

function parseCopilotContextTier(value: unknown): CopilotContextTier | undefined {
  return value === 'default' || value === 'long_context' ? value : undefined
}

function claudeFallbackModelChain(): string | undefined {
  const value = process.env.AGENT_VIEWER_CLAUDE_FALLBACK_MODELS
    ?? process.env.CLAUDE_FALLBACK_MODELS
    ?? process.env.CLAUDE_FALLBACK_MODEL
  if (!value) return undefined
  const models = value.split(',').map((model) => model.trim()).filter(Boolean)
  return models.length > 0 ? models.join(',') : undefined
}

function parseTurnRequestId(body: Record<string, unknown>): string {
  return typeof body.turnRequestId === 'string' && body.turnRequestId.trim()
    ? body.turnRequestId.trim()
    : crypto.randomUUID()
}

function parseQuestionAnswers(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const answers: Record<string, string[]> = {}
  for (const [key, rawAnswer] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawAnswer === 'string') {
      answers[key] = [rawAnswer]
      continue
    }
    if (Array.isArray(rawAnswer) && rawAnswer.every((entry) => typeof entry === 'string')) {
      answers[key] = rawAnswer
    }
  }
  return answers
}

function parseAttachmentPayload(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseAttachments(body: Record<string, unknown>): SendAttachment[] {
  const raw = body.attachments
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): SendAttachment[] => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (!['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob', 'agent', 'extension_context'].includes(type)) return []
    return [{
      id: typeof record.id === 'string' ? record.id : undefined,
      type: type as SendAttachment['type'],
      path: typeof record.path === 'string' ? record.path.trim() : undefined,
      filePath: typeof record.filePath === 'string' ? record.filePath.trim() : undefined,
      displayName: typeof record.displayName === 'string' ? record.displayName.trim() : undefined,
      text: typeof record.text === 'string' ? record.text : undefined,
      data: typeof record.data === 'string' ? record.data : undefined,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType.trim() : undefined,
      extensionId: typeof record.extensionId === 'string' ? record.extensionId.trim() : undefined,
      canvasId: typeof record.canvasId === 'string' ? record.canvasId.trim() : undefined,
      instanceId: typeof record.instanceId === 'string' ? record.instanceId.trim() : undefined,
      capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt.trim() : undefined,
      payload: parseAttachmentPayload(record.payload),
      selection: normalizeSelection(record.selection),
    }]
  }).slice(0, 12)
}

function normalizeSelection(value: unknown): SendAttachment['selection'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const start = normalizePosition(record.start)
  const end = normalizePosition(record.end)
  return start && end ? { start, end } : undefined
}

function normalizePosition(value: unknown): { line: number; character: number } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const line = Number(record.line)
  const character = Number(record.character)
  return Number.isFinite(line) && Number.isFinite(character)
    ? { line, character }
    : undefined
}

function attachmentPath(attachment: SendAttachment): string | undefined {
  return attachment.path || attachment.filePath
}

function attachmentName(attachment: SendAttachment): string {
  const path = attachmentPath(attachment)
  if (attachment.type === 'agent') {
    const textName = attachment.text?.trim().replace(/^@/, '')
    return attachment.displayName || textName || path || 'agent'
  }
  return attachment.displayName || (path ? basename(path) : attachment.type)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function inferMimeType(path: string | undefined, fallback = 'application/octet-stream'): string {
  const extension = extname(path ?? '').toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.json') return 'application/json'
  if (extension === '.md' || extension === '.markdown') return 'text/markdown'
  if (extension === '.txt' || extension === '.log') return 'text/plain'
  if (extension === '.ts' || extension === '.tsx' || extension === '.js' || extension === '.jsx' || extension === '.css' || extension === '.html') return 'text/plain'
  return fallback
}

function isSupportedClaudeImageMime(mimeType: string): mimeType is 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/gif' || mimeType === 'image/webp'
}

async function readLocalImageAttachment(attachment: SendAttachment, cwd?: string): Promise<{ data: string; mimeType: string; name: string } | null> {
  if (attachment.type !== 'image' && attachment.mimeType?.startsWith('image/') !== true) return null
  if (attachment.type === 'blob' && attachment.data && attachment.mimeType) {
    return { data: attachment.data, mimeType: attachment.mimeType, name: attachmentName(attachment) }
  }
  const path = attachmentPath(attachment)
  if (!path || isHttpUrl(path)) return null
  const mimeType = attachment.mimeType || inferMimeType(path)
  const data = await readFile(resolveLocalComposerAttachmentPath(path, cwd), 'base64')
  return { data, mimeType, name: attachmentName(attachment) }
}

async function buildClaudePromptParts(userMessage: string, attachments: SendAttachment[], cwd?: string): Promise<{
  text: string
  imageBlocks: ClaudeContentBlockParam[]
}> {
  const plan = planComposerAttachments('claude', attachments)
  assertComposerAttachmentsSupported('claude', plan)
  const imageBlocks: ClaudeContentBlockParam[] = []
  for (const attachment of plan.native) {
    const image = await readLocalImageAttachment(attachment, cwd)
    if (!image) continue
    if (!isSupportedClaudeImageMime(image.mimeType)) {
      throw new Error(`Claude image attachment ${image.name} has unsupported MIME type ${image.mimeType}`)
    }
    imageBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mimeType,
        data: image.data,
      },
    })
  }

  const text = appendPortableComposerContext(userMessage, plan.portableText)
  return { text, imageBlocks }
}

async function buildClaudeUserMessage(userMessage: string, attachments: SendAttachment[], cwd?: string): Promise<SDKUserMessage> {
  const { text, imageBlocks } = await buildClaudePromptParts(userMessage, attachments, cwd)
  return {
    type: 'user',
    message: {
      role: 'user',
      content: imageBlocks.length === 0
        ? text
        : [{ type: 'text', text }, ...imageBlocks],
    },
    parent_tool_use_id: null,
    // uuid-stamp every outgoing message: command_lifecycle frames
    // (queued/started/completed/cancelled/discarded) and interrupt
    // still_queued receipts only reference uuid-stamped messages.
    uuid: crypto.randomUUID(),
  } as SDKUserMessage
}

function claudeUserMessageUuid(message: SDKUserMessage): string | undefined {
  const uuid = (message as { uuid?: unknown }).uuid
  return typeof uuid === 'string' ? uuid : undefined
}

type CopilotSendAttachment = NonNullable<CopilotMessageOptions['attachments']>[number] | {
  type: 'extension_context'
  title: string
  extensionId: string
  capturedAt: string
  canvasId?: string
  instanceId?: string
  payload?: Record<string, unknown>
}

type CopilotSendMessageOptions = Omit<CopilotMessageOptions, 'attachments'> & {
  attachments?: CopilotSendAttachment[]
}

function buildCopilotAttachments(attachments: SendAttachment[], cwd?: string): CopilotSendAttachment[] {
  const result: CopilotSendAttachment[] = []
  for (const attachment of attachments) {
    const path = attachmentPath(attachment)
    if (attachment.type === 'file' || attachment.type === 'image' || attachment.type === 'mention') {
      if (path) result.push({ type: 'file', path: resolveLocalComposerAttachmentPath(path, cwd), displayName: attachment.displayName })
      continue
    }
    if (attachment.type === 'directory') {
      if (path) result.push({ type: 'directory', path: resolveLocalComposerAttachmentPath(path, cwd), displayName: attachment.displayName })
      continue
    }
    if (attachment.type === 'selection') {
      const filePath = attachment.filePath || attachment.path
      if (filePath && attachment.displayName) {
        result.push({
          type: 'selection',
          filePath: resolveLocalComposerAttachmentPath(filePath, cwd),
          displayName: attachment.displayName,
          selection: attachment.selection,
          text: attachment.text,
        })
      }
      continue
    }
    if (attachment.type === 'blob' && attachment.data && attachment.mimeType) {
      result.push({
        type: 'blob',
        data: attachment.data,
        mimeType: attachment.mimeType,
        displayName: attachment.displayName,
      })
      continue
    }
    if (attachment.type === 'extension_context' && attachment.extensionId && attachment.capturedAt && attachment.displayName) {
      result.push({
        type: 'extension_context',
        title: attachment.displayName,
        extensionId: attachment.extensionId,
        capturedAt: attachment.capturedAt,
        canvasId: attachment.canvasId,
        instanceId: attachment.instanceId,
        payload: attachment.payload,
      })
    }
  }
  return result
}

function buildOpenCodeParts(userMessage: string, attachments: SendAttachment[], cwd?: string): Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> {
  const plan = planComposerAttachments('opencode', attachments)
  assertComposerAttachmentsSupported('opencode', plan)
  const text = appendPortableComposerContext(userMessage, plan.portableText)
  const parts: Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> = [{ type: 'text', text }]
  for (const attachment of plan.native) {
    const path = attachmentPath(attachment)
    if (attachment.type === 'agent') {
      const name = attachmentName(attachment)
      const value = attachment.text?.trim() || `@${name}`
      parts.push({
        type: 'agent',
        name,
        source: {
          value,
          start: 0,
          end: value.length,
        },
      })
      continue
    }
    if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/')) {
      parts.push({
        type: 'file',
        mime: attachment.mimeType,
        filename: attachmentName(attachment),
        url: `data:${attachment.mimeType};base64,${attachment.data}`,
      })
      continue
    }
    if (!path || (attachment.type !== 'file' && attachment.type !== 'image' && attachment.type !== 'mention')) continue
    const name = attachmentName(attachment)
    const resolved = isHttpUrl(path) ? path : resolveLocalComposerAttachmentPath(path, cwd)
    const label = `@${name}`
    parts.push({
      type: 'file',
      mime: attachment.mimeType || inferMimeType(path, 'text/plain'),
      filename: name,
      url: isHttpUrl(resolved) ? resolved : pathToFileURL(resolved).toString(),
      source: {
        type: 'file',
        path: resolved,
        text: { value: label, start: 0, end: label.length },
      },
    })
  }
  return parts
}

async function buildPiImages(attachments: SendAttachment[], cwd?: string): Promise<Array<{ type: 'image'; data: string; mimeType: string }>> {
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = []
  for (const attachment of attachments) {
    const image = await readLocalImageAttachment(attachment, cwd)
    if (image) images.push({ type: 'image', data: image.data, mimeType: image.mimeType })
  }
  return images
}

function parsePiDirectShell(message: string): { command: string; excludeFromContext: boolean } | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('!')) return null
  const excludeFromContext = trimmed.startsWith('!!')
  const command = trimmed.slice(excludeFromContext ? 2 : 1).trim()
  return { command, excludeFromContext }
}

function findPiModelByReference(
  modelReference: string,
  models: readonly { provider: string; id: string }[],
): { provider: string; id: string } | undefined {
  const trimmed = modelReference.trim()
  if (!trimmed) return undefined
  const normalized = trimmed.toLowerCase()
  const canonicalMatches = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === normalized)
  if (canonicalMatches.length === 1) return canonicalMatches[0]
  if (canonicalMatches.length > 1) return undefined
  const slashIndex = trimmed.indexOf('/')
  if (slashIndex !== -1) {
    const provider = trimmed.slice(0, slashIndex).trim().toLowerCase()
    const modelId = trimmed.slice(slashIndex + 1).trim().toLowerCase()
    if (provider && modelId) {
      const providerMatches = models.filter((model) =>
        model.provider.toLowerCase() === provider && model.id.toLowerCase() === modelId)
      if (providerMatches.length === 1) return providerMatches[0]
      if (providerMatches.length > 1) return undefined
    }
  }
  const idMatches = models.filter((model) => model.id.toLowerCase() === normalized)
  return idMatches.length === 1 ? idMatches[0] : undefined
}

// ── Claude input-box bash mode (`!command`) ─────────────────────────────────
// Mirrors the Claude Code CLI: the command runs locally in the session cwd,
// then two user messages are appended to the session in the CLI's native
// transcript shape — `<bash-input>cmd</bash-input>` (persisted silently via
// shouldQuery:false) and `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`
// (which starts a turn so Claude responds to the output, matching the CLI's
// respondToBashCommands default).

const CLAUDE_BANG_SHELL_TIMEOUT_MS = 5 * 60 * 1000
const CLAUDE_BANG_SHELL_OUTPUT_CAP = 100_000

// The CLI XML-escapes text before wrapping it in bash-* transcript tags
// (observed in native session files: `bun &lt;command&gt;`).
function escapeBashTagContent(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildClaudeBashInputMessage(command: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: `<bash-input>${escapeBashTagContent(command)}</bash-input>` },
    parent_tool_use_id: null,
    // Append to the transcript without starting an assistant turn — the output
    // message that follows is what queries.
    shouldQuery: false,
  }
}

function buildClaudeBashOutputMessage(result: { stdout: string; stderr: string }): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: `<bash-stdout>${escapeBashTagContent(result.stdout)}</bash-stdout><bash-stderr>${escapeBashTagContent(result.stderr)}</bash-stderr>`,
    },
    parent_tool_use_id: null,
  }
}

async function runClaudeBangShellCommand(
  command: string,
  cwd: string | undefined,
  opts: { registerKill?: (kill: () => void) => void } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('bash', ['-c', command], {
        cwd: cwd || process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group so interrupt/timeout kills the whole tree —
        // signalling just the `bash -c` parent orphans its children.
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      resolve({ stdout: '', stderr: err instanceof Error ? err.message : 'Failed to run command' })
      return
    }
    const killTree = (signal: NodeJS.Signals) => {
      const pid = child.pid
      try {
        if (pid != null && process.platform !== 'win32') {
          process.kill(-pid, signal)
          return
        }
      } catch { /* group already gone — fall through to direct kill */ }
      try { child.kill(signal) } catch { /* already gone */ }
    }
    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= CLAUDE_BANG_SHELL_OUTPUT_CAP) {
        truncated = true
        return current
      }
      const next = current + chunk.toString('utf8')
      if (next.length > CLAUDE_BANG_SHELL_OUTPUT_CAP) {
        truncated = true
        return next.slice(0, CLAUDE_BANG_SHELL_OUTPUT_CAP)
      }
      return next
    }
    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })

    let settled = false
    const settle = (extraStderr?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const parts = [stderr, truncated ? '… [output truncated]' : '', extraStderr ?? '']
      resolve({ stdout, stderr: parts.filter(Boolean).join('\n') })
    }
    const timer = setTimeout(() => {
      killTree('SIGKILL')
      settle(`Command timed out after ${Math.round(CLAUDE_BANG_SHELL_TIMEOUT_MS / 1000)}s`)
    }, CLAUDE_BANG_SHELL_TIMEOUT_MS)
    opts.registerKill?.(() => {
      killTree('SIGTERM')
      settle('Command interrupted')
    })
    child.on('error', (err) => settle(err.message))
    child.on('close', (code) => {
      settle(code != null && code !== 0 ? `Exit code ${code}` : undefined)
    })
  })
}

function codexContextUsageToEventData(contextUsage: ContextUsage): string {
  return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`
}

function turnUsageToEventData(outputTokens: number): string {
  return `event: turn-usage\ndata: ${JSON.stringify({ outputTokens })}\n\n`
}

// Exported for reliabilityTimeoutSmoke.ts, which verifies (without needing
// real Claude/Codex credentials or a custom-model deployment) that a hung
// composer RPC actually times out at its bound and that the resulting error
// message is classified as auto-retryable by isTransientSendError — the two
// properties every withTimeout call site added for composer reliability
// depends on.
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref()
    }
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer)
  })
}

// How many inconclusive probes (provider unreachable / status unknown) to
// tolerate after a silence window before giving up and resolving the turn so
// the request can never hang indefinitely.
const WATCHDOG_MAX_UNKNOWN_PROBES = 3

type TurnWatchdogVerdict = 'idle' | 'running' | 'unknown'

/**
 * Backstop for a send stream whose provider can miss its own terminal signal
 * (a dropped/reconnected event subscription that swallows session.idle, a
 * heuristic completion timer that never fires, etc.). The timer resets on every
 * outbound SSE frame; after `idleTimeoutMs` of total silence it asks the
 * provider — authoritatively — whether the turn is actually still running.
 *
 * Crucially it only resolves the turn when the probe CONFIRMS idle, so a long
 * but silent tool call (e.g. a multi-minute build that emits no frames between
 * tool start and result) is never killed while the agent is still working — the
 * probe reports 'running' and the watchdog simply waits again. Only after the
 * provider says idle, or after several inconclusive probes, does it fire
 * `onResolved`, which the caller uses to synthesize a terminal frame and close.
 */
export function startTurnWatchdog(opts: {
  label: string
  idleTimeoutMs: number
  /** Test seam; production callers retain the one-second floor. */
  minimumDelayMs?: number
  isClosed: () => boolean
  lastActivityAt: () => number
  probe: () => Promise<TurnWatchdogVerdict>
  onResolved: (reason: string) => void
}): () => void {
  const { label, idleTimeoutMs, isClosed, lastActivityAt, probe, onResolved } = opts
  let cancelled = false
  let probing = false
  let unknownStreak = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const arm = (fromNow = false) => {
    if (cancelled) return
    const elapsed = Date.now() - lastActivityAt()
    // After a probe, wait a complete silence window before probing again.
    // Reusing the original activity timestamp here caused a confirmed-running
    // provider (or a transiently unreachable one) to be hammered every second.
    const minimumDelayMs = opts.minimumDelayMs ?? 1000
    const wait = fromNow
      ? Math.max(idleTimeoutMs, minimumDelayMs)
      : Math.max(idleTimeoutMs - elapsed, minimumDelayMs)
    timer = setTimeout(() => { void tick() }, wait)
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref()
    }
  }

  const tick = async () => {
    timer = null
    if (cancelled || isClosed()) return
    // Activity arrived while the timer was pending — not silent after all.
    if (Date.now() - lastActivityAt() < idleTimeoutMs) { arm(); return }
    if (probing) { arm(); return }
    probing = true
    let verdict: TurnWatchdogVerdict = 'unknown'
    try {
      verdict = await probe()
    } catch {
      verdict = 'unknown'
    } finally {
      probing = false
    }
    if (cancelled || isClosed()) return
    if (verdict === 'idle') {
      onResolved(`${label}: turn idle confirmed after ${idleTimeoutMs}ms of silence`)
      return
    }
    if (verdict === 'running') {
      unknownStreak = 0
      arm(true)
      return
    }
    unknownStreak += 1
    if (unknownStreak >= WATCHDOG_MAX_UNKNOWN_PROBES) {
      onResolved(`${label}: no terminal signal and ${unknownStreak} inconclusive probes after silence`)
      return
    }
    arm(true)
  }

  arm()
  return () => {
    cancelled = true
    if (timer != null) { clearTimeout(timer); timer = null }
  }
}

function formatOpenCodeEvent(event: OpenCodeEvent): string {
  return JSON.stringify({ type: 'opencode_event', event })
}

function parseOpenCodeSlashCommand(message: string): { command: string; arguments: string } | null {
  if (!message.startsWith('/')) return null
  const trimmed = message.trim()
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return null
  return {
    command: match[1]!,
    arguments: match[2]?.trim() ?? '',
  }
}

function copilotCommandResultEvent(data: Record<string, unknown>): string {
  return `event: command-result\ndata: ${JSON.stringify({ provider: 'copilot', transcriptExpected: false, ...data })}\n\n`
}

// Generic command-result frame for any provider that executes a slash command
// natively (e.g. /compact) instead of sending it as prompt text. The clients
// render the `message` field as a session notice.
function commandResultEvent(provider: AgentProvider, data: Record<string, unknown>): string {
  return `event: command-result\ndata: ${JSON.stringify({ provider, transcriptExpected: true, ...data })}\n\n`
}

// A non-fatal banner shown mid-turn (e.g. an MCP elicitation prompt). Distinct
// from command-result, which the client treats as a turn-ending result and uses
// to clear the live overlay.
function turnNoticeEvent(message: string): string {
  return `event: turn-notice\ndata: ${JSON.stringify({ message })}\n\n`
}

const COPILOT_COMPOSER_MODES = [
  {
    value: 'interactive',
    label: 'INTERACTIVE',
    description: 'Respond conversationally and make changes as needed.',
  },
  {
    value: 'plan',
    label: 'PLAN',
    description: 'Prepare a plan before changing files.',
  },
  {
    value: 'autopilot',
    label: 'AUTOPILOT',
    description: 'Work autonomously toward task completion.',
  },
  {
    value: 'shell',
    label: 'SHELL',
    description: 'Use Copilot shell-focused mode for the next turn.',
  },
] satisfies NonNullable<SessionComposerOptions['modes']>

const CLAUDE_PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: 'DEFAULT', description: 'Use the session permission policy.' },
  { value: 'acceptEdits', label: 'ACCEPT EDITS', description: 'Approve file edits while prompting for other tools.' },
  { value: 'plan', label: 'PLAN', description: 'Plan without making changes.' },
  { value: 'bypassPermissions', label: 'BYPASS', description: 'Run tools without permission prompts.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

const CODEX_PERMISSION_MODE_OPTIONS = [
  { value: 'auto', label: 'CONFIG', description: 'Use the app-server configured approval policy.' },
  { value: 'untrusted', label: 'UNTRUSTED', description: 'Only trusted operations run without approval.' },
  { value: 'on-request', label: 'ON REQUEST', description: 'Ask when the agent requests elevated execution.' },
  { value: 'never', label: 'NEVER', description: 'Never request approval.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

const COPILOT_PERMISSION_MODE_OPTIONS = [
  { value: 'off', label: 'PROMPT', description: 'Use the normal permission approval flow.' },
  { value: 'auto', label: 'AUTO', description: 'Attach Copilot safety recommendations to requests.' },
  { value: 'on', label: 'ALLOW ALL', description: 'Automatically approve tool, path, and URL requests.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

const PROVIDER_MANAGED_PERMISSION_OPTIONS = [
  { value: 'native', label: 'NATIVE', description: 'Permissions are managed by the provider.' },
] satisfies NonNullable<SessionComposerOptions['permissionModes']>

type CopilotAgentMode = NonNullable<CopilotMessageOptions['agentMode']>
type CopilotPersistentMode = Exclude<CopilotAgentMode, 'shell'>

function parseCopilotMode(value: unknown): CopilotAgentMode | undefined {
  return value === 'interactive' || value === 'plan' || value === 'autopilot' || value === 'shell'
    ? value
    : undefined
}

function parseCopilotModeResponse(value: unknown): CopilotAgentMode | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return parseCopilotMode((value as { mode?: unknown }).mode)
  }
  return parseCopilotMode(value)
}

type CopilotPermissionMode = 'off' | 'auto' | 'on'

function parseCopilotPermissionMode(value: unknown): CopilotPermissionMode | undefined {
  return value === 'off' || value === 'auto' || value === 'on' ? value : undefined
}

function isCopilotPersistentMode(mode: CopilotAgentMode): mode is CopilotPersistentMode {
  return mode !== 'shell'
}

function copilotPermissionDecision(response: string, feedback?: string): Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }> {
  return response === 'once'
    ? { kind: 'approve-once' }
    : response === 'always'
    ? { kind: 'approve-for-session' }
    : { kind: 'reject', ...(feedback ? { feedback } : {}) }
}

type PendingCopilotPermission = {
  resolve: (result: Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }>) => void
  requestPayload: Record<string, unknown>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPendingCopilotPermissions: Map<string, PendingCopilotPermission> | undefined
}
const pendingCopilotPermissions = globalThis.__agentViewerPendingCopilotPermissions
  ?? (globalThis.__agentViewerPendingCopilotPermissions = new Map<string, PendingCopilotPermission>())

type PendingCopilotElicitation = {
  resolve: (result: CopilotElicitationResult) => void
  requestPayload: Record<string, unknown>
  requestedSchema?: Record<string, unknown>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPendingCopilotElicitations: Map<string, PendingCopilotElicitation> | undefined
}
const pendingCopilotElicitations = globalThis.__agentViewerPendingCopilotElicitations
  ?? (globalThis.__agentViewerPendingCopilotElicitations = new Map<string, PendingCopilotElicitation>())

function pendingCopilotPermissionKey(sessionId: string, permissionId: string): string {
  return `${sessionId}:${permissionId}`
}

function copilotPermissionRequestedPayload(sessionId: string, requestId: string, permissionRequest: CopilotPermissionRequest): Record<string, unknown> {
  return {
    type: 'copilot_event',
    event: {
      id: requestId,
      parentId: null,
      timestamp: new Date().toISOString(),
      type: 'permission.requested',
      data: {
        requestId,
        permissionRequest,
      },
    },
  }
}

function copilotPermissionRequestedEvent(sessionId: string, requestId: string, permissionRequest: CopilotPermissionRequest): string {
  return JSON.stringify(copilotPermissionRequestedPayload(sessionId, requestId, permissionRequest))
}

function createCopilotPermissionBridge(
  sessionId: string,
  enqueue: (chunk: string) => void,
  activeIds: Set<string>,
  canAwaitUser: () => boolean,
): (request: CopilotPermissionRequest) => Promise<Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }>> {
  return (request) => {
    if (!canAwaitUser()) {
      return Promise.resolve({ kind: 'user-not-available' })
    }
    const requestId = `agent-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeIds.add(requestId)
    enqueue(`data: ${copilotPermissionRequestedEvent(sessionId, requestId, request)}\n\n`)
    if (!canAwaitUser()) {
      activeIds.delete(requestId)
      return Promise.resolve({ kind: 'user-not-available' })
    }
    return new Promise((resolve) => {
      const key = pendingCopilotPermissionKey(sessionId, requestId)
      pendingCopilotPermissions.set(key, {
        resolve: (result) => {
          pendingCopilotPermissions.delete(key)
          activeIds.delete(requestId)
          resolve(result)
        },
        requestPayload: copilotPermissionRequestedPayload(sessionId, requestId, request),
      })
    })
  }
}

function createCopilotElicitationBridge(
  sessionId: string,
  enqueue: (chunk: string) => void,
  activeIds: Set<string>,
  canAwaitUser: () => boolean,
): (context: CopilotElicitationContext) => Promise<CopilotElicitationResult> {
  return (context) => {
    if (!canAwaitUser()) return Promise.resolve({ action: 'cancel' })
    const requestId = `agent-viewer-elicitation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const requestPayload = {
      type: 'copilot_event',
      event: {
        id: requestId,
        parentId: null,
        timestamp: new Date().toISOString(),
        type: 'elicitation.requested',
        ephemeral: true,
        data: {
          requestId,
          message: context.message,
          mode: context.mode ?? 'form',
          elicitationSource: context.elicitationSource,
          url: context.url,
          requestedSchema: context.requestedSchema,
        },
      },
    }
    activeIds.add(requestId)
    enqueue(`data: ${JSON.stringify(requestPayload)}\n\n`)
    return new Promise((resolve) => {
      const key = pendingCopilotPermissionKey(sessionId, requestId)
      pendingCopilotElicitations.set(key, {
        resolve: (result) => {
          pendingCopilotElicitations.delete(key)
          activeIds.delete(requestId)
          resolve(result)
        },
        requestPayload,
        requestedSchema: context.requestedSchema ? { ...context.requestedSchema } : undefined,
      })
    })
  }
}

function resolvePendingCopilotPermissions(sessionId: string, ids: Set<string>, result: Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }>): void {
  for (const id of Array.from(ids)) {
    const key = pendingCopilotPermissionKey(sessionId, id)
    const pending = pendingCopilotPermissions.get(key)
    if (!pending) continue
    pendingCopilotPermissions.delete(key)
    ids.delete(id)
    pending.resolve(result)
  }
}

function resolvePendingCopilotElicitations(sessionId: string, ids: Set<string>, result: CopilotElicitationResult): void {
  for (const id of Array.from(ids)) {
    const key = pendingCopilotPermissionKey(sessionId, id)
    const pending = pendingCopilotElicitations.get(key)
    if (!pending) continue
    pendingCopilotElicitations.delete(key)
    ids.delete(id)
    pending.resolve(result)
  }
}

type CopilotAssistantMessageEvent = Extract<CopilotSessionEvent, { type: 'assistant.message' }>
type CopilotAssistantMessageDeltaEvent = Extract<CopilotSessionEvent, { type: 'assistant.message_delta' }>
type CopilotAssistantMessageStartEvent = Extract<CopilotSessionEvent, { type: 'assistant.message_start' }>

type CopilotLiveDraft = {
  agentId?: string
  content: string
  messageId: string
  parentId: string | null
  phase?: string
  timestamp: string
  turnId?: string
}

type CopilotLiveTranscriptEntry = {
  currentTurnId?: string
  drafts: Map<string, CopilotLiveDraft>
  events: Map<string, CopilotSessionEvent>
  timer?: ReturnType<typeof setTimeout>
  updatedAt: number
}

const COPILOT_LIVE_TRANSCRIPT_TTL_MS = 5 * 60 * 1000
// Size backstop on top of the TTL cleanup: if cleanup scheduling is ever
// missed (e.g. a turn dies mid-stream), the map still cannot grow past the
// realistic concurrent-live-session count.
const LIVE_TRANSCRIPT_MAX_ENTRIES = 32
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCopilotLiveTranscripts: Map<string, CopilotLiveTranscriptEntry> | undefined
}
const copilotLiveTranscripts = globalThis.__agentViewerCopilotLiveTranscripts
  ?? (globalThis.__agentViewerCopilotLiveTranscripts = new Map<string, CopilotLiveTranscriptEntry>())

function getCopilotLiveTranscriptEntry(sessionId: string): CopilotLiveTranscriptEntry {
  let entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) {
    entry = {
      drafts: new Map(),
      events: new Map(),
      updatedAt: Date.now(),
    }
    copilotLiveTranscripts.set(sessionId, entry)
    while (copilotLiveTranscripts.size > LIVE_TRANSCRIPT_MAX_ENTRIES) {
      const oldestKey = copilotLiveTranscripts.keys().next().value
      if (oldestKey === undefined) break
      const oldest = copilotLiveTranscripts.get(oldestKey)
      if (oldest?.timer) clearTimeout(oldest.timer)
      copilotLiveTranscripts.delete(oldestKey)
    }
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = undefined
  }
  entry.updatedAt = Date.now()
  return entry
}

function scheduleCopilotLiveTranscriptCleanup(sessionId: string): void {
  const entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    copilotLiveTranscripts.delete(sessionId)
  }, COPILOT_LIVE_TRANSCRIPT_TTL_MS)
  if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) {
    (entry.timer as { unref: () => void }).unref()
  }
}

function copilotLiveEventKey(event: CopilotSessionEvent): string {
  if (event.type === 'assistant.message') return `assistant.message:${event.data.messageId}`
  return `${event.type}:${event.id}`
}

function makeCopilotLiveAssistantMessageEvent(draft: CopilotLiveDraft): CopilotAssistantMessageEvent {
  return {
    agentId: draft.agentId,
    data: {
      content: draft.content,
      messageId: draft.messageId,
      phase: draft.phase,
      turnId: draft.turnId,
    },
    ephemeral: true,
    id: `agent-viewer-live:${draft.messageId}`,
    parentId: draft.parentId,
    timestamp: draft.timestamp,
    type: 'assistant.message',
  } as CopilotAssistantMessageEvent
}

function recordCopilotLiveDraftStart(sessionId: string, event: CopilotAssistantMessageStartEvent): void {
  const entry = getCopilotLiveTranscriptEntry(sessionId)
  const existing = entry.drafts.get(event.data.messageId)
  entry.drafts.set(event.data.messageId, {
    agentId: event.agentId,
    content: existing?.content ?? '',
    messageId: event.data.messageId,
    parentId: event.parentId,
    phase: event.data.phase,
    timestamp: existing?.timestamp ?? event.timestamp,
    turnId: entry.currentTurnId,
  })
}

function recordCopilotLiveDraftDelta(sessionId: string, event: CopilotAssistantMessageDeltaEvent): void {
  const entry = getCopilotLiveTranscriptEntry(sessionId)
  const existing = entry.drafts.get(event.data.messageId)
  entry.drafts.set(event.data.messageId, {
    agentId: event.agentId ?? existing?.agentId,
    content: `${existing?.content ?? ''}${event.data.deltaContent}`,
    messageId: event.data.messageId,
    parentId: existing?.parentId ?? event.parentId,
    phase: existing?.phase,
    timestamp: event.timestamp,
    turnId: existing?.turnId ?? entry.currentTurnId,
  })
}

function recordCopilotLiveTranscriptEvent(sessionId: string, event: CopilotSessionEvent): void {
  const entry = getCopilotLiveTranscriptEntry(sessionId)

  if (event.type === 'assistant.turn_start') {
    entry.currentTurnId = event.data.turnId
  } else if (event.type === 'assistant.turn_end' && entry.currentTurnId === event.data.turnId) {
    entry.currentTurnId = undefined
    scheduleCopilotLiveTranscriptCleanup(sessionId)
  }

  if (event.type === 'assistant.message_start') {
    recordCopilotLiveDraftStart(sessionId, event)
    return
  }
  if (event.type === 'assistant.message_delta') {
    recordCopilotLiveDraftDelta(sessionId, event)
    return
  }
  if (event.type === 'assistant.message') {
    entry.drafts.delete(event.data.messageId)
  }

  entry.events.set(copilotLiveEventKey(event), event)
}

function getCopilotLiveTranscriptEvents(sessionId: string): CopilotSessionEvent[] {
  const entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) return []
  const events = Array.from(entry.events.values())
  for (const draft of entry.drafts.values()) {
    if (!draft.content) continue
    events.push(makeCopilotLiveAssistantMessageEvent(draft))
  }
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

function copilotLiveTranscriptSignature(events: CopilotSessionEvent[]): string {
  if (events.length === 0) return ''
  return events.map((event) => {
    if (event.type === 'assistant.message') {
      return `${event.type}:${event.data.messageId}:${event.data.content.length}:${event.data.content.slice(-64)}`
    }
    return `${event.type}:${event.id}`
  }).join('|')
}

function mergeCopilotSessionEvents(persisted: CopilotSessionEvent[], live: CopilotSessionEvent[]): CopilotSessionEvent[] {
  if (live.length === 0) return persisted
  return [...persisted, ...filterCopilotLiveEvents(persisted, live)].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

function filterCopilotLiveEvents(persisted: CopilotSessionEvent[], live: CopilotSessionEvent[]): CopilotSessionEvent[] {
  const persistedIds = new Set(persisted.map((event) => event.id))
  const persistedAssistantIds = new Set(
    persisted
      .filter((event): event is CopilotAssistantMessageEvent => event.type === 'assistant.message')
      .map((event) => event.data.messageId),
  )
  const filtered: CopilotSessionEvent[] = []
  for (const event of live) {
    if (persistedIds.has(event.id)) continue
    if (event.type === 'assistant.message' && persistedAssistantIds.has(event.data.messageId)) continue
    filtered.push(event)
  }
  return filtered
}

function sessionMessageIdentity(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}

function markLiveSessionMessages(messages: SessionMessage[], liveKeys: Set<string>): SessionMessage[] {
  if (liveKeys.size === 0) return messages
  return messages.map((message) => liveKeys.has(sessionMessageIdentity(message))
    ? { ...message, ephemeral: true }
    : message
  )
}

type PiLiveTranscriptEntry = {
  activeAssistantKey?: string
  messages: Map<string, PiAgentMessage>
  timer?: ReturnType<typeof setTimeout>
  updatedAt: number
}

const PI_LIVE_TRANSCRIPT_TTL_MS = 5 * 60 * 1000
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPiLiveTranscripts: Map<string, PiLiveTranscriptEntry> | undefined
}
const piLiveTranscripts = globalThis.__agentViewerPiLiveTranscripts
  ?? (globalThis.__agentViewerPiLiveTranscripts = new Map<string, PiLiveTranscriptEntry>())

function getPiLiveTranscriptEntry(sessionId: string): PiLiveTranscriptEntry {
  let entry = piLiveTranscripts.get(sessionId)
  if (!entry) {
    entry = {
      messages: new Map(),
      updatedAt: Date.now(),
    }
    piLiveTranscripts.set(sessionId, entry)
    while (piLiveTranscripts.size > LIVE_TRANSCRIPT_MAX_ENTRIES) {
      const oldestKey = piLiveTranscripts.keys().next().value
      if (oldestKey === undefined) break
      const oldest = piLiveTranscripts.get(oldestKey)
      if (oldest?.timer) clearTimeout(oldest.timer)
      piLiveTranscripts.delete(oldestKey)
    }
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = undefined
  }
  entry.updatedAt = Date.now()
  return entry
}

function schedulePiLiveTranscriptCleanup(sessionId: string): void {
  const entry = piLiveTranscripts.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    piLiveTranscripts.delete(sessionId)
  }, PI_LIVE_TRANSCRIPT_TTL_MS)
  if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) {
    (entry.timer as { unref: () => void }).unref()
  }
}

function piLiveMessageKey(message: PiAgentMessage, fallback: string): string {
  const record = message as unknown as Record<string, unknown>
  const role = typeof record.role === 'string' ? record.role : 'message'
  if (role === 'assistant') {
    const responseId = typeof record.responseId === 'string' && record.responseId ? record.responseId : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    const model = typeof record.model === 'string' ? record.model : ''
    return `assistant:${responseId || timestamp || model || fallback}`
  }
  if (role === 'toolResult') {
    const toolCallId = typeof record.toolCallId === 'string' && record.toolCallId ? record.toolCallId : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `toolResult:${toolCallId || timestamp || fallback}`
  }
  if (role === 'bashExecution') {
    const command = typeof record.command === 'string' && record.command ? record.command : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `bashExecution:${command || timestamp || fallback}`
  }
  if (role === 'user') {
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `user:${timestamp || fallback}`
  }
  const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
  return `${role}:${timestamp || fallback}`
}

function recordPiLiveMessage(sessionId: string, message: PiAgentMessage, fallback: string): void {
  const entry = getPiLiveTranscriptEntry(sessionId)
  let key = piLiveMessageKey(message, fallback)
  if ((message as { role?: unknown }).role === 'assistant') {
    if (entry.activeAssistantKey && entry.activeAssistantKey !== key) {
      entry.messages.delete(entry.activeAssistantKey)
    }
    entry.activeAssistantKey = key
  }
  entry.messages.set(key, message)
}

function recordPiLiveBashMessage(
  sessionId: string,
  params: {
    command: string
    output: string
    excludeFromContext: boolean
    exitCode?: number
    cancelled?: boolean
    truncated?: boolean
    fullOutputPath?: string
  },
): void {
  recordPiLiveMessage(sessionId, {
    role: 'bashExecution',
    command: params.command,
    output: params.output,
    exitCode: params.exitCode,
    cancelled: params.cancelled ?? false,
    truncated: params.truncated ?? false,
    fullOutputPath: params.fullOutputPath,
    timestamp: Date.now(),
    excludeFromContext: params.excludeFromContext,
  } as unknown as PiAgentMessage, `bash:${params.command}`)
}

function recordPiLiveTranscriptEvent(sessionId: string, event: PiAgentEvent): void {
  switch (event.type) {
    case 'message_start':
    case 'message_update':
    case 'message_end':
      recordPiLiveMessage(sessionId, event.message, event.type)
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const entry = getPiLiveTranscriptEntry(sessionId)
        entry.activeAssistantKey = undefined
      }
      break
    case 'turn_end':
      recordPiLiveMessage(sessionId, event.message, 'turn_end')
      for (const result of event.toolResults) {
        recordPiLiveMessage(sessionId, result, `turn_end:${result.toolCallId}`)
      }
      break
    default:
      break
  }
}

function getPiLiveTranscriptMessages(sessionId: string, persisted: PiAgentMessage[]): PiAgentMessage[] {
  const entry = piLiveTranscripts.get(sessionId)
  if (!entry) return []
  const persistedFingerprints = new Set(persisted.map(piAgentMessageFingerprint))
  const persistedDuplicateKeys = new Set(persisted.map(piAgentMessageDuplicateKey))
  const liveMessages: PiAgentMessage[] = []
  for (const message of entry.messages.values()) {
    if (persistedFingerprints.has(piAgentMessageFingerprint(message))) continue
    if (persistedDuplicateKeys.has(piAgentMessageDuplicateKey(message))) continue
    liveMessages.push(message)
  }
  return liveMessages.sort((a, b) => {
    const at = typeof (a as { timestamp?: unknown }).timestamp === 'number' ? (a as { timestamp: number }).timestamp : 0
    const bt = typeof (b as { timestamp?: unknown }).timestamp === 'number' ? (b as { timestamp: number }).timestamp : 0
    return at - bt
  })
}

function piLiveTranscriptSignature(messages: PiAgentMessage[]): string {
  if (messages.length === 0) return ''
  return messages.map((message) => {
    const record = message as unknown as Record<string, unknown>
    const role = typeof record.role === 'string' ? record.role : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `${role}:${timestamp}:${piAgentMessageFingerprint(message)}`
  }).join('|')
}

type PendingClaudePermission = {
  resolve: (result: PermissionResult) => void
  suggestions?: PermissionUpdate[]
  input?: Record<string, unknown>
  // The exact `data` payload sent in the permission.requested frame, retained so
  // a client that reconnects mid-turn can re-surface the still-pending prompt
  // (the resolver stays valid and is answered by id, independent of the stream
  // that created it).
  requestData?: Record<string, unknown>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPendingClaudePermissions: Map<string, PendingClaudePermission> | undefined
}
const pendingClaudePermissions = globalThis.__agentViewerPendingClaudePermissions
  ?? (globalThis.__agentViewerPendingClaudePermissions = new Map<string, PendingClaudePermission>())

type PendingClaudeElicitation = {
  resolve: (result: ClaudeElicitationResult) => void
  requestData: Record<string, unknown>
  requestedSchema?: Record<string, unknown>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPendingClaudeElicitations: Map<string, PendingClaudeElicitation> | undefined
}
const pendingClaudeElicitations = globalThis.__agentViewerPendingClaudeElicitations
  ?? (globalThis.__agentViewerPendingClaudeElicitations = new Map<string, PendingClaudeElicitation>())

type PendingClaudeDialog = {
  resolve: (result: { behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }) => void
  requestData: Record<string, unknown>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPendingClaudeDialogs: Map<string, PendingClaudeDialog> | undefined
}
const pendingClaudeDialogs = globalThis.__agentViewerPendingClaudeDialogs
  ?? (globalThis.__agentViewerPendingClaudeDialogs = new Map<string, PendingClaudeDialog>())

// Pending Claude prompts (tool permissions + AskUserQuestion) still awaiting a
// response for this session, as permission.requested `data` payloads. Lets a
// reconnecting client re-arm in-flight prompts instead of leaving the turn
// blocked on an answer it can no longer see.
function listPendingClaudePrompts(sessionId: string): Record<string, unknown>[] {
  const prefix = `${sessionId}:`
  const prompts: Record<string, unknown>[] = []
  for (const [key, pending] of pendingClaudePermissions) {
    if (key.startsWith(prefix) && pending.requestData) prompts.push(pending.requestData)
  }
  return prompts
}

function listPendingClaudeElicitations(sessionId: string): Record<string, unknown>[] {
  const prefix = `${sessionId}:`
  return [
    ...Array.from(pendingClaudeElicitations)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, pending]) => pending.requestData),
    ...Array.from(pendingClaudeDialogs)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, pending]) => pending.requestData),
  ]
}

function pendingClaudePermissionKey(sessionId: string, permissionId: string): string {
  return `${sessionId}:${permissionId}`
}

function claudePermissionDecision(
  response: string,
  pending: Pick<PendingClaudePermission, 'suggestions' | 'input'>,
): PermissionResult {
  // The SDK always injects toolUseID into the control response itself, so we
  // omit it here. decisionClassification is in the TypeScript types but the
  // CLI's Zod schema does not accept it — including it causes a validation
  // error that blocks the approval.
  if (response === 'reject') {
    return {
      behavior: 'deny',
      message: 'User denied permission',
    }
  }
  return {
    behavior: 'allow',
    updatedInput: pending.input ?? {},
    ...(response === 'always' && pending.suggestions?.length
      ? { updatedPermissions: pending.suggestions }
      : {}),
  }
}

// Resolve an AskUserQuestion by allowing the tool with the user's answers
// merged into its input — the SDK's AskUserQuestion tool echoes `answers`
// (and optional freeform `response`/`annotations`) straight into its output.
function claudeQuestionDecision(
  pending: Pick<PendingClaudePermission, 'input'>,
  payload: { answers: Record<string, string>; response?: string; annotations?: Record<string, { preview?: string; notes?: string }> },
): PermissionResult {
  return {
    behavior: 'allow',
    updatedInput: {
      ...(pending.input ?? {}),
      answers: payload.answers,
      ...(payload.response ? { response: payload.response } : {}),
      ...(payload.annotations ? { annotations: payload.annotations } : {}),
    },
  }
}

function claudePermissionEvent(type: 'permission.requested' | 'permission.completed', data: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'claude_permission',
    event: {
      timestamp: new Date().toISOString(),
      type,
      data,
    },
  })
}

function createClaudePermissionBridge(
  sessionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  activeIds: Set<string>,
): CanUseTool {
  const enqueuePermissionEvent = (type: 'permission.requested' | 'permission.completed', data: Record<string, unknown>) => {
    try {
      controller.enqueue(encoder.encode(`data: ${claudePermissionEvent(type, data)}\n\n`))
    } catch {
      // The client may disconnect while Claude is still resolving a tool permission.
    }
  }

  return (toolName, input, options) => {
    // SDK 0.3.199+ dropped requestId from the CanUseTool options type but the
    // CLI still sends it — read it loosely so ids stay stable across versions.
    const requestId = (options as { requestId?: string }).requestId
      || options.toolUseID
      || `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeIds.add(requestId)
    const requestData: Record<string, unknown> = {
      requestId,
      toolUseID: options.toolUseID,
      sessionId,
      toolName,
      input,
      title: options.title,
      displayName: options.displayName,
      description: options.description,
      blockedPath: options.blockedPath,
      decisionReason: options.decisionReason,
      suggestions: options.suggestions,
    }
    enqueuePermissionEvent('permission.requested', requestData)

    return new Promise((resolve) => {
      const key = pendingClaudePermissionKey(sessionId, requestId)
      const deny = (message: string): PermissionResult => ({
        behavior: 'deny',
        message,
      })
      const cleanup = () => {
        pendingClaudePermissions.delete(key)
        activeIds.delete(requestId)
        options.signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        resolve(deny('Permission request was cancelled'))
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
      pendingClaudePermissions.set(key, {
        suggestions: options.suggestions,
        input,
        requestData,
        resolve: (result) => {
          cleanup()
          enqueuePermissionEvent('permission.completed', { requestId })
          resolve(result)
        },
      })
    })
  }
}

// Bridge MCP elicitation into the same reattachable interactive surface as
// tool permissions. URL requests wait for an explicit "open & continue";
// form requests render their JSON-schema fields and return typed content.
function createClaudeElicitationBridge(
  sessionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): ClaudeElicitationHandler {
  const enqueue = (payload: Record<string, unknown>) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
    } catch {
      // Client may have disconnected while the turn keeps running server-side.
    }
  }
  return async (request, options) => {
    if (options.signal.aborted) return { action: 'cancel' }
    const requestId = request.elicitationId
      || `claude-elicitation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const requestData: Record<string, unknown> = {
      requestId,
      sessionId,
      serverName: request.serverName,
      message: request.message,
      mode: request.mode ?? 'form',
      url: request.url,
      elicitationId: request.elicitationId,
      requestedSchema: request.requestedSchema,
      title: request.title,
      displayName: request.displayName,
      description: request.description,
    }
    enqueue({
      type: 'claude_elicitation',
      event: { type: 'elicitation.requested', data: requestData },
    })
    return new Promise<ClaudeElicitationResult>((resolve) => {
      const key = pendingClaudePermissionKey(sessionId, requestId)
      const cleanup = () => {
        pendingClaudeElicitations.delete(key)
        options.signal.removeEventListener('abort', onAbort)
      }
      const finish = (result: ClaudeElicitationResult) => {
        cleanup()
        enqueue({
          type: 'claude_elicitation',
          event: { type: 'elicitation.completed', data: { requestId, action: result.action } },
        })
        resolve(result)
      }
      const onAbort = () => finish({ action: 'cancel' })
      options.signal.addEventListener('abort', onAbort, { once: true })
      pendingClaudeElicitations.set(key, {
        resolve: finish,
        requestData,
        requestedSchema: request.requestedSchema,
      })
    })
  }
}

// Native SDK dialogs are distinct from MCP elicitation, but Agent Viewer can
// render them through the same durable prompt surface. Only dialog kinds the
// UI explicitly supports are declared on query startup; unknown kinds fail
// closed rather than being guessed at.
export function createClaudeUserDialogBridge(
  sessionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): OnUserDialog {
  const enqueue = (payload: Record<string, unknown>) => {
    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)) } catch { /* detached client */ }
  }
  return async (request, options) => {
    if (options.signal.aborted || request.dialogKind !== 'refusal_fallback_prompt') {
      return { behavior: 'cancelled' }
    }
    const requestId = options.requestId
    const payloadMessage = typeof request.payload.message === 'string'
      ? request.payload.message
      : 'Claude declined this request. Continue with the configured fallback model?'
    const requestData: Record<string, unknown> = {
      requestId,
      sessionId,
      message: payloadMessage,
      mode: 'form',
      dialogKind: request.dialogKind,
      dialogPayload: request.payload,
      requestedSchema: {
        type: 'object',
        properties: {
          continue: {
            type: 'boolean',
            title: 'Continue with fallback model',
            default: true,
          },
        },
        required: ['continue'],
      },
      title: 'Model fallback',
      description: payloadMessage,
    }
    enqueue({
      type: 'claude_elicitation',
      event: { type: 'elicitation.requested', data: requestData },
    })
    return new Promise((resolve) => {
      const key = pendingClaudePermissionKey(sessionId, requestId)
      const cleanup = () => {
        pendingClaudeDialogs.delete(key)
        options.signal.removeEventListener('abort', onAbort)
      }
      const finish: PendingClaudeDialog['resolve'] = (result) => {
        cleanup()
        enqueue({
          type: 'claude_elicitation',
          event: { type: 'elicitation.completed', data: { requestId, action: result.behavior } },
        })
        resolve(result)
      }
      const onAbort = () => finish({ behavior: 'cancelled' })
      options.signal.addEventListener('abort', onAbort, { once: true })
      pendingClaudeDialogs.set(key, { resolve: finish, requestData })
    })
  }
}

function resolvePendingClaudePermissions(sessionId: string, ids: Set<string>, message: string): void {
  for (const id of Array.from(ids)) {
    const key = pendingClaudePermissionKey(sessionId, id)
    const pending = pendingClaudePermissions.get(key)
    if (!pending) continue
    pendingClaudePermissions.delete(key)
    ids.delete(id)
    pending.resolve({
      behavior: 'deny',
      message,
    })
  }
}

function openCodeAgentOption(agent: OpenCodeAgent): SessionComposerAgentOption {
  const metadata = agent as OpenCodeAgent & { hidden?: boolean; native?: boolean }
  return {
    value: agent.name,
    label: agent.name,
    description: agent.description ?? undefined,
    mode: agent.mode,
    native: metadata.native ?? agent.builtIn,
  }
}

function isOpenCodeAgentHidden(agent: OpenCodeAgent): boolean {
  return (agent as OpenCodeAgent & { hidden?: boolean }).hidden === true
}

function lastOpenCodeUserAgent(messages: Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info
    if (info?.role === 'user' && typeof info.agent === 'string' && info.agent.trim()) {
      return info.agent
    }
  }
  return null
}

function formatCopilotEvent(event: CopilotSessionEvent): string {
  return JSON.stringify({ type: 'copilot_event', event })
}

async function findCopilotSessionMetadata(sessionId: string): Promise<CopilotSessionMetadata | null> {
  const client = await getCopilotClient()
  const metadata = await client.getSessionMetadata(sessionId).catch(() => undefined)
  if (metadata) return metadata
  const sessions = await client.listSessions()
  return sessions.find((session) => session.sessionId === sessionId) ?? null
}

async function readCopilotSessionEvents(sessionId: string): Promise<CopilotSessionEvent[]> {
  const session = await acquireCopilotSession(sessionId)
  return readCopilotHistoryFromSession(session)
}

async function readCopilotHistoryFromSession(session: Awaited<ReturnType<typeof acquireCopilotSession>>): Promise<CopilotSessionEvent[]> {
  const historyReader = session as typeof session & {
    getEvents?: () => Promise<CopilotSessionEvent[]>
    getMessages?: () => Promise<CopilotSessionEvent[]>
  }
  if (typeof historyReader.getEvents === 'function') {
    return historyReader.getEvents()
  }
  if (typeof historyReader.getMessages === 'function') {
    return historyReader.getMessages()
  }
  throw new Error('Copilot session does not expose a history reader')
}

function isCopilotAssistantMessage(event: CopilotSessionEvent): event is Extract<CopilotSessionEvent, { type: 'assistant.message' }> {
  return event.type === 'assistant.message'
}

function findCopilotHistoryCompletion(
  events: CopilotSessionEvent[],
  baselineCount: number,
  allowFinalMessageFallback: boolean,
): Extract<CopilotSessionEvent, { type: 'assistant.message' }> | null {
  const currentEvents = events.slice(Math.max(0, baselineCount))
  const userIndex = currentEvents.findIndex((event) => event.type === 'user.message')
  if (userIndex === -1) return null
  const turnEvents = currentEvents.slice(userIndex)
  const error = turnEvents.find((event) => event.type === 'session.error') as Extract<CopilotSessionEvent, { type: 'session.error' }> | undefined
  if (error) {
    const err = new Error(error.data.message)
    if (error.data.stack) err.stack = error.data.stack
    throw err
  }
  const hasCompletionSignal = turnEvents.some((event) =>
    event.type === 'session.idle' || (event.type as string) === 'session.task_complete'
  )
  const assistant = turnEvents.findLast(isCopilotAssistantMessage)
  if (!assistant) return null
  const hasToolRequests = Array.isArray(assistant.data.toolRequests) && assistant.data.toolRequests.length > 0
  return hasCompletionSignal || (allowFinalMessageFallback && !hasToolRequests)
    ? assistant
    : null
}

async function listCopilotSessions({ limit, offset, dir, includeWorktrees }: ListParams): Promise<Session[]> {
  const client = await getCopilotClient()
  const response = dir && !includeWorktrees
    ? await client.listSessions({ workingDirectory: dir })
    : await client.listSessions()

  const filtered = dir
    ? response.filter((session) => {
        const cwd = session.context?.workingDirectory
        if (!cwd) return false
        return includeWorktrees ? sameProjectPath(dir, cwd) : normalizeProjectPath(cwd) === normalizeProjectPath(dir)
      })
    : response

  const sorted = filtered.toSorted((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
  const page = sorted.slice(offset, offset + limit)
  const stored = await getCopilotStoredMetadataForSessions(page.map((session) => session.sessionId))
  return page.map((session) => mapCopilotSessionToSession(session, stored[session.sessionId] ?? { title: null, tag: null }))
}

async function listCodexSessions({ limit, offset, dir }: ListParams): Promise<Session[]> {
  const client = getCodexClient()
  const response = await client.request('thread/list', {
    limit: limit + offset,
    cwd: dir || undefined,
  })
  const page = response.data.slice(offset, offset + limit)
  const tags = await getCodexStoredTagsForSessions(page.map((thread) => thread.id))
  return page.map((thread) => mapCodexThreadToSession(thread, tags[thread.id] ?? null))
}

async function listClaudeSessions({ limit, offset, dir, includeWorktrees }: ListParams): Promise<Session[]> {
  pruneSessionInfoCache()
  const sessions = await timeAsync('claude.listSessions', () => listSessions({
    limit,
    offset,
    dir,
    includeWorktrees: dir ? includeWorktrees : undefined,
    // SessionStore.listSessions is project-scoped: the SDK has no API for
    // enumerating project keys. Preserve its true cross-project filesystem
    // behavior when no directory filter is present. Store mirroring requires
    // local persistence, so those sessions remain visible in this fallback.
    ...(dir ? claudeSessionStoreOptions() : {}),
  }))
  const normalized = await timeAsync('claude.sessionInfo', () => mapConcurrent(sessions, 20, async (session) => {
    try {
      const sessionDir = typeof session.cwd === 'string' && session.cwd ? session.cwd : dir
      const info = await getCachedSessionInfo(session.sessionId, sessionDir)
      if (!info) return session
      return {
        ...session,
        ...info,
        // Keep the list-level working directory when the single-session lookup
        // can't resolve one, but prefer the stable per-session metadata.
        cwd: info.cwd ?? session.cwd,
      }
    } catch {
      return session
    }
  }))

  return normalized.map((session) => ({
    ...session,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }))
}

function acpAgentKindOf(provider: 'claude-acp' | 'codex-acp'): 'claude' | 'codex' {
  return provider === 'codex-acp' ? 'codex' : 'claude'
}

async function resolveProvider(provider?: AgentProvider): Promise<AgentProvider> {
  const resolved = provider ?? await getConfiguredProvider()
  if (resolved === 'all') {
    throw new Error('provider is required when all providers are active')
  }
  return resolved
}

async function syncSessionsBestEffort(sessions: Session[]): Promise<void> {
  if (sessions.length === 0) return

  const listKey = sessions.map((session) => `${session.provider ?? 'claude'}:${session.sessionId}`).join('|')
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
  const key = `${provider}:${sessionId}`
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

async function removePersistedSessionBestEffort(provider: AgentProvider, sessionId: string): Promise<void> {
  try {
    await removePersistedSession(provider, sessionId)
  } catch {
    // Local index cleanup is opportunistic and should not mask provider deletes.
  }
}

async function readCodexThread(sessionId: string, includeTurns: boolean) {
  const client = getCodexClient()
  const response = await client.request('thread/read', {
    threadId: sessionId,
    includeTurns,
  })
  return response.thread
}

async function listCodexTurnsFull(sessionId: string): Promise<CodexThread['turns']> {
  const client = getCodexClient()
  const turns: CodexThread['turns'] = []
  let cursor: string | null = null

  do {
    const response: CodexResponseFor<'thread/turns/list'> = await client.request('thread/turns/list', {
      threadId: sessionId,
      cursor,
      limit: 200,
      sortDirection: 'asc',
      itemsView: 'full',
    })
    turns.push(...response.data)
    cursor = response.nextCursor
  } while (cursor)

  return turns
}

async function readCodexThreadWithFullTurns(sessionId: string): Promise<CodexThread> {
  const thread = await readCodexThread(sessionId, false)
  try {
    const turns = await listCodexTurnsFull(sessionId)
    return { ...thread, turns }
  } catch (err) {
    if (isCodexMissingRolloutError(err)) return { ...thread, turns: [] }
    // Older app-server builds populated `thread/read(includeTurns)` before
    // the paginated turns API existed. Keep that as a fallback, but prefer
    // `itemsView: "full"` above because it matches live Codex CLI state.
    return readCodexThread(sessionId, true)
  }
}

function isCodexMissingRolloutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    /no rollout found for thread id/i.test(message) ||
    /thread .+ is not materialized yet/i.test(message) ||
    /includeTurns is unavailable before first user message/i.test(message)
  )
}

export function isCodexActiveWriterError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /thread .+ already has an active writer/i.test(message)
}

function pendingCodexSessionInfo(sessionId: string, tag: string | null): SessionInfo {
  return {
    sessionId,
    summary: 'New session',
    lastModified: Date.now(),
    tag: tag ?? undefined,
    provider: 'codex',
    capabilities: getProviderCapabilities('codex'),
  }
}

async function resumeCodexThread(sessionId: string): Promise<CodexThreadResumeResponse> {
  const client = getCodexClient()
  return client.request('thread/resume', {
    threadId: sessionId,
  })
}

// Threads already resumed on the current app-server process, mapped to the
// model reported at resume time. thread/resume materializes the rollout
// server-side; once done the thread stays live for the process lifetime, so
// paying the RPC on every send just added a serial round-trip ahead of
// turn/start (first-token latency). Cleared wholesale when the app-server
// child exits — a respawned server has no live threads — and per-thread when
// turn/start reports a missing rollout (see createCodexStream's retry).
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCodexResumedThreads: Map<string, string | null> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCodexResumeInvalidatorInstalled: boolean | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCodexResumeInflight: Map<string, Promise<{ model: string | null }>> | undefined
}
const codexResumedThreads = globalThis.__agentViewerCodexResumedThreads
  ?? (globalThis.__agentViewerCodexResumedThreads = new Map<string, string | null>())
const codexResumeInflight = globalThis.__agentViewerCodexResumeInflight
  ?? (globalThis.__agentViewerCodexResumeInflight = new Map<string, Promise<{ model: string | null }>>())

async function ensureCodexThreadResumed(sessionId: string): Promise<{ model: string | null }> {
  const client = getCodexClient()
  if (!globalThis.__agentViewerCodexResumeInvalidatorInstalled) {
    globalThis.__agentViewerCodexResumeInvalidatorInstalled = true
    client.subscribeDisconnect(() => codexResumedThreads.clear())
  }
  const cached = codexResumedThreads.get(sessionId)
  if (cached !== undefined) return { model: cached }
  const inflight = codexResumeInflight.get(sessionId)
  if (inflight) return inflight
  const resume = resumeCodexThread(sessionId).then((result) => {
    const model = typeof result?.model === 'string' ? result.model : null
    codexResumedThreads.set(sessionId, model)
    return { model }
  })
  codexResumeInflight.set(sessionId, resume)
  resume.finally(() => codexResumeInflight.delete(sessionId)).catch(() => {})
  return resume
}

async function listOpenCodeSessions({ dir }: ListParams): Promise<Session[]> {
  const client = await getOpenCodeClient()
  const response = await client.session.list({
    ...OPENCODE_OPTIONS,
    query: dir ? { directory: dir } : undefined,
  })
  const sessions = openCodeData<OpenCodeSession[]>(response)
  const tags = await getOpenCodeStoredTagsForSessions(sessions.map((session) => session.id))
  return sessions.map((session) => mapOpenCodeSessionToSession(session, tags[session.id] ?? null))
}

async function getOpenCodeSession(sessionId: string): Promise<OpenCodeSession> {
  const client = await getOpenCodeClient()
  const response = await client.session.get({
    ...OPENCODE_OPTIONS,
    path: { id: sessionId },
  })
  return openCodeData<OpenCodeSession>(response)
}

async function getOpenCodeSessionMessages(sessionId: string): Promise<Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>> {
  const client = await getOpenCodeClient()
  const response = await client.session.messages({
    ...OPENCODE_OPTIONS,
    path: { id: sessionId },
    query: { limit: 2000 },
  })
  return openCodeData<Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>>(response)
}

function openCodeDirectoryQuery(session: OpenCodeSession): { directory?: string } | undefined {
  return session.directory ? { directory: session.directory } : undefined
}

async function listPiSessionsForView({ limit, offset, dir }: ListParams): Promise<Session[]> {
  const sessions = await listPiSessions(dir || undefined)
  const sorted = sessions.toSorted((a, b) => b.modified.getTime() - a.modified.getTime())
  const page = sorted.slice(offset, offset + limit)
  const stored = await getPiStoredMetadataForSessions(page.map((s) => s.id))
  return page.map((s) => mapPiSessionToSession(s, stored[s.id] ?? { title: null, tag: null }))
}

async function listLmstudioSessionsForView({ limit, offset, dir }: ListParams): Promise<Session[]> {
  const sessions = await listLmstudioSessions()
  const filtered = dir ? sessions.filter((s) => s.cwd === dir) : sessions
  return filtered.slice(offset, offset + limit).map(mapLmstudioSessionToSession)
}

export function listViewSessions(params: ListParams): Promise<Session[]> {
  return timeAsync('listViewSessions', () => listViewSessionsImpl(params))
}

async function listViewSessionsImpl(params: ListParams): Promise<Session[]> {
  const provider = params.provider ?? await getConfiguredProvider()
  let sessions: Session[]
  if (provider === 'all') {
    const combinedLimit = params.limit + params.offset
    const [claude, codex, opencode, copilot, pi, lmstudio] = await Promise.all([
      listClaudeSessions({ ...params, provider: 'claude', limit: combinedLimit, offset: 0 }),
      listCodexSessions({ ...params, provider: 'codex', limit: combinedLimit, offset: 0 }),
      listOpenCodeSessions({ ...params, provider: 'opencode', limit: combinedLimit, offset: 0 }),
      listCopilotSessions({ ...params, provider: 'copilot', limit: combinedLimit, offset: 0 }),
      listPiSessionsForView({ ...params, provider: 'pi', limit: combinedLimit, offset: 0 }),
      listLmstudioSessionsForView({ ...params, provider: 'lmstudio', limit: combinedLimit, offset: 0 }),
    ])
    sessions = [...claude, ...codex, ...opencode, ...copilot, ...pi, ...lmstudio]
      .sort((a, b) => {
        const aTime = Number(a.lastModified ?? a.createdAt ?? 0)
        const bTime = Number(b.lastModified ?? b.createdAt ?? 0)
        return bTime - aTime
      })
      .slice(params.offset, params.offset + params.limit)
    await syncSessionsBestEffort(sessions)
    return sessions
  }
  if (provider === 'codex') {
    sessions = await listCodexSessions(params)
    await syncSessionsBestEffort(sessions)
    return sessions
  }
  if (provider === 'opencode') {
    sessions = (await listOpenCodeSessions(params)).slice(params.offset, params.offset + params.limit)
    await syncSessionsBestEffort(sessions)
    return sessions
  }
  if (provider === 'copilot') {
    sessions = await listCopilotSessions(params)
    await syncSessionsBestEffort(sessions)
    return sessions
  }
  if (provider === 'pi') {
    sessions = await listPiSessionsForView(params)
    await syncSessionsBestEffort(sessions)
    return sessions
  }
  if (provider === 'lmstudio') {
    sessions = await listLmstudioSessionsForView(params)
    await syncSessionsBestEffort(sessions)
    return sessions
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    // ACP has no session-listing RPC — these sessions are transient/in-memory
    // only, tracked from creation via the running-session registry, never
    // backed by persisted history.
    return []
  }
  sessions = await listClaudeSessions(params)
  await syncSessionsBestEffort(sessions)
  return sessions
}

export async function readViewSessionInfo(sessionId: string, providerOverride?: AgentProvider): Promise<SessionInfo | null> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const tag = await getCodexStoredTag(sessionId)
    let thread: CodexThread | null = null
    let resume: { model: string | null } | null = null
    try {
      thread = await readCodexThread(sessionId, false)
    } catch (err) {
      if (!isCodexMissingRolloutError(err) && !isCodexActiveWriterError(err)) throw err
    }
    try {
      resume = await ensureCodexThreadResumed(sessionId)
    } catch (err) {
      if (!isCodexMissingRolloutError(err) && !isCodexActiveWriterError(err)) throw err
    }
    if (!thread) return pendingCodexSessionInfo(sessionId, tag)
    return mapCodexThreadToSessionInfo(thread, tag, resume?.model ?? null)
  }
  if (provider === 'opencode') {
    const [session, messages, tag] = await Promise.all([
      getOpenCodeSession(sessionId),
      getOpenCodeSessionMessages(sessionId),
      getOpenCodeStoredTag(sessionId),
    ])
    return mapOpenCodeSessionToInfo(
      session,
      tag,
      firstOpenCodePrompt(messages),
      currentOpenCodeModelValue(messages.at(-1)?.info) ?? undefined,
    )
  }
  if (provider === 'copilot') {
    const [metadata, stored, session] = await Promise.all([
      findCopilotSessionMetadata(sessionId),
      getCopilotStoredMetadata(sessionId),
      acquireCopilotSession(sessionId),
    ])

    const [events, currentModel] = await Promise.all([
      session.getEvents(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
    ])

    return mapCopilotSessionToInfo(sessionId, events, stored, metadata, currentModel.modelId)
  }
  if (provider === 'pi') {
    const [sessions, stored] = await Promise.all([
      listPiSessions(),
      getPiStoredMetadata(sessionId),
    ])
    const info = sessions.find((s) => s.id === sessionId)
    if (!info) return null
    const messages = await getPiSessionMessages(sessionId)
    return mapPiSessionToInfo(info, stored, messages)
  }
  if (provider === 'lmstudio') {
    const record = await getLmstudioSession(sessionId)
    if (!record) return null
    return mapLmstudioSessionToInfo(record)
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    // ACP has no session-read RPC — only reflect state for a live pooled
    // session; there is no persisted history to fall back to.
    if (!isAcpSessionAlive(sessionId)) return null
    return {
      sessionId,
      summary: `${provider} session`,
      lastModified: Date.now(),
      provider,
      capabilities: getProviderCapabilities(provider),
    }
  }

  const info = await getSessionInfo(sessionId, claudeSessionStoreOptions())
  if (!info) return null
  return {
    ...info,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }
}

export async function patchViewSession(sessionId: string, body: Record<string, unknown>, providerOverride?: AgentProvider): Promise<void> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    if ('title' in body) {
      await client.request('thread/name/set', {
        threadId: sessionId,
        name: typeof body.title === 'string' ? body.title : '',
      })
      return
    }
    if ('tag' in body) {
      await setCodexStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    if ('title' in body) {
      await client.session.update({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
        body: { title: typeof body.title === 'string' ? body.title : undefined },
      })
      return
    }
    if ('tag' in body) {
      await setOpenCodeStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }
  if (provider === 'copilot') {
    if ('title' in body) {
      await setCopilotStoredTitle(sessionId, typeof body.title === 'string' ? body.title : null)
      return
    }
    if ('tag' in body) {
      await setCopilotStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }
  if (provider === 'pi') {
    if ('title' in body) {
      const title = typeof body.title === 'string' ? body.title : null
      await setPiSessionName(sessionId, title ?? '')
      await setPiStoredTitle(sessionId, title)
      return
    }
    if ('tag' in body) {
      await setPiStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }
  if (provider === 'lmstudio') {
    if ('title' in body) {
      await patchLmstudioSession(sessionId, { title: typeof body.title === 'string' ? body.title : null })
      return
    }
    if ('tag' in body) {
      await patchLmstudioSession(sessionId, { tag: typeof body.tag === 'string' ? body.tag : null })
      return
    }
    throw new Error('title or tag required')
  }

  if ('title' in body) {
    if (typeof body.title !== 'string') throw new Error('title must be a string')
    await renameSession(sessionId, body.title, claudeSessionStoreOptions())
    return
  }
  if ('tag' in body) {
    const tag = body.tag === null || body.tag === undefined ? null
      : typeof body.tag === 'string' ? body.tag
      : (() => { throw new Error('tag must be a string or null') })()
    await tagSession(sessionId, tag, claudeSessionStoreOptions())
    return
  }
  throw new Error('title or tag required')
}

export async function deleteViewSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    await client.session.delete({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
    })
    await removePersistedSessionBestEffort(provider, sessionId)
    return
  }
  if (provider === 'copilot') {
    // Drop any warm session for this id before the SDK deletes it so the next
    // resume reconnects against the new state.
    await evictCopilotSession(sessionId).catch(() => {})
    const client = await getCopilotClient()
    await client.deleteSession(sessionId)
    await removePersistedSessionBestEffort(provider, sessionId)
    return
  }
  if (provider === 'claude') {
    await deleteClaudeSession(sessionId, claudeSessionStoreOptions())
    clearClaudeDynamicMcpServers(sessionId)
    await deleteClaudeHookEvents(sessionId)
    clearWaitingSession(sessionId)
    await removePersistedSessionBestEffort(provider, sessionId)
    return
  }
  if (provider === 'pi') {
    await deletePiSession(sessionId)
    await removePersistedSessionBestEffort(provider, sessionId)
    return
  }
  if (provider === 'lmstudio') {
    await deleteLmstudioSession(sessionId)
    await removePersistedSessionBestEffort(provider, sessionId)
    return
  }
  throw new Error(`Delete is not supported for ${provider} sessions`)
}

function summarizeResolvedClaudeSettings(resolved: Awaited<ReturnType<typeof resolveSettings>>): Record<string, unknown> {
  const effectiveKeys = Object.keys(resolved.effective)
  return {
    effectiveKeys,
    effectiveKeyCount: effectiveKeys.length,
    sources: resolved.sources.map((source) => ({
      source: source.source,
      path: source.path,
      policyOrigin: source.policyOrigin,
      keys: Object.keys(source.settings),
    })),
    sourceCount: resolved.sources.length,
    provenance: Object.fromEntries(Object.entries(resolved.provenance).map(([key, entry]) => [
      key,
      entry ? { source: entry.source, path: entry.path, policyOrigin: entry.policyOrigin } : null,
    ])),
  }
}

export async function runViewSessionAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
  const resolvedProvider = await resolveProvider(provider)
  const action = typeof body.action === 'string' ? body.action : ''

  // Provider-agnostic: deliver a user message into the running turn (native
  // steering). `delivered: false` means no running turn / no steer primitive /
  // the turn ended while the request was in flight — callers fall back to
  // queueing the message for the next turn.
  if (action === 'steer') {
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const turnRequestId = typeof body.turnRequestId === 'string' && body.turnRequestId.trim()
      ? body.turnRequestId.trim()
      : undefined
    const steerRequestId = typeof body.steerRequestId === 'string' && body.steerRequestId.trim()
      ? body.steerRequestId.trim()
      : undefined
    if (!message) throw new Error('message is required')
    if (steerRequestId && steerRequestId.length > 256) throw new Error('steerRequestId is too long')
    if (isNativeComposerCommandText(message)) return { delivered: false }
    try {
      const steered = await steerRunningSessionIdempotent(sessionId, message, turnRequestId, steerRequestId)
      return { delivered: steered.delivered, messageUuid: steered.messageUuid }
    } catch {
      return { delivered: false }
    }
  }

  if (resolvedProvider === 'opencode') {
    const client = await getOpenCodeClient()
    if (action === 'share') {
      const response = await client.session.share({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
      })
      return { session: openCodeData<OpenCodeSession>(response) }
    }
    if (action === 'unshare') {
      await client.session.unshare({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
      })
      return { ok: true }
    }
    if (action === 'summarize') {
      const response = await client.session.summarize({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
      })
      return { ok: openCodeData<boolean>(response) }
    }
    if (action === 'unrevert') {
      const response = await client.session.unrevert({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
      })
      return { session: openCodeData<OpenCodeSession>(response) }
    }
    if (action === 'respondPermission') {
      const permissionID = typeof body.permissionId === 'string' ? body.permissionId : ''
      const response = typeof body.response === 'string' ? body.response : ''
      if (!permissionID) throw new Error('permissionId is required')
      if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw new Error('response must be once, always, or reject')
      }
      const pendingQuestion = getOpenCodeSessionSnapshot(sessionId)?.questions?.find((question) => question.id === permissionID)
      if (pendingQuestion) {
        if (response !== 'reject') throw new Error('OpenCode questions must be answered with respondQuestion')
        const [questionClient, session] = await Promise.all([
          getOpenCodeV2Client(),
          getOpenCodeSession(sessionId),
        ])
        const result = await questionClient.question.reject({
          requestID: permissionID,
          directory: session.directory,
        }, OPENCODE_OPTIONS)
        return { ok: openCodeData<boolean>(result) }
      }
      const result = await client.postSessionIdPermissionsPermissionId({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId, permissionID },
        body: { response },
      })
      return { ok: openCodeData<boolean>(result) }
    }
    if (action === 'respondQuestion') {
      const permissionID = typeof body.permissionId === 'string' ? body.permissionId : ''
      if (!permissionID) throw new Error('permissionId is required')
      const answers = parseQuestionAnswers(body.answers)
      if (!answers) throw new Error('answers is required')
      const [questionClient, session] = await Promise.all([
        getOpenCodeV2Client(),
        getOpenCodeSession(sessionId),
      ])
      let question = getOpenCodeSessionSnapshot(sessionId)?.questions?.find((entry) => entry.id === permissionID)
      if (!question) {
        const pending = await questionClient.question.list(
          session.directory ? { directory: session.directory } : undefined,
          OPENCODE_OPTIONS,
        )
        question = openCodeData<OpenCodeQuestionRequest[]>(pending).find((entry) =>
          entry.id === permissionID && entry.sessionID === sessionId
        )
      }
      if (!question) throw new Error('Question is no longer pending')
      const orderedAnswers = question.questions.map((entry, index) =>
        answers[String(index)]
          ?? answers[entry.question]
          ?? answers[entry.header]
          ?? []
      )
      const result = await questionClient.question.reply({
        requestID: permissionID,
        directory: session.directory,
        answers: orderedAnswers,
      }, OPENCODE_OPTIONS)
      return { ok: openCodeData<boolean>(result) }
    }
  }

  if (resolvedProvider === 'pi') {
    if (action === 'respondPermission') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      if (!permissionId) throw new Error('permissionId is required')
      const response = body.response
      if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw new Error('response must be once, always, or reject')
      }
      respondPiUiPermission(sessionId, permissionId, response)
      return { ok: true }
    }
    if (action === 'respondQuestion') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      if (!permissionId) throw new Error('permissionId is required')
      const answers = parseQuestionAnswers(body.answers)
      if (!answers) throw new Error('answers is required')
      respondPiUiQuestion(sessionId, permissionId, answers)
      return { ok: true }
    }
    if (action === 'summarize') {
      await compactPiSession(sessionId)
      return { ok: true }
    }
  }

  if (resolvedProvider === 'copilot') {
    if (action === 'respondPermission') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      const response = typeof body.response === 'string' ? body.response : ''
      const feedback = typeof body.permissionDecisionReason === 'string' && body.permissionDecisionReason.trim()
        ? body.permissionDecisionReason.trim()
        : undefined
      if (!permissionId) throw new Error('permissionId is required')
      if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw new Error('response must be once, always, or reject')
      }
      const result = copilotPermissionDecision(response, feedback)
      const key = pendingCopilotPermissionKey(sessionId, permissionId)
      const pending = pendingCopilotPermissions.get(key)
      if (pending) {
        pendingCopilotPermissions.delete(key)
        pending.resolve(result)
        return { ok: true }
      }
      let elicitation = pendingCopilotElicitations.get(key)
      if (!elicitation) {
        for (const [pendingKey, candidate] of pendingCopilotElicitations) {
          if (!pendingKey.endsWith(`:${permissionId}`)) continue
          elicitation = candidate
          break
        }
      }
      if (elicitation) {
        elicitation.resolve({
          action: response === 'reject' ? 'decline' : 'accept',
          ...(response === 'reject' ? {} : { content: {} }),
        })
        return { ok: true }
      }
      const session = await acquireCopilotSession(sessionId)
      const handled = await session.rpc.permissions.handlePendingPermissionRequest({
        requestId: permissionId,
        result,
      })
      return { ok: handled.success }
    }
    if (action === 'respondQuestion') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      if (!permissionId) throw new Error('permissionId is required')
      const answers = parseQuestionAnswers(body.answers)
      if (!answers) throw new Error('answers is required')
      const key = pendingCopilotPermissionKey(sessionId, permissionId)
      let elicitation = pendingCopilotElicitations.get(key)
      if (!elicitation) {
        for (const [pendingKey, candidate] of pendingCopilotElicitations) {
          if (!pendingKey.endsWith(`:${permissionId}`)) continue
          elicitation = candidate
          break
        }
      }
      if (!elicitation) throw new Error('Question is no longer pending')
      elicitation.resolve({
        action: 'accept',
        content: elicitationContentFromAnswers(
          { requestedSchema: elicitation.requestedSchema },
          answers,
        ),
      })
      return { ok: true }
    }
    if (action === 'setMode') {
      const mode = parseCopilotMode(body.mode)
      if (!mode) throw new Error('mode must be interactive, plan, autopilot, or shell')
      if (isCopilotPersistentMode(mode)) {
        const session = await acquireCopilotSession(sessionId)
        await session.rpc.mode.set({ mode })
      }
      return { ok: true, mode }
    }
    if (action === 'setPermissionMode') {
      const mode = parseCopilotPermissionMode(body.permissionMode)
      if (!mode) throw new Error('permissionMode must be off, auto, or on')
      const session = await acquireCopilotSession(sessionId)
      const result = await session.rpc.permissions.setAllowAll({ mode })
      return { ok: result.success, mode: result.mode ?? mode }
    }
  }

  if (resolvedProvider === 'claude') {
    // Phase 2: prefer the warm pool entry's persistent Query for control RPCs
    // — avoids spinning a fresh CLI subprocess just to swap a model or
    // reconnect an MCP server. Falls back to createSessionControlQuery only
    // when the session isn't pooled (no recent send → no warm Query).
    if (action === 'respondPermission') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      const response = typeof body.response === 'string' ? body.response : ''
      if (!permissionId) throw new Error('permissionId is required')
      if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw new Error('response must be once, always, or reject')
      }
      const key = pendingClaudePermissionKey(sessionId, permissionId)
      let pending = pendingClaudePermissions.get(key)
      if (!pending) {
        for (const [pendingKey, candidate] of pendingClaudePermissions) {
          if (!pendingKey.endsWith(`:${permissionId}`)) continue
          pending = candidate
          break
        }
      }
      if (!pending) {
        let dialog = pendingClaudeDialogs.get(key)
        if (!dialog) {
          for (const [pendingKey, candidate] of pendingClaudeDialogs) {
            if (!pendingKey.endsWith(`:${permissionId}`)) continue
            dialog = candidate
            break
          }
        }
        if (dialog) {
          dialog.resolve(response === 'reject'
            ? { behavior: 'cancelled' }
            : { behavior: 'completed', result: { continue: true } })
          return { ok: true }
        }
        let elicitation = pendingClaudeElicitations.get(key)
        if (!elicitation) {
          for (const [pendingKey, candidate] of pendingClaudeElicitations) {
            if (!pendingKey.endsWith(`:${permissionId}`)) continue
            elicitation = candidate
            break
          }
        }
        if (!elicitation) throw new Error('Permission request is no longer pending')
        elicitation.resolve({
          action: response === 'reject' ? 'decline' : 'accept',
          ...(response === 'reject' ? {} : { content: {} }),
        })
        return { ok: true }
      }
      pending.resolve(claudePermissionDecision(response, pending))
      return { ok: true }
    }
    // Answer an AskUserQuestion prompt: allow the tool with the user's selected
    // options (and any freeform text) merged into its input.
    if (action === 'respondQuestion') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      if (!permissionId) throw new Error('permissionId is required')
      const answers = parseQuestionAnswers(body.answers)
      if (!answers) throw new Error('answers is required')
      const response = typeof body.response === 'string' && body.response.trim() ? body.response.trim() : undefined
      const annotations = (body.annotations && typeof body.annotations === 'object' && !Array.isArray(body.annotations))
        ? body.annotations as Record<string, { preview?: string; notes?: string }>
        : undefined
      const key = pendingClaudePermissionKey(sessionId, permissionId)
      let pending = pendingClaudePermissions.get(key)
      if (!pending) {
        for (const [pendingKey, candidate] of pendingClaudePermissions) {
          if (!pendingKey.endsWith(`:${permissionId}`)) continue
          pending = candidate
          break
        }
      }
      if (!pending) {
        let dialog = pendingClaudeDialogs.get(key)
        if (!dialog) {
          for (const [pendingKey, candidate] of pendingClaudeDialogs) {
            if (!pendingKey.endsWith(`:${permissionId}`)) continue
            dialog = candidate
            break
          }
        }
        if (dialog) {
          const continueValue = answers.continue?.[0]
          dialog.resolve(continueValue === 'false'
            ? { behavior: 'cancelled' }
            : { behavior: 'completed', result: { continue: true, answers, response, annotations } })
          return { ok: true }
        }
        let elicitation = pendingClaudeElicitations.get(key)
        if (!elicitation) {
          for (const [pendingKey, candidate] of pendingClaudeElicitations) {
            if (!pendingKey.endsWith(`:${permissionId}`)) continue
            elicitation = candidate
            break
          }
        }
        if (!elicitation) throw new Error('Question is no longer pending')
        elicitation.resolve({
          action: 'accept',
          content: elicitationContentFromAnswers(
            { requestedSchema: elicitation.requestedSchema },
            answers,
          ),
        })
        return { ok: true }
      }
      pending.resolve(claudeQuestionDecision(pending, {
        answers: Object.fromEntries(Object.entries(answers).map(([key, values]) => [key, values.join(', ')])),
        response,
        annotations,
      }))
      return { ok: true }
    }
    if (action === 'setModel') {
      const model = typeof body.model === 'string' ? body.model.trim() : ''
      if (!model) throw new Error('model is required')
      const warm = peekClaudeSession(sessionId)
      if (warm) {
        await warm.setModel(model)
        return { ok: true, applied: 'live' }
      }
      // No warm entry — the next send will apply it via body.model on /messages/events.
      return { ok: true, applied: 'next-send' }
    }
    if (action === 'setMcpPermissionModeOverride') {
      const serverName = typeof body.serverName === 'string' ? body.serverName.trim() : ''
      const mode = body.mode === null || body.mode === 'default' || body.mode === 'auto'
        ? body.mode
        : undefined
      if (!serverName) throw new Error('serverName is required')
      if (mode === undefined) throw new Error("mode must be 'default', 'auto', or null")
      const warm = peekClaudeSession(sessionId)
      const q = warm?.query ?? createSessionControlQuery(sessionId)
      try {
        const result = await q.setMcpPermissionModeOverride(serverName, mode)
        return { ok: true, applied: warm ? 'live' : 'cold', ...result }
      } finally {
        if (!warm) q.close()
      }
    }
    if (action === 'setPermissionMode') {
      const mode = parseClaudePermissionMode(body)
      if (!mode) throw new Error('permissionMode is required')
      const warm = peekClaudeSession(sessionId)
      if (warm) {
        await warm.setPermissionMode(mode)
        return { ok: true, applied: 'live' }
      }
      return { ok: true, applied: 'next-send' }
    }
    if (action === 'getContextUsage') {
      const warm = peekClaudeSession(sessionId)
      if (!warm) {
        // Don't spin a subprocess for a getter — the next pooled send will
        // emit a fresh usage event at the top of its stream anyway.
        return { ok: true, applied: 'cold', usage: null }
      }
      const usage = await warm.query.getContextUsage()
      return { ok: true, applied: 'live', usage }
    }
    if (action === 'backgroundTasks') {
      const backgrounded = await backgroundRunningSession(sessionId)
      return { ok: true, backgrounded }
    }
    if (action === 'stopTask') {
      const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
      if (!taskId) throw new Error('taskId is required')
      // A background task only exists inside the live Query that spawned it; a
      // fresh control query (different subprocess) wouldn't know about it. So
      // unlike the MCP RPCs above there's no cold fallback — without a warm
      // entry there's nothing running to stop.
      const warm = peekClaudeSession(sessionId)
      if (!warm) return { ok: true, applied: 'cold', stopped: false }
      await warm.query.stopTask(taskId)
      return { ok: true, applied: 'live', stopped: true }
    }
    if (action === 'reconnectMcpServer') {
      const serverName = typeof body.serverName === 'string' ? body.serverName : ''
      if (!serverName) throw new Error('serverName is required')
      const warm = peekClaudeSession(sessionId)
      if (warm) {
        await warm.query.reconnectMcpServer(serverName)
        return { ok: true, applied: 'live' }
      }
      const q = createSessionControlQuery(sessionId)
      try {
        await q.reconnectMcpServer(serverName)
        return { ok: true, applied: 'cold' }
      } finally {
        q.close()
      }
    }
    if (action === 'toggleMcpServer') {
      const serverName = typeof body.serverName === 'string' ? body.serverName : ''
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : null
      if (!serverName) throw new Error('serverName is required')
      if (enabled === null) throw new Error('enabled (boolean) is required')
      const warm = peekClaudeSession(sessionId)
      if (warm) {
        await warm.query.toggleMcpServer(serverName, enabled)
        return { ok: true, applied: 'live' }
      }
      const q = createSessionControlQuery(sessionId)
      try {
        await q.toggleMcpServer(serverName, enabled)
        return { ok: true, applied: 'cold' }
      } finally {
        q.close()
      }
    }
    if (action === 'setMcpServers') {
      const previousServers = getClaudeDynamicMcpServers(sessionId)
      let servers
      if (body.operation === 'add') {
        const serverName = typeof body.serverName === 'string' ? body.serverName.trim() : ''
        if (!serverName) throw new Error('serverName is required')
        const parsed = parseClaudeDynamicMcpServers({ [serverName]: body.config })
        servers = { ...getClaudeDynamicMcpServers(sessionId), ...parsed }
      } else if (body.operation === 'remove') {
        const serverName = typeof body.serverName === 'string' ? body.serverName.trim() : ''
        if (!serverName) throw new Error('serverName is required')
        servers = getClaudeDynamicMcpServers(sessionId)
        delete servers[serverName]
      } else {
        servers = parseClaudeDynamicMcpServers(body.servers)
      }
      setClaudeDynamicMcpServers(sessionId, servers)
      const warm = peekClaudeSession(sessionId)
      if (!warm) {
        return { ok: true, applied: 'next-send', dynamicServers: Object.keys(servers).sort(), added: [], removed: [], errors: {} }
      }
      const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined)
      const context = { getSessionId: () => sessionId, getCwd: () => info?.cwd }
      try {
        const result = await warm.query.setMcpServers(claudeIntegratedMcpServers(context, sessionId))
        const statuses = await warm.query.mcpServerStatus()
        const authRequired = statuses.filter((status) => status.status === 'needs-auth').map((status) => status.name)
        return { ok: true, applied: 'live', dynamicServers: Object.keys(servers).sort(), statuses, authRequired, ...result }
      } catch (error) {
        // Keep the next spawn/recycle compatible with the live query when the
        // SDK rejects the replacement atomically. Connection/auth errors are
        // returned in McpSetServersResult.errors and intentionally remain
        // configured so the user can authenticate or reconnect them.
        setClaudeDynamicMcpServers(sessionId, previousServers)
        throw error
      }
    }
    if (action === 'reloadPlugins') {
      const warm = peekClaudeSession(sessionId)
      if (warm) {
        const result = await warm.query.reloadPlugins()
        return {
          applied: 'live',
          plugins: result.plugins ?? [],
          commands: result.commands?.length ?? 0,
          agents: result.agents?.length ?? 0,
          mcpServers: result.mcpServers?.length ?? 0,
        }
      }
      const q = createSessionControlQuery(sessionId)
      try {
        const result = await q.reloadPlugins()
        return {
          applied: 'cold',
          plugins: result.plugins ?? [],
          commands: result.commands?.length ?? 0,
          agents: result.agents?.length ?? 0,
          mcpServers: result.mcpServers?.length ?? 0,
        }
      } finally {
        q.close()
      }
    }
    if (action === 'reloadSkills') {
      const warm = peekClaudeSession(sessionId)
      const q = warm?.query ?? createSessionControlQuery(sessionId)
      try {
        const result = await q.reloadSkills()
        return { ok: true, applied: warm ? 'live' : 'cold', ...result }
      } finally {
        if (!warm) q.close()
      }
    }
    if (action === 'resolveSettings') {
      const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined)
      return { ok: true, ...summarizeResolvedClaudeSettings(await resolveSettings({ cwd: info?.cwd })) }
    }
    if (action === 'inspectClaudeRuntime') {
      const warm = peekClaudeSession(sessionId)
      const q = warm?.query ?? createSessionControlQuery(sessionId)
      try {
        const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined)
        const [settings, commands, agents, mcpServers] = await Promise.all([
          resolveSettings({ cwd: info?.cwd }),
          q.supportedCommands(),
          q.supportedAgents(),
          q.mcpServerStatus(),
        ])
        return {
          ok: true,
          applied: warm ? 'live' : 'cold',
          settings: summarizeResolvedClaudeSettings(settings),
          commands,
          agents,
          mcpServers,
          dynamicMcpServers: claudeDynamicMcpServerNames(sessionId),
          processTransport: claudeProcessTransportStatus(),
        }
      } finally {
        if (!warm) q.close()
      }
    }
    if (action === 'listHookEvents') {
      const query = typeof body.query === 'string' ? body.query : undefined
      const limit = typeof body.limit === 'number' ? body.limit : undefined
      const events = await listClaudeHookEvents(sessionId, { query, limit })
      return { ok: true, events, query: query ?? '', count: events.length }
    }
    if (action === 'readFile') {
      const path = typeof body.path === 'string' ? body.path.trim() : ''
      const encoding = body.encoding === 'base64' ? 'base64' as const : 'utf-8' as const
      const maxBytes = typeof body.maxBytes === 'number' && Number.isFinite(body.maxBytes)
        ? Math.max(1, Math.min(10 * 1024 * 1024, Math.floor(body.maxBytes)))
        : 512 * 1024
      if (!path || path.includes('\0')) throw new Error('path is required')
      const warm = peekClaudeSession(sessionId)
      const q = warm?.query ?? createSessionControlQuery(sessionId)
      try {
        const file = await q.readFile(path, { maxBytes, encoding })
        return { ok: file !== null, applied: warm ? 'live' : 'cold', file }
      } finally {
        if (!warm) q.close()
      }
    }
  }

  if (resolvedProvider === 'codex') {
    if (action === 'respondPermission') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      const response = typeof body.response === 'string' ? body.response : ''
      if (!permissionId) throw new Error('permissionId is required')
      if (!response) throw new Error('response is required')
      respondCodexApproval(sessionId, permissionId, response)
      return { ok: true }
    }
    if (action === 'respondQuestion') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      const answers = parseQuestionAnswers(body.answers)
      if (!permissionId) throw new Error('permissionId is required')
      if (!answers) throw new Error('answers is required')
      respondCodexQuestion(sessionId, permissionId, answers)
      return { ok: true }
    }
  }

  if (resolvedProvider === 'claude-acp' || resolvedProvider === 'codex-acp') {
    if (action === 'respondPermission') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      const response = typeof body.response === 'string' ? body.response : ''
      if (!permissionId) throw new Error('permissionId is required')
      if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw new Error('response must be once, always, or reject')
      }
      respondAcpPermissionDecision(sessionId, permissionId, response)
      return { ok: true }
    }
    if (action === 'respondQuestion') {
      const permissionId = typeof body.permissionId === 'string' ? body.permissionId : ''
      const answers = parseQuestionAnswers(body.answers)
      if (!permissionId) throw new Error('permissionId is required')
      if (!answers) throw new Error('answers is required')
      // Elicitation content is one primitive value per schema property (the
      // AskUserQuestion picker's PendingQuestion.id === the schema property
      // name — see parseMcpElicitationQuestions). Multi-select answers join;
      // this transport doesn't support multi-value elicitation content.
      const content: Record<string, string> = {}
      for (const [key, values] of Object.entries(answers)) content[key] = values.join(', ')
      resolveAcpElicitation(sessionId, permissionId, { action: 'accept', content })
      return { ok: true }
    }
  }

  throw new Error(`Action ${action || '(missing)'} is not supported for ${resolvedProvider} sessions`)
}

async function readCodexMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  let thread: CodexThread
  try {
    thread = await readCodexThreadWithFullTurns(sessionId)
  } catch (err) {
    if (isCodexMissingRolloutError(err)) return []
    if (isCodexActiveWriterError(err)) return readLatestMappedMessagesCache(`codex:${sessionId}`) ?? []
    throw err
  }
  const turns = thread.turns
  // ThreadStatus is a discriminated union; TurnError is an object — both
  // need flat keys for cache fingerprinting or they'd stringify to "[object
  // Object]" and miss invalidations.
  const threadStatusKey = thread.status.type === 'active'
    ? `active:${thread.status.activeFlags.join(',')}`
    : thread.status.type
  // Codex may update an earlier assistant item after a tool-heavy turn has
  // already appended later tool/result items. Fingerprint the whole turn
  // sequence so those in-place item updates invalidate the mapped transcript.
  const turnsSignature = compactStableFingerprint(turns)
  const signature = [
    thread.updatedAt,
    threadStatusKey,
    turns.length,
    turnsSignature,
  ].join(':')
  const cached = readMappedMessagesCache(`codex:${sessionId}`, signature)
  if (cached) return cached
  const messages = sortMessagesChronologically(mapCodexThreadToMessages(thread))
  return writeMappedMessagesCache(`codex:${sessionId}`, signature, messages)
}

async function readOpenCodeMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  const raw = await getOpenCodeSessionMessages(sessionId)
  const last = raw.at(-1)
  const lastPart = last?.parts.at(-1) as { id?: string } | undefined
  const signature = `${raw.length}:${last?.info.id ?? ''}:${last?.parts.length ?? 0}:${lastPart?.id ?? ''}`
  const cached = readMappedMessagesCache(`opencode:${sessionId}`, signature)
  if (cached) return cached
  const messages = sortMessagesChronologically(mapOpenCodeMessagesToSessionMessages(raw))
  return writeMappedMessagesCache(`opencode:${sessionId}`, signature, messages)
}

async function readCopilotMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  const persistedEvents = await readCopilotSessionEvents(sessionId)
  const liveEvents = getCopilotLiveTranscriptEvents(sessionId)
  const filteredLiveEvents = filterCopilotLiveEvents(persistedEvents, liveEvents)
  const events = mergeCopilotSessionEvents(persistedEvents, filteredLiveEvents)
  const last = events.at(-1) as { id?: string; type?: string } | undefined
  const liveKeys = new Set(mapCopilotEventsToSessionMessages(sessionId, filteredLiveEvents).map(sessionMessageIdentity))
  const signature = `${events.length}:${last?.id ?? ''}:${last?.type ?? ''}:${copilotLiveTranscriptSignature(filteredLiveEvents)}`
  const cached = readMappedMessagesCache(`copilot:${sessionId}`, signature)
  if (cached) return cached
  const messages = markLiveSessionMessages(
    sortMessagesChronologically(mapCopilotEventsToSessionMessages(sessionId, events)),
    liveKeys,
  )
  return writeMappedMessagesCache(`copilot:${sessionId}`, signature, messages)
}

async function readPiMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  const entries = await getPiSessionEntries(sessionId)
  const persistedEntries = entries.filter((entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message')
  const raw = persistedEntries.map((entry) => entry.message)
  const live = getPiLiveTranscriptMessages(sessionId, raw)
  // Pi AgentMessages do not carry SessionEntry ids. Length + role therefore
  // misses a native branch switch that replaces the active leaf with another
  // message of the same role and depth. Fingerprint the leaf so the mapped
  // transcript cache follows Pi's append-only branch graph correctly.
  const last = persistedEntries.at(-1)
  const signature = `${raw.length}:${last?.id ?? ''}:${last ? piAgentMessageFingerprint(last.message) : ''}:${piLiveTranscriptSignature(live)}`
  const cached = readMappedMessagesCache(`pi:${sessionId}`, signature)
  if (cached) return cached
  const persistedMessages = mapPiEntriesToSessionMessages(sessionId, entries)
  const mappedLiveMessages = mapPiMessagesToSessionMessages(sessionId, live)
  const liveKeys = new Set(mappedLiveMessages.map(sessionMessageIdentity))
  const messages = sortMessagesChronologically([...persistedMessages, ...mappedLiveMessages])
  const markedMessages = markLiveSessionMessages(messages, liveKeys)
  return writeMappedMessagesCache(`pi:${sessionId}`, signature, markedMessages)
}

function readAcpMessagesAll(sessionId: string, provider: 'claude-acp' | 'codex-acp'): SessionMessage[] {
  const { messages } = readAcpMessagesSince(sessionId, -1)
  return mapAcpBufferedMessages(sessionId, provider, messages)
}

export function listViewSessionMessageWindow(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessageWindow> {
  return timeAsync('listViewSessionMessageWindow', () => listViewSessionMessageWindowImpl(sessionId, params, providerOverride))
}

async function listViewSessionMessageWindowImpl(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessageWindow> {
  const provider = await resolveProvider(providerOverride)
  let messages: SessionMessage[]
  if (provider === 'codex') {
    messages = await readCodexMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return windowForParams(messages, params)
  }
  if (provider === 'opencode') {
    messages = await readOpenCodeMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return windowForParams(messages, params)
  }
  if (provider === 'copilot') {
    messages = await readCopilotMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return windowForParams(messages, params)
  }
  if (provider === 'pi') {
    messages = await readPiMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return windowForParams(messages, params)
  }
  if (provider === 'lmstudio') {
    const record = await getLmstudioSession(sessionId)
    messages = record ? mapLmstudioSessionToMessages(record) : []
    await syncMessagesBestEffort(provider, sessionId, messages)
    return windowForParams(messages, params)
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    messages = readAcpMessagesAll(sessionId, provider)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return windowForParams(messages, params)
  }
  messages = await readClaudeSessionMessages(sessionId)
  await syncMessagesBestEffort(provider, sessionId, messages)
  return windowForParams(messages, params)
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
  if (provider === 'opencode') {
    // OpenCode subagents (spawned by the `task` tool) are real child sessions:
    // task_id === child sessionId. Fetch and map the child transcript so the
    // parent's task card can render the inner conversation inline.
    const raw = await getOpenCodeSessionMessages(agentId).catch(() => [] as Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>)
    if (raw.length === 0) return []
    const mapped = sortMessagesChronologically(mapOpenCodeMessagesToSessionMessages(raw))
    return withOriginKind(mapped, `subagent:${agentId}`)
  }
  if (provider !== 'claude') return []
  const raw = await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
    .catch(() => [] as SessionMessage[])
  return withOriginKind(normalizeClaudeHistoryMessages(raw as unknown[]), `subagent:${agentId}`)
}

/**
 * Lightweight per-subagent summary (message count + aggregate token usage,
 * not full content) for sidebar nesting. Claude subagents aren't real
 * top-level sessions, so this is how the sidebar learns they exist at all.
 */
export async function getClaudeSubagentSummaries(sessionId: string, providerOverride?: AgentProvider): Promise<SubagentSummary[]> {
  const provider = await resolveProvider(providerOverride)
  if (provider !== 'claude') return []
  const subagentIds = await listSubagents(sessionId, claudeSessionStoreOptions()).catch(() => [] as string[])
  if (subagentIds.length === 0) return []

  const summaries = await mapConcurrent(subagentIds, 4, async (agentId): Promise<SubagentSummary | null> => {
    const raw = await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
      .catch(() => [] as SessionMessage[])
    if (raw.length === 0) return null
    const messages = normalizeClaudeHistoryMessages(raw as unknown[])
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let taskDescription: string | undefined
    let startedAt: string | undefined
    let endedAt: string | undefined
    for (const msg of messages) {
      if (msg.timestamp) {
        if (!startedAt) startedAt = msg.timestamp
        endedAt = msg.timestamp
      }
      if (!taskDescription && msg.taskDescription) taskDescription = msg.taskDescription
      const apiMessage = msg.message as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null } } | undefined
      const usage = apiMessage?.usage
      if (usage) {
        inputTokens += usage.input_tokens ?? 0
        outputTokens += usage.output_tokens ?? 0
        cacheReadTokens += usage.cache_read_input_tokens ?? 0
      }
    }
    return {
      agentId,
      taskDescription,
      messageCount: messages.length,
      usage: { inputTokens, outputTokens, cacheReadTokens },
      startedAt,
      endedAt,
      provider: 'claude',
    }
  })
  return summaries.filter((s): s is SubagentSummary => s !== null)
}

async function listProviderSessionsForIndex(params: {
  provider: AgentProvider
  dir?: string
  includeWorktrees: boolean
}): Promise<Session[]> {
  const byKey = new Map<string, Session>()
  let offset = 0

  while (true) {
    const page = await listViewSessions({
      limit: INDEX_REBUILD_PAGE_SIZE,
      offset,
      dir: params.dir,
      includeWorktrees: params.includeWorktrees,
      provider: params.provider,
    })

    for (const session of page) {
      byKey.set(`${session.provider ?? params.provider}:${session.sessionId}`, {
        ...session,
        provider: session.provider ?? params.provider,
      })
    }

    if (page.length < INDEX_REBUILD_PAGE_SIZE) break
    offset += page.length
  }

  return [...byKey.values()]
}

export async function rebuildViewSessionIndex(params: RebuildSessionIndexParams = {}): Promise<SessionIndexRebuildResult> {
  const provider = params.provider ?? 'all'
  const includeWorktrees = params.includeWorktrees !== false
  const scannedProviders = provider === 'all' ? INDEX_REBUILD_PROVIDERS : [provider]
  const startedAt = new Date().toISOString()
  const errors: SessionIndexRebuildError[] = []
  let sessionCount = 0
  let messageCount = 0

  await clearPersistedSessionIndex()
  persistedSessionListSignatures.clear()

  for (const currentProvider of scannedProviders) {
    let sessions: Session[]
    try {
      sessions = await listProviderSessionsForIndex({
        provider: currentProvider,
        dir: params.dir,
        includeWorktrees,
      })
      sessionCount += sessions.length
    } catch (err) {
      errors.push({
        provider: currentProvider,
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    const results = await mapConcurrent(sessions, INDEX_REBUILD_MESSAGE_CONCURRENCY, async (session) => {
      try {
        const messages = await listViewSessionMessages(
          session.sessionId,
          { limit: INDEX_REBUILD_MESSAGE_LIMIT, offset: 0 },
          session.provider ?? currentProvider,
        )
        return { ok: true as const, count: messages.length }
      } catch (err) {
        return {
          ok: false as const,
          provider: session.provider ?? currentProvider,
          sessionId: session.sessionId,
          message: err instanceof Error ? err.message : String(err),
        }
      }
    })

    for (const result of results) {
      if (result.ok) {
        messageCount += result.count
      } else {
        errors.push({
          provider: result.provider,
          sessionId: result.sessionId,
          message: result.message,
        })
      }
    }
  }

  const stats = await readPersistedIndexStats({ provider, dir: params.dir, includeWorktrees })
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    provider,
    scannedProviders,
    sessions: sessionCount,
    messages: messageCount,
    errors,
    stats,
  }
}

// Project-view sessions list rarely changes between 2 s polls. Cache the
// list scan briefly so the per-poll fan-out into per-session message reads
// doesn't also re-list every provider every tick.
const PROJECT_SESSIONS_TTL = 5_000
type ProjectSessionsCacheEntry = { sessions: Session[]; ts: number }
const projectSessionsCache = new Map<string, ProjectSessionsCacheEntry>()

function pruneProjectSessionsCache() {
  const deadline = Date.now() - PROJECT_SESSIONS_TTL * 3
  for (const [key, entry] of projectSessionsCache) {
    if (entry.ts < deadline) projectSessionsCache.delete(key)
  }
}

export async function listProjectSessionMessageBatches(params: ProjectMessageBatchParams): Promise<{
  sessions: Session[]
  batches: Array<{
    key: string
    sessionId: string
    provider?: AgentProvider
    offset: number
    messages: SessionMessage[]
  }>
}> {
  const cacheKey = `${params.provider ?? ''}:${params.includeWorktrees ? '1' : '0'}:${params.dir}`
  const cached = projectSessionsCache.get(cacheKey)
  let sessions: Session[]
  if (cached && Date.now() - cached.ts < PROJECT_SESSIONS_TTL) {
    sessions = cached.sessions
  } else {
    sessions = await listViewSessions({
      limit: 500,
      offset: 0,
      dir: params.dir,
      includeWorktrees: params.includeWorktrees,
      provider: params.provider,
    })
    pruneProjectSessionsCache()
    projectSessionsCache.set(cacheKey, { sessions, ts: Date.now() })
  }

  const batches = await mapConcurrent(sessions, 10, async (session) => {
    const key = `${session.provider ?? 'claude'}:${session.sessionId}`
    const hasKnownOffset = Object.prototype.hasOwnProperty.call(params.offsets, key)
    const offset = Math.max(0, params.offsets[key] ?? 0)
    const limit = offset === 0 && !hasKnownOffset ? params.initialLimit : params.incrementalLimit
    const messages = limit > 0
      ? await listViewSessionMessages(session.sessionId, { offset, limit }, session.provider)
      : []

    return {
      key,
      sessionId: session.sessionId,
      provider: session.provider,
      offset,
      messages,
    }
  })

  return {
    sessions,
    batches: batches.filter((batch) =>
      batch.messages.length > 0 || !Object.prototype.hasOwnProperty.call(params.offsets, batch.key),
    ),
  }
}

const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'] as const
type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number]

function parseClaudePermissionMode(body: Record<string, unknown>): ClaudePermissionMode | undefined {
  const mode = typeof body.permissionMode === 'string' ? body.permissionMode : ''
  return CLAUDE_PERMISSION_MODES.includes(mode as ClaudePermissionMode)
    ? mode as ClaudePermissionMode
    : undefined
}

// A Claude `result` message can report a non-success terminal state
// (max-turns / budget / execution error) or a recovered-but-errored API call
// (subtype 'success' with is_error + api_error_status). The SDK surfaces these
// inline in the CLI; without this the turn just goes quiet. Returns a
// human-readable error string plus the raw HTTP status when the SDK reported
// one, so callers can classify retryability structurally instead of parsing
// the message text; null when the result is a clean success.
export function claudeResultErrorMessage(msg: Record<string, unknown>): { message: string; apiErrorStatus?: number } | null {
  if (msg.type !== 'result') return null
  const subtype = typeof msg.subtype === 'string' ? msg.subtype : ''
  if (subtype === 'error_max_turns') return { message: 'Claude reached the maximum number of turns before finishing.' }
  if (subtype === 'error_max_budget_usd') return { message: 'Claude reached the maximum cost budget before finishing.' }
  if (subtype === 'error_max_structured_output_retries') return { message: 'Claude could not produce a valid structured response.' }
  if (subtype === 'error_during_execution') {
    const errors = Array.isArray(msg.errors) ? msg.errors.filter((entry): entry is string => typeof entry === 'string') : []
    return { message: errors.length ? `Claude hit an error: ${errors.join('; ')}` : 'Claude hit an error during execution.' }
  }
  if (subtype === 'success' && msg.is_error === true) {
    const apiErrorStatus = typeof msg.api_error_status === 'number' ? msg.api_error_status : undefined
    const status = apiErrorStatus != null ? ` (HTTP ${apiErrorStatus})` : ''
    const detail = typeof msg.result === 'string' && msg.result.trim() ? `: ${msg.result.trim()}` : ''
    return { message: `Claude API error${status}${detail}`, apiErrorStatus }
  }
  return null
}

// Pool-internal failures surface with implementation-detail wording
// ("Claude pool entry was recycled mid-turn", "Claude turn exceeded hard
// timeout") that reads as a cryptic app error rather than what actually
// happened — the subprocess died or stalled. Map the known ones to plain
// language; anything else (a real SDK/API error) passes through unchanged
// since its message is already meant for a user.
function friendlyClaudePoolError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error'
  if (message.includes('exceeded hard timeout')) {
    return 'Claude stopped responding and the turn was cancelled after 10 minutes of silence. Please try again.'
  }
  if (message.includes('recycled mid-turn') || message.includes('recycled before turn could start') || message.includes('entry was recycled')) {
    return 'Lost connection to Claude mid-turn. Please try again.'
  }
  return message
}

// Heartbeat cadence for the Claude POST send stream. Unlike the GET events SSE,
// the send stream can legitimately go quiet for long stretches (waiting on the
// first token, a slow tool call) with no frames. A periodic heartbeat keeps
// intermediaries (proxies, load balancers) from idle-closing the connection and
// gives the client a liveness pulse so it can distinguish "model still working"
// from "socket silently died" — the client stall watchdog keys off it. 15s sits
// comfortably under common 30–60s proxy idle timeouts.
const CLAUDE_STREAM_HEARTBEAT_MS = 15_000

// A reused warm pool subprocess can die silently between turns (the model API
// socket drops, the OS reaps the child, or an internal CLI fault hasn't yet
// surfaced as an iterator throw). Its `isAlive()` flag still reads true, so
// acquire() hands it back and the pushed user message lands in an input stream
// nothing drains — the turn then hangs until the pool's 10-min hard timeout
// while server heartbeats keep the client's socket watchdog satisfied (so the
// existing stall-reconnect never fires either). getContextUsage() is a
// control-channel RPC the subprocess answers in a few ms regardless of model
// latency, so a reused entry that can't answer within this window — and has
// emitted no turn frames — is treated as dead: we recycle it and respawn a
// fresh subprocess for one transparent retry. 4s is ~100x the healthy answer
// time, far below the hang it replaces, and a false positive costs only one
// invisible respawn, not a broken turn.
const CLAUDE_WARM_LIVENESS_PROBE_MS = 4000
const CLAUDE_WARM_MAX_RESPAWN = 1

async function createClaudeStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const turnRequestId = parseTurnRequestId(body)
  const agentPolicy = parseClaudeAgentPolicy(body.claudeAgentPolicy)
  const explicitModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const isPendingSession = Boolean(body.isPendingSession)
  const manualPermissions = body.manualPermissions === true
  const detachOnClientAbort = body.detachOnClientAbort === true
  const permissionMode = agentPolicy?.permissionMode ?? parseClaudePermissionMode(body)
  // Leave model unset when the composer hasn't picked one yet — for both
  // pending and resumed sessions. The SDK/CLI already falls back to its own
  // configured default (respecting ANTHROPIC_MODEL, settings.json, or a
  // custom base URL/Bedrock/Vertex deployment) when `model` is omitted; a
  // hardcoded literal here would override that and throw "invalid model" on
  // machines where that literal isn't a recognized model id.
  const model = agentPolicy?.model ?? explicitModel
  const fallbackModel = claudeFallbackModelChain()
  const effort = agentPolicy?.effort ?? parseEffort(body)
  const attachments = parseAttachments(body)
  // Input-box bash mode (`!command`) — runs locally then persists in the CLI's
  // native transcript shape. With attachments it falls back to a normal send.
  const bangShell = userMessage.startsWith('!') && attachments.length === 0
    ? userMessage.slice(1).trim()
    : null
  if (bangShell !== null && !bangShell) {
    return NextResponse.json({ error: 'Enter a shell command after !' }, { status: 400 })
  }
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const resumeDropsTurn = typeof body.resumeDropsTurn === 'string' ? body.resumeDropsTurn : undefined
  const forkSessionOnSend = Boolean(body.forkSession)
  const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const taskBudgetTotal = typeof body.taskBudgetTokens === 'number' && body.taskBudgetTokens > 0
    ? Math.floor(body.taskBudgetTokens)
    : undefined
  const maxBudgetUsd = typeof body.maxBudgetUsd === 'number' && Number.isFinite(body.maxBudgetUsd) && body.maxBudgetUsd > 0
    ? body.maxBudgetUsd
    : undefined
  const enableWorkflow = body.enableWorkflow === true

  // Cold-path conditions: brand-new session (no id yet), fork (creates a new
  // conversation root), or rewind (changes the resume point). These mutate
  // the conversation root or don't have a stable id to key the pool on, so we
  // run the legacy single-shot query() and let the pool catch up on turn 2.
  // manualPermissions is no longer a cold-path trigger — the pool supports
  // per-turn bridges via the bridgeBox delegation pattern.
  //
  // Exception: a pending session that was already prewarmed (composer focus
  // triggers acquireClaudeSession with a forced `sessionId` — see
  // prewarmViewSession) has a warm entry sitting in the pool under this exact
  // id already. Route straight to the pooled path so the first real send
  // reuses it instead of cold-spawning a redundant second subprocess. If
  // prewarm hasn't completed yet (or never ran), peek finds nothing and this
  // falls through to the cold path exactly as before.
  const pendingWarmEntry = isPendingSession && !forkSessionOnSend && !resumeSessionAt
    ? peekClaudeSession(sessionId)
    : null
  const useColdPath = (isPendingSession && !pendingWarmEntry) || forkSessionOnSend || Boolean(resumeSessionAt)

  if (useColdPath) {
    return createClaudeStreamCold({
      sessionId,
      signal,
      userMessage,
      attachments,
      bangShell,
      isPendingSession,
      permissionMode,
      manualPermissions,
      detachOnClientAbort,
      model,
      effort,
      resumeSessionAt,
      resumeDropsTurn,
      forkSessionOnSend,
      cwdOverride,
      taskBudgetTotal,
      maxBudgetUsd,
      enableWorkflow,
      turnRequestId,
      fallbackModel,
      agentPolicy,
    })
  }

  return createClaudeStreamPooled({
    sessionId,
    signal,
    userMessage,
    attachments,
    bangShell,
    permissionMode,
    manualPermissions,
    model,
    effort,
    cwdOverride,
    taskBudgetTotal,
    maxBudgetUsd,
    enableWorkflow,
    turnRequestId,
    fallbackModel,
    agentPolicy,
    // Threaded through even though the common case (prewarm already spawned
    // a compatible entry) never uses it — if the warm entry turns out
    // incompatible (cwd/effort/taskBudget changed since prewarm) or died,
    // acquireClaudeSession recycles and respawns; a pending session has
    // nothing on disk yet, so that respawn must still force `sessionId`
    // instead of trying to `resume` a conversation that doesn't exist.
    isPendingSession: isPendingSession && Boolean(pendingWarmEntry),
  })
}

type ClaudeStreamColdArgs = {
  sessionId: string
  signal: AbortSignal
  userMessage: string
  attachments: SendAttachment[]
  /** Non-null when the message is an input-box `!command` (bash mode). */
  bangShell: string | null
  isPendingSession: boolean
  permissionMode: ClaudePermissionMode | undefined
  manualPermissions: boolean
  detachOnClientAbort: boolean
  model: string | undefined
  effort: ReasoningEffortLevel | undefined
  resumeSessionAt: string | undefined
  resumeDropsTurn: string | undefined
  forkSessionOnSend: boolean
  cwdOverride: string | undefined
  taskBudgetTotal: number | undefined
  maxBudgetUsd: number | undefined
  enableWorkflow: boolean
  turnRequestId: string | undefined
  fallbackModel: string | undefined
  agentPolicy: ClaudeAgentPolicy | undefined
}

async function createClaudeStreamCold(args: ClaudeStreamColdArgs): Promise<Response> {
  const {
    sessionId,
    signal,
    userMessage,
    attachments,
    bangShell,
    isPendingSession,
    permissionMode,
    manualPermissions,
    detachOnClientAbort,
    model,
    effort,
    resumeSessionAt,
    resumeDropsTurn,
    forkSessionOnSend,
    cwdOverride,
    taskBudgetTotal,
    maxBudgetUsd,
    enableWorkflow,
    turnRequestId,
    fallbackModel,
    agentPolicy,
  } = args

  // Build the user message in the same SDKUserMessage shape the pool uses,
  // and push it onto a queue-based input stream. Two reasons:
  //   1) The stream stays open after turn 1 ends, so the SDK's Query
  //      iterator stays open and we can hand the Query off to the pool.
  //   2) The pool can keep pushing future turns onto the same stream.
  // Bash mode (`!command`) defers its pushes until the command has run — see
  // the bang branch inside start() below.
  const { pushUserMessage, endInput, iterable } = createInputStream()
  if (bangShell == null) {
    pushUserMessage(await buildClaudeUserMessage(userMessage, attachments, cwdOverride))
  }

  const encoder = new TextEncoder()
  const abortController = new AbortController()

  // Snapshot of the options we constructed the Query with — passed to the
  // pool on adopt so future acquires can compatibility-check against it.
  const adoptOptions = {
    sessionId,
    cwd: cwdOverride,
    model,
    fallbackModel,
    permissionMode,
    effort,
    resumeSessionAt,
    forkSession: forkSessionOnSend,
    taskBudgetTokens: taskBudgetTotal,
    maxBudgetUsd,
    enableWorkflow,
    agentPolicy,
  }

  // Bridge is only needed for interactive approval modes; bypass and plan
  // handle all tool decisions automatically via permissionMode.
  const bridgeInstalled = manualPermissions
    && permissionMode !== 'bypassPermissions'
    && permissionMode !== 'plan'

  const stream = new ReadableStream({
    async start(controller) {
      const bridgedPermissionIds = new Set<string>()
      let downstreamClosed = false
      let clientDetached = false
      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }
      // Commit headers/body immediately, before CLI startup or initialization.
      // SSE comments are ignored by both clients and do not count as model output.
      safeEnqueue(':ok\n\n')
      // Named handler so we can detach it on successful adoption — otherwise a
      // post-turn client disconnect would abort the Query we just gave to the pool.
      const propagateAbort = () => {
        if (detachOnClientAbort) {
          clientDetached = true
          downstreamClosed = true
          // The turn and its permission resolver remain alive. A replacement
          // client retrieves the retained request through /running and answers
          // it by id; navigation must not silently deny provider work.
          return
        }
        abortController.abort()
      }
      if (signal.aborted) {
        propagateAbort()
      } else {
        signal.addEventListener('abort', propagateAbort)
      }
      // Mutable per-turn bridge installed in the query at construction time so
      // the delegation closure survives pool adoption. The bridge is set below
      // (after q is created) and cleared in the finally block so future pool
      // turns can swap in a fresh bridge without recycling the subprocess.
      const bridgeBox: ClaudeBridgeBox = { fn: null, elicit: null, dialog: null }
      const viewerContext = {
        sessionId,
        getSessionId: () => viewerContext.sessionId,
        getCwd: () => cwdOverride,
      }

      const q = query({
        prompt: iterable,
        options: {
          env: CLAUDE_QUERY_ENV,
          stderr: (data) => logClaudeSubprocessStderr(sessionId, data),
          ...(isPendingSession ? {} : { resume: sessionId }),
          ...(cwdOverride ? { cwd: cwdOverride } : {}),
          ...(model ? { model } : {}),
          ...(fallbackModel ? { fallbackModel } : {}),
          ...(permissionMode ? { permissionMode } : {}),
          // The SDK requires allowDangerouslySkipPermissions whenever
          // permissionMode is 'bypassPermissions'; without it the query rejects
          // on send and BYPASS appears broken. Mirror the CLI's
          // --dangerously-skip-permissions guard.
          ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
          canUseTool: (toolName, input, toolOpts) =>
            bridgeBox.fn
              ? bridgeBox.fn(toolName, input, toolOpts)
              : Promise.resolve({ behavior: 'allow' as const, updatedInput: input }),
          onElicitation: (request, elicitOpts) =>
            bridgeBox.elicit
              ? bridgeBox.elicit(request, elicitOpts)
              : Promise.resolve({ action: 'decline' as const }),
          onUserDialog: (request, dialogOpts) => bridgeBox.dialog
            ? bridgeBox.dialog(request, dialogOpts)
            : Promise.resolve({ behavior: 'cancelled' as const }),
          supportedDialogKinds: ['refusal_fallback_prompt'],
          ...claudeIntegratedQueryExtensions(viewerContext, sessionId),
          ...claudeAgentPolicyOptions(agentPolicy),
          ...effortToSdk(effort),
          abortController,
          ...claudeSessionPersistenceQueryOptions(),
          ...claudeProcessSpawnOptions(),
          resumeSessionAt,
          ...(resumeDropsTurn ? { resumeDropsTurn } : {}),
          forkSession: forkSessionOnSend,
          includePartialMessages: true,
          agentProgressSummaries: true,
          includeHookEvents: true,
          promptSuggestions: true,
          forwardSubagentText: true,
          systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
          ...claudeQueryBudgetOptions(taskBudgetTotal, maxBudgetUsd),
          ...(enableWorkflow ? { settings: { enableWorkflows: true } } : {}),
          // See lib/claudePool.ts's spawn() for why this needs no compat-check
          // entry: a Coordinator-owned session's tools are bound once here, on
          // its first (cold) turn, and never change for its lifetime.
        },
      })

      // Must be set BEFORE the for-await below, not before query() above —
      // the iterator drives SDK processing, so no tool call can arrive until
      // the first pull of the iterator at the for-await.
      if (bridgeInstalled) {
        bridgeBox.fn = createClaudePermissionBridge(sessionId, controller, encoder, bridgedPermissionIds)
      }
      // Elicitation isn't gated on manual permissions — an MCP server can elicit
      // in any mode, so always install the handler.
      bridgeBox.elicit = createClaudeElicitationBridge(sessionId, controller, encoder)
      bridgeBox.dialog = createClaudeUserDialogBridge(sessionId, controller, encoder)

      // While a bash-mode command runs locally, interrupt kills the child
      // process instead of poking the (idle) query.
      let killBangShell: (() => void) | null = null
      const interruptTurn = async (cancelQueued = false) => {
        if (killBangShell) {
          killBangShell()
          return undefined
        }
        // On interrupt_receipt_v1 CLIs this resolves to { still_queued }: uuids
        // of queued async messages that WILL still run unless cancelled.
        return await interruptClaudeQuery(q, cancelQueued)
      }

      setRunningSession(sessionId, {
        provider: 'claude',
        requestId: turnRequestId,
        interrupt: interruptTurn,
        background: () => q.backgroundTasks(),
        steer: async (text) => {
          const message = await buildClaudeUserMessage(text, [])
          pushUserMessage(message)
          return claudeUserMessageUuid(message)
        },
      })

      // Keep the connection warm and the client's stall watchdog fed during the
      // cold path's first-token wait (the highest-latency window). Routed through
      // safeEnqueue so it no-ops once downstream closes.
      const heartbeat = setInterval(() => {
        safeEnqueue(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)
      }, CLAUDE_STREAM_HEARTBEAT_MS)
      if (typeof heartbeat === 'object' && heartbeat && 'unref' in heartbeat) {
        (heartbeat as { unref?: () => void }).unref?.()
      }

      let emittedSessionEvent = false
      let realizedSessionId: string | undefined
      let adopted = false
      let turnAccepted = false
      const acceptTurn = (acceptedSessionId: string) => {
        if (turnAccepted) return
        turnAccepted = true
        safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: acceptedSessionId, provider: 'claude' })}\n\n`)
      }
      let broadcastSessionId: string | undefined
      let broadcastTurnStarted = false
      const fallbackBroadcastSessionId = isPendingSession || forkSessionOnSend ? undefined : sessionId
      const noteClaudeBroadcastSession = (nextSessionId: string | undefined): string | undefined => {
        if (!nextSessionId) return undefined
        if (!broadcastSessionId) broadcastSessionId = nextSessionId
        if (!broadcastTurnStarted) {
          try { broadcastClaudeTurnStart(broadcastSessionId) } catch { /* never let an observer break the send stream */ }
          broadcastTurnStarted = true
        }
        return broadcastSessionId
      }

      // The bash-input push (shouldQuery:false) is acknowledged by the CLI with
      // an immediate empty result — swallow it so the client only sees the real
      // turn's result.
      let bangResultsToSkip = 0

      try {
        if (bangShell != null) {
          // Native order: the input entry is recorded at submit time, then the
          // command runs, then its output entry starts the responding turn.
          pushUserMessage(buildClaudeBashInputMessage(bangShell))
          bangResultsToSkip = 1
          const bangResult = await runClaudeBangShellCommand(bangShell, cwdOverride, {
            registerKill: (kill) => { killBangShell = kill },
          })
          killBangShell = null
          pushUserMessage(buildClaudeBashOutputMessage(bangResult))
        }

        try {
          const usage = await q.getContextUsage()
          safeEnqueue(codexContextUsageToEventData(usage))
        } catch {}

        // This is the CLI's cold spawn — no pool watchdog covers it yet (that
        // only guards turns already adopted into claudePool). On a machine
        // where the subprocess hangs during startup (custom ANTHROPIC_MODEL
        // resolution, proxied base URL auth, Bedrock/Vertex discovery), the
        // stream would otherwise sit silent forever with no way for the
        // client to recover. Bound each message wait so a stuck first turn
        // fails into the existing isTransientSendError retry instead.
        const coldIterator = q[Symbol.asyncIterator]()
        while (true) {
          const step = await withTimeout(coldIterator.next(), 60000, 'Claude cold-start turn')
          if (step.done) break
          const msg = step.value
          const messageSessionId = typeof msg.session_id === 'string' && msg.session_id ? msg.session_id : undefined
          if (!emittedSessionEvent && messageSessionId) {
            emittedSessionEvent = true
            realizedSessionId = messageSessionId
            viewerContext.sessionId = messageSessionId
            // Mirror the registry entry under the realized id — a pending
            // session registers under its draft id, but reattach polls and
            // interrupts address the turn by the real id once it's known.
            if (messageSessionId !== sessionId) {
              setRunningSession(messageSessionId, {
                provider: 'claude',
                requestId: turnRequestId,
                interrupt: interruptTurn,
                background: () => q.backgroundTasks(),
                steer: async (text) => {
                  const message = await buildClaudeUserMessage(text, [])
                  pushUserMessage(message)
                  return claudeUserMessageUuid(message)
                },
              })
            }
            safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: messageSessionId })}\n\n`)
          }
          if (msg.type === 'result' && bangResultsToSkip > 0) {
            bangResultsToSkip -= 1
            continue
          }
          const eventSessionId = noteClaudeBroadcastSession(messageSessionId ?? fallbackBroadcastSessionId)
          if (eventSessionId) {
            try { broadcastClaudeMessage(eventSessionId, msg.type) } catch { /* observer-only signal */ }
          }
          noteClaudeCommandsChanged(messageSessionId ?? sessionId, msg)
          const resultError = msg.type === 'result'
            ? claudeResultErrorMessage(msg as unknown as Record<string, unknown>)
            : null
          if (!resultError) acceptTurn(messageSessionId ?? realizedSessionId ?? sessionId)
          safeEnqueue(`data: ${JSON.stringify(msg)}\n\n`)
          // Break after the result so we can adopt the Query into the pool.
          // The pool's pump loop takes over consuming for any tail messages
          // (notably prompt_suggestion, which the SDK emits after `result`)
          // and for future turns.
          if (msg.type === 'result') {
            if (resultError) {
              safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: resultError.message, apiErrorStatus: resultError.apiErrorStatus })}\n\n`)
            }
            break
          }
        }

        // Adopt into the pool when we can: a clean result was seen, the
        // session_id is known, and the client hasn't disconnected. The bridge
        // is now cleared before adoption — the query's canUseTool delegates
        // through bridgeBox.fn which will be set fresh for each future turn.
        if (realizedSessionId && !abortController.signal.aborted) {
          // Clear the turn-1 bridge so the pool entry starts idle.
          bridgeBox.fn = null
          bridgeBox.elicit = null
          bridgeBox.dialog = null
          signal.removeEventListener('abort', propagateAbort)
          adoptClaudeSession({
            sessionId: realizedSessionId,
            query: q,
            pushUserMessage,
            endInput,
            options: { ...adoptOptions, sessionId: realizedSessionId },
            bridgeBox,
          })
          adopted = true
        }
      } catch (err) {
        if (!abortController.signal.aborted && !clientDetached) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: friendlyClaudePoolError(err) })}\n\n`)
        }
      } finally {
        clearInterval(heartbeat)
        // Clear the bridge in case adoption didn't happen (error, abort) so the
        // box isn't left pointing at a dead stream controller.
        bridgeBox.fn = null
        bridgeBox.elicit = null
        bridgeBox.dialog = null
        clearRunningSession(sessionId, turnRequestId)
        if (realizedSessionId && realizedSessionId !== sessionId) clearRunningSession(realizedSessionId, turnRequestId)
        resolvePendingClaudePermissions(sessionId, bridgedPermissionIds, 'Permission request ended before a response was received')
        if (!adopted) {
          signal.removeEventListener('abort', propagateAbort)
          q.close()
        }
        if (broadcastSessionId && broadcastTurnStarted) {
          try { broadcastClaudeTurnEnd(broadcastSessionId) } catch { /* observer-only signal */ }
        }
        if (broadcastSessionId && !adopted) {
          try { broadcastClaudeRecycled(broadcastSessionId) } catch { /* observer-only signal */ }
        }
        if (!downstreamClosed) {
          try { controller.close() } catch { /* downstream already closed */ }
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

type ClaudeStreamPooledArgs = {
  sessionId: string
  signal: AbortSignal
  userMessage: string
  attachments: SendAttachment[]
  /** Non-null when the message is an input-box `!command` (bash mode). */
  bangShell: string | null
  permissionMode: ClaudePermissionMode | undefined
  manualPermissions: boolean
  model: string | undefined
  effort: ReasoningEffortLevel | undefined
  cwdOverride: string | undefined
  taskBudgetTotal: number | undefined
  maxBudgetUsd: number | undefined
  enableWorkflow: boolean
  turnRequestId: string | undefined
  fallbackModel: string | undefined
  agentPolicy: ClaudeAgentPolicy | undefined
  /** See ClaudePoolAcquireOptions.isPendingSession. Only relevant if the entry needs a fresh spawn. */
  isPendingSession?: boolean
}

async function createClaudeStreamPooled(args: ClaudeStreamPooledArgs): Promise<Response> {
  const {
    sessionId,
    signal,
    userMessage,
    attachments,
    bangShell,
    permissionMode,
    manualPermissions,
    model,
    effort,
    cwdOverride,
    taskBudgetTotal,
    maxBudgetUsd,
    enableWorkflow,
    isPendingSession,
    turnRequestId,
    fallbackModel,
    agentPolicy,
  } = args

  // Bash mode builds its own transcript-shaped messages after the command runs.
  let pushMessage: SDKUserMessage | null = null
  if (bangShell == null) {
    try {
      pushMessage = await buildClaudeUserMessage(userMessage, attachments, cwdOverride)
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to build prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Per-stream state that survives a warm respawn. The pooled path never
      // pends, so the session id is fixed for the whole stream — running-session
      // registration, permission cleanup, and the session frame all key off
      // `sessionId` directly rather than a particular pool entry.
      const bridgedPermissionIds = new Set<string>()
      const bridgeInstalled = manualPermissions
        && permissionMode !== 'bypassPermissions'
        && permissionMode !== 'plan'
      const bridge = bridgeInstalled
        ? createClaudePermissionBridge(sessionId, controller, encoder, bridgedPermissionIds)
        : undefined
      // Elicitation isn't gated on manual permissions — install it every turn.
      const elicit = createClaudeElicitationBridge(sessionId, controller, encoder)
      const dialog = createClaudeUserDialogBridge(sessionId, controller, encoder)

      // Decouple the turn lifecycle from this HTTP request. A client disconnect
      // (tab closed, navigation, network blip) must NOT interrupt an in-flight
      // turn — the pool keeps draining the Query, the turn completes, messages
      // persist, and the Claude harness keeps observers' transcripts live so a
      // reconnect immediately resumes streaming. Explicit cancellation is a
      // separate, deliberate action that flows through the /interrupt route
      // (→ getRunningSession().interrupt()), not a side effect of disconnecting.
      const turnAbort = new AbortController()

      // While a bash-mode (`!command`) child process runs, this kills it —
      // consulted by the running-session interrupt closure below.
      let killBangShell: (() => void) | null = null

      // We already know the session id — emit immediately so the client doesn't
      // have to wait for the SDK's init message.
      controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`))

      // Keep the connection warm and the client's stall watchdog fed while the
      // turn runs. Heartbeats are best-effort: a throw means downstream closed,
      // which the turn-decoupling logic already tolerates.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`))
        } catch { /* downstream closed; turn keeps running in the pool */ }
      }, CLAUDE_STREAM_HEARTBEAT_MS)
      if (typeof heartbeat === 'object' && heartbeat && 'unref' in heartbeat) {
        (heartbeat as { unref?: () => void }).unref?.()
      }

      const emitUsage = (usage: Awaited<ReturnType<Query['getContextUsage']>>) => {
        try {
          controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
        } catch { /* downstream already closed */ }
      }

      // Liveness probe for a reused warm entry: getContextUsage() answers from
      // the control channel in a few ms when the subprocess is healthy. If it
      // cannot answer, the caller first asks the SDK to reinitialize its
      // transport; only a failed reconnect pays the subprocess-respawn cost.
      // The usage request doubles as the usage-frame source on success.
      const probeWarmLiveness = (e: ClaudePoolEntry): Promise<'live' | 'dead'> => {
        let timer: ReturnType<typeof setTimeout> | null = null
        const timeout = new Promise<'dead'>((resolve) => {
          timer = setTimeout(() => resolve('dead'), CLAUDE_WARM_LIVENESS_PROBE_MS)
          if (typeof timer === 'object' && timer && 'unref' in timer) {
            (timer as { unref?: () => void }).unref?.()
          }
        })
        const answered: Promise<'live' | 'dead'> = e.query.getContextUsage().then(
          (usage) => { emitUsage(usage); return 'live' },
          () => 'dead',
        )
        return Promise.race([answered, timeout]).finally(() => { if (timer) clearTimeout(timer) })
      }

      let attempt = 0
      let turnAccepted = false
      try {
        while (true) {
          attempt += 1
          let entry: ClaudePoolEntry
          try {
            entry = acquireClaudeSession({
              sessionId,
              cwd: cwdOverride,
              model,
              fallbackModel,
              permissionMode,
              effort,
              taskBudgetTokens: taskBudgetTotal,
              maxBudgetUsd,
              enableWorkflow,
              agentPolicy,
              isPendingSession,
            })
          } catch (err) {
            if (!signal.aborted) {
              try {
                controller.enqueue(encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`,
                ))
              } catch { /* ignore */ }
            }
            break
          }

          const activeEntry = entry
          setRunningSession(sessionId, {
            provider: 'claude',
            requestId: turnRequestId,
            // While a bash-mode command runs locally, interrupt kills the child
            // process instead of poking the (idle) query.
            interrupt: async (cancelQueued = false) => {
              if (killBangShell) {
                killBangShell()
                return undefined
              }
              return await interruptClaudeQuery(activeEntry.query, cancelQueued)
            },
            background: () => activeEntry.query.backgroundTasks(),
            // Mid-turn user input rides the warm query's persistent input stream —
            // the CLI queues it as steering, exactly like typing in Claude Code.
            steer: async (text) => {
              const message = await buildClaudeUserMessage(text, [])
              activeEntry.pushUserMessage(message)
              return claudeUserMessageUuid(message)
            },
          })

          let sawActivity = false
          // Set when we deliberately recycle a dead-looking warm entry, so the
          // catch below knows the run() rejection is our own doing — not a real
          // turn failure to surface — and the retry path stays silent.
          let respawnRequested = false

          if (activeEntry.reused && attempt <= CLAUDE_WARM_MAX_RESPAWN) {
            void probeWarmLiveness(activeEntry).then(async (verdict) => {
              if (verdict !== 'dead' || sawActivity) return

              let timer: ReturnType<typeof setTimeout> | null = null
              const timeout = new Promise<false>((resolve) => {
                timer = setTimeout(() => resolve(false), CLAUDE_WARM_LIVENESS_PROBE_MS)
                if (typeof timer === 'object' && timer && 'unref' in timer) {
                  (timer as { unref?: () => void }).unref?.()
                }
              })
              const reinitialized = Promise.resolve()
                .then(() => activeEntry.query.reinitialize())
                .then(() => true, () => false)
              const recovered = await Promise.race([reinitialized, timeout]).finally(() => {
                if (timer) clearTimeout(timer)
              })
              if (recovered || sawActivity) return

              respawnRequested = true
              // Recycling pushes null to the turn subscriber, so the pending
              // run() below rejects promptly — caught and respawned fresh.
              recycleClaudeSession(sessionId)
            })
          } else {
            // Fresh spawn (or a retry): surface context usage without gating —
            // a fresh spawn is the already-reliable path and may be slow to
            // answer during init, which must never trigger a respawn.
            void activeEntry.query.getContextUsage().then(emitUsage).catch(() => {})
          }

          const onTurnMessage = (msg: SDKMessage) => {
            // Any frame proves the subprocess is alive — cancels a pending
            // dead verdict so a slow-but-healthy turn is never respawned.
            sawActivity = true
            try {
              const resultError = claudeResultErrorMessage(msg as unknown as Record<string, unknown>)
              if (!turnAccepted && !resultError) {
                turnAccepted = true
                controller.enqueue(encoder.encode(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'claude' })}\n\n`))
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
              if (resultError) {
                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: resultError.message, apiErrorStatus: resultError.apiErrorStatus })}\n\n`))
              }
            } catch {
              /* downstream closed; ignore — the turn keeps running in the pool */
            }
          }
          const onTurnError = (_err: Error) => {
            // A respawn we triggered ourselves already recycled the entry.
            if (respawnRequested) return
            // Drop the dead entry so the next acquire — whether the retry
            // below or a later turn — gets a fresh subprocess. run() always
            // rejects with this same error right after calling onError, so
            // the outer catch below is the single place that decides
            // whether to retry silently or surface something to the client;
            // surfacing here too would leak a raw pool-internal message even
            // on attempts that go on to retry invisibly.
            recycleClaudeSession(sessionId)
          }

          try {
            if (bangShell != null) {
              // Input-box bash mode, in the CLI's native order: persist the
              // input entry silently (its empty ack result is not forwarded),
              // run the command locally, then persist the output entry — which
              // starts the turn where Claude responds to the output.
              await activeEntry.run(buildClaudeBashInputMessage(bangShell), {
                signal: turnAbort.signal,
                onMessage: (msg) => {
                  sawActivity = true
                  if ((msg as { type?: string }).type === 'result') return
                  onTurnMessage(msg)
                },
                onError: onTurnError,
              })
              const bangResult = await runClaudeBangShellCommand(bangShell, cwdOverride, {
                registerKill: (kill) => { killBangShell = kill },
              })
              killBangShell = null
              await activeEntry.run(buildClaudeBashOutputMessage(bangResult), {
                signal: turnAbort.signal,
                bridge,
                elicit,
                dialog,
                onMessage: onTurnMessage,
                onError: onTurnError,
              })
            } else {
              await activeEntry.run(pushMessage!, {
                signal: turnAbort.signal,
                bridge,
                elicit,
                dialog,
                onMessage: onTurnMessage,
                onError: onTurnError,
              })
            }
            break
          } catch (err) {
            // Transparent recovery: nothing was ever shown to the client for
            // this attempt, so a fresh acquire+retry is invisible to them
            // aside from a small added delay. Covers both our own proactive
            // dead-entry respawn (respawnRequested) and a reused/fresh entry
            // that simply threw on its own (unexpected subprocess death, the
            // inactivity hard-timeout firing before any output, etc.) — the
            // failure mode doesn't matter when there's nothing to lose by
            // retrying once. Once activity was seen, a retry could duplicate
            // or contradict what the client already rendered, so that case
            // always surfaces (below) instead.
            if (!sawActivity && attempt <= CLAUDE_WARM_MAX_RESPAWN) {
              if (!respawnRequested) recycleClaudeSession(sessionId)
              continue
            }
            if (!signal.aborted) {
              try {
                controller.enqueue(encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ error: friendlyClaudePoolError(err) })}\n\n`,
                ))
              } catch {
                /* ignore */
              }
            }
            break
          }
        }
      } finally {
        clearInterval(heartbeat)
        clearRunningSession(sessionId, turnRequestId)
        resolvePendingClaudePermissions(sessionId, bridgedPermissionIds, 'Permission request ended before a response was received')
        try { controller.close() } catch { /* idempotent */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref()
  })
}

async function readClaudeSupportedModelsOnce(): Promise<SessionModelInfo[]> {
  // Prefer the pre-warmed slot primed by instrumentation.ts → skips the
  // ~1–3s subprocess spawn for the first call after boot. The slot
  // automatically re-warms in the background after consumption so the next
  // call is hot too. Falls back to a fresh query() when the slot is empty
  // (warmup failed, or this is the second concurrent call before re-warm
  // finished).
  //
  // `maxTurns: 0` + a never-yielding prompt iterator stops the SDK from
  // starting an actual model turn — the subprocess spins up, services the
  // `initializationResult` / `supportedModels` control RPCs, and shuts down
  // via `q.close()`. The legacy `prompt: 'ping'` + `maxTurns: 1` pattern
  // would burn a full API round-trip on every cache miss.
  const warm = await consumeReadModelsWarmQuery()
  const fallbackModel = claudeFallbackModelChain()
  const q = warm
    ? warm.query(openPrompt())
    : query({
        prompt: openPrompt(),
        options: {
          // No explicit model — let the CLI boot with its own default so this
          // works on custom deployments (Bedrock/Vertex, proxied base URLs,
          // non-default ANTHROPIC_MODEL) instead of a literal that may not
          // resolve there.
          ...(fallbackModel ? { fallbackModel } : {}),
          persistSession: false,
          maxTurns: 0,
          enableFileCheckpointing: true,
          ...claudeProcessSpawnOptions(),
        },
      })

  try {
    const initialization = await q.initializationResult()
    const supportedModels = await q.supportedModels().catch(() => [] as SessionModelInfo[])
    return supportedModels.length > 0
      ? supportedModels
      : (initialization.models ?? [])
  } finally {
    q.close()
  }
}

// Retry delays for a not-yet-ready model list, not a genuinely model-less
// install. On some systems — custom model configuration especially (a
// non-default ANTHROPIC_MODEL, a custom base URL, Bedrock/Vertex — anything
// where the CLI enumerates models from somewhere other than its own static
// table) — the very first query right after a fresh subprocess spawn can
// come back before that recognition has finished, both on
// initializationResult() and supportedModels(). A real zero-model install
// doesn't happen in practice, so treat an empty result as "not ready yet"
// and retry with backoff rather than caching/returning it as final.
const CLAUDE_MODELS_RETRY_DELAYS_MS = [300, 800, 1500, 3000]

async function readClaudeSupportedModels(): Promise<SessionModelInfo[]> {
  let models = await readClaudeSupportedModelsOnce()
  for (const wait of CLAUDE_MODELS_RETRY_DELAYS_MS) {
    if (models.length > 0) break
    await delay(wait)
    models = await readClaudeSupportedModelsOnce()
  }
  return models
}

function formatCodexNotification(notification: CodexNotification): string | null {
  switch (notification.method) {
    case 'error':
      return JSON.stringify({ type: 'codex_error', ...notification.params })
    case 'item/agentMessage/delta':
      return JSON.stringify({ type: 'codex_agent_message_delta', ...notification.params })
    case 'item/plan/delta':
      return JSON.stringify({ type: 'codex_plan_delta', ...notification.params })
    case 'item/reasoning/summaryTextDelta':
      return JSON.stringify({ type: 'codex_reasoning_summary_delta', ...notification.params })
    case 'item/reasoning/textDelta':
      return JSON.stringify({ type: 'codex_reasoning_delta', ...notification.params })
    case 'item/commandExecution/outputDelta':
      return JSON.stringify({ type: 'codex_command_output_delta', ...notification.params })
    case 'item/fileChange/outputDelta':
      return JSON.stringify({ type: 'codex_file_change_output_delta', ...notification.params })
    case 'item/fileChange/patchUpdated':
      return JSON.stringify({ type: 'codex_file_change_patch_updated', ...notification.params })
    case 'item/mcpToolCall/progress':
      return JSON.stringify({ type: 'codex_mcp_tool_progress', ...notification.params })
    case 'turn/plan/updated':
      return JSON.stringify({ type: 'codex_turn_plan_updated', ...notification.params })
    case 'turn/diff/updated':
      return JSON.stringify({ type: 'codex_turn_diff_updated', ...notification.params })
    case 'thread/realtime/transcript/delta':
      return JSON.stringify({ type: 'codex_realtime_transcript_delta', ...notification.params })
    case 'thread/realtime/transcript/done':
      return JSON.stringify({ type: 'codex_realtime_transcript_done', ...notification.params })
    case 'thread/realtime/transcriptUpdated':
      return JSON.stringify({ type: 'codex_realtime_transcript', ...notification.params })
    case 'thread/realtime/itemAdded':
      return JSON.stringify({ type: 'codex_realtime_item_added', ...notification.params })
    case 'thread/realtime/error':
      return JSON.stringify({ type: 'codex_realtime_error', ...notification.params })
    case 'item/started':
      return JSON.stringify({ type: 'codex_item_started', ...notification.params })
    case 'item/completed':
      return JSON.stringify({ type: 'codex_item_completed', ...notification.params })
    default:
      return null
  }
}

function getCodexNotificationTurnId(notification: CodexNotification): string | null {
  // Most notifications expose turnId directly; turn/started, turn/completed
  // carry it indirectly via params.turn.id (per TurnStartedNotification /
  // TurnCompletedNotification). The shape varies across the union, so this
  // accessor stays loose-typed by design.
  const params = notification.params as { turnId?: unknown; turn?: { id?: unknown } | null }
  if (typeof params.turnId === 'string' && params.turnId) return params.turnId
  if (typeof params.turn?.id === 'string' && params.turn.id) return params.turn.id
  return null
}

function isCodexRealtimeNotification(notification: CodexNotification): boolean {
  switch (notification.method) {
    case 'error':
    case 'item/agentMessage/delta':
    case 'item/plan/delta':
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
    case 'item/commandExecution/outputDelta':
    case 'item/fileChange/outputDelta':
    case 'item/fileChange/patchUpdated':
    case 'item/mcpToolCall/progress':
    case 'turn/plan/updated':
    case 'turn/diff/updated':
    case 'thread/realtime/transcript/delta':
    case 'thread/realtime/transcript/done':
    case 'thread/realtime/transcriptUpdated':
    case 'thread/realtime/itemAdded':
    case 'thread/realtime/error':
    case 'item/started':
    case 'item/completed':
      return true
    default:
      return false
  }
}

function isCodexIdleStatusNotification(notification: CodexNotification, sessionId: string): boolean {
  if (notification.method !== 'thread/status/changed') return false
  const params = notification.params as ThreadStatusChangedNotification
  return params.threadId === sessionId && params.status.type === 'idle'
}

// ── Codex server-request (approval) bridge ─────────────────────────────────
// The app-server sends exec/patch/permission approval *requests* mid-turn and
// blocks the turn until the client replies. createCodexStream surfaces them as
// `codex_approval` SSE frames; the respondPermission action replies via
// getCodexClient().respond(). Without this the turn hangs forever (the request
// was previously dropped as an unmatched response).

type PendingCodexApproval = { rawId: string | number; method: string; params: Record<string, unknown> }

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPendingCodexApprovals: Map<string, PendingCodexApproval> | undefined
}
const pendingCodexApprovals = globalThis.__agentViewerPendingCodexApprovals
  ?? (globalThis.__agentViewerPendingCodexApprovals = new Map<string, PendingCodexApproval>())

function pendingCodexApprovalKey(threadId: string, id: string): string {
  return `${threadId}:${id}`
}

const CODEX_APPROVAL_METHOD_NAMES = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
  'applyPatchApproval',
  'execCommandApproval',
] as const satisfies readonly CodexKnownServerRequest['method'][]
const CODEX_APPROVAL_METHODS = new Set<string>(CODEX_APPROVAL_METHOD_NAMES)

function isCodexApprovalRequest(method: string): boolean {
  return CODEX_APPROVAL_METHODS.has(method)
}

function codexApprovalThreadId(params: Record<string, unknown>): string | undefined {
  return typeof params.threadId === 'string' ? params.threadId : undefined
}

function codexApprovalRequestedPayload(threadId: string, request: CodexServerRequest): Record<string, unknown> {
  return {
    type: 'codex_approval',
    event: {
      type: 'approval.requested',
      requestId: String(request.id),
      method: request.method,
      threadId,
      params: request.params,
    },
  }
}

function codexApprovalRequestedEvent(threadId: string, request: CodexServerRequest): string {
  return JSON.stringify(codexApprovalRequestedPayload(threadId, request))
}

function grantedCodexPermissionsFromRequest(params: Record<string, unknown>, response: string): Record<string, unknown> {
  if (response === 'reject' || response === 'decline' || response === 'cancel') return {}
  const request = params.permissions && typeof params.permissions === 'object' && !Array.isArray(params.permissions)
    ? params.permissions as Record<string, unknown>
    : {}
  const granted: Record<string, unknown> = {}
  if (request.network && typeof request.network === 'object') granted.network = request.network
  if (request.fileSystem && typeof request.fileSystem === 'object') granted.fileSystem = request.fileSystem
  return granted
}

// Map a user decision to the per-method app-server response payload. Accepts the
// generic once/always/reject vocabulary shared by every provider's permission
// card, plus codex-native decision strings (accept/acceptForSession/decline/
// cancel) for finer control. Permission-profile requests follow codex-rs'
// composer flow: once grants for the turn, always grants for the session, and
// reject continues with an empty granted-permissions object.
function codexApprovalResult(method: string, response: string, params: Record<string, unknown>): Record<string, unknown> | undefined {
  const decision =
    response === 'accept' || response === 'acceptForSession' || response === 'decline' || response === 'cancel'
      ? response
      : response === 'always'
      ? 'acceptForSession'
      : response === 'reject'
      ? 'decline'
      : 'accept'
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision }
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return {
        decision: response === 'always' || response === 'acceptForSession'
          ? 'approved_for_session'
          : response === 'reject' || response === 'decline' || response === 'cancel'
          ? { denied: { rejection: 'Denied by user' } }
          : 'approved',
      }
    case 'item/permissions/requestApproval':
      return {
        permissions: grantedCodexPermissionsFromRequest(params, response),
        scope: response === 'always' || response === 'acceptForSession' ? 'session' : 'turn',
        strictAutoReview: response === 'strict',
      }
    case 'mcpServer/elicitation/request':
      return {
        action: response === 'reject' || response === 'decline' || response === 'cancel' ? 'decline' : 'accept',
        content: null,
        _meta: params._meta ?? null,
      }
    default:
      return undefined
  }
}

function respondCodexApproval(threadId: string, permissionId: string, response: string): void {
  const key = pendingCodexApprovalKey(threadId, permissionId)
  const pending = pendingCodexApprovals.get(key)
  if (!pending) throw new Error('Approval request is no longer pending')
  pendingCodexApprovals.delete(key)
  const client = getCodexClient()
  const result = codexApprovalResult(pending.method, response, pending.params)
  if (result === undefined) {
    client.respondError(pending.rawId, -32601, 'Approval type not supported by this client')
    return
  }
  client.respond(pending.rawId, result)
}

function elicitationContentFromAnswers(
  params: Record<string, unknown>,
  answers: Record<string, string[]>,
): Record<string, string | number | boolean | string[]> {
  const schema = params.requestedSchema && typeof params.requestedSchema === 'object' && !Array.isArray(params.requestedSchema)
    ? params.requestedSchema as Record<string, unknown>
    : {}
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {}
  const content: Record<string, string | number | boolean | string[]> = {}
  for (const [key, values] of Object.entries(answers)) {
    const first = values[0]
    if (first == null) continue
    const property = properties[key] && typeof properties[key] === 'object' && !Array.isArray(properties[key])
      ? properties[key] as Record<string, unknown>
      : {}
    switch (property.type) {
      case 'array':
        content[key] = values
        break
      case 'boolean':
        content[key] = first === 'true'
        break
      case 'number':
      case 'integer': {
        const value = Number(first)
        if (Number.isFinite(value)) content[key] = property.type === 'integer' ? Math.trunc(value) : value
        break
      }
      default:
        content[key] = first
        break
    }
  }
  return content
}

function respondCodexQuestion(threadId: string, permissionId: string, answers: Record<string, string[]>): void {
  const key = pendingCodexApprovalKey(threadId, permissionId)
  const pending = pendingCodexApprovals.get(key)
  if (!pending || (pending.method !== 'item/tool/requestUserInput' && pending.method !== 'mcpServer/elicitation/request')) {
    throw new Error('Question is no longer pending')
  }
  if (pending.method === 'mcpServer/elicitation/request') {
    pendingCodexApprovals.delete(key)
    getCodexClient().respond(pending.rawId, {
      action: 'accept',
      content: elicitationContentFromAnswers(pending.params, answers),
      _meta: pending.params._meta ?? null,
    })
    return
  }
  const rawQuestions = Array.isArray(pending.params.questions) ? pending.params.questions : []
  const responseAnswers: Record<string, { answers: string[] }> = {}
  for (const rawQuestion of rawQuestions) {
    if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) continue
    const question = rawQuestion as Record<string, unknown>
    const id = typeof question.id === 'string' ? question.id : ''
    const prompt = typeof question.question === 'string' ? question.question : ''
    const answer = (id && answers[id]) || (prompt && answers[prompt])
    if (!id || !Array.isArray(answer)) continue
    responseAnswers[id] = { answers: answer.map((value) => value.trim()).filter(Boolean) }
  }
  pendingCodexApprovals.delete(key)
  getCodexClient().respond(pending.rawId, { answers: responseAnswers })
}

// Decline any unanswered approvals for a thread when its turn ends/errors so the
// app-server is never left blocked. Safe on a clean completion (no pending) and
// idempotent if the server already cancelled the request.
function declinePendingCodexApprovals(threadId: string): void {
  const client = getCodexClient()
  for (const [key, pending] of Array.from(pendingCodexApprovals)) {
    if (!key.startsWith(`${threadId}:`)) continue
    pendingCodexApprovals.delete(key)
    const result = codexApprovalResult(pending.method, 'reject', pending.params)
    if (result === undefined) client.respondError(pending.rawId, -32601, 'Approval cancelled')
    else client.respond(pending.rawId, result)
  }
}

// AskForApproval string variants accepted from the composer's APPROVALS picker.
// (The `granular` object variant isn't exposed in the UI.) Omitted → use the
// app-server's configured default.
const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-request', 'never'] as const
type CodexApprovalPolicy = typeof CODEX_APPROVAL_POLICIES[number]

function parseCodexApprovalPolicy(body: Record<string, unknown>): CodexApprovalPolicy | undefined {
  const value = typeof body.approvalPolicy === 'string' ? body.approvalPolicy : ''
  return (CODEX_APPROVAL_POLICIES as readonly string[]).includes(value) ? (value as CodexApprovalPolicy) : undefined
}

async function createCodexStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const turnRequestId = parseTurnRequestId(body)
  const model = typeof body.model === 'string' ? body.model : null
  const effort = parseEffort(body)
  // Codex's app-server accepts `low`/`medium`/`high` for `effort`
  // (mirrors the CLI's `/reasoning` setting). `off`/`minimal`/`xhigh`/`max`
  // are not valid there, so drop them and let Codex use its thread default.
  const codexEffort = effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined
  const attachments = parseAttachments(body)
  const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const approvalPolicy = parseCodexApprovalPolicy(body)
  const bangShell = userMessage.startsWith('!') && attachments.length === 0
    ? userMessage.slice(1).trim()
    : null
  const codexSlash = attachments.length === 0 ? parseOpenCodeSlashCommand(userMessage) : null
  const detachOnClientAbort = body.detachOnClientAbort === true
  const client = getCodexClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let targetTurnId: string | null = null
      const bufferedNotifications: CodexNotification[] = []
      let currentModel = model ?? 'codex'
      let cleanedUp = false
      let downstreamClosed = false
      let completionSeen = false
      let bufferedTurnCompleted = false
      let targetTurnObserved = false
      let directOperationStarted = false
      let completionCloseTimer: ReturnType<typeof setTimeout> | null = null
      let lastActivityAt = Date.now()
      let cancelWatchdog: (() => void) | null = null

      const safeEnqueue = (chunk: string) => {
        if (cleanedUp || downstreamClosed) return
        lastActivityAt = Date.now()
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }

      const safeClose = () => {
        if (downstreamClosed) return
        downstreamClosed = true
        try {
          controller.close()
        } catch {
          /* stream already closed by consumer/runtime */
        }
      }

      const closeStream = (unsubscribe: () => void) => {
        if (cleanedUp) return
        cleanedUp = true
        if (completionCloseTimer) {
          clearTimeout(completionCloseTimer)
          completionCloseTimer = null
        }
        cancelWatchdog?.()
        cancelWatchdog = null
        clearRunningSession(sessionId, turnRequestId)
        unsubscribe()
        safeClose()
      }

      const scheduleCompletionClose = (unsubscribe: () => void) => {
        if (cleanedUp) return
        completionSeen = true
        if (completionCloseTimer) clearTimeout(completionCloseTimer)
        completionCloseTimer = setTimeout(() => closeStream(unsubscribe), 400)
      }

      const flushNotification = (notification: CodexNotification) => {
        const payload = formatCodexNotification(notification)
        if (!payload) return
        safeEnqueue(`data: ${payload}\n\n`)
      }

      // Prime the SSE stream before Codex startup/resume work so the TUI can
      // render "turn running" immediately and intermediaries do not buffer the
      // first real event behind the turn/start response.
      safeEnqueue(':ok\n\n')

      // Subscribe via the codex harness — events for this thread arrive
      // pre-filtered and the snapshot cache lets a downstream client
      // resume without losing the latest turn state. Matches how the
      // opencode stream consumes its harness.
      const subscription = subscribeToCodexEvents({ threadId: sessionId })
      const cachedSnapshot = subscription.snapshot
      let turnOutputUsage = {
        lastTotalOutputTokens: cachedSnapshot?.tokenUsage?.total?.outputTokens ?? null,
        outputTokens: 0,
      }
      let consumeAborted = false
      // Surface this thread's server→client approval requests as codex_approval
      // SSE frames. The app-server blocks the turn until respondPermission replies.
      const unsubscribeApprovals = client.subscribeServerRequests((request) => {
        if (consumeAborted) return false
        if (!isCodexApprovalRequest(request.method)) return false
        const params = request.params as Record<string, unknown>
        const approvalThreadId = codexApprovalThreadId(params)
        if (approvalThreadId && approvalThreadId !== sessionId) return false
        pendingCodexApprovals.set(pendingCodexApprovalKey(sessionId, String(request.id)), {
          rawId: request.id,
          method: request.method,
          params,
        })
        safeEnqueue(`data: ${codexApprovalRequestedEvent(sessionId, request)}\n\n`)
        return true
      })
      // Coordinator agents get their coord_* tools declared as Codex
      // dynamicTools at thread/start (see createNewViewSession's codex
      // branch) — the model calling one arrives here as a server→client
      // item/tool/call request that blocks the turn until we respond.
      const unsubscribeCoordinatorTools = client.subscribeServerRequests((request) => {
        if (consumeAborted) return false
        if (request.method !== 'item/tool/call') return false
        const params = request.params as { threadId?: string; tool?: string; arguments?: unknown }
        if (params.threadId && params.threadId !== sessionId) return false
        void (async () => {
          const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
            ? params.arguments as Record<string, unknown>
            : {}
          const result = await dispatchCoordinatorCodexToolCall(sessionId, String(params.tool ?? ''), args)
          if (!result) {
            client.respondError(request.id, -32601, `Unknown dynamic tool: ${params.tool}`)
            return
          }
          client.respond(request.id, {
            contentItems: [{ type: 'inputText', text: result.text }],
            success: !result.isError,
          })
        })()
        return true
      })
      const unsubscribe = () => {
        consumeAborted = true
        unsubscribeApprovals()
        unsubscribeCoordinatorTools()
        declinePendingCodexApprovals(sessionId)
        subscription.close()
      }
      const emitTokenUsage = (tokenUsage: CodexThreadTokenUsage) => {
        const usage = mapCodexTokenUsageToContextUsage(tokenUsage, currentModel)
        safeEnqueue(codexContextUsageToEventData(usage))
        turnOutputUsage = advanceCodexTurnOutputUsage(turnOutputUsage, tokenUsage)
        safeEnqueue(turnUsageToEventData(turnOutputUsage.outputTokens))
      }
      const activateTargetTurn = (turnId: string) => {
        if (!turnId || targetTurnId) return
        targetTurnId = turnId

        setRunningSession(sessionId, {
          provider: 'codex',
          requestId: turnRequestId,
          interrupt: () => client.request('turn/interrupt', { threadId: sessionId, turnId }),
          // Native mid-turn steering (the Codex CLI's type-while-running flow).
          // expectedTurnId makes this fail cleanly if the turn just ended —
          // the caller then falls back to queueing for the next turn.
          steer: (text) => client.request('turn/steer', {
            threadId: sessionId,
            expectedTurnId: turnId,
            input: buildCodexComposerInput(text, []),
          }),
        })
        safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'codex', turnId })}\n\n`)

        // Backstop a dropped turn/completed: if the notification stream goes
        // silent, ask the app-server for the turn's actual status. A legit
        // long-running tool call reports `inProgress` and the watchdog keeps
        // waiting; only a confirmed-finished (or vanished) turn closes the
        // stream, so the composer can never wedge in 'sending' on a lost frame.
        cancelWatchdog = startTurnWatchdog({
          label: 'codex',
          idleTimeoutMs: CODEX_WATCHDOG_IDLE_MS,
          // A detached HTTP client does not end the provider turn. Keep the
          // authoritative status probe alive so a dropped terminal event still
          // clears the process-local running registry for reattach clients.
          isClosed: () => cleanedUp || (downstreamClosed && !detachOnClientAbort),
          lastActivityAt: () => lastActivityAt,
          probe: async () => {
            try {
              const response = await client.request('thread/turns/list', { threadId: sessionId, limit: 5 })
              const turn = response.data.find((candidate) => candidate.id === turnId)
              if (!turn) return 'unknown'
              return turn.status === 'inProgress' ? 'running' : 'idle'
            } catch {
              return 'unknown'
            }
          },
          onResolved: () => scheduleCompletionClose(unsubscribe),
        })

        for (const notification of bufferedNotifications.splice(0)) {
          const bufferedTurnId = getCodexNotificationTurnId(notification)
          if (bufferedTurnId && bufferedTurnId !== turnId) continue
          if (bufferedTurnId === turnId) targetTurnObserved = true
          if (notification.method === 'turn/completed') {
            bufferedTurnCompleted = true
            continue
          }
          if (notification.method === 'thread/tokenUsage/updated') {
            emitTokenUsage((notification.params as ThreadTokenUsageUpdatedNotification).tokenUsage)
            continue
          }
          if (notification.method === 'error') {
            const params = notification.params as ErrorNotification
            const message = params.error?.message || 'Codex turn failed'
            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
            if (!params.willRetry) {
              scheduleCompletionClose(unsubscribe)
            }
            continue
          }
          if (isCodexIdleStatusNotification(notification, sessionId)) {
            scheduleCompletionClose(unsubscribe)
            continue
          }
          if (completionSeen) scheduleCompletionClose(unsubscribe)
          flushNotification(notification)
        }

        if (bufferedTurnCompleted) {
          scheduleCompletionClose(unsubscribe)
        }
      }
      const consume = (async () => {
        for await (const harnessEvent of subscription.events) {
          if (consumeAborted) break
          if (harnessEvent.type === 'disconnected') {
            // The app-server died mid-turn. Surface it as a terminal error (so
            // the composer leaves its sending state) and close, rather than
            // blocking forever on a pipe that will never produce again.
            if (!completionSeen) {
              safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: 'Codex app-server disconnected' })}\n\n`)
            }
            scheduleCompletionClose(unsubscribe)
            break
          }
          if (harnessEvent.type !== 'notification') continue
          const notification = harnessEvent.notification
          const notificationTurnId = getCodexNotificationTurnId(notification)

          if (!targetTurnId && directOperationStarted) {
            if (notification.method === 'error') {
              const params = notification.params as ErrorNotification
              const message = params.error?.message || 'Codex operation failed'
              safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
              if (!params.willRetry) {
                scheduleCompletionClose(unsubscribe)
              }
              continue
            }
            if (isCodexIdleStatusNotification(notification, sessionId)) {
              scheduleCompletionClose(unsubscribe)
              continue
            }
            if (isCodexRealtimeNotification(notification)) {
              flushNotification(notification)
              if (notification.method === 'item/completed') {
                scheduleCompletionClose(unsubscribe)
              }
            }
            continue
          }

          if (notification.method === 'thread/tokenUsage/updated') {
            if (!targetTurnId) {
              bufferedNotifications.push(notification)
              continue
            }
            if (!targetTurnId || notificationTurnId !== targetTurnId) continue
            emitTokenUsage((notification.params as ThreadTokenUsageUpdatedNotification).tokenUsage)
            continue
          }

          if (!targetTurnId) {
            // `turn/start` is the authoritative source of the new turn id.
            // The shared app-server can still deliver trailing notifications
            // from the previous turn while this request is in flight; binding
            // to one of those would filter out every delta from the real turn.
            if (notificationTurnId) {
              bufferedNotifications.push(notification)
            }
            continue
          }

          if (notificationTurnId) {
            if (notificationTurnId !== targetTurnId) continue
            targetTurnObserved = true
          }

          if (isCodexIdleStatusNotification(notification, sessionId)) {
            if (targetTurnObserved) scheduleCompletionClose(unsubscribe)
            continue
          }

          if (notification.method === 'turn/completed') {
            scheduleCompletionClose(unsubscribe)
            continue
          }

          // The codex app-server reports mid-turn failures as `error`
          // notifications. The legacy path stringified them as a generic
          // codex_error data frame which the client never narrowed to an
          // error. Promote them to the canonical `event: error` SSE frame
          // so MessageView surfaces them the same way every other provider
          // does.
          if (notification.method === 'error') {
            const params = notification.params as ErrorNotification
            const message = params.error?.message || 'Codex turn failed'
            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
            if (!params.willRetry) {
              scheduleCompletionClose(unsubscribe)
            }
            continue
          }

          if (completionSeen) scheduleCompletionClose(unsubscribe)
          flushNotification(notification)
        }
      })()
      void consume.catch(() => {})

      // Replay snapshot state so the live indicator and token usage
      // reflect what the harness already knows about this thread.
      if (cachedSnapshot?.tokenUsage) {
        const usage = mapCodexTokenUsageToContextUsage(cachedSnapshot.tokenUsage, currentModel)
        safeEnqueue(codexContextUsageToEventData(usage))
      }

      signal.addEventListener('abort', () => {
        if (detachOnClientAbort) {
          downstreamClosed = true
          return
        }
        void interruptRunningSession(sessionId, turnRequestId).catch(() => {})
      })

      try {
        // Resume is cached per app-server process — consecutive turns in the
        // same thread skip the round-trip entirely (it sat serially ahead of
        // turn/start, adding to first-token latency on every send).
        const resume = await ensureCodexThreadResumed(sessionId).catch(() => null)
        currentModel = model ?? resume?.model ?? currentModel
        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`)

        if (bangShell !== null) {
          if (!bangShell) throw new Error('Enter a shell command after !')
          directOperationStarted = true
          await client.request('thread/shellCommand', {
            threadId: sessionId,
            command: bangShell,
          })
          return
        }

        // Execute native Codex slash commands instead of leaking the literal
        // "/command" into the model prompt. Commands that start a turn bind to
        // that turn; metadata/settings commands emit a command-result and close.
        if (codexSlash?.command.toLowerCase() === 'compact') {
          directOperationStarted = true
          await client.request('thread/compact/start', { threadId: sessionId })
          safeEnqueue(commandResultEvent('codex', { message: 'Compacting the conversation…' }))
          return
        }
        if (codexSlash) {
          const commandName = codexSlash.command.toLowerCase()
          const commandArgs = codexSlash.arguments.trim()
          const finishCommand = (message: string) => {
            safeEnqueue(commandResultEvent('codex', { message, transcriptExpected: false }))
            scheduleCompletionClose(unsubscribe)
          }

          if (commandName === 'model') {
            if (!commandArgs) {
              finishCommand(currentModel ? `Codex model is ${currentModel}.` : 'No Codex model is selected.')
              return
            }
            const [nextModel, maybeEffort] = commandArgs.split(/\s+/, 2)
            const nextEffort = maybeEffort === 'low' || maybeEffort === 'medium' || maybeEffort === 'high'
              ? maybeEffort
              : undefined
            await client.request('thread/settings/update', {
              threadId: sessionId,
              model: nextModel,
              ...(nextEffort ? { effort: nextEffort } : {}),
            })
            currentModel = nextModel ?? currentModel
            if (nextModel) codexResumedThreads.set(sessionId, nextModel)
            finishCommand(nextEffort
              ? `Codex model set to ${nextModel} (${nextEffort}).`
              : `Codex model set to ${nextModel}.`)
            return
          }

          if (commandName === 'permissions' || commandName === 'approvals') {
            const nextPolicy = (CODEX_APPROVAL_POLICIES as readonly string[]).includes(commandArgs)
              ? commandArgs as CodexApprovalPolicy
              : undefined
            if (!nextPolicy) {
              finishCommand('Use /permissions untrusted, /permissions on-request, or /permissions never.')
              return
            }
            await client.request('thread/settings/update', {
              threadId: sessionId,
              approvalPolicy: nextPolicy,
            })
            finishCommand(`Codex approval policy set to ${nextPolicy}.`)
            return
          }

          if (commandName === 'rename') {
            if (!commandArgs) {
              finishCommand('Use /rename <title> to rename this Codex thread.')
              return
            }
            await client.request('thread/name/set', { threadId: sessionId, name: commandArgs })
            finishCommand(`Renamed Codex thread to "${commandArgs}".`)
            return
          }

          if (commandName === 'goal') {
            if (!commandArgs) {
              finishCommand('Use /goal <objective> to set a goal, or /goal clear to clear it.')
              return
            }
            if (commandArgs.toLowerCase() === 'clear') {
              await client.request('thread/goal/clear', { threadId: sessionId })
              finishCommand('Cleared the Codex goal.')
              return
            }
            await client.request('thread/goal/set', { threadId: sessionId, objective: commandArgs })
            finishCommand('Updated the Codex goal.')
            return
          }

          if (commandName === 'review') {
            const target = commandArgs
              ? { type: 'custom' as const, instructions: commandArgs }
              : { type: 'uncommittedChanges' as const }
            const review = await client.request('review/start', {
              threadId: sessionId,
              target,
              delivery: 'inline',
            })
            activateTargetTurn(review.turn.id)
            return
          }

          finishCommand(`/${codexSlash.command} is an interactive Codex command that agent-viewer cannot run yet.`)
          return
        }

        const turnStartParams = {
          threadId: sessionId,
          model: model ?? undefined,
          effort: codexEffort,
          // Override the app-server's approval policy only when the user picks one
          // in the composer (otherwise the configured default is used). This is
          // what makes the exec/patch approval prompts appear interactively.
          ...(approvalPolicy ? { approvalPolicy } : {}),
          input: buildCodexComposerInput(userMessage, attachments, cwdOverride),
        } satisfies CodexRequestParams<'turn/start'>
        // No watchdog covers this call yet — it runs before activateTargetTurn
        // sets up startTurnWatchdog above, so a hang here (e.g. the app-server
        // blocked on a custom model provider's auth/discovery) would otherwise
        // wedge the composer in "sending" forever. Bound it and let the failure
        // surface as a timeout message, which isTransientSendError already
        // classifies as retryable on the client.
        let started: CodexResponseFor<'turn/start'>
        try {
          started = await withTimeout(client.request('turn/start', turnStartParams), 20000, 'Codex turn/start')
        } catch (err) {
          // The resume cache said this thread was live but the server lost it
          // (e.g. a restart raced the disconnect listener). Re-resume once.
          if (!isCodexMissingRolloutError(err)) throw err
          codexResumedThreads.delete(sessionId)
          await withTimeout(ensureCodexThreadResumed(sessionId), 8000, 'Codex thread re-resume')
          started = await withTimeout(client.request('turn/start', turnStartParams), 20000, 'Codex turn/start retry')
        }

        activateTargetTurn(started.turn.id)
      } catch (err) {
        unsubscribe()
        clearRunningSession(sessionId, turnRequestId)
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        safeClose()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function createOpenCodeStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const turnRequestId = parseTurnRequestId(body)
  const selectedModel = decodeOpenCodeModelValue(typeof body.model === 'string' ? body.model : null)
  const attachments = parseAttachments(body)
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const requestedAgent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : undefined
  // OpenCode CLI convention: a prompt starting with `!` is treated as a direct
  // shell invocation against the session, not as natural language. The CLI
  // routes it via the session.shell RPC. Match that here so the composer
  // feels native — but only when no attachments tag along, since shell takes
  // a single command string.
  const bangShell = userMessage.startsWith('!') && attachments.length === 0
    ? userMessage.slice(1).trim()
    : null
  const slashCommand = attachments.length === 0
    ? parseOpenCodeSlashCommand(userMessage)
    : null
  const detachOnClientAbort = body.detachOnClientAbort === true
  const client = await getOpenCodeClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let targetSessionId = sessionId
      let cleanedUp = false
      let downstreamClosed = false
      let requestAborted = false
      let consumeEvents: Promise<void> | null = null
      let lastActivityAt = Date.now()
      let cancelWatchdog: (() => void) | null = null
      const outputTokensByMessageId = new Map<string, number>()
      let turnOutputTokens = 0
      // Subscribe to the shared event harness — one upstream connection per
      // directory (opencode ≥1.17 only delivers session/message events on the
      // directory-scoped bus; the unscoped stream is server heartbeats only),
      // multiplexed by session. The directory is resolved from the session
      // record inside the try below, before the subscription opens.
      let subscription: ReturnType<typeof subscribeToOpenCodeEvents> | null = null

      const safeEnqueue = (chunk: string) => {
        if (cleanedUp || downstreamClosed) return
        lastActivityAt = Date.now()
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }

      const close = () => {
        if (cleanedUp) return
        cleanedUp = true
        subscription?.close()
        if (!downstreamClosed) {
          downstreamClosed = true
          try {
            controller.close()
          } catch {
            /* downstream already closed */
          }
        }
      }

      // Push an SSE comment immediately so any intermediate proxy starts
      // forwarding the response without waiting for the first real frame.
      // Mirrors how curl-friendly SSE servers prime the pipe.
      safeEnqueue(':ok\n\n')

      signal.addEventListener('abort', () => {
        requestAborted = true
        if (detachOnClientAbort) {
          downstreamClosed = true
          return
        }
        void interruptRunningSession(sessionId, turnRequestId).catch(() => {})
      }, { once: true })

      try {
        // The event bus scopes on the session's directory exactly as the
        // server stores it — resolve it from the session record rather than
        // trusting the client-provided cwd (which can be a symlink variant).
        const sessionDirectory = await client.session.get({
          ...OPENCODE_OPTIONS,
          path: { id: sessionId },
        }).then((response) => {
          const record = openCodeData<OpenCodeSession & { directory?: string }>(response)
          return typeof record.directory === 'string' && record.directory ? record.directory : undefined
        }).catch(() => (typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined))

        if (resumeSessionAt) {
          const forkedResponse = await client.session.fork({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            body: { messageID: resumeSessionAt },
          })
          targetSessionId = openCodeData<OpenCodeSession>(forkedResponse).id
        }

        // Opened after the fork decision so it filters on the id whose
        // events we actually want — no dead-parent echo to unsubscribe.
        const activeSubscription = subscribeToOpenCodeEvents({ sessionId: targetSessionId, directory: sessionDirectory })
        subscription = activeSubscription

        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`)

        // Replay cached state so the client doesn't have to wait for the
        // next live event tick to render a stale permission prompt or busy
        // indicator — this is what opencode-web does on every subscribe.
        const cached = activeSubscription.snapshot
        if (cached?.status) {
          safeEnqueue(`event: opencode-status\ndata: ${JSON.stringify(cached.status)}\n\n`)
        }
        if (cached?.todos && cached.todos.length > 0) {
          safeEnqueue(`event: opencode-todos\ndata: ${JSON.stringify(cached.todos)}\n\n`)
        }
        for (const permission of cached?.permissions ?? []) {
          safeEnqueue(`data: ${formatOpenCodeEvent({ type: 'permission.updated', properties: permission } as OpenCodeEvent)}\n\n`)
        }
        for (const question of cached?.questions ?? []) {
          safeEnqueue(`data: ${formatOpenCodeEvent({
            type: 'question.asked',
            properties: question,
          } as unknown as OpenCodeEvent)}\n\n`)
        }

        // Sending another prompt while the session is busy queues it server-side
        // (the native opencode TUI's type-while-running flow). The session stays
        // busy until the queue drains, so this same stream keeps delivering the
        // queued turn's events and closes on the final session.idle.
        const steerOpenCode = (text: string) => client.session.promptAsync({
          ...OPENCODE_OPTIONS,
          path: { id: targetSessionId },
          body: {
            model: selectedModel ?? undefined,
            agent: requestedAgent,
            parts: buildOpenCodeParts(text, []),
          },
        })
        setRunningSession(sessionId, {
          provider: 'opencode',
          requestId: turnRequestId,
          interrupt: () => client.session.abort({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
          }),
          steer: steerOpenCode,
        })
        if (targetSessionId !== sessionId) {
          setRunningSession(targetSessionId, {
            provider: 'opencode',
            requestId: turnRequestId,
            interrupt: () => client.session.abort({
              ...OPENCODE_OPTIONS,
              path: { id: targetSessionId },
            }),
            steer: steerOpenCode,
          })
        }

        consumeEvents = (async () => {
          for await (const harnessEvent of activeSubscription.events) {
            if (harnessEvent.type !== 'event') continue

            const event = harnessEvent.event

            if (event.type === 'message.updated' && event.properties.info.role === 'assistant') {
              const usage = mapOpenCodeContextUsage(event.properties.info)
              if (usage) {
                safeEnqueue(codexContextUsageToEventData(usage))
              }
              turnOutputTokens = updateOpenCodeTurnOutputUsage(
                outputTokensByMessageId,
                event.properties.info,
                turnOutputTokens,
              )
              safeEnqueue(turnUsageToEventData(turnOutputTokens))
            }

            if (event.type === 'session.status') {
              safeEnqueue(`event: opencode-status\ndata: ${JSON.stringify(event.properties.status)}\n\n`)
            }

            if (event.type === 'todo.updated') {
              safeEnqueue(`event: opencode-todos\ndata: ${JSON.stringify(event.properties.todos)}\n\n`)
            }

            if (event.type === 'session.error') {
              const message = event.properties.error?.data && 'message' in event.properties.error.data
                ? String(event.properties.error.data.message)
                : 'Unknown OpenCode session error'
              safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
              break
            }

            safeEnqueue(`data: ${formatOpenCodeEvent(event)}\n\n`)

            if (event.type === 'session.idle' && event.properties.sessionID === targetSessionId) {
              break
            }
          }
        })()

        if (bangShell) {
          await client.session.shell({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
            body: {
              agent: requestedAgent ?? 'build',
              model: selectedModel ?? undefined,
              command: bangShell,
            },
          })
        } else if (slashCommand) {
          const commandName = slashCommand.command.toLowerCase()
          // TUI built-ins are not server-side custom commands — session.command
          // would 500 on them. Map them to their native RPCs instead, exactly
          // like the opencode TUI does.
          if (commandName === 'summarize' || commandName === 'compact') {
            // The summarize RPC requires an explicit model. Like the opencode
            // TUI, fall back to the model the session last ran with.
            const summarizeModel = selectedModel ?? await client.session.messages({
              ...OPENCODE_OPTIONS,
              path: { id: targetSessionId },
            }).then((response) => {
              const records = openCodeData<Array<{ info?: { role?: string; providerID?: string; modelID?: string } }>>(response)
              for (let i = records.length - 1; i >= 0; i -= 1) {
                const info = records[i]?.info
                if (info?.role === 'assistant' && info.providerID && info.modelID) {
                  return { providerID: info.providerID, modelID: info.modelID }
                }
              }
              return null
            }).catch(() => null)
            if (!summarizeModel) {
              throw new Error('Pick a model before running /summarize — this session has no prior model to reuse.')
            }
            safeEnqueue(commandResultEvent('opencode', { message: 'Summarizing the conversation…', transcriptExpected: true }))
            await client.session.summarize({
              ...OPENCODE_OPTIONS,
              path: { id: targetSessionId },
              body: summarizeModel,
            })
            // Summarize runs a busy→idle turn; the event loop closes on idle.
          } else if (commandName === 'share') {
            const shared = await client.session.share({ ...OPENCODE_OPTIONS, path: { id: targetSessionId } })
            const record = openCodeData<OpenCodeSession & { share?: { url?: string } }>(shared)
            safeEnqueue(commandResultEvent('opencode', {
              message: record.share?.url ? `Session shared: ${record.share.url}` : 'Session shared.',
              transcriptExpected: false,
            }))
            activeSubscription.close()
          } else if (commandName === 'unshare') {
            await client.session.unshare({ ...OPENCODE_OPTIONS, path: { id: targetSessionId } })
            safeEnqueue(commandResultEvent('opencode', { message: 'Session sharing disabled.', transcriptExpected: false }))
            activeSubscription.close()
          } else {
            // Validate against the server's command list first — an unknown
            // name would otherwise surface as an opaque 500 from the server.
            const knownCommands = await client.command.list({
              ...OPENCODE_OPTIONS,
              ...(sessionDirectory ? { query: { directory: sessionDirectory } } : {}),
            }).then((response) => openCodeData<Array<{ name?: string }>>(response)).catch(() => null)
            const isKnown = knownCommands?.some((command) => command?.name?.toLowerCase() === commandName)
            if (knownCommands && !isKnown) {
              safeEnqueue(commandResultEvent('opencode', {
                message: `/${slashCommand.command} is not available on this opencode server.`,
                transcriptExpected: false,
              }))
              activeSubscription.close()
            } else {
              await client.session.command({
                ...OPENCODE_OPTIONS,
                path: { id: targetSessionId },
                body: {
                  agent: requestedAgent,
                  model: selectedModel?.modelID,
                  command: slashCommand.command,
                  arguments: slashCommand.arguments,
                },
              })
            }
          }
        } else {
          await client.session.promptAsync({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
            body: {
              model: selectedModel ?? undefined,
              agent: requestedAgent,
            parts: buildOpenCodeParts(userMessage, attachments, sessionDirectory),
            },
          })
          safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: targetSessionId, provider: 'opencode' })}\n\n`)
        }

        // Backstop a dropped session.idle: if the event subscription goes
        // silent we probe session.status and, once OpenCode confirms the turn
        // is no longer busy, synthesize the idle frame so the consume loop ends
        // instead of hanging until the request is forcibly torn down.
        cancelWatchdog = startTurnWatchdog({
          label: 'opencode',
          idleTimeoutMs: OPENCODE_WATCHDOG_IDLE_MS,
          isClosed: () => cleanedUp || (downstreamClosed && !detachOnClientAbort),
          lastActivityAt: () => lastActivityAt,
          probe: async () => {
            try {
              const statusMap = await client.session.status({ ...OPENCODE_OPTIONS })
              const status = (statusMap as Record<string, { type?: string }>)?.[targetSessionId]
              if (!status) return 'idle'
              return status.type === 'busy' || status.type === 'retry' ? 'running' : 'idle'
            } catch {
              return 'unknown'
            }
          },
          onResolved: () => {
            safeEnqueue(`data: ${formatOpenCodeEvent({ type: 'session.idle', properties: { sessionID: targetSessionId } } as OpenCodeEvent)}\n\n`)
            // Ends the for-await over the subscription's events, resolving consumeEvents.
            activeSubscription.close()
          },
        })

        await consumeEvents
      } catch (err) {
        if (!requestAborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        }
      } finally {
        cancelWatchdog?.()
        subscription?.close()
        await consumeEvents?.catch(() => {})
        clearRunningSession(sessionId, turnRequestId)
        if (targetSessionId !== sessionId) {
          clearRunningSession(targetSessionId, turnRequestId)
        }
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function copilotModelOptions(params: {
  effort?: CopilotReasoningEffort
  contextTier?: CopilotContextTier
}): Parameters<Awaited<ReturnType<typeof acquireCopilotSession>>['setModel']>[1] | undefined {
  const options = {
    ...(params.effort ? { reasoningEffort: params.effort } : {}),
    ...(params.contextTier ? { contextTier: params.contextTier } : {}),
  }
  return Object.keys(options).length > 0 ? options : undefined
}

async function createCopilotStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const turnRequestId = parseTurnRequestId(body)
  const selectedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null
  const effort = parseEffort(body)
  const contextTier = parseCopilotContextTier(body.contextTier)
  let turnAgentMode = parseCopilotMode(body.mode)
  const permissionMode = parseCopilotPermissionMode(body.permissionMode)
  const manualPermissions = body.manualPermissions === true
  // Native slash execution is the default — matching the Copilot CLI (and the
  // other providers, which never leak "/command" into the prompt). Clients can
  // opt out explicitly with nativeCommands:false.
  const nativeCommands = body.nativeCommands !== false
  const parsedAttachments = parseAttachments(body)
  const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const attachmentPlan = planComposerAttachments('copilot', parsedAttachments)
  assertComposerAttachmentsSupported('copilot', attachmentPlan)
  const attachments = buildCopilotAttachments(attachmentPlan.native, cwdOverride)
  const composerPrompt = appendPortableComposerContext(userMessage, attachmentPlan.portableText)
  const detachOnClientAbort = body.detachOnClientAbort === true
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let session: Awaited<ReturnType<typeof acquireCopilotSession>> | null = null
      let unsubscribe: (() => void) | null = null
      let cleanedUp = false
      let downstreamClosed = false
      let requestAborted = false
      let emittedError = false
      let manualPermissionHandlerInstalled = false
      let elicitationHandlerInstalled = false
      let broadcastedTurnStart = false
      let turnTimeoutTimer: ReturnType<typeof setTimeout> | null = null
      let finalMessageFallbackTimer: ReturnType<typeof setTimeout> | null = null
      let historyPollCancelled = false
      let finishTurn: (() => void) | null = null
      let failTurn: ((error: Error) => void) | null = null
      // Captured from the root assistant.turn_start so we can complete the turn
      // on the matching authoritative assistant.turn_end (faster + more reliable
      // than the 1.5s assistant.message heuristic / session.idle / history poll).
      let currentTurnId: string | null = null
      const streamedAssistantMessageIds = new Set<string>()
      const seenUsageEventIds = new Set<string>()
      const bridgedPermissionIds = new Set<string>()
      const bridgedElicitationIds = new Set<string>()
      let turnOutputTokens = 0

      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }
      // Commit the streaming response before resume/model discovery work.
      safeEnqueue(':ok\n\n')

      const close = () => {
        if (cleanedUp) return
        cleanedUp = true
        if (downstreamClosed) return
        downstreamClosed = true
        try {
          controller.close()
        } catch {
          /* downstream already closed */
        }
      }

      const clearFinalMessageFallback = () => {
        if (finalMessageFallbackTimer == null) return
        clearTimeout(finalMessageFallbackTimer)
        finalMessageFallbackTimer = null
      }

      const scheduleFinalMessageFallback = (event: Extract<CopilotSessionEvent, { type: 'assistant.message' }>) => {
        if (turnAgentMode === 'autopilot') return
        if (Array.isArray(event.data.toolRequests) && event.data.toolRequests.length > 0) return
        clearFinalMessageFallback()
        finalMessageFallbackTimer = setTimeout(() => {
          finalMessageFallbackTimer = null
          finishTurn?.()
        }, 1500)
        if (typeof finalMessageFallbackTimer === 'object' && finalMessageFallbackTimer && 'unref' in finalMessageFallbackTimer) {
          (finalMessageFallbackTimer as { unref: () => void }).unref()
        }
      }

      const sleep = (ms: number) => new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        if (typeof timer === 'object' && timer && 'unref' in timer) {
          (timer as { unref: () => void }).unref()
        }
      })

      // Inactivity watchdog, NOT an absolute turn ceiling: re-armed by every
      // session event, so it only fires after COPILOT_TURN_INACTIVITY_MS of
      // total silence (no probe RPC exists in the Copilot SDK; the 1s history
      // poll below is the recovery path for missed completions, this is the
      // recovery path for a genuinely dead turn).
      const armTurnInactivityTimeout = () => {
        if (cleanedUp) return
        if (turnTimeoutTimer != null) clearTimeout(turnTimeoutTimer)
        turnTimeoutTimer = setTimeout(() => {
          failTurn?.(new Error(`Copilot turn produced no events for ${COPILOT_TURN_INACTIVITY_MS / 1000}s`))
        }, COPILOT_TURN_INACTIVITY_MS)
        if (typeof turnTimeoutTimer === 'object' && turnTimeoutTimer && 'unref' in turnTimeoutTimer) {
          (turnTimeoutTimer as { unref: () => void }).unref()
        }
      }

      try {
        const modelsById = new Map<string, CopilotModelInfo>()
        let activeContextTier = contextTier

        const turnComplete = new Promise<void>((resolve, reject) => {
          finishTurn = () => {
            clearFinalMessageFallback()
            resolve()
          }
          failTurn = (error) => {
            clearFinalMessageFallback()
            reject(error)
          }
        })

        const handleEvent = (event: CopilotSessionEvent) => {
          if (cleanedUp) return
          // Any session event proves the turn is alive — push the inactivity
          // deadline out. Only sustained SILENCE (no events at all) times out;
          // a long autopilot run that keeps emitting is never killed.
          armTurnInactivityTimeout()
          recordCopilotLiveTranscriptEvent(sessionId, event)
          broadcastLiveSessionActivity('copilot', sessionId)
          // Only the root agent's turn lifecycle ends our turn; sub-agent
          // turn_start/turn_end (which carry an agentId) must not finish it.
          const eventAgentId = (event as { agentId?: string }).agentId
          if (event.type === 'assistant.message') {
            streamedAssistantMessageIds.add(event.data.messageId)
            scheduleFinalMessageFallback(event)
          } else if (event.type === 'assistant.turn_start') {
            if (!eventAgentId) currentTurnId = event.data.turnId ?? currentTurnId
            clearFinalMessageFallback()
          } else if (event.type === 'assistant.turn_end') {
            // Authoritative completion. Match the captured root turnId so a stale
            // or sub-agent turn_end can't end the turn early; if we never saw a
            // turn_start, accept it rather than risk hanging on the heuristics.
            if (!eventAgentId && (currentTurnId == null || event.data.turnId === currentTurnId)) {
              finishTurn?.()
            }
          } else if ((event.type as string) === 'session.idle' || (event.type as string) === 'session.task_complete') {
            finishTurn?.()
          }

          if (event.type === 'assistant.usage') {
            const usage = mapCopilotUsageToContextUsage(event, modelsById, activeContextTier)
            if (usage) {
              safeEnqueue(codexContextUsageToEventData(usage))
              if (!seenUsageEventIds.has(event.id)) {
                seenUsageEventIds.add(event.id)
                turnOutputTokens += Math.max(0, event.data.outputTokens ?? 0)
                safeEnqueue(turnUsageToEventData(turnOutputTokens))
              }
            }
          }

          if (event.type === 'session.error') {
            emittedError = true
            const error = new Error(event.data.message)
            if (event.data.stack) error.stack = event.data.stack
            failTurn?.(error)
            safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: event.data.message })}\n\n`)
            return
          }

          safeEnqueue(`data: ${formatCopilotEvent(event)}\n\n`)
        }

        // Warm session pool: re-use a single Copilot session per id across
        // sends and bind a fresh listener for this turn only. The native CLI
        // keeps the JSON-RPC connection alive between turns; this matches.
        const [acquiredSession, availableModels] = await Promise.all([
          withTimeout(acquireCopilotSession(sessionId), 20000, 'Copilot session resume'),
          getCopilotClient()
            .then((client) => withTimeout(client.listModels(), 15000, 'Copilot model list'))
            .catch(() => [] as CopilotModelInfo[]),
        ])
        session = acquiredSession
        if (permissionMode) {
          await session.rpc.permissions.setAllowAll({ mode: permissionMode })
        }
        for (const model of availableModels) modelsById.set(model.id, model)
        if (!activeContextTier) {
          const currentModel = await withTimeout(
            session.rpc.model.getCurrent(),
            5000,
            'Copilot current model',
          ).catch(() => ({ modelId: undefined, contextTier: undefined }))
          activeContextTier = parseCopilotContextTier(currentModel.contextTier) ?? 'default'
        }
        if (manualPermissions) {
          setCopilotPermissionHandler(sessionId, createCopilotPermissionBridge(
            sessionId,
            safeEnqueue,
            bridgedPermissionIds,
            // Detached turns remain answerable through the process-global
            // pending map and /running replay. Only a true turn teardown makes
            // the user unavailable.
            () => !cleanedUp && (!downstreamClosed || detachOnClientAbort),
          ))
          manualPermissionHandlerInstalled = true
        } else {
          setCopilotPermissionHandler(sessionId, approveAll)
        }
        setCopilotElicitationHandler(sessionId, createCopilotElicitationBridge(
          sessionId,
          safeEnqueue,
          bridgedElicitationIds,
          () => !cleanedUp && (!downstreamClosed || detachOnClientAbort),
        ))
        elicitationHandlerInstalled = true
        unsubscribe = session.on(handleEvent)
        const historyBaselineCount = await withTimeout(
          readCopilotHistoryFromSession(session),
          5000,
          'Copilot history baseline',
        ).then((events) => events.length).catch(() => null)

        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`)
        broadcastLiveSessionTurnStart('copilot', sessionId)
        broadcastedTurnStart = true

        setRunningSession(sessionId, {
          provider: 'copilot',
          requestId: turnRequestId,
          interrupt: () => session?.abort() ?? Promise.resolve(),
        })

        signal.addEventListener('abort', () => {
          requestAborted = true
          if (detachOnClientAbort) {
            downstreamClosed = true
            // Keep pending permission and elicitation promises alive. They are
            // replayed by /running and resolved by the reconnecting surface.
            return
          }
          resolvePendingCopilotPermissions(sessionId, bridgedPermissionIds, { kind: 'user-not-available' })
          resolvePendingCopilotElicitations(sessionId, bridgedElicitationIds, { action: 'cancel' })
          void interruptRunningSession(sessionId, turnRequestId).catch(() => {})
        })

        const copilotEffort = effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
          ? effort
          : undefined

        if (selectedModel) {
          await withTimeout(
            session.setModel(selectedModel, copilotModelOptions({ effort: copilotEffort, contextTier })),
            15000,
            'Copilot model switch',
          )
        } else if (copilotEffort || contextTier) {
          const current = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined, contextTier: undefined }))
          const nextModel = current.modelId
          if (nextModel && (copilotEffort || contextTier)) {
            await withTimeout(
              session.setModel(nextModel, copilotModelOptions({
                effort: copilotEffort,
                contextTier: contextTier ?? parseCopilotContextTier(current.contextTier),
              })),
              15000,
              'Copilot model switch',
            )
          }
        }

        let promptToSend = composerPrompt
        const slashCommand = nativeCommands && parsedAttachments.length === 0
          ? parseOpenCodeSlashCommand(userMessage)
          : null
        if (slashCommand) {
          const commandName = slashCommand.command.toLowerCase()
          if (commandName === 'help') {
            safeEnqueue(copilotCommandResultEvent({
              message: 'Copilot commands: /mode [interactive|plan|autopilot|shell], /model [model].',
            }))
            return
          }
          if (commandName === 'mode') {
            const requestedMode = parseCopilotMode(slashCommand.arguments.split(/\s+/)[0])
            if (!requestedMode) {
              const currentMode = await withTimeout(session.rpc.mode.get(), 5000, 'Copilot mode read').catch(() => 'interactive')
              const parsedCurrentMode = parseCopilotModeResponse(currentMode) ?? 'interactive'
              safeEnqueue(copilotCommandResultEvent({
                message: `Copilot mode is ${parsedCurrentMode}. Use /mode interactive, /mode plan, /mode autopilot, or /mode shell.`,
                mode: parsedCurrentMode,
              }))
              return
            }
            if (isCopilotPersistentMode(requestedMode)) {
              await withTimeout(session.rpc.mode.set({ mode: requestedMode }), 5000, 'Copilot mode switch')
            }
            safeEnqueue(copilotCommandResultEvent({
              message: `Copilot mode set to ${requestedMode}.`,
              mode: requestedMode,
            }))
            return
          }
          if (commandName === 'model') {
            const requestedModel = slashCommand.arguments.trim()
            if (!requestedModel) {
              const current = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined }))
              safeEnqueue(copilotCommandResultEvent({
                message: current.modelId ? `Copilot model is ${current.modelId}.` : 'No Copilot model is selected.',
              }))
              return
            }
            await withTimeout(
              session.setModel(requestedModel, copilotModelOptions({ effort: copilotEffort, contextTier })),
              15000,
              'Copilot model switch',
            )
            safeEnqueue(copilotCommandResultEvent({
              message: `Copilot model set to ${requestedModel}.`,
            }))
            return
          }

          const commandsRpc = (session.rpc as typeof session.rpc & {
            commands?: typeof session.rpc.commands & {
              invoke?: (params: { name: string; input?: string }) => Promise<unknown>
            }
          }).commands
          if (commandsRpc?.invoke) {
            const result = await withTimeout(
              commandsRpc.invoke({
                name: slashCommand.command,
                input: slashCommand.arguments || undefined,
              }),
              10000,
              'Copilot slash command',
            )
            const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
              ? result as unknown as Record<string, unknown>
              : null
            if (resultRecord?.kind === 'agent-prompt' && typeof resultRecord.prompt === 'string') {
              const mode = parseCopilotMode(resultRecord.mode)
              if (mode) turnAgentMode = mode
              promptToSend = resultRecord.prompt
            } else if (resultRecord?.kind === 'text' && typeof resultRecord.text === 'string') {
              safeEnqueue(copilotCommandResultEvent({
                message: resultRecord.text,
              }))
              return
            } else if (resultRecord?.kind === 'completed') {
              safeEnqueue(copilotCommandResultEvent({
                message: typeof resultRecord.message === 'string' && resultRecord.message.trim()
                  ? resultRecord.message
                  : `/${slashCommand.command} completed.`,
              }))
              return
            } else if (resultRecord?.kind === 'select-subcommand') {
              safeEnqueue(copilotCommandResultEvent({
                message: `/${slashCommand.command} needs a subcommand in the native Copilot UI.`,
              }))
              return
            }
          }
        }

        armTurnInactivityTimeout()
        const messageOptions: CopilotSendMessageOptions = {
          prompt: promptToSend,
          attachments: attachments.length > 0 ? attachments : undefined,
        }
        if (turnAgentMode) messageOptions.agentMode = turnAgentMode
        await session.send(messageOptions as CopilotMessageOptions)
        safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'copilot' })}\n\n`)
        // The initial send has now been accepted, so follow-up text can safely
        // use Copilot's immediate delivery mode to interject in this same run.
        // Registering this only after the first send avoids a rapid second tab
        // accidentally starting the session while model/mode setup is pending.
        setRunningSession(sessionId, {
          provider: 'copilot',
          requestId: turnRequestId,
          interrupt: () => session?.abort() ?? Promise.resolve(),
          steer: (text) => steerCopilotSession(session!, text),
        })
        const historyCompletion = historyBaselineCount == null
          ? new Promise<never>(() => {})
          : (async () => {
            while (!historyPollCancelled && !cleanedUp) {
              await sleep(1000)
              if (historyPollCancelled || cleanedUp || !session) return
              const events = await withTimeout(
                readCopilotHistoryFromSession(session),
                5000,
                'Copilot history poll',
              ).catch(() => null)
              if (!events) continue
              const finalMessage = findCopilotHistoryCompletion(
                events,
                historyBaselineCount,
                turnAgentMode !== 'autopilot',
              )
              if (!finalMessage) continue
              if (!streamedAssistantMessageIds.has(finalMessage.data.messageId)) {
                broadcastLiveSessionActivity('copilot', sessionId)
                safeEnqueue(`data: ${formatCopilotEvent(finalMessage)}\n\n`)
              }
              return
            }
          })()
        await Promise.race([turnComplete, historyCompletion])
      } catch (err) {
        if (!emittedError && !requestAborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        }
        // If the session itself is hosed, evict so the next send reconnects.
        await evictCopilotSession(sessionId).catch(() => {})
      } finally {
        if (turnTimeoutTimer != null) {
          clearTimeout(turnTimeoutTimer)
          turnTimeoutTimer = null
        }
        historyPollCancelled = true
        clearFinalMessageFallback()
        resolvePendingCopilotPermissions(sessionId, bridgedPermissionIds, { kind: 'user-not-available' })
        resolvePendingCopilotElicitations(sessionId, bridgedElicitationIds, { action: 'cancel' })
        if (manualPermissionHandlerInstalled) {
          setCopilotPermissionHandler(sessionId, approveAll)
        }
        if (elicitationHandlerInstalled) {
          setCopilotElicitationHandler(sessionId, () => ({ action: 'decline' }))
        }
        clearRunningSession(sessionId, turnRequestId)
        try { unsubscribe?.() } catch { /* ignore */ }
        // Do NOT evict the warm session on a clean turn completion. Evicting
        // here disconnects the JSON-RPC session and forces a full resumeSession
        // (up to a 20s timeout) on the very next send, defeating the warm pool
        // for back-to-back turns. Rely on the 5-min TTL; the catch{} branch
        // above still evicts when the session is genuinely hosed.
        if (broadcastedTurnStart) {
          broadcastLiveSessionTurnEnd('copilot', sessionId)
          scheduleCopilotLiveTranscriptCleanup(sessionId)
        }
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function createPiStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const turnRequestId = parseTurnRequestId(body)
  const isPendingSession = Boolean(body.isPendingSession)
  const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const selectedModel = decodePiModelValue(typeof body.model === 'string' ? body.model : null)
  const effort = parseEffort(body)
  const attachments = parseAttachments(body)
  const attachmentPlan = planComposerAttachments('pi', attachments)
  assertComposerAttachmentsSupported('pi', attachmentPlan)
  const directShell = parsePiDirectShell(userMessage)
  const detachOnClientAbort = body.detachOnClientAbort === true
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let cleanedUp = false
      let downstreamClosed = false
      let requestAborted = false
      let broadcastedTurnStart = false
      let targetSessionId = sessionId
      let unsubscribePi: (() => void) | undefined
      let turnOutputTokens = 0
      const activePiUiIds = new Set<string>()
      let piUiHandler: PiUiHandler | undefined
      let clearPiUiHandler: (() => void) | undefined
      let piTurnTerminalError: string | undefined
      let releasePiOperation: (() => void) | undefined
      let interruptOnAbort: (() => void) | undefined

      const onAbort = () => {
        requestAborted = true
        if (detachOnClientAbort) {
          downstreamClosed = true
          return
        }
        interruptOnAbort?.()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()

      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }
      // Commit the response before a cold AgentSession open/resource reload.
      safeEnqueue(':ok\n\n')

      const close = () => {
        if (cleanedUp) return
        cleanedUp = true
        cancelPendingPiUiRequests(targetSessionId, activePiUiIds)
        clearPiUiHandler?.()
        releasePiOperation?.()
        signal.removeEventListener('abort', onAbort)
        if (downstreamClosed) return
        downstreamClosed = true
        try {
          controller.close()
        } catch {
          /* downstream already closed */
        }
      }

      try {
        releasePiOperation = beginPiSessionOperation(sessionId, 'turn')
        const agentSession = isPendingSession
          ? await createPiAgentSession(cwdOverride ?? process.cwd(), { id: sessionId })
          : await openPiAgentSession(sessionId)
        targetSessionId = agentSession.sessionId
        // The warm Pi session is single-turn: a concurrent send (another tab, a
        // rapid double-fire) would otherwise hit the raw SDK "Agent is already
        // processing" throw after we'd already mutated model/thinking state.
        // Detect it up front and surface a clear message instead — the catch
        // below turns this into a tidy error frame and closes cleanly.
        if (agentSession.isStreaming) {
          throw new Error('Pi is still finishing the previous message. Wait for it to complete before sending another.')
        }
        // Claim the session before any async model/image/extension setup. Two
        // tabs can otherwise both pass isStreaming while Pi is still idle and
        // race into prompt(), with the later stream stealing the UI bridge.
        // The registry check + set are synchronous, so this closes that window.
        if (getRunningSession(sessionId)) {
          throw new Error('Pi is already preparing or running another message for this session.')
        }
        setRunningSession(sessionId, {
          provider: 'pi',
          requestId: turnRequestId,
          interrupt: () => agentSession.abort(),
          steer: (text) => agentSession.steer(text),
        })
        interruptOnAbort = () => { void interruptRunningSession(sessionId, turnRequestId).catch(() => {}) }
        if (requestAborted && !detachOnClientAbort) {
          throw new Error('Pi request aborted before the turn started.')
        }
        if (selectedModel) {
          const model = agentSession.modelRuntime.getModel(selectedModel.providerID, selectedModel.modelID)
          if (!model) {
            throw new Error(`Pi model not found: ${selectedModel.providerID}/${selectedModel.modelID}`)
          }
          if (agentSession.model?.provider !== selectedModel.providerID || agentSession.model?.id !== selectedModel.modelID) {
            await agentSession.setModel(model)
          }
        }
        if (effort && PI_THINKING_LEVELS.includes(effort as typeof PI_THINKING_LEVELS[number])) {
          agentSession.setThinkingLevel(effort as typeof PI_THINKING_LEVELS[number])
        }
        const images = await buildPiImages(attachmentPlan.native, cwdOverride)

        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`)
        broadcastLiveSessionTurnStart('pi', targetSessionId)
        broadcastedTurnStart = true

        // Execute native Pi slash commands instead of sending them as prompt text.
        const piSlash = !directShell && attachments.length === 0 ? parseOpenCodeSlashCommand(userMessage) : null
        const finishPiCommand = (message: string) => {
          safeEnqueue(commandResultEvent('pi', { message, transcriptExpected: false }))
          clearRunningSession(sessionId, turnRequestId)
          broadcastLiveSessionTurnEnd('pi', targetSessionId)
          schedulePiLiveTranscriptCleanup(targetSessionId)
          close()
        }
        if (piSlash && piSlash.command.toLowerCase() === 'help') {
          finishPiCommand('Pi commands: /model [provider/model], /thinking [off|minimal|low|medium|high|xhigh|max], /compact [instructions], /name <name>, /session, /reload.')
          return
        }
        if (piSlash && piSlash.command.toLowerCase() === 'model') {
          const requestedModel = piSlash.arguments.trim()
          if (!requestedModel) {
            finishPiCommand(agentSession.model
              ? `Pi model is ${agentSession.model.provider}/${agentSession.model.id}.`
              : 'No Pi model is selected.')
            return
          }
          const scopedModels = agentSession.scopedModels.map((entry) => entry.model)
          const availableModels = scopedModels.length > 0
            ? scopedModels
            : await agentSession.modelRuntime.getAvailable()
          const modelRef = findPiModelByReference(requestedModel, availableModels)
          if (!modelRef) {
            finishPiCommand(`Pi model not found or ambiguous: ${requestedModel}.`)
            return
          }
          const model = agentSession.modelRuntime.getModel(modelRef.provider, modelRef.id)
          if (!model) {
            finishPiCommand(`Pi model not found: ${modelRef.provider}/${modelRef.id}.`)
            return
          }
          await agentSession.setModel(model)
          finishPiCommand(`Pi model set to ${model.provider}/${model.id}.`)
          return
        }
        if (piSlash && piSlash.command.toLowerCase() === 'thinking') {
          const level = piSlash.arguments.trim()
          if (!level) {
            finishPiCommand(`Pi thinking level is ${agentSession.thinkingLevel}.`)
            return
          }
          if (!PI_THINKING_LEVELS.includes(level as typeof PI_THINKING_LEVELS[number])) {
            finishPiCommand('Use /thinking off, /thinking minimal, /thinking low, /thinking medium, /thinking high, /thinking xhigh, or /thinking max.')
            return
          }
          agentSession.setThinkingLevel(level as typeof PI_THINKING_LEVELS[number])
          finishPiCommand(`Pi thinking level set to ${level}.`)
          return
        }
        if (piSlash && piSlash.command.toLowerCase() === 'compact') {
          setRunningSession(sessionId, {
            provider: 'pi',
            requestId: turnRequestId,
            interrupt: () => agentSession.abort(),
          })
          safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_start', reason: 'manual' })}\n\n`)
          try {
            await agentSession.compact(piSlash.arguments || undefined)
            safeEnqueue(commandResultEvent('pi', { message: 'Compacted the conversation.' }))
          } finally {
            safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_end', reason: 'manual' })}\n\n`)
            clearRunningSession(sessionId, turnRequestId)
            broadcastLiveSessionTurnEnd('pi', targetSessionId)
            schedulePiLiveTranscriptCleanup(targetSessionId)
            close()
          }
          return
        }
        if (piSlash && piSlash.command.toLowerCase() === 'name') {
          const name = piSlash.arguments.trim()
          if (!name) {
            finishPiCommand(agentSession.sessionName
              ? `Pi session name is "${agentSession.sessionName}".`
              : 'This Pi session has no display name.')
            return
          }
          await setPiSessionName(sessionId, name)
          finishPiCommand(`Pi session named "${name}".`)
          return
        }
        if (piSlash && piSlash.command.toLowerCase() === 'session') {
          const stats = agentSession.getSessionStats()
          const contextUsage = stats.contextUsage
          const contextTokens = contextUsage?.tokens ?? 0
          const contextWindow = contextUsage?.contextWindow ?? 0
          const contextPercent = contextUsage?.percent
            ?? (contextWindow > 0 ? contextTokens / contextWindow * 100 : 0)
          const context = contextUsage
            ? ` Context: ${contextTokens}/${contextWindow} tokens (${contextPercent.toFixed(1)}%).`
            : ''
          finishPiCommand(
            `Pi session ${stats.sessionId}: ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolCalls} tool calls; ${stats.tokens.total} tokens; $${stats.cost.toFixed(4)}.${context}`,
          )
          return
        }
        if (piSlash && piSlash.command.toLowerCase() === 'reload') {
          piUiHandler = createPiUiBridge(targetSessionId, safeEnqueue, activePiUiIds)
          clearPiUiHandler = installPiUiHandler(targetSessionId, piUiHandler)
          await ensurePiExtensionUiBound(agentSession, targetSessionId)
          await agentSession.reload()
          finishPiCommand('Reloaded Pi extensions, skills, prompts, settings, and context files.')
          return
        }

        if (directShell) {
          if (!directShell.command) {
            throw new Error('Pi shell command cannot be empty')
          }
          if (attachments.length > 0) {
            throw new Error('Pi shell commands do not support attachments')
          }
          setRunningSession(sessionId, {
            provider: 'pi',
            requestId: turnRequestId,
            interrupt: async () => { agentSession.abortBash() },
          })
          let directShellOutput = ''
          const bashResult = await agentSession.executeBash(directShell.command, (chunk) => {
            directShellOutput += chunk
            recordPiLiveBashMessage(targetSessionId, {
              command: directShell.command,
              output: directShellOutput,
              excludeFromContext: directShell.excludeFromContext,
            })
            broadcastLiveSessionActivity('pi', targetSessionId)
            safeEnqueue(`data: ${JSON.stringify({
              type: 'pi_bash_delta',
              command: directShell.command,
              delta: chunk,
              excludeFromContext: directShell.excludeFromContext,
            })}\n\n`)
          }, {
            excludeFromContext: directShell.excludeFromContext,
          })
          recordPiLiveBashMessage(targetSessionId, {
            command: directShell.command,
            output: typeof bashResult.output === 'string' ? bashResult.output : directShellOutput,
            excludeFromContext: directShell.excludeFromContext,
            exitCode: typeof bashResult.exitCode === 'number' ? bashResult.exitCode : undefined,
            cancelled: Boolean(bashResult.cancelled),
            truncated: Boolean(bashResult.truncated),
            fullOutputPath: typeof bashResult.fullOutputPath === 'string' ? bashResult.fullOutputPath : undefined,
          })
          clearRunningSession(sessionId, turnRequestId)
          broadcastLiveSessionActivity('pi', targetSessionId)
          broadcastLiveSessionTurnEnd('pi', targetSessionId)
          schedulePiLiveTranscriptCleanup(targetSessionId)
          close()
          return
        }

        // Pi extensions use an RPC-style UI contract for select/confirm/input
        // dialogs. Bind a stable dispatcher once per warm AgentSession and aim
        // its current handler at this turn so extension prompts become the same
        // reattachable structured questions used by every other provider. The
        // running entry is installed first because extension session-start hooks
        // can themselves request input before prompt() begins.
        piUiHandler = createPiUiBridge(targetSessionId, safeEnqueue, activePiUiIds)
        clearPiUiHandler = installPiUiHandler(targetSessionId, piUiHandler)
        await ensurePiExtensionUiBound(agentSession, targetSessionId)

        // Subscribe to the AgentSession event stream (not the raw Agent): only
        // AgentSession surfaces willRetry on agent_end plus auto_retry/compaction/
        // queue progress. Subscribing to the raw Agent makes transient,
        // auto-retried errors look fatal (false "Pi turn failed" toast) and closes
        // the stream on the first agent_end — cutting off the retry the user never
        // sees. Native Pi instead shows a quiet "retrying…" and recovers; the
        // later agent_settled event is the only terminal boundary.
        unsubscribePi = agentSession.subscribe((event) => {
          if (cleanedUp) return
          if (event.type === 'agent_start') {
            safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId: targetSessionId, provider: 'pi' })}\n\n`)
          }

          // Session-level progress is not part of the transcript. Surface it as
          // non-fatal status frames so the composer can show "Retrying…" /
          // "Compacting…" / the live queue instead of looking hung — never as an
          // error, and never closing the stream.
          switch (event.type) {
            case 'auto_retry_start':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'retry_start', attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.errorMessage })}\n\n`)
              return
            case 'auto_retry_end':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'retry_end', success: event.success, attempt: event.attempt })}\n\n`)
              return
            case 'summarization_retry_scheduled':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'summarization_retry_start', attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.errorMessage })}\n\n`)
              return
            case 'summarization_retry_attempt_start':
              return
            case 'summarization_retry_finished':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'summarization_retry_end' })}\n\n`)
              return
            case 'compaction_start':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_start', reason: event.reason })}\n\n`)
              return
            case 'compaction_end':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'compaction_end', reason: event.reason, aborted: event.aborted })}\n\n`)
              return
            case 'queue_update':
              safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'queue_update', steering: event.steering, followUp: event.followUp })}\n\n`)
              return
            case 'session_info_changed':
              // Pi auto-titles sessions mid-turn; forward the new name immediately
              // instead of waiting for the next 5s session-list poll to pick it up.
              if (event.name) {
                safeEnqueue(`data: ${JSON.stringify({ type: 'pi_status', status: 'title_changed', name: event.name })}\n\n`)
              }
              return
            case 'thinking_level_changed':
              return
            case 'agent_settled': {
              const lifecycle = reducePiTurnLifecycle(piTurnTerminalError, event)
              if (lifecycle.terminalError) {
                safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: lifecycle.terminalError })}\n\n`)
              }
              clearRunningSession(sessionId, turnRequestId)
              unsubscribePi?.()
              broadcastLiveSessionTurnEnd('pi', targetSessionId)
              schedulePiLiveTranscriptCleanup(targetSessionId)
              close()
              return
            }
            default:
              break
          }

          // A will-retry agent_end is interim — an auto-retry or auto-compaction
          // will re-run the agent on the same prompt() call. Suppress it while
          // the client waits for the authoritative agent_settled event.
          if (event.type === 'agent_end' && event.willRetry) return

          // From here on `event` is a core transcript AgentEvent.
          const agentEvent = event as PiAgentEvent
          recordPiLiveTranscriptEvent(targetSessionId, agentEvent)
          broadcastLiveSessionActivity('pi', targetSessionId)
          safeEnqueue(`data: ${JSON.stringify({ type: 'pi_event', event: agentEvent })}\n\n`)

          if (event.type === 'message_end' && event.message.role === 'assistant') {
            turnOutputTokens += Math.max(0, event.message.usage.output)
            safeEnqueue(turnUsageToEventData(turnOutputTokens))
          }

          if (event.type === 'agent_end') {
            // agent_end is not terminal for AgentSession: extension agent_end
            // hooks can queue another continuation. Defer close/error delivery
            // until the authoritative agent_settled event.
            piTurnTerminalError = reducePiTurnLifecycle(piTurnTerminalError, event).terminalError
          }
        })

        const text = appendPortableComposerContext(userMessage, attachmentPlan.portableText)
        await agentSession.prompt(text, images.length > 0 ? { images } : undefined)
        // prompt() resolving means the turn is genuinely over. Normally the
        // agent_settled handler above already ran cleanup + close (and set
        // cleanedUp). But if that event was never delivered to our subscriber,
        // without this backstop the AgentSession subscription would leak and the
        // stream would hang open forever. Guard on cleanedUp so it's a no-op on
        // the happy path.
        if (!cleanedUp) {
          unsubscribePi?.()
          clearRunningSession(sessionId, turnRequestId)
          broadcastLiveSessionTurnEnd('pi', targetSessionId)
          schedulePiLiveTranscriptCleanup(targetSessionId)
          close()
        }
      } catch (err) {
        unsubscribePi?.()
        if (!requestAborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        }
        clearRunningSession(sessionId, turnRequestId)
        if (broadcastedTurnStart) {
          broadcastLiveSessionTurnEnd('pi', targetSessionId)
          schedulePiLiveTranscriptCleanup(targetSessionId)
        }
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Warm the send path for a session before the user hits Enter. Fired by the
 * composer UI when it gains focus, so the expensive per-session setup overlaps
 * with the user typing instead of sitting in front of the first token:
 * - claude: spawn the warm pool Query the send will attach to (the CLI boot is
 *   ~1-3s — the dominant first-send cost). Skipped when an entry already
 *   exists so a prewarm can never recycle a live or in-turn entry.
 * - codex: start the app-server if needed and resume the thread (cached).
 * - pi: open the pooled AgentSession (createAgentSession runs resource loading
 *   + package resolution on a cold open; the pool makes this idempotent).
 * - copilot: resume the SDK session (cached by the copilot client).
 * Opencode connects through a long-lived local server — cheap per-send.
 * Best-effort: failures just mean the send pays the usual cold cost.
 */
export async function prewarmViewSession(params: {
  sessionId: string
  provider?: AgentProvider
  cwd?: string
  model?: string
  effort?: ReasoningEffortLevel
  isPending?: boolean
}): Promise<void> {
  const provider = await resolveProvider(params.provider)
  if (provider === 'claude') {
    if (peekClaudeSession(params.sessionId)) return
    // The SDK's `sessionId` create-time option forces the CLI to adopt the
    // client's own pending UUID as its real session id — spawning now (while
    // the user is still typing their first message) runs the CLI's
    // SessionStart hooks and MCP init in the background instead of eating
    // the delay synchronously after they hit send. createClaudeStream picks
    // this warm entry up via the pooled path once a message actually arrives
    // (see the pendingWarm check there); if it isn't ready in time, the cold
    // path spawns fresh exactly as before — no regression either way.
    acquireClaudeSession({
      sessionId: params.sessionId,
      cwd: params.cwd,
      // Leave model unset when not provided — see createClaudeStream for why
      // a hardcoded literal breaks custom-model deployments.
      model: params.model,
      fallbackModel: claudeFallbackModelChain(),
      effort: params.effort,
      isPendingSession: params.isPending,
    })
    return
  }
  if (provider === 'codex') {
    if (params.isPending) return
    await ensureCodexThreadResumed(params.sessionId)
    return
  }
  if (provider === 'copilot') {
    if (params.isPending) return
    await acquireCopilotSession(params.sessionId)
    return
  }
  if (provider === 'pi') {
    // Pi's cold open is the slowest (~19s) so a pending session is exactly where
    // prewarm pays off. createPiAgentSession is idempotent on the id, so the
    // first send reuses this pooled session instead of recreating it.
    if (params.isPending) {
      await createPiAgentSession(params.cwd ?? process.cwd(), { id: params.sessionId })
      return
    }
    await openPiAgentSession(params.sessionId)
    return
  }
  // opencode connects through a long-lived local server — no spawn to hide.
}

async function createLmstudioStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const selectedModel = typeof body.model === 'string' ? body.model : undefined
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let downstreamClosed = false
      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }
      const close = () => {
        if (downstreamClosed) return
        downstreamClosed = true
        try {
          controller.close()
        } catch {
          /* downstream already closed */
        }
      }

      const record = await getLmstudioSession(sessionId)
      if (!record) {
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: `LM Studio session not found: ${sessionId}` })}\n\n`)
        close()
        return
      }

      setRunningSession(sessionId, {
        provider: 'lmstudio',
        interrupt: async () => undefined,
      })
      broadcastLiveSessionTurnStart('lmstudio', sessionId)
      safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider: 'lmstudio' })}\n\n`)

      try {
        const model = selectedModel || record.model
        const result = await streamLmstudioChatCompletion(record.messages, userMessage, model, signal, (delta) => {
          if (delta.content) {
            broadcastLiveSessionActivity('lmstudio', sessionId)
            safeEnqueue(`data: ${JSON.stringify({ type: 'lmstudio_delta', delta: delta.content })}\n\n`)
          }
        })
        await appendLmstudioTurn(sessionId, userMessage, result.text, result.model, result.usage)
      } catch (err) {
        if (!signal.aborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown LM Studio error' })}\n\n`)
        }
      } finally {
        clearRunningSession(sessionId)
        broadcastLiveSessionTurnEnd('lmstudio', sessionId)
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

const ACP_POLL_INTERVAL_MS = 200

async function createAcpStream(
  provider: 'claude-acp' | 'codex-acp',
  sessionId: string,
  signal: AbortSignal,
  body: Record<string, unknown>,
): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const cwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : process.cwd()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let downstreamClosed = false
      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }
      const close = () => {
        if (downstreamClosed) return
        downstreamClosed = true
        try {
          controller.close()
        } catch {
          /* downstream already closed */
        }
      }

      try {
        await acquireAcpSession(sessionId, acpAgentKindOf(provider), cwd)
      } catch (err) {
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to start ACP session' })}\n\n`)
        close()
        return
      }

      setRunningSession(sessionId, {
        provider,
        interrupt: async () => {
          await interruptAcpSession(sessionId)
        },
      })
      broadcastLiveSessionTurnStart(provider, sessionId)
      safeEnqueue(`event: turn-accepted\ndata: ${JSON.stringify({ sessionId, provider })}\n\n`)

      let lastIndex = -1
      try {
        sendAcpPrompt(sessionId, userMessage)
        // sendAcpPrompt sets inTurn synchronously before returning, so this
        // poll loop's very first iteration always observes a running turn.
        while (!signal.aborted) {
          const { messages, latestIndex } = readAcpMessagesSince(sessionId, lastIndex)
          if (messages.length > 0) {
            lastIndex = latestIndex
            broadcastLiveSessionActivity(provider, sessionId)
            const mapped = mapAcpBufferedMessages(sessionId, provider, messages)
            for (const msg of mapped) {
              safeEnqueue(`data: ${JSON.stringify({ type: 'acp_message', message: msg })}\n\n`)
            }
          }
          const entry = peekAcpSession(sessionId)
          if (!entry || !entry.alive || !entry.inTurn) break
          await new Promise((resolve) => setTimeout(resolve, ACP_POLL_INTERVAL_MS))
        }
      } catch (err) {
        if (!signal.aborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown ACP error' })}\n\n`)
        }
      } finally {
        clearRunningSession(sessionId)
        broadcastLiveSessionTurnEnd(provider, sessionId)
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function streamViewSessionTurn(params: SendMessageParams): Promise<Response> {
  const userMessage = String(params.body.message ?? '').trim()
  if (!userMessage) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const provider = await resolveProvider(params.provider)

  // Turn checkpoint: snapshot the working tree BEFORE the agent can touch it
  // (hidden git commit behind refs/agent-viewer-checkpoints/). Best-effort and
  // internally time-capped — a missing checkpoint never blocks the turn.
  const checkpointCwd = typeof params.body.cwd === 'string' && params.body.cwd.trim()
    ? params.body.cwd.trim()
    : null
  if (checkpointCwd) {
    await createTurnCheckpoint(checkpointCwd, {
      sessionId: params.sessionId,
      provider,
      message: userMessage,
    }).catch(() => null)
  }

  if (provider === 'codex') {
    return createCodexStream(params.sessionId, params.signal, params.body)
  }
  if (provider === 'opencode') {
    return createOpenCodeStream(params.sessionId, params.signal, params.body)
  }
  if (provider === 'copilot') {
    return createCopilotStream(params.sessionId, params.signal, params.body)
  }
  if (provider === 'pi') {
    return createPiStream(params.sessionId, params.signal, params.body)
  }
  if (provider === 'lmstudio') {
    return createLmstudioStream(params.sessionId, params.signal, params.body)
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    return createAcpStream(provider, params.sessionId, params.signal, params.body)
  }

  return createClaudeStream(params.sessionId, params.signal, params.body)
}

export async function forkViewSession({ sessionId, body, provider }: ForkParams): Promise<{ sessionId: string }> {
  const resolvedProvider = await resolveProvider(provider)
  if (resolvedProvider === 'codex') {
    const client = getCodexClient()
    const response = await client.request('thread/fork', {
      threadId: sessionId,
    })
    if (typeof body.title === 'string' && body.title.trim()) {
      await client.request('thread/name/set', {
        threadId: response.thread.id,
        name: body.title.trim(),
      })
    }
    return { sessionId: response.thread.id }
  }
  if (resolvedProvider === 'opencode') {
    const client = await getOpenCodeClient()
    const forkedResponse = await client.session.fork({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      body: {
        messageID: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
      },
    })
    const forked = openCodeData<OpenCodeSession>(forkedResponse)
    if (typeof body.title === 'string' && body.title.trim()) {
      await client.session.update({
        ...OPENCODE_OPTIONS,
        path: { id: forked.id },
        body: { title: body.title.trim() },
      })
    }
    return { sessionId: forked.id }
  }
  if (resolvedProvider === 'copilot') {
    void sessionId
    void body
    throw new Error('Fork is not supported for GitHub Copilot sessions')
  }
  if (resolvedProvider === 'pi') {
    const entryId = typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined
    const newId = await forkPiSession(sessionId, entryId)
    if (!newId) {
      throw new Error('Failed to fork Pi session')
    }
    return { sessionId: newId }
  }
  if (resolvedProvider === 'lmstudio') {
    void sessionId
    void body
    throw new Error('Fork is not supported for LM Studio sessions')
  }
  if (resolvedProvider === 'claude-acp' || resolvedProvider === 'codex-acp') {
    void sessionId
    void body
    throw new Error(`Fork is not supported for ${resolvedProvider} sessions`)
  }

  const result = await forkSession(sessionId, {
    title: typeof body.title === 'string' ? body.title : undefined,
    upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
    ...claudeSessionStoreOptions(),
  })
  return { sessionId: result.sessionId }
}

export async function createNewViewSession({
  provider: providerOverride,
  cwd,
  title,
  codexDynamicTools,
}: {
  provider?: AgentProvider
  cwd?: string
  title?: string
  // Codex has no equivalent of Claude's per-query mcpServers lookup — custom
  // tools are declared once at thread/start and can't be added afterward
  // (see lib/agentCoordinationSdkTools.ts's Codex section), so a coordinator
  // caller must pass its static coord_* tool specs through session creation
  // itself rather than registering them after the fact like every other
  // provider.
  codexDynamicTools?: DynamicToolSpec[]
}): Promise<{ sessionId: string; provider: AgentProvider; cwd: string; isPending: boolean }> {
  const provider = await resolveProvider(providerOverride)
  const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd()

  if (provider === 'claude') {
    const { randomUUID } = await import('node:crypto')
    return { sessionId: randomUUID(), provider, cwd: resolvedCwd, isPending: true }
  }

  if (provider === 'codex') {
    const client = getCodexClient()
    const response = await client.request('thread/start', {
      ...(codexDynamicTools?.length ? { dynamicTools: codexDynamicTools } : {}),
      cwd: resolvedCwd,
    })
    const newId = response.thread.id
    // thread/start already loads the thread into this app-server process. Mark
    // it before the TUI can poll session detail so metadata reads reuse the
    // loaded writer instead of issuing thread/resume against an active turn.
    codexResumedThreads.set(newId, response.model)
    if (title && title.trim()) {
      await client.request('thread/name/set', { threadId: newId, name: title.trim() }).catch(() => {})
    }
    return { sessionId: newId, provider, cwd: response.thread.cwd ?? resolvedCwd, isPending: true }
  }

  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    const response = await client.session.create({
      ...OPENCODE_OPTIONS,
      query: { directory: resolvedCwd },
      body: title && title.trim() ? { title: title.trim() } : undefined,
    })
    const session = openCodeData<OpenCodeSession>(response)
    return { sessionId: session.id, provider, cwd: resolvedCwd, isPending: false }
  }

  if (provider === 'copilot') {
    const client = await getCopilotClient()
    const { approveAll } = await import('@github/copilot-sdk')
    const session = await client.createSession({
      workingDirectory: resolvedCwd,
      onPermissionRequest: approveAll,
      ...copilotSessionConfigOverrides(),
    })
    return { sessionId: session.sessionId, provider, cwd: resolvedCwd, isPending: false }
  }

  if (provider === 'pi') {
    const { randomUUID } = await import('node:crypto')
    return { sessionId: randomUUID(), provider, cwd: resolvedCwd, isPending: true }
  }

  if (provider === 'lmstudio') {
    const record = await createLmstudioSession(resolvedCwd, title)
    return { sessionId: record.id, provider, cwd: resolvedCwd, isPending: false }
  }

  if (provider === 'claude-acp' || provider === 'codex-acp') {
    // ACP has no listing RPC, so the session is created lazily on first
    // prompt (createAcpStream's acquireAcpSession) — mirrors Claude/Pi's
    // pending-id pattern, just with no durable history behind it.
    const { randomUUID } = await import('node:crypto')
    return { sessionId: randomUUID(), provider, cwd: resolvedCwd, isPending: true }
  }

  throw new Error(`Create is not supported for ${provider} sessions`)
}

/**
 * Interrupt the session's running turn. Returns the uuids of queued async
 * messages that survive the interrupt (Claude interrupt_receipt_v1), or
 * undefined when the provider has no receipt.
 */
export async function interruptViewSession(sessionId: string, turnRequestId?: string, cancelQueued = false): Promise<string[] | undefined> {
  const receipt = await interruptRunningSession(sessionId, turnRequestId, cancelQueued)
  const stillQueued = (receipt as { still_queued?: unknown } | undefined)?.still_queued
  return Array.isArray(stillQueued)
    ? stillQueued.filter((uuid): uuid is string => typeof uuid === 'string')
    : undefined
}

/** Release provider-side resources for an active session without deleting its durable history. */
export async function closeViewSession(sessionId: string, providerOverride?: AgentProvider): Promise<void> {
  const provider = await resolveProvider(providerOverride)
  await interruptViewSession(sessionId, undefined, true).catch(() => {})
  if (provider === 'claude') {
    recycleClaudeSession(sessionId)
    return
  }
  if (provider === 'codex') {
    await getCodexClient().request('thread/unsubscribe', { threadId: sessionId }).catch(() => {})
    codexResumedThreads.delete(sessionId)
    return
  }
  if (provider === 'copilot') {
    await evictCopilotSession(sessionId).catch(() => {})
    return
  }
  if (provider === 'pi') {
    evictPiAgentSession(sessionId)
    return
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    closeAcpSession(sessionId)
  }
}

function listPendingProviderPermissionPayloads(
  sessionId: string,
  provider?: AgentProvider,
): Record<string, unknown>[] {
  if (!provider || provider === 'claude') {
    return [
      ...listPendingClaudePrompts(sessionId).map((data) => ({
        type: 'claude_permission',
        event: { type: 'permission.requested', data },
      })),
      ...listPendingClaudeElicitations(sessionId).map((data) => ({
        type: 'claude_elicitation',
        event: { type: 'elicitation.requested', data },
      })),
    ]
  }
  if (provider === 'copilot') {
    const prefix = `${sessionId}:`
    return [
      ...Array.from(pendingCopilotPermissions)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, pending]) => pending.requestPayload),
      ...Array.from(pendingCopilotElicitations)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, pending]) => pending.requestPayload),
    ]
  }
  if (provider === 'codex') {
    const prefix = `${sessionId}:`
    return Array.from(pendingCodexApprovals)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, pending]) => codexApprovalRequestedPayload(sessionId, {
        id: pending.rawId,
        method: pending.method,
        params: pending.params,
      }))
  }
  if (provider === 'opencode') {
    const snapshot = getOpenCodeSessionSnapshot(sessionId)
    return [
      ...(snapshot?.permissions ?? []).map((permission) => ({
        type: 'opencode_event',
        event: { type: 'permission.updated', properties: permission },
      })),
      ...(snapshot?.questions ?? []).map((question) => ({
        type: 'opencode_event',
        event: { type: 'question.asked', properties: question },
      })),
    ]
  }
  if (provider === 'pi') {
    return listPendingPiUiPayloads(sessionId)
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    return acpPendingRequests(sessionId).map((pending) => {
      const data = { requestId: pending.id, sessionId, provider, ...(pending.params as Record<string, unknown>) }
      return pending.method === 'elicitation/create'
        ? { type: 'acp_elicitation', event: { type: 'elicitation.requested', data } }
        : { type: 'acp_permission', event: { type: 'permission.requested', data } }
    })
  }
  return []
}

/**
 * Whether a turn is currently running server-side for this session, so a client
 * that navigated away or reloaded can reattach to the live turn. Process-local:
 * only reflects turns started by this server process. `pendingPermissions`
 * carries provider-native approval/question payloads so a reconnecting client
 * can re-arm and answer them through the shared permission parser.
 */
export function readViewSessionRunning(
  sessionId: string,
): ReturnType<typeof getRunningSessionInfo> & {
  pendingPrompts: Record<string, unknown>[]
  pendingPermissions: Record<string, unknown>[]
} {
  const info = getRunningSessionInfo(sessionId)
  return {
    ...info,
    pendingPrompts: listPendingClaudePrompts(sessionId),
    pendingPermissions: listPendingProviderPermissionPayloads(sessionId, info.provider),
  }
}

/**
 * Every session with a turn running in this process, including provider-native
 * permission/question payloads needed by reattach and attention surfaces.
 */
export function listViewRunningSessions(): Array<{
  sessionId: string
  provider: AgentProvider
  pendingPrompts: Record<string, unknown>[]
  pendingPermissions: Record<string, unknown>[]
}> {
  return listRunningSessionRefs().map((ref) => ({
    ...ref,
    pendingPrompts: listPendingClaudePrompts(ref.sessionId),
    pendingPermissions: listPendingProviderPermissionPayloads(ref.sessionId, ref.provider),
  }))
}

/** Process-local control-plane state for fleet and attention clients. */
export function readViewRuntimeActivity() {
  return {
    running: listViewRunningSessions(),
    waiting: listWaitingSessions(),
    attention: listViewerAttention(),
  }
}

export async function readViewSessionModels(sessionId: string, providerOverride?: AgentProvider): Promise<{ models: SessionModelInfo[]; currentModel: string | null; currentContextTier?: CopilotContextTier | null; contextUsage: ContextUsage | null }> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    // Custom model providers (proxied base URLs, non-default profiles) can
    // leave the app-server slow to answer model/list on a cold connection —
    // without a timeout the composer's model picker hangs indefinitely
    // instead of falling back to an empty list the UI can recover from.
    const [modelsResponse, resume] = await Promise.all([
      withTimeout(client.request('model/list', {}), 8000, 'Codex model list')
        .catch(() => ({ data: [] as Parameters<typeof mapCodexModelsToSessionModels>[0] })),
      withTimeout(ensureCodexThreadResumed(sessionId), 8000, 'Codex thread resume').catch(() => null),
    ])
    return {
      models: mapCodexModelsToSessionModels(modelsResponse.data),
      currentModel: resume?.model ?? null,
      contextUsage: null,
    }
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const [configResponse, messages] = await Promise.all([
      client.config.providers({
        ...OPENCODE_OPTIONS,
        query: openCodeDirectoryQuery(session),
      }),
      getOpenCodeSessionMessages(sessionId),
    ])
    return {
      models: mapOpenCodeModelsToSessionModels(openCodeData<OpenCodeConfigProvidersResponse>(configResponse)),
      currentModel: currentOpenCodeModelValue(messages.at(-1)?.info),
      contextUsage: null,
    }
  }
  if (provider === 'copilot') {
    const client = await getCopilotClient()
    const session = await acquireCopilotSession(sessionId)
    const [models, currentModel] = await Promise.all([
      client.listModels(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined, contextTier: undefined })),
    ])
    return {
      models: mapCopilotModelsToSessionModels(models),
      currentModel: currentModel.modelId ?? null,
      currentContextTier: parseCopilotContextTier(currentModel.contextTier) ?? null,
      contextUsage: null,
    }
  }
  if (provider === 'pi') {
    const messages = await getPiSessionMessages(sessionId)
    let currentModel: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role: string; model?: string }
      if (msg.role === 'assistant' && msg.model) {
        currentModel = msg.model
        break
      }
    }
    const agentSession = await openPiAgentSession(sessionId)
    const availableModels = await agentSession.modelRuntime.getAvailable()
    const currentModelValue = currentPiModelValue(agentSession.model, currentModel)
    const piContextUsage = agentSession.getContextUsage()
    return {
      models: mapPiModelsToSessionModels(availableModels, currentModelValue ?? currentModel),
      currentModel: currentModelValue ?? currentModel ?? null,
      contextUsage: piContextUsage
        ? {
            totalTokens: piContextUsage.tokens ?? 0,
            maxTokens: piContextUsage.contextWindow,
            percentage: piContextUsage.percent ?? 0,
            model: agentSession.model?.id ?? currentModel ?? 'unknown',
            categories: [
              { name: 'Context', tokens: piContextUsage.tokens ?? 0, color: 'var(--cyan)' },
            ],
          }
        : null,
    }
  }
  if (provider === 'lmstudio') {
    const record = await getLmstudioSession(sessionId)
    const models = await listLmstudioModels().catch(() => [])
    return {
      models: models.map((m) => ({ value: m.id, displayName: m.id, description: 'LM Studio local model' })),
      currentModel: record?.model ?? null,
      contextUsage: null,
    }
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    // ACP's session/new has no model-listing RPC to query against.
    return { models: [], currentModel: null, contextUsage: null }
  }

  const models = await readClaudeSupportedModels().catch(() => [] as SessionModelInfo[])
  const q = createSessionControlQuery(sessionId)
  try {
    const contextUsage = await q.getContextUsage().catch(() => null)
    return {
      models,
      currentModel: contextUsage?.model ?? null,
      contextUsage: contextUsage ?? null,
    }
  } catch {
    return {
      models,
      currentModel: null,
      contextUsage: null,
    }
  } finally {
    q.close()
  }
}

export async function readViewSessionComposerOptions(sessionId: string, providerOverride?: AgentProvider): Promise<SessionComposerOptions> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'opencode') {
    try {
      const session = await getOpenCodeSession(sessionId)
      const query = openCodeDirectoryQuery(session)
      const [project, messages] = await Promise.all([
        getOpenCodeProjectDiagnostics(query?.directory),
        getOpenCodeSessionMessages(sessionId).catch(() => [] as Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>),
      ])
      const selectableAgents = project.agents
        .filter((agent) => !isOpenCodeAgentHidden(agent) && agent.mode !== 'subagent')
        .map(openCodeAgentOption)
      const mentionAgents = project.agents
        .filter((agent) => !isOpenCodeAgentHidden(agent) && agent.mode !== 'primary')
        .map(openCodeAgentOption)
      const currentAgent = lastOpenCodeUserAgent(messages)
        ?? selectableAgents.find((agent) => agent.value === 'build')?.value
        ?? selectableAgents[0]?.value
        ?? null
      return {
        agents: selectableAgents,
        mentionAgents,
        currentAgent,
        permissionModes: PROVIDER_MANAGED_PERMISSION_OPTIONS,
        currentPermissionMode: 'native',
      }
    } catch {
      return {
        agents: [],
        mentionAgents: [],
        currentAgent: null,
        permissionModes: PROVIDER_MANAGED_PERMISSION_OPTIONS,
        currentPermissionMode: 'native',
      }
    }
  }

  if (provider === 'copilot') {
    const session = await acquireCopilotSession(sessionId)
    const [currentMode, currentPermissionMode] = await Promise.all([
      session.rpc.mode.get().catch(() => 'interactive'),
      session.rpc.permissions.getAllowAll().catch(() => ({ enabled: false, mode: 'off' as const })),
    ])
    return {
      modes: COPILOT_COMPOSER_MODES,
      currentMode: parseCopilotModeResponse(currentMode) ?? 'interactive',
      permissionModes: COPILOT_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: currentPermissionMode.mode ?? (currentPermissionMode.enabled ? 'on' : 'off'),
    }
  }

  if (provider === 'claude') {
    return {
      permissionModes: CLAUDE_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: 'default',
    }
  }

  if (provider === 'codex') {
    return {
      permissionModes: CODEX_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: 'auto',
    }
  }

  return {
    permissionModes: PROVIDER_MANAGED_PERMISSION_OPTIONS,
    currentPermissionMode: 'native',
  }
}

export async function readViewSessionSlashCommands(sessionId: string, providerOverride?: AgentProvider): Promise<Array<{ command: string; description: string; argumentHint?: string }>> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'claude') {
    // Prefer the warm pool entry's persistent Query (composer prewarm or a
    // recent send) — supportedCommands is then a control RPC on the existing
    // subprocess instead of a fresh ~1-3s CLI spawn.
    const mapCommands = (commands: Awaited<ReturnType<Query['supportedCommands']>>) => commands.map((command) => ({
      command: command.name.startsWith('/') ? command.name : `/${command.name}`,
      description: command.description ?? '',
      argumentHint: command.argumentHint && command.argumentHint.trim() ? command.argumentHint : undefined,
    }))
    // A commands_changed push supersedes any RPC fetch: supportedCommands()
    // returns the init-captured list and never reflects mid-session changes.
    const pushed = getClaudeCommandsOverride(sessionId)
    if (pushed) return mapCommands(pushed)
    const warm = peekClaudeSession(sessionId)
    if (warm) {
      const commands = await warm.query.supportedCommands().catch(() => [])
      return mapCommands(commands)
    }
    const q = createSessionControlQuery(sessionId)
    try {
      const commands = await q.supportedCommands().catch(() => [])
      return mapCommands(commands)
    } finally {
      q.close()
    }
  }
  if (provider === 'opencode') {
    try {
      const session = await getOpenCodeSession(sessionId).catch(() => null)
      const query = session ? openCodeDirectoryQuery(session) : undefined
      // Routed through the harness cache — every keystroke in the
      // composer was previously firing a fresh command.list HTTP call.
      const project = await getOpenCodeProjectDiagnostics(query?.directory)
      return project.commands.map((command) => ({
        command: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? '',
      }))
    } catch {
      return []
    }
  }
  if (provider === 'pi') {
    // Pi's SDK catalog includes interactive-only commands such as /settings,
    // /resume, and /quit. AgentViewer has no matching modal/terminal lifecycle
    // for those, so advertise only commands this composer executes natively.
    return PI_SLASH_COMMANDS.map((command) => ({ ...command }))
  }
  if (provider === 'copilot') {
    try {
      const session = await acquireCopilotSession(sessionId)
      const commandsRpc = (session.rpc as typeof session.rpc & {
        commands?: {
          list?: (params?: {
            includeBuiltins?: boolean
            includeSkills?: boolean
            includeClientCommands?: boolean
          }) => Promise<{
            commands: Array<{
              name: string
              description?: string
              input?: { hint?: string }
            }>
          }>
        }
      }).commands
      if (!commandsRpc?.list) return []
      const response = await commandsRpc.list({
        includeBuiltins: true,
        includeSkills: true,
        includeClientCommands: true,
      })
      return response.commands.map((command) => ({
        command: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? '',
        argumentHint: command.input?.hint && command.input.hint.trim() ? command.input.hint.trim() : undefined,
      }))
    } catch {
      return []
    }
  }
  return []
}

export async function readViewSessionDiagnostics(sessionId: string, providerOverride?: AgentProvider): Promise<{ sections: SessionDiagnosticSection[]; currentModel: string | null }> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    // Per-thread reads stay direct (they're specific to this sessionId),
    // but the four project-wide reads go through the harness cache so
    // repeated opens of the diagnostics panel share one HTTP round-trip.
    const [thread, resume, project] = await Promise.all([
      readCodexThread(sessionId, false),
      ensureCodexThreadResumed(sessionId).catch((error) => {
        if (isCodexActiveWriterError(error)) return { model: null }
        throw error
      }),
      getCodexProjectDiagnostics(),
    ])

    return {
      sections: mapCodexDiagnosticsToSections({
        thread,
        currentModel: resume.model,
        mcpServers: project.mcpServers,
        features: project.features,
        skills: project.skills,
        apps: project.apps,
      }),
      currentModel: resume.model,
    }
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const query = openCodeDirectoryQuery(session)
    // Project-level config (providers/commands/agents/lsp/formatters/mcp)
    // is identical across every session under the same directory, so route
    // those reads through the harness cache. The remaining session-specific
    // calls fan out as before.
    const [project, messages, children] = await Promise.all([
      getOpenCodeProjectDiagnostics(query?.directory),
      getOpenCodeSessionMessages(sessionId),
      client.session.children({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
        query,
      }).catch(() => ({ data: [] as OpenCodeSession[] })),
    ])

    return {
      currentModel: currentOpenCodeModelValue(messages.at(-1)?.info),
      sections: mapOpenCodeDiagnosticsToSections({
        providers: project.providers,
        commands: project.commands,
        agents: project.agents,
        lsp: project.lsp,
        formatters: project.formatters,
        mcp: project.mcp,
        children: openCodeData<OpenCodeSession[]>(children),
        currentSession: session,
      }),
    }
  }
  if (provider === 'copilot') {
    const client = await getCopilotClient()
    const [metadata, session, status, auth] = await Promise.all([
      findCopilotSessionMetadata(sessionId),
      acquireCopilotSession(sessionId),
      client.getStatus().catch(() => ({ version: 'unknown', protocolVersion: 0 }) as CopilotGetStatusResponse),
      client.getAuthStatus().catch(() => ({
        isAuthenticated: false,
        statusMessage: 'Authentication status unavailable',
      }) as CopilotGetAuthStatusResponse),
    ])

    const [events, currentModel, mode, tools, currentTools, quota] = await Promise.all([
      session.getEvents(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      session.rpc.mode.get().catch(() => ({ mode: undefined })),
      client.rpc.tools.list({ model: undefined }).catch(() => ({ tools: [] as Array<{ name: string; description?: string }> })),
      session.rpc.tools.getCurrentMetadata().catch(() => ({ tools: null })),
      client.rpc.account.getQuota({}).catch(() => ({ quotaSnapshots: {} as Record<string, {
        entitlementRequests: number
        usedRequests: number
        remainingPercentage: number
        overage: number
        overageAllowedWithExhaustedQuota: boolean
        resetDate?: string
      }> })),
    ])

    const quotaItems = Object.entries(quota.quotaSnapshots).flatMap(([name, snapshot]) => {
      if (!snapshot) return []
      const remaining = Math.round(snapshot.remainingPercentage * 100)
      const reset = snapshot.resetDate ? ` · resets ${snapshot.resetDate}` : ''
      return [`${name} · ${snapshot.usedRequests}/${snapshot.entitlementRequests} used · ${remaining}% remaining${reset}`]
    })

    return {
      currentModel: currentModel.modelId ?? deriveCopilotState(events, metadata).currentModel ?? null,
      sections: mapCopilotDiagnosticsToSections({
        sessionId,
        status,
        auth,
        currentModel: currentModel.modelId ?? null,
        mode: typeof mode === 'string' ? mode : mode.mode ?? null,
        tools: tools.tools,
        currentTools: currentTools.tools ?? [],
        quotaItems,
        integrationItems: copilotIntegrationDiagnostics(sessionId),
        metadata,
        events,
        workspacePath: session.workspacePath,
      }),
    }
  }
  if (provider === 'pi') {
    const entries = await getPiSessionEntries(sessionId)
    let currentModel: string | undefined
    let thinkingLevel: string | undefined
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.type === 'thinking_level_change') {
        thinkingLevel ??= (entry as { thinkingLevel: string }).thinkingLevel
      }
      if (entry.type === 'message') {
        const msg = (entry as { message: { role: string; model?: string; thinking?: boolean } }).message
        if (msg.role === 'assistant') {
          currentModel ??= msg.model
          if (thinkingLevel === undefined && msg.thinking !== undefined) {
            thinkingLevel = msg.thinking ? 'enabled' : 'off'
          }
        }
      }
      if (currentModel && thinkingLevel !== undefined) break
    }

    const agentSession = await openPiAgentSession(sessionId)
    const sessionFile = agentSession.sessionManager.getSessionFile()
    const cwd = agentSession.sessionManager.getCwd()
    const stats = agentSession.getSessionStats()

    return {
      currentModel: currentModel ?? null,
      sections: mapPiDiagnosticsToSections({
        sessionId,
        cwd,
        currentModel,
        thinkingLevel: agentSession.thinkingLevel ?? thinkingLevel,
        toolNames: agentSession.getActiveToolNames(),
        sessionFile,
        stats,
      }),
    }
  }
  if (provider === 'lmstudio') {
    const record = await getLmstudioSession(sessionId)
    return {
      currentModel: record?.model ?? null,
      sections: [
        { id: 'server', title: 'LM STUDIO SERVER', items: [lmstudioBaseUrl()] },
        { id: 'messages', title: 'MESSAGES', items: [String(record?.messages.length ?? 0)] },
      ],
    }
  }
  if (provider === 'claude-acp' || provider === 'codex-acp') {
    const alive = isAcpSessionAlive(sessionId)
    return {
      currentModel: null,
      sections: [
        { id: 'acp', title: 'ACP TRANSPORT', items: [alive ? 'session alive' : 'no active subprocess'] },
      ],
    }
  }

  const q = createSessionControlQuery(sessionId)
  try {
    const init = await q.initializationResult()
    const [commands, agents, mcpServers, contextUsage, subagents, rawMessages, resolvedSettings, hookEvents] = await Promise.all([
      q.supportedCommands(),
      q.supportedAgents(),
      q.mcpServerStatus(),
      q.getContextUsage().catch(() => null),
      listSubagents(sessionId, claudeSessionStoreOptions()).catch(() => [] as string[]),
      getSessionMessages(sessionId, {
        includeSystemMessages: true,
        ...claudeSessionStoreOptions(),
      }).catch(() => [] as unknown[]),
      getSessionInfo(sessionId, claudeSessionStoreOptions())
        .then((info) => resolveSettings({ cwd: info?.cwd }))
        .catch(() => null),
      listClaudeHookEvents(sessionId, { limit: 20 }).catch(() => []),
    ])
    const accountItems: string[] = []
    if (init.account?.email) accountItems.push(init.account.email)
    if (init.account?.organization) accountItems.push(init.account.organization)
    if (init.account?.subscriptionType) accountItems.push(init.account.subscriptionType)
    const subagentParents = new Map<string, string | null>()
    if (subagents.length > 0) {
      await Promise.all(subagents.map(async (agentId) => {
        const messages = await getSubagentMessages(sessionId, agentId, claudeSessionStoreOptions())
          .catch(() => [] as SessionMessage[])
        subagentParents.set(agentId, claudeSubagentParentId(messages as unknown[]))
      }))
    }
    const settingItems = resolvedSettings
      ? [
          `effective keys · ${Object.keys(resolvedSettings.effective).sort().join(', ') || 'none'}`,
          `sources · ${resolvedSettings.sources.map((source) => source.source).join(', ') || 'managed/default only'}`,
        ]
      : ['Unavailable']
    const sandboxSettings = resolvedSettings?.effective.sandbox
    const sandboxItems = sandboxSettings && typeof sandboxSettings === 'object'
      ? [
          `enabled · ${sandboxSettings.enabled === false ? 'no' : 'yes'}`,
          `bash auto-allow · ${sandboxSettings.autoAllowBashIfSandboxed === false ? 'no' : 'yes'}`,
          `unsandboxed commands · ${sandboxSettings.allowUnsandboxedCommands === true ? 'allowed' : 'blocked'}`,
        ]
      : ['Not configured']
    return {
      currentModel: contextUsage?.model ?? null,
      sections: [
        { id: 'commands', title: 'COMMANDS', items: commands.length > 0 ? commands.slice(0, 20).map((command) => command.name) : ['None'] },
        { id: 'agents', title: 'AGENTS', items: agents.length > 0 ? agents.slice(0, 20).map((agent) => agent.name) : ['None'] },
        { id: 'settings', title: 'SETTINGS', items: settingItems },
        { id: 'sandbox', title: 'SANDBOX', items: sandboxItems },
        {
          id: 'transport',
          title: 'PROCESS TRANSPORT',
          items: [
            `${claudeProcessTransportStatus().kind} · ${claudeProcessTransportStatus().healthy ? 'healthy' : 'unhealthy'}`,
            ...(claudeProcessTransportStatus().target ? [`target · ${claudeProcessTransportStatus().target}`] : []),
            ...(claudeProcessTransportStatus().lastError ? [`last error · ${claudeProcessTransportStatus().lastError}`] : []),
          ],
        },
        {
          id: 'mcp',
          title: 'MCP',
          items: mcpServers.length > 0
            ? mcpServers.map((server) => `${server.name} · ${server.status}${claudeDynamicMcpServerNames(sessionId).includes(server.name) ? ' · dynamic' : ''}`)
            : ['None'],
        },
        {
          id: 'subagents',
          title: 'SUBAGENTS',
          items: subagents.length > 0 ? formatClaudeSubagentTree(subagents, subagentParents).slice(0, 20) : ['None'],
        },
        {
          id: 'hooks',
          title: 'HOOK TIMELINE',
          items: hookEvents.length > 0
            ? hookEvents.map((event) => `${event.timestamp} · ${event.summary}`)
            : ['None'],
        },
        {
          id: 'output-style',
          title: 'OUTPUT STYLE',
          items: init.output_style ? [init.output_style] : ['default'],
        },
        {
          id: 'account',
          title: 'ACCOUNT',
          items: accountItems.length > 0 ? accountItems : ['Unknown'],
        },
        {
          id: 'latency',
          title: 'LATENCY & MODEL USAGE',
          items: claudeLatencyDiagnosticItems(rawMessages),
        },
      ],
    }
  } finally {
    q.close()
  }
}

export async function rewindOrRollbackViewSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
  const resolvedProvider = await resolveProvider(provider)
  if (resolvedProvider === 'codex') {
    const numTurns = Number(body.numTurns ?? 1)
    if (!Number.isFinite(numTurns) || numTurns < 1) {
      throw new Error('numTurns is required')
    }

    const thread = await readCodexThread(sessionId, true)
    const removedTurns = thread.turns.slice(-numTurns).map((turn) => {
      const firstUserItem = turn.items.find((item) => item.type === 'userMessage')
      const preview = firstUserItem && firstUserItem.type === 'userMessage'
        ? firstUserItem.content
            .map((entry) => entry.type === 'text' ? entry.text : '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        : turn.items[0]?.type ?? turn.id
      return {
        turnId: turn.id,
        preview: preview || turn.id,
      }
    })

    if (body.dryRun) {
      return {
        mode: 'rollback',
        canRollback: true,
        turnsRemoved: removedTurns,
      }
    }

    const client = getCodexClient()
    const result = await client.request('thread/rollback', {
      threadId: sessionId,
      numTurns,
    })

    return {
      mode: 'rollback',
      canRollback: true,
      turnsRemoved: removedTurns,
      remainingTurns: result.thread.turns.length,
    }
  }
  if (resolvedProvider === 'opencode') {
    const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined
    if (!userMessageId) {
      throw new Error('userMessageId is required')
    }

    const client = await getOpenCodeClient()
    const diffResponse = await client.session.diff({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      query: { messageID: userMessageId },
    })
    const filesChanged = summarizeOpenCodeDiffs(openCodeData<OpenCodeFileDiff[]>(diffResponse))

    if (body.dryRun) {
      return {
        mode: 'rewind',
        canRewind: true,
        filesChanged,
      }
    }

    await client.session.revert({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      body: { messageID: userMessageId },
    })

    return {
      mode: 'rewind',
      canRewind: true,
      filesChanged,
    }
  }
  if (resolvedProvider === 'copilot') {
    void sessionId
    void body
    throw new Error('Rewind is not supported for GitHub Copilot sessions')
  }
  if (resolvedProvider === 'pi') {
    void sessionId
    void body
    throw new Error('Rewind is not supported for Pi sessions')
  }
  if (resolvedProvider === 'lmstudio') {
    void sessionId
    void body
    throw new Error('Rewind is not supported for LM Studio sessions')
  }
  if (resolvedProvider === 'claude-acp' || resolvedProvider === 'codex-acp') {
    void sessionId
    void body
    throw new Error(`Rewind is not supported for ${resolvedProvider} sessions`)
  }

  const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined
  const model = typeof body.model === 'string' ? body.model : undefined
  if (!userMessageId) {
    throw new Error('userMessageId is required')
  }
  if (claudeSessionStoreOptions().sessionStore) {
    throw new Error('File rewind is unavailable while the Claude SQLite session store is enabled; the Agent SDK does not mirror checkpoint blobs')
  }

  const q = createSessionControlQuery(sessionId, model)
  try {
    await q.initializationResult()
    const result = await q.rewindFiles(userMessageId, { dryRun: Boolean(body.dryRun) })
    if (!body.dryRun && result.canRewind && result.filesChanged?.length) {
      const info = await getSessionInfo(sessionId, claudeSessionStoreOptions()).catch(() => undefined)
      if (info?.cwd) {
        const observedPaths = await readClaudeObservedFilePaths(sessionId, info.cwd).catch(() => [])
        await queueClaudeReadStateSeeds(sessionId, info.cwd, observedPaths)
      }
    }
    return result
  } finally {
    q.close()
  }
}

// ── Memory diagnostics ──────────────────────────────────────────────────────
// Reports live sizes of the module-level caches/maps and warm provider pools so
// the instrumentation logger can attribute RSS growth to a specific structure.
// Read-only; safe to call on a timer. Registered into the globalThis reporter
// registry so the logger reads THIS module instance's caches even when it runs
// in a separate instance (see lib/runtimeDiagnostics.ts).
registerDiagnosticsReporter(() => getServerMemoryDiagnostics())

export function getServerMemoryDiagnostics(): Record<string, number> {
  let codexApprovals = 0
  try { codexApprovals = pendingCodexApprovals.size } catch { /* defined later in module; ignore during init */ }
  const piEntryCache = piSessionEntryCacheDiagnostics()
  return {
    sessionInfoCache: sessionInfoCache.size,
    mappedMessageCache: mappedMessageCache.size,
    // Entry count alone hides the real weight of this cache (entries are whole
    // mapped sessions); total retained messages tracks the actual footprint.
    mappedMessageCacheMessages: Array.from(mappedMessageCache.values()).reduce((acc, entry) => acc + entry.messages.length, 0),
    persistedMessagesSignature: persistedMessagesSignature.size,
    persistedSessionListSignatures: persistedSessionListSignatures.size,
    projectSessionsCache: projectSessionsCache.size,
    copilotLiveTranscripts: copilotLiveTranscripts.size,
    piLiveTranscripts: piLiveTranscripts.size,
    pendingClaudePermissions: pendingClaudePermissions.size,
    pendingClaudeElicitations: pendingClaudeElicitations.size,
    pendingClaudeDialogs: pendingClaudeDialogs.size,
    pendingCopilotPermissions: pendingCopilotPermissions.size,
    pendingCopilotElicitations: pendingCopilotElicitations.size,
    pendingPiUiRequests: pendingPiUiRequestCount(),
    pendingCodexApprovals: codexApprovals,
    ...getSessionRuntimeDiagnostics(),
    claudePool: claudePoolSize(),
    piPool: piPoolSize(),
    piOperations: piSessionOperationCount(),
    piEntryCacheSessions: piEntryCache.sessions,
    piEntryCacheEntries: piEntryCache.entries,
    copilotPool: copilotPoolSize(),
  }
}

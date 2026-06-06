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
  tagSession,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  acquireClaudeSession,
  adoptClaudeSession,
  createInputStream,
  effortToSdk,
  peekClaudeSession,
  recycleClaudeSession,
} from './claudePool'
import {
  broadcastClaudeMessage,
  broadcastClaudeRecycled,
  broadcastClaudeTurnEnd,
  broadcastClaudeTurnStart,
} from './claudeHarness'
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
  type SessionEvent as CopilotSessionEvent,
  type SessionMetadata as CopilotSessionMetadata,
} from '@github/copilot-sdk'
import { clearRunningSession, getRunningSession, interruptRunningSession, setRunningSession } from './sessionRuntime'
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
} from './types'

type CopilotReasoningEffort = Extract<ReasoningEffortLevel, 'low' | 'medium' | 'high' | 'xhigh'>

import { consumeReadModelsWarmQuery, createSessionControlQuery, openPrompt } from './sdkControlQuery'
import { acquireCopilotSession, evictCopilotSession, getCopilotClient, setCopilotPermissionHandler } from './copilotClient'
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
  CodexAppsListResponse,
  CodexExperimentalFeatureListResponse,
  CodexModelListResponse,
  CodexMcpServerListResponse,
  CodexNotification,
  CodexServerRequest,
  CodexThread,
  CodexThreadForkResponse,
  CodexThreadListResponse,
  CodexThreadReadResponse,
  CodexThreadResumeResponse,
  CodexThreadRollbackResponse,
  CodexThreadTokenUsage,
  CodexThreadTurnsListResponse,
  CodexTurnStartResponse,
  CodexUserInput,
} from './codexProtocol'
import type {
  ErrorNotification,
  ThreadStatusChangedNotification,
  ThreadTokenUsageUpdatedNotification,
  TurnCompletedNotification,
  TurnStartedNotification,
} from './codex-schema/v2'
import {
  mapCodexDiagnosticsToSections,
  mapCodexModelsToSessionModels,
  mapCodexThreadToMessages,
  mapCodexThreadToSession,
  mapCodexThreadToSessionInfo,
  mapCodexTokenUsageToContextUsage,
} from './codexMapper'
import { getCodexStoredTag, getCodexStoredTagsForSessions, setCodexStoredTag } from './codexTags'
import { getOpenCodeClient } from './opencodeClient'
import { getOpenCodeProjectDiagnostics, subscribeToOpenCodeEvents } from './opencodeHarness'
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
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import { normalizeProjectPath, sameProjectPath } from './projectPaths'
import {
  createPiAgentSession,
  evictPiAgentSession,
  forkPiSession,
  getPiSessionEntries,
  getPiSessionMessages,
  listPiSessions,
  openPiAgentSession,
  openPiSessionManager,
  refreshPiSessionCache,
} from './piClient'
import {
  mapPiDiagnosticsToSections,
  mapPiMessagesToSessionMessages,
  mapPiModelsToSessionModels,
  mapPiSessionToInfo,
  mapPiSessionToSession,
  currentPiModelValue,
  decodePiModelValue,
} from './piMapper'
import {
  getPiStoredMetadata,
  getPiStoredMetadataForSessions,
  setPiStoredTag,
  setPiStoredTitle,
} from './piMetadata'
import { normalizeClaudeHistoryMessages } from './claudeMapper'
import {
  clearPersistedSessionIndex,
  readPersistedIndexStats,
  removePersistedSession,
  syncPersistedSessionMessages,
  syncPersistedSessions,
  type PersistedIndexStats,
} from './sessionPersistence'

export const maxDuration = 300

// Session info rarely changes between polls — cache for 20 s to avoid repeating
// filesystem I/O on every 5-second session list refresh. Bounded by LRU so the
// long-lived dev server cannot accumulate entries for every session ever listed.
const SESSION_INFO_TTL = 20_000
const SESSION_INFO_CACHE_MAX = 128
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
  const result = await getSessionInfo(sessionId, dir ? { dir } : undefined)
  touchSessionInfoCache(sessionId, { result, ts: Date.now() })
  return result
}

// Per-session cache of mapped+sorted messages. Lets idle polls skip the
// normalize/dedup/sort pipeline when the underlying transcript is unchanged.
// Each call computes a cheap raw signature; on match we return the cached
// array (slice happens at the call site). On mismatch we re-map and store.
// LRU-capped because each entry holds a fully normalized message array — a
// large session can be MBs, so an unbounded map dominates server RSS.
const MAPPED_MESSAGE_TTL = 60_000
const MAPPED_MESSAGE_CACHE_MAX = 10
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
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const INDEX_REBUILD_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']
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

async function readClaudeSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const [mainRaw, subagentIds] = await Promise.all([
    getSessionMessages(sessionId, { includeSystemMessages: true }),
    listSubagents(sessionId).catch(() => [] as string[]),
  ])

  const lastMain = mainRaw.at(-1) as { uuid?: string } | undefined
  const signature = `${mainRaw.length}:${lastMain?.uuid ?? ''}:${subagentIds.length}:${subagentIds.at(-1) ?? ''}`
  const cached = readMappedMessagesCache(`claude:${sessionId}`, signature)
  if (cached) return cached

  const subagentMessages = await Promise.all(
    subagentIds.map(async (agentId) => {
      const messages = await getSubagentMessages(sessionId, agentId).catch(() => [] as SessionMessage[])
      return withOriginKind(normalizeClaudeHistoryMessages(messages as unknown[]), `subagent:${agentId}`)
    }),
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

function parseTurnRequestId(body: Record<string, unknown>): string | undefined {
  return typeof body.turnRequestId === 'string' && body.turnRequestId.trim()
    ? body.turnRequestId.trim()
    : undefined
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

function absoluteAttachmentPath(value: string): string {
  return value.startsWith('/') ? value : resolvePath(value)
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

async function readLocalImageAttachment(attachment: SendAttachment): Promise<{ data: string; mimeType: string; name: string } | null> {
  if (attachment.type !== 'image' && attachment.mimeType?.startsWith('image/') !== true) return null
  if (attachment.type === 'blob' && attachment.data && attachment.mimeType) {
    return { data: attachment.data, mimeType: attachment.mimeType, name: attachmentName(attachment) }
  }
  const path = attachmentPath(attachment)
  if (!path || isHttpUrl(path)) return null
  const mimeType = attachment.mimeType || inferMimeType(path)
  const data = await readFile(absoluteAttachmentPath(path), 'base64')
  return { data, mimeType, name: attachmentName(attachment) }
}

function attachmentPromptLine(attachment: SendAttachment): string | null {
  const path = attachmentPath(attachment)
  const label = `[${attachment.type}: ${attachmentName(attachment)}]`
  if (attachment.type === 'selection' && attachment.text?.trim()) {
    const location = path ? ` ${path}` : ''
    return `${label}${location}\n${attachment.text.trim()}`
  }
  if (path) return `${label} ${path}`
  if (attachment.text?.trim()) return `${label}\n${attachment.text.trim()}`
  return null
}

function attachmentsAsPromptText(attachments: SendAttachment[], ignoredTypes: SendAttachment['type'][] = ['image', 'blob']): string {
  const ignored = new Set<SendAttachment['type']>(ignoredTypes)
  const lines = attachments.flatMap((attachment) => {
    if (ignored.has(attachment.type)) return []
    const line = attachmentPromptLine(attachment)
    return line ? [line] : []
  })
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : ''
}

async function buildClaudePromptParts(userMessage: string, attachments: SendAttachment[]): Promise<{
  text: string
  imageBlocks: ClaudeContentBlockParam[]
}> {
  const imageBlocks: ClaudeContentBlockParam[] = []
  for (const attachment of attachments) {
    const image = await readLocalImageAttachment(attachment)
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

  const text = `${userMessage}${attachmentsAsPromptText(attachments)}`.trim()
  return { text, imageBlocks }
}

async function buildClaudeUserMessage(userMessage: string, attachments: SendAttachment[]): Promise<SDKUserMessage> {
  const { text, imageBlocks } = await buildClaudePromptParts(userMessage, attachments)
  return {
    type: 'user',
    message: {
      role: 'user',
      content: imageBlocks.length === 0
        ? text
        : [{ type: 'text', text }, ...imageBlocks],
    },
    parent_tool_use_id: null,
  }
}

function buildCodexInput(userMessage: string, attachments: SendAttachment[]): CodexUserInput[] {
  const input: CodexUserInput[] = [{ type: 'text', text: userMessage, text_elements: [] }]
  for (const attachment of attachments) {
    const path = attachmentPath(attachment)
    if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/')) {
      input.push({ type: 'image', url: `data:${attachment.mimeType};base64,${attachment.data}` })
    } else if (attachment.type === 'image' && path) {
      input.push(isHttpUrl(path)
        ? { type: 'image', url: path }
        : { type: 'localImage', path: absoluteAttachmentPath(path) })
    } else if (attachment.type === 'skill' && path) {
      input.push({ type: 'skill', name: attachmentName(attachment), path: absoluteAttachmentPath(path) })
    } else if ((attachment.type === 'file' || attachment.type === 'directory' || attachment.type === 'mention') && path) {
      input.push({ type: 'mention', name: attachmentName(attachment), path: absoluteAttachmentPath(path) })
    }
  }
  return input
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

function buildCopilotAttachments(attachments: SendAttachment[]): CopilotSendAttachment[] {
  const result: CopilotSendAttachment[] = []
  for (const attachment of attachments) {
    const path = attachmentPath(attachment)
    if (attachment.type === 'file' || attachment.type === 'image' || attachment.type === 'mention') {
      if (path) result.push({ type: 'file', path, displayName: attachment.displayName })
      continue
    }
    if (attachment.type === 'directory') {
      if (path) result.push({ type: 'directory', path, displayName: attachment.displayName })
      continue
    }
    if (attachment.type === 'selection') {
      const filePath = attachment.filePath || attachment.path
      if (filePath && attachment.displayName) {
        result.push({
          type: 'selection',
          filePath,
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

function buildOpenCodeParts(userMessage: string, attachments: SendAttachment[]): Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> {
  const text = `${userMessage}${attachmentsAsPromptText(attachments, ['file', 'image', 'blob', 'mention', 'agent'])}`.trim()
  const parts: Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> = [{ type: 'text', text }]
  for (const attachment of attachments) {
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
    const resolved = isHttpUrl(path) ? path : absoluteAttachmentPath(path)
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

async function buildPiImages(attachments: SendAttachment[]): Promise<Array<{ type: 'image'; data: string; mimeType: string }>> {
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = []
  for (const attachment of attachments) {
    const image = await readLocalImageAttachment(attachment)
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

function codexContextUsageToEventData(contextUsage: ContextUsage): string {
  return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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
function startTurnWatchdog(opts: {
  label: string
  idleTimeoutMs: number
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

  const arm = () => {
    if (cancelled) return
    const elapsed = Date.now() - lastActivityAt()
    const wait = Math.max(idleTimeoutMs - elapsed, 1000)
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
      arm()
      return
    }
    unknownStreak += 1
    if (unknownStreak >= WATCHDOG_MAX_UNKNOWN_PROBES) {
      onResolved(`${label}: no terminal signal and ${unknownStreak} inconclusive probes after silence`)
      return
    }
    arm()
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
  return `event: command-result\ndata: ${JSON.stringify({ provider: 'copilot', ...data })}\n\n`
}

// Generic command-result frame for any provider that executes a slash command
// natively (e.g. /compact) instead of sending it as prompt text. The clients
// render the `message` field as a session notice.
function commandResultEvent(provider: AgentProvider, data: Record<string, unknown>): string {
  return `event: command-result\ndata: ${JSON.stringify({ provider, ...data })}\n\n`
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
  timer: ReturnType<typeof setTimeout>
}

const pendingCopilotPermissions = new Map<string, PendingCopilotPermission>()

function pendingCopilotPermissionKey(sessionId: string, permissionId: string): string {
  return `${sessionId}:${permissionId}`
}

function copilotPermissionRequestedEvent(sessionId: string, requestId: string, permissionRequest: CopilotPermissionRequest): string {
  return JSON.stringify({
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
  })
}

function createCopilotPermissionBridge(
  sessionId: string,
  enqueue: (chunk: string) => void,
  activeIds: Set<string>,
  isClientAvailable: () => boolean,
): (request: CopilotPermissionRequest) => Promise<Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }>> {
  return (request) => {
    if (!isClientAvailable()) {
      return Promise.resolve({ kind: 'user-not-available' })
    }
    const requestId = `agent-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeIds.add(requestId)
    enqueue(`data: ${copilotPermissionRequestedEvent(sessionId, requestId, request)}\n\n`)
    if (!isClientAvailable()) {
      activeIds.delete(requestId)
      return Promise.resolve({ kind: 'user-not-available' })
    }
    return new Promise((resolve) => {
      const key = pendingCopilotPermissionKey(sessionId, requestId)
      const timer = setTimeout(() => {
        pendingCopilotPermissions.delete(key)
        activeIds.delete(requestId)
        resolve({ kind: 'user-not-available' })
      }, 5 * 60 * 1000)
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        (timer as { unref: () => void }).unref()
      }
      pendingCopilotPermissions.set(key, {
        resolve: (result) => {
          clearTimeout(timer)
          activeIds.delete(requestId)
          resolve(result)
        },
        timer,
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
    clearTimeout(pending.timer)
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
const copilotLiveTranscripts = new Map<string, CopilotLiveTranscriptEntry>()

function getCopilotLiveTranscriptEntry(sessionId: string): CopilotLiveTranscriptEntry {
  let entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) {
    entry = {
      drafts: new Map(),
      events: new Map(),
      updatedAt: Date.now(),
    }
    copilotLiveTranscripts.set(sessionId, entry)
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
const piLiveTranscripts = new Map<string, PiLiveTranscriptEntry>()

function getPiLiveTranscriptEntry(sessionId: string): PiLiveTranscriptEntry {
  let entry = piLiveTranscripts.get(sessionId)
  if (!entry) {
    entry = {
      messages: new Map(),
      updatedAt: Date.now(),
    }
    piLiveTranscripts.set(sessionId, entry)
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

function piAgentMessageFingerprint(message: PiAgentMessage): string {
  try {
    return JSON.stringify(message)
  } catch {
    const role = (message as { role?: unknown }).role
    const timestamp = (message as { timestamp?: unknown }).timestamp
    return `${String(role ?? '')}:${String(timestamp ?? '')}`
  }
}

function piAgentMessageDuplicateKey(message: PiAgentMessage): string {
  const record = message as unknown as Record<string, unknown>
  const role = typeof record.role === 'string' ? record.role : ''
  if (role === 'bashExecution') {
    const command = typeof record.command === 'string' ? record.command : ''
    return command ? `bashExecution:${command}` : piAgentMessageFingerprint(message)
  }
  if (role === 'toolResult') {
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : ''
    return toolCallId ? `toolResult:${toolCallId}` : piAgentMessageFingerprint(message)
  }
  return piAgentMessageFingerprint(message)
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
  },
): void {
  recordPiLiveMessage(sessionId, {
    role: 'bashExecution',
    command: params.command,
    output: params.output,
    exitCode: params.exitCode,
    cancelled: params.cancelled ?? false,
    truncated: params.truncated ?? false,
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
    case 'agent_end':
      schedulePiLiveTranscriptCleanup(sessionId)
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
  timer: ReturnType<typeof setTimeout>
  suggestions?: PermissionUpdate[]
  input?: Record<string, unknown>
}

const pendingClaudePermissions = new Map<string, PendingClaudePermission>()

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
    const requestId = options.toolUseID || `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeIds.add(requestId)
    enqueuePermissionEvent('permission.requested', {
      requestId,
      sessionId,
      toolName,
      input,
      title: options.title,
      displayName: options.displayName,
      description: options.description,
      blockedPath: options.blockedPath,
      decisionReason: options.decisionReason,
      suggestions: options.suggestions,
    })

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
      const timer = setTimeout(() => {
        cleanup()
        resolve(deny('Permission request timed out'))
      }, 5 * 60 * 1000)
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        (timer as { unref: () => void }).unref()
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
      pendingClaudePermissions.set(key, {
        suggestions: options.suggestions,
        input,
        timer,
        resolve: (result) => {
          clearTimeout(timer)
          cleanup()
          enqueuePermissionEvent('permission.completed', { requestId })
          resolve(result)
        },
      })
    })
  }
}

function resolvePendingClaudePermissions(sessionId: string, ids: Set<string>, message: string): void {
  for (const id of Array.from(ids)) {
    const key = pendingClaudePermissionKey(sessionId, id)
    const pending = pendingClaudePermissions.get(key)
    if (!pending) continue
    pendingClaudePermissions.delete(key)
    clearTimeout(pending.timer)
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
  const response = await client.request<CodexThreadListResponse>('thread/list', {
    limit: limit + offset,
    cwd: dir || undefined,
  })
  const page = response.data.slice(offset, offset + limit)
  const tags = await getCodexStoredTagsForSessions(page.map((thread) => thread.id))
  return page.map((thread) => mapCodexThreadToSession(thread, tags[thread.id] ?? null))
}

async function listClaudeSessions({ limit, offset, dir, includeWorktrees }: ListParams): Promise<Session[]> {
  pruneSessionInfoCache()
  const sessions = await listSessions({
    limit,
    offset,
    dir,
    includeWorktrees: dir ? includeWorktrees : undefined,
  })
  const normalized = await mapConcurrent(sessions, 20, async (session) => {
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
  })

  return normalized.map((session) => ({
    ...session,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }))
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
const persistedMessagesSignature = new Map<string, string>()

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
  if (persistedMessagesSignature.get(key) === signature) return
  try {
    await syncPersistedSessionMessages(provider, sessionId, durableMessages)
    persistedMessagesSignature.set(key, signature)
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
  const response = await client.request<CodexThreadReadResponse>('thread/read', {
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
    const response: CodexThreadTurnsListResponse = await client.request('thread/turns/list', {
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
  return client.request<CodexThreadResumeResponse>('thread/resume', {
    threadId: sessionId,
  })
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

export async function listViewSessions(params: ListParams): Promise<Session[]> {
  const provider = params.provider ?? await getConfiguredProvider()
  let sessions: Session[]
  if (provider === 'all') {
    const combinedLimit = params.limit + params.offset
    const [claude, codex, opencode, copilot, pi] = await Promise.all([
      listClaudeSessions({ ...params, provider: 'claude', limit: combinedLimit, offset: 0 }),
      listCodexSessions({ ...params, provider: 'codex', limit: combinedLimit, offset: 0 }),
      listOpenCodeSessions({ ...params, provider: 'opencode', limit: combinedLimit, offset: 0 }),
      listCopilotSessions({ ...params, provider: 'copilot', limit: combinedLimit, offset: 0 }),
      listPiSessionsForView({ ...params, provider: 'pi', limit: combinedLimit, offset: 0 }),
    ])
    sessions = [...claude, ...codex, ...opencode, ...copilot, ...pi]
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
  sessions = await listClaudeSessions(params)
  await syncSessionsBestEffort(sessions)
  return sessions
}

export async function readViewSessionInfo(sessionId: string, providerOverride?: AgentProvider): Promise<SessionInfo | null> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const tag = await getCodexStoredTag(sessionId)
    let thread: CodexThread | null = null
    let resume: CodexThreadResumeResponse | null = null
    try {
      thread = await readCodexThread(sessionId, false)
    } catch (err) {
      if (!isCodexMissingRolloutError(err)) throw err
    }
    try {
      resume = await resumeCodexThread(sessionId)
    } catch (err) {
      if (!isCodexMissingRolloutError(err)) throw err
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
    const messages = getPiSessionMessages(sessionId)
    return mapPiSessionToInfo(info, stored, messages)
  }

  const info = await getSessionInfo(sessionId)
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
        name: body.title ?? null,
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
      await setPiStoredTitle(sessionId, typeof body.title === 'string' ? body.title : null)
      return
    }
    if ('tag' in body) {
      await setPiStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }

  if ('title' in body) {
    if (typeof body.title !== 'string') throw new Error('title must be a string')
    await renameSession(sessionId, body.title)
    return
  }
  if ('tag' in body) {
    const tag = body.tag === null || body.tag === undefined ? null
      : typeof body.tag === 'string' ? body.tag
      : (() => { throw new Error('tag must be a string or null') })()
    await tagSession(sessionId, tag)
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
    await deleteClaudeSession(sessionId)
    await removePersistedSessionBestEffort(provider, sessionId)
    return
  }
  throw new Error(`Delete is not supported for ${provider} sessions`)
}

export async function runViewSessionAction({ sessionId, body, provider }: SessionActionParams): Promise<Record<string, unknown>> {
  const resolvedProvider = await resolveProvider(provider)
  const action = typeof body.action === 'string' ? body.action : ''

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
      const result = await client.postSessionIdPermissionsPermissionId({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId, permissionID },
        body: { response },
      })
      return { ok: openCodeData<boolean>(result) }
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
      const pending = pendingCopilotPermissions.get(pendingCopilotPermissionKey(sessionId, permissionId))
      if (pending) {
        pendingCopilotPermissions.delete(pendingCopilotPermissionKey(sessionId, permissionId))
        clearTimeout(pending.timer)
        pending.resolve(result)
        return { ok: true }
      }
      const session = await acquireCopilotSession(sessionId)
      const handled = await session.rpc.permissions.handlePendingPermissionRequest({
        requestId: permissionId,
        result,
      })
      return { ok: handled.success }
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
      if (!pending) throw new Error('Permission request is no longer pending')
      pending.resolve(claudePermissionDecision(response, pending))
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
  }

  throw new Error(`Action ${action || '(missing)'} is not supported for ${resolvedProvider} sessions`)
}

async function readCodexMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  let thread: CodexThread
  try {
    thread = await readCodexThreadWithFullTurns(sessionId)
  } catch (err) {
    if (isCodexMissingRolloutError(err)) return []
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

function readPiMessagesAll(sessionId: string): SessionMessage[] {
  const raw = getPiSessionMessages(sessionId)
  const live = getPiLiveTranscriptMessages(sessionId, raw)
  const mergedRaw = live.length > 0 ? [...raw, ...live] : raw
  const last = raw.at(-1) as { id?: string; role?: string } | undefined
  const signature = `${raw.length}:${last?.id ?? ''}:${last?.role ?? ''}:${piLiveTranscriptSignature(live)}`
  const cached = readMappedMessagesCache(`pi:${sessionId}`, signature)
  if (cached) return cached
  const livePrefixes = new Set(live.map((_, index) => `pi-${sessionId}-${raw.length + index}`))
  const liveKeys = new Set<string>()
  const messages = sortMessagesChronologically(mapPiMessagesToSessionMessages(sessionId, mergedRaw))
  for (const message of messages) {
    for (const prefix of livePrefixes) {
      if (message.uuid === prefix || message.uuid.startsWith(`${prefix}-`)) {
        liveKeys.add(sessionMessageIdentity(message))
        break
      }
    }
  }
  const markedMessages = markLiveSessionMessages(messages, liveKeys)
  return writeMappedMessagesCache(`pi:${sessionId}`, signature, markedMessages)
}

export async function listViewSessionMessageWindow(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessageWindow> {
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
    messages = readPiMessagesAll(sessionId)
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
  const raw = await getSubagentMessages(sessionId, agentId).catch(() => [] as SessionMessage[])
  return withOriginKind(normalizeClaudeHistoryMessages(raw as unknown[]), `subagent:${agentId}`)
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

const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
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
// human-readable error string, or null when the result is a clean success.
function claudeResultErrorMessage(msg: Record<string, unknown>): string | null {
  if (msg.type !== 'result') return null
  const subtype = typeof msg.subtype === 'string' ? msg.subtype : ''
  if (subtype === 'error_max_turns') return 'Claude reached the maximum number of turns before finishing.'
  if (subtype === 'error_max_budget_usd') return 'Claude reached the task budget before finishing.'
  if (subtype === 'error_max_structured_output_retries') return 'Claude could not produce a valid structured response.'
  if (subtype === 'error_during_execution') {
    const errors = Array.isArray(msg.errors) ? msg.errors.filter((entry): entry is string => typeof entry === 'string') : []
    return errors.length ? `Claude hit an error: ${errors.join('; ')}` : 'Claude hit an error during execution.'
  }
  if (subtype === 'success' && msg.is_error === true) {
    const status = typeof msg.api_error_status === 'number' ? ` (HTTP ${msg.api_error_status})` : ''
    const detail = typeof msg.result === 'string' && msg.result.trim() ? `: ${msg.result.trim()}` : ''
    return `Claude API error${status}${detail}`
  }
  return null
}

async function createClaudeStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const turnRequestId = parseTurnRequestId(body)
  const explicitModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const isPendingSession = Boolean(body.isPendingSession)
  const manualPermissions = body.manualPermissions === true
  const detachOnClientAbort = body.detachOnClientAbort === true
  const permissionMode = parseClaudePermissionMode(body)
  // For pending (newly created) sessions there is no prior model on disk, so we
  // need an explicit default. For existing/resumed sessions we leave model
  // unset so the SDK reuses whatever the session was last running with — same
  // as `claude --resume` from the CLI.
  const model = explicitModel ?? (isPendingSession ? 'claude-sonnet-4-6' : undefined)
  const fallbackModel = claudeFallbackModelChain()
  const effort = parseEffort(body)
  const attachments = parseAttachments(body)
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const forkSessionOnSend = Boolean(body.forkSession)
  const cwdOverride = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const taskBudgetTotal = typeof body.taskBudgetTokens === 'number' && body.taskBudgetTokens > 0
    ? Math.floor(body.taskBudgetTokens)
    : undefined

  // Cold-path conditions: brand-new session (no id yet), fork (creates a new
  // conversation root), or rewind (changes the resume point). These mutate
  // the conversation root or don't have a stable id to key the pool on, so we
  // run the legacy single-shot query() and let the pool catch up on turn 2.
  // manualPermissions is no longer a cold-path trigger — the pool supports
  // per-turn bridges via the bridgeBox delegation pattern.
  const useColdPath = isPendingSession || forkSessionOnSend || Boolean(resumeSessionAt)

  if (useColdPath) {
    return createClaudeStreamCold({
      sessionId,
      signal,
      userMessage,
      attachments,
      isPendingSession,
      permissionMode,
      manualPermissions,
      detachOnClientAbort,
      model,
      effort,
      resumeSessionAt,
      forkSessionOnSend,
      cwdOverride,
      taskBudgetTotal,
      turnRequestId,
      fallbackModel,
    })
  }

  return createClaudeStreamPooled({
    sessionId,
    signal,
    userMessage,
    attachments,
    permissionMode,
    manualPermissions,
    model,
    effort,
    cwdOverride,
    taskBudgetTotal,
    turnRequestId,
    fallbackModel,
  })
}

type ClaudeStreamColdArgs = {
  sessionId: string
  signal: AbortSignal
  userMessage: string
  attachments: SendAttachment[]
  isPendingSession: boolean
  permissionMode: ClaudePermissionMode | undefined
  manualPermissions: boolean
  detachOnClientAbort: boolean
  model: string | undefined
  effort: ReasoningEffortLevel | undefined
  resumeSessionAt: string | undefined
  forkSessionOnSend: boolean
  cwdOverride: string | undefined
  taskBudgetTotal: number | undefined
  turnRequestId: string | undefined
  fallbackModel: string | undefined
}

async function createClaudeStreamCold(args: ClaudeStreamColdArgs): Promise<Response> {
  const {
    sessionId,
    signal,
    userMessage,
    attachments,
    isPendingSession,
    permissionMode,
    manualPermissions,
    detachOnClientAbort,
    model,
    effort,
    resumeSessionAt,
    forkSessionOnSend,
    cwdOverride,
    taskBudgetTotal,
    turnRequestId,
    fallbackModel,
  } = args

  // Build the user message in the same SDKUserMessage shape the pool uses,
  // and push it onto a queue-based input stream. Two reasons:
  //   1) The stream stays open after turn 1 ends, so the SDK's Query
  //      iterator stays open and we can hand the Query off to the pool.
  //   2) The pool can keep pushing future turns onto the same stream.
  const pushMessage = await buildClaudeUserMessage(userMessage, attachments)
  const { pushUserMessage, endInput, iterable } = createInputStream()
  pushUserMessage(pushMessage)

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
      // Named handler so we can detach it on successful adoption — otherwise a
      // post-turn client disconnect would abort the Query we just gave to the pool.
      const propagateAbort = () => {
        if (detachOnClientAbort) {
          clientDetached = true
          downstreamClosed = true
          resolvePendingClaudePermissions(sessionId, bridgedPermissionIds, 'Client disconnected before permission response')
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
      const bridgeBox: { fn: import('@anthropic-ai/claude-agent-sdk').CanUseTool | null } = { fn: null }

      const q = query({
        prompt: iterable,
        options: {
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
          ...effortToSdk(effort),
          abortController,
          enableFileCheckpointing: true,
          resumeSessionAt,
          forkSession: forkSessionOnSend,
          includePartialMessages: true,
          agentProgressSummaries: true,
          includeHookEvents: true,
          promptSuggestions: true,
          forwardSubagentText: true,
          systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
          taskBudget: taskBudgetTotal ? { total: taskBudgetTotal } : undefined,
        },
      })

      // Must be set BEFORE the for-await below, not before query() above —
      // the iterator drives SDK processing, so no tool call can arrive until
      // the first pull of the iterator at the for-await.
      if (bridgeInstalled) {
        bridgeBox.fn = createClaudePermissionBridge(sessionId, controller, encoder, bridgedPermissionIds)
      }

      setRunningSession(sessionId, {
        provider: 'claude',
        requestId: turnRequestId,
        interrupt: () => q.interrupt(),
      })

      let emittedSessionEvent = false
      let realizedSessionId: string | undefined
      let adopted = false
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

      try {
        try {
          const usage = await q.getContextUsage()
          safeEnqueue(codexContextUsageToEventData(usage))
        } catch {}

        for await (const msg of q) {
          const messageSessionId = typeof msg.session_id === 'string' && msg.session_id ? msg.session_id : undefined
          if (!emittedSessionEvent && messageSessionId) {
            emittedSessionEvent = true
            realizedSessionId = messageSessionId
            safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: messageSessionId })}\n\n`)
          }
          const eventSessionId = noteClaudeBroadcastSession(messageSessionId ?? fallbackBroadcastSessionId)
          if (eventSessionId) {
            try { broadcastClaudeMessage(eventSessionId, msg.type) } catch { /* observer-only signal */ }
          }
          safeEnqueue(`data: ${JSON.stringify(msg)}\n\n`)
          // Break after the result so we can adopt the Query into the pool.
          // The pool's pump loop takes over consuming for any tail messages
          // (notably prompt_suggestion, which the SDK emits after `result`)
          // and for future turns.
          if (msg.type === 'result') {
            const resultError = claudeResultErrorMessage(msg as unknown as Record<string, unknown>)
            if (resultError) safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: resultError })}\n\n`)
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
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        }
      } finally {
        // Clear the bridge in case adoption didn't happen (error, abort) so the
        // box isn't left pointing at a dead stream controller.
        bridgeBox.fn = null
        clearRunningSession(sessionId)
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
  permissionMode: ClaudePermissionMode | undefined
  manualPermissions: boolean
  model: string | undefined
  effort: ReasoningEffortLevel | undefined
  cwdOverride: string | undefined
  taskBudgetTotal: number | undefined
  turnRequestId: string | undefined
  fallbackModel: string | undefined
}

async function createClaudeStreamPooled(args: ClaudeStreamPooledArgs): Promise<Response> {
  const {
    sessionId,
    signal,
    userMessage,
    attachments,
    permissionMode,
    manualPermissions,
    model,
    effort,
    cwdOverride,
    taskBudgetTotal,
    turnRequestId,
    fallbackModel,
  } = args

  let pushMessage: SDKUserMessage
  try {
    pushMessage = await buildClaudeUserMessage(userMessage, attachments)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to build prompt' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let entry
      try {
        entry = acquireClaudeSession({
          sessionId,
          cwd: cwdOverride,
          model,
          fallbackModel,
          permissionMode,
          effort,
          taskBudgetTokens: taskBudgetTotal,
        })
      } catch (err) {
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`,
        ))
        controller.close()
        return
      }

      setRunningSession(entry.sessionId, {
        provider: 'claude',
        requestId: turnRequestId,
        interrupt: () => entry.query.interrupt(),
      })

      // Decouple the turn lifecycle from this HTTP request. A client disconnect
      // (tab closed, navigation, network blip) must NOT interrupt an in-flight
      // turn — the pool keeps draining the Query, the turn completes, messages
      // persist, and the Claude harness keeps observers' transcripts live so a
      // reconnect immediately resumes streaming. Explicit cancellation is a
      // separate, deliberate action that flows through the /interrupt route
      // (→ getRunningSession().interrupt()), not a side effect of disconnecting.
      const turnAbort = new AbortController()

      // We already know the session id — emit immediately so the client doesn't
      // have to wait for the SDK's init message.
      controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: entry.sessionId })}\n\n`))

      // Cheap freebie: the persistent Query lets us read context usage without
      // spinning up a subprocess. The cold path had to call this on a fresh
      // Query too.
      try {
        const usage = await entry.query.getContextUsage()
        controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
      } catch {}

      // Per-turn bridge for interactive permission approvals. Installed into the
      // pool entry's bridgeBox so the warm subprocess routes permission requests
      // through this turn's SSE stream without being recycled between turns.
      // bypass/plan handle all tool decisions via permissionMode so no bridge needed.
      const bridgedPermissionIds = new Set<string>()
      const bridgeInstalled = manualPermissions
        && permissionMode !== 'bypassPermissions'
        && permissionMode !== 'plan'
      const bridge = bridgeInstalled
        ? createClaudePermissionBridge(entry.sessionId, controller, encoder, bridgedPermissionIds)
        : undefined

      try {
        await entry.run(pushMessage, {
          signal: turnAbort.signal,
          bridge,
          onMessage: (msg) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
              const resultError = claudeResultErrorMessage(msg as unknown as Record<string, unknown>)
              if (resultError) {
                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: resultError })}\n\n`))
              }
            } catch {
              /* downstream closed; ignore — the turn keeps running in the pool */
            }
          },
          onError: (err) => {
            // If the pool entry died mid-turn, drop it so the next acquire
            // gets a fresh subprocess.
            recycleClaudeSession(entry.sessionId)
            if (signal.aborted) return
            try {
              controller.enqueue(encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`,
              ))
            } catch {
              /* ignore */
            }
          },
        })
      } catch (err) {
        if (!signal.aborted) {
          try {
            controller.enqueue(encoder.encode(
              `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`,
            ))
          } catch {
            /* ignore */
          }
        }
      } finally {
        clearRunningSession(entry.sessionId)
        resolvePendingClaudePermissions(entry.sessionId, bridgedPermissionIds, 'Permission request ended before a response was received')
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

async function readClaudeSupportedModels(): Promise<SessionModelInfo[]> {
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
          model: 'claude-sonnet-4-6',
          ...(fallbackModel ? { fallbackModel } : {}),
          persistSession: false,
          maxTurns: 0,
          enableFileCheckpointing: true,
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

const pendingCodexApprovals = new Map<string, PendingCodexApproval>()

function pendingCodexApprovalKey(threadId: string, id: string): string {
  return `${threadId}:${id}`
}

const CODEX_APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
])

function isCodexApprovalRequest(method: string): boolean {
  return CODEX_APPROVAL_METHODS.has(method)
}

function codexApprovalThreadId(params: Record<string, unknown>): string | undefined {
  return typeof params.threadId === 'string' ? params.threadId : undefined
}

function codexApprovalRequestedEvent(threadId: string, request: CodexServerRequest): string {
  return JSON.stringify({
    type: 'codex_approval',
    event: {
      type: 'approval.requested',
      requestId: String(request.id),
      method: request.method,
      threadId,
      params: request.params,
    },
  })
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
    case 'item/permissions/requestApproval':
      return {
        permissions: grantedCodexPermissionsFromRequest(params, response),
        scope: response === 'always' || response === 'acceptForSession' ? 'session' : 'turn',
        strictAutoReview: response === 'strict',
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
const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-failure', 'on-request', 'never'] as const
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
  // Codex's app-server accepts `low`/`medium`/`high` for reasoningEffort
  // (mirrors the CLI's `/reasoning` setting). `off`/`minimal`/`xhigh`/`max`
  // are not valid there, so drop them and let Codex use its thread default.
  const codexEffort = effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined
  const attachments = parseAttachments(body)
  const approvalPolicy = parseCodexApprovalPolicy(body)
  const bangShell = userMessage.startsWith('!') && attachments.length === 0
    ? userMessage.slice(1).trim()
    : null
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
      let turnStartRequested = false
      let completionCloseTimer: ReturnType<typeof setTimeout> | null = null

      const safeEnqueue = (chunk: string) => {
        if (cleanedUp || downstreamClosed) return
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
        clearRunningSession(sessionId)
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
      let consumeAborted = false
      // Surface this thread's server→client approval requests as codex_approval
      // SSE frames. The app-server blocks the turn until respondPermission replies.
      const unsubscribeApprovals = client.subscribeServerRequests((request) => {
        if (consumeAborted) return
        if (!isCodexApprovalRequest(request.method)) return
        const approvalThreadId = codexApprovalThreadId(request.params)
        if (approvalThreadId && approvalThreadId !== sessionId) return
        pendingCodexApprovals.set(pendingCodexApprovalKey(sessionId, String(request.id)), {
          rawId: request.id,
          method: request.method,
          params: request.params,
        })
        safeEnqueue(`data: ${codexApprovalRequestedEvent(sessionId, request)}\n\n`)
      })
      const unsubscribe = () => {
        consumeAborted = true
        unsubscribeApprovals()
        declinePendingCodexApprovals(sessionId)
        subscription.close()
      }
      const activateTargetTurn = (turnId: string) => {
        if (!turnId || targetTurnId) return
        targetTurnId = turnId

        setRunningSession(sessionId, {
          provider: 'codex',
          requestId: turnRequestId,
          interrupt: () => client.request('turn/interrupt', { threadId: sessionId, turnId }),
        })

        for (const notification of bufferedNotifications.splice(0)) {
          const bufferedTurnId = getCodexNotificationTurnId(notification)
          if (bufferedTurnId && bufferedTurnId !== turnId) continue
          if (notification.method === 'turn/completed') {
            bufferedTurnCompleted = true
            continue
          }
          if (notification.method === 'thread/tokenUsage/updated') {
            const usage = mapCodexTokenUsageToContextUsage(
              (notification.params as ThreadTokenUsageUpdatedNotification).tokenUsage,
              currentModel,
            )
            safeEnqueue(codexContextUsageToEventData(usage))
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

          if (notification.method === 'thread/tokenUsage/updated') {
            if (!targetTurnId && notificationTurnId) activateTargetTurn(notificationTurnId)
            if (!targetTurnId || notificationTurnId !== targetTurnId) continue
            const usage = mapCodexTokenUsageToContextUsage(
              (notification.params as ThreadTokenUsageUpdatedNotification).tokenUsage,
              currentModel,
            )
            safeEnqueue(codexContextUsageToEventData(usage))
            continue
          }

          if (!targetTurnId) {
            if (notificationTurnId) {
              activateTargetTurn(notificationTurnId)
            } else if (isCodexRealtimeNotification(notification)) {
              flushNotification(notification)
              if (bangShell !== null && notification.method === 'item/completed') {
                scheduleCompletionClose(unsubscribe)
              }
              continue
            } else if (notification.method === 'thread/status/changed' && !turnStartRequested) {
              continue
            } else {
              bufferedNotifications.push(notification)
              continue
            }
          }

          if (notificationTurnId && notificationTurnId !== targetTurnId) continue

          if (isCodexIdleStatusNotification(notification, sessionId)) {
            scheduleCompletionClose(unsubscribe)
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
        const running = getRunningSession(sessionId)
        if (running?.provider === 'codex') {
          void running.interrupt().catch(() => {})
        }
      })

      try {
        const resume = await resumeCodexThread(sessionId).catch(() => null)
        currentModel = model ?? resume?.model ?? currentModel
        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`)

        if (bangShell !== null) {
          if (!bangShell) throw new Error('Enter a shell command after !')
          await client.request('thread/shellCommand', {
            threadId: sessionId,
            command: bangShell,
          })
          return
        }

        // Execute native Codex slash commands instead of leaking the literal
        // "/command" into the model prompt. The thread goes idle after the
        // command, which closes the stream via the existing idle handler.
        const codexSlash = attachments.length === 0 ? parseOpenCodeSlashCommand(userMessage) : null
        if (codexSlash && codexSlash.command.toLowerCase() === 'compact') {
          await client.request('thread/compact/start', { threadId: sessionId })
          safeEnqueue(commandResultEvent('codex', { message: 'Compacting the conversation…' }))
          return
        }

        turnStartRequested = true
        const started = await client.request<CodexTurnStartResponse>('turn/start', {
          threadId: sessionId,
          model: model ?? undefined,
          reasoningEffort: codexEffort,
          // Override the app-server's approval policy only when the user picks one
          // in the composer (otherwise the configured default is used). This is
          // what makes the exec/patch approval prompts appear interactively.
          ...(approvalPolicy ? { approvalPolicy } : {}),
          input: buildCodexInput(userMessage, attachments),
        })

        activateTargetTurn(started.turn.id)
      } catch (err) {
        unsubscribe()
        clearRunningSession(sessionId)
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
      // Subscribe to the shared event harness — one upstream connection
      // per process, multiplexed by session. Filter on the original session
      // id first; if we end up forking we'll resubscribe to the new id.
      let subscription = subscribeToOpenCodeEvents({ sessionId })

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
        subscription.close()
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
        const running = getRunningSession(sessionId)
        if (running?.provider === 'opencode') {
          void running.interrupt().catch(() => {})
        }
      }, { once: true })

      try {
        if (resumeSessionAt) {
          const forkedResponse = await client.session.fork({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            body: { messageID: resumeSessionAt },
          })
          targetSessionId = openCodeData<OpenCodeSession>(forkedResponse).id
          // Switch the harness subscription onto the fork so we receive
          // its events without echoing the dead parent.
          subscription.close()
          subscription = subscribeToOpenCodeEvents({ sessionId: targetSessionId })
        }

        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`)

        // Replay cached state so the client doesn't have to wait for the
        // next live event tick to render a stale permission prompt or busy
        // indicator — this is what opencode-web does on every subscribe.
        const cached = subscription.snapshot
        if (cached?.status) {
          safeEnqueue(`event: opencode-status\ndata: ${JSON.stringify(cached.status)}\n\n`)
        }
        if (cached?.todos && cached.todos.length > 0) {
          safeEnqueue(`event: opencode-todos\ndata: ${JSON.stringify(cached.todos)}\n\n`)
        }
        for (const permission of cached?.permissions ?? []) {
          safeEnqueue(`data: ${formatOpenCodeEvent({ type: 'permission.updated', properties: permission } as OpenCodeEvent)}\n\n`)
        }

        setRunningSession(sessionId, {
          provider: 'opencode',
          requestId: turnRequestId,
          interrupt: () => client.session.abort({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
          }),
        })
        if (targetSessionId !== sessionId) {
          setRunningSession(targetSessionId, {
            provider: 'opencode',
            requestId: turnRequestId,
            interrupt: () => client.session.abort({
              ...OPENCODE_OPTIONS,
              path: { id: targetSessionId },
            }),
          })
        }

        consumeEvents = (async () => {
          for await (const harnessEvent of subscription.events) {
            if (harnessEvent.type !== 'event') continue

            const event = harnessEvent.event

            if (event.type === 'message.updated' && event.properties.info.role === 'assistant') {
              const usage = mapOpenCodeContextUsage(event.properties.info)
              if (usage) {
                safeEnqueue(codexContextUsageToEventData(usage))
              }
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
        } else {
          await client.session.promptAsync({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
            body: {
              model: selectedModel ?? undefined,
              agent: requestedAgent,
              parts: buildOpenCodeParts(userMessage, attachments),
            },
          })
        }

        // Backstop a dropped session.idle: if the event subscription goes
        // silent we probe session.status and, once OpenCode confirms the turn
        // is no longer busy, synthesize the idle frame so the consume loop ends
        // instead of hanging until the request is forcibly torn down.
        cancelWatchdog = startTurnWatchdog({
          label: 'opencode',
          idleTimeoutMs: OPENCODE_WATCHDOG_IDLE_MS,
          isClosed: () => cleanedUp || downstreamClosed,
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
            // Ends the for-await over subscription.events, resolving consumeEvents.
            subscription.close()
          },
        })

        await consumeEvents
      } catch (err) {
        if (!requestAborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        }
      } finally {
        cancelWatchdog?.()
        subscription.close()
        await consumeEvents?.catch(() => {})
        clearRunningSession(sessionId)
        if (targetSessionId !== sessionId) {
          clearRunningSession(targetSessionId)
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
  const manualPermissions = body.manualPermissions === true
  const nativeCommands = body.nativeCommands === true
  const parsedAttachments = parseAttachments(body)
  const attachments = buildCopilotAttachments(parsedAttachments)
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
      const bridgedPermissionIds = new Set<string>()

      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }

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

      try {
        const modelsById = new Map<string, CopilotModelInfo>()

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
            const usage = mapCopilotUsageToContextUsage(event, modelsById)
            safeEnqueue(codexContextUsageToEventData(usage))
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
        session = await withTimeout(acquireCopilotSession(sessionId), 20000, 'Copilot session resume')
        if (manualPermissions) {
          setCopilotPermissionHandler(sessionId, createCopilotPermissionBridge(
            sessionId,
            safeEnqueue,
            bridgedPermissionIds,
            () => !downstreamClosed && !cleanedUp,
          ))
          manualPermissionHandlerInstalled = true
        } else {
          setCopilotPermissionHandler(sessionId, approveAll)
        }
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
            resolvePendingCopilotPermissions(sessionId, bridgedPermissionIds, { kind: 'user-not-available' })
            return
          }
          resolvePendingCopilotPermissions(sessionId, bridgedPermissionIds, { kind: 'user-not-available' })
          const running = getRunningSession(sessionId)
          if (running?.provider === 'copilot') {
            void running.interrupt().catch(() => {})
          }
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

        let promptToSend = userMessage
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

        turnTimeoutTimer = setTimeout(() => {
          failTurn?.(new Error('Timeout after 300000ms waiting for Copilot turn completion'))
        }, 300_000)
        if (typeof turnTimeoutTimer === 'object' && turnTimeoutTimer && 'unref' in turnTimeoutTimer) {
          (turnTimeoutTimer as { unref: () => void }).unref()
        }
        const messageOptions: CopilotSendMessageOptions = {
          prompt: promptToSend,
          attachments: attachments.length > 0 ? attachments : undefined,
        }
        if (turnAgentMode) messageOptions.agentMode = turnAgentMode
        await session.send(messageOptions as CopilotMessageOptions)
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
        if (manualPermissionHandlerInstalled) {
          setCopilotPermissionHandler(sessionId, approveAll)
        }
        clearRunningSession(sessionId)
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

      const safeEnqueue = (chunk: string) => {
        if (downstreamClosed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          downstreamClosed = true
        }
      }

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

      try {
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
        if (selectedModel) {
          const model = agentSession.modelRegistry.find(selectedModel.providerID, selectedModel.modelID)
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
        const images = await buildPiImages(attachments)

        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`)
        broadcastLiveSessionTurnStart('pi', targetSessionId)
        broadcastedTurnStart = true

        // Execute native Pi slash commands instead of sending them as prompt text.
        const piSlash = !directShell && attachments.length === 0 ? parseOpenCodeSlashCommand(userMessage) : null
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
            clearRunningSession(sessionId)
            broadcastLiveSessionTurnEnd('pi', targetSessionId)
            schedulePiLiveTranscriptCleanup(targetSessionId)
            close()
          }
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
          signal.addEventListener('abort', () => {
            requestAborted = true
            if (detachOnClientAbort) {
              downstreamClosed = true
              return
            }
            const running = getRunningSession(sessionId)
            if (running?.provider === 'pi') {
              void running.interrupt().catch(() => {})
            }
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
          })
          clearRunningSession(sessionId)
          broadcastLiveSessionActivity('pi', targetSessionId)
          broadcastLiveSessionTurnEnd('pi', targetSessionId)
          schedulePiLiveTranscriptCleanup(targetSessionId)
          close()
          return
        }

        setRunningSession(sessionId, {
          provider: 'pi',
          requestId: turnRequestId,
          interrupt: () => agentSession.abort(),
        })

        signal.addEventListener('abort', () => {
          requestAborted = true
          if (detachOnClientAbort) {
            downstreamClosed = true
            return
          }
          const running = getRunningSession(sessionId)
          if (running?.provider === 'pi') {
            void running.interrupt().catch(() => {})
          }
        })

        // Subscribe to the AgentSession event stream (not the raw Agent): only
        // AgentSession surfaces willRetry on agent_end plus auto_retry/compaction/
        // queue progress. Subscribing to the raw Agent makes transient,
        // auto-retried errors look fatal (false "Pi turn failed" toast) and closes
        // the stream on the first agent_end — cutting off the retry the user never
        // sees. Native Pi instead shows a quiet "retrying…" and recovers.
        unsubscribePi = agentSession.subscribe((event) => {
          if (cleanedUp) return

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
            case 'thinking_level_changed':
              return
            default:
              break
          }

          // A will-retry agent_end is interim — an auto-retry or auto-compaction
          // will re-run the agent on the same prompt() call. Suppress it so the
          // client keeps the turn live and waits for the terminal agent_end.
          if (event.type === 'agent_end' && event.willRetry) return

          // From here on `event` is a core transcript AgentEvent.
          const agentEvent = event as PiAgentEvent
          recordPiLiveTranscriptEvent(targetSessionId, agentEvent)
          broadcastLiveSessionActivity('pi', targetSessionId)
          safeEnqueue(`data: ${JSON.stringify({ type: 'pi_event', event: agentEvent })}\n\n`)

          if (event.type === 'agent_end') {
            // Terminal turn end. Only a genuine 'error' stopReason (rate limit /
            // network / refusal, retries exhausted) is a failure. A user abort
            // surfaces as stopReason 'aborted' — a clean stop, not an error toast.
            const lastAssistant = [...event.messages].reverse().find(
              (message): message is Extract<PiAgentMessage, { role: 'assistant' }> => message.role === 'assistant',
            )
            if (lastAssistant?.stopReason === 'error') {
              safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: lastAssistant.errorMessage || 'Pi turn failed' })}\n\n`)
            }
            clearRunningSession(sessionId)
            unsubscribePi?.()
            broadcastLiveSessionTurnEnd('pi', targetSessionId)
            schedulePiLiveTranscriptCleanup(targetSessionId)
            close()
          }
        })

        const text = `${userMessage}${attachmentsAsPromptText(attachments)}`.trim()
        await agentSession.prompt(text, images.length > 0 ? { images } : undefined)
        // prompt() resolving means the turn is genuinely over. Normally the
        // terminal agent_end handler above already ran cleanup + close (and set
        // cleanedUp). But if that event was never delivered to our subscriber,
        // without this backstop the AgentSession subscription would leak and the
        // stream would hang open forever. Guard on cleanedUp so it's a no-op on
        // the happy path.
        if (!cleanedUp) {
          unsubscribePi?.()
          clearRunningSession(sessionId)
          broadcastLiveSessionTurnEnd('pi', targetSessionId)
          schedulePiLiveTranscriptCleanup(targetSessionId)
          close()
        }
      } catch (err) {
        unsubscribePi?.()
        if (!requestAborted) {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`)
        }
        clearRunningSession(sessionId)
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

export async function streamViewSessionTurn(params: SendMessageParams): Promise<Response> {
  const userMessage = String(params.body.message ?? '').trim()
  if (!userMessage) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const provider = await resolveProvider(params.provider)
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

  return createClaudeStream(params.sessionId, params.signal, params.body)
}

export async function forkViewSession({ sessionId, body, provider }: ForkParams): Promise<{ sessionId: string }> {
  const resolvedProvider = await resolveProvider(provider)
  if (resolvedProvider === 'codex') {
    const client = getCodexClient()
    const response = await client.request<CodexThreadForkResponse>('thread/fork', {
      threadId: sessionId,
      persistExtendedHistory: true,
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
    if (!entryId) {
      throw new Error('upToMessageId is required for Pi fork')
    }
    const newId = forkPiSession(sessionId, entryId)
    if (!newId) {
      throw new Error('Failed to fork Pi session')
    }
    // The source session's on-disk state has been rewritten by the branch
    // operation — drop any warm AgentSession so the next send re-opens it.
    evictPiAgentSession(sessionId)
    return { sessionId: newId }
  }

  const result = await forkSession(sessionId, {
    title: typeof body.title === 'string' ? body.title : undefined,
    upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
  })
  return { sessionId: result.sessionId }
}

export async function createNewViewSession({
  provider: providerOverride,
  cwd,
  title,
}: {
  provider?: AgentProvider
  cwd?: string
  title?: string
}): Promise<{ sessionId: string; provider: AgentProvider; cwd: string; isPending: boolean }> {
  const provider = await resolveProvider(providerOverride)
  const resolvedCwd = (cwd && cwd.trim()) ? cwd : process.cwd()

  if (provider === 'claude') {
    const { randomUUID } = await import('node:crypto')
    return { sessionId: randomUUID(), provider, cwd: resolvedCwd, isPending: true }
  }

  if (provider === 'codex') {
    const client = getCodexClient()
    const response = await client.request<{ thread: { id: string; cwd: string } }>('thread/start', {
      cwd: resolvedCwd,
    })
    const newId = response.thread.id
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
    })
    return { sessionId: session.sessionId, provider, cwd: resolvedCwd, isPending: false }
  }

  if (provider === 'pi') {
    const { randomUUID } = await import('node:crypto')
    return { sessionId: randomUUID(), provider, cwd: resolvedCwd, isPending: true }
  }

  throw new Error(`Create is not supported for ${provider} sessions`)
}

export async function interruptViewSession(sessionId: string, turnRequestId?: string): Promise<void> {
  await interruptRunningSession(sessionId, turnRequestId)
}

export async function readViewSessionModels(sessionId: string, providerOverride?: AgentProvider): Promise<{ models: SessionModelInfo[]; currentModel: string | null; currentContextTier?: CopilotContextTier | null; contextUsage: ContextUsage | null }> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    const modelsResponse = await client.request<CodexModelListResponse>('model/list', {})
    const resume = await resumeCodexThread(sessionId).catch(() => null)
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
    const messages = getPiSessionMessages(sessionId)
    let currentModel: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role: string; model?: string }
      if (msg.role === 'assistant' && msg.model) {
        currentModel = msg.model
        break
      }
    }
    const agentSession = await openPiAgentSession(sessionId)
    const availableModels = agentSession.modelRegistry.getAvailable()
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
      }
    } catch {
      return { agents: [], mentionAgents: [], currentAgent: null }
    }
  }

  if (provider === 'copilot') {
    const session = await acquireCopilotSession(sessionId)
    const currentMode = await session.rpc.mode.get().catch(() => 'interactive')
    return {
      modes: COPILOT_COMPOSER_MODES,
      currentMode: parseCopilotModeResponse(currentMode) ?? 'interactive',
    }
  }

  return {}
}

export async function readViewSessionSlashCommands(sessionId: string, providerOverride?: AgentProvider): Promise<Array<{ command: string; description: string; argumentHint?: string }>> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'claude') {
    const q = createSessionControlQuery(sessionId)
    try {
      const commands = await q.supportedCommands().catch(() => [])
      return commands.map((command) => ({
        command: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? '',
        argumentHint: command.argumentHint && command.argumentHint.trim() ? command.argumentHint : undefined,
      }))
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
    try {
      // Subpath import — bypass TS bundler resolution since the package only exports '.' but ships the file.
      const specifier = '@earendil-works/pi-coding-agent/dist/core/slash-commands.js'
      const mod = await (0, eval)(`import('${specifier}')`) as {
        BUILTIN_SLASH_COMMANDS?: ReadonlyArray<{ name: string; description: string }>
      }
      const list = mod.BUILTIN_SLASH_COMMANDS ?? []
      return list.map((command) => ({
        command: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? '',
      }))
    } catch {
      return []
    }
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
      resumeCodexThread(sessionId),
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
        metadata,
        events,
        workspacePath: session.workspacePath,
      }),
    }
  }
  if (provider === 'pi') {
    const entries = getPiSessionEntries(sessionId)
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

    const sm = openPiSessionManager(sessionId)
    const sessionFile = sm.getSessionFile()
    const cwd = sm.getCwd()
    const agentSession = await openPiAgentSession(sessionId)
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

  const q = createSessionControlQuery(sessionId)
  try {
    const init = await q.initializationResult()
    const [commands, agents, mcpServers, contextUsage, subagents] = await Promise.all([
      q.supportedCommands(),
      q.supportedAgents(),
      q.mcpServerStatus(),
      q.getContextUsage().catch(() => null),
      listSubagents(sessionId).catch(() => [] as string[]),
    ])
    const accountItems: string[] = []
    if (init.account?.email) accountItems.push(init.account.email)
    if (init.account?.organization) accountItems.push(init.account.organization)
    if (init.account?.subscriptionType) accountItems.push(init.account.subscriptionType)
    return {
      currentModel: contextUsage?.model ?? null,
      sections: [
        { id: 'commands', title: 'COMMANDS', items: commands.length > 0 ? commands.slice(0, 20).map((command) => command.name) : ['None'] },
        { id: 'agents', title: 'AGENTS', items: agents.length > 0 ? agents.slice(0, 20).map((agent) => agent.name) : ['None'] },
        {
          id: 'mcp',
          title: 'MCP',
          items: mcpServers.length > 0
            ? mcpServers.map((server) => `${server.name} · ${server.status}`)
            : ['None'],
        },
        {
          id: 'subagents',
          title: 'SUBAGENTS',
          items: subagents.length > 0 ? subagents.slice(0, 20) : ['None'],
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
    const result = await client.request<CodexThreadRollbackResponse>('thread/rollback', {
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

  const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined
  const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-4-6'
  if (!userMessageId) {
    throw new Error('userMessageId is required')
  }

  const q = createSessionControlQuery(sessionId, model)
  try {
    await q.initializationResult()
    return await q.rewindFiles(userMessageId, { dryRun: Boolean(body.dryRun) })
  } finally {
    q.close()
  }
}

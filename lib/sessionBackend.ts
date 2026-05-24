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
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  acquireClaudeSession,
  adoptClaudeSession,
  createInputStream,
  peekClaudeSession,
  recycleClaudeSession,
} from './claudePool'
import type { ContentBlockParam as ClaudeContentBlockParam } from '@anthropic-ai/sdk/resources'
import {
  approveAll,
  type GetAuthStatusResponse as CopilotGetAuthStatusResponse,
  type GetStatusResponse as CopilotGetStatusResponse,
  type MessageOptions as CopilotMessageOptions,
  type ModelInfo as CopilotModelInfo,
  type PermissionRequest as CopilotPermissionRequest,
  type PermissionRequestResult as CopilotPermissionRequestResult,
  type SessionEvent as CopilotSessionEvent,
  type SessionMetadata as CopilotSessionMetadata,
} from '@github/copilot-sdk'
import { clearRunningSession, getRunningSession, setRunningSession } from './sessionRuntime'
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
import { consumeReadModelsWarmQuery, createSessionControlQuery, openPrompt } from './sdkControlQuery'
import { acquireCopilotSession, evictCopilotSession, getCopilotClient } from './copilotClient'
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
import type {
  CodexAppsListResponse,
  CodexExperimentalFeatureListResponse,
  CodexModelListResponse,
  CodexMcpServerListResponse,
  CodexNotification,
  CodexThread,
  CodexThreadForkResponse,
  CodexThreadListResponse,
  CodexThreadReadResponse,
  CodexThreadResumeResponse,
  CodexThreadRollbackResponse,
  CodexThreadTokenUsage,
  CodexTurnStartResponse,
  CodexUserInput,
} from './codexProtocol'
import type {
  ErrorNotification,
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
import { normalizeProjectPath, sameProjectPath } from './projectPaths'
import {
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

function sliceForParams(messages: SessionMessage[], params: MessageListParams): SessionMessage[] {
  if (params.tail) {
    return messages.slice(Math.max(messages.length - params.limit, 0))
  }
  return messages.slice(params.offset, params.offset + params.limit)
}

const OPENCODE_OPTIONS = {
  responseStyle: 'data' as const,
  throwOnError: true as const,
}

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
  return [...messages].sort((a, b) => {
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

function parseAttachments(body: Record<string, unknown>): SendAttachment[] {
  const raw = body.attachments
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): SendAttachment[] => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (!['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob', 'agent'].includes(type)) return []
    return [{
      id: typeof record.id === 'string' ? record.id : undefined,
      type: type as SendAttachment['type'],
      path: typeof record.path === 'string' ? record.path.trim() : undefined,
      filePath: typeof record.filePath === 'string' ? record.filePath.trim() : undefined,
      displayName: typeof record.displayName === 'string' ? record.displayName.trim() : undefined,
      text: typeof record.text === 'string' ? record.text : undefined,
      data: typeof record.data === 'string' ? record.data : undefined,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType.trim() : undefined,
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
    if (attachment.type === 'image' && path) {
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

function buildCopilotAttachments(attachments: SendAttachment[]): NonNullable<CopilotMessageOptions['attachments']> {
  const result: NonNullable<CopilotMessageOptions['attachments']> = []
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
] satisfies NonNullable<SessionComposerOptions['modes']>

function parseCopilotMode(value: unknown): 'interactive' | 'plan' | 'autopilot' | undefined {
  return value === 'interactive' || value === 'plan' || value === 'autopilot'
    ? value
    : undefined
}

function copilotPermissionDecision(response: string): Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }> {
  return response === 'once'
    ? { kind: 'approve-once' }
    : response === 'always'
    ? { kind: 'approve-for-session' }
    : { kind: 'reject' }
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
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  activeIds: Set<string>,
): (request: CopilotPermissionRequest) => Promise<Exclude<CopilotPermissionRequestResult, { kind: 'no-result' }>> {
  return (request) => {
    const requestId = `agent-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeIds.add(requestId)
    controller.enqueue(encoder.encode(`data: ${copilotPermissionRequestedEvent(sessionId, requestId, request)}\n\n`))
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
    ? await client.listSessions({ cwd: dir })
    : await client.listSessions()

  const filtered = dir
    ? response.filter((session) => {
        const cwd = session.context?.cwd
        if (!cwd) return false
        return includeWorktrees ? sameProjectPath(dir, cwd) : normalizeProjectPath(cwd) === normalizeProjectPath(dir)
      })
    : response

  const sorted = [...filtered].sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
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
  const signature = messagesPersistSignature(messages)
  if (persistedMessagesSignature.get(key) === signature) return
  try {
    await syncPersistedSessionMessages(provider, sessionId, messages)
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
  const sorted = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime())
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
      session.getMessages(),
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
      if (!permissionId) throw new Error('permissionId is required')
      if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw new Error('response must be once, always, or reject')
      }
      const result = copilotPermissionDecision(response)
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
      if (!mode) throw new Error('mode must be interactive, plan, or autopilot')
      const session = await acquireCopilotSession(sessionId)
      await session.rpc.mode.set({ mode })
      return { ok: true, mode }
    }
  }

  if (resolvedProvider === 'claude') {
    // Phase 2: prefer the warm pool entry's persistent Query for control RPCs
    // — avoids spinning a fresh CLI subprocess just to swap a model or
    // reconnect an MCP server. Falls back to createSessionControlQuery only
    // when the session isn't pooled (no recent send → no warm Query).
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

  throw new Error(`Action ${action || '(missing)'} is not supported for ${resolvedProvider} sessions`)
}

async function readCodexMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  let thread: CodexThread
  try {
    thread = await readCodexThread(sessionId, true)
  } catch (err) {
    if (isCodexMissingRolloutError(err)) return []
    throw err
  }
  const turns = thread.turns
  const lastTurn = turns.at(-1)
  const lastItem = lastTurn?.items.at(-1)
  const lastItemSignature = lastItem ? JSON.stringify(lastItem) : ''
  // ThreadStatus is a discriminated union; TurnError is an object — both
  // need flat keys for cache fingerprinting or they'd stringify to "[object
  // Object]" and miss invalidations.
  const threadStatusKey = thread.status.type === 'active'
    ? `active:${thread.status.activeFlags.join(',')}`
    : thread.status.type
  const turnErrorKey = lastTurn?.error?.message ?? ''
  const signature = [
    thread.updatedAt,
    threadStatusKey,
    turns.length,
    lastTurn?.id ?? '',
    lastTurn?.status ?? '',
    turnErrorKey,
    lastTurn?.items.length ?? 0,
    lastItemSignature,
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
  const events = await readCopilotSessionEvents(sessionId)
  const last = events.at(-1) as { id?: string; type?: string } | undefined
  const signature = `${events.length}:${last?.id ?? ''}:${last?.type ?? ''}`
  const cached = readMappedMessagesCache(`copilot:${sessionId}`, signature)
  if (cached) return cached
  const messages = sortMessagesChronologically(mapCopilotEventsToSessionMessages(sessionId, events))
  return writeMappedMessagesCache(`copilot:${sessionId}`, signature, messages)
}

function readPiMessagesAll(sessionId: string): SessionMessage[] {
  const raw = getPiSessionMessages(sessionId)
  const last = raw.at(-1) as { id?: string; role?: string } | undefined
  const signature = `${raw.length}:${last?.id ?? ''}:${last?.role ?? ''}`
  const cached = readMappedMessagesCache(`pi:${sessionId}`, signature)
  if (cached) return cached
  const messages = sortMessagesChronologically(mapPiMessagesToSessionMessages(sessionId, raw))
  return writeMappedMessagesCache(`pi:${sessionId}`, signature, messages)
}

export async function listViewSessionMessages(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessage[]> {
  const provider = await resolveProvider(providerOverride)
  let messages: SessionMessage[]
  if (provider === 'codex') {
    messages = await readCodexMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return sliceForParams(messages, params)
  }
  if (provider === 'opencode') {
    messages = await readOpenCodeMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return sliceForParams(messages, params)
  }
  if (provider === 'copilot') {
    messages = await readCopilotMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return sliceForParams(messages, params)
  }
  if (provider === 'pi') {
    messages = readPiMessagesAll(sessionId)
    await syncMessagesBestEffort(provider, sessionId, messages)
    return sliceForParams(messages, params)
  }
  messages = await readClaudeSessionMessages(sessionId)
  await syncMessagesBestEffort(provider, sessionId, messages)
  return sliceForParams(messages, params)
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

async function createClaudeStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const explicitModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const isPendingSession = Boolean(body.isPendingSession)
  const permissionMode = parseClaudePermissionMode(body)
  // For pending (newly created) sessions there is no prior model on disk, so we
  // need an explicit default. For existing/resumed sessions we leave model
  // unset so the SDK reuses whatever the session was last running with — same
  // as `claude --resume` from the CLI.
  const model = explicitModel ?? (isPendingSession ? 'claude-sonnet-4-6' : undefined)
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
  const useColdPath = isPendingSession || forkSessionOnSend || Boolean(resumeSessionAt)

  if (useColdPath) {
    return createClaudeStreamCold({
      sessionId,
      signal,
      userMessage,
      attachments,
      isPendingSession,
      permissionMode,
      model,
      effort,
      resumeSessionAt,
      forkSessionOnSend,
      cwdOverride,
      taskBudgetTotal,
    })
  }

  return createClaudeStreamPooled({
    sessionId,
    signal,
    userMessage,
    attachments,
    permissionMode,
    model,
    effort,
    cwdOverride,
    taskBudgetTotal,
  })
}

type ClaudeStreamColdArgs = {
  sessionId: string
  signal: AbortSignal
  userMessage: string
  attachments: SendAttachment[]
  isPendingSession: boolean
  permissionMode: ClaudePermissionMode | undefined
  model: string | undefined
  effort: ReasoningEffortLevel | undefined
  resumeSessionAt: string | undefined
  forkSessionOnSend: boolean
  cwdOverride: string | undefined
  taskBudgetTotal: number | undefined
}

async function createClaudeStreamCold(args: ClaudeStreamColdArgs): Promise<Response> {
  const {
    sessionId,
    signal,
    userMessage,
    attachments,
    isPendingSession,
    permissionMode,
    model,
    effort,
    resumeSessionAt,
    forkSessionOnSend,
    cwdOverride,
    taskBudgetTotal,
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
  // Named handler so we can detach it on successful adoption — otherwise a
  // post-turn client disconnect would abort the Query we just gave to the pool.
  const propagateAbort = () => abortController.abort()
  signal.addEventListener('abort', propagateAbort)

  // Snapshot of the options we constructed the Query with — passed to the
  // pool on adopt so future acquires can compatibility-check against it.
  const adoptOptions = {
    sessionId,
    cwd: cwdOverride,
    model,
    permissionMode,
    effort,
    resumeSessionAt,
    forkSession: forkSessionOnSend,
    taskBudgetTokens: taskBudgetTotal,
  }

  const stream = new ReadableStream({
    async start(controller) {
      const q = query({
        prompt: iterable,
        options: {
          ...(isPendingSession ? {} : { resume: sessionId }),
          ...(cwdOverride ? { cwd: cwdOverride } : {}),
          ...(model ? { model } : {}),
          ...(permissionMode ? { permissionMode } : {}),
          effort: effort === 'off' || effort === 'minimal' ? undefined : effort,
          thinking: effort === 'off'
            ? { type: 'disabled' }
            : effort
            ? { type: 'adaptive' }
            : undefined,
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

      setRunningSession(sessionId, {
        provider: 'claude',
        interrupt: () => q.interrupt(),
      })

      let emittedSessionEvent = false
      let realizedSessionId: string | undefined
      let adopted = false

      try {
        try {
          const usage = await q.getContextUsage()
          controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
        } catch {}

        for await (const msg of q) {
          if (!emittedSessionEvent && msg.session_id) {
            emittedSessionEvent = true
            realizedSessionId = msg.session_id
            controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: msg.session_id })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
          // Break after the result so we can adopt the Query into the pool.
          // The pool's pump loop takes over consuming for any tail messages
          // (notably prompt_suggestion, which the SDK emits after `result`)
          // and for future turns.
          if (msg.type === 'result') break
        }

        // Adopt into the pool when we can: a clean result was seen, the
        // session_id is known, and the client hasn't disconnected. Skipping
        // adoption falls back to the legacy close-after-turn-1 behavior.
        if (
          realizedSessionId
          && !abortController.signal.aborted
        ) {
          signal.removeEventListener('abort', propagateAbort)
          adoptClaudeSession({
            sessionId: realizedSessionId,
            query: q,
            pushUserMessage,
            endInput,
            options: { ...adoptOptions, sessionId: realizedSessionId },
          })
          adopted = true
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        clearRunningSession(sessionId)
        if (!adopted) {
          signal.removeEventListener('abort', propagateAbort)
          q.close()
        }
        controller.close()
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
  model: string | undefined
  effort: ReasoningEffortLevel | undefined
  cwdOverride: string | undefined
  taskBudgetTotal: number | undefined
}

async function createClaudeStreamPooled(args: ClaudeStreamPooledArgs): Promise<Response> {
  const {
    sessionId,
    signal,
    userMessage,
    attachments,
    permissionMode,
    model,
    effort,
    cwdOverride,
    taskBudgetTotal,
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
        interrupt: () => entry.query.interrupt(),
      })

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

      try {
        await entry.run(pushMessage, {
          signal,
          onMessage: (msg) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
            } catch {
              /* downstream closed; ignore */
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
  const q = warm
    ? warm.query(openPrompt())
    : query({
        prompt: openPrompt(),
        options: {
          model: 'claude-sonnet-4-6',
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

async function createCodexStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const model = typeof body.model === 'string' ? body.model : null
  const effort = parseEffort(body)
  // Codex's app-server accepts `low`/`medium`/`high` for reasoningEffort
  // (mirrors the CLI's `/reasoning` setting). `off`/`minimal`/`xhigh`/`max`
  // are not valid there, so drop them and let Codex use its thread default.
  const codexEffort = effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined
  const attachments = parseAttachments(body)
  const bangShell = userMessage.startsWith('!') && attachments.length === 0
    ? userMessage.slice(1).trim()
    : null
  const client = getCodexClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let targetTurnId: string | null = null
      const bufferedNotifications: CodexNotification[] = []
      let currentModel = model ?? 'codex'
      let closed = false
      let completionSeen = false
      let bufferedTurnCompleted = false
      let completionCloseTimer: ReturnType<typeof setTimeout> | null = null

      const safeEnqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }

      const safeClose = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* stream already closed by consumer/runtime */
        }
      }

      const closeStream = (unsubscribe: () => void) => {
        if (closed) return
        if (completionCloseTimer) {
          clearTimeout(completionCloseTimer)
          completionCloseTimer = null
        }
        clearRunningSession(sessionId)
        unsubscribe()
        safeClose()
      }

      const scheduleCompletionClose = (unsubscribe: () => void) => {
        if (closed) return
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
      const unsubscribe = () => {
        consumeAborted = true
        subscription.close()
      }
      const activateTargetTurn = (turnId: string) => {
        if (!turnId || targetTurnId) return
        targetTurnId = turnId

        setRunningSession(sessionId, {
          provider: 'codex',
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
            } else {
              bufferedNotifications.push(notification)
              continue
            }
          }

          if (notificationTurnId && notificationTurnId !== targetTurnId) continue

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

        const started = await client.request<CodexTurnStartResponse>('turn/start', {
          threadId: sessionId,
          model: model ?? undefined,
          reasoningEffort: codexEffort,
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
  const client = await getOpenCodeClient()
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  signal.addEventListener('abort', () => {
    abortController.abort()
    const running = getRunningSession(sessionId)
    if (running?.provider === 'opencode') {
      void running.interrupt().catch(() => {})
    }
  })

  const stream = new ReadableStream({
    async start(controller) {
      let targetSessionId = sessionId
      let closed = false
      let consumeEvents: Promise<void> | null = null
      // Subscribe to the shared event harness — one upstream connection
      // per process, multiplexed by session. Filter on the original session
      // id first; if we end up forking we'll resubscribe to the new id.
      let subscription = subscribeToOpenCodeEvents({ sessionId })
      const close = () => {
        if (closed) return
        closed = true
        subscription.close()
        controller.close()
      }

      // Push an SSE comment immediately so any intermediate proxy starts
      // forwarding the response without waiting for the first real frame.
      // Mirrors how curl-friendly SSE servers prime the pipe.
      controller.enqueue(encoder.encode(':ok\n\n'))

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

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`))

        // Replay cached state so the client doesn't have to wait for the
        // next live event tick to render a stale permission prompt or busy
        // indicator — this is what opencode-web does on every subscribe.
        const cached = subscription.snapshot
        if (cached?.status) {
          controller.enqueue(encoder.encode(`event: opencode-status\ndata: ${JSON.stringify(cached.status)}\n\n`))
        }
        if (cached?.todos && cached.todos.length > 0) {
          controller.enqueue(encoder.encode(`event: opencode-todos\ndata: ${JSON.stringify(cached.todos)}\n\n`))
        }
        for (const permission of cached?.permissions ?? []) {
          controller.enqueue(encoder.encode(`data: ${formatOpenCodeEvent({ type: 'permission.updated', properties: permission } as OpenCodeEvent)}\n\n`))
        }

        setRunningSession(sessionId, {
          provider: 'opencode',
          interrupt: () => client.session.abort({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
          }),
        })
        if (targetSessionId !== sessionId) {
          setRunningSession(targetSessionId, {
            provider: 'opencode',
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
                controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
              }
            }

            if (event.type === 'session.status') {
              controller.enqueue(encoder.encode(`event: opencode-status\ndata: ${JSON.stringify(event.properties.status)}\n\n`))
            }

            if (event.type === 'todo.updated') {
              controller.enqueue(encoder.encode(`event: opencode-todos\ndata: ${JSON.stringify(event.properties.todos)}\n\n`))
            }

            if (event.type === 'session.error') {
              const message = event.properties.error?.data && 'message' in event.properties.error.data
                ? String(event.properties.error.data.message)
                : 'Unknown OpenCode session error'
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
              break
            }

            controller.enqueue(encoder.encode(`data: ${formatOpenCodeEvent(event)}\n\n`))

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

        await consumeEvents
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        abortController.abort()
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

async function createCopilotStream(sessionId: string, signal: AbortSignal, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const selectedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null
  const effort = parseEffort(body)
  const selectedMode = parseCopilotMode(body.mode)
  const manualPermissions = body.manualPermissions === true
  const nativeCommands = body.nativeCommands === true
  const parsedAttachments = parseAttachments(body)
  const attachments = buildCopilotAttachments(parsedAttachments)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let session: Awaited<ReturnType<typeof acquireCopilotSession>> | null = null
      let unsubscribe: (() => void) | null = null
      let closed = false
      let emittedError = false
      let manualPermissionHandlerInstalled = false
      let completedTurn = false
      let turnTimeoutTimer: ReturnType<typeof setTimeout> | null = null
      let finalMessageFallbackTimer: ReturnType<typeof setTimeout> | null = null
      let historyPollCancelled = false
      let finishTurn: (() => void) | null = null
      let failTurn: ((error: Error) => void) | null = null
      const streamedAssistantMessageIds = new Set<string>()
      const bridgedPermissionIds = new Set<string>()

      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      const clearFinalMessageFallback = () => {
        if (finalMessageFallbackTimer == null) return
        clearTimeout(finalMessageFallbackTimer)
        finalMessageFallbackTimer = null
      }

      const scheduleFinalMessageFallback = (event: Extract<CopilotSessionEvent, { type: 'assistant.message' }>) => {
        if (selectedMode === 'autopilot') return
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
          if (closed) return
          if (event.type === 'assistant.message') {
            streamedAssistantMessageIds.add(event.data.messageId)
            scheduleFinalMessageFallback(event)
          } else if (event.type === 'assistant.turn_start') {
            clearFinalMessageFallback()
          } else if ((event.type as string) === 'session.idle' || (event.type as string) === 'session.task_complete') {
            finishTurn?.()
          }

          if (event.type === 'assistant.usage') {
            const usage = mapCopilotUsageToContextUsage(event, modelsById)
            controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
          }

          if (event.type === 'session.error') {
            emittedError = true
            const error = new Error(event.data.message)
            if (event.data.stack) error.stack = event.data.stack
            failTurn?.(error)
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: event.data.message })}\n\n`))
            return
          }

          controller.enqueue(encoder.encode(`data: ${formatCopilotEvent(event)}\n\n`))
        }

        // Warm session pool: re-use a single Copilot session per id across
        // sends and bind a fresh listener for this turn only. The native CLI
        // keeps the JSON-RPC connection alive between turns; this matches.
        session = await withTimeout(acquireCopilotSession(sessionId), 20000, 'Copilot session resume')
        if (manualPermissions) {
          session.registerPermissionHandler(createCopilotPermissionBridge(sessionId, controller, encoder, bridgedPermissionIds))
          manualPermissionHandlerInstalled = true
        } else {
          session.registerPermissionHandler(approveAll)
        }
        unsubscribe = session.on(handleEvent)
        const historyBaselineCount = await withTimeout(
          readCopilotHistoryFromSession(session),
          5000,
          'Copilot history baseline',
        ).then((events) => events.length).catch(() => null)

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`))

        setRunningSession(sessionId, {
          provider: 'copilot',
          interrupt: () => session?.abort() ?? Promise.resolve(),
        })

        signal.addEventListener('abort', () => {
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
            session.setModel(selectedModel, copilotEffort ? { reasoningEffort: copilotEffort } : undefined),
            15000,
            'Copilot model switch',
          )
        } else if (copilotEffort) {
          const current = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined }))
          const nextModel = current.modelId
          if (nextModel && (current.modelId !== nextModel || copilotEffort)) {
            await withTimeout(
              session.setModel(nextModel, copilotEffort ? { reasoningEffort: copilotEffort } : undefined),
              15000,
              'Copilot model switch',
            )
          }
        }

        if (selectedMode) {
          await withTimeout(session.rpc.mode.set({ mode: selectedMode }), 5000, 'Copilot mode switch')
        }

        let promptToSend = userMessage
        const slashCommand = nativeCommands && parsedAttachments.length === 0
          ? parseOpenCodeSlashCommand(userMessage)
          : null
        if (slashCommand) {
          const commandName = slashCommand.command.toLowerCase()
          if (commandName === 'help') {
            controller.enqueue(encoder.encode(copilotCommandResultEvent({
              message: 'Copilot commands: /mode [interactive|plan|autopilot], /model [model].',
            })))
            return
          }
          if (commandName === 'mode') {
            const requestedMode = parseCopilotMode(slashCommand.arguments.split(/\s+/)[0])
            if (!requestedMode) {
              const currentMode = await withTimeout(session.rpc.mode.get(), 5000, 'Copilot mode read').catch(() => 'interactive')
              controller.enqueue(encoder.encode(copilotCommandResultEvent({
                message: `Copilot mode is ${parseCopilotMode(currentMode) ?? 'interactive'}. Use /mode interactive, /mode plan, or /mode autopilot.`,
                mode: parseCopilotMode(currentMode) ?? 'interactive',
              })))
              return
            }
            await withTimeout(session.rpc.mode.set({ mode: requestedMode }), 5000, 'Copilot mode switch')
            controller.enqueue(encoder.encode(copilotCommandResultEvent({
              message: `Copilot mode set to ${requestedMode}.`,
              mode: requestedMode,
            })))
            return
          }
          if (commandName === 'model') {
            const requestedModel = slashCommand.arguments.trim()
            if (!requestedModel) {
              const current = await withTimeout(session.rpc.model.getCurrent(), 5000, 'Copilot current model').catch(() => ({ modelId: undefined }))
              controller.enqueue(encoder.encode(copilotCommandResultEvent({
                message: current.modelId ? `Copilot model is ${current.modelId}.` : 'No Copilot model is selected.',
              })))
              return
            }
            await withTimeout(
              session.setModel(requestedModel, copilotEffort ? { reasoningEffort: copilotEffort } : undefined),
              15000,
              'Copilot model switch',
            )
            controller.enqueue(encoder.encode(copilotCommandResultEvent({
              message: `Copilot model set to ${requestedModel}.`,
            })))
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
              ? result as Record<string, unknown>
              : null
            if (resultRecord?.kind === 'agent-prompt' && typeof resultRecord.prompt === 'string') {
              const mode = parseCopilotMode(resultRecord.mode)
              if (mode) await session.rpc.mode.set({ mode })
              promptToSend = resultRecord.prompt
            } else if (resultRecord?.kind === 'text' && typeof resultRecord.text === 'string') {
              controller.enqueue(encoder.encode(copilotCommandResultEvent({
                message: resultRecord.text,
              })))
              return
            } else if (resultRecord?.kind === 'completed') {
              controller.enqueue(encoder.encode(copilotCommandResultEvent({
                message: typeof resultRecord.message === 'string' && resultRecord.message.trim()
                  ? resultRecord.message
                  : `/${slashCommand.command} completed.`,
              })))
              return
            } else if (resultRecord?.kind === 'select-subcommand') {
              controller.enqueue(encoder.encode(copilotCommandResultEvent({
                message: `/${slashCommand.command} needs a subcommand in the native Copilot UI.`,
              })))
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
        await session.send({ prompt: promptToSend, attachments: attachments.length > 0 ? attachments : undefined })
        const historyCompletion = historyBaselineCount == null
          ? new Promise<never>(() => {})
          : (async () => {
            while (!historyPollCancelled && !closed) {
              await sleep(1000)
              if (historyPollCancelled || closed || !session) return
              const events = await withTimeout(
                readCopilotHistoryFromSession(session),
                5000,
                'Copilot history poll',
              ).catch(() => null)
              if (!events) continue
              const finalMessage = findCopilotHistoryCompletion(
                events,
                historyBaselineCount,
                selectedMode !== 'autopilot',
              )
              if (!finalMessage) continue
              if (!streamedAssistantMessageIds.has(finalMessage.data.messageId)) {
                controller.enqueue(encoder.encode(`data: ${formatCopilotEvent(finalMessage)}\n\n`))
              }
              return
            }
          })()
        await Promise.race([turnComplete, historyCompletion])
        completedTurn = true
      } catch (err) {
        if (!emittedError) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
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
          session?.registerPermissionHandler(approveAll)
        }
        clearRunningSession(sessionId)
        try { unsubscribe?.() } catch { /* ignore */ }
        if (completedTurn) {
          await evictCopilotSession(sessionId).catch(() => {})
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
  const selectedModel = decodePiModelValue(typeof body.model === 'string' ? body.model : null)
  const effort = parseEffort(body)
  const attachments = parseAttachments(body)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let unsubscribePi: (() => void) | undefined
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      try {
        const agentSession = await openPiAgentSession(sessionId)
        const targetSessionId = agentSession.sessionId
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

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`))

        setRunningSession(sessionId, {
          provider: 'pi',
          interrupt: () => agentSession.abort(),
        })

        signal.addEventListener('abort', () => {
          const running = getRunningSession(sessionId)
          if (running?.provider === 'pi') {
            void running.interrupt().catch(() => {})
          }
        })

        unsubscribePi = agentSession.agent.subscribe((event) => {
          if (closed) return
          const payload = JSON.stringify({ type: 'pi_event', event })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))

          // pi-ai's terminal AssistantMessage carries stopReason "error" |
          // "aborted" with errorMessage when the LLM call fails (rate limit,
          // network, refusal). agent_end still fires cleanly, so without
          // this branch the user just sees an empty turn — no error toast.
          // Gate on the terminal events only so a transient stopReason on
          // an in-flight message_update can't trip a false positive.
          if (event.type === 'message_end' || event.type === 'turn_end') {
            const message = event.message
            if (message.role === 'assistant'
              && (message.stopReason === 'error' || message.stopReason === 'aborted')
            ) {
              const errorMessage = message.errorMessage
                || (message.stopReason === 'aborted' ? 'Pi turn aborted' : 'Pi turn failed')
              controller.enqueue(encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`,
              ))
            }
          }

          if (event.type === 'agent_end') {
            clearRunningSession(sessionId)
            unsubscribePi?.()
            close()
          }
        })

        const text = `${userMessage}${attachmentsAsPromptText(attachments)}`.trim()
        await agentSession.prompt(text, images.length > 0 ? { images } : undefined)
      } catch (err) {
        unsubscribePi?.()
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        clearRunningSession(sessionId)
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
    const { createPiAgentSession } = await import('./piClient')
    const session = await createPiAgentSession(resolvedCwd)
    return { sessionId: session.sessionId, provider, cwd: resolvedCwd, isPending: false }
  }

  throw new Error(`Create is not supported for ${provider} sessions`)
}

export async function interruptViewSession(sessionId: string): Promise<void> {
  const running = getRunningSession(sessionId)
  if (!running) {
    throw new Error('No running session for this session')
  }
  await running.interrupt()
}

export async function readViewSessionModels(sessionId: string, providerOverride?: AgentProvider): Promise<{ models: SessionModelInfo[]; currentModel: string | null; contextUsage: ContextUsage | null }> {
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
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
    ])
    return {
      models: mapCopilotModelsToSessionModels(models),
      currentModel: currentModel.modelId ?? null,
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
      currentMode: parseCopilotMode(currentMode) ?? 'interactive',
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

    const [events, currentModel, mode, tools, quota] = await Promise.all([
      session.getMessages(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      session.rpc.mode.get().catch(() => ({ mode: undefined })),
      client.rpc.tools.list({ model: undefined }).catch(() => ({ tools: [] as Array<{ name: string; description?: string }> })),
      client.rpc.account.getQuota().catch(() => ({ quotaSnapshots: {} as Record<string, {
        entitlementRequests: number
        usedRequests: number
        remainingPercentage: number
        overage: number
        overageAllowedWithExhaustedQuota: boolean
        resetDate?: string
      }> })),
    ])

    const quotaItems = Object.entries(quota.quotaSnapshots).map(([name, snapshot]) => {
      const remaining = Math.round(snapshot.remainingPercentage * 100)
      const reset = snapshot.resetDate ? ` · resets ${snapshot.resetDate}` : ''
      return `${name} · ${snapshot.usedRequests}/${snapshot.entitlementRequests} used · ${remaining}% remaining${reset}`
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

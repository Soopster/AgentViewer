import { NextRequest, NextResponse } from 'next/server'

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
} from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam as ClaudeContentBlockParam, MessageParam as ClaudeMessageParam } from '@anthropic-ai/sdk/resources'
import type {
  GetAuthStatusResponse as CopilotGetAuthStatusResponse,
  GetStatusResponse as CopilotGetStatusResponse,
  MessageOptions as CopilotMessageOptions,
  ModelInfo as CopilotModelInfo,
  SessionEvent as CopilotSessionEvent,
  SessionMetadata as CopilotSessionMetadata,
} from '@github/copilot-sdk'
import { clearRunningSession, getRunningSession, setRunningSession } from './sessionRuntime'
import { getProviderCapabilities } from './provider'
import { getConfiguredProvider } from './providerState'
import type {
  AgentProvider,
  ContextUsage,
  Session,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
  SendAttachment,
  ReasoningEffortLevel,
} from './types'
import { createSessionControlQuery } from './sdkControlQuery'
import { getCopilotClient, resumeCopilotSession } from './copilotClient'
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
  CodexThreadForkResponse,
  CodexThreadListResponse,
  CodexThreadReadResponse,
  CodexThreadResumeResponse,
  CodexThreadRollbackResponse,
  CodexThreadTokenUsage,
  CodexTurnStartResponse,
  CodexUserInput,
} from './codexProtocol'
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
  forkPiSession,
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
// filesystem I/O on every 5-second session list refresh.
const SESSION_INFO_TTL = 20_000
type SessionInfoCacheEntry = { result: Awaited<ReturnType<typeof getSessionInfo>>; ts: number }
const sessionInfoCache = new Map<string, SessionInfoCacheEntry>()

function pruneSessionInfoCache() {
  const deadline = Date.now() - SESSION_INFO_TTL * 3
  for (const [key, entry] of sessionInfoCache) {
    if (entry.ts < deadline) sessionInfoCache.delete(key)
  }
}

async function getCachedSessionInfo(sessionId: string, dir: string | undefined): Promise<Awaited<ReturnType<typeof getSessionInfo>>> {
  const cached = sessionInfoCache.get(sessionId)
  if (cached && Date.now() - cached.ts < SESSION_INFO_TTL) return cached.result
  const result = await getSessionInfo(sessionId, dir ? { dir } : undefined)
  sessionInfoCache.set(sessionId, { result, ts: Date.now() })
  return result
}

// Per-session cache of mapped+sorted messages. Lets idle polls skip the
// normalize/dedup/sort pipeline when the underlying transcript is unchanged.
// Each call computes a cheap raw signature; on match we return the cached
// array (slice happens at the call site). On mismatch we re-map and store.
const MAPPED_MESSAGE_TTL = 60_000
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
    return cached.messages
  }
  return null
}

function writeMappedMessagesCache(key: string, signature: string, messages: SessionMessage[]): SessionMessage[] {
  pruneMappedMessageCache()
  mappedMessageCache.set(key, { signature, messages, ts: Date.now() })
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
  request: NextRequest
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
    if (!['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob'].includes(type)) return []
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

async function buildClaudePrompt(userMessage: string, attachments: SendAttachment[]): Promise<string | AsyncIterable<{ type: 'user'; message: ClaudeMessageParam; parent_tool_use_id: null }>> {
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
  if (imageBlocks.length === 0) return text

  async function* messages() {
    yield {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text },
          ...imageBlocks,
        ],
      },
      parent_tool_use_id: null,
    }
  }

  return messages()
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
    if (attachment.type === 'file' || attachment.type === 'image') {
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

function buildOpenCodeParts(userMessage: string, attachments: SendAttachment[]): Array<OpenCodeTextPartInput | OpenCodeFilePartInput> {
  const text = `${userMessage}${attachmentsAsPromptText(attachments, ['file', 'image', 'blob'])}`.trim()
  const parts: Array<OpenCodeTextPartInput | OpenCodeFilePartInput> = [{ type: 'text', text }]
  for (const attachment of attachments) {
    const path = attachmentPath(attachment)
    if (!path || (attachment.type !== 'file' && attachment.type !== 'image')) continue
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

function openCodeEventSessionId(event: OpenCodeEvent): string | undefined {
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type === 'message.part.delta') {
    const properties = eventRecord.properties
    if (properties && typeof properties === 'object') {
      const sessionID = (properties as Record<string, unknown>).sessionID
      return typeof sessionID === 'string' ? sessionID : undefined
    }
  }

  switch (event.type) {
    case 'message.updated':
      return event.properties.info.sessionID
    case 'message.removed':
      return event.properties.sessionID
    case 'message.part.updated':
      return event.properties.part.sessionID
    case 'message.part.removed':
      return event.properties.sessionID
    case 'permission.updated':
      return event.properties.sessionID
    case 'permission.replied':
      return event.properties.sessionID
    case 'session.status':
      return event.properties.sessionID
    case 'session.idle':
      return event.properties.sessionID
    case 'session.compacted':
      return event.properties.sessionID
    case 'todo.updated':
      return event.properties.sessionID
    case 'command.executed':
      return event.properties.sessionID
    case 'session.created':
      return event.properties.info.id
    case 'session.updated':
      return event.properties.info.id
    case 'session.deleted':
      return event.properties.info.id
    case 'session.diff':
      return event.properties.sessionID
    case 'session.error':
      return event.properties.sessionID
    default:
      return undefined
  }
}

function formatOpenCodeEvent(event: OpenCodeEvent): string {
  return JSON.stringify({ type: 'opencode_event', event })
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
  const session = await resumeCopilotSession(sessionId)
  try {
    return await session.getMessages()
  } finally {
    await session.disconnect().catch(() => {})
  }
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
  try {
    await syncPersistedSessions(sessions)
  } catch {
    // The viewer should keep working if the local analytics index is unreadable.
  }
}

async function syncMessagesBestEffort(
  provider: AgentProvider,
  sessionId: string,
  messages: SessionMessage[],
): Promise<void> {
  try {
    await syncPersistedSessionMessages(provider, sessionId, messages)
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
    const combinedLimit = Math.max(params.limit + params.offset, 500)
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
    const [thread, resume, tag] = await Promise.all([
      readCodexThread(sessionId, false),
      resumeCodexThread(sessionId),
      getCodexStoredTag(sessionId),
    ])
    return mapCodexThreadToSessionInfo(thread, tag, resume.model)
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
      resumeCopilotSession(sessionId),
    ])

    try {
      const [events, currentModel] = await Promise.all([
        session.getMessages(),
        session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      ])

      return mapCopilotSessionToInfo(sessionId, events, stored, metadata, currentModel.modelId)
    } finally {
      await session.disconnect().catch(() => {})
    }
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

  throw new Error(`Action ${action || '(missing)'} is not supported for ${resolvedProvider} sessions`)
}

async function readCodexMessagesAll(sessionId: string): Promise<SessionMessage[]> {
  const thread = await readCodexThread(sessionId, true)
  const turns = thread.turns
  const lastTurn = turns.at(-1)
  const lastItem = lastTurn?.items.at(-1)
  const signature = `${turns.length}:${lastTurn?.id ?? ''}:${lastTurn?.items.length ?? 0}:${lastItem?.id ?? ''}`
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
  const sessions = await listViewSessions({
    limit: 500,
    offset: 0,
    dir: params.dir,
    includeWorktrees: params.includeWorktrees,
    provider: params.provider,
  })

  const batches = await mapConcurrent(sessions, 10, async (session) => {
    const key = `${session.provider ?? 'claude'}:${session.sessionId}`
    const offset = Math.max(0, params.offsets[key] ?? 0)
    const limit = offset === 0 ? params.initialLimit : params.incrementalLimit
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

  return { sessions, batches }
}

async function createClaudeStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-4-6'
  const effort = parseEffort(body)
  const attachments = parseAttachments(body)
  const prompt = await buildClaudePrompt(userMessage, attachments)
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const forkSessionOnSend = Boolean(body.forkSession)

  const encoder = new TextEncoder()
  const abortController = new AbortController()
  request.signal.addEventListener('abort', () => abortController.abort())

  const stream = new ReadableStream({
    async start(controller) {
      const q = query({
        prompt,
        options: {
          resume: sessionId,
          model,
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
        },
      })

      setRunningSession(sessionId, {
        provider: 'claude',
        interrupt: () => q.interrupt(),
      })

      let emittedSessionEvent = false

      try {
        try {
          const usage = await q.getContextUsage()
          controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
        } catch {}

        for await (const msg of q) {
          if (!emittedSessionEvent && msg.session_id) {
            emittedSessionEvent = true
            controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: msg.session_id })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        clearRunningSession(sessionId)
        q.close()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function readClaudeSupportedModels(): Promise<SessionModelInfo[]> {
  const q = query({
    prompt: 'ping',
    options: {
      model: 'claude-sonnet-4-6',
      persistSession: false,
      maxTurns: 1,
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
    case 'item/agentMessage/delta':
      return JSON.stringify({ type: 'codex_agent_message_delta', ...notification.params })
    case 'item/plan/delta':
      return JSON.stringify({ type: 'codex_plan_delta', ...notification.params })
    case 'item/reasoning/summaryTextDelta':
      return JSON.stringify({ type: 'codex_reasoning_summary_delta', ...notification.params })
    case 'item/reasoning/textDelta':
      return JSON.stringify({ type: 'codex_reasoning_delta', ...notification.params })
    case 'thread/realtime/transcriptUpdated':
      return JSON.stringify({ type: 'codex_realtime_transcript', ...notification.params })
    case 'thread/realtime/itemAdded':
      return JSON.stringify({ type: 'codex_realtime_item_added', ...notification.params })
    case 'item/started':
      return JSON.stringify({ type: 'codex_item_started', ...notification.params })
    case 'item/completed':
      return JSON.stringify({ type: 'codex_item_completed', ...notification.params })
    default:
      return null
  }
}

function getCodexNotificationTurnId(notification: CodexNotification): string | null {
  const params = notification.params as { turnId?: unknown; turn?: { id?: unknown } | null }
  if (typeof params.turnId === 'string' && params.turnId) return params.turnId
  if (typeof params.turn?.id === 'string' && params.turn.id) return params.turn.id
  return null
}

async function createCodexStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const model = typeof body.model === 'string' ? body.model : null
  const attachments = parseAttachments(body)
  const client = getCodexClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let targetTurnId: string | null = null
      const bufferedNotifications: CodexNotification[] = []
      let currentModel = model ?? 'codex'
      let closed = false
      let completionSeen = false
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

      const unsubscribe = client.subscribe((notification) => {
        const params = notification.params as { threadId?: string; turnId?: string }
        if (params.threadId !== sessionId) return
        const notificationTurnId = getCodexNotificationTurnId(notification)

        if (notification.method === 'thread/tokenUsage/updated') {
          if (!targetTurnId || notificationTurnId !== targetTurnId) return
          const usage = mapCodexTokenUsageToContextUsage(
            (notification.params as { tokenUsage: CodexThreadTokenUsage }).tokenUsage,
            currentModel,
          )
          safeEnqueue(codexContextUsageToEventData(usage))
          return
        }

        if (!targetTurnId) {
          bufferedNotifications.push(notification)
          return
        }

        if (notificationTurnId && notificationTurnId !== targetTurnId) return

        if (notification.method === 'turn/completed') {
          scheduleCompletionClose(unsubscribe)
          return
        }

        if (completionSeen) scheduleCompletionClose(unsubscribe)
        flushNotification(notification)
      })

      request.signal.addEventListener('abort', () => {
        const running = getRunningSession(sessionId)
        if (running?.provider === 'codex') {
          void running.interrupt().catch(() => {})
        }
      })

      try {
        const resume = await resumeCodexThread(sessionId).catch(() => null)
        currentModel = model ?? resume?.model ?? currentModel
        safeEnqueue(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`)

        const started = await client.request<CodexTurnStartResponse>('turn/start', {
          threadId: sessionId,
          model: model ?? undefined,
          input: buildCodexInput(userMessage, attachments),
        })

        targetTurnId = started.turn.id

        setRunningSession(sessionId, {
          provider: 'codex',
          interrupt: () => client.request('turn/interrupt', { threadId: sessionId, turnId: targetTurnId }),
        })

        let bufferedTurnCompleted = false
        for (const notification of bufferedNotifications) {
          const bufferedTurnId = getCodexNotificationTurnId(notification)
          if (bufferedTurnId && bufferedTurnId !== targetTurnId) continue
          if (notification.method === 'turn/completed') {
            bufferedTurnCompleted = true
            continue
          }
          if (notification.method === 'thread/tokenUsage/updated') {
            const usage = mapCodexTokenUsageToContextUsage(
              (notification.params as { tokenUsage: CodexThreadTokenUsage }).tokenUsage,
              currentModel,
            )
            safeEnqueue(codexContextUsageToEventData(usage))
            continue
          }
          if (completionSeen) scheduleCompletionClose(unsubscribe)
          flushNotification(notification)
        }

        if (bufferedTurnCompleted) {
          scheduleCompletionClose(unsubscribe)
        }
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
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function createOpenCodeStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const selectedModel = decodeOpenCodeModelValue(typeof body.model === 'string' ? body.model : null)
  const attachments = parseAttachments(body)
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const client = await getOpenCodeClient()
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  request.signal.addEventListener('abort', () => {
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
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      try {
        const events = await client.event.subscribe({
          ...OPENCODE_OPTIONS,
          signal: abortController.signal,
        })

        if (resumeSessionAt) {
          const forkedResponse = await client.session.fork({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            body: { messageID: resumeSessionAt },
          })
          targetSessionId = openCodeData<OpenCodeSession>(forkedResponse).id
        }

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`))

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
          for await (const event of events.stream as AsyncGenerator<OpenCodeEvent>) {
            const eventSessionId = openCodeEventSessionId(event)
            if (eventSessionId && eventSessionId !== targetSessionId) continue

            if (event.type === 'message.updated' && event.properties.info.role === 'assistant') {
              const usage = mapOpenCodeContextUsage(event.properties.info)
              if (usage) {
                controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
              }
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

        await client.session.promptAsync({
          ...OPENCODE_OPTIONS,
          path: { id: targetSessionId },
          body: {
            model: selectedModel ?? undefined,
            parts: buildOpenCodeParts(userMessage, attachments),
          },
        })

        await consumeEvents
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        abortController.abort()
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
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function createCopilotStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const selectedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null
  const effort = parseEffort(body)
  const attachments = buildCopilotAttachments(parseAttachments(body))
  const client = await getCopilotClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let session: Awaited<ReturnType<typeof resumeCopilotSession>> | null = null
      let closed = false
      let emittedError = false

      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      try {
        const models = await client.listModels().catch(() => [] as CopilotModelInfo[])
        const modelsById = new Map(models.map((model) => [model.id, model]))

        const handleEvent = (event: CopilotSessionEvent) => {
          if (closed) return
          if (event.type === 'assistant.usage') {
            const usage = mapCopilotUsageToContextUsage(event, modelsById)
            controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
          }

          if (event.type === 'session.error') {
            emittedError = true
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: event.data.message })}\n\n`))
            return
          }

          controller.enqueue(encoder.encode(`data: ${formatCopilotEvent(event)}\n\n`))
        }

        session = await resumeCopilotSession(sessionId, {
          disableResume: false,
          streaming: true,
          onEvent: handleEvent,
        })

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`))

        setRunningSession(sessionId, {
          provider: 'copilot',
          interrupt: () => session?.abort() ?? Promise.resolve(),
        })

        request.signal.addEventListener('abort', () => {
          const running = getRunningSession(sessionId)
          if (running?.provider === 'copilot') {
            void running.interrupt().catch(() => {})
          }
        })

        const copilotEffort = effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
          ? effort
          : undefined

        if (selectedModel || copilotEffort) {
          const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }))
          const nextModel = selectedModel ?? current.modelId
          if (nextModel && (current.modelId !== nextModel || copilotEffort)) {
            await session.setModel(nextModel, copilotEffort ? { reasoningEffort: copilotEffort } : undefined)
          }
        }

        await session.sendAndWait({ prompt: userMessage, attachments: attachments.length > 0 ? attachments : undefined }, 300_000)
      } catch (err) {
        if (!emittedError) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        clearRunningSession(sessionId)
        await session?.disconnect().catch(() => {})
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function createPiStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
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

        request.signal.addEventListener('abort', () => {
          const running = getRunningSession(sessionId)
          if (running?.provider === 'pi') {
            void running.interrupt().catch(() => {})
          }
        })

        unsubscribePi = agentSession.agent.subscribe((event) => {
          if (closed) return
          const payload = JSON.stringify({ type: 'pi_event', event })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))

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
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
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
    return createCodexStream(params.sessionId, params.request, params.body)
  }
  if (provider === 'opencode') {
    return createOpenCodeStream(params.sessionId, params.request, params.body)
  }
  if (provider === 'copilot') {
    return createCopilotStream(params.sessionId, params.request, params.body)
  }
  if (provider === 'pi') {
    return createPiStream(params.sessionId, params.request, params.body)
  }

  return createClaudeStream(params.sessionId, params.request, params.body)
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
    return { sessionId: newId }
  }

  const result = await forkSession(sessionId, {
    title: typeof body.title === 'string' ? body.title : undefined,
    upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
  })
  return { sessionId: result.sessionId }
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
    const session = await resumeCopilotSession(sessionId)
    try {
      const [models, currentModel] = await Promise.all([
        client.listModels(),
        session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      ])
      return {
        models: mapCopilotModelsToSessionModels(models),
        currentModel: currentModel.modelId ?? null,
        contextUsage: null,
      }
    } finally {
      await session.disconnect().catch(() => {})
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

export async function readViewSessionDiagnostics(sessionId: string, providerOverride?: AgentProvider): Promise<{ sections: SessionDiagnosticSection[]; currentModel: string | null }> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    const [thread, resume, mcpServers, features, skills, apps] = await Promise.all([
      readCodexThread(sessionId, false),
      resumeCodexThread(sessionId),
      client.request<CodexMcpServerListResponse>('mcpServerStatus/list', {}),
      client.request<CodexExperimentalFeatureListResponse>('experimentalFeature/list', {}),
      client.request<{ data: Array<{ cwd: string; skills: Array<{ name?: string; description?: string }>; errors?: string[] }> }>('skills/list', {}),
      client.request<CodexAppsListResponse>('app/list', {}),
    ])

    return {
      sections: mapCodexDiagnosticsToSections({
        thread,
        currentModel: resume.model,
        mcpServers: mcpServers.data,
        features: features.data,
        skills: skills.data,
        apps: apps.data,
      }),
      currentModel: resume.model,
    }
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const query = openCodeDirectoryQuery(session)
    const [providers, commands, agents, lsp, formatters, mcp, messages, children] = await Promise.all([
      client.config.providers({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.command.list({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.app.agents({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.lsp.status({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.formatter.status({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.mcp.status({
        ...OPENCODE_OPTIONS,
        query,
      }),
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
        providers: openCodeData<OpenCodeConfigProvidersResponse>(providers),
        commands: openCodeData<OpenCodeCommand[]>(commands),
        agents: openCodeData<OpenCodeAgent[]>(agents),
        lsp: openCodeData<OpenCodeLspStatus[]>(lsp),
        formatters: openCodeData<OpenCodeFormatterStatus[]>(formatters),
        mcp: openCodeData<Record<string, OpenCodeMcpStatus>>(mcp),
        children: openCodeData<OpenCodeSession[]>(children),
        currentSession: session,
      }),
    }
  }
  if (provider === 'copilot') {
    const client = await getCopilotClient()
    const [metadata, session, status, auth] = await Promise.all([
      findCopilotSessionMetadata(sessionId),
      resumeCopilotSession(sessionId),
      client.getStatus().catch(() => ({ version: 'unknown', protocolVersion: 0 }) as CopilotGetStatusResponse),
      client.getAuthStatus().catch(() => ({
        isAuthenticated: false,
        statusMessage: 'Authentication status unavailable',
      }) as CopilotGetAuthStatusResponse),
    ])

    try {
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
    } finally {
      await session.disconnect().catch(() => {})
    }
  }
  if (provider === 'pi') {
    const messages = getPiSessionMessages(sessionId)
    let currentModel: string | undefined
    let thinkingLevel: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role: string; model?: string; thinking?: boolean }
      if (msg.role === 'assistant') {
        currentModel ??= msg.model
        if (thinkingLevel === undefined && msg.thinking !== undefined) {
          thinkingLevel = msg.thinking ? 'enabled' : 'off'
        }
        if (currentModel && thinkingLevel !== undefined) break
      }
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
    await q.initializationResult()
    const [commands, agents, mcpServers, contextUsage, subagents] = await Promise.all([
      q.supportedCommands(),
      q.supportedAgents(),
      q.mcpServerStatus(),
      q.getContextUsage().catch(() => null),
      listSubagents(sessionId).catch(() => [] as string[]),
    ])
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

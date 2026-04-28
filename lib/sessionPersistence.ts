import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isAgentProvider } from './provider'
import { normalizeProjectPath, pathBasename, sameProjectPath } from './projectPaths'
import type { AgentProvider, ApiMessage, ContentBlock, Session, SessionMessage, SystemMessagePayload } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INDEX_DIR = path.join(DATA_DIR, 'session-index')
const MESSAGE_DIR = path.join(INDEX_DIR, 'messages')
const SESSIONS_FILE = path.join(INDEX_DIR, 'sessions.json')
const STORE_VERSION = 1
const MAX_INDEX_TEXT_CHARS = 32_000
const MAX_FIELD_TEXT_CHARS = 2_000
const MAX_SNIPPET_CHARS = 260

export type PersistedSessionRecord = {
  key: string
  provider: AgentProvider
  sessionId: string
  title: string
  summary?: string
  customTitle?: string
  firstPrompt?: string
  cwd?: string
  tag?: string | null
  createdAt?: string | number
  lastModified?: number
  messageCount: number
  userMessages: number
  assistantMessages: number
  systemMessages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  firstMessageAt: number | null
  lastMessageAt: number | null
  indexedAt: number
}

export type PersistedMessageRecord = {
  key: string
  sessionKey: string
  provider: AgentProvider
  sessionId: string
  uuid: string
  type: SessionMessage['type']
  timestamp?: string
  timestampMs: number | null
  turnId?: string
  originKind?: string
  text: string
  toolNames: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type PersistedSearchMatch = {
  messageKey: string
  uuid: string
  type: SessionMessage['type']
  timestamp?: string
  timestampMs: number | null
  snippet: string
  toolNames: string[]
  score: number
}

export type PersistedSearchResult = {
  session: PersistedSessionRecord
  score: number
  matches: PersistedSearchMatch[]
}

export type PersistedSearchResponse = {
  query: string
  total: number
  results: PersistedSearchResult[]
}

export type PersistedIndexStats = {
  sessions: number
  messages: number
  firstMessageAt: number | null
  lastMessageAt: number | null
  lastIndexedAt: number | null
  roles: Record<SessionMessage['type'], number>
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  providers: Array<{ provider: AgentProvider; sessions: number; messages: number }>
  projects: Array<{ cwd: string; name: string; sessions: number; messages: number }>
  topTools: Array<{ name: string; count: number }>
}

export type PersistedIndexFilters = {
  provider?: AgentProvider | 'all'
  dir?: string
  includeWorktrees?: boolean
}

export type PersistedSearchParams = PersistedIndexFilters & {
  query: string
  limit?: number
  role?: SessionMessage['type']
}

type SessionStore = {
  version: number
  sessions: Record<string, PersistedSessionRecord>
}

type MessageStore = {
  version: number
  sessionKey: string
  provider: AgentProvider
  sessionId: string
  signature: string
  indexedAt: number
  messages: PersistedMessageRecord[]
}

type MessageAggregate = Pick<
  PersistedSessionRecord,
  | 'messageCount'
  | 'userMessages'
  | 'assistantMessages'
  | 'systemMessages'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'firstMessageAt'
  | 'lastMessageAt'
  | 'indexedAt'
>

let sessionStoreQueue: Promise<void> = Promise.resolve()
const messageSignatureCache = new Map<string, string>()

function persistenceDisabled(): boolean {
  return process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX === '1'
}

export function persistedSessionKey(provider: AgentProvider | undefined, sessionId: string): string {
  return `${provider ?? 'claude'}:${sessionId}`
}

function messageFilePath(key: string): string {
  return path.join(MESSAGE_DIR, `${Buffer.from(key).toString('base64url')}.json`)
}

async function ensureIndexDirs(): Promise<void> {
  await mkdir(MESSAGE_DIR, { recursive: true })
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmpPath, filePath)
}

async function readSessionStore(): Promise<SessionStore> {
  try {
    const raw = await readFile(SESSIONS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SessionStore>
    if (parsed.version !== STORE_VERSION || !parsed.sessions || typeof parsed.sessions !== 'object') {
      return { version: STORE_VERSION, sessions: {} }
    }
    const sessions: Record<string, PersistedSessionRecord> = {}
    for (const [key, value] of Object.entries(parsed.sessions)) {
      const record = normalizeStoredSession(value)
      if (record) sessions[key] = record
    }
    return { version: STORE_VERSION, sessions }
  } catch {
    return { version: STORE_VERSION, sessions: {} }
  }
}

function normalizeStoredSession(value: unknown): PersistedSessionRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const provider = isAgentProvider(record.provider) ? record.provider : null
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
  const key = typeof record.key === 'string' ? record.key : provider && sessionId ? persistedSessionKey(provider, sessionId) : null
  if (!provider || !sessionId || !key) return null
  return {
    key,
    provider,
    sessionId,
    title: typeof record.title === 'string' ? record.title : sessionId,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    customTitle: typeof record.customTitle === 'string' ? record.customTitle : undefined,
    firstPrompt: typeof record.firstPrompt === 'string' ? record.firstPrompt : undefined,
    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
    tag: typeof record.tag === 'string' ? record.tag : record.tag === null ? null : undefined,
    createdAt: typeof record.createdAt === 'string' || typeof record.createdAt === 'number' ? record.createdAt : undefined,
    lastModified: typeof record.lastModified === 'number' ? record.lastModified : undefined,
    messageCount: toFiniteNumber(record.messageCount),
    userMessages: toFiniteNumber(record.userMessages),
    assistantMessages: toFiniteNumber(record.assistantMessages),
    systemMessages: toFiniteNumber(record.systemMessages),
    inputTokens: toFiniteNumber(record.inputTokens),
    outputTokens: toFiniteNumber(record.outputTokens),
    cacheReadTokens: toFiniteNumber(record.cacheReadTokens),
    cacheWriteTokens: toFiniteNumber(record.cacheWriteTokens),
    firstMessageAt: toNullableTimestamp(record.firstMessageAt),
    lastMessageAt: toNullableTimestamp(record.lastMessageAt),
    indexedAt: toFiniteNumber(record.indexedAt),
  }
}

async function updateSessionStore(fn: (store: SessionStore) => boolean): Promise<void> {
  const run = sessionStoreQueue.then(async () => {
    const store = await readSessionStore()
    if (!fn(store)) return
    await writeJsonFile(SESSIONS_FILE, store)
  })
  sessionStoreQueue = run.catch(() => {})
  await run
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toNullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function timestampMs(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sessionTitle(session: Session): string {
  return (
    session.customTitle ??
    session.summary ??
    (typeof session.firstPrompt === 'string' ? session.firstPrompt.slice(0, 120) : undefined) ??
    session.sessionId
  )
}

function normalizeSession(session: Session, existing?: PersistedSessionRecord): PersistedSessionRecord {
  const provider = session.provider ?? 'claude'
  const key = persistedSessionKey(provider, session.sessionId)
  return {
    key,
    provider,
    sessionId: session.sessionId,
    title: sessionTitle(session),
    summary: typeof session.summary === 'string' ? session.summary : undefined,
    customTitle: typeof session.customTitle === 'string' ? session.customTitle : undefined,
    firstPrompt: typeof session.firstPrompt === 'string' ? session.firstPrompt : undefined,
    cwd: typeof session.cwd === 'string' ? normalizeProjectPath(session.cwd) : undefined,
    tag: typeof session.tag === 'string' ? session.tag : session.tag === null ? null : undefined,
    createdAt: typeof session.createdAt === 'string' || typeof session.createdAt === 'number' ? session.createdAt : undefined,
    lastModified: typeof session.lastModified === 'number' ? session.lastModified : undefined,
    messageCount: existing?.messageCount ?? 0,
    userMessages: existing?.userMessages ?? 0,
    assistantMessages: existing?.assistantMessages ?? 0,
    systemMessages: existing?.systemMessages ?? 0,
    inputTokens: existing?.inputTokens ?? 0,
    outputTokens: existing?.outputTokens ?? 0,
    cacheReadTokens: existing?.cacheReadTokens ?? 0,
    cacheWriteTokens: existing?.cacheWriteTokens ?? 0,
    firstMessageAt: existing?.firstMessageAt ?? null,
    lastMessageAt: existing?.lastMessageAt ?? null,
    indexedAt: existing?.indexedAt ?? Date.now(),
  }
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function syncPersistedSessions(sessions: Session[]): Promise<void> {
  if (persistenceDisabled() || sessions.length === 0) return
  await ensureIndexDirs()
  await updateSessionStore((store) => {
    let changed = false
    for (const session of sessions) {
      const provider = session.provider ?? 'claude'
      const key = persistedSessionKey(provider, session.sessionId)
      const next = normalizeSession(session, store.sessions[key])
      if (!recordsEqual(store.sessions[key], next)) {
        next.indexedAt = Date.now()
        store.sessions[key] = next
        changed = true
      }
    }
    return changed
  })
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function looksLikeLargeEncodedBlob(value: string): boolean {
  if (value.length < 512) return false
  return /^[A-Za-z0-9+/=_-]+$/.test(value) && value.length % 4 === 0
}

function collectToolInputText(input: unknown, depth = 0): string[] {
  if (depth > 2 || input == null) return []
  if (typeof input === 'string') {
    if (looksLikeLargeEncodedBlob(input)) return []
    return [truncateText(input, MAX_FIELD_TEXT_CHARS)]
  }
  if (typeof input === 'number' || typeof input === 'boolean') return [String(input)]
  if (Array.isArray(input)) return input.flatMap((item) => collectToolInputText(item, depth + 1))
  if (typeof input !== 'object') return []

  const parts: string[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes('base64') || lowerKey.includes('image') || lowerKey === 'data') continue
    const child = collectToolInputText(value, depth + 1)
    if (child.length > 0) parts.push(`${key}: ${child.join(' ')}`)
  }
  return parts
}

function collectBlockText(blocks: ContentBlock[], toolNames: Set<string>): string[] {
  const parts: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(block.thinking)
      continue
    }
    if (block.type === 'tool_result') {
      if (typeof block.content === 'string') parts.push(block.content)
      else if (Array.isArray(block.content)) parts.push(...collectBlockText(block.content, toolNames))
      continue
    }
    if (block.type === 'tool_use') {
      if (typeof block.name === 'string' && block.name) {
        toolNames.add(block.name)
        parts.push(block.name)
      }
      parts.push(...collectToolInputText(block.input))
      continue
    }
    if (block.type !== 'image') {
      parts.push(...collectToolInputText(block))
    }
  }
  return parts
}

function extractMessageText(message: SessionMessage): { text: string; toolNames: string[] } {
  const toolNames = new Set<string>()
  const payload = message.message
  const parts: string[] = []

  if ((payload as SystemMessagePayload).type === 'system') {
    const system = payload as SystemMessagePayload
    parts.push(system.subtype)
    if (typeof system.content === 'string') parts.push(system.content)
  } else {
    const api = payload as ApiMessage
    if (typeof api.content === 'string') {
      parts.push(api.content)
    } else if (Array.isArray(api.content)) {
      parts.push(...collectBlockText(api.content, toolNames))
    }
  }

  return {
    text: truncateText(parts.filter(Boolean).join('\n'), MAX_INDEX_TEXT_CHARS),
    toolNames: [...toolNames].sort((a, b) => a.localeCompare(b)),
  }
}

function usageFromMessage(message: SessionMessage): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
} {
  const payload = message.message as Partial<ApiMessage>
  const usage = payload.usage
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  }
}

function messageSignature(provider: AgentProvider, messages: SessionMessage[]): string {
  const last = messages.at(-1)
  if (!last) return `${provider}:0`
  return [
    provider,
    messages.length,
    last.uuid,
    last.type,
    last.timestamp ?? '',
    last.turnId ?? '',
  ].join(':')
}

function mapPersistedMessages(provider: AgentProvider, sessionId: string, messages: SessionMessage[]): PersistedMessageRecord[] {
  const sessionKey = persistedSessionKey(provider, sessionId)
  return messages.map((message) => {
    const extracted = extractMessageText(message)
    const usage = usageFromMessage(message)
    const uuid = message.uuid || `${message.type}:${message.timestamp ?? ''}`
    return {
      key: `${sessionKey}:${uuid}`,
      sessionKey,
      provider,
      sessionId,
      uuid,
      type: message.type,
      timestamp: message.timestamp,
      timestampMs: timestampMs(message.timestamp),
      turnId: message.turnId,
      originKind: message.origin?.kind,
      text: extracted.text,
      toolNames: extracted.toolNames,
      ...usage,
    }
  })
}

function aggregateMessages(messages: PersistedMessageRecord[], indexedAt: number): MessageAggregate {
  let firstMessageAt: number | null = null
  let lastMessageAt: number | null = null
  const aggregate: MessageAggregate = {
    messageCount: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    firstMessageAt,
    lastMessageAt,
    indexedAt,
  }

  for (const message of messages) {
    if (message.type === 'user') aggregate.userMessages += 1
    else if (message.type === 'assistant') aggregate.assistantMessages += 1
    else aggregate.systemMessages += 1

    aggregate.inputTokens += message.inputTokens
    aggregate.outputTokens += message.outputTokens
    aggregate.cacheReadTokens += message.cacheReadTokens
    aggregate.cacheWriteTokens += message.cacheWriteTokens

    if (message.timestampMs !== null) {
      firstMessageAt = firstMessageAt === null ? message.timestampMs : Math.min(firstMessageAt, message.timestampMs)
      lastMessageAt = lastMessageAt === null ? message.timestampMs : Math.max(lastMessageAt, message.timestampMs)
    }
  }

  aggregate.firstMessageAt = firstMessageAt
  aggregate.lastMessageAt = lastMessageAt
  return aggregate
}

export async function syncPersistedSessionMessages(
  provider: AgentProvider,
  sessionId: string,
  messages: SessionMessage[],
): Promise<void> {
  if (persistenceDisabled()) return
  const sessionKey = persistedSessionKey(provider, sessionId)
  const signature = messageSignature(provider, messages)
  if (messageSignatureCache.get(sessionKey) === signature) return

  await ensureIndexDirs()
  const filePath = messageFilePath(sessionKey)
  try {
    const raw = await readFile(filePath, 'utf8')
    const existing = JSON.parse(raw) as Partial<MessageStore>
    if (existing.signature === signature) {
      messageSignatureCache.set(sessionKey, signature)
      return
    }
  } catch {
    // Missing or unreadable message files are rebuilt below.
  }

  const indexedAt = Date.now()
  const persistedMessages = mapPersistedMessages(provider, sessionId, messages)
  const aggregate = aggregateMessages(persistedMessages, indexedAt)
  const store: MessageStore = {
    version: STORE_VERSION,
    sessionKey,
    provider,
    sessionId,
    signature,
    indexedAt,
    messages: persistedMessages,
  }

  await writeJsonFile(filePath, store)
  messageSignatureCache.set(sessionKey, signature)

  await updateSessionStore((sessionStore) => {
    const existing = sessionStore.sessions[sessionKey]
    const next: PersistedSessionRecord = {
      key: sessionKey,
      provider,
      sessionId,
      title: existing?.title ?? sessionId,
      summary: existing?.summary,
      customTitle: existing?.customTitle,
      firstPrompt: existing?.firstPrompt,
      cwd: existing?.cwd,
      tag: existing?.tag,
      createdAt: existing?.createdAt,
      lastModified: existing?.lastModified,
      ...aggregate,
    }
    if (recordsEqual(existing, next)) return false
    sessionStore.sessions[sessionKey] = next
    return true
  })
}

async function readMessageStore(sessionKey: string): Promise<MessageStore | null> {
  try {
    const raw = await readFile(messageFilePath(sessionKey), 'utf8')
    const parsed = JSON.parse(raw) as Partial<MessageStore>
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.messages)) return null
    if (!parsed.sessionKey || !isAgentProvider(parsed.provider) || !parsed.sessionId) return null
    return parsed as MessageStore
  } catch {
    return null
  }
}

function matchesFilters(session: PersistedSessionRecord, filters: PersistedIndexFilters): boolean {
  if (filters.provider && filters.provider !== 'all' && session.provider !== filters.provider) return false
  const dir = normalizeProjectPath(filters.dir)
  if (!dir) return true
  const cwd = normalizeProjectPath(session.cwd)
  if (!cwd) return false
  return filters.includeWorktrees === false ? cwd === dir : sameProjectPath(dir, cwd)
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function metadataText(session: PersistedSessionRecord): string {
  return [
    session.title,
    session.summary,
    session.customTitle,
    session.firstPrompt,
    session.cwd,
    session.tag,
    session.provider,
    session.sessionId,
  ].filter(Boolean).join('\n')
}

function scoreText(text: string, normalizedQuery: string, terms: string[]): number {
  const lower = text.toLowerCase()
  const phraseIndex = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (phraseIndex >= 0) return 1000 - Math.min(phraseIndex, 500)
  if (terms.length > 1 && terms.every((term) => lower.includes(term))) return 600
  const matchedTerms = terms.filter((term) => lower.includes(term)).length
  return matchedTerms > 0 ? 120 * matchedTerms : -1
}

function snippetForText(text: string, normalizedQuery: string, terms: string[]): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const lower = collapsed.toLowerCase()
  let index = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (index < 0) {
    index = terms
      .map((term) => lower.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  }
  const start = Math.max(0, index - Math.floor(MAX_SNIPPET_CHARS / 3))
  const end = Math.min(collapsed.length, start + MAX_SNIPPET_CHARS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < collapsed.length ? '...' : ''
  return `${prefix}${collapsed.slice(start, end)}${suffix}`
}

function emptyStats(): PersistedIndexStats {
  return {
    sessions: 0,
    messages: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    lastIndexedAt: null,
    roles: { user: 0, assistant: 0, system: 0 },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    providers: [],
    projects: [],
    topTools: [],
  }
}

export async function searchPersistedSessions(params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  if (persistenceDisabled()) return { query: params.query, total: 0, results: [] }
  const query = params.query.trim()
  if (!query) return { query, total: 0, results: [] }

  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const normalizedQuery = query.toLowerCase()
  const terms = tokenizeQuery(query)
  const sessionStore = await readSessionStore()
  const sessions = Object.values(sessionStore.sessions).filter((session) => matchesFilters(session, params))

  const results: PersistedSearchResult[] = []
  await Promise.all(sessions.map(async (session) => {
    let score = scoreText(metadataText(session), normalizedQuery, terms)
    const matches: PersistedSearchMatch[] = []
    const messageStore = await readMessageStore(session.key)

    if (messageStore) {
      for (const message of messageStore.messages) {
        if (params.role && message.type !== params.role) continue
        const messageScore = scoreText(message.text, normalizedQuery, terms)
        if (messageScore < 0) continue
        matches.push({
          messageKey: message.key,
          uuid: message.uuid,
          type: message.type,
          timestamp: message.timestamp,
          timestampMs: message.timestampMs,
          snippet: snippetForText(message.text, normalizedQuery, terms),
          toolNames: message.toolNames,
          score: messageScore,
        })
        score = Math.max(score, messageScore)
      }
    }

    if (score < 0 && matches.length === 0) return
    results.push({
      session,
      score: Math.max(score, 0) + matches.length * 15,
      matches: matches.sort((a, b) => b.score - a.score || (b.timestampMs ?? 0) - (a.timestampMs ?? 0)).slice(0, 5),
    })
  }))

  const sorted = results.sort((a, b) => b.score - a.score || (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0))
  return {
    query,
    total: sorted.length,
    results: sorted.slice(0, limit),
  }
}

export async function readPersistedIndexStats(filters: PersistedIndexFilters = {}): Promise<PersistedIndexStats> {
  if (persistenceDisabled()) return emptyStats()
  const sessionStore = await readSessionStore()
  const sessions = Object.values(sessionStore.sessions).filter((session) => matchesFilters(session, filters))
  if (sessions.length === 0) return emptyStats()

  const stats = emptyStats()
  stats.sessions = sessions.length
  const providerCounts = new Map<AgentProvider, { provider: AgentProvider; sessions: number; messages: number }>()
  const projectCounts = new Map<string, { cwd: string; name: string; sessions: number; messages: number }>()
  const toolCounts = new Map<string, number>()

  for (const session of sessions) {
    const providerBucket = providerCounts.get(session.provider) ?? { provider: session.provider, sessions: 0, messages: 0 }
    providerBucket.sessions += 1
    providerCounts.set(session.provider, providerBucket)

    const cwd = normalizeProjectPath(session.cwd) || '(unknown)'
    const projectBucket = projectCounts.get(cwd) ?? { cwd, name: pathBasename(cwd) || cwd, sessions: 0, messages: 0 }
    projectBucket.sessions += 1
    projectCounts.set(cwd, projectBucket)

    stats.lastIndexedAt = stats.lastIndexedAt === null ? session.indexedAt : Math.max(stats.lastIndexedAt, session.indexedAt)
  }

  const stores = await Promise.all(sessions.map((session) => readMessageStore(session.key)))
  for (const store of stores) {
    if (!store) continue
    const session = sessionStore.sessions[store.sessionKey]
    if (!session) continue

    const providerBucket = providerCounts.get(session.provider)
    const cwd = normalizeProjectPath(session.cwd) || '(unknown)'
    const projectBucket = projectCounts.get(cwd)
    if (providerBucket) providerBucket.messages += store.messages.length
    if (projectBucket) projectBucket.messages += store.messages.length

    for (const message of store.messages) {
      stats.messages += 1
      stats.roles[message.type] += 1
      stats.tokens.input += message.inputTokens
      stats.tokens.output += message.outputTokens
      stats.tokens.cacheRead += message.cacheReadTokens
      stats.tokens.cacheWrite += message.cacheWriteTokens
      if (message.timestampMs !== null) {
        stats.firstMessageAt = stats.firstMessageAt === null ? message.timestampMs : Math.min(stats.firstMessageAt, message.timestampMs)
        stats.lastMessageAt = stats.lastMessageAt === null ? message.timestampMs : Math.max(stats.lastMessageAt, message.timestampMs)
      }
      for (const toolName of message.toolNames) {
        toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1)
      }
    }
  }

  stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite
  stats.providers = [...providerCounts.values()].sort((a, b) => b.messages - a.messages || b.sessions - a.sessions)
  stats.projects = [...projectCounts.values()].sort((a, b) => b.messages - a.messages || b.sessions - a.sessions).slice(0, 25)
  stats.topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20)

  return stats
}

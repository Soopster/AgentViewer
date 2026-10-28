import type { AgentProvider, SessionMessage } from '../types'
import type { FileEditKind } from '../provenanceExtract'

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
  errorTools: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  model?: string | null
  /** A prompt the user (or a host on their behalf) sent, not a tool result or a subagent's brief. */
  isPrompt?: boolean
  fileEdits: PersistedFileEdit[]
}

// One file-modifying tool call, as stored on the message that issued it.
// `prompt` is the user prompt that started the turn — captured at index time
// because reconstructing it later can't distinguish prompts from tool results.
export type PersistedFileEdit = {
  tool: string
  kind: FileEditKind
  filePath: string
  addedLines: string[]
  prompt: string | null
}

// A file_edits row joined with its owning session, ready for attribution.
export type PersistedFileEditRecord = {
  id: number
  sessionKey: string
  provider: AgentProvider
  sessionId: string
  messageUuid: string
  timestampMs: number | null
  tool: string
  kind: FileEditKind
  filePath: string
  addedLines: string[]
  prompt: string | null
  model: string | null
  sessionTitle: string | null
  sessionCwd: string | null
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
  messagesOnly?: boolean
  toolName?: string
}

export type Row = Record<string, unknown>
// Common synchronous surface of node:sqlite and bun:sqlite.
export type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): { all(...params: unknown[]): Row[]; get(...params: unknown[]): Row | undefined; run(...params: unknown[]): unknown }
  close(): void
}

/** Read-only query capability; the facade supplies worker execution and fallback. */
export type IndexReader = (sql: string, params: unknown[]) => Promise<Row[]>

export type PersistedActivityPrompt = {
  sessionKey: string
  timestampMs: number
  text: string
}

export type PersistedActivityEdit = {
  sessionKey: string
  timestampMs: number
  filePath: string
  kind: string
  prompt: string | null
}

export type PersistedActivity = {
  /** Sessions with any activity in the range, newest first. */
  sessions: PersistedSessionRecord[]
  prompts: PersistedActivityPrompt[]
  edits: PersistedActivityEdit[]
}

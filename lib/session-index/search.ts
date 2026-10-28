import { isAgentProvider } from '../provider'
import { normalizeProjectPath } from '../projectPaths'
import type { SessionMessage } from '../types'
import { optionalString, toFiniteNumber, toNullableTimestamp, messageType, chunkArray } from './rows'
import { rowToSessionRecord } from './sessionRecords'
import { selectFilteredSessions } from './sessionQueries'
import type { IndexReader, Row, PersistedSessionRecord, PersistedMessageRecord, PersistedSearchParams, PersistedSearchResponse, PersistedSearchResult } from './types'

const MAX_SNIPPET_CHARS = 260
const SHORT_QUERY_TERM_WINDOW = 180
const LONG_QUERY_TERM_WINDOW = 500
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'with',
  'you',
])

// Cap candidates across all chunks before scoring/snippet work.
const MESSAGE_CANDIDATE_GLOBAL_LIMIT = 4000

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function meaningfulTerms(terms: string[]): string[] {
  const out: string[] = []
  for (const term of terms) {
    if (term.length <= 2) continue
    if (SEARCH_STOP_WORDS.has(term)) continue
    if (!out.includes(term)) out.push(term)
  }
  return out
}

function termPositions(text: string, term: string): number[] {
  const positions: number[] = []
  let cursor = 0
  while (positions.length < 30) {
    const index = text.indexOf(term, cursor)
    if (index < 0) break
    positions.push(index)
    cursor = index + term.length
  }
  return positions
}

function compactTermWindow(text: string, terms: string[]): number | null {
  const positionsByTerm = terms.map((term) => termPositions(text, term))
  if (positionsByTerm.some((positions) => positions.length === 0)) return null

  let best: number | null = null
  for (const starts of positionsByTerm) {
    for (const start of starts) {
      let end = start
      let valid = true
      for (const positions of positionsByTerm) {
        const next = positions.find((position) => position >= start)
        if (next === undefined) {
          valid = false
          break
        }
        end = Math.max(end, next)
      }
      if (!valid) continue
      const span = end - start
      best = best === null ? span : Math.min(best, span)
    }
  }
  return best
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

function scoreText(text: string, normalizedQuery: string, terms: string[], usefulTerms: string[]): number {
  const lower = text.toLowerCase()
  const phraseIndex = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (phraseIndex >= 0) return 1000 - Math.min(phraseIndex, 500)
  if (usefulTerms.length >= 2) {
    const maxWindow = terms.length >= 5 ? LONG_QUERY_TERM_WINDOW : SHORT_QUERY_TERM_WINDOW
    const span = compactTermWindow(lower, usefulTerms)
    if (span === null || span > maxWindow) return -1
    return 760 - Math.min(span, maxWindow)
  }
  if (terms.length >= 5) {
    const span = compactTermWindow(lower, terms)
    if (span === null || span > LONG_QUERY_TERM_WINDOW) return -1
    return 760 - Math.min(span, LONG_QUERY_TERM_WINDOW)
  }
  if (terms.length > 1 && terms.every((term) => lower.includes(term))) return 600
  const matchedTerms = terms.filter((term) => lower.includes(term)).length
  return matchedTerms > 0 ? 120 * matchedTerms : -1
}

function snippetForText(text: string, normalizedQuery: string, terms: string[]): string {
  // Find the match index in the raw text first so we don't pay to collapse
  // whitespace across the entire (possibly very large) message body. Then
  // slice a generous window around it and only collapse within that window.
  const lowerRaw = text.toLowerCase()
  let index = normalizedQuery ? lowerRaw.indexOf(normalizedQuery) : -1
  if (index < 0) {
    index = terms
      .map((term) => lowerRaw.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  }
  // Generous raw window — collapsing whitespace below may shorten this further.
  const rawWindowChars = MAX_SNIPPET_CHARS * 4
  const rawStart = Math.max(0, index - Math.floor(rawWindowChars / 3))
  const rawEnd = Math.min(text.length, rawStart + rawWindowChars)
  const window = text.slice(rawStart, rawEnd)
  const collapsed = window.replace(/\s+/g, ' ').trim()
  const lower = collapsed.toLowerCase()
  let snippetIndex = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (snippetIndex < 0) {
    snippetIndex = terms
      .map((term) => lower.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  }
  const start = Math.max(0, snippetIndex - Math.floor(MAX_SNIPPET_CHARS / 3))
  const end = Math.min(collapsed.length, start + MAX_SNIPPET_CHARS)
  const prefix = rawStart > 0 || start > 0 ? '...' : ''
  const suffix = rawEnd < text.length || end < collapsed.length ? '...' : ''
  return `${prefix}${collapsed.slice(start, end)}${suffix}`
}

function rowToMessageRecord(row: Row): PersistedMessageRecord | null {
  const provider = isAgentProvider(row.provider) ? row.provider : null
  const type = messageType(row.type)
  const key = optionalString(row.key)
  const sessionKey = optionalString(row.session_key)
  const sessionId = optionalString(row.session_id)
  const uuid = optionalString(row.uuid)
  if (!provider || !type || !key || !sessionKey || !sessionId || !uuid) return null
  let toolNames: string[] = []
  if (typeof row.tool_names_json === 'string') {
    try {
      const parsed = JSON.parse(row.tool_names_json) as unknown
      if (Array.isArray(parsed)) toolNames = parsed.filter((name): name is string => typeof name === 'string')
    } catch {
      toolNames = []
    }
  }
  return {
    key,
    sessionKey,
    provider,
    sessionId,
    uuid,
    type,
    timestamp: optionalString(row.timestamp),
    timestampMs: toNullableTimestamp(row.timestamp_ms),
    turnId: optionalString(row.turn_id),
    originKind: optionalString(row.origin_kind),
    text: optionalString(row.text) ?? '',
    toolNames,
    errorTools: [],
    inputTokens: toFiniteNumber(row.input_tokens),
    outputTokens: toFiniteNumber(row.output_tokens),
    cacheReadTokens: toFiniteNumber(row.cache_read_tokens),
    cacheWriteTokens: toFiniteNumber(row.cache_write_tokens),
    model: optionalString(row.model) ?? null,
    // Read-side rows never round-trip back into insertMessages; edits live in
    // their own table and are queried via readFileEditsFor*.
    fileEdits: [],
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

async function selectSessionsByKeys(readRows: IndexReader, keys: string[]): Promise<PersistedSessionRecord[]> {
  if (keys.length === 0) return []
  const records: PersistedSessionRecord[] = []
  for (const chunk of chunkArray(keys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const sql = `SELECT * FROM sessions WHERE key IN (${placeholders})`
    const rows = await readRows(sql, chunk)
    for (const row of rows) {
      const session = rowToSessionRecord(row)
      if (session) records.push(session)
    }
  }
  return records
}

async function selectMessageCandidatesGlobal(
  readRows: IndexReader,
  normalizedQuery: string,
  role?: SessionMessage['type'],
  toolName?: string,
): Promise<PersistedMessageRecord[]> {
  if (!normalizedQuery) return []
  const clauses: string[] = []
  const queryParams: unknown[] = []
  if (role) {
    clauses.push('m.type = ?')
    queryParams.push(role)
  }
  if (toolName) {
    clauses.push('EXISTS (SELECT 1 FROM message_tools mt WHERE mt.message_key = m.key AND mt.name = ?)')
    queryParams.push(toolName)
  }
  clauses.push("m.text LIKE ? ESCAPE '\\' COLLATE NOCASE")
  queryParams.push(`%${escapeLike(normalizedQuery)}%`)
  queryParams.push(MESSAGE_CANDIDATE_GLOBAL_LIMIT)
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
  const sql = `
    SELECT m.*
    FROM messages m
    ${where}
    ORDER BY m.timestamp_ms DESC
    LIMIT ?
  `
  const rows = await readRows(sql, queryParams)
  const records: PersistedMessageRecord[] = []
  for (const row of rows) {
    const message = rowToMessageRecord(row)
    if (message) records.push(message)
  }
  return records
}

async function selectMessageCandidates(
  readRows: IndexReader,
  sessionKeys: string[],
  normalizedQuery: string,
  _terms: string[],
  role?: SessionMessage['type'],
  toolName?: string,
): Promise<PersistedMessageRecord[]> {
  if (sessionKeys.length === 0 || !normalizedQuery) return []
  const candidates: PersistedMessageRecord[] = []
  const chunks = chunkArray(sessionKeys, 500)
  let remaining = MESSAGE_CANDIDATE_GLOBAL_LIMIT

  for (const chunk of chunks) {
    if (remaining <= 0) break
    const placeholders = chunk.map(() => '?').join(', ')
    const clauses: string[] = [`m.session_key IN (${placeholders})`]
    const queryParams: unknown[] = [...chunk]
    if (role) {
      clauses.push('m.type = ?')
      queryParams.push(role)
    }
    if (toolName) {
      clauses.push('EXISTS (SELECT 1 FROM message_tools mt WHERE mt.message_key = m.key AND mt.name = ?)')
      queryParams.push(toolName)
    }
    clauses.push("m.text LIKE ? ESCAPE '\\' COLLATE NOCASE")
    queryParams.push(`%${escapeLike(normalizedQuery)}%`)
    queryParams.push(remaining)
    const sql = `
      SELECT m.*
      FROM messages m
      WHERE ${clauses.join(' AND ')}
      ORDER BY m.timestamp_ms DESC
      LIMIT ?
    `
    const rows = await readRows(sql, queryParams)

    for (const row of rows) {
      const message = rowToMessageRecord(row)
      if (message) candidates.push(message)
    }
    remaining -= rows.length
  }

  return candidates
}

export async function queryPersistedSessions(readRows: IndexReader, params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  const query = params.query.trim()
  if (!query) return { query, total: 0, results: [] }

  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const normalizedQuery = query.toLowerCase()
  const terms = tokenizeQuery(query)
  const usefulTerms = meaningfulTerms(terms)
  const messagesOnly = params.messagesOnly === true
  const hasSessionFilter = (params.provider && params.provider !== 'all') || Boolean(normalizeProjectPath(params.dir))

  // Fast path: messagesOnly with no session-narrowing filter — query messages
  // directly, then hydrate only the sessions referenced by matched candidates.
  // Skips loading every session row up front.
  let sessions: PersistedSessionRecord[]
  let candidates: PersistedMessageRecord[]
  if (messagesOnly && !hasSessionFilter) {
    candidates = await selectMessageCandidatesGlobal(readRows, normalizedQuery, params.role, params.toolName)
    const candidateSessionKeys = [...new Set(candidates.map((message) => message.sessionKey))]
    sessions = await selectSessionsByKeys(readRows, candidateSessionKeys)
  } else {
    sessions = await selectFilteredSessions(readRows, params)
    candidates = await selectMessageCandidates(readRows, sessions.map((session) => session.key), normalizedQuery, terms, params.role, params.toolName)
  }
  const sessionByKey = new Map(sessions.map((session) => [session.key, session]))
  const resultsBySession = new Map<string, PersistedSearchResult>()

  if (!messagesOnly) {
    for (const session of sessions) {
      const score = scoreText(metadataText(session), normalizedQuery, terms, usefulTerms)
      if (score >= 0) resultsBySession.set(session.key, { session, score, matches: [] })
    }
  }

  for (const message of candidates) {
    const session = sessionByKey.get(message.sessionKey)
    if (!session) continue
    const messageScore = scoreText(message.text, normalizedQuery, terms, usefulTerms)
    if (messageScore < 0) continue
    const existing = resultsBySession.get(session.key) ?? { session, score: -1, matches: [] }
    existing.score = Math.max(existing.score, messageScore)
    existing.matches.push({
      messageKey: message.key,
      uuid: message.uuid,
      type: message.type,
      timestamp: message.timestamp,
      timestampMs: message.timestampMs,
      snippet: snippetForText(message.text, normalizedQuery, terms),
      toolNames: message.toolNames,
      score: messageScore,
    })
    resultsBySession.set(session.key, existing)
  }

  const sorted = [...resultsBySession.values()]
    .filter((result) => {
      if (messagesOnly) return result.matches.length > 0
      return result.score >= 0 || result.matches.length > 0
    })
    .map((result) => ({
      ...result,
      score: Math.max(result.score, 0) + result.matches.length * 15,
      matches: result.matches
        .sort((a, b) => b.score - a.score || (b.timestampMs ?? 0) - (a.timestampMs ?? 0))
        .slice(0, 5),
    }))
    .sort((a, b) => b.score - a.score || (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0))

  return {
    query,
    total: sorted.length,
    results: sorted.slice(0, limit),
  }
}

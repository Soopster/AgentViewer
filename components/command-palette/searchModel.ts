import type { PersistedSessionRecord } from '@/lib/sessionPersistence'
import type { Session } from '@/lib/types'

import { type HighlightPart } from './types'

export const MESSAGE_SEARCH_SESSION_LIMIT = 32

export const MESSAGE_SEARCH_RESULT_LIMIT = 12

export function sessionTabKey(session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>): string {
  return `${session.providerInstanceId ?? session.provider ?? 'claude'}:${session.sessionId}`
}

export function getSessionTitle(session: Session): string {
  return (
    session.customTitle ??
    session.summary ??
    (typeof session.firstPrompt === 'string' ? session.firstPrompt.slice(0, 56) : undefined) ??
    session.sessionId.slice(-8)
  ) || 'Untitled'
}

export function getSessionKeywords(session: Session): string[] {
  return [
    getSessionTitle(session),
    session.summary ?? '',
    session.customTitle ?? '',
    session.firstPrompt ?? '',
    session.cwd ?? '',
    session.tag ?? '',
    session.provider ?? '',
    session.sessionId,
  ]
}

export function getSessionSortMs(session: Session): number {
  const value = session.lastModified ?? session.createdAt
  if (value == null) return 0
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function sessionFromPersistedRecord(record: PersistedSessionRecord): Session {
  return {
    sessionId: record.sessionId,
    provider: record.provider,
    summary: record.summary ?? record.title,
    customTitle: record.customTitle,
    firstPrompt: record.firstPrompt,
    cwd: record.cwd,
    tag: record.tag,
    createdAt: record.createdAt,
    lastModified: record.lastModified,
  }
}

function scoreMatch(text: string, query: string): number {
  if (!query) return 0
  const normalizedText = text.toLowerCase()
  if (normalizedText === query) return 300
  if (normalizedText.startsWith(query)) return 220 - normalizedText.length / 100
  const index = normalizedText.indexOf(query)
  if (index >= 0) return 160 - index
  const pieces = query.split(/\s+/).filter(Boolean)
  if (pieces.length > 1 && pieces.every((piece) => normalizedText.includes(piece))) return 120
  return -1
}

export function bestScore(fields: string[], query: string): number {
  if (!query) return 0
  let best = -1
  for (const field of fields) {
    const score = scoreMatch(field, query)
    if (score > best) best = score
  }
  return best
}

export function highlightTermsForQuery(query: string): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const terms = [
    normalized,
    ...normalized.split(/[^a-z0-9_./-]+/),
  ]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)

  return [...new Set(terms)].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

export function highlightedSnippetParts(snippet: string, terms: string[]): HighlightPart[] {
  if (terms.length === 0 || !snippet) return [{ text: snippet, highlight: false }]

  const lowerSnippet = snippet.toLowerCase()
  const parts: HighlightPart[] = []
  let cursor = 0

  while (cursor < snippet.length) {
    let matchIndex = -1
    let matchTerm = ''

    for (const term of terms) {
      const index = lowerSnippet.indexOf(term, cursor)
      if (index < 0) continue
      if (matchIndex < 0 || index < matchIndex || (index === matchIndex && term.length > matchTerm.length)) {
        matchIndex = index
        matchTerm = term
      }
    }

    if (matchIndex < 0) break
    if (matchIndex > cursor) parts.push({ text: snippet.slice(cursor, matchIndex), highlight: false })
    parts.push({ text: snippet.slice(matchIndex, matchIndex + matchTerm.length), highlight: true })
    cursor = matchIndex + matchTerm.length
  }

  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), highlight: false })
  return parts.length > 0 ? parts : [{ text: snippet, highlight: false }]
}

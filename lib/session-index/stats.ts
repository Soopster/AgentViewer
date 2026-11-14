import { normalizeProjectPath, pathBasename } from '../projectPaths'
import type { AgentProvider } from '../types'
import { chunkArray, optionalString, toFiniteNumber } from './rows'
import type { SqliteDatabase, Row, PersistedSessionRecord, PersistedIndexStats } from './types'

export function emptyStats(): PersistedIndexStats {
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

export async function queryIndexStats(db: SqliteDatabase, sessions: PersistedSessionRecord[]): Promise<PersistedIndexStats> {
  if (sessions.length === 0) return emptyStats()

  const stats = emptyStats()
  stats.sessions = sessions.length
  const providerCounts = new Map<AgentProvider, { provider: AgentProvider; sessions: number; messages: number }>()
  const projectCounts = new Map<string, { cwd: string; name: string; sessions: number; messages: number }>()
  const toolCounts = new Map<string, number>()

  for (const session of sessions) {
    const providerBucket = providerCounts.get(session.provider) ?? { provider: session.provider, sessions: 0, messages: 0 }
    providerBucket.sessions += 1
    providerBucket.messages += session.messageCount
    providerCounts.set(session.provider, providerBucket)

    const cwd = normalizeProjectPath(session.cwd) || '(unknown)'
    const projectBucket = projectCounts.get(cwd) ?? { cwd, name: pathBasename(cwd) || cwd, sessions: 0, messages: 0 }
    projectBucket.sessions += 1
    projectBucket.messages += session.messageCount
    projectCounts.set(cwd, projectBucket)

    stats.messages += session.messageCount
    stats.roles.user += session.userMessages
    stats.roles.assistant += session.assistantMessages
    stats.roles.system += session.systemMessages
    stats.tokens.input += session.inputTokens
    stats.tokens.output += session.outputTokens
    stats.tokens.cacheRead += session.cacheReadTokens
    stats.tokens.cacheWrite += session.cacheWriteTokens
    if (session.firstMessageAt !== null) {
      stats.firstMessageAt = stats.firstMessageAt === null ? session.firstMessageAt : Math.min(stats.firstMessageAt, session.firstMessageAt)
    }
    if (session.lastMessageAt !== null) {
      stats.lastMessageAt = stats.lastMessageAt === null ? session.lastMessageAt : Math.max(stats.lastMessageAt, session.lastMessageAt)
    }
    stats.lastIndexedAt = stats.lastIndexedAt === null ? session.indexedAt : Math.max(stats.lastIndexedAt, session.indexedAt)
  }

  for (const chunk of chunkArray(sessions.map((session) => session.key), 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT name, COUNT(*) AS count
      FROM message_tools
      WHERE session_key IN (${placeholders})
      GROUP BY name
    `).all(...chunk) as Row[]
    for (const row of rows) {
      const name = optionalString(row.name)
      if (!name) continue
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + toFiniteNumber(row.count))
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

// Claude transcript and session-metadata reads, shared by the Claude adapter
// (lib/adapters/claude.ts) and the restore/send paths in lib/sessionBackend.ts.
//
// The subagent handling is the substance here. Claude's subagents are not
// top-level sessions; they are side transcripts reachable only through the
// session store, and since SDK 0.3.202 each carries a `parent_agent_id`. That
// link is what lets a nested spawn chain render as a tree instead of a flat
// list of anonymous agents, so it is resolved once here and encoded into the
// message origin (`subagent:parent/child`) rather than re-derived per renderer.

import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
} from '@anthropic-ai/claude-agent-sdk'
import { claudeSessionStoreOptions } from './claudeSessionStore'
import { normalizeClaudeHistoryMessages } from './claudeMapper'
import { readMappedMessagesCache, writeMappedMessagesCache } from './mappedMessagesCache'
import { sortMessagesChronologically, withOriginKind } from './adapters/shared'
import type { SessionMessage } from './types'

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
export const SESSION_INFO_TTL = 20_000
export const SESSION_INFO_CACHE_MAX = 640
export type SessionInfoCacheEntry = { result: Awaited<ReturnType<typeof getSessionInfo>>; ts: number }
export const sessionInfoCache = new Map<string, SessionInfoCacheEntry>()

export function pruneSessionInfoCache() {
  const deadline = Date.now() - SESSION_INFO_TTL * 3
  for (const [key, entry] of sessionInfoCache) {
    if (entry.ts < deadline) sessionInfoCache.delete(key)
  }
}

export function touchSessionInfoCache(sessionId: string, entry: SessionInfoCacheEntry): void {
  if (sessionInfoCache.has(sessionId)) sessionInfoCache.delete(sessionId)
  sessionInfoCache.set(sessionId, entry)
  while (sessionInfoCache.size > SESSION_INFO_CACHE_MAX) {
    const oldest = sessionInfoCache.keys().next().value
    if (oldest === undefined) break
    sessionInfoCache.delete(oldest)
  }
}

export async function getCachedSessionInfo(sessionId: string, dir: string | undefined): Promise<Awaited<ReturnType<typeof getSessionInfo>>> {
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

/**
 * Walk parent_agent_id links (SDK 0.3.202+) up to the main loop and return the
 * spawn chain as a `/`-joined path (`parentId/childId`), outermost first.
 * Depth-1 agents (parent null or unknown) return just their own id, preserving
 * the historical `subagent:<agentId>` origin shape.
 */
export function claudeSubagentSpawnPath(agentId: string, parentByAgent: Map<string, string | null>): string {
  const path = [agentId]
  let current = parentByAgent.get(agentId) ?? null
  while (current && !path.includes(current) && path.length < 16) {
    path.unshift(current)
    current = parentByAgent.get(current) ?? null
  }
  return path.join('/')
}

export function claudeSubagentParentId(rawMessages: unknown[]): string | null {
  const first = rawMessages[0] as { parent_agent_id?: string | null } | undefined
  return typeof first?.parent_agent_id === 'string' ? first.parent_agent_id : null
}

/** Indent each subagent under its spawner so the diagnostics list reads as a tree. */
export function formatClaudeSubagentTree(agentIds: string[], parentByAgent: Map<string, string | null>): string[] {
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


export async function readClaudeSessionMessages(sessionId: string): Promise<SessionMessage[]> {
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

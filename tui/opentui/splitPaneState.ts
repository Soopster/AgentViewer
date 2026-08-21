import type { Session } from '../../lib/types'

export type SplitPaneLayout = {
  visibleCount: number
  paneWidth: number
  readerWidth: number
}

export function splitCommandKey(command: string, runningInsideTmux: boolean): string {
  return runningInsideTmux ? '? palette' : `⌃B ${command}`
}

export function calculateSplitPaneLayout({
  readerAreaWidth,
  requestedCount,
  availableCount,
  maxPanes,
  minPaneWidth,
  minReaderWidth,
}: {
  readerAreaWidth: number
  requestedCount: number
  availableCount: number
  maxPanes: number
  minPaneWidth: number
  minReaderWidth: number
}): SplitPaneLayout {
  let visibleCount = Math.min(requestedCount, maxPanes, availableCount)
  let paneWidth = 0
  while (visibleCount > 0) {
    const candidateWidth = Math.floor((readerAreaWidth - visibleCount) / (visibleCount + 1))
    if (
      candidateWidth >= minPaneWidth
      && readerAreaWidth - visibleCount * (candidateWidth + 1) >= minReaderWidth
    ) {
      paneWidth = candidateWidth
      break
    }
    visibleCount -= 1
  }
  return {
    visibleCount,
    paneWidth,
    readerWidth: Math.max(readerAreaWidth - visibleCount * (paneWidth + 1), minReaderWidth),
  }
}

// Reserve the pane-action row whether or not the pane is focused. Focus must
// not resize the scroll viewport: changing its height shifts scrollTop and can
// make the same saved offset show a different set of cards on return.
export function calculateSplitPaneBodyRows(height: number, statusRowCount: number): number {
  const reservedActionRows = 1
  return Math.max(height - 4 - statusRowCount - reservedActionRows, 3)
}

export function preserveArrayIdentity<T>(previous: T[], next: T[]): T[] {
  if (previous === next) return previous
  if (previous.length === next.length && previous.every((item, index) => item === next[index])) {
    return previous
  }
  return next
}

export function groupItemsBySplitPaneKey<T>(
  paneKeys: readonly string[],
  items: readonly T[],
  itemKey: (item: T) => string | null,
  previous: ReadonlyMap<string, T[]>,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>(paneKeys.map((key) => [key, []]))
  for (const item of items) {
    const key = itemKey(item)
    const bucket = key ? grouped.get(key) : undefined
    if (bucket) bucket.push(item)
  }
  for (const [key, bucket] of grouped) {
    const prior = previous.get(key)
    if (prior) grouped.set(key, preserveArrayIdentity(prior, bucket))
  }
  return grouped
}

export function removeSplitPaneKey(pinnedKeys: readonly string[], paneIndex: number): string[] {
  if (paneIndex < 0 || paneIndex >= pinnedKeys.length) return [...pinnedKeys]
  return pinnedKeys.filter((_, index) => index !== paneIndex)
}

/**
 * Synthetic session ids assigned to external MCP coordinator participants.
 * There is no transcript file behind them, so opening one in the reader can
 * only ever show a blank or unrelated session.
 */
export const EXTERNAL_SESSION_PREFIX = 'external:'

export function transcriptSessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

export type CoordinationTranscriptTarget =
  | { kind: 'unreadable'; reason: string }
  | { kind: 'open'; sessionKey: string; session: Session; indexed: boolean }

/**
 * Resolve a coordinator agent to the transcript session the reader should
 * open. Returns the indexed sidebar session when one exists (its list-level
 * metadata like lastModified keeps the reader's mtime guards working), a
 * draft session when the agent's transcript is not indexed yet, or an
 * `unreadable` refusal for agents that have no transcript at all — the caller
 * must surface the reason instead of opening anything.
 */
export function resolveCoordinationTranscriptTarget(
  agent: Pick<ProtocolAgentLike, 'name' | 'role' | 'provider' | 'sessionId' | 'worktreePath'>,
  sessionsByKey: ReadonlyMap<string, Session>,
  now: number,
): CoordinationTranscriptTarget {
  const sessionId = agent.sessionId?.trim() ?? ''
  if (!sessionId) {
    return { kind: 'unreadable', reason: `${agent.name} has no readable transcript: no session recorded` }
  }
  if (sessionId.startsWith(EXTERNAL_SESSION_PREFIX)) {
    return { kind: 'unreadable', reason: `${agent.name} has no readable transcript: external MCP participant` }
  }
  const key = transcriptSessionKey({ sessionId, provider: agent.provider })
  const indexed = sessionsByKey.get(key)
  if (indexed) return { kind: 'open', sessionKey: key, session: indexed, indexed: true }
  return {
    kind: 'open',
    sessionKey: key,
    session: {
      sessionId,
      provider: agent.provider,
      cwd: agent.worktreePath || undefined,
      createdAt: now,
      lastModified: now,
      summary: `${agent.name} · ${agent.role}`,
    },
    indexed: false,
  }
}

type ProtocolAgentLike = {
  name: string
  role: string
  provider?: Session['provider']
  sessionId?: string | null
  worktreePath?: string
}

export function resolveSelectedSessionIndex<S>(
  selectedSessionKey: string | null,
  sessions: readonly S[],
  keyOf: (session: S) => string,
): number {
  if (sessions.length === 0) return -1
  if (!selectedSessionKey) return 0
  return sessions.findIndex((session) => keyOf(session) === selectedSessionKey)
}

/**
 * The reader's session-selection fallback chain: pending open tab first, then
 * the indexed sidebar session, then any open tab matching the key, then the
 * first session. Pinning an un-indexed session as an open tab before selecting
 * it is what keeps the final `sessions[0]` fallback from silently swapping in
 * an unrelated transcript.
 */
export function resolveSelectedSession<S>(
  selectedSessionKey: string | null,
  selectedIndex: number,
  sessions: readonly S[],
  openTabSessions: readonly S[],
  keyOf: (session: S) => string,
  isPending: (session: S) => boolean,
): S | null {
  if (selectedSessionKey) {
    const fromTab = openTabSessions.find((session) => keyOf(session) === selectedSessionKey)
    if (fromTab && isPending(fromTab)) return fromTab
  }
  if (selectedIndex >= 0) return sessions[selectedIndex] ?? null
  if (selectedSessionKey) {
    const fromTab = openTabSessions.find((session) => keyOf(session) === selectedSessionKey)
    if (fromTab) return fromTab
  }
  return sessions[0] ?? null
}

/**
 * Resolve where the composer should send. A freshly-created session is an
 * explicit user target, so it must outrank the convenience fallback that
 * steers a composer toward the provider's sole running turn.
 */
export function resolveComposerTargetSession({
  paneTargetKey,
  preferredTargetKey,
  selectedSession,
  runningSessions,
  sessions,
  openTabSessions,
  keyOf,
}: {
  paneTargetKey: string | null
  preferredTargetKey: string | null
  selectedSession: Session | null
  runningSessions: readonly Pick<Session, 'sessionId' | 'provider'>[]
  sessions: readonly Session[]
  openTabSessions: readonly Session[]
  keyOf: (session: Pick<Session, 'sessionId' | 'provider'>) => string
}): Session | null {
  if (paneTargetKey) {
    const pinned = openTabSessions.find((tab) => keyOf(tab) === paneTargetKey)
    if (pinned) return pinned
  }

  if (selectedSession && preferredTargetKey === keyOf(selectedSession)) {
    return selectedSession
  }

  if (selectedSession) {
    const selectedKey = keyOf(selectedSession)
    if (runningSessions.some((running) => keyOf(running) === selectedKey)) {
      return selectedSession
    }
  }

  if (runningSessions.length === 1) {
    const onlyRunning = runningSessions[0]!
    const runningKey = keyOf(onlyRunning)
    return sessions.find((session) => keyOf(session) === runningKey) ?? {
      sessionId: onlyRunning.sessionId,
      provider: onlyRunning.provider,
    }
  }

  return selectedSession
}

export function isComposerTargetReady({
  preparingTargetKey,
  targetSession,
  keyOf,
}: {
  preparingTargetKey: string | null
  targetSession: Pick<Session, 'sessionId' | 'provider'> | null
  keyOf: (session: Pick<Session, 'sessionId' | 'provider'>) => string
}): boolean {
  if (!targetSession) return false
  return preparingTargetKey !== keyOf(targetSession)
}

export async function runComposerSessionPreparation({
  refreshSessions,
  prewarmRuntime,
  loadDetail,
  loadAffordances,
}: {
  refreshSessions: () => Promise<unknown>
  prewarmRuntime: () => Promise<unknown>
  loadDetail: () => Promise<unknown>
  loadAffordances: () => Promise<unknown>
}): Promise<void> {
  await Promise.all([
    refreshSessions(),
    prewarmRuntime(),
    loadDetail(),
  ])
  await loadAffordances()
}

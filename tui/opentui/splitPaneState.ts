import type { Session } from '../../lib/types'

export type SplitPaneLayout = {
  visibleCount: number
  /** Extent (columns side-by-side, rows when stacked) of each split pane. */
  paneExtent: number
  /** Extent left for the primary reader on the same axis. */
  readerExtent: number
}

/**
 * Side-by-side splits the reader area into columns; stacked splits it into
 * rows. Stacked is what makes the split view usable on a narrow terminal,
 * where two 46-column panes never fit beside each other.
 */
export type SplitPaneOrientation = 'columns' | 'rows'

/** Reader share bounds for the manual resize keys; 0 means "even split". */
export const SPLIT_SHARE_MIN = 0.25
export const SPLIT_SHARE_MAX = 0.8
export const SPLIT_SHARE_STEP = 0.05
export const SPLIT_SHARE_EVEN = 0

export function adjustSplitReaderShare(
  current: number,
  delta: number,
  evenShare: number,
): number {
  const base = current === SPLIT_SHARE_EVEN ? evenShare : current
  const next = Math.round((base + delta) * 100) / 100
  if (next <= SPLIT_SHARE_MIN) return SPLIT_SHARE_MIN
  if (next >= SPLIT_SHARE_MAX) return SPLIT_SHARE_MAX
  return next
}

// Every ⌃B chord in one table. The overlay, the status bar's chord hint and the
// unknown-key notice all read it, so a chord cannot be added to the dispatcher
// and quietly stay out of its own help.
export type SplitChordEntry = { keys: string; label: string }
export type SplitChordSection = { title: string; entries: SplitChordEntry[] }
export const SPLIT_CHORD_HELP: SplitChordSection[] = [
  {
    title: 'split',
    entries: [
      { keys: '% · v', label: 'split side by side' },
      { keys: '" · s', label: 'split stacked' },
      { keys: 'r', label: 'rotate side-by-side ↔ stacked' },
      { keys: 'n', label: 'next session in this pane' },
      { keys: 'x', label: 'close pane' },
      { keys: 'z', label: 'toggle split panes off/on' },
    ],
  },
  {
    title: 'size',
    entries: [
      { keys: '<', label: 'shrink the reader' },
      { keys: '>', label: 'grow the reader' },
      { keys: '=', label: 'even sizes' },
    ],
  },
  {
    title: 'focus',
    entries: [
      { keys: 'o · → · tab', label: 'focus next pane' },
      { keys: '←', label: 'focus previous pane' },
      { keys: ';', label: 'flip reader ↔ last pane' },
      { keys: '1 … 9', label: 'focus pane by number' },
      { keys: '?', label: 'this help' },
      { keys: 'esc · ⌃C · ⌃G', label: 'cancel the chord' },
    ],
  },
  {
    // These need no prefix — a focused pane owns the keyboard outright, and
    // everything not listed here is deliberately inert while it does.
    title: 'inside a focused pane (no ⌃B)',
    entries: [
      { keys: 'j · k', label: 'move card cursor' },
      { keys: 'g · G', label: 'first · last card' },
      { keys: '⌃u · ⌃d', label: 'page up · down' },
      { keys: 'e', label: 'expand / collapse card' },
      { keys: 'y', label: 'copy card' },
      { keys: 'b', label: 'bookmark card' },
      { keys: 'Q', label: 'quote and reply' },
      { keys: 'c', label: 'compose to this session' },
      { keys: 'i', label: 'toggle thinking mode' },
      { keys: '↵', label: 'open this pane in the reader' },
      { keys: '⌃G · D', label: 'git · diagnostics for this session' },
      { keys: '⌃C', label: 'interrupt this session' },
      { keys: 'esc', label: 'back to the reader' },
    ],
  },
]

/** Flat set of prefix keys the help documents, for the anti-drift assertion. */
export function documentedSplitChordKeys(): string[] {
  return SPLIT_CHORD_HELP
    .filter((section) => !section.title.includes('no ⌃B'))
    .flatMap((section) => section.entries.flatMap((entry) => entry.keys.split(' · ')))
}

export function splitCommandKey(command: string, runningInsideTmux: boolean): string {
  return runningInsideTmux ? '? palette' : `⌃B ${command}`
}

export function calculateSplitPaneLayout({
  availableExtent,
  requestedCount,
  availableCount,
  maxPanes,
  minPaneExtent,
  minReaderExtent,
  readerShare = SPLIT_SHARE_EVEN,
}: {
  availableExtent: number
  requestedCount: number
  availableCount: number
  maxPanes: number
  minPaneExtent: number
  minReaderExtent: number
  /**
   * Fraction of the axis the reader keeps. `SPLIT_SHARE_EVEN` (0) divides the
   * axis equally, which is what every caller wanted before the resize keys
   * existed; any other value is clamped so neither side drops below its
   * minimum rather than dropping a pane the user explicitly asked for.
   */
  readerShare?: number
}): SplitPaneLayout {
  let visibleCount = Math.min(requestedCount, maxPanes, availableCount)
  let paneExtent = 0
  let readerExtent = Math.max(availableExtent, minReaderExtent)
  while (visibleCount > 0) {
    // One separator column/row per pane, matching the flex `gap` between frames.
    const usable = availableExtent - visibleCount
    const maxReader = usable - visibleCount * minPaneExtent
    if (maxReader >= minReaderExtent) {
      if (readerShare === SPLIT_SHARE_EVEN) {
        // Even: every frame the same size, the rounding remainder to the reader.
        paneExtent = Math.floor(usable / (visibleCount + 1))
      } else {
        const reader = Math.min(Math.max(Math.round(usable * readerShare), minReaderExtent), maxReader)
        paneExtent = Math.floor((usable - reader) / visibleCount)
      }
      readerExtent = usable - visibleCount * paneExtent
      break
    }
    visibleCount -= 1
  }
  return {
    visibleCount,
    paneExtent,
    readerExtent: visibleCount === 0 ? Math.max(availableExtent, minReaderExtent) : readerExtent,
  }
}

/** The share the even split would produce, used as the resize keys' origin. */
export function evenSplitReaderShare(visibleCount: number): number {
  return visibleCount <= 0 ? 1 : 1 / (visibleCount + 1)
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
    // An explicit pane target must never fall through to the reader's session.
    // Closing the pane's tab (or the pane) while a message is composed for it
    // used to leave the draft aimed at whatever the reader happened to show —
    // silently sending it to a different agent, the worst outcome this
    // function can produce. Look the target up in the full session list too,
    // so the ordinary case still resolves, and refuse rather than guess when
    // it genuinely cannot be found.
    return openTabSessions.find((tab) => keyOf(tab) === paneTargetKey)
      ?? sessions.find((session) => keyOf(session) === paneTargetKey)
      ?? null
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

// The session sidebar's filters, shared by the web rail and the TUI rail so the
// two hide, show and narrow sessions by one set of rules. Pure: no React, no
// Node — both renderers import it.
import type { Session } from './types'
import { parseStoredSessionTags } from './sessionTags'

// ── activity ────────────────────────────────────────────────────────────────

/** The rail's activity filter: one kind of session, or every one (null). */
export type SidebarActivity = 'running' | 'attention' | 'pinned' | 'settled' | null
export const SIDEBAR_ACTIVITY_OPTIONS: ReadonlyArray<readonly [Exclude<SidebarActivity, null> | 'all', string]> = [
  ['all', 'All sessions'], ['running', 'Running'], ['attention', 'Needs input'], ['pinned', 'Pinned'], ['settled', 'Settled'],
]
/** What a session is doing now, as the live-turn registry reports it. */
export type SidebarLiveState = 'running' | 'needs-input' | 'waiting'

export function filterSessionsByActivity(
  sessions: Session[],
  activity: SidebarActivity,
  live: (session: Session) => SidebarLiveState | undefined,
  pinned: (session: Session) => boolean,
): Session[] {
  if (!activity) return sessions
  return sessions.filter((session) => activity === 'settled' ? Boolean(session.inbox?.settledAt)
    : activity === 'pinned' ? pinned(session)
    : live(session) === (activity === 'attention' ? 'needs-input' : 'running'))
}

/** Pinned in the session inbox, the pin both UIs set. */
export function isInboxPinned(session: Session): boolean {
  return session.isPinned === true || session.inbox?.pinnedAt !== undefined
}

// ── scratch ─────────────────────────────────────────────────────────────────

// A scratch session is a throwaway probe — "Reply with the single word: pong",
// "This is a formatting test…", a bare "hi" — the kind smoke runs and quick
// provider checks leave behind by the dozen. They bury real work in the rail,
// so either sidebar can hide them. The test is the prompt's shape alone, and it
// is deliberately narrow: hiding a real conversation is worse than showing a
// probe, so anything the user named, pinned, or that is still doing something
// is never scratch.
const SCRATCH_PROMPT_PATTERNS: readonly RegExp[] = [
  /^(?:reply|respond|answer) with (?:only |just |exactly )?(?:the |a )?(?:single |one )?(?:word|literal|text|number)\b/i,
  /^(?:say|print|output|echo|return) (?:only |just |exactly )?(?:the )?(?:literal|single word|word)\b/i,
  /^output the literal\b/i,
  /^this is a (?:formatting |smoke |quick )?test\b/i,
  /^(?:hi|hello|hey|ping|test|testing)[\s.!?]*$/i,
]

export function isScratchSession(session: Session): boolean {
  if (session.customTitle?.trim()) return false
  const prompt = (session.summary ?? session.firstPrompt ?? '').trim()
  if (!prompt) return false
  return SCRATCH_PROMPT_PATTERNS.some((pattern) => pattern.test(prompt))
}

/**
 * The sessions shown with scratch hidden, and how many were hidden. `keep`
 * protects a session whatever its prompt says (live, selected, team-marked).
 * Returns the input array itself when nothing is hidden, so identity-keyed
 * memos downstream do not churn.
 */
export function hideScratchSessions(
  sessions: Session[],
  keep: (session: Session) => boolean,
): { sessions: Session[]; hidden: number } {
  let hidden = 0
  const shown: Session[] = []
  for (const session of sessions) {
    if (isScratchSession(session) && !isInboxPinned(session) && !keep(session)) {
      hidden += 1
      continue
    }
    shown.push(session)
  }
  return hidden === 0 ? { sessions, hidden: 0 } : { sessions: shown, hidden }
}

// ── settled ─────────────────────────────────────────────────────────────────

/**
 * Settled sessions are done: out of the resting list until shown again or found
 * by a search. `keep` protects the selected one (so the row just settled is
 * still there to reopen) and live ones. Same identity rule as scratch.
 */
export function hideSettledSessions(
  sessions: Session[],
  keep: (session: Session) => boolean,
): { sessions: Session[]; hidden: number } {
  let hidden = 0
  const shown: Session[] = []
  for (const session of sessions) {
    if (session.inbox?.settledAt && !keep(session)) {
      hidden += 1
      continue
    }
    shown.push(session)
  }
  return hidden === 0 ? { sessions, hidden: 0 } : { sessions: shown, hidden }
}

// ── preferences ─────────────────────────────────────────────────────────────

export type SidebarSort = 'project' | 'time'
/** The sidebar settings both UIs read from tui.json. */
export type SharedSidebarPreferences = { sort: SidebarSort; hideScratch: boolean; showSettled: boolean }

// ── live state from the running-turn registry ──────────────────────────────

type RegistryRef = { sessionId: string; provider?: string }
/** A registry key: provider and session id (what both registries report). */
export function liveStateKey(session: { sessionId: string; provider?: string }): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}
/**
 * What each session is doing, from GET /api/sessions/running: a running turn,
 * one waiting in the background, or a session a viewer was asked to look at.
 */
export function liveStatesFromRegistry(registry: { running?: RegistryRef[]; waiting?: RegistryRef[]; attention?: RegistryRef[] }): Map<string, SidebarLiveState> {
  const states = new Map<string, SidebarLiveState>()
  const needsInput = new Set((registry.attention ?? []).map(liveStateKey))
  for (const entry of registry.running ?? []) states.set(liveStateKey(entry), needsInput.has(liveStateKey(entry)) ? 'needs-input' : 'running')
  for (const entry of registry.waiting ?? []) if (!states.has(liveStateKey(entry))) states.set(liveStateKey(entry), 'waiting')
  for (const key of needsInput) if (!states.has(key)) states.set(key, 'needs-input')
  return states
}

// ── grouping ────────────────────────────────────────────────────────────────
// What both rails lift to the top and fold away: sessions waiting on you lead,
// then running ones, then pinned ones (moved, never copied — a session listed
// twice would have two rows sharing one highlight), and coordinator-run
// projects (`COORD-*`) fold into one trailing group that starts collapsed.

export type SidebarLiftedGroup<T> = { key: 'needs-you' | 'running' | 'pinned'; label: string; items: T[] }

export function liftSidebarActivity<T>(
  items: T[],
  sessionOf: (item: T) => Session,
  live: (session: Session) => SidebarLiveState | undefined,
  pinned: (session: Session) => boolean,
): { lifted: SidebarLiftedGroup<T>[]; rest: T[] } {
  const groups: SidebarLiftedGroup<T>[] = [
    { key: 'needs-you', label: 'NEEDS YOU', items: [] },
    { key: 'running', label: 'RUNNING', items: [] },
    { key: 'pinned', label: 'PINNED', items: [] },
  ]
  const rest: T[] = []
  for (const item of items) {
    const session = sessionOf(item)
    const state = live(session)
    if (state === 'needs-input') groups[0]!.items.push(item)
    else if (state === 'running') groups[1]!.items.push(item)
    else if (pinned(session)) groups[2]!.items.push(item)
    else rest.push(item)
  }
  return { lifted: groups.filter((group) => group.items.length > 0), rest }
}

/** Coordinator-run projects hold dozens of identical chat rows. */
export const isCoordinatorRunProject = (projectName: string) => /^COORD-/i.test(projectName)
export const COORDINATOR_RUNS_LABEL = 'COORDINATOR RUNS'

// Today / Yesterday alone left a project whose recent sessions were pinned
// (lifted out) with one "Older" bucket, which draws no headers at all. The week
// and month buckets keep a long list grouped.
export type SidebarDateBucket = 'Today' | 'Yesterday' | 'This week' | 'Last week' | 'This month' | 'Older'
export const SIDEBAR_DATE_BUCKETS: readonly SidebarDateBucket[] = ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Older']
/** The older buckets start folded (a click opens them, and the choice is kept): recent work stays in view. */
export function isDateBucketCollapsedByDefault(label: string): boolean {
  return label === 'This month' || label === 'Older'
}

export function sidebarDateBucket(timeMs: number, now = new Date()): SidebarDateBucket {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime()
  return timeMs >= day(0) ? 'Today' : timeMs >= day(1) ? 'Yesterday' : timeMs >= day(6) ? 'This week' : timeMs >= day(13) ? 'Last week' : timeMs >= day(29) ? 'This month' : 'Older'
}

/**
 * A project's sessions split into Today / Yesterday / Older, in order, or null
 * when they all fall in one bucket (a bucket header would only repeat the
 * project's own).
 */
export function splitSidebarDates<T>(items: T[], timeOf: (item: T) => number, now = new Date()): Array<{ label: SidebarDateBucket; items: T[] }> | null {
  const buckets = new Map<SidebarDateBucket, T[]>()
  for (const item of items) {
    const label = sidebarDateBucket(timeOf(item), now)
    const list = buckets.get(label) ?? []
    list.push(item)
    buckets.set(label, list)
  }
  if (buckets.size < 2) return null
  return SIDEBAR_DATE_BUCKETS.filter((label) => buckets.has(label)).map((label) => ({ label, items: buckets.get(label)! }))
}

// ── tags ────────────────────────────────────────────────────────────────────

/** The most used tags across `sessions`, most used first (ties by name): the rail's tag chips. */
export function popularSessionTags(sessions: Session[], limit = 8): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const session of sessions) for (const tag of parseStoredSessionTags(session.tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
}

export function sessionHasTag(session: Session, tag: string): boolean {
  const wanted = tag.toLowerCase()
  return parseStoredSessionTags(session.tag).some((candidate) => candidate.toLowerCase() === wanted)
}

// ── worktrees ───────────────────────────────────────────────────────────────

/** In a project's scope: its own tree, or (when worktrees are included) any of its worktrees. */
export function sessionInProjectScope(sessionCwd: string, projectPath: string, worktreePaths: readonly string[] = []): boolean {
  const within = (root: string) => sessionCwd === root || sessionCwd.startsWith(`${root}/`)
  return within(projectPath) || worktreePaths.some(within)
}

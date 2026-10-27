/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { TranscriptIndexLookup } from '../transcriptIndex'
import type { TuiThemePalette } from '../../../theme'
import type { CliRenderer } from '@opentui/core'
import type { TeamAttention } from '../../teamAttentionStore'
import { createSidebarSessionSearch } from '../../sidebarSessionSearch'
import { hideScratchSessions } from '../../scratchSessions'
import React, { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { canonicalSpacePath } from '../../spacesStore'
import { useWorkspaceState } from '../../workspaceContext'
import { formatSessionProject, type TuiTranscriptCard } from '../../../format'
import { type TuiTranscriptView } from '../../../theme'
import { writeTuiSidebarSort, type TuiSessionDetail, type TuiSidebarSort } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { type SendState, type Session, type SubagentSummary } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { buildSyntaxStyle } from '../transcriptStyle'
import { resolveExpandedCardKeys } from '../transcriptRows'

export type UseToggleSidebarSortGroupContext = {
  setSidebarSort: React.Dispatch<React.SetStateAction<TuiSidebarSort>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  visibleTranscriptCards: TuiTranscriptCard[]
  transcriptView: TuiTranscriptView
  isChatLikeView: boolean
  expandedCardKeys: Set<string>
  collapsedCardKeys: Set<string>
  searchQuery: string
  followTail: boolean
  readTranscriptCursorKey: () => string | null
  transcriptIndexByKey: TranscriptIndexLookup
  unreadBoundaryKey: string | null
  sessionDetail: TuiSessionDetail | null
  selectedSession: Session | null
  focusedSplitPaneSession: Session | null
  workspaceCwd: string
  sessions: Session[]
  composerSendState: SendState
  composerLiveText: string
  theme: TuiThemePalette
  renderer: CliRenderer
  sessionSearchQuery: string
  allProjects: boolean
  hideScratch: boolean
  selectedSessionKey: string | null
  sidebarSessionActivity: Map<string, 'waiting' | 'needs-input' | 'running'>
  recentlyWrittenSessions: { keys: ReadonlySet<string>; signature: string; nextExpiry: number | null; }
  teamAttention: TeamAttention
  showSettled: boolean
}

export function useToggleSidebarSortGroup(ctx: UseToggleSidebarSortGroupContext) {
  const {
    setSidebarSort, setError, visibleTranscriptCards, transcriptView, isChatLikeView,
    expandedCardKeys, collapsedCardKeys, searchQuery, followTail, readTranscriptCursorKey,
    transcriptIndexByKey, unreadBoundaryKey, sessionDetail, selectedSession,
    focusedSplitPaneSession, workspaceCwd, sessions, composerSendState, composerLiveText, theme,
    renderer, sessionSearchQuery, allProjects, hideScratch, selectedSessionKey,
    sidebarSessionActivity, recentlyWrittenSessions, teamAttention, showSettled,
  } = ctx

  const toggleSidebarSort = useCallback(() => {
    setSidebarSort((current) => {
      const next: TuiSidebarSort = current === 'project' ? 'time' : 'project'
      void writeTuiSidebarSort(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sidebar sort'))
      return next
    })
  }, [])

  const resolvedExpandedKeys = useMemo(
    () => resolveExpandedCardKeys(visibleTranscriptCards, transcriptView, isChatLikeView, expandedCardKeys, collapsedCardKeys),
    [collapsedCardKeys, expandedCardKeys, visibleTranscriptCards, transcriptView],
  )

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  // Deferred: search computation runs after user interactions, so typing stays instant.
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return []
    // Avoid allocating one short array per card while scanning a large
    // transcript. Search runs on every deferred query update, so a single
    // result array matters for 10,000-message sessions.
    const matches: number[] = []
    for (let index = 0; index < visibleTranscriptCards.length; index += 1) {
      if (visibleTranscriptCards[index].searchHaystackLower.includes(deferredSearchQuery)) {
        matches.push(index)
      }
    }
    return matches
  }, [deferredSearchQuery, visibleTranscriptCards])

  const readCursorIndex = () => {
    if (visibleTranscriptCards.length === 0) return -1
    if (followTail) return visibleTranscriptCards.length - 1
    const cursorKey = readTranscriptCursorKey()
    const index = cursorKey ? transcriptIndexByKey.get(cursorKey) ?? -1 : -1
    if (index >= 0) return index
    return 0
  }

  const unreadBoundaryIndex = useMemo(
    () => unreadBoundaryKey ? (transcriptIndexByKey.get(unreadBoundaryKey) ?? -1) : -1,
    [transcriptIndexByKey, unreadBoundaryKey],
  )

  const readerTitle = useMemo(() => (
    sessionDetail?.info?.customTitle
    ?? sessionDetail?.info?.summary
    ?? selectedSession?.customTitle
    ?? selectedSession?.summary
    ?? '(untitled session)'
  ), [selectedSession, sessionDetail?.info])

  // null (not 'unknown') so joinMeta drops it — a session whose model we can't
  // resolve shows just its project, never a dangling "· unknown".
  const readerModel = sessionDetail?.info?.currentModel ?? null

  // Git follows the focused split pane when there is one: the popover is
  // cwd-scoped, and the pane you are looking at is the repo you mean.
  const gitRepoCwd = focusedSplitPaneSession?.cwd ?? sessionDetail?.info?.cwd ?? selectedSession?.cwd ?? workspaceCwd
  // Scopes the git panel's turn list, and follows the same pane-then-selection
  // precedence as the cwd it is read alongside.
  const gitSessionId = focusedSplitPaneSession?.sessionId ?? sessionDetail?.info?.sessionId ?? selectedSession?.sessionId ?? null
  const projectCount = useMemo(
    () => new Set(sessions.map((session) => formatSessionProject(session))).size,
    [sessions],
  )
  const foldedTechnicalCount = useMemo(
    () => visibleTranscriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, visibleTranscriptCards],
  )
  // Split the live-stream fast path out of the O(transcript) scan so the
  // expensive `.some()` only recomputes when expanded keys or cards change —
  // not on every RAF flush that mutates composerLiveText while a turn streams.
  const liveSyntaxActive = composerSendState === 'sending' && Boolean(composerLiveText)
  const expandedSyntaxActive = useMemo(
    () => visibleTranscriptCards.some((card) => {
      if (!resolvedExpandedKeys.has(card.key)) return false
      return Boolean(card.markdownContent || (card.codeBlocks && card.codeBlocks.length > 0))
    }),
    [resolvedExpandedKeys, visibleTranscriptCards],
  )
  const shouldEnableSyntaxHighlighting = liveSyntaxActive || expandedSyntaxActive
  const syntaxStyle = useMemo(
    () => shouldEnableSyntaxHighlighting ? buildSyntaxStyle(theme, renderer.nativeScene) : null,
    [shouldEnableSyntaxHighlighting, theme, renderer],
  )
  const handoffBriefSyntaxStyle = useMemo(
    () => syntaxStyle ?? buildSyntaxStyle(theme, renderer.nativeScene),
    [syntaxStyle, theme, renderer],
  )
  const normalizedSessionQuery = sessionSearchQuery.trim().toLowerCase()
  const spaceSessions = useMemo(() => {
    if (allProjects) return sessions
    const paths = new Map<string, string>()
    const project = canonicalSpacePath(workspaceCwd)
    return sessions.filter(session => {
      if (!session.cwd) return false
      let cwd = paths.get(session.cwd)
      if (!cwd) { cwd = canonicalSpacePath(session.cwd); paths.set(session.cwd, cwd) }
      return cwd === project || cwd.startsWith(project + '/')
    })
  }, [sessions, allProjects, workspaceCwd])
  const searchSidebarSessions = useMemo(() => createSidebarSessionSearch(spaceSessions), [spaceSessions])
  const searchedSessionsForSidebar = useMemo(
    () => searchSidebarSessions(normalizedSessionQuery),
    [searchSidebarSessions, normalizedSessionQuery],
  )
  // A search looks at everything: hiding scratch is about the resting list,
  // and a query that names a hidden session should still find it.
  const scratchFilter = useMemo(() => {
    if (!hideScratch || normalizedSessionQuery) return { sessions: searchedSessionsForSidebar, hidden: 0 }
    return hideScratchSessions(searchedSessionsForSidebar, (session) => {
      const key = sessionKey(session)
      return key === selectedSessionKey
        || sidebarSessionActivity.has(key)
        || recentlyWrittenSessions.keys.has(key)
        || teamAttention.has(key)
    })
  }, [hideScratch, normalizedSessionQuery, searchedSessionsForSidebar, selectedSessionKey, sidebarSessionActivity, recentlyWrittenSessions, teamAttention])
  // Settled sessions are done: out of the resting list, like the web rail's ✓,
  // until shown again or found by a search. The selected one stays, so the row
  // just settled is still there to reopen with a second `x`; so do live ones.
  const settledFilter = useMemo(() => {
    const source = scratchFilter.sessions
    if (showSettled || normalizedSessionQuery) return { sessions: source, hidden: 0 }
    let hidden = 0
    const shown: Session[] = []
    for (const session of source) {
      const key = sessionKey(session)
      if (session.inbox?.settledAt && key !== selectedSessionKey && !sidebarSessionActivity.has(key) && !recentlyWrittenSessions.keys.has(key)) {
        hidden += 1
        continue
      }
      shown.push(session)
    }
    return hidden === 0 ? { sessions: source, hidden: 0 } : { sessions: shown, hidden }
  }, [normalizedSessionQuery, recentlyWrittenSessions, scratchFilter.sessions, selectedSessionKey, showSettled, sidebarSessionActivity])
  const filteredSessionsForSidebar = settledFilter.sessions
  // Some providers expose subagents inside a parent transcript instead of as
  // durable child sessions. Fetch their lightweight summaries lazily for the
  // currently open session. Providers with real children (OpenCode/Codex) are
  // already represented through parentSessionId and return no summaries here.
  // Read in the transcript worker, which already holds the provider graph. A
  // session that turns out to have none is remembered outside state: most have
  // none, and a new map per selection rebuilt every sidebar row.
  const [collapsedSubagentParents, setCollapsedSubagentParents] = useWorkspaceState<string[]>('collapsedSubagentParents', [])
  const collapsedSubagentSet = useMemo(() => new Set(collapsedSubagentParents), [collapsedSubagentParents])
  const [subagentTranscriptSelection, setSubagentTranscriptSelection] = useState<{ parent: Session; agent: SubagentSummary } | null>(null)
  const toggleSidebarSubagents = useStableEvent((parent: Session) => {
    const key = sessionKey(parent)
    setCollapsedSubagentParents(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key])
  })
  const [providerSubagentSummaries, setProviderSubagentSummaries] = useState<Map<string, SubagentSummary[]>>(new Map())
  const subagentSummariesReadRef = useRef(new Set<string>())

  return {
    toggleSidebarSort, resolvedExpandedKeys, normalizedSearchQuery, deferredSearchQuery,
    searchMatches, readCursorIndex, unreadBoundaryIndex, readerTitle, readerModel, gitRepoCwd,
    gitSessionId, shouldEnableSyntaxHighlighting, syntaxStyle, handoffBriefSyntaxStyle,
    normalizedSessionQuery, spaceSessions, scratchFilter, settledFilter,
    filteredSessionsForSidebar, setCollapsedSubagentParents, collapsedSubagentSet,
    subagentTranscriptSelection, setSubagentTranscriptSelection, toggleSidebarSubagents,
    providerSubagentSummaries, setProviderSubagentSummaries, subagentSummariesReadRef,
  }
}

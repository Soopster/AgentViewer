'use client'

import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import type { Session } from '@/lib/types'
import { isSessionPinned, useSessionInboxVersion } from './useSessionInbox'
import { createSessionListIndexer, matchesIndexedSessionSearch, groupByProject, buildSessionTimeEntries, type IndexedSession } from '@/lib/sessionListModel'
import {
  COORDINATOR_RUNS_LABEL, filterSessionsByActivity, hideScratchSessions, hideSettledSessions, isCoordinatorRunProject, isInboxPinned,
  liftSidebarActivity, liveStateKey, liveStatesFromRegistry, type SidebarLiftedGroup,
  type SharedSidebarPreferences, type SidebarActivity, type SidebarLiveState,
} from '@/lib/sessionSidebarModel'

const ACTIVITY_KEY = 'agentViewer:sidebarActivity'
const LIVE_POLL_MS = 5000

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export function useSessionListModel(sessions: Session[], selectedKey?: string | null, keyOf?: (session: Session) => string) {
  const [searchText, setSearchText] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'project' | 'time'>('project')
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('agentViewer:sessionSort')
      if (stored === 'time' || stored === 'project') {
        setSortMode(stored)
      }
    } catch {
      // ignore storage failures
    }
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:sessionSort', sortMode)
  }, [sortMode])
  // Sort, scratch hiding and settled visibility are shared with the TUI (tui.json).
  const [hideScratch, setHideScratchState] = useState(false)
  const [showSettled, setShowSettledState] = useState(false)
  const [activity, setActivityState] = useState<SidebarActivity>(null)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ACTIVITY_KEY)
      if (stored === 'running' || stored === 'attention' || stored === 'pinned' || stored === 'settled') setActivityState(stored)
    } catch { /* ignore storage failures */ }
    void fetch('/api/sidebar-preferences').then(async (response) => {
      if (!response.ok) return
      const prefs = await response.json() as SharedSidebarPreferences
      setSortMode(prefs.sort)
      setHideScratchState(prefs.hideScratch)
      setShowSettledState(prefs.showSettled)
    }).catch(() => {})
  }, [])
  const patchShared = (patch: Partial<SharedSidebarPreferences>) => {
    void fetch('/api/sidebar-preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {})
  }
  const setSort = (mode: 'project' | 'time') => { setSortMode(mode); patchShared({ sort: mode }) }
  const setHideScratch = (value: boolean) => { setHideScratchState(value); patchShared({ hideScratch: value }) }
  const setShowSettled = (value: boolean) => { setShowSettledState(value); patchShared({ showSettled: value }) }
  const setActivity = (value: SidebarActivity) => {
    setActivityState(value)
    try { window.localStorage.setItem(ACTIVITY_KEY, value ?? '') } catch { /* ignore */ }
  }
  // Running / needs-input, from the same registry the TUI polls.
  const [liveStates, setLiveStates] = useState<Map<string, SidebarLiveState>>(() => new Map())
  useEffect(() => {
    let cancelled = false
    const poll = () => void fetch('/api/sessions/running').then(async (response) => {
      if (!response.ok || cancelled) return
      const next = liveStatesFromRegistry(await response.json())
      setLiveStates((previous) => previous.size === next.size && [...next].every(([key, value]) => previous.get(key) === value) ? previous : next)
    }).catch(() => {})
    poll()
    const id = window.setInterval(poll, LIVE_POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])
  const inboxVersion = useSessionInboxVersion()
  const debouncedSearchText = useDebouncedValue(searchText, 120)
  const deferredSearchText = useDeferredValue(debouncedSearchText)
  const normalizedSearch = deferredSearchText.trim().toLowerCase()
  const indexSessions = useMemo(() => createSessionListIndexer(), [])
  // The rail's resting filters, as the TUI applies them: a search shows
  // everything (scratch and settled included); the selected and live sessions
  // are never hidden.
  const restingFilter = useMemo(() => {
    if (normalizedSearch) return { sessions, hiddenScratch: 0, hiddenSettled: 0 }
    const keep = (session: Session) => (selectedKey != null && keyOf?.(session) === selectedKey) || liveStates.has(liveStateKey(session))
    const scratch = hideScratch && activity !== 'settled' ? hideScratchSessions(sessions, keep) : { sessions, hidden: 0 }
    const settled = showSettled || activity === 'settled' ? { sessions: scratch.sessions, hidden: 0 } : hideSettledSessions(scratch.sessions, keep)
    const narrowed = filterSessionsByActivity(settled.sessions, activity, (session) => liveStates.get(liveStateKey(session)), isSessionPinned)
    return { sessions: narrowed, hiddenScratch: scratch.hidden, hiddenSettled: settled.hidden }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, hideScratch, keyOf, liveStates, normalizedSearch, selectedKey, sessions, showSettled, inboxVersion])
  const indexedSessions = useMemo(() => indexSessions(restingFilter.sessions), [indexSessions, restingFilter.sessions])
  const filteredSessions = useMemo(
    () => indexedSessions.filter((session) => matchesIndexedSessionSearch(session, normalizedSearch, activeTag)),
    [indexedSessions, normalizedSearch, activeTag],
  )
  // As the TUI's rail: needs-you, running and pinned sessions lead (a search
  // shows results in place), and COORD-* projects fold into one trailing group.
  const { lifted, rest } = useMemo((): { lifted: SidebarLiftedGroup<IndexedSession>[]; rest: IndexedSession[] } => normalizedSearch
    ? { lifted: [], rest: filteredSessions }
    : liftSidebarActivity(filteredSessions, (entry) => entry.session, (session) => liveStates.get(liveStateKey(session)), isSessionPinned),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filteredSessions, liveStates, normalizedSearch, inboxVersion])
  const { childrenByParentId } = useMemo(() => groupByProject(filteredSessions), [filteredSessions])
  const groups = useMemo(() => {
    const projectGroups = groupByProject(rest).groups
    const coordinator = projectGroups.filter((group) => isCoordinatorRunProject(group.projectName))
    if (coordinator.length === 0) return projectGroups
    return [
      ...projectGroups.filter((group) => !isCoordinatorRunProject(group.projectName)),
      { projectDir: 'coordinator-runs', projectName: COORDINATOR_RUNS_LABEL, sessions: coordinator.flatMap((group) => group.sessions) },
    ]
  }, [rest])
  const liftedGroups = useMemo(() => lifted.map((group) => ({ key: group.key, label: group.label, sessions: group.items.map((entry) => entry.session) })), [lifted])
  const showProviderPerRow = useMemo(
    () => new Set(filteredSessions.map((entry) => entry.session.provider ?? 'claude')).size > 1,
    [filteredSessions],
  )
  const timeEntries = useMemo(
    () => sortMode === 'time' ? buildSessionTimeEntries(rest) : [],
    [rest, sortMode],
  )
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const session of indexedSessions) {
      for (const tag of session.tags) {
        map.set(tag, (map.get(tag) ?? 0) + 1)
      }
    }
    return map
  }, [indexedSessions])
  const popularTags = useMemo(
    () => [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    [tagCounts],
  )

  useEffect(() => {
    if (!activeTag) return
    if (tagCounts.has(activeTag)) return
    setActiveTag(null)
  }, [activeTag, tagCounts])

  return {
    searchText, setSearchText, activeTag, setActiveTag, sortMode, setSortMode: setSort, filteredSessions, groups, childrenByParentId,
    showProviderPerRow, timeEntries, popularTags, hideScratch, setHideScratch, showSettled, setShowSettled, activity, setActivity,
    liveStates, liftedGroups, hiddenScratch: restingFilter.hiddenScratch, hiddenSettled: restingFilter.hiddenSettled,
  }
}

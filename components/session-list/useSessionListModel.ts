'use client'

import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import type { Session } from '@/lib/types'
import { createSessionListIndexer, matchesIndexedSessionSearch, groupByProject, buildSessionTimeEntries } from '@/lib/sessionListModel'

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export function useSessionListModel(sessions: Session[]) {
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
  const debouncedSearchText = useDebouncedValue(searchText, 120)
  const deferredSearchText = useDeferredValue(debouncedSearchText)
  const normalizedSearch = deferredSearchText.trim().toLowerCase()
  const indexSessions = useMemo(() => createSessionListIndexer(), [])
  const indexedSessions = useMemo(() => indexSessions(sessions), [indexSessions, sessions])
  const filteredSessions = useMemo(
    () => indexedSessions.filter((session) => matchesIndexedSessionSearch(session, normalizedSearch, activeTag)),
    [indexedSessions, normalizedSearch, activeTag],
  )
  const { groups, childrenByParentId } = useMemo(() => groupByProject(filteredSessions), [filteredSessions])
  const showProviderPerRow = useMemo(
    () => new Set(filteredSessions.map((entry) => entry.session.provider ?? 'claude')).size > 1,
    [filteredSessions],
  )
  const timeEntries = useMemo(
    () => sortMode === 'time' ? buildSessionTimeEntries(filteredSessions) : [],
    [filteredSessions, sortMode],
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

  return { searchText, setSearchText, activeTag, setActiveTag, sortMode, setSortMode, filteredSessions, groups, childrenByParentId, showProviderPerRow, timeEntries, popularTags }
}

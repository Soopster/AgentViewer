/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type TuiSidebarSort } from '../../../../lib/tui/service'
import { cycleCoordinatorFilter } from '../../coordinatorStore'
import { type SidebarEntry, type PaneFocus, type NoticeTone } from '../types'

/** Returns true when one of these branches handled the key. */
export function handleSidebarKeys({
  effectiveFocus, sidebarSubagentCursor, key, handled, showNotice, setSidebarView,
  showToggleOutcome, sidebarView, moveCoordinatorSelection, jumpCoordinatorSelection, isShifted,
  openSelectedCoordinatorAgent, moveSelection, sidebarEntries, focusSidebarEntry,
  toggleHideScratch, toggleSelectedSessionSettled, toggleSidebarSort, sidebarSort,
}: {
  effectiveFocus: PaneFocus
  sidebarSubagentCursor: string | null
  key: KeyEvent
  handled: (action: () => void) => void
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setSidebarView: React.Dispatch<React.SetStateAction<'sessions' | 'coordinator'>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  sidebarView: 'sessions' | 'coordinator'
  moveCoordinatorSelection: (delta: number) => void
  jumpCoordinatorSelection: (edge: 'first' | 'last') => void
  isShifted: (char: string) => boolean
  openSelectedCoordinatorAgent: () => void
  moveSelection: (delta: number) => void
  sidebarEntries: SidebarEntry[]
  focusSidebarEntry: (entry: SidebarEntry | undefined) => void
  toggleHideScratch: () => void
  toggleSelectedSessionSettled: () => void
  toggleSidebarSort: () => void
  sidebarSort: TuiSidebarSort
}): boolean {
    if (effectiveFocus === 'sessions' && sidebarSubagentCursor && !key.ctrl && !key.meta
      && ['x', 'd', 'r', 't', 'b'].includes(key.name.toLowerCase())) {
      handled(() => showNotice('info', 'Captured subagent transcripts are read only · Enter to view'))
      return true
    }
    if (effectiveFocus === 'sessions' && key.name === 'a' && !key.ctrl && !key.shift && !key.meta) {
      handled(() => {
        setSidebarView((current) => {
          const next = current === 'sessions' ? 'coordinator' : 'sessions'
          showToggleOutcome('Sidebar view:', next)
          return next
        })
      })
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && (key.name === 'j' || key.name === 'down')) {
      handled(() => moveCoordinatorSelection(1))
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && (key.name === 'k' || key.name === 'up')) {
      handled(() => moveCoordinatorSelection(-1))
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && key.name === 'g' && !key.shift) {
      handled(() => jumpCoordinatorSelection('first'))
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && isShifted('G')) {
      handled(() => jumpCoordinatorSelection('last'))
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && key.name === 'return') {
      handled(() => openSelectedCoordinatorAgent())
      return true
    }

    // Herdr's Goto-picker filters (b/w/i/d there; those keys are global
    // toggles here, so one key cycles them).
    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && key.name === 'f' && !key.ctrl && !key.meta && !key.shift) {
      handled(() => showToggleOutcome('Agents:', cycleCoordinatorFilter()))
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && (key.name === 'j' || key.name === 'down')) {
      handled(() => {
        moveSelection(1)
      })
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveSelection(-1)
      })
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && key.name === 'g' && !key.shift) {
      handled(() => {
        const first = sidebarEntries.find(entry => entry.type === 'session' || entry.type === 'subagent')
        focusSidebarEntry(first)
      })
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && isShifted('G')) {
      handled(() => {
        const last = [...sidebarEntries].reverse().find(entry => entry.type === 'session' || entry.type === 'subagent')
        focusSidebarEntry(last)
      })
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && isShifted('Y')) {
      handled(toggleHideScratch)
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && key.name === 'x' && !key.shift && !key.ctrl && !key.meta) {
      handled(toggleSelectedSessionSettled)
      return true
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && isShifted('S')) {
      handled(() => {
        toggleSidebarSort()
        showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
      })
      return true
    }
  return false
}

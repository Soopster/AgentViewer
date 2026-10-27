/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { KeyEvent } from '@opentui/core'
import { cycleTranscriptWidth } from '../../engineeringLayout'
import React from 'react'
import { type TuiDensity } from '../../../theme'
import { writeTuiDensity, writeTuiFocusMode, writeTuiStickyHeaders, writeTuiRailVisible, writeTuiShowToolCalls, writeTuiTabsEnabled, writeTuiTranscriptWidth, type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { type PaneFocus } from '../types'
import { cycleDensityValue } from '../viewHelpers'

/** Returns true when one of these branches handled the key. */
export function handleLetterShortcutKeys({ sequence, composerActive, handled, setComposerHidden, setComposerActive, normalizedSearchQuery, openNewSessionModal, reuseLastPrompt, setThinkingMode, showToggleOutcome, setShowToolCalls, setError, toggleVelocityScroll, setCommandPaletteIndex, setCommandPaletteQuery, setCommandPaletteOpen, key, openProviderMenu, openThemeMenu, stickyHeaders, setStickyHeaders, tabsEnabled, setTabsEnabled, railVisible, setRailVisible, focusedPane, setFocusedPane, focusMode, setFocusMode, density, setDensity, isShifted, transcriptWidth, setTranscriptWidth, openTranscriptViewMenu, refreshSessions, provider, selectedSessionTarget, refreshSelectedSessionDetail }: {
  sequence: string
  composerActive: boolean
  handled: (action: () => void) => void
  setComposerHidden: React.Dispatch<React.SetStateAction<boolean>>
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  normalizedSearchQuery: string
  openNewSessionModal: () => void
  reuseLastPrompt: () => void
  setThinkingMode: React.Dispatch<React.SetStateAction<boolean>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  setShowToolCalls: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  toggleVelocityScroll: () => void
  setCommandPaletteIndex: React.Dispatch<React.SetStateAction<number>>
  setCommandPaletteQuery: React.Dispatch<React.SetStateAction<string>>
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>
  key: KeyEvent
  openProviderMenu: () => void
  openThemeMenu: () => void
  stickyHeaders: boolean
  setStickyHeaders: React.Dispatch<React.SetStateAction<boolean>>
  tabsEnabled: boolean
  setTabsEnabled: React.Dispatch<React.SetStateAction<boolean>>
  railVisible: boolean
  setRailVisible: React.Dispatch<React.SetStateAction<boolean>>
  focusedPane: PaneFocus
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  focusMode: boolean
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>
  density: TuiDensity
  setDensity: React.Dispatch<React.SetStateAction<TuiDensity>>
  isShifted: (char: string) => boolean
  transcriptWidth: TuiTranscriptWidth
  setTranscriptWidth: React.Dispatch<React.SetStateAction<TuiTranscriptWidth>>
  openTranscriptViewMenu: () => void
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
  provider: ProviderSelection
  selectedSessionTarget: Session | null
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
}): boolean {
    if (sequence === 'c' && !composerActive) {
      handled(() => {
        setComposerHidden(false)
        setComposerActive(true)
      })
      return true
    }

    if (sequence === 'N' && !composerActive && normalizedSearchQuery.length === 0) {
      handled(() => openNewSessionModal())
      return true
    }

    if (sequence === 'R' && !composerActive) {
      handled(reuseLastPrompt)
      return true
    }

    if (sequence === 'i') {
      handled(() => {
        setThinkingMode((current) => {
          const next = !current
          showToggleOutcome('Thinking mode', next)
          return next
        })
      })
      return true
    }

    if (sequence === 'X') {
      handled(() => {
        setShowToolCalls((v) => {
          const next = !v
          showToggleOutcome('Tool calls', next ? 'shown' : 'hidden')
          void writeTuiShowToolCalls(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
          return next
        })
      })
      return true
    }

    if (sequence === 'V') {
      handled(toggleVelocityScroll)
      return true
    }

    if (sequence === '?') {
      handled(() => {
        setCommandPaletteIndex(0)
        setCommandPaletteQuery('')
        setCommandPaletteOpen(true)
      })
      return true
    }

    if (key.name === 'p') {
      handled(() => {
        openProviderMenu()
      })
      return true
    }

    if (key.name === 't') {
      handled(() => {
        openThemeMenu()
      })
      return true
    }

    if (key.name === 'l' && !key.shift && !key.ctrl && !key.meta) {
      handled(() => {
        const next = !stickyHeaders
        setStickyHeaders(next)
        showToggleOutcome('Sticky headers', next)
        void writeTuiStickyHeaders(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store sticky headers')
        })
      })
      return true
    }

    if (key.name === 'b') {
      handled(() => {
        const next = !tabsEnabled
        setTabsEnabled(next)
        showToggleOutcome('Tab bar', next)
        void writeTuiTabsEnabled(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store tab setting')
        })
      })
      return true
    }

    if (key.name === 'h' && !key.shift) {
      handled(() => {
        const nextVisible = !railVisible
        setRailVisible(nextVisible)
        showToggleOutcome('Session rail', nextVisible)
        if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
        void writeTuiRailVisible(nextVisible).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store reader layout')
        })
      })
      return true
    }

    if (key.name === 'z' && !key.shift) {
      handled(() => {
        const next = !focusMode
        setFocusMode(next)
        showToggleOutcome('Focus mode', next)
        if (next) setFocusedPane('messages')
        void writeTuiFocusMode(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store focus mode')
        })
      })
      return true
    }

    // ⌃D is the reader's page-down; with the sidebar focused it must not fall
    // through to here and cycle density (which re-formats the transcript).
    if (key.name === 'd' && !key.ctrl && !key.meta && !key.option) {
      handled(() => {
        const next = cycleDensityValue(density)
        setDensity(next)
        showToggleOutcome('Density:', next)
        void writeTuiDensity(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store density')
        })
      })
      return true
    }

    if (isShifted('W')) {
      handled(() => {
        const next = cycleTranscriptWidth(transcriptWidth)
        setTranscriptWidth(next)
        showToggleOutcome('Transcript width:', next)
        void writeTuiTranscriptWidth(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store transcript width')
        })
      })
      return true
    }

    if (sequence === 'v' && !key.ctrl && !key.meta) {
      handled(openTranscriptViewMenu)
      return true
    }

    if (key.name === 'r') {
      handled(() => {
        void refreshSessions(provider)
        if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
      })
    }
  return false
}

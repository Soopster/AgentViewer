/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React from 'react'
import { isSurfaceWindowKey, surfaceIdOfKey } from '../../windowOrder'
import { type WindowTarget } from '../../windowTargets'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { type Session } from '../../../../lib/types'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export type PickWindowTargetContext = {
  windowTargets: WindowTarget[]
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  floatingKey: string | null
  setWindowSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  parkedWindowKeysRef: React.RefObject<Set<string>>
  activateWindowTab: (key: string) => void
  pendingSurfaceFocusRef: React.RefObject<string | null>
  popoverTabs: string[]
  showPopoverTab: (id: WindowSurfaceId) => void
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  windowItems: WindowItem[]
  focusSplitPane: (paneIndex: number) => void
  splitPinnedKeys: string[]
  watchedCoordinator: ProtocolRunSnapshot | null
  splitPaneSessions: Session[]
  selectedSessionKey: string | null
  checkpointWindowLayout: () => void
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  selectedSession: Session | null
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  selectTabSession: (session: Session) => void
  focusReaderFromSplit: () => void
}

export function runPickWindowTarget(ctx: PickWindowTargetContext, key: string) {
  const {
    windowTargets, showNotice, floatingKey, setWindowSwitcherOpen, setFocusedPane,
    setSplitFocusIndex, parkedWindowKeysRef, activateWindowTab, pendingSurfaceFocusRef,
    popoverTabs, showPopoverTab, setWindowZoom, setWindowSurfacePeek, setSurfacePanelFocused,
    windowItems, focusSplitPane, splitPinnedKeys, watchedCoordinator, splitPaneSessions,
    selectedSessionKey, checkpointWindowLayout, setSplitPinnedKeys, setWindowOrder,
    selectedSession, setOpenTabSessions, selectTabSession, focusReaderFromSplit,
  } = ctx
  const target = windowTargets.find((entry) => entry.key === key)
  if (!target) { showNotice('info', 'That window is no longer open'); return }
  if (key === floatingKey) { setWindowSwitcherOpen(false); setFocusedPane('messages'); setSplitFocusIndex(FLOATING_PANE_INDEX); return }
  if (parkedWindowKeysRef.current.has(key)) {
    setWindowSwitcherOpen(false)
    activateWindowTab(key)
    if (isSurfaceWindowKey(key)) pendingSurfaceFocusRef.current = surfaceIdOfKey(key)
    return
  }
  setWindowSwitcherOpen(false)
  if (isSurfaceWindowKey(key) && popoverTabs.includes(surfaceIdOfKey(key))) { showPopoverTab(surfaceIdOfKey(key)); return }
  setWindowZoom(null)
  setWindowSurfacePeek(null)
  setSurfacePanelFocused(false)
  setFocusedPane('messages')
  if (target.session) {
    const pane = windowItems.findIndex((item) => item.kind === 'session' && sessionKey(item.session) === key)
    if (pane >= 0) focusSplitPane(pane)
    else {
      // A watched run keeps its lead's window (the first): a hidden teammate
      // trades places with the first teammate shown.
      const lead = splitPinnedKeys[0]
      const shownTeammate = watchedCoordinator ? splitPaneSessions.find((session) => sessionKey(session) !== lead) : undefined
      if (key !== selectedSessionKey && shownTeammate) {
        checkpointWindowLayout()
        const first = sessionKey(shownTeammate)
        const swap = (keys: string[]) => keys.map(entry => entry === key ? first : entry === first ? key : entry)
        setSplitPinnedKeys(swap)
        setWindowOrder(swap)
        focusSplitPane(windowItems.findIndex((item) => item.kind === 'session' && sessionKey(item.session) === first))
        return
      }
      if (key !== selectedSessionKey) {
        checkpointWindowLayout()
        // The hidden window trades places with the selected session's, so it
        // is shown and the order keeps every window; picking the other back
        // trades them again. The selection may be an unpinned preview tab:
        // keep it as a tab instead of letting reconciliation drop it.
        const current = selectedSession
        const currentKey = current ? sessionKey(current) : null
        setOpenTabSessions((tabs) => current && !tabs.some((tab) => sessionKey(tab) === currentKey) ? [...tabs, current] : tabs)
        if (currentKey) {
          const swap = (keys: string[]) => keys.map((entry) => entry === key ? currentKey : entry === currentKey ? key : entry)
          setSplitPinnedKeys(swap)
          setWindowOrder(swap)
        }
        selectTabSession(target.session)
      }
      focusReaderFromSplit()
    }
  } else if (target.surface) {
    const pane = windowItems.findIndex((item) => item.kind === 'surface' && item.surface === target.surface)
    if (pane >= 0) focusSplitPane(pane)
    else {
      // A hidden surface can be inspected at full size without changing the
      // logical layout or mounting it in the side panel at the same time.
      setWindowSurfacePeek(target.surface)
      setSplitFocusIndex(-1)
      showNotice('info', 'Hidden window · Esc or ⌃B m restores the layout')
    }
  }
}

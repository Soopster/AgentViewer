/** @jsxImportSource @opentui/react */
import { useRef } from 'react'
import { stackOf, type WindowStack } from '../../windowTabs'
import { surfaceWindowKey } from '../../windowOrder'
import { type WindowItem } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { sessionKey } from '../sessionList'

export type UseFloatingItemGroupContext = {
  floatingKey: string | null
  windowItemFor: (key: string) => WindowItem
  liveWindowStacks: WindowStack[]
  windowItems: WindowItem[]
  splitPinnedKeys: string[]
  selectedSessionKey: string | null
}

export function useFloatingItemGroup(ctx: UseFloatingItemGroupContext) {
  const {
    floatingKey, windowItemFor, liveWindowStacks, windowItems, splitPinnedKeys, selectedSessionKey,
  } = ctx

  const floatingItem: WindowItem | null = floatingKey ? windowItemFor(floatingKey) : null
  const windowStackFor = (key: string) => stackOf(liveWindowStacks, key)
  const windowItemKey = (item: WindowItem) => (item.kind === 'session' ? sessionKey(item.session) : surfaceWindowKey(item.surface))
  // The pin index of the session in window `index`, or -1 for a surface window.
  const pinIndexOfWindow = (index: number) => {
    const item = windowItems[index]
    return item?.kind === 'session' ? splitPinnedKeys.indexOf(sessionKey(item.session)) : -1
  }
  // The session panes on screen, in display order (live slices, running marks, handles).
  const splitPaneSessions = windowItems.flatMap((item) => (item.kind === 'session' ? [item.session] : []))
  const visibleWindowSurfaces = windowItems.flatMap((item) => (item.kind === 'surface' ? [item.surface] : []))
  // The window showing the selected session is drawn by the reader's own
  // pipeline (card window, view modes, every reader key); the rest are drawn
  // as panes. Selection follows focus, so that is the window in use.
  const lastFocusedSplitPaneRef = useRef(0)
  const selectedWindowIndex = floatingItem?.kind === 'session' && sessionKey(floatingItem.session) === selectedSessionKey ? FLOATING_PANE_INDEX
    : windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === selectedSessionKey)

  return {
    floatingItem, windowStackFor, windowItemKey, pinIndexOfWindow, splitPaneSessions,
    visibleWindowSurfaces, lastFocusedSplitPaneRef, selectedWindowIndex,
  }
}

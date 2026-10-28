/** @jsxImportSource @opentui/react */
import type { WindowLayout } from '../../windowLayout'
import type { SplitRect } from '../../windowSplitTree'
import type { SplitDivider } from '../../windowSplitTree'
import { WINDOW_SURFACE_TITLES, surfaceKindOf } from '../../windowSurfaceNames'
import { liveStacks, type FloatingRect, type WindowStack } from '../../windowTabs'
import { fitWindows, isSurfaceWindowKey, surfaceIdOfKey } from '../../windowOrder'
import { type Session } from '../../../../lib/types'
import { type WindowItem } from '../types'
import { sessionKey } from '../sessionList'

export type UseStackedPanesVisibleGroupContext = {
  stackedSplit: boolean
  visibleSplitPaneCount: number
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  orderedWindowKeys: string[]
  pinnedWindowSessions: Session[]
  openTabSessions: Session[]
  sessionsByKey: Map<string, Session>
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  windowSurfaces: string[]
  popoverTabs: string[]
  windowStacks: WindowStack[]
}

export function useStackedPanesVisibleGroup(ctx: UseStackedPanesVisibleGroupContext) {
  const {
    stackedSplit, visibleSplitPaneCount, treeGeometry, orderedWindowKeys, pinnedWindowSessions,
    openTabSessions, sessionsByKey, floatingWindow, windowSurfaces, popoverTabs, windowStacks,
  } = ctx

  const stackedPanesVisible = stackedSplit && visibleSplitPaneCount > 0
  // Off-axis, a frame simply spans the reader area: stacked panes are full
  // width, side-by-side panes are full height.
  // Every window in display order — sessions in their slots, surfaces in
  // theirs — then those that fit; short of room, sessions go before surfaces.
  const fittedWindowKeys = treeGeometry ? orderedWindowKeys.slice(0, visibleSplitPaneCount) : visibleSplitPaneCount > 0 ? fitWindows(orderedWindowKeys, visibleSplitPaneCount, pinnedWindowSessions.map((session) => sessionKey(session))) : []
  // A parked session (a background tab, the floating window) is an open tab, not a pin.
  const openTabByKey = new Map(openTabSessions.map((session) => [sessionKey(session), session]))
  const windowItemFor = (key: string): WindowItem => (isSurfaceWindowKey(key)
    ? { kind: 'surface', surface: surfaceIdOfKey(key) }
    : { kind: 'session', session: sessionsByKey.get(key) ?? openTabByKey.get(key)! })
  const windowItems: WindowItem[] = fittedWindowKeys.map(windowItemFor)
  const laidOutWindowKeys = new Set(orderedWindowKeys)
  const floatingKey = floatingWindow
    && (isSurfaceWindowKey(floatingWindow.key) ? !windowSurfaces.includes(surfaceIdOfKey(floatingWindow.key))
      : openTabByKey.has(floatingWindow.key) && !laidOutWindowKeys.has(floatingWindow.key))
    ? floatingWindow.key : null
  // A tab still exists while its session is an open tab other than the reader,
  // or — a surface — while it is not open somewhere else.
  const windowKeyExists = (key: string) => key !== floatingKey && (isSurfaceWindowKey(key)
    ? Object.hasOwn(WINDOW_SURFACE_TITLES, surfaceKindOf(surfaceIdOfKey(key))) && !popoverTabs.includes(surfaceIdOfKey(key))
    : openTabByKey.has(key))
  const liveWindowStacks = liveStacks(windowStacks, windowKeyExists, (key) => laidOutWindowKeys.has(key))

  return {
    stackedPanesVisible, fittedWindowKeys, openTabByKey, windowItemFor, windowItems,
    laidOutWindowKeys, floatingKey, liveWindowStacks,
  }
}

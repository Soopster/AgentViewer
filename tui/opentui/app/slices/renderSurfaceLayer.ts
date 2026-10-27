/** @jsxImportSource @opentui/react */
import type { WindowLayout } from '../../windowLayout'
import type { SplitRect } from '../../windowSplitTree'
import type { SplitDivider } from '../../windowSplitTree'
import type { ReactNode } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { TuiThemePalette } from '../../../theme'
import type { SyntaxStyle } from '@opentui/core'
import type { RefObject } from 'react'
import React from 'react'
import { type FloatingRect, type WindowStack } from '../../windowTabs'
import { type MouseEvent, type TabSelectRenderable } from '@opentui/core'
import { type TuiTranscriptCard } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiDensity, type TuiTranscriptView } from '../../../theme'
import { type TuiDiffLayout, type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { type SendState, type Session } from '../../../../lib/types'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type MenuPoint, type PaneFocus } from '../types'
import { SURFACE_PANEL_MIN_ROWS, SURFACE_PANEL_MIN_WIDTH, SURFACE_PANEL_MAX_WIDTH } from '../layoutConstants'
import { clamp } from '../util'
import { type WindowSurfaceId, type SplitPaneHandle, type TranscriptDiffControls } from '../SplitTranscriptPane'
import { runRenderSplitPane, runRenderSurfaceLayer, runRenderWindowTabs } from '../actions/windowRender'

export type UseRenderSurfaceLayerGroupContext = {
  readerAreaWidth: number
  windowAreaHeight: number
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  visibleSplitPaneCount: number
  fittedWindows: WindowLayout
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  fittedWindowKeys: string[]
  zoomedIndex: number | null
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  windowSurfaces: string[]
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  windowSurfacePeek: string | null
  renderSurfaceWindow: (surface: WindowSurfaceId, index: number, size: { width: number; height: number; boxHeight: number | undefined; }, hidden?: boolean, place?: { x: number; y: number; zIndex: number; }) => React.ReactNode
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  fullscreenMode: boolean
  windowStackFor: (key: string) => WindowStack | null
  zooming: boolean
  selectedSessionKey: string | null
  chromeWindowIndex: number
  windowNumberOffset: 1 | 2
  primaryLeaf: boolean
  effectiveFocus: PaneFocus
  splitFocusIndex: number | null
  composerActive: boolean
  reportSelectedWindowCursor: (cardKey: string | null) => void
  setFollowTail: React.Dispatch<React.SetStateAction<boolean>>
  deferredSearchQuery: string
  searchMatches: number[]
  visibleTranscriptCards: TuiTranscriptCard[]
  searchMatchIndex: number
  registerSplitPaneHandle: (paneIndex: number, handle: SplitPaneHandle | null, expected?: SplitPaneHandle) => void
  theme: TuiThemePalette
  densityState: { cardGap: number; bodyIndent: number; bodyLines: number; headerRows: number; bodyPad: number; streamGap: number; streamUserGap: number; }
  density: TuiDensity
  showToolCalls: boolean
  syntaxStyle: SyntaxStyle | null
  shouldEnableSyntaxHighlighting: boolean
  transcriptDiffControls: TranscriptDiffControls
  agentToolCursorByGroupKey: Record<string, string>
  selectAgentTool: (groupKey: string, toolKey: string) => void
  thinkingMode: boolean
  diffLayout: TuiDiffLayout
  imessageStyle: boolean
  transcriptWidth: TuiTranscriptWidth
  transcriptView: TuiTranscriptView
  splitPaneLiveMessages: Map<string, ThreadedMessage[]>
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  splitPaneRunningKeys: Set<string>
  badgeForWindow: (key: string, compact?: boolean) => string | null
  watchedCoordinator: ProtocolRunSnapshot | null
  reportWindowActivity: (key: string, version: string, errorVersion: string | null) => void
  composerSendState: SendState
  composerLiveText: string
  composerActivitySessionKey: string | null
  focusSplitPane: (paneIndex: number) => void
  splitPaneActions: { close: (paneIndex: number) => void; promote: (session: Session) => void; openLayout: () => void; fullscreen: () => void; sessionMenu: (session: Session, source: 'rail' | 'tab' | 'pane', point: MenuPoint, paneIndex?: number) => void; }
  stickyHeaders: boolean
  lightweightWindows: boolean
  noteTranscriptLinkPress: (event: MouseEvent) => void
  openTranscriptLinkAt: (event: MouseEvent) => boolean
  openCardAsyncQuestions: (session: Session, card: TuiTranscriptCard) => void
  floatGestureHandlers: { start: (event: { x: number; y: number; }) => void; move: (event: { x: number; y: number; }) => void; end: (event: { x: number; y: number; }) => void; }
  sessionDragHandlers: { press: (session: Session, fromPane: number | null, event: { x: number; y: number; }, onClick?: () => void) => void; move: (event: { x: number; y: number; }) => void; release: (event: { x: number; y: number; }) => void; }
  splitPaneShouldYield: () => boolean
  sessionDragImplRef: React.RefObject<{ press: (_session: Session, _fromPane: number | null, _event: { x: number; y: number; }, _onClick?: () => void) => void; pressSurface: (_surface: WindowSurfaceId, _fromPane: number, _event: { x: number; y: number; }) => void; pressTab: (_key: string, _fromPane: number, _event: { x: number; y: number; }, _onClick?: () => void) => void; pressReader: (_session: Session, _event: { x: number; y: number; }) => void; move: (_event: { x: number; y: number; }) => void; release: (_event: { x: number; y: number; }) => void; }>
  activateWindowTab: (key: string) => void
  windowKeyTitle: (key: string) => string
  closeWindowTab: (key: string, remember?: boolean) => void
  setSurfacePanelExpanded: React.Dispatch<React.SetStateAction<boolean>>
  surfacePanelAtBottom: boolean
  setSurfacePanelRows: React.Dispatch<React.SetStateAction<number>>
  surfacePanelExpanded: boolean
  effectiveSurfacePanelRows: number
  surfacePanelMaxRows: number
  setSurfacePanelWidth: React.Dispatch<React.SetStateAction<number>>
  effectiveSurfacePanelWidth: number
  surfacePanelMaxWidth: number
  tabSelectRef: React.RefObject<TabSelectRenderable | null>
  tabWidth: number
  visibleTabSessions: Session[]
  popoverTabs: string[]
}

export function useRenderSurfaceLayerGroup(ctx: UseRenderSurfaceLayerGroupContext) {
  const {
    readerAreaWidth, windowAreaHeight, treeGeometry, visibleSplitPaneCount, fittedWindows,
    splitOrientation, splitReaderLast, fittedWindowKeys, zoomedIndex, rectOf, windowSurfaces,
    liveWindowStacks, floatingKey, windowSurfacePeek, renderSurfaceWindow, floatingWindow,
    fullscreenMode, windowStackFor, zooming, selectedSessionKey, chromeWindowIndex,
    windowNumberOffset, primaryLeaf, effectiveFocus, splitFocusIndex, composerActive,
    reportSelectedWindowCursor, setFollowTail, deferredSearchQuery, searchMatches,
    visibleTranscriptCards, searchMatchIndex, registerSplitPaneHandle, theme, densityState,
    density, showToolCalls, syntaxStyle, shouldEnableSyntaxHighlighting, transcriptDiffControls,
    agentToolCursorByGroupKey, selectAgentTool, thinkingMode, diffLayout, imessageStyle,
    transcriptWidth, transcriptView, splitPaneLiveMessages, liveTranscriptBaselineRef,
    splitPaneRunningKeys, badgeForWindow, watchedCoordinator, reportWindowActivity,
    composerSendState, composerLiveText, composerActivitySessionKey, focusSplitPane,
    splitPaneActions, stickyHeaders, lightweightWindows, noteTranscriptLinkPress,
    openTranscriptLinkAt, openCardAsyncQuestions, floatGestureHandlers, sessionDragHandlers,
    splitPaneShouldYield, sessionDragImplRef, activateWindowTab, windowKeyTitle, closeWindowTab,
    setSurfacePanelExpanded, surfacePanelAtBottom, setSurfacePanelRows, surfacePanelExpanded,
    effectiveSurfacePanelRows, surfacePanelMaxRows, setSurfacePanelWidth,
    effectiveSurfacePanelWidth, surfacePanelMaxWidth, tabSelectRef, tabWidth, visibleTabSessions,
    popoverTabs,
  } = ctx

  const renderSurfaceLayer = () => runRenderSurfaceLayer({
    readerAreaWidth, windowAreaHeight, treeGeometry, visibleSplitPaneCount, fittedWindows,
    splitOrientation, splitReaderLast, fittedWindowKeys, zoomedIndex, rectOf, windowSurfaces,
    liveWindowStacks, floatingKey, windowSurfacePeek, renderSurfaceWindow, floatingWindow,
    fullscreenMode, windowStackFor, zooming,
  })

  // One split pane's frame, at the size its arrangement gives it.
  const renderSplitPane = (splitSession: Session, splitIndex: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden = false) => runRenderSplitPane({
    selectedSessionKey, chromeWindowIndex, visibleSplitPaneCount, windowNumberOffset, primaryLeaf,
    floatingKey, effectiveFocus, splitFocusIndex, composerActive, reportSelectedWindowCursor,
    setFollowTail, fullscreenMode, deferredSearchQuery, searchMatches, visibleTranscriptCards,
    searchMatchIndex, registerSplitPaneHandle, theme, densityState, density, showToolCalls,
    syntaxStyle, shouldEnableSyntaxHighlighting, transcriptDiffControls, agentToolCursorByGroupKey,
    selectAgentTool, thinkingMode, diffLayout, imessageStyle, transcriptWidth, transcriptView,
    splitPaneLiveMessages, liveTranscriptBaselineRef, splitPaneRunningKeys, badgeForWindow,
    watchedCoordinator, reportWindowActivity, composerSendState, composerLiveText,
    composerActivitySessionKey, focusSplitPane, splitPaneActions, stickyHeaders,
    lightweightWindows, noteTranscriptLinkPress, openTranscriptLinkAt, openCardAsyncQuestions,
    floatGestureHandlers, sessionDragHandlers, splitPaneShouldYield, renderWindowTabs,
  }, splitSession, splitIndex, size, hidden)

  // A frame's tab strip, over its title: one tab per member, the shown one lit.
  // A tab is clicked to show it and dragged to move it; × closes it.
  // `reserve` is the title bar's right end, where the frame's own buttons are.
  const renderWindowTabs = (key: string, index: number, frameWidth: number, top: number, left: number, reserve: number) => runRenderWindowTabs({
    windowStackFor, theme, sessionDragImplRef, activateWindowTab, sessionDragHandlers,
    windowKeyTitle, closeWindowTab,
  }, key, index, frameWidth, top, left, reserve)

  // Dragging the panel's inner border by `delta` cells toward the reader (positive) or away.
  const resizeSurfacePanelBy = (delta: number) => {
    // A drag sets a size, so it ends an expansion.
    setSurfacePanelExpanded(false)
    if (surfacePanelAtBottom) {
      setSurfacePanelRows((current) => clamp(
        (surfacePanelExpanded ? effectiveSurfacePanelRows : current) + delta,
        SURFACE_PANEL_MIN_ROWS,
        surfacePanelMaxRows,
      ))
    } else {
      setSurfacePanelWidth((current) => clamp(
        (surfacePanelExpanded ? effectiveSurfacePanelWidth : current) + delta,
        SURFACE_PANEL_MIN_WIDTH,
        Math.min(SURFACE_PANEL_MAX_WIDTH, surfacePanelMaxWidth),
      ))
    }
  }

  // Whether a column of the tab strip is a tab's ×: the label's last cell,
  // tabWidth - 2 into the tab (one cell either side, a click is not that exact).
  const tabCloseHit = (x: number): boolean => {
    const instance = tabSelectRef.current
    if (!instance) return false
    const column = (x - instance.x) % tabWidth
    return column >= tabWidth - 3 && column <= tabWidth - 1
  }
  // The popover tab under a column of the tab strip, if that column is one.
  const popoverTabAt = (x: number): WindowSurfaceId | null => {
    const instance = tabSelectRef.current
    if (!instance) return null
    const scrollOffset = (instance as unknown as { scrollOffset: number }).scrollOffset ?? 0
    const index = scrollOffset + Math.floor((x - instance.x) / tabWidth) - visibleTabSessions.length
    return index >= 0 ? popoverTabs[index] ?? null : null
  }
  // The open tab under a column of the tab strip.
  const tabAt = (x: number): Session | null => {
    const instance = tabSelectRef.current
    if (!instance) return null
    const scrollOffset = (instance as unknown as { scrollOffset: number }).scrollOffset ?? 0
    return visibleTabSessions[scrollOffset + Math.floor((x - instance.x) / tabWidth)] ?? null
  }

  return {
    renderSurfaceLayer, renderSplitPane, renderWindowTabs, resizeSurfacePanelBy, tabCloseHit,
    popoverTabAt, tabAt,
  }
}

/** @jsxImportSource @opentui/react */
import { type WindowPresentation } from '../../windowPresentation'
import React, { useMemo, useRef } from 'react'
import { useAppState, useWorkspaceState } from '../../workspaceContext'
import { resolveViewSpec, viewCardStyle, type BuiltinViewOverrides, type CustomView } from '../../../viewSpec'
import { coordinatorWindowBadges } from '../../coordinatorWorkspace'
import { useCoordinatorWorkspace } from '../../useCoordinatorWorkspace'
import { type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { useEngineeringAppState, useEngineeringWorkspaceState } from '../../engineering/state'
import { useStableEvent } from '../../useStableEvent'
import { useWindowOverlayState } from '../state/windowOverlayState'
import { useWindowPanesState } from '../state/windowPanesState'
import { useProviderThemeState } from '../state/providerThemeState'

export function useProviderGroup() {
  const {
    provider, setProvider, providerInstanceId, setProviderInstanceId, providerInstanceIdRef,
    providerInstances, setProviderInstances, themeMode, setThemeMode, themeFollowsTerminal,
    setThemeFollowsTerminal, showBorders: globalShowBorders, setShowBorders, terminalPaletteEpoch, setTerminalPaletteEpoch,
    themeFollowsTerminalRef, themeSlotsRef, density: globalDensity, setDensity, diffLayout: globalDiffLayout, setDiffLayout,
    transcriptDiffNotes, setTranscriptDiffNotes, transcriptDiffDraft, setTranscriptDiffDraft,
    pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt, hoveredTranscriptDiffAnchor,
    setHoveredTranscriptDiffAnchor, transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, transcriptView, setTranscriptView,
  } = useProviderThemeState()
  // A view is a ViewSpec (tui/viewSpec.ts): a built-in preset, or a custom
  // view (its base plus what the user changed). While a custom view or the
  // studio's draft is shown, `transcriptView` holds its base, so code keyed on
  // the built-in id (ENGINEERING's own frame, labels) keeps working.
  const [customViews, setCustomViews] = useAppState<CustomView[]>('customViews', [])
  const [customViewId, setCustomViewId] = useAppState<string | null>('customViewId', null)
  const [viewDraft, setViewDraft] = useAppState<CustomView | null>('viewDraft', null)
  // Edits to the built-ins themselves (`e` on a built-in in the v menu).
  const [builtinViewEdits, setBuiltinViewEdits] = useAppState<BuiltinViewOverrides>('builtinViewEdits', {})
  const activeCustomView = viewDraft ?? (customViewId ? customViews.find((view) => view.id === customViewId) ?? null : null)
  const viewSpec = resolveViewSpec(transcriptView, activeCustomView, builtinViewEdits)
  const viewStyle = viewCardStyle(viewSpec)
  const viewAppTabs = viewSpec.appTabs
  const viewContextSidebar = viewSpec.contextSidebar
  // Borderless chronological flow (STREAM and everything built on it).
  const isChatLikeView = viewSpec.flow === 'stream'
  // SCROLLBACK is STREAM read the way a terminal scrollback is: the same rows,
  // but no card cursor — keys and the wheel move the text by lines, and nothing
  // is ever highlighted as "selected". The cursor key survives as an invisible
  // position (kept on the top visible message) so jumps and search still have
  // somewhere to start from.
  const isScrollbackView = viewSpec.cursor === 'none'
  // No reader header (and the reader's chrome rows with it).
  const isStreamView = !viewSpec.readerHeader
  // With no cursor there is no card for `e` to act on, so SCROLLBACK expands
  // or folds everything at once, as Claude Code's ⌃O does.
  const [scrollbackExpanded, setScrollbackExpanded] = useWorkspaceState('scrollbackExpanded', false)
  const embeddedComposer = viewSpec.composer === 'inline'
  // TRANSCRIPT is STREAM without the per-line markers, and with the role rule
  // on every message rather than only on user prompts. Modelled on opencode's
  // session view, where one left rule per message is the only chrome there is.
  const isContinuousView = viewSpec.messageLayout === 'continuous'
  // A view may pin a global setting; the setters still change the global one.
  const density = viewSpec.density ?? globalDensity
  const diffLayout = viewSpec.diffLayout ?? globalDiffLayout
  const [globalTranscriptWidth, setTranscriptWidth] = useEngineeringAppState<TuiTranscriptWidth>('transcriptWidth', 'readable')
  const [globalFocusMode, setFocusMode] = useEngineeringAppState('focusMode', false)
  const focusMode = viewSpec.focusMode ?? globalFocusMode
  const showBorders = viewSpec.borders ?? globalShowBorders
  const [globalStickyHeaders, setStickyHeaders] = useEngineeringAppState('stickyHeaders', false)
  const [globalLightweightWindows, setLightweightWindows] = useEngineeringAppState('lightweightWindows', false)
  const transcriptWidth = viewSpec.transcriptWidth ?? globalTranscriptWidth
  const stickyHeaders = viewSpec.stickyHeaders ?? globalStickyHeaders
  const lightweightWindows = viewSpec.lightweight ?? globalLightweightWindows
  // Prompt card pinned under the reader's top edge while its turn scrolls past.
  // Temporary presentation mode, deliberately separate from the persisted
  // focus preference: fullscreen can be entered and restored without changing
  // the user's normal rail/header layout.
  const [windowPresentation, setWindowPresentation] = useEngineeringWorkspaceState<WindowPresentation | null>('windowPresentation', null, false)
  const fullscreenMode = windowPresentation?.mode === 'fullscreen'
  const presentationResolverRef = useRef<(index?: number | 'reader' | null) => string | null>(() => null)
  const setFullscreenMode: React.Dispatch<React.SetStateAction<boolean>> = useStableEvent(action => {
    const next = typeof action === 'function' ? action(fullscreenMode) : action
    const target = windowPresentation?.target ?? presentationResolverRef.current()
    setWindowPresentation(next && target ? { mode: 'fullscreen', target } : null)
  })
  const {
    railVisible: globalRailVisible, setRailVisible, tabsEnabled: globalTabsEnabled, setTabsEnabled, tabOrientation: globalTabOrientation, setTabOrientation,
    splitPaneCount, setSplitPaneCount, splitPinnedKeys, setSplitPinnedKeys, splitOrientation,
    setSplitOrientation, splitReaderShare, setSplitReaderShare, splitArrangement,
    setSplitArrangement, splitReaderLast, setSplitReaderLast, windowSplitTree, setWindowSplitTree,
    shelvedWindowKeys, setShelvedWindowKeys,
    treeDividerDrag, setTreeDividerDrag, treeDividerCheckpointedRef, treeDividerActivePathRef,
    coordinatorWorkspace, setCoordinatorWorkspace, coordinatorWorkspaceRunId,
    setCoordinatorWorkspaceRunId, watchedRosterRef,
  } = useWindowPanesState()
  const railVisible = viewSpec.sessionRail ?? globalRailVisible
  const tabsEnabled = viewSpec.tabs ?? globalTabsEnabled
  const tabOrientation = viewSpec.tabOrientation ?? globalTabOrientation
  const watchedCoordinator = useCoordinatorWorkspace(coordinatorWorkspace, coordinatorWorkspaceRunId)
  const coordinatorBadges = useMemo(() => watchedCoordinator ? coordinatorWindowBadges(watchedCoordinator) : new Map<string, string>(), [watchedCoordinator])
  const {
    windowPickerOpen, setWindowPickerOpen, windowSwitcherOpen, setWindowSwitcherOpen,
    overviewPendingTarget, setOverviewPendingTarget, windowBroadcastOpen, setWindowBroadcastOpen,
    windowSurfacePeek, setWindowSurfacePeek, windowSwitcherKeyRef, windowBroadcastKeyRef,
    windowLayoutRestoreRequestRef, windowLayoutPreview, setWindowLayoutPreview, windowAttention,
    setWindowAttention, windowObservedFocusRef, savedWindowLayouts, setSavedWindowLayouts,
    windowSurfaces, setWindowSurfaces, windowSurfaceMeta, setWindowSurfaceMeta, popoverTabs,
    setPopoverTabs, popoverTabFrameRef, activePopoverTab, setActivePopoverTab,
  } = useWindowOverlayState()
  // The reader's place shows a popover tab instead of the transcript.
  const shownPopoverTab = activePopoverTab && popoverTabs.includes(activePopoverTab) ? activePopoverTab : null

  return {
    provider, setProvider, providerInstanceId, setProviderInstanceId, providerInstanceIdRef,
    providerInstances, setProviderInstances, themeMode, setThemeMode, themeFollowsTerminal,
    setThemeFollowsTerminal, showBorders, setShowBorders, terminalPaletteEpoch, setTerminalPaletteEpoch,
    themeFollowsTerminalRef, themeSlotsRef, density, setDensity, diffLayout, setDiffLayout,
    transcriptDiffNotes, setTranscriptDiffNotes, transcriptDiffDraft, setTranscriptDiffDraft,
    pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt, hoveredTranscriptDiffAnchor,
    setHoveredTranscriptDiffAnchor, transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, transcriptView, setTranscriptView,
    viewAppTabs, viewContextSidebar, isChatLikeView, isScrollbackView, isStreamView,
    customViews, setCustomViews, customViewId, setCustomViewId, viewDraft, setViewDraft, activeCustomView,
    builtinViewEdits, setBuiltinViewEdits,
    viewSpec, viewStyle, globalLightweightWindows, globalDensity,
    scrollbackExpanded, setScrollbackExpanded, embeddedComposer, transcriptWidth,
    setTranscriptWidth, focusMode, setFocusMode, stickyHeaders, setStickyHeaders,
    lightweightWindows, setLightweightWindows, windowPresentation, setWindowPresentation,
    fullscreenMode, presentationResolverRef, setFullscreenMode, railVisible, setRailVisible,
    tabsEnabled, setTabsEnabled, tabOrientation, setTabOrientation, splitPaneCount,
    setSplitPaneCount, splitPinnedKeys, setSplitPinnedKeys, splitOrientation, setSplitOrientation,
    splitReaderShare, setSplitReaderShare, splitArrangement, setSplitArrangement, splitReaderLast,
    setSplitReaderLast, windowSplitTree, setWindowSplitTree, treeDividerDrag, setTreeDividerDrag,
    shelvedWindowKeys, setShelvedWindowKeys,
    treeDividerCheckpointedRef, treeDividerActivePathRef, coordinatorWorkspace,
    setCoordinatorWorkspace, coordinatorWorkspaceRunId, setCoordinatorWorkspaceRunId,
    watchedRosterRef, watchedCoordinator, coordinatorBadges, windowPickerOpen, setWindowPickerOpen,
    windowSwitcherOpen, setWindowSwitcherOpen, overviewPendingTarget, setOverviewPendingTarget,
    windowBroadcastOpen, setWindowBroadcastOpen, windowSurfacePeek, setWindowSurfacePeek,
    windowSwitcherKeyRef, windowBroadcastKeyRef, windowLayoutRestoreRequestRef,
    windowLayoutPreview, setWindowLayoutPreview, windowAttention, setWindowAttention,
    windowObservedFocusRef, savedWindowLayouts, setSavedWindowLayouts, windowSurfaces,
    setWindowSurfaces, windowSurfaceMeta, setWindowSurfaceMeta, popoverTabs, setPopoverTabs,
    popoverTabFrameRef, activePopoverTab, setActivePopoverTab, shownPopoverTab,
  }
}

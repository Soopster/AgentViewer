/** @jsxImportSource @opentui/react */
import { type WindowPresentation } from '../../windowPresentation'
import React, { useMemo, useRef } from 'react'
import { useWorkspaceState, useAppState } from '../../workspaceContext'
import { coordinatorWindowBadges } from '../../coordinatorWorkspace'
import { useCoordinatorWorkspace } from '../../useCoordinatorWorkspace'
import { type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { useWindowOverlayState } from '../state/windowOverlayState'
import { useWindowPanesState } from '../state/windowPanesState'
import { useProviderThemeState } from '../state/providerThemeState'

export function useProviderGroup() {
  const {
    provider, setProvider, providerInstanceId, setProviderInstanceId, providerInstanceIdRef,
    providerInstances, setProviderInstances, themeMode, setThemeMode, themeFollowsTerminal,
    setThemeFollowsTerminal, terminalPaletteEpoch, setTerminalPaletteEpoch,
    themeFollowsTerminalRef, themeSlotsRef, density, setDensity, diffLayout, setDiffLayout,
    transcriptDiffNotes, setTranscriptDiffNotes, transcriptDiffDraft, setTranscriptDiffDraft,
    pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt, hoveredTranscriptDiffAnchor,
    setHoveredTranscriptDiffAnchor, transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, transcriptView, setTranscriptView,
  } = useProviderThemeState()
  // Chat reuses stream's chronological, borderless card grouping — the two views
  // diverge only in composer placement (docked vs. inline-with-transcript).
  const isCopilotView = transcriptView === 'copilot'
  const isOpenCodeView = transcriptView === 'opencode'
  const isChatLikeView = transcriptView === 'stream' || transcriptView === 'chat' || transcriptView === 'transcript' || transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || transcriptView === 'copilot' || transcriptView === 'opencode'
  // SCROLLBACK is STREAM read the way a terminal scrollback is: the same rows,
  // but no card cursor — keys and the wheel move the text by lines, and nothing
  // is ever highlighted as "selected". The cursor key survives as an invisible
  // position (kept on the top visible message) so jumps and search still have
  // somewhere to start from.
  const isScrollbackView = transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || isCopilotView || isOpenCodeView
  // Both draw the pane as bare stream: no reader header, no thinking preview.
  const isStreamView = transcriptView === 'stream' || isScrollbackView
  // With no cursor there is no card for `e` to act on, so SCROLLBACK expands
  // or folds everything at once, as Claude Code's ⌃O does.
  const [scrollbackExpanded, setScrollbackExpanded] = useWorkspaceState('scrollbackExpanded', false)
  const embeddedComposer = transcriptView === 'chat' || transcriptView === 'agents'
  // TRANSCRIPT is STREAM without the per-line markers, and with the role rule
  // on every message rather than only on user prompts. Modelled on opencode's
  // session view, where one left rule per message is the only chrome there is.
  const isContinuousView = transcriptView === 'transcript' || isOpenCodeView
  const [transcriptWidth, setTranscriptWidth] = useAppState<TuiTranscriptWidth>('transcriptWidth', 'readable')
  const [focusMode, setFocusMode] = useAppState('focusMode', false)
  const [stickyHeaders, setStickyHeaders] = useAppState('stickyHeaders', false)
  const [lightweightWindows, setLightweightWindows] = useAppState('lightweightWindows', false)
  // Prompt card pinned under the reader's top edge while its turn scrolls past.
  // Temporary presentation mode, deliberately separate from the persisted
  // focus preference: fullscreen can be entered and restored without changing
  // the user's normal rail/header layout.
  const [windowPresentation, setWindowPresentation] = useWorkspaceState<WindowPresentation | null>('windowPresentation', null, false)
  const fullscreenMode = windowPresentation?.mode === 'fullscreen'
  const presentationResolverRef = useRef<(index?: number | 'reader' | null) => string | null>(() => null)
  const setFullscreenMode: React.Dispatch<React.SetStateAction<boolean>> = useStableEvent(action => {
    const next = typeof action === 'function' ? action(fullscreenMode) : action
    const target = windowPresentation?.target ?? presentationResolverRef.current()
    setWindowPresentation(next && target ? { mode: 'fullscreen', target } : null)
  })
  const {
    railVisible, setRailVisible, tabsEnabled, setTabsEnabled, tabOrientation, setTabOrientation,
    splitPaneCount, setSplitPaneCount, splitPinnedKeys, setSplitPinnedKeys, splitOrientation,
    setSplitOrientation, splitReaderShare, setSplitReaderShare, splitArrangement,
    setSplitArrangement, splitReaderLast, setSplitReaderLast, windowSplitTree, setWindowSplitTree,
    shelvedWindowKeys, setShelvedWindowKeys,
    treeDividerDrag, setTreeDividerDrag, treeDividerCheckpointedRef, treeDividerActivePathRef,
    coordinatorWorkspace, setCoordinatorWorkspace, coordinatorWorkspaceRunId,
    setCoordinatorWorkspaceRunId, watchedRosterRef,
  } = useWindowPanesState()
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
    setThemeFollowsTerminal, terminalPaletteEpoch, setTerminalPaletteEpoch,
    themeFollowsTerminalRef, themeSlotsRef, density, setDensity, diffLayout, setDiffLayout,
    transcriptDiffNotes, setTranscriptDiffNotes, transcriptDiffDraft, setTranscriptDiffDraft,
    pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt, hoveredTranscriptDiffAnchor,
    setHoveredTranscriptDiffAnchor, transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, transcriptView, setTranscriptView,
    isCopilotView, isOpenCodeView, isChatLikeView, isScrollbackView, isStreamView,
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

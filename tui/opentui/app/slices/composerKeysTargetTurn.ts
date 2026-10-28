/** @jsxImportSource @opentui/react */
import { presentationIndex, type WindowPresentation } from '../../windowPresentation'
import { verticalTabRailWidth } from '../../VerticalTabs'
import { HORIZONTAL_TAB_BAR_HEIGHT } from '../../tabStrip'
import { useCallback, useMemo } from 'react'
import { type FloatingRect } from '../../windowTabs'
import { orderWindows, surfaceWindowKey } from '../../windowOrder'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type SendState, type Session } from '../../../../lib/types'
import { type PendingPermission, type PendingQuestionOption } from '../../../../lib/permissions'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type QueuedComposerSend, type TuiLiveToolActivity } from '../types'
import { FLOATING_PANE_INDEX, SURFACE_PANEL_MIN_ROWS, SURFACE_PANEL_READER_MIN_ROWS, TASK_PANEL_MIN_WIDTH, MIN_READER_WIDTH, SURFACE_PANEL_MIN_WIDTH, MIN_SIDEBAR_WIDTH } from '../layoutConstants'
import { clamp } from '../util'
import { sessionKey } from '../sessionList'
import { QUESTION_PREVIEW_MAX_LINES } from '../pickers'
import { runQuestionPickerPlan } from '../derived/questionPicker'
import { runComposerStatusBlockHeight } from '../derived/composerStatus'

export type UseComposerKeysTargetTurnGroupContext = {
  visibleComposerSending: boolean
  reattachedRunning: boolean
  visibleComposerError: string | null
  visibleAwaitingPersistedTurn: boolean
  embeddedComposer: boolean
  activeQueuedComposerSends: QueuedComposerSend[]
  visibleComposerLiveText: string
  steeredSendNotice: string | null
  pendingPermissions: PendingPermission[]
  questionFocusIndex: number
  questionOptionIndex: number
  height: number
  workspacesEnabled: boolean
  searchMode: boolean
  sessionSearchMode: boolean
  composerDockHeight: number
  composerPopoverHeight: number
  presentationHidesComposer: boolean
  composerTurnStatusInBorder: boolean
  composerActivityVisible: boolean
  hasSubagentTail: boolean
  visibleLiveToolActivities: TuiLiveToolActivity[]
  visibleRunningToolCount: number
  livePromptSuggestion: string | null
  composerSendState: SendState
  isChatLikeView: boolean
  liveAssistantTextCardVisible: boolean
  liveStatus: 'requesting' | 'compacting' | 'retrying' | null
  composerLiveReasoning: string
  isStreamView: boolean
  composerTargetSession: Session | null
  sessionDetail: TuiSessionDetail | null
  width: number
  composerWindowOpen: boolean
  composerHidden: boolean
  fullscreenMode: boolean
  surfacePanelOpen: boolean
  surfacePanelPlacement: 'right' | 'bottom'
  surfacePanelExpanded: boolean
  surfacePanelRows: number
  taskPanelOpen: boolean
  showRail: boolean
  sidebarWidthPreference: number
  taskPanelExpanded: boolean
  taskPanelWidth: number
  surfacePanelWidth: number
  openTabSessions: Session[]
  popoverTabs: string[]
  selectedSession: Session | null
  tabsEnabled: boolean
  tabOrientation: 'horizontal' | 'vertical'
  splitPinnedKeys: string[]
  selectedSessionKey: string | null
  splitOrientation: SplitPaneOrientation
  measuredWindowAreaHeight: number
  splitPaneCount: number
  windowOrder: string[]
  windowSurfaces: string[]
  windowPresentation: WindowPresentation | null
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  shownPopoverTab: string | null
}

export function useComposerKeysTargetTurnGroup(ctx: UseComposerKeysTargetTurnGroupContext) {
  const {
    visibleComposerSending, reattachedRunning, visibleComposerError, visibleAwaitingPersistedTurn,
    embeddedComposer, activeQueuedComposerSends, visibleComposerLiveText, steeredSendNotice,
    pendingPermissions, questionFocusIndex, questionOptionIndex, height, workspacesEnabled,
    searchMode, sessionSearchMode, composerDockHeight, composerPopoverHeight,
    presentationHidesComposer, composerTurnStatusInBorder, composerActivityVisible,
    hasSubagentTail, visibleLiveToolActivities, visibleRunningToolCount, livePromptSuggestion,
    composerSendState, isChatLikeView, liveAssistantTextCardVisible, liveStatus,
    composerLiveReasoning, isStreamView, composerTargetSession, sessionDetail, width,
    composerWindowOpen, composerHidden, fullscreenMode, surfacePanelOpen, surfacePanelPlacement,
    surfacePanelExpanded, surfacePanelRows, taskPanelOpen, showRail, sidebarWidthPreference,
    taskPanelExpanded, taskPanelWidth, surfacePanelWidth, openTabSessions, popoverTabs,
    selectedSession, tabsEnabled, tabOrientation, splitPinnedKeys, selectedSessionKey,
    splitOrientation, measuredWindowAreaHeight, splitPaneCount, windowOrder, windowSurfaces,
    windowPresentation, floatingWindow, shownPopoverTab,
  } = ctx

  // What ⌃C and ⏎ actually do. The post-turn sync keeps the status row but
  // ends the turn: ⌃C cancels nothing and ⏎ sends at once, so the key hints
  // must not go on offering "cancel" and "queue" through it.
  const composerKeysTargetTurn = visibleComposerSending || reattachedRunning
  const hasComposerStatusMessage = Boolean(
    visibleComposerError
    // Embedded composers render turn activity in a compact in-frame row, so
    // the sync spinner must not also claim a sibling row here — two spinners
    // for one turn.
    || (visibleAwaitingPersistedTurn && !embeddedComposer)
    || activeQueuedComposerSends.length > 0
    || (visibleComposerSending && Boolean(visibleComposerLiveText))
    // Steered notices render while a turn runs, owned or reattached — count
    // them even before the turn streams any output.
    || (steeredSendNotice && (visibleComposerSending || reattachedRunning))
  )
  // The preview lines for one option, already sanitized and bounded. Returned
  // as an array so the plan can count rows and the render can draw exactly
  // those — the two must not derive it separately or the card's reserved height
  // stops matching what is drawn.
  const questionPreviewLines = useCallback((option: PendingQuestionOption | undefined): string[] => {
    const raw = option?.preview
    if (!raw) return []
    return raw
      .replace(/\r\n/g, '\n')
      .split('\n')
      // Control characters and stray ANSI in a model-authored preview would
      // corrupt the frame, so they are stripped the way transcript lines are.
      .map((line) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\t/g, '  '))
      .slice(0, QUESTION_PREVIEW_MAX_LINES)
  }, [])

  // AskUserQuestion picker layout.
  //
  // The picker used to reserve exactly as many rows as a full render needs —
  // one per question plus one per option — with no upper bound. On a short
  // terminal that exceeds what the layout can give it, yoga shrinks the card,
  // and the options that fall off the bottom are simply gone: invisible and
  // unanswerable, on every transcript view. A blocking prompt you cannot see
  // is worse than a cramped one, so when the full picker will not fit we keep
  // the FOCUSED question complete (its options are what the keys act on) and
  // collapse the others to a single row each, windowing the option list around
  // the cursor if even that overflows.
  //
  // The reservation below and the render both read this plan, so they cannot
  // disagree about how tall the card is.
  const questionPickerPlan = useMemo(() => runQuestionPickerPlan({
    pendingPermissions, questionFocusIndex, questionOptionIndex, questionPreviewLines, height,
    workspacesEnabled, searchMode, sessionSearchMode, embeddedComposer, composerDockHeight,
    composerPopoverHeight,
  }), [
    composerDockHeight,
    composerPopoverHeight,
    height,
    pendingPermissions,
    questionFocusIndex,
    questionOptionIndex,
    questionPreviewLines,
    searchMode,
    sessionSearchMode,
    embeddedComposer,
  ])

  const composerStatusBlockHeight = runComposerStatusBlockHeight({
    presentationHidesComposer, visibleComposerSending, embeddedComposer,
    composerTurnStatusInBorder, composerActivityVisible, hasSubagentTail,
    visibleLiveToolActivities, visibleRunningToolCount, livePromptSuggestion, composerSendState,
    hasComposerStatusMessage, visibleComposerLiveText, visibleComposerError, isChatLikeView,
    liveAssistantTextCardVisible, visibleAwaitingPersistedTurn, liveStatus, composerLiveReasoning,
    isStreamView, reattachedRunning, composerTargetSession, sessionDetail, pendingPermissions,
    questionPickerPlan, width,
  })
  // Chat and Agents render the composer bar as the reader box's own trailing child
  // (inside its border) rather than a sibling row below it, so its height comes
  // out of the scrollbox's budget (transcriptViewportRows), not this one.
  // With the composer dock on screen, the status bar's keys move into the
  // dock's bottom border and its row goes back to the transcript.
  const statusBarInDock = !composerWindowOpen && !composerHidden && !presentationHidesComposer && !embeddedComposer && !fullscreenMode
    && !searchMode && !sessionSearchMode
  const surfacePanelVisible = surfacePanelOpen && !fullscreenMode
  const surfacePanelOnRight = surfacePanelVisible && surfacePanelPlacement === 'right'
  const surfacePanelAtBottom = surfacePanelVisible && surfacePanelPlacement === 'bottom'
  const fullContentHeight = Math.max(
    height - (workspacesEnabled && !fullscreenMode ? 1 : 0)
    - (fullscreenMode ? 0 : 2)
    - (searchMode || sessionSearchMode ? 4 : fullscreenMode || statusBarInDock ? 0 : 1)
    - (embeddedComposer ? 0 : composerDockHeight)
    - composerPopoverHeight
    - composerStatusBlockHeight,
    8,
  )
  // Under the reader, the panel's rows come out of the reader's own budget. The
  // main row grows back into them (flexGrow), and the panel is laid over them.
  const surfacePanelMaxRows = Math.max(SURFACE_PANEL_MIN_ROWS, fullContentHeight - SURFACE_PANEL_READER_MIN_ROWS)
  const effectiveSurfacePanelRows = surfacePanelAtBottom
    ? (surfacePanelExpanded ? surfacePanelMaxRows : clamp(surfacePanelRows, SURFACE_PANEL_MIN_ROWS, surfacePanelMaxRows))
    : 0
  const mainContentHeight = Math.max(fullContentHeight - effectiveSurfacePanelRows, 8)
  const taskPanelVisible = taskPanelOpen && !fullscreenMode
  const maxTaskPanelWidth = Math.max(
    TASK_PANEL_MIN_WIDTH,
    width - 4 - (showRail ? sidebarWidthPreference : 0) - MIN_READER_WIDTH
      - (surfacePanelOnRight ? SURFACE_PANEL_MIN_WIDTH + 1 : 0) - 1,
  )
  const effectiveTaskPanelWidth = taskPanelVisible
    ? (taskPanelExpanded ? maxTaskPanelWidth : taskPanelWidth)
    : 0
  // Both right-hand panels can be open at once, so the surface panel's ceiling
  // has to leave the task panel its reservation as well as the reader's minimum.
  const surfacePanelMaxWidth = Math.max(
    SURFACE_PANEL_MIN_WIDTH,
    width - (showRail ? sidebarWidthPreference : 0) - MIN_READER_WIDTH - effectiveTaskPanelWidth,
  )
  const effectiveSurfacePanelWidth = surfacePanelOnRight
    ? (surfacePanelExpanded ? surfacePanelMaxWidth : Math.min(surfacePanelWidth, surfacePanelMaxWidth))
    : 0
  // Both right-hand panels come out of the same budget as the task panel, so
  // the reader keeps its minimum no matter how many are open.
  // The root row has no padding and no gap: neighbouring frames share the
  // screen edge and each other's borders, so the panes are the whole width.
  const rightPanelsWidth = effectiveTaskPanelWidth + effectiveSurfacePanelWidth
  const maxSidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, width - MIN_READER_WIDTH - rightPanelsWidth)
  const sidebarWidth = showRail ? clamp(sidebarWidthPreference, MIN_SIDEBAR_WIDTH, maxSidebarWidth) : 0
  const tabsHaveEntries = openTabSessions.length > 0 || popoverTabs.length > 0 || selectedSession !== null
  const verticalTabsWidth = verticalTabRailWidth(width - sidebarWidth - rightPanelsWidth,
    tabsEnabled && tabOrientation === 'vertical' && !fullscreenMode && tabsHaveEntries)
  const readerAreaWidth = Math.max(width - sidebarWidth - rightPanelsWidth - verticalTabsWidth, fullscreenMode ? 1 : 40)
  // Split panes take their width out of the reader area, so `rightPaneWidth`
  // (the primary transcript's layout width, threaded through every card) keeps
  // being the single source of truth for the reader. Panes are dropped one at a
  // time until both they and the reader clear their minimum widths, so shrinking
  // the terminal degrades to fewer panes instead of unreadable ones.
  const splitCandidateSessions = openTabSessions
  // Resolve pins to live tab objects. A pin whose tab closed, or that the user
  // navigated into (it is now the reader), resolves to nothing and its pane
  // simply doesn't mount this frame — the reconcile effect repairs the list.
  const splitPinnedSessions = splitPinnedKeys.flatMap((pinnedKey) => {
    // A previewed session (selected from the rail, not yet a tab) is shown in a window too.
    const tab = openTabSessions.find((candidate) => sessionKey(candidate) === pinnedKey)
      ?? (pinnedKey === selectedSessionKey ? selectedSession : null)
    return tab ? [tab] : []
  })
  // Stacked splits divide the reader area's ROWS instead of its columns, so the
  // same drop-a-pane-before-shrinking rule runs against a different axis. The
  // reader area's inner height is the frame minus its own borders.
  const splitAxisStacked = splitOrientation === 'rows'
  // Measure the area plus its overflow row as one stable budget, so adding
  // the strip cannot make the next measurement oscillate across a fit boundary.
  const windowBudgetHeight = measuredWindowAreaHeight > 0
    ? measuredWindowAreaHeight
    : Math.max(mainContentHeight - (tabsEnabled && !fullscreenMode && !verticalTabsWidth ? HORIZONTAL_TAB_BAR_HEIGHT : 0), 1)
  const pinnedWindowSessions = splitPinnedSessions.slice(0, splitPaneCount)
  const sessionsByKey = new Map(pinnedWindowSessions.map((session) => [sessionKey(session), session]))
  const pinnedWindowKeys = pinnedWindowSessions.map(sessionKey)
  const pinnedWindowSignature = JSON.stringify(pinnedWindowKeys)
  const orderedWindowKeys = useMemo(() => orderWindows(windowOrder, pinnedWindowKeys, windowSurfaces), [windowOrder, pinnedWindowSignature, windowSurfaces])
  const windowZoom = presentationIndex(windowPresentation?.target, orderedWindowKeys, floatingWindow?.key ?? null,
    shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null, FLOATING_PANE_INDEX)

  return {
    composerKeysTargetTurn, questionPickerPlan, composerStatusBlockHeight, statusBarInDock,
    surfacePanelVisible, surfacePanelOnRight, surfacePanelAtBottom, surfacePanelMaxRows,
    effectiveSurfacePanelRows, mainContentHeight, taskPanelVisible, maxTaskPanelWidth,
    effectiveTaskPanelWidth, surfacePanelMaxWidth, effectiveSurfacePanelWidth, rightPanelsWidth,
    maxSidebarWidth, sidebarWidth, verticalTabsWidth, readerAreaWidth, splitCandidateSessions,
    splitPinnedSessions, splitAxisStacked, windowBudgetHeight, pinnedWindowSessions, sessionsByKey,
    orderedWindowKeys, windowZoom,
  }
}

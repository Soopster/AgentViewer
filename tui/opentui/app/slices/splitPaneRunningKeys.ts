/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import { type RunningSessionRef } from '../../../../lib/types'
import { COMPOSER_WINDOW_MAX_WIDTH, COMPOSER_WINDOW_MAX_HEIGHT } from '../layoutConstants'
import { computeComposerDraftShape } from '../composerInput'
import { sessionKey } from '../sessionList'

export type UseSplitPaneRunningKeysGroupContext = {
  runningSessions: RunningSessionRef[]
  rightPaneWidth: number
  taskPanelVisible: boolean
  surfacePanelOnRight: boolean
  showRail: boolean
  sidebarWidth: number
  readerAreaWidth: number
  width: number
  fullscreenMode: boolean
  height: number
  composerDraft: string
}

export function useSplitPaneRunningKeysGroup(ctx: UseSplitPaneRunningKeysGroupContext) {
  const {
    runningSessions, rightPaneWidth, taskPanelVisible, surfacePanelOnRight, showRail, sidebarWidth,
    readerAreaWidth, width, fullscreenMode, height, composerDraft,
  } = ctx

  // Which pane sessions have a turn in flight — drives the ◐ running glyph and
  // the working spinner, so a background agent's activity is visible without
  // switching to its tab.
  const splitPaneRunningKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const running of runningSessions) {
      keys.add(sessionKey(running))
    }
    return keys
  }, [runningSessions])

  const textareaInnerWidth = Math.max(rightPaneWidth - 4, 10)
  // When either right-hand panel is open, dock the composer under the reader
  // column so it sits beside the panel instead of running underneath it.
  const rightSidePanelVisible = taskPanelVisible || surfacePanelOnRight
  const composerAreaOffset = rightSidePanelVisible
    ? (showRail ? sidebarWidth : 0)
    : 0
  const composerAreaWidth = Math.max(
    30,
    rightSidePanelVisible ? readerAreaWidth : width,
  )
  const composerDockTextareaWidth = Math.max(composerAreaWidth - (fullscreenMode ? 2 : 4), 20)
  const composerWindowWidth = Math.max(
    20,
    Math.min(
      Math.max(width - 4, 20),
      Math.max(64, Math.min(COMPOSER_WINDOW_MAX_WIDTH, Math.floor(width * 0.78))),
    ),
  )
  const composerWindowHeight = Math.max(
    10,
    Math.min(
      Math.max(height - 4, 10),
      Math.max(14, Math.min(COMPOSER_WINDOW_MAX_HEIGHT, Math.floor(height * 0.62))),
    ),
  )
  const composerWindowLeft = Math.max(1, Math.floor((width - composerWindowWidth) / 2))
  const composerWindowTop = Math.max(1, Math.floor((height - composerWindowHeight) / 2))
  const composerWindowContentWidth = Math.max(composerWindowWidth - 4, 16)
  const composerWindowTextareaWidth = Math.max(composerWindowContentWidth - 2, 12)
  // What this render drew from the draft. The content-change handler compares each keystroke's
  // shape with it and re-renders the root only when they differ.
  const composerLineCounts = useMemo(
    () => computeComposerDraftShape(composerDraft, textareaInnerWidth, composerWindowTextareaWidth, null),
    [composerDraft, textareaInnerWidth, composerWindowTextareaWidth],
  )

  return {
    splitPaneRunningKeys, textareaInnerWidth, rightSidePanelVisible, composerAreaOffset,
    composerAreaWidth, composerDockTextareaWidth, composerWindowWidth, composerWindowHeight,
    composerWindowLeft, composerWindowTop, composerWindowContentWidth, composerWindowTextareaWidth,
    composerLineCounts,
  }
}

/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React, { useCallback, useMemo } from 'react'
import { isPluginEnabled } from '../../../../lib/plugins/enablement'
import { toast } from '../../toastStore'
import { formatSessionTitle } from '../../../format'
import { writeTuiSidebarWidth, type TuiSessionDetail } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { rewindCandidates } from '../../rewindTargets'
import { type QueuedComposerSend, type ComposerDraftSnapshot, type PendingInboxEdit, type PaneFocus, type NoticeTone } from '../types'
import { TASK_PANEL_DEFAULT_WIDTH, TASK_PANEL_MIN_WIDTH, MIN_SIDEBAR_WIDTH, TASK_PANEL_RESIZE_STEP } from '../layoutConstants'
import { clamp } from '../util'
import { formatTuiComposerIdleHint } from '../contextMeter'
import { runToggleSelectedSessionSettled } from '../actions/sessionData'
import { runFooterSegments } from '../derived/footer'

export type UseFooterSegmentsGroupContext = {
  composerActive: boolean
  composerKeysTargetTurn: boolean
  effectiveFocus: PaneFocus
  sidebarView: 'sessions' | 'coordinator'
  isScrollbackView: boolean
  scrollbackExpanded: boolean
  commandChordPending: boolean
  theme: TuiThemePalette
  splitChordPending: boolean
  attentionNeedsInputCount: number
  width: number
  statusBarInDock: boolean
  composerDockTextareaWidth: number
  splitFocusIndex: number | null
  visibleComposerError: string | null
  activeQueuedComposerSends: QueuedComposerSend[]
  composerQueueDurable: boolean
  visibleAwaitingPersistedTurn: boolean
  embeddedComposer: boolean
  turnRunningForComposer: boolean
  steeredSendNotice: string | null
  visibleComposerSending: boolean
  visibleComposerLiveText: string
  composerPaneTargetKey: string | null
  composerTargetSession: Session | null
  composerAutoTargetingRunning: boolean
  composerConfig: ProviderComposerConfig
  sentHistory: ComposerDraftSnapshot[]
  sidebarWidth: number
  maxSidebarWidth: number
  setSidebarWidthPreference: React.Dispatch<React.SetStateAction<number>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  taskPanelOpen: boolean
  taskPanelWidth: number
  maxTaskPanelWidth: number
  setTaskPanelExpanded: React.Dispatch<React.SetStateAction<boolean>>
  setTaskPanelWidth: React.Dispatch<React.SetStateAction<number>>
  selectedSession: Session | null
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  pendingInboxEditsRef: React.RefObject<Map<string, PendingInboxEdit>>
  showSettled: boolean
  gitRepoCwd: string
  sessionDetail: TuiSessionDetail | null
  setCheckpointFocusPrompt: React.Dispatch<React.SetStateAction<{ sessionId: string; text: string; timestamp?: string; } | null>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<'terminal' | 'tasks' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null>>
}

export function useFooterSegmentsGroup(ctx: UseFooterSegmentsGroupContext) {
  const {
    composerActive, composerKeysTargetTurn, effectiveFocus, sidebarView, isScrollbackView,
    scrollbackExpanded, commandChordPending, theme, splitChordPending, attentionNeedsInputCount,
    width, statusBarInDock, composerDockTextareaWidth, splitFocusIndex, visibleComposerError,
    activeQueuedComposerSends, composerQueueDurable, visibleAwaitingPersistedTurn,
    embeddedComposer, turnRunningForComposer, steeredSendNotice, visibleComposerSending,
    visibleComposerLiveText, composerPaneTargetKey, composerTargetSession,
    composerAutoTargetingRunning, composerConfig, sentHistory, sidebarWidth, maxSidebarWidth,
    setSidebarWidthPreference, setError, taskPanelOpen, taskPanelWidth, maxTaskPanelWidth,
    setTaskPanelExpanded, setTaskPanelWidth, selectedSession, setSessions, pendingInboxEditsRef,
    showSettled, gitRepoCwd, sessionDetail, setCheckpointFocusPrompt, setPluginOverlay,
  } = ctx

  // Status bar: grouped keybindings rendered as colored inline segments —
  // keys pop in the accent color, labels stay muted, groups split by a dim
  // divider so the bar scans at a glance instead of reading as one dim wall.
  const footerSegments = useMemo(() => runFooterSegments({
    composerActive, composerKeysTargetTurn, effectiveFocus, sidebarView, isScrollbackView,
    scrollbackExpanded, commandChordPending, theme, splitChordPending, attentionNeedsInputCount,
    width, statusBarInDock, composerDockTextareaWidth,
  }), [width, attentionNeedsInputCount, commandChordPending, composerActive, composerDockTextareaWidth, composerKeysTargetTurn, isScrollbackView, scrollbackExpanded, splitChordPending, splitFocusIndex, statusBarInDock, effectiveFocus, sidebarView, theme])

  const composerStatusMessage = visibleComposerError
    ? visibleComposerError
    : activeQueuedComposerSends.length > 0 && !composerQueueDurable
      ? 'Queue persistence failed · keep this TUI open or edit the message back into the composer.'
    // Embedded composers show this in the compact row above the draft.
    : visibleAwaitingPersistedTurn && !embeddedComposer
      ? 'Syncing transcript…'
      : activeQueuedComposerSends.length > 0 && turnRunningForComposer
        ? (activeQueuedComposerSends.length === 1
          ? `Queued · sends after current turn: "${activeQueuedComposerSends[0]!.text.slice(0, 60)}${activeQueuedComposerSends[0]!.text.length > 60 ? '…' : ''}"`
          : `${activeQueuedComposerSends.length} queued · send in order after current turn`)
        : steeredSendNotice && turnRunningForComposer
          ? `Steered · delivered to the running turn: "${steeredSendNotice.slice(0, 60)}${steeredSendNotice.length > 60 ? '…' : ''}"`
          : visibleComposerSending
          // "Using N tools" is not repeated here: the pinned turn-status row
          // and the tool-activity row above already carry it, and a third copy
          // just steals transcript rows.
          ? visibleComposerLiveText
            ? 'Streaming assistant response.'
            : null
          // Plain reattached state renders as its own banner row (counted in
          // composerStatusBlockHeight), not through this message slot.
          : null
  // An explicit pane target outranks the auto-targeting note: the user aimed
  // this composer at a split pane and must be able to see that before sending.
  const composerTargetMessage = composerPaneTargetKey && composerTargetSession
    ? `To: ${formatSessionTitle(composerTargetSession)}`
    : composerPaneTargetKey
    ? 'Session target is unavailable — select a session to retarget'
    : composerAutoTargetingRunning && composerTargetSession
      ? `To: ${formatSessionTitle(composerTargetSession)}`
      : composerTargetSession ? `To: ${formatSessionTitle(composerTargetSession)}` : null
  const composerIdleFooterHint = useMemo(
    () => formatTuiComposerIdleHint(composerConfig.footerHintIdle, sentHistory.length),
    [composerConfig.footerHintIdle, sentHistory.length],
  )

  const resizeSidebar = useStableEvent((delta: number) => {
    const nextWidth = clamp(sidebarWidth + delta, MIN_SIDEBAR_WIDTH, maxSidebarWidth)
    if (nextWidth === sidebarWidth) return
    setSidebarWidthPreference(nextWidth)
    void writeTuiSidebarWidth(nextWidth).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store sidebar width')
    })
  })

  const resizeTaskPanel = useStableEvent((delta: number) => {
    const nextWidth = taskPanelOpen
      ? clamp(taskPanelWidth + delta, TASK_PANEL_MIN_WIDTH, maxTaskPanelWidth)
      : TASK_PANEL_DEFAULT_WIDTH + delta
    setTaskPanelExpanded(false)
    setTaskPanelWidth(Math.round(nextWidth / TASK_PANEL_RESIZE_STEP) * TASK_PANEL_RESIZE_STEP)
  })

  // Adapter over the toast store, kept as the single feedback entry point (also
  // handed to popovers via their `onNotice` prop). info/error tones map to the
  // matching toast kinds; the store handles stacking and per-toast auto-dismiss.
  const showNotice = useCallback((tone: NoticeTone, text: string, durationMs?: number) => {
    const options = durationMs != null ? { durationMs } : undefined
    if (tone === 'error') toast.error(text, options)
    else toast.info(text, options)
  }, [])

  // `x` in the rail: settle the selected session, or reopen a settled one.
  // Optimistic — the row changes now and the next listing confirms it.
  const toggleSelectedSessionSettled = useStableEvent(() => runToggleSelectedSessionSettled({
    selectedSession, setSessions, pendingInboxEditsRef, showNotice, showSettled,
  }))

  // A turn summary's click: the checkpoint popover, opened on that turn.
  const openTurnCheckpoint = useStableEvent((promptKey: string) => {
    if (!gitRepoCwd) {
      showNotice('info', 'Turn diffs need a git repository')
      return
    }
    const sessionId = sessionDetail?.info?.sessionId
    const prompt = rewindCandidates(sessionDetail?.rawMessages ?? []).find((candidate) => candidate.uuid === promptKey)
    if (!isPluginEnabled('checkpoints')) {
      showNotice('info', 'Checkpoints are off · turn them on in Plugins (⌃K palette)')
      return
    }
    setCheckpointFocusPrompt(sessionId && prompt ? { sessionId, text: prompt.text, timestamp: prompt.timestamp } : null)
    setPluginOverlay('checkpoints')
  })

  return {
    footerSegments, composerStatusMessage, composerTargetMessage, composerIdleFooterHint,
    resizeSidebar, resizeTaskPanel, showNotice, toggleSelectedSessionSettled, openTurnCheckpoint,
  }
}

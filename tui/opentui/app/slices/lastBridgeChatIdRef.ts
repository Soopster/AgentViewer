/** @jsxImportSource @opentui/react */
import type { WorkspaceContextValue } from '../../workspaceContext'
import { useComposerSessionState } from '../../../../lib/composerSessions'
import { useCallback, useRef, useState } from 'react'
import { useWorkspaceState } from '../../workspaceContext'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { useBridgeAttentionState } from '../state/bridgeAttentionState'

export type UseLastBridgeChatIdRefGroupContext = {
  composerPaneTargetKey: string | null
  selectedSessionKey: string | null
  sessions: Session[]
  workspaceContext: WorkspaceContextValue
}

export function useLastBridgeChatIdRefGroup(ctx: UseLastBridgeChatIdRefGroupContext) {
  const {
    composerPaneTargetKey, selectedSessionKey, sessions, workspaceContext,
  } = ctx

  const {
    lastBridgeChatIdRef, bridgeTranscriptEntries, setBridgeTranscriptEntries,
    persistedBridgeCountRef, attentionOpen, setAttentionOpen, attentionKeyHandlerRef,
    backgroundPrompts, setBackgroundPrompts, attentionDone, setAttentionDone,
    attentionRespondingId, setAttentionRespondingId, attentionNotifiedRef, worktreeModalOpen,
    setWorktreeModalOpen, worktreeDraft, setWorktreeDraft, worktreeBusy, setWorktreeBusy,
    selectedWorktreeTask, setSelectedWorktreeTask, selectedWorktreeTaskCacheRef, worktreeConfirm,
    setWorktreeConfirm, worktreeSubmitInFlightRef, coordModalOpen, setCoordModalOpen, coordDraft,
    setCoordDraft, coordAcceptanceDraft, setCoordAcceptanceDraft, coordNonGoalsDraft,
    setCoordNonGoalsDraft, coordManualQaDraft, setCoordManualQaDraft, coordEscalationDraft,
    setCoordEscalationDraft, coordPlaybooks, setCoordPlaybooks, coordPlaybookName,
    setCoordPlaybookName, coordPlaybookArgsDraft, setCoordPlaybookArgsDraft, playbookManagerOpen,
    setPlaybookManagerOpen, playbookManagerKeyHandlerRef, coordMaxAgents, setCoordMaxAgents,
    coordGateDraft, setCoordGateDraft, coordRequirePlanApproval, setCoordRequirePlanApproval,
    coordAutonomy, setCoordAutonomy, coordRequireReview, setCoordRequireReview, coordMaxTokens,
    setCoordMaxTokens, coordMaxDurationMinutes, setCoordMaxDurationMinutes, coordUseWorktrees,
    setCoordUseWorktrees, coordProviderOverride, setCoordProviderOverride,
    coordTeammateProviderOverride, setCoordTeammateProviderOverride, coordProviderPoolIndex,
    setCoordProviderPoolIndex, coordModalFocus, setCoordModalFocus, coordTextareaRef,
    coordWatchIds, setCoordWatchIds, coordWatchStateRef, coordBusy, setCoordBusy, coordBoardRunId,
    setCoordBoardRunId, coordError, setCoordError, coordStartInFlightRef, fleetStripEnabled,
    setFleetStripEnabled, fleetPage, setFleetPage, checkpointFocusPrompt, setCheckpointFocusPrompt,
    fileHistoryPath, setFileHistoryPath, dailySummaryOpen, setDailySummaryOpen,
    dailySummaryKeyHandlerRef, fileHistoryKeyHandlerRef, taskPanelOpen, setTaskPanelOpen,
    taskPanelTab, setTaskPanelTab, composerSessions,
  } = useBridgeAttentionState()
  const composerOwnerKey = composerPaneTargetKey ?? selectedSessionKey ?? (sessions[0] ? sessionKey(sessions[0]) : 'unselected')
  const ownsComposerStream = useCallback((key: string) => Boolean(composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current), [composerSessions])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useComposerSessionState(composerSessions, composerOwnerKey, 'awaitingPersistedTurn', false)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useWorkspaceState('searchQuery', '')
  const [searchMatchIndex, setSearchMatchIndex] = useWorkspaceState('searchMatchIndex', 0)
  const [sessionSearchMode, setSessionSearchMode] = useState(false)
  const [sessionSearchQuery, setSessionSearchQuery] = useWorkspaceState('sessionSearchQuery', '')

  // The selected window's cursor, for the root's key handlers and the saved
  // reader position. It lives in the workspace runtime and the root does not
  // subscribe to it: a window reports every j/k here, and as root state each
  // report re-rendered the whole app with nothing on screen depending on it.
  const cursorRuntime = workspaceContext.runtime
  const readTranscriptCursorKey = () => cursorRuntime.get<string | null>('transcriptCursorKey', null, true)
  const setTranscriptCursorKey = useStableEvent((action: string | null | ((previous: string | null) => string | null)) => {
    readTranscriptCursorKey()
    cursorRuntime.set('transcriptCursorKey', action)
  })
  const [expandedCardKeys, setExpandedCardKeys] = useWorkspaceState<Set<string>>('expandedCardKeys', () => new Set())
  const [collapsedCardKeys, setCollapsedCardKeys] = useWorkspaceState<Set<string>>('collapsedCardKeys', () => new Set())
  // Bookmarked message uuids (== card keys) for the active session. The ref
  // keeps the toggle handler stable across renders.
  const [bookmarkKeys, setBookmarkKeys] = useState<Set<string>>(() => new Set())
  const bookmarkKeysRef = useRef<Set<string>>(bookmarkKeys)

  return {
    lastBridgeChatIdRef, bridgeTranscriptEntries, setBridgeTranscriptEntries,
    persistedBridgeCountRef, attentionOpen, setAttentionOpen, attentionKeyHandlerRef,
    backgroundPrompts, setBackgroundPrompts, attentionDone, setAttentionDone,
    attentionRespondingId, setAttentionRespondingId, attentionNotifiedRef, worktreeModalOpen,
    setWorktreeModalOpen, worktreeDraft, setWorktreeDraft, worktreeBusy, setWorktreeBusy,
    selectedWorktreeTask, setSelectedWorktreeTask, selectedWorktreeTaskCacheRef, worktreeConfirm,
    setWorktreeConfirm, worktreeSubmitInFlightRef, coordModalOpen, setCoordModalOpen, coordDraft,
    setCoordDraft, coordAcceptanceDraft, setCoordAcceptanceDraft, coordNonGoalsDraft,
    setCoordNonGoalsDraft, coordManualQaDraft, setCoordManualQaDraft, coordEscalationDraft,
    setCoordEscalationDraft, coordPlaybooks, setCoordPlaybooks, coordPlaybookName,
    setCoordPlaybookName, coordPlaybookArgsDraft, setCoordPlaybookArgsDraft, playbookManagerOpen,
    setPlaybookManagerOpen, playbookManagerKeyHandlerRef, coordMaxAgents, setCoordMaxAgents,
    coordGateDraft, setCoordGateDraft, coordRequirePlanApproval, setCoordRequirePlanApproval,
    coordAutonomy, setCoordAutonomy, coordRequireReview, setCoordRequireReview, coordMaxTokens,
    setCoordMaxTokens, coordMaxDurationMinutes, setCoordMaxDurationMinutes, coordUseWorktrees,
    setCoordUseWorktrees, coordProviderOverride, setCoordProviderOverride,
    coordTeammateProviderOverride, setCoordTeammateProviderOverride, coordProviderPoolIndex,
    setCoordProviderPoolIndex, coordModalFocus, setCoordModalFocus, coordTextareaRef,
    coordWatchIds, setCoordWatchIds, coordWatchStateRef, coordBusy, setCoordBusy, coordBoardRunId,
    setCoordBoardRunId, coordError, setCoordError, coordStartInFlightRef, fleetStripEnabled,
    setFleetStripEnabled, fleetPage, setFleetPage, checkpointFocusPrompt, setCheckpointFocusPrompt,
    fileHistoryPath, setFileHistoryPath, dailySummaryOpen, setDailySummaryOpen,
    dailySummaryKeyHandlerRef, fileHistoryKeyHandlerRef, taskPanelOpen, setTaskPanelOpen,
    taskPanelTab, setTaskPanelTab, composerSessions, composerOwnerKey, ownsComposerStream,
    awaitingPersistedTurn, setAwaitingPersistedTurn, searchMode, setSearchMode, searchQuery,
    setSearchQuery, searchMatchIndex, setSearchMatchIndex, sessionSearchMode, setSessionSearchMode,
    sessionSearchQuery, setSessionSearchQuery, cursorRuntime, readTranscriptCursorKey,
    setTranscriptCursorKey, expandedCardKeys, setExpandedCardKeys, collapsedCardKeys,
    setCollapsedCardKeys, bookmarkKeys, setBookmarkKeys, bookmarkKeysRef,
  }
}

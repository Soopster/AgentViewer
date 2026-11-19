import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import React, { useCallback, useRef, useState } from 'react'
import { useTranscriptWindowPositions } from '../../transcriptWindowState'
import { useTranscriptSessionLoader } from '../../useTranscriptSessionLoader'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { useSessionCaches } from '../state/sessionCaches'
import { useSelectionRefs } from '../state/selectionRefs'
import { useModelState } from '../state/modelState'

export type UseTuiCodexModeByKeyGroupContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function useTuiCodexModeByKeyGroup(ctx: UseTuiCodexModeByKeyGroupContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  const [tuiCodexModeByKey, setTuiCodexModeByKey] = useState<Record<string, 'plan' | 'default'>>({})
  const tuiCodexModeByKeyRef = useRef(tuiCodexModeByKey)
  const setCodexCollaborationMode = useCallback((target: Session, mode: 'plan' | 'default') => {
    const next = { ...tuiCodexModeByKeyRef.current, [sessionKey(target)]: mode }
    tuiCodexModeByKeyRef.current = next
    setTuiCodexModeByKey(next)
  }, [])
  const {
    tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey, tuiCopilotContextTierByKey,
    setTuiCopilotContextTierByKey, tuiCopilotMode, setTuiCopilotMode, tuiOpenCodeAgent,
    setTuiOpenCodeAgent, tuiModelOverride, setTuiModelOverride, tuiReportedModelByKey,
    setTuiReportedModelByKey, modelPickerOpen, setModelPickerOpen, modelPickerTarget,
    setModelPickerTarget, modelPickerFocus, setModelPickerFocus, modelPickerOptions,
    setModelPickerOptions, modelPickerPermissionOptions, setModelPickerPermissionOptions,
    modelPickerQuery, setModelPickerQuery, modelPickerIndex, setModelPickerIndex,
    modelPickerEffortIndex, setModelPickerEffortIndex, modelPickerPermissionIndex,
    setModelPickerPermissionIndex, modelPickerLoading, setModelPickerLoading, modelPickerError,
    setModelPickerError, sentHistory, setSentHistory, historyIndex, setHistoryIndex,
    draftBeforeHistory, setDraftBeforeHistory, thinkingMode, setThinkingMode, openTabSessions,
    setOpenTabSessions, sidebarScrollRef, measuredWindowAreaHeight, setMeasuredWindowAreaHeight,
    scrollbackSyncedCursorKeyRef,
  } = useModelState()
  const tabReaderPositionsRef = useTranscriptWindowPositions()
  const {
    velocityScrollStateRef, tabSelectRef, syncingTabSelectionRef, sessionRequestRef,
    detailRequestRef, backgroundMetadataCursorRef, providerSwitchRef, readerStateWriteTimeoutRef,
    readerStatePersistSignatureRef, expandedKeysRevisionRef, collapsedKeysRevisionRef,
    previousTranscriptRef,
  } = useSelectionRefs()
  const loader = useTranscriptSessionLoader()
  const {
    sessionDetailCacheRef, sessionContextUsageCacheRef, sessionMetadataFetchedAtRef,
    sessionMetadataInFlightRef,
  } = useSessionCaches()
  const composerAbortRef = composerSessions.ref<AbortController | null>(composerOwnerKey, 'composerAbortRef', null)
  const activeComposerSendCleanupRef = composerSessions.ref<Promise<void> | null>(composerOwnerKey, 'activeComposerSendCleanupRef', null)
  // Transient auto-retry bookkeeping (mirrors the web composer): only retry a
  // turn that streamed no output yet, bounded attempts, timer cleared on cancel.
  const composerTurnProducedOutputRef = composerSessions.ref(composerOwnerKey, 'composerTurnProducedOutputRef', false)
  const composerRetryCountRef = composerSessions.ref(composerOwnerKey, 'composerRetryCountRef', 0)
  const composerRetryTimerRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'composerRetryTimerRef', null)

  return {
    tuiCodexModeByKey, tuiCodexModeByKeyRef, setCodexCollaborationMode,
    tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey, tuiCopilotContextTierByKey,
    setTuiCopilotContextTierByKey, tuiCopilotMode, setTuiCopilotMode, tuiOpenCodeAgent,
    setTuiOpenCodeAgent, tuiModelOverride, setTuiModelOverride, tuiReportedModelByKey,
    setTuiReportedModelByKey, modelPickerOpen, setModelPickerOpen, modelPickerTarget,
    setModelPickerTarget, modelPickerFocus, setModelPickerFocus, modelPickerOptions,
    setModelPickerOptions, modelPickerPermissionOptions, setModelPickerPermissionOptions,
    modelPickerQuery, setModelPickerQuery, modelPickerIndex, setModelPickerIndex,
    modelPickerEffortIndex, setModelPickerEffortIndex, modelPickerPermissionIndex,
    setModelPickerPermissionIndex, modelPickerLoading, setModelPickerLoading, modelPickerError,
    setModelPickerError, sentHistory, setSentHistory, historyIndex, setHistoryIndex,
    draftBeforeHistory, setDraftBeforeHistory, thinkingMode, setThinkingMode, openTabSessions,
    setOpenTabSessions, sidebarScrollRef, measuredWindowAreaHeight, setMeasuredWindowAreaHeight,
    scrollbackSyncedCursorKeyRef, tabReaderPositionsRef, velocityScrollStateRef, tabSelectRef,
    syncingTabSelectionRef, sessionRequestRef, detailRequestRef, backgroundMetadataCursorRef,
    providerSwitchRef, readerStateWriteTimeoutRef, readerStatePersistSignatureRef,
    expandedKeysRevisionRef, collapsedKeysRevisionRef, previousTranscriptRef, loader,
    sessionDetailCacheRef, sessionContextUsageCacheRef, sessionMetadataFetchedAtRef,
    sessionMetadataInFlightRef, composerAbortRef, activeComposerSendCleanupRef,
    composerTurnProducedOutputRef, composerRetryCountRef, composerRetryTimerRef,
  }
}

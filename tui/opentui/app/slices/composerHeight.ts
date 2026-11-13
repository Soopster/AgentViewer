/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import { type WindowPresentation } from '../../windowPresentation'
import React, { useMemo } from 'react'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type ContextUsage, type Session } from '../../../../lib/types'
import { type ModelPickerOption } from '../types'
import { CHAT_COMPOSER_MIN_HEIGHT, CHAT_COMPOSER_CHROME_HEIGHT, COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT } from '../layoutConstants'
import { formatModelChipValue } from '../format'
import { sessionKey } from '../sessionList'
import { filterModelPickerOptions } from '../pickers'

export type UseComposerHeightGroupContext = {
  composerHeightPreference?: number
  /** The view's dock height: grow with the draft, hold the smallest dock, or keep a tall floor. */
  composerSize?: 'auto' | 'compact' | 'tall'
  embeddedComposer: boolean
  composerDraftLines: number
  height: number
  /** Shell rows already removed from height; charge them to the draft's growth budget. */
  reservedHeaderRows?: number
  fullscreenMode: boolean
  composerDockChromeHeight: 1 | 2
  windowPresentation: WindowPresentation | null
  composerTargetSessionIdentity: string | null
  composerWindowOpen: boolean
  composerHidden: boolean
  composerTargetSession: Session | null
  sessionDetail: TuiSessionDetail | null
  selectedSessionKey: string | null
  sessionDetailCacheRef: React.RefObject<TranscriptDetailCache>
  tuiModelOverride: Record<string, string>
  tuiReportedModelByKey: Record<string, string | null>
  contextUsage: ContextUsage | null
  modelPickerOptions: ModelPickerOption[]
  modelPickerQuery: string
}

export function useComposerHeightGroup(ctx: UseComposerHeightGroupContext) {
  const {
    embeddedComposer, composerDraftLines, height, fullscreenMode, composerDockChromeHeight,
    windowPresentation, composerTargetSessionIdentity, composerWindowOpen, composerHidden,
    composerTargetSession, sessionDetail, selectedSessionKey, sessionDetailCacheRef,
    tuiModelOverride, tuiReportedModelByKey, contextUsage, modelPickerOptions, modelPickerQuery,
  } = ctx

  const size = ctx.composerSize ?? 'auto'
  const reservedRows = ctx.reservedHeaderRows ?? 0
  const growthLimit = (share: number) => Math.floor((height + reservedRows) * share) - reservedRows
  const minHeight = embeddedComposer ? CHAT_COMPOSER_MIN_HEIGHT : fullscreenMode ? COMPOSER_MIN_HEIGHT - 1 : COMPOSER_MIN_HEIGHT
  // A tall dock keeps room for a paragraph before it starts to grow; never more than 40% of the screen.
  const tallFloor = Math.min(embeddedComposer ? 8 : 10, growthLimit(0.4))
  const grown = embeddedComposer
    ? Math.max(CHAT_COMPOSER_MIN_HEIGHT, Math.min(
        composerDraftLines + CHAT_COMPOSER_CHROME_HEIGHT,
        COMPOSER_MAX_HEIGHT,
        growthLimit(0.35),
      ))
    : Math.max(
        minHeight,
        Math.min(
          fullscreenMode ? COMPOSER_MAX_HEIGHT - 2 : COMPOSER_MAX_HEIGHT,
          composerDraftLines + composerDockChromeHeight,
        ),
      )
  // Compact holds the smallest dock and scrolls the draft inside it.
  const naturalComposerHeight = size === 'compact' ? minHeight : size === 'tall' ? Math.max(grown, tallFloor) : grown
  const composerHeight = ctx.composerHeightPreference === undefined ? naturalComposerHeight
    : Math.max(embeddedComposer ? CHAT_COMPOSER_MIN_HEIGHT : COMPOSER_MIN_HEIGHT, Math.min(ctx.composerHeightPreference, growthLimit(.4)))
  const presentationHidesComposer = fullscreenMode && windowPresentation?.target !== composerTargetSessionIdentity
  const composerDockHeight = composerWindowOpen || composerHidden || presentationHidesComposer ? 0 : composerHeight
  const composerDockTextareaHeight = embeddedComposer
    ? Math.max(1, composerDockHeight - CHAT_COMPOSER_CHROME_HEIGHT)
    : Math.max(2, composerDockHeight - composerDockChromeHeight)
  const composerTargetSessionInfo = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const activeDetail = sessionDetail?.info
    if (
      selectedSessionKey === targetKey
      && activeDetail
      && activeDetail.sessionId === composerTargetSession.sessionId
      && activeDetail.provider === composerTargetSession.provider
    ) {
      return activeDetail
    }
    return sessionDetailCacheRef.current.get(targetKey)?.info ?? null
  }, [composerTargetSession, selectedSessionKey, sessionDetail])
  const composerCurrentModel = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const modelOverride = tuiModelOverride[targetKey]
    const selectedDetailModel = composerTargetSessionInfo?.currentModel
    const reportedModel = tuiReportedModelByKey[targetKey]
    const contextModel = selectedSessionKey === targetKey ? contextUsage?.model : undefined
    const rawModel = modelOverride ?? selectedDetailModel ?? reportedModel ?? contextModel
    if (!rawModel) return null
    const model = formatModelChipValue(rawModel)
    return model && model.toLowerCase() !== 'unknown' ? model : null
  }, [composerTargetSession, composerTargetSessionInfo, contextUsage, selectedSessionKey, tuiModelOverride, tuiReportedModelByKey])
  const composerModelLookupSettled = Boolean(
    composerTargetSessionIdentity
    && Object.prototype.hasOwnProperty.call(tuiReportedModelByKey, composerTargetSessionIdentity),
  )
  const filteredModelPickerOptions = useMemo(
    () => filterModelPickerOptions(modelPickerOptions, modelPickerQuery),
    [modelPickerOptions, modelPickerQuery],
  )

  return {
    presentationHidesComposer, composerDockHeight, composerDockTextareaHeight,
    composerTargetSessionInfo, composerCurrentModel, composerModelLookupSettled,
    filteredModelPickerOptions,
  }
}

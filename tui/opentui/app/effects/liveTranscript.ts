/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type TuiDensity } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { attachedTranscriptCardsForVariant, formatTranscriptCardsAsync, getTranscriptCardsSync } from '../../sessionDetailWorkerClient'
import { type Session } from '../../../../lib/types'

export type TranscriptCardsSyncEffectContext = {
  sessionDetail: TuiSessionDetail | null
  transcriptSession: Session | null
  density: TuiDensity
  showToolCalls: boolean
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setWorkerCardCacheVersion: React.Dispatch<React.SetStateAction<number>>
}

export function runTranscriptCardsSyncEffect(ctx: TranscriptCardsSyncEffectContext) {
  const {
    sessionDetail, transcriptSession, density, showToolCalls, setError, setWorkerCardCacheVersion,
  } = ctx
  if (!sessionDetail || !transcriptSession) return
  const attachedCardsMatch = attachedTranscriptCardsForVariant(sessionDetail, density, showToolCalls) !== null
  const cachedSync = getTranscriptCardsSync(
    transcriptSession,
    sessionDetail.threadedMessages,
    density,
    showToolCalls,
  )
  if (attachedCardsMatch || cachedSync) {
    setError((current) => current?.startsWith('Failed to format transcript') ? null : current)
    return
  }
  let cancelled = false
  setError((current) => current?.startsWith('Failed to format transcript') ? null : current)
  void formatTranscriptCardsAsync(
    transcriptSession,
    sessionDetail.threadedMessages,
    density,
    showToolCalls,
  ).then(() => {
    // Re-render so baseTranscriptCards picks the cards up from the sync
    // cache — required for over-SYNC_FORMAT_CARD_LIMIT sessions, which
    // render empty until this format lands.
    if (!cancelled) setWorkerCardCacheVersion((version) => version + 1)
  }).catch((cause) => {
    if (!cancelled) {
      setError(cause instanceof Error
        ? `Failed to format transcript: ${cause.message}`
        : 'Failed to format transcript')
    }
  })
  return () => {
    cancelled = true
  }
}

/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import React from 'react'
import { addBridgeMessage } from '../../../../lib/bridgeMessages'
import { type Session } from '../../../../lib/types'

export type PersistBridgeMessagesEffectContext = {
  canUseChannelBridge: boolean
  selectedSessionTarget: Session | null
  bridgeTranscriptEntries: { kind: 'sent' | 'reply'; text: string; timestamp: string; }[]
  persistedBridgeCountRef: React.RefObject<number>
}

export function runPersistBridgeMessagesEffect(ctx: PersistBridgeMessagesEffectContext) {
  const {
    canUseChannelBridge, selectedSessionTarget, bridgeTranscriptEntries, persistedBridgeCountRef,
  } = ctx
  if (!canUseChannelBridge || !selectedSessionTarget) return
  const newCount = bridgeTranscriptEntries.length
  const persistedCount = persistedBridgeCountRef.current
  if (newCount <= persistedCount) return

  // Persist only the new entries
  const newEntries = bridgeTranscriptEntries.slice(persistedCount)
  let cancelled = false
  ;(async () => {
    for (const entry of newEntries) {
      if (cancelled) return
      await addBridgeMessage(selectedSessionTarget.provider, selectedSessionTarget.sessionId, entry.kind, entry.text, entry.timestamp)
    }
    if (!cancelled) {
      persistedBridgeCountRef.current = newCount
    }
  })().catch(console.error)
  return () => { cancelled = true }
}

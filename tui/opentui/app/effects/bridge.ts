/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import React from 'react'
import { addBridgeMessage } from '../../../../lib/bridgeMessages'
import { type Session } from '../../../../lib/types'
import { type Dispatch, type SetStateAction } from 'react'
import { loadBridgeMessagesForSession } from '../../../../lib/bridgeMessages'
import { keepEmpty } from '../collections'

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

export type LoadBridgeMessagesEffectContext = {
  canUseChannelBridge: boolean
  selectedSessionTarget: Session | null
  setBridgeTranscriptEntries: React.Dispatch<React.SetStateAction<{ kind: 'sent' | 'reply'; text: string; timestamp: string; }[]>>
  persistedBridgeCountRef: React.RefObject<number>
}

export function runLoadBridgeMessagesEffect(ctx: LoadBridgeMessagesEffectContext) {
  const {
    canUseChannelBridge, selectedSessionTarget, setBridgeTranscriptEntries,
    persistedBridgeCountRef,
  } = ctx
  if (!canUseChannelBridge || !selectedSessionTarget) {
    setBridgeTranscriptEntries(keepEmpty)
    persistedBridgeCountRef.current = 0
    return
  }
  let isMounted = true
  ;(async () => {
    const persisted = await loadBridgeMessagesForSession(selectedSessionTarget.provider, selectedSessionTarget.sessionId)
    if (isMounted) {
      const entries = persisted.map((msg) => ({
        kind: msg.kind,
        text: msg.text,
        timestamp: msg.timestamp,
      }))
      setBridgeTranscriptEntries((current) => current.length === 0 && entries.length === 0 ? current : entries)
      persistedBridgeCountRef.current = entries.length
    }
  })().catch(console.error)
  return () => { isMounted = false }
}

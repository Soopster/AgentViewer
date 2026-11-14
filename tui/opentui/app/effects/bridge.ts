/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import React from 'react'
import { addBridgeMessage } from '../../../../lib/bridgeMessages'
import { type Session } from '../../../../lib/types'
import { type Dispatch, type SetStateAction } from 'react'
import { loadBridgeMessagesForSession } from '../../../../lib/bridgeMessages'
import { keepEmpty } from '../collections'
import { readBridgeConfigFromEnv, subscribeToChannelEvents, type ChannelEvent } from '../../../../lib/channelBridge'
import { flushChannelBridgeOutbox } from '../../../../lib/channelBridgeOutbox'
import { channelBridgeFileOutboxStorage } from '../../../../lib/bridgeMessages'
import { type NoticeTone } from '../types'

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

export type BridgeSubscribeEffectContext = {
  canUseChannelBridge: boolean
  channelBridgeOpen: boolean
  routeComposerToBridge: boolean
  setBridgeTranscriptEntries: React.Dispatch<React.SetStateAction<{ kind: 'sent' | 'reply'; text: string; timestamp: string; }[]>>
  selectedSessionTarget: Session | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

export function runBridgeSubscribeEffect(ctx: BridgeSubscribeEffectContext) {
  const {
    canUseChannelBridge, channelBridgeOpen, routeComposerToBridge, setBridgeTranscriptEntries,
    selectedSessionTarget, showNotice,
  } = ctx
  if (!canUseChannelBridge || (!channelBridgeOpen && !routeComposerToBridge)) return
  const config = readBridgeConfigFromEnv()
  let entrySeq = 0
  const unsubscribe = subscribeToChannelEvents(
    config,
    (event: ChannelEvent) => {
      if (event.type === 'reply') {
        const timestamp = new Date(Date.now() + entrySeq * 100).toISOString()
        setBridgeTranscriptEntries((prev) => [...prev, { kind: 'reply', text: event.text, timestamp }])
        entrySeq += 1
      }
    },
    (status) => {
      if (status !== 'connected' || !selectedSessionTarget) return
      void flushChannelBridgeOutbox(
        channelBridgeFileOutboxStorage,
        config,
        selectedSessionTarget.sessionId,
      ).then((result) => {
        if (result.error) showNotice('error', `Channel message remains queued: ${result.error.message}`)
      })
    },
  )
  return unsubscribe
}

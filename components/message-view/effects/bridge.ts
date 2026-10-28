import type { Session } from '../../../lib/types'
import type { RefObject } from 'react'

export type BridgePersistEffectContext = {
  canUseChannelBridge: boolean
  session: Session | null
  bridgeTranscriptEntries: { kind: 'sent' | 'reply'; text: string; timestamp: string; }[]
  persistedBridgeCountRef: RefObject<number>
}

export function runBridgePersistEffect(ctx: BridgePersistEffectContext) {
  const {
    canUseChannelBridge, session, bridgeTranscriptEntries, persistedBridgeCountRef,
  } = ctx
  if (!canUseChannelBridge || !session) return
  const newCount = bridgeTranscriptEntries.length
  const persistedCount = persistedBridgeCountRef.current
  if (newCount <= persistedCount) return

  // Persist only the new entries
  const newEntries = bridgeTranscriptEntries.slice(persistedCount)
  let cancelled = false
  ;(async () => {
    for (const entry of newEntries) {
      if (cancelled) return
      try {
        const res = await fetch('/api/bridge-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: session.provider,
            providerInstanceId: session.providerInstanceId,
            sessionId: session.sessionId,
            kind: entry.kind,
            text: entry.text,
            timestamp: entry.timestamp,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch (err) {
        console.error('[bridge-messages] Failed to save:', err)
      }
    }
    if (!cancelled) {
      persistedBridgeCountRef.current = newCount
    }
  })()
  return () => { cancelled = true }
}

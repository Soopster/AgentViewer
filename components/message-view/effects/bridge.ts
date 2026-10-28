import type { Session } from '../../../lib/types'
import type { RefObject } from 'react'
import { type Dispatch, type SetStateAction } from 'react'
import { type ChannelBridge } from '../../useChannelBridge'
import { type PendingPermission } from '@/lib/permissions'

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

export type BridgeLoadEffectContext = {
  canUseChannelBridge: boolean
  session: Session | null
  setBridgeTranscriptEntries: Dispatch<SetStateAction<{ kind: 'sent' | 'reply'; text: string; timestamp: string; }[]>>
  persistedBridgeCountRef: RefObject<number>
}

export function runBridgeLoadEffect(ctx: BridgeLoadEffectContext) {
  const {
    canUseChannelBridge, session, setBridgeTranscriptEntries, persistedBridgeCountRef,
  } = ctx
  if (!canUseChannelBridge || !session) {
    setBridgeTranscriptEntries([])
    persistedBridgeCountRef.current = 0
    return
  }
  let isMounted = true
  ;(async () => {
    try {
      const res = await fetch(`/api/bridge-messages?provider=${encodeURIComponent(session.provider ?? 'claude')}&sessionId=${encodeURIComponent(session.sessionId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { messages: Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }> }
      if (isMounted) {
        setBridgeTranscriptEntries(data.messages)
        persistedBridgeCountRef.current = data.messages.length
      }
    } catch (err) {
      console.error('[bridge-messages] Failed to load:', err)
    }
  })()
  return () => { isMounted = false }
}

export type BridgePermissionsEffectContext = {
  channelBridge: ChannelBridge
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
}

export function runBridgePermissionsEffect(ctx: BridgePermissionsEffectContext) {
  const {
    channelBridge, setPendingPermissions,
  } = ctx
  const permissionEntries = channelBridge.entries.filter(
    (e): e is Extract<typeof e, { kind: 'permission' }> => e.kind === 'permission'
  )
  setPendingPermissions((prev) => {
    const newPerms = permissionEntries
      .filter((entry) => !prev.some((p) => p.id === entry.id))
      .map((entry) => ({
        id: entry.id,
        title: entry.request.tool_name || 'CLI bridge permission',
        detail: entry.request.description,
        toolName: entry.request.tool_name,
        reason: entry.request.input_preview,
      }))
    if (newPerms.length === 0) return prev
    return [...prev, ...newPerms]
  })
}

export type BridgeEntriesEffectContext = {
  channelBridge: ChannelBridge
  setBridgeTranscriptEntries: Dispatch<SetStateAction<{ kind: 'sent' | 'reply'; text: string; timestamp: string; }[]>>
}

export function runBridgeEntriesEffect(ctx: BridgeEntriesEffectContext) {
  const {
    channelBridge, setBridgeTranscriptEntries,
  } = ctx
  const entries = channelBridge.entries.filter(
    (e): e is Extract<typeof e, { kind: 'sent' | 'reply' }> => e.kind === 'sent' || e.kind === 'reply'
  )
  setBridgeTranscriptEntries((prev) => {
    // Find entries we haven't already added
    const newEntries = entries.filter((entry) =>
      !prev.some((p) => p.kind === entry.kind && p.text === entry.text)
    )
    if (newEntries.length === 0) return prev
    return [
      ...prev,
      ...newEntries.map((e) => ({
        kind: e.kind,
        text: e.text,
        timestamp: new Date().toISOString(),
      })),
    ]
  })
}

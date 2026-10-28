import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { extractPendingPermissions, type PendingPermission } from '@/lib/permissions'
import { REATTACH_POLL_MS } from '../constants'
import { type ThreadedMessage } from '@/lib/threading'
import { type PendingMessageBaseline, type SteeredSendEntry, type LiveToolActivity } from '../types'
import { AWAITING_PERSISTED_TURN_TIMEOUT_MS } from '../constants'
import { type SessionMessage } from '../../../lib/types'
import { isDurableSessionMessage, sessionMessageFingerprint, messagesChangedSinceBaseline } from '../threadedCompare'

export type ReattachRunningEffectContext = {
  session: Session | null
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; } | undefined
  setReattachedRunning: Dispatch<SetStateAction<boolean>>
  setRunningProbeReadyKey: Dispatch<SetStateAction<string | null>>
  sendInFlightRef: MutableRefObject<boolean>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  reattachedRunningRef: MutableRefObject<boolean>
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
}

export function runReattachRunningEffect(ctx: ReattachRunningEffectContext) {
  const {
    session, projectView, setReattachedRunning, setRunningProbeReadyKey, sendInFlightRef,
    awaitingPersistedTurnRef, reattachedRunningRef, setPendingPermissions,
  } = ctx
  if (!session || projectView) {
    setReattachedRunning(false)
    setRunningProbeReadyKey(null)
    return
  }
  const sessionId = session.sessionId
  const sessionProvider = session.provider ?? 'claude'
  const probeKey = `${sessionProvider}:${sessionId}`
  setRunningProbeReadyKey(null)
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const poll = async () => {
    if (cancelled) return
    // We own a live turn already — the stream renders it; don't double-track.
    if (sendInFlightRef.current || awaitingPersistedTurnRef.current) {
      if (reattachedRunningRef.current) setReattachedRunning(false)
      timer = setTimeout(poll, REATTACH_POLL_MS)
      return
    }
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/running`, { cache: 'no-store' })
      if (!cancelled && res.ok) {
        const info = (await res.json().catch(() => null)) as
          | {
              running?: boolean
              pendingPrompts?: Record<string, unknown>[]
              pendingPermissions?: Record<string, unknown>[]
            }
          | null
        if (cancelled) return
        const running = info?.running === true
        setReattachedRunning((prev) => (prev === running ? prev : running))
        setRunningProbeReadyKey(probeKey)
        // Re-surface any provider-native approval/question the turn is
        // blocked on. The original SSE may be gone after reload/navigation,
        // but the process-local resolver remains answerable by id.
        const permissionPayloads = Array.isArray(info?.pendingPermissions)
          ? info.pendingPermissions
          : (Array.isArray(info?.pendingPrompts) ? info.pendingPrompts : []).map((data) => ({
              type: 'claude_permission',
              event: { type: 'permission.requested', data },
            }))
        const reattached = extractPendingPermissions(permissionPayloads, {
          sessionId,
          provider: sessionProvider,
        })
        setPendingPermissions((prev) => {
          const others = prev.filter((p) => !(p.provider === sessionProvider && p.sessionId === sessionId))
          const nextIds = [...others, ...reattached].map((p) => p.id).join('|')
          const prevIds = prev.map((p) => p.id).join('|')
          return nextIds === prevIds ? prev : [...others, ...reattached]
        })
      }
    } catch {
      // best-effort; a failed probe just leaves the prior state
    }
    if (!cancelled) timer = setTimeout(poll, REATTACH_POLL_MS)
  }
  void poll()
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}

export type OptimisticTextTimeoutEffectContext = {
  awaitingPersistedTurn: boolean
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  clearLiveSubagentText: () => void
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
}

export function runOptimisticTextTimeoutEffect(ctx: OptimisticTextTimeoutEffectContext) {
  const {
    awaitingPersistedTurn, setOptimisticUserText, setSteeredUserTexts, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    awaitingPersistedTurnRef, setAwaitingPersistedTurn, pendingMessageBaselineRef,
    liveToolIndexesRef, liveToolInputJsonRef,
  } = ctx
  if (!awaitingPersistedTurn) return
  const timer = window.setTimeout(() => {
    setOptimisticUserText(null)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    clearLiveSubagentText()
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
  }, AWAITING_PERSISTED_TURN_TIMEOUT_MS)
  return () => window.clearTimeout(timer)
}

export type OptimisticTextEffectContext = {
  awaitingPersistedTurn: boolean
  session: Session | null
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  messages: SessionMessage[]
  liveAssistantTextRef: MutableRefObject<string>
  liveThreadedMessages: ThreadedMessage[]
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  clearLiveSubagentText: () => void
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
  autoFollow: boolean
  scrollTimelineToBottom: (behavior?: ScrollBehavior) => void
}

export function runOptimisticTextEffect(ctx: OptimisticTextEffectContext) {
  const {
    awaitingPersistedTurn, session, pendingMessageBaselineRef, messages, liveAssistantTextRef,
    liveThreadedMessages, setOptimisticUserText, setSteeredUserTexts, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    awaitingPersistedTurnRef, setAwaitingPersistedTurn, liveToolIndexesRef, liveToolInputJsonRef,
    autoFollow, scrollTimelineToBottom,
  } = ctx
  if (!awaitingPersistedTurn || !session) return

  const baseline = pendingMessageBaselineRef.current
  if (!baseline || baseline.sessionId !== session.sessionId) return

  const durableMessages = messages.filter(isDurableSessionMessage)
  const currentLastMessage = durableMessages.at(-1)
  const currentLastUuid = currentLastMessage?.uuid ?? null
  const currentLastFingerprint = sessionMessageFingerprint(currentLastMessage)
  const changedMessages = messagesChangedSinceBaseline(durableMessages, baseline)
  const persistedTurnArrived =
    changedMessages.length > 0
    || durableMessages.length !== baseline.count
    || currentLastUuid !== baseline.lastUuid
    || currentLastFingerprint !== baseline.lastFingerprint
  const persistedAssistantArrived = changedMessages.some((message) => message.type === 'assistant')
  const liveAssistantVisible = liveAssistantTextRef.current.trim().length > 0 || liveThreadedMessages.length > 0

  if (persistedTurnArrived && (persistedAssistantArrived || !liveAssistantVisible)) {
    setOptimisticUserText(null)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    clearLiveSubagentText()
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    if (autoFollow) {
      window.requestAnimationFrame(() => scrollTimelineToBottom())
    }
  }
}

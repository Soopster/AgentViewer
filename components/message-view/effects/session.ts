import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { extractPendingPermissions, type PendingPermission } from '@/lib/permissions'
import { REATTACH_POLL_MS } from '../constants'

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

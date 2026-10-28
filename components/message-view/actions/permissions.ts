import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { Session } from '../../../lib/types'
import { readOptionalJsonResponse } from '@/lib/httpResponse'
import { isPendingRequestGone, PENDING_REQUEST_GONE_NOTICE } from '@/lib/pendingRequestGone'
import { type PendingPermission } from '@/lib/permissions'
import { respondToChannelPermission, readBridgeConfigFromEnv } from '@/lib/channelBridge'
import { permissionDenialReason } from '../composerStorage'

export type RespondToPermissionContext = {
  setSessionActionLoading: Dispatch<SetStateAction<string | null>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
  session: Session | null
  sessionActionLoading: string | null
}

export async function runRespondToPermission(ctx: RespondToPermissionContext, permission: PendingPermission, response: 'once' | 'always' | 'reject', permissionMode?: 'acceptEdits' | 'default') {
  const {
    setSessionActionLoading, setSessionActionError, setPendingPermissions, session,
    sessionActionLoading,
  } = ctx
  if (response === 'once' && permission.elicitation?.mode === 'url' && permission.url) {
    window.open(permission.url, '_blank', 'noopener,noreferrer')
  }
  // Bridge permissions are those without a sessionId (they came from the CLI bridge)
  if (!permission.sessionId && !permission.provider) {
    setSessionActionLoading(`permission:${permission.id}`)
    setSessionActionError(null)
    try {
      const behavior = response === 'reject' ? 'deny' : 'allow'
      await respondToChannelPermission(readBridgeConfigFromEnv(), permission.id, behavior)
      setPendingPermissions((prev) => prev.filter((entry) => entry.id !== permission.id))
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to respond to bridge permission')
    } finally {
      setSessionActionLoading(null)
    }
    return
  }

  if (!session || sessionActionLoading) return
  setSessionActionLoading(`permission:${permission.id}`)
  setSessionActionError(null)
  try {
    const targetSessionId = permission.sessionId ?? session.sessionId
    const res = await fetch(`/api/sessions/${targetSessionId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'respondPermission',
        permissionId: permission.id,
        response,
        permissionDecisionReason: response === 'reject' ? permissionDenialReason(permission) : undefined,
        permissionMode,
        provider: session.provider,
        providerInstanceId: session.providerInstanceId,
      }),
    })
    const data = await readOptionalJsonResponse(res, {})
    if (data.error) throw Object.assign(new Error(data.error), { code: (data as { code?: string }).code })
    setPendingPermissions((prev) => prev.filter((entry) =>
      entry.id !== permission.id || (permission.sessionId !== undefined && entry.sessionId !== permission.sessionId)
    ))
  } catch (err) {
    if (isPendingRequestGone(err)) {
      setPendingPermissions((prev) => prev.filter((entry) =>
        entry.id !== permission.id || (permission.sessionId !== undefined && entry.sessionId !== permission.sessionId)
      ))
      setSessionActionError(PENDING_REQUEST_GONE_NOTICE)
    } else {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to respond to permission')
    }
  } finally {
    setSessionActionLoading(null)
  }
}

import type { Dispatch, SetStateAction } from 'react'
import type { Session, SessionCapabilities } from '@/lib/types'
import type { SessionDeleteCallback } from '@/components/session-catalog/actions'
import { readOptionalJsonResponse } from '@/lib/httpResponse'
import { withProviderQuery } from '../threadedCompare'

export type HandleDeleteSessionContext = {
  session: Session | null
  deleting: boolean
  sessionCapabilities: SessionCapabilities | undefined
  setDeleting: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  onDelete: SessionDeleteCallback | undefined
}

export async function runHandleDeleteSession(ctx: HandleDeleteSessionContext) {
  const {
    session, deleting, sessionCapabilities, setDeleting, setSessionActionError,
    setSessionActionNotice, onDelete,
  } = ctx
  if (!session || deleting || !sessionCapabilities?.deleteSession) return
  const confirmed = window.confirm('Delete this session? This cannot be undone from Agent Viewer.')
  if (!confirmed) return
  setDeleting(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(withProviderQuery(`/api/sessions/${encodeURIComponent(session.sessionId)}`, session.provider, session.providerInstanceId), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await readOptionalJsonResponse(res, {})
    if (data.error) throw new Error(data.error)
    onDelete?.(session)
    setSessionActionNotice('Session deleted.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to delete session')
  } finally {
    setDeleting(false)
  }
}


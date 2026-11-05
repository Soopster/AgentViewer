'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Session } from '@/lib/types'

export function useSessionInbox(session: Session) {
  const [inbox, setInbox] = useState(session.inbox)

  useEffect(() => setInbox(session.inbox), [session.inbox])

  const updateInbox = useCallback(async (action: 'pin' | 'unpin' | 'settle' | 'reopen' | 'snooze' | 'unsnooze' | 'unlink-pr') => {
    const previous = inbox
    const optimistic = action === 'pin'
      ? { ...inbox, pinnedAt: Date.now(), pinOrder: inbox?.pinOrder ?? Date.now() }
      : action === 'unpin'
        ? { ...inbox, pinnedAt: undefined, pinOrder: undefined }
        : action === 'settle'
          ? { ...inbox, settledAt: Date.now(), snoozedUntil: undefined }
          : action === 'reopen' || action === 'unsnooze'
            ? { ...inbox, settledAt: action === 'reopen' ? undefined : inbox?.settledAt, snoozedUntil: undefined }
            : action === 'unlink-pr'
              ? { ...inbox, linkedPr: undefined }
              : { ...inbox, snoozedUntil: Date.now() + 60 * 60 * 1000, settledAt: undefined }
    setInbox(optimistic)
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/inbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error ?? 'Inbox update failed')
      setInbox(data.inbox)
    } catch {
      setInbox(previous)
    }
  }, [inbox, session.provider, session.providerInstanceId, session.sessionId])

  return { inbox, updateInbox }
}

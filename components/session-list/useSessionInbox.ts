'use client'

import { useEffect, useSyncExternalStore } from 'react'
import type { Session, SessionInboxState } from '@/lib/types'
import { sessionTabKey } from './presentation'

export type SessionInboxAction = 'pin' | 'unpin' | 'settle' | 'reopen' | 'snooze' | 'unsnooze' | 'unlink-pr'

// One optimistic inbox per session, shared by everything that shows or changes
// it (the row's ★ ✓ z buttons, the right-click menu), so a pin from the menu
// lights the star at once instead of after the next list poll. An entry is
// dropped when the list delivers the session's inbox again.
// Each override remembers the inbox the list had when it was made, so a row that
// remounts (it moved into the PINNED group) keeps it until the list moves on.
const overrides = new Map<string, { base: SessionInboxState | undefined; value: SessionInboxState | undefined }>()
const listeners = new Set<() => void>()
let version = 0
const notify = () => { version += 1; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

function optimistic(inbox: SessionInboxState | undefined, action: SessionInboxAction): SessionInboxState | undefined {
  switch (action) {
    case 'pin': return { ...inbox, pinnedAt: Date.now(), pinOrder: inbox?.pinOrder ?? Date.now() }
    case 'unpin': return { ...inbox, pinnedAt: undefined, pinOrder: undefined }
    case 'settle': return { ...inbox, settledAt: Date.now(), snoozedUntil: undefined }
    case 'reopen': return { ...inbox, settledAt: undefined, snoozedUntil: undefined }
    case 'unsnooze': return { ...inbox, snoozedUntil: undefined }
    case 'unlink-pr': return { ...inbox, linkedPr: undefined }
    case 'snooze': return { ...inbox, snoozedUntil: Date.now() + 60 * 60 * 1000, settledAt: undefined }
  }
}

/** Changes whenever an optimistic inbox does: lets list-level memos (the PINNED group) re-run at once. */
export function useSessionInboxVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0)
}

/** Pinned, counting a pin made here that the list has not delivered yet. */
export function isSessionPinned(session: Session): boolean {
  return session.isPinned === true || currentSessionInbox(session)?.pinnedAt !== undefined
}

export function currentSessionInbox(session: Session): SessionInboxState | undefined {
  const key = sessionTabKey(session)
  const override = overrides.get(key)
  return override && override.base === session.inbox ? override.value : session.inbox
}

export async function updateSessionInbox(session: Session, action: SessionInboxAction): Promise<void> {
  const key = sessionTabKey(session)
  const previous = currentSessionInbox(session)
  const base = session.inbox
  overrides.set(key, { base, value: optimistic(previous, action) })
  notify()
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? 'Inbox update failed')
    overrides.set(key, { base, value: data.inbox })
  } catch {
    overrides.set(key, { base, value: previous })
  }
  notify()
}

export function useSessionInbox(session: Session) {
  const key = sessionTabKey(session)
  // The list delivered a newer inbox for this session: it is the truth now.
  useEffect(() => {
    const override = overrides.get(key)
    if (!override || override.base === session.inbox) return
    overrides.delete(key)
    notify()
  }, [key, session.inbox])
  const inbox = useSyncExternalStore(subscribe, () => currentSessionInbox(session), () => session.inbox)
  return { inbox, updateInbox: (action: SessionInboxAction) => updateSessionInbox(session, action) }
}

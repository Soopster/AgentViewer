'use client'

import type { Session } from '@/lib/types'
import { useSessionInbox } from './useSessionInbox'
import { inboxButtonStyle } from './appearance'

export function SessionInboxControls({ session, hovered }: { session: Session; hovered: boolean }) {
  const { inbox, updateInbox } = useSessionInbox(session)
  return (<>{inbox?.linkedPr ? (
          <span
            title={`${inbox.linkedPr.repo}#${inbox.linkedPr.number}${inbox.linkedPr.state ? ` — ${inbox.linkedPr.state.toLowerCase()}` : ''}\nClick to open, shift-click to unlink`}
            onClick={(event) => {
              event.stopPropagation()
              if (event.shiftKey) { void updateInbox('unlink-pr'); return }
              if (inbox.linkedPr?.url) window.open(inbox.linkedPr.url, '_blank', 'noopener,noreferrer')
            }}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 5,
              cursor: 'pointer',
              marginLeft: 6,
              color: inbox.linkedPr.state === 'MERGED' ? 'var(--violet)' : 'var(--text-3)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}
          >
            #{inbox.linkedPr.number}
          </span>
        ) : null}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 2,
            opacity: hovered || inbox ? 1 : 0,
            pointerEvents: hovered || inbox ? 'auto' : 'none',
          }}
        >
          <button type="button" title={inbox?.pinnedAt ? 'Unpin' : 'Pin'} onClick={(event) => { event.stopPropagation(); void updateInbox(inbox?.pinnedAt ? 'unpin' : 'pin') }} style={inboxButtonStyle(Boolean(inbox?.pinnedAt))}>{inbox?.pinnedAt ? '★' : '☆'}</button>
          <button type="button" title={inbox?.settledAt ? 'Reopen' : 'Settle'} onClick={(event) => { event.stopPropagation(); void updateInbox(inbox?.settledAt ? 'reopen' : 'settle') }} style={inboxButtonStyle(Boolean(inbox?.settledAt))}>{inbox?.settledAt ? '↺' : '✓'}</button>
          <button type="button" title={inbox?.snoozedUntil ? 'Unsnooze' : 'Snooze 1h'} onClick={(event) => { event.stopPropagation(); void updateInbox(inbox?.snoozedUntil ? 'unsnooze' : 'snooze') }} style={inboxButtonStyle(Boolean(inbox?.snoozedUntil))}>z</button>
        </div></>)
}

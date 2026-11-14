'use client'
// The rail's right-click session menu: the TUI's (pin, rename, settle, copy
// the id or the CLI resume command, …), with the actions the web can take.
import { useEffect, useRef } from 'react'
import type { Session } from '@/lib/types'
import { currentSessionInbox, updateSessionInbox } from './useSessionInbox'
import { getSessionTitle } from './presentation'
import { getContinueInCliCommand } from '@/lib/cliContinue'

export type SessionMenuState = { session: Session; x: number; y: number }

export function SessionContextMenu({ menu, onClose, onOpen, onRename }: {
  menu: SessionMenuState
  onClose: () => void
  onOpen: (session: Session) => void
  onRename: (session: Session) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [onClose])
  const { session } = menu
  const inbox = currentSessionInbox(session)
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => {}) }
  // The same command the TUI's menu copies.
  const command = getContinueInCliCommand(session.provider ?? 'claude', session.sessionId, session.cwd)
  const items: Array<{ label: string; run: () => void } | null> = [
    { label: 'Open', run: () => onOpen(session) },
    null,
    { label: inbox?.pinnedAt ? 'Unpin session' : 'Pin session', run: () => void updateSessionInbox(session, inbox?.pinnedAt ? 'unpin' : 'pin') },
    { label: 'Rename session', run: () => onRename(session) },
    { label: inbox?.settledAt ? 'Reopen session' : 'Settle session', run: () => void updateSessionInbox(session, inbox?.settledAt ? 'reopen' : 'settle') },
    { label: inbox?.snoozedUntil ? 'Unsnooze' : 'Snooze 1 hour', run: () => void updateSessionInbox(session, inbox?.snoozedUntil ? 'unsnooze' : 'snooze') },
    null,
    { label: 'Copy session ID', run: () => copy(session.sessionId) },
    ...(command ? [{ label: 'Copy CLI resume command', run: () => copy(command) }] : []),
    ...(session.cwd ? [{ label: 'Copy working directory', run: () => copy(session.cwd!) }] : []),
  ]
  const top = Math.min(menu.y, (typeof window === 'undefined' ? 800 : window.innerHeight) - 24 * items.length - 40)
  return (
    <div ref={ref} role="menu" data-testid="session-context-menu" style={{
      position: 'fixed', top, left: menu.x, zIndex: 90, minWidth: 210, padding: '6px 0',
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 28px rgba(0,0,0,0.4)',
    }}>
      <div style={{ padding: '2px 14px 6px', fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
        {getSessionTitle(session) || session.sessionId.slice(0, 12)}
      </div>
      {items.map((item, index) => item === null
        ? <div key={`sep-${index}`} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        : (
          <button key={item.label} type="button" role="menuitem" className="av-hover-control"
            onClick={() => { item.run(); onClose() }}
            style={{ display: 'block', width: '100%', padding: '5px 14px', background: 'transparent', border: 0, textAlign: 'left', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)' }}>
            {item.label}
          </button>
        ))}
    </div>
  )
}

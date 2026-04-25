'use client'

import { ViewTransition } from 'react'
import type { Session } from '@/lib/types'

function sessionTabTitle(session: Session): string {
  return (
    session.customTitle ??
    (session.n as string | undefined) ??
    session.summary ??
    (typeof session.firstPrompt === 'string' ? session.firstPrompt.slice(0, 40) : undefined) ??
    session.sessionId.slice(-8)
  ) || 'Untitled'
}

function sessionTabKey(session: Session): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

type Props = {
  tabs: Session[]
  activeId: string | null
  onSelect: (session: Session) => void
  onClose: (sessionKey: string) => void
}

export default function TabBar({ tabs, activeId, onSelect, onClose }: Props) {
  if (tabs.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        height: 34,
        flexShrink: 0,
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}
    >
      {tabs.map((session) => {
        const tabKey = sessionTabKey(session)
        const isActive = tabKey === activeId
        const title = sessionTabTitle(session)
        return (
          <ViewTransition key={tabKey} enter="fade-in" exit="fade-out" default="none">
          <button
            onClick={() => onSelect(session)}
            title={title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              paddingLeft: 12,
              paddingRight: 4,
              backgroundColor: isActive ? 'var(--surface-3)' : 'transparent',
              border: 'none',
              borderRight: '1px solid var(--border)',
              borderBottom: isActive
                ? '2px solid var(--cyan)'
                : '2px solid transparent',
              cursor: 'pointer',
              minWidth: 80,
              maxWidth: 200,
              color: isActive ? 'var(--cyan)' : 'var(--text-2)',
              fontSize: 12,
              fontFamily: 'var(--font-mono, "IBM Plex Mono", monospace)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              outline: 'none',
              transition: 'background-color 0.1s',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                textAlign: 'left',
              }}
            >
              {title}
            </span>
            <span
              role="button"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                onClose(sessionTabKey(session))
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-3)'
              }}
              style={{
                color: 'var(--text-3)',
                fontSize: 15,
                lineHeight: 1,
                padding: '2px 5px',
                borderRadius: 3,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 0.1s, color 0.1s',
              }}
            >
              ×
            </span>
          </button>
          </ViewTransition>
        )
      })}
    </div>
  )
}

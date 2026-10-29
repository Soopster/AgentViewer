'use client'

import { useMemo, useContext } from 'react'
import type { Session } from '@/lib/types'
import { parseStoredSessionTags } from '@/lib/sessionTags'
import { Input } from '@/components/ui/input'

import { providerChipStyle, providerLabel } from './presentation'
import { ShowProviderContext } from './contexts'
import { SessionInboxControls } from './SessionInboxControls'
import type { useSessionRowEditing } from './useSessionRowEditing'

type RowEditor = ReturnType<typeof useSessionRowEditing>

export function SessionRowMetadata({ session, selected, hovered, editor }: {
  session: Session
  selected: boolean
  hovered: boolean
  editor: RowEditor
}) {
  const { editing, editValue, setEditValue, inputRef, startEdit, commitTagEdit, handleKeyDown } = editor
  const shortId = useMemo(() => session.sessionId.slice(-12), [session.sessionId])
  const sessionTags = useMemo(() => parseStoredSessionTags(session.tag), [session.tag])
  const providerStyle = useMemo(
    () => (session.provider ? providerChipStyle(session.provider) : null),
    [session.provider],
  )
  const showProvider = useContext(ShowProviderContext)
  return (<div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
        <span
          title={session.sessionId}
          className="av-session-id"
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: 'var(--text-2)',
            flexShrink: 0,
          }}
        >
          {shortId}
        </span>
        {session.provider && showProvider && (
          <span
            title={session.provider}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: 'var(--text-2)',
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: providerStyle?.color ?? 'var(--text-3)',
                flexShrink: 0,
              }}
            />
            {providerLabel(session.provider)}
          </span>
        )}
        {editing === 'tag' ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitTagEdit}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            autoFocus
            placeholder="tag1, tag2"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              background: 'var(--surface-3)',
              border: '1px solid var(--violet)',
              borderRadius: 3,
              color: 'var(--text)',
              padding: '1px 6px',
              outline: 'none',
              width: 160,
            }}
          />
        ) : sessionTags.length > 0 ? (
          <div
            onDoubleClick={startEdit('tag', sessionTags.join(', '))}
            title="Double-click to edit tags"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              minWidth: 0,
            }}
          >
        {sessionTags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  background: selected ? 'rgba(139,128,240,0.16)' : 'rgba(139,128,240,0.08)',
                  color: 'var(--violet)',
                  padding: '1px 6px',
                  borderRadius: 3,
                  border: '1px solid rgba(139,128,240,0.22)',
                  letterSpacing: '0.03em',
                  cursor: 'text',
                }}
              >
                #{tag}
              </span>
        ))}
      </div>
        ) : hovered ? (
          <span
            onDoubleClick={startEdit('tag', '')}
            onClick={e => { e.stopPropagation(); startEdit('tag', '')(e) }}
            title="Click to add tags"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              padding: '1px 4px',
              borderRadius: 3,
              border: '1px dashed var(--border-2)',
              letterSpacing: '0.03em',
              cursor: 'text',
            }}
          >
            + tags
          </span>
        ) : null}
        <SessionInboxControls session={session} hovered={hovered} />
      </div>)
}

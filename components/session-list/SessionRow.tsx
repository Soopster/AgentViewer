'use client'

import { useSessionRowEditing } from './useSessionRowEditing'
import { SessionAttentionBadge } from './SessionAttentionBadge'
import { SessionRowMetadata } from './SessionRowMetadata'

import { memo, useState, useMemo } from 'react'

import type { Session } from '@/lib/types'

import { Input } from '@/components/ui/input'

import { timeAgo, formatTimestamp, formatStableTimestamp, formatStableTimeLabel, getSessionTitle, getSessionPreview, sessionTabKey } from './presentation'

export const SessionRow = memo(function SessionRow({
  session,
  selected,
  hydrated,
  onSelect,
  onRename,
  onTag,
}: {
  session: Session
  selected: boolean
  hydrated: boolean
  onSelect: (session: Session) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}) {
  const [hovered, setHovered] = useState(false)
  const editor = useSessionRowEditing(session, { onRename, onTag })
  const { editing, editValue, setEditValue, inputRef, startEdit, commitTitleEdit, handleKeyDown } = editor
  
  const sessionTitle = getSessionTitle(session)
  const sessionPreview = useMemo(() => getSessionPreview(session, sessionTitle), [session, sessionTitle])
  
  const activityTime = session.lastModified ?? session.createdAt
  const activityTitle = useMemo(
    () => (hydrated ? formatTimestamp(activityTime) : formatStableTimestamp(activityTime)),
    [activityTime, hydrated],
  )
  
  
  // Waiting outranks a finished result, and a result alone never reads as
  // urgent — the same split the TUI badge makes.

  return (
    <div
      onClick={() => !editing && onSelect(session)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`av-session-row ${selected ? 'av-selected' : ''}`}
      data-session-key={sessionTabKey(session)}
      style={{
        padding: '9px 16px 9px 24px',
        borderBottom: '1px solid var(--border)',
        contentVisibility: 'auto',
        // `auto 96px` lets the browser remember the real measured row height
        // after the row has been painted once, instead of forcing the layout
        // back to a 96px estimate every time the row scrolls off-screen — that
        // mismatch was the main cause of perceived flicker while scrolling.
        containIntrinsicSize: 'auto 96px',
      }}
    >
      {/* Title + id */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        {editing === 'title' ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            autoFocus
            style={{
              fontSize: 13,
              background: 'var(--surface-3)',
              border: '1px solid var(--violet)',
              borderRadius: 6,
              color: 'var(--text)',
              padding: '4px 7px',
              outline: 'none',
              width: '100%',
              maxWidth: 210,
            }}
          />
        ) : sessionTitle ? (
          <div
            onDoubleClick={startEdit('title', sessionTitle)}
            title="Double-click to rename title"
            className="av-session-title"
            style={{
              fontSize: 13,
              fontWeight: 600,
              cursor: 'text',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sessionTitle}
          </div>
        ) : (
          <span
            onDoubleClick={startEdit('title', '')}
            onClick={e => { e.stopPropagation(); startEdit('title', '')(e) }}
            title="Click to add a title"
            style={{
              fontSize: 13,
              color: 'var(--text-3)',
              cursor: 'text',
              opacity: hovered ? 1 : 0.6,
            }}
          >
            {hovered ? 'Add a title' : 'Untitled'}
          </span>
        )}
        </div>
        <SessionAttentionBadge sessionKey={sessionTabKey(session)} />
        {editing !== 'title' && activityTime != null && (
          <span
            title={activityTitle}
            style={{ fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}
          >
            {hydrated ? timeAgo(activityTime) : formatStableTimeLabel(activityTime)}
          </span>
        )}
      </div>
      {session.parentSessionId && (
        <div
          title={`Subagent of ${session.parentSessionId}`}
          style={{
            marginTop: 3,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: 'var(--text-3)',
          }}
        >
          ↪ child of {session.parentSessionId.slice(-8)}
        </div>
      )}

      {sessionPreview && editing !== 'title' && (
        <div
          title={sessionPreview}
          style={{
            marginTop: 3,
            fontSize: 12,
            color: 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sessionPreview}
        </div>
      )}

      {/* Tag + time */}
      <SessionRowMetadata session={session} selected={selected} hovered={hovered} editor={editor} />
    </div>
  )
})

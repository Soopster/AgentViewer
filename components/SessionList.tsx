'use client'

import { useState, useRef, useCallback } from 'react'
import type { Session } from '@/lib/types'
import ThemeToggle from './ThemeToggle'

type Props = {
  sessions: Session[]
  loading: boolean
  error: string | null
  selectedId: string | null
  selectedProject: string | null
  onSelect: (id: string) => void
  onSelectProject: (key: string, sessions: Session[]) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 60)  return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Group sessions by the last path component of cwd, preserving first-seen order. */
function groupByProject(sessions: Session[]): Map<string, Session[]> {
  const map = new Map<string, Session[]>()
  for (const s of sessions) {
    const key = s.cwd?.split('/').pop() ?? '—'
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  return map
}

function getSessionTitle(session: Session): string {
  return session.customTitle ?? session.summary ?? ''
}

function SessionRow({
  session,
  selected,
  onSelect,
  onRename,
  onTag,
}: {
  session: Session
  selected: boolean
  onSelect: (id: string) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState<'title' | 'tag' | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const shortId = session.sessionId.slice(-12)
  const sessionTitle = getSessionTitle(session)

  const startEdit = useCallback((kind: 'title' | 'tag', value: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(value)
    setEditing(kind)
    // Focus after next render
    setTimeout(() => inputRef.current?.select(), 0)
  }, [])

  const commitTitleEdit = useCallback(async () => {
    setEditing(null)
    const value = editValue.trim()
    if (!value || value === sessionTitle) return
    onRename(session.sessionId, value)
    try {
      await fetch(`/api/sessions/${session.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: value }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onRename, session.sessionId, sessionTitle])

  const commitTagEdit = useCallback(async () => {
    setEditing(null)
    const value = editValue.trim()
    const nextTag = value || null
    if (nextTag === (session.tag ?? null)) return
    onTag(session.sessionId, nextTag)
    try {
      await fetch(`/api/sessions/${session.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: nextTag }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onTag, session.sessionId, session.tag])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (editing === 'title') commitTitleEdit()
      if (editing === 'tag') commitTagEdit()
    }
    if (e.key === 'Escape') setEditing(null)
  }, [commitTagEdit, commitTitleEdit, editing])

  return (
    <div
      onClick={() => !editing && onSelect(session.sessionId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 16px 10px 24px',
        borderBottom: '1px solid var(--border)',
        borderLeft: `2px solid ${selected ? 'var(--violet)' : hovered ? 'var(--border-2)' : 'transparent'}`,
        background: selected
          ? 'linear-gradient(to right, rgba(139,128,240,0.13) 0%, transparent 65%)'
          : hovered
          ? 'rgba(255,255,255,0.028)'
          : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.14s ease, border-left-color 0.14s ease',
      }}
    >
      {/* Session ID */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          color: selected ? 'var(--violet)' : hovered ? 'var(--text)' : 'var(--text-2)',
          letterSpacing: '0.04em',
          transition: 'color 0.14s ease',
        }}
      >
        {shortId}
      </div>

      {/* Session title */}
      <div style={{ marginTop: 5 }}>
        {editing === 'title' ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            autoFocus
            style={{
              fontFamily: "'Oxanium', monospace",
              fontSize: 12,
              background: 'var(--surface-3)',
              border: '1px solid var(--violet)',
              borderRadius: 3,
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
            style={{
              fontFamily: "'Oxanium', monospace",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: selected ? 'var(--text)' : hovered ? 'var(--text)' : 'var(--text-2)',
              cursor: 'text',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sessionTitle}
          </div>
        ) : hovered ? (
          <span
            onDoubleClick={startEdit('title', '')}
            onClick={e => { e.stopPropagation(); startEdit('title', '')(e) }}
            title="Click to add a title"
            style={{
              fontFamily: "'Oxanium', monospace",
              fontSize: 12,
              color: 'var(--text-3)',
              padding: '2px 0',
              cursor: 'text',
            }}
          >
            + title
          </span>
        ) : (
          <div style={{ height: 18 }} />
        )}
      </div>

      {/* Tag + time */}
      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
        {editing === 'tag' ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitTagEdit}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            autoFocus
            placeholder="tag"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              background: 'var(--surface-3)',
              border: '1px solid var(--violet)',
              borderRadius: 3,
              color: 'var(--text)',
              padding: '1px 6px',
              outline: 'none',
              width: 110,
            }}
          />
        ) : session.tag ? (
          <span
            onDoubleClick={startEdit('tag', session.tag)}
            title="Double-click to edit tag"
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
            #{session.tag}
          </span>
        ) : hovered ? (
          <span
            onDoubleClick={startEdit('tag', '')}
            onClick={e => { e.stopPropagation(); startEdit('tag', '')(e) }}
            title="Click to add a tag"
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
            + tag
          </span>
        ) : null}
        {session.createdAt && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            {timeAgo(session.createdAt)}
          </span>
        )}
      </div>
    </div>
  )
}

function ProjectGroup({
  name,
  sessions,
  selectedId,
  selectedProject,
  onSelect,
  onSelectProject,
  onRename,
  onTag,
}: {
  name: string
  sessions: Session[]
  selectedId: string | null
  selectedProject: string | null
  onSelect: (id: string) => void
  onSelectProject: (key: string, sessions: Session[]) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const isProjectSelected = selectedProject === name
  const hasSelected = isProjectSelected || sessions.some(s => s.sessionId === selectedId)

  return (
    <div>
      {/* Group header */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 14px 8px 16px',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          background: isProjectSelected
            ? 'linear-gradient(to right, rgba(139,128,240,0.12) 0%, var(--surface-2) 70%)'
            : hovered ? 'var(--surface-3)' : 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          borderLeft: `2px solid ${isProjectSelected ? 'var(--violet)' : 'transparent'}`,
          zIndex: 1,
          transition: 'background 0.14s ease, border-left-color 0.14s ease',
        }}
      >
        {/* Chevron: collapses/expands */}
        <span
          onClick={() => setCollapsed(v => !v)}
          style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0, cursor: 'pointer', padding: '2px 4px 2px 0' }}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        {/* Name: loads project consolidated view */}
        <span
          onClick={() => onSelectProject(name, sessions)}
          style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: hasSelected ? 'var(--violet)' : hovered ? 'var(--text-2)' : 'var(--text-3)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            transition: 'color 0.14s ease',
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: isProjectSelected ? 'var(--violet)' : 'var(--text-3)',
            background: isProjectSelected ? 'rgba(139,128,240,0.12)' : 'var(--surface-3)',
            border: `1px solid ${isProjectSelected ? 'rgba(139,128,240,0.3)' : 'var(--border)'}`,
            borderRadius: 3,
            padding: '1px 6px',
            flexShrink: 0,
          }}
        >
          {sessions.length}
        </span>
      </div>

      {/* Sessions */}
      {!collapsed && sessions.map((session) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          selected={session.sessionId === selectedId}
          onSelect={onSelect}
          onRename={onRename}
          onTag={onTag}
        />
      ))}
    </div>
  )
}

export default function SessionList({ sessions, loading, error, selectedId, selectedProject, onSelect, onSelectProject, onRename, onTag }: Props) {
  const groups = groupByProject(sessions)

  return (
    <div
      style={{
        width: 290,
        minWidth: 290,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div
        style={{
          padding: '18px 18px 15px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          background: 'linear-gradient(160deg, rgba(139,128,240,0.07) 0%, transparent 60%)',
        }}
      >
        <div
          style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: 'var(--violet)', fontSize: 14, lineHeight: 1 }}>◈</span>
          <span style={{ flex: 1 }}>Agent Viewer</span>
          <ThemeToggle />
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--green)',
              flexShrink: 0,
              animation: 'live-pulse 2.5s ease-in-out infinite',
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-3)',
              letterSpacing: '0.04em',
            }}
          >
            {loading
              ? 'syncing…'
              : `${groups.size} project${groups.size !== 1 ? 's' : ''} · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {/* ── Groups ─────────────────────────────────────── */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        {error && (
          <div
            style={{
              padding: '12px 18px',
              fontSize: 12,
              color: 'var(--red)',
              borderBottom: '1px solid var(--border)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && [...groups.entries()].map(([name, groupSessions]) => (
          <ProjectGroup
            key={name}
            name={name}
            sessions={groupSessions}
            selectedId={selectedId}
            selectedProject={selectedProject}
            onSelect={onSelect}
            onSelectProject={onSelectProject}
            onRename={onRename}
            onTag={onTag}
          />
        ))}
      </div>
    </div>
  )
}

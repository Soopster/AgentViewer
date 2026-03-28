'use client'

import { useState } from 'react'
import type { Session } from '@/lib/types'
import ThemeToggle from './ThemeToggle'

type Props = {
  sessions: Session[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (id: string) => void
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

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: Session
  selected: boolean
  onSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const shortId = session.sessionId.slice(-12)

  return (
    <div
      onClick={() => onSelect(session.sessionId)}
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

      {/* Tag + time */}
      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
        {session.tag && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              background: selected ? 'rgba(139,128,240,0.16)' : 'rgba(139,128,240,0.08)',
              color: 'var(--violet)',
              padding: '1px 6px',
              borderRadius: 3,
              border: '1px solid rgba(139,128,240,0.22)',
              letterSpacing: '0.03em',
            }}
          >
            {session.tag}
          </span>
        )}
        {session.createdAt && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            {timeAgo(session.createdAt)} ago
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
  onSelect,
}: {
  name: string
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const hasSelected = sessions.some(s => s.sessionId === selectedId)

  return (
    <div>
      {/* Group header */}
      <div
        onClick={() => setCollapsed(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 14px 8px 16px',
          cursor: 'pointer',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          background: hovered ? 'var(--surface-3)' : 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          zIndex: 1,
          transition: 'background 0.14s ease',
        }}
      >
        <span style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0 }}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span
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
            transition: 'color 0.14s ease',
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--text-3)',
            background: 'var(--surface-3)',
            border: '1px solid var(--border)',
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
        />
      ))}
    </div>
  )
}

export default function SessionList({ sessions, loading, error, selectedId, onSelect }: Props) {
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
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

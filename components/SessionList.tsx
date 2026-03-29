'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { pickCanonicalProjectPath, sameProjectPath } from '@/lib/projectPaths'
import type { AgentProvider, ProviderSelection, Session } from '@/lib/types'
import { parseSessionTagInput, parseStoredSessionTags, serializeSessionTags } from '@/lib/sessionTags'
import ThemeToggle from './ThemeToggle'

type Props = {
  sessions: Session[]
  loading: boolean
  error: string | null
  provider: ProviderSelection
  switchingProvider: boolean
  selectedId: string | null
  selectedProject: string | null
  onSelect: (session: Session) => void
  onSelectProject: (projectDir: string, projectName: string, sessions: Session[]) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
  onChangeProvider: (provider: ProviderSelection) => void
  scopeMode: 'all' | 'project'
  scopeProjectName: string | null
  canScopeToProject: boolean
  includeWorktrees: boolean
  onChangeScope: (mode: 'all' | 'project') => void
  onToggleWorktrees: (include: boolean) => void
}

function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 60)  return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function formatTimestamp(value?: string | number): string {
  if (value == null) return ''
  return new Date(value).toLocaleString()
}

type ProjectGroupEntry = {
  projectDir: string
  projectName: string
  sessions: Session[]
}

/** Group sessions by full cwd, preserving first-seen order. */
function groupByProject(sessions: Session[]): ProjectGroupEntry[] {
  const groups: ProjectGroupEntry[] = []
  for (const s of sessions) {
    const projectDir = s.cwd ?? '—'
    const existing = groups.find((group) => sameProjectPath(group.projectDir, projectDir))
    if (existing) {
      existing.projectDir = pickCanonicalProjectPath(existing.projectDir, projectDir) || existing.projectDir
      existing.projectName = existing.projectDir.split('/').pop() ?? '—'
      existing.sessions.push(s)
      continue
    }
    groups.push({
      projectDir,
      projectName: s.cwd?.split('/').pop() ?? '—',
      sessions: [s],
    })
  }
  return groups
}

function getSessionTitle(session: Session): string {
  return session.customTitle ?? session.summary ?? ''
}

function getSessionPreview(session: Session, sessionTitle: string): string | null {
  const preview = session.firstPrompt?.trim()
  if (!preview) return null
  if (preview === sessionTitle) return null
  return preview
}

function matchesSessionSearch(session: Session, search: string, activeTag: string | null): boolean {
  const tags = parseStoredSessionTags(session.tag)

  if (activeTag && !tags.some((tag) => tag.toLowerCase() === activeTag.toLowerCase())) {
    return false
  }

  if (!search) return true

  const title = getSessionTitle(session)
  const haystack = [
    title,
    tags.join(' '),
    session.cwd ?? '',
    session.firstPrompt ?? '',
  ].join('\n').toLowerCase()

  return haystack.includes(search)
}

function providerChipStyle(provider: AgentProvider): { color: string; background: string; border: string } {
  if (provider === 'codex') {
    return { color: 'var(--cyan)', background: 'rgba(56,217,245,0.08)', border: 'rgba(56,217,245,0.22)' }
  }
  if (provider === 'opencode') {
    return { color: 'var(--green)', background: 'rgba(45,212,160,0.08)', border: 'rgba(45,212,160,0.22)' }
  }
  return { color: 'var(--violet)', background: 'rgba(139,128,240,0.08)', border: 'rgba(139,128,240,0.22)' }
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
  onSelect: (session: Session) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState<'title' | 'tag' | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const shortId = session.sessionId.slice(-12)
  const sessionTitle = getSessionTitle(session)
  const sessionPreview = getSessionPreview(session, sessionTitle)
  const sessionTags = parseStoredSessionTags(session.tag)
  const activityTime = session.lastModified ?? session.createdAt
  const activityTitle = formatTimestamp(activityTime)

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
        body: JSON.stringify({ title: value, provider: session.provider }),
      })
    } catch { /* optimistic — ignore errors */ }
  }, [editValue, onRename, session.sessionId, sessionTitle])

  const commitTagEdit = useCallback(async () => {
    setEditing(null)
    const currentTags = parseStoredSessionTags(session.tag)
    const nextTags = parseSessionTagInput(editValue)
    if (JSON.stringify(nextTags) === JSON.stringify(currentTags)) return

    const nextTag = serializeSessionTags(nextTags)
    onTag(session.sessionId, nextTag)
    try {
      await fetch(`/api/sessions/${session.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: nextTag, provider: session.provider }),
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
      onClick={() => !editing && onSelect(session)}
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

      {sessionPreview && editing !== 'title' && (
        <div
          title={sessionPreview}
          style={{
            marginTop: 4,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: selected ? 'var(--text-2)' : 'var(--text-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sessionPreview}
        </div>
      )}

      {/* Tag + time */}
      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
        {session.provider && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 999,
              letterSpacing: '0.05em',
              border: `1px solid ${providerChipStyle(session.provider).border}`,
              background: providerChipStyle(session.provider).background,
              color: providerChipStyle(session.provider).color,
            }}
          >
            {session.provider.toUpperCase()}
          </span>
        )}
        {editing === 'tag' ? (
          <input
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
        {activityTime != null && (
          <span
            title={activityTitle}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            {timeAgo(activityTime)}
          </span>
        )}
      </div>
    </div>
  )
}

function ProjectGroup({
  name,
  projectKey,
  sessions,
  selectedId,
  selectedProject,
  onSelect,
  onSelectProject,
  onRename,
  onTag,
}: {
  name: string
  projectKey: string
  sessions: Session[]
  selectedId: string | null
  selectedProject: string | null
  onSelect: (session: Session) => void
  onSelectProject: (projectDir: string, projectName: string, sessions: Session[]) => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const isProjectSelected = sameProjectPath(selectedProject, projectKey)
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
          onClick={() => onSelectProject(projectKey, name, sessions)}
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

export default function SessionList({
  sessions,
  loading,
  error,
  provider,
  switchingProvider,
  selectedId,
  selectedProject,
  onSelect,
  onSelectProject,
  onRename,
  onTag,
  onChangeProvider,
  scopeMode,
  scopeProjectName,
  canScopeToProject,
  includeWorktrees,
  onChangeScope,
  onToggleWorktrees,
}: Props) {
  const [searchText, setSearchText] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const normalizedSearch = searchText.trim().toLowerCase()
  const filteredSessions = sessions.filter((session) => matchesSessionSearch(session, normalizedSearch, activeTag))
  const groups = groupByProject(filteredSessions)
  const tagCounts = new Map<string, number>()

  for (const session of sessions) {
    for (const tag of parseStoredSessionTags(session.tag)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  const popularTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)

  useEffect(() => {
    if (!activeTag) return
    if (tagCounts.has(activeTag)) return
    setActiveTag(null)
  }, [activeTag, sessions])

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
              : filteredSessions.length === sessions.length
              ? `${groups.length} project${groups.length !== 1 ? 's' : ''} · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`
              : `${filteredSessions.length}/${sessions.length} sessions · ${groups.length} projects`}
          </span>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            onClick={() => onChangeProvider('claude')}
            disabled={switchingProvider}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 5,
              border: `1px solid ${provider === 'claude' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
              background: provider === 'claude' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
              color: provider === 'claude' ? 'var(--violet)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: switchingProvider ? 'not-allowed' : 'pointer',
              opacity: switchingProvider ? 0.6 : 1,
            }}
          >
            CLAUDE
          </button>
          <button
            onClick={() => onChangeProvider('codex')}
            disabled={switchingProvider}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 5,
              border: `1px solid ${provider === 'codex' ? 'rgba(56,217,245,0.32)' : 'var(--border)'}`,
              background: provider === 'codex' ? 'rgba(56,217,245,0.12)' : 'var(--surface-2)',
              color: provider === 'codex' ? 'var(--cyan)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: switchingProvider ? 'not-allowed' : 'pointer',
              opacity: switchingProvider ? 0.6 : 1,
            }}
          >
            CODEX
          </button>
          <button
            onClick={() => onChangeProvider('opencode')}
            disabled={switchingProvider}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 5,
              border: `1px solid ${provider === 'opencode' ? 'rgba(45,212,160,0.32)' : 'var(--border)'}`,
              background: provider === 'opencode' ? 'rgba(45,212,160,0.12)' : 'var(--surface-2)',
              color: provider === 'opencode' ? 'var(--green)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: switchingProvider ? 'not-allowed' : 'pointer',
              opacity: switchingProvider ? 0.6 : 1,
            }}
          >
            OPENCODE
          </button>
          <button
            onClick={() => onChangeProvider('all')}
            disabled={switchingProvider}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 5,
              border: `1px solid ${provider === 'all' ? 'rgba(45,212,160,0.32)' : 'var(--border)'}`,
              background: provider === 'all' ? 'rgba(45,212,160,0.12)' : 'var(--surface-2)',
              color: provider === 'all' ? 'var(--green)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: switchingProvider ? 'not-allowed' : 'pointer',
              opacity: switchingProvider ? 0.6 : 1,
            }}
          >
            ALL
          </button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search title, tags, path, prompt…"
            style={{
              flex: 1,
              height: 30,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              padding: '0 10px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              outline: 'none',
            }}
          />
          {(searchText || activeTag) && (
            <button
              onClick={() => {
                setSearchText('')
                setActiveTag(null)
              }}
              style={{
                height: 30,
                padding: '0 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.05em',
                cursor: 'pointer',
              }}
            >
              CLEAR
            </button>
          )}
        </div>
        {popularTags.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {popularTags.map(([tag, count]) => {
              const selected = activeTag?.toLowerCase() === tag.toLowerCase()
              return (
                <button
                  key={tag}
                  onClick={() => setActiveTag((prev) => prev?.toLowerCase() === tag.toLowerCase() ? null : tag)}
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 999,
                    border: `1px solid ${selected ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
                    background: selected ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
                    color: selected ? 'var(--violet)' : 'var(--text-3)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                  }}
                  title={`${count} session${count === 1 ? '' : 's'}`}
                >
                  #{tag} · {count}
                </button>
              )
            })}
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            onClick={() => onChangeScope('all')}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 5,
              border: `1px solid ${scopeMode === 'all' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
              background: scopeMode === 'all' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
              color: scopeMode === 'all' ? 'var(--violet)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: 'pointer',
            }}
          >
            ALL PROJECTS
          </button>
          <button
            onClick={() => canScopeToProject && onChangeScope('project')}
            disabled={!canScopeToProject}
            title={canScopeToProject ? 'Show only sessions for the current project' : 'Select a session or project first'}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 5,
              border: `1px solid ${scopeMode === 'project' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
              background: scopeMode === 'project' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
              color: scopeMode === 'project' ? 'var(--violet)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: canScopeToProject ? 'pointer' : 'not-allowed',
              opacity: canScopeToProject ? 1 : 0.45,
            }}
          >
            THIS PROJECT
          </button>
        </div>
        {scopeMode === 'project' && scopeProjectName && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}
            >
              {scopeProjectName}
            </span>
            <label
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={includeWorktrees}
                onChange={(e) => onToggleWorktrees(e.target.checked)}
              />
              worktrees
            </label>
          </div>
        )}
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

        {!loading && !error && groups.map(({ projectDir, projectName, sessions: groupSessions }) => (
          <ProjectGroup
            key={projectDir}
            name={projectName}
            projectKey={projectDir}
            sessions={groupSessions}
            selectedId={selectedId}
            selectedProject={selectedProject}
            onSelect={onSelect}
            onSelectProject={onSelectProject}
            onRename={onRename}
            onTag={onTag}
          />
        ))}
        {!loading && !error && filteredSessions.length === 0 && (
          <div
            style={{
              padding: '18px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              lineHeight: 1.6,
            }}
          >
            No sessions match the current search/filter.
          </div>
        )}
      </div>
    </div>
  )
}

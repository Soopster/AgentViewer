'use client'

import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { normalizeProjectPath, pathBasename, pickCanonicalProjectPath, sameProjectPath } from '@/lib/projectPaths'
import type { AgentProvider, ProviderSelection, Session } from '@/lib/types'
import { parseSessionTagInput, parseStoredSessionTags, serializeSessionTags } from '@/lib/sessionTags'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

function formatStableTimestamp(value?: string | number): string {
  if (value == null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function formatStableTimeLabel(value?: string | number): string {
  if (value == null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(11, 16) + ' UTC'
}

type ProjectGroupEntry = {
  projectDir: string
  projectName: string
  sessions: Session[]
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

function sessionTabKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

type IndexedSession = {
  session: Session
  tags: string[]
  lowerTags: string[]
  searchText: string
  normalizedProjectDir: string
  projectName: string
}

function indexSession(session: Session): IndexedSession {
  const tags = parseStoredSessionTags(session.tag)
  const title = getSessionTitle(session)
  const normalizedDir = normalizeProjectPath(session.cwd) || '—'
  return {
    session,
    tags,
    lowerTags: tags.map((tag) => tag.toLowerCase()),
    searchText: [
      title,
      tags.join(' '),
      session.cwd ?? '',
      session.firstPrompt ?? '',
    ].join('\n').toLowerCase(),
    normalizedProjectDir: normalizedDir,
    projectName: pathBasename(normalizedDir) || '—',
  }
}

function matchesIndexedSessionSearch(session: IndexedSession, search: string, activeTag: string | null): boolean {
  if (activeTag && !session.lowerTags.includes(activeTag.toLowerCase())) return false
  if (!search) return true
  return session.searchText.includes(search)
}

function groupByProject(sessions: IndexedSession[]): ProjectGroupEntry[] {
  const groups: ProjectGroupEntry[] = []
  const groupsByPath = new Map<string, ProjectGroupEntry>()
  const groupsByBaseName = new Map<string, ProjectGroupEntry>()

  for (const indexed of sessions) {
    const { session, normalizedProjectDir, projectName } = indexed
    const byPath = groupsByPath.get(normalizedProjectDir)
    if (byPath) {
      byPath.sessions.push(session)
      continue
    }

    const byBaseName = groupsByBaseName.get(projectName)
    if (byBaseName) {
      byBaseName.projectDir = pickCanonicalProjectPath(byBaseName.projectDir, normalizedProjectDir) || byBaseName.projectDir
      byBaseName.projectName = pathBasename(byBaseName.projectDir) || '—'
      byBaseName.sessions.push(session)
      groupsByPath.set(normalizedProjectDir, byBaseName)
      groupsByBaseName.set(byBaseName.projectName, byBaseName)
      continue
    }

    const group = {
      projectDir: normalizedProjectDir,
      projectName,
      sessions: [session],
    }
    groups.push(group)
    groupsByPath.set(normalizedProjectDir, group)
    groupsByBaseName.set(projectName, group)
  }

  return groups
}

function providerChipStyle(provider: AgentProvider): { color: string; background: string; border: string } {
  if (provider === 'codex') {
    return { color: 'var(--cyan)', background: 'rgba(56,217,245,0.08)', border: 'rgba(56,217,245,0.22)' }
  }
  if (provider === 'opencode') {
    return { color: 'var(--green)', background: 'rgba(45,212,160,0.08)', border: 'rgba(45,212,160,0.22)' }
  }
  if (provider === 'copilot') {
    return { color: 'var(--amber)', background: 'rgba(234,170,64,0.08)', border: 'rgba(234,170,64,0.22)' }
  }
  if (provider === 'pi') {
    return { color: 'var(--red)', background: 'rgba(240,80,80,0.08)', border: 'rgba(240,80,80,0.22)' }
  }
  return { color: 'var(--violet)', background: 'rgba(139,128,240,0.08)', border: 'rgba(139,128,240,0.22)' }
}

const SessionRow = memo(function SessionRow({
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
  const [hydrated, setHydrated] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const shortId = session.sessionId.slice(-12)
  const sessionTitle = getSessionTitle(session)
  const sessionPreview = getSessionPreview(session, sessionTitle)
  const sessionTags = parseStoredSessionTags(session.tag)
  const activityTime = session.lastModified ?? session.createdAt
  const activityTitle = hydrated ? formatTimestamp(activityTime) : formatStableTimestamp(activityTime)

  useEffect(() => {
    setHydrated(true)
  }, [])

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
          ? 'var(--surface-2)'
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
          <Input
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
        {activityTime != null && (
          <span
            title={activityTitle}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
            }}
          >
            {hydrated ? timeAgo(activityTime) : formatStableTimeLabel(activityTime)}
          </span>
        )}
      </div>
    </div>
  )
})

const ProjectGroup = memo(function ProjectGroup({
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
  const hasSelected = isProjectSelected || sessions.some((s) => sessionTabKey(s) === selectedId)

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
          key={sessionTabKey(session)}
          session={session}
          selected={sessionTabKey(session) === selectedId}
          onSelect={onSelect}
          onRename={onRename}
          onTag={onTag}
        />
      ))}
    </div>
  )
})

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
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 290
    const stored = Number(window.localStorage.getItem('agentViewer:sidebarWidth'))
    return Number.isFinite(stored) && stored >= 220 && stored <= 640 ? stored : 290
  })
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])
  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      const next = Math.max(220, Math.min(640, e.clientX))
      setSidebarWidth(next)
    }
    const onUp = () => setResizing(false)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing])
  const [searchText, setSearchText] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const normalizedSearch = searchText.trim().toLowerCase()
  const indexedSessions = useMemo(() => sessions.map(indexSession), [sessions])
  const filteredSessions = useMemo(
    () => indexedSessions.filter((session) => matchesIndexedSessionSearch(session, normalizedSearch, activeTag)),
    [indexedSessions, normalizedSearch, activeTag],
  )
  const groups = useMemo(() => groupByProject(filteredSessions), [filteredSessions])
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const session of indexedSessions) {
      for (const tag of session.tags) {
        map.set(tag, (map.get(tag) ?? 0) + 1)
      }
    }
    return map
  }, [indexedSessions])
  const popularTags = useMemo(
    () => [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    [tagCounts],
  )

  useEffect(() => {
    if (!activeTag) return
    if (tagCounts.has(activeTag)) return
    setActiveTag(null)
  }, [activeTag, tagCounts])

  return (
    <div
      style={{
        width: collapsed ? 32 : sidebarWidth,
        minWidth: collapsed ? 32 : sidebarWidth,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
        transition: resizing ? 'none' : 'width 0.2s ease, min-width 0.2s ease',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {!collapsed && (
        <div
          onMouseDown={(e) => { e.preventDefault(); setResizing(true) }}
          onDoubleClick={() => setSidebarWidth(290)}
          title="Drag to resize · double-click to reset"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 20,
            background: resizing ? 'var(--violet-glow)' : 'transparent',
          }}
        />
      )}
      {/* ── Collapse toggle (always visible) ───────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
          padding: collapsed ? '10px 0' : '6px 10px 0',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-3)',
            padding: '4px 6px',
            borderRadius: 6,
            lineHeight: 1,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      {/* ── Header + Groups (hidden when collapsed) ────── */}
      {!collapsed && <>
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
        <Card
          style={{
            marginTop: 14,
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
            boxShadow: '0 10px 24px var(--violet-glow)',
          }}
        >
          <CardContent style={{ padding: 14 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <Label
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9,
                  color: 'var(--text-3)',
                  letterSpacing: '0.12em',
                  whiteSpace: 'nowrap',
                }}
              >
                PROVIDER
              </Label>
              <Select value={provider} onValueChange={(value) => onChangeProvider(value as ProviderSelection)} disabled={switchingProvider}>
                <SelectTrigger
                  style={{
                    width: '100%',
                    height: 34,
                    borderRadius: 9,
                    border: '1px solid var(--border)',
                    background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
                    color: 'var(--text)',
                    padding: '0 10px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.04em',
                    cursor: switchingProvider ? 'not-allowed' : 'pointer',
                    opacity: switchingProvider ? 0.6 : 1,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                  }}
                >
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent
                  style={{
                    borderRadius: 10,
                    border: '1px solid var(--border-2)',
                    background: 'var(--surface)',
                    boxShadow: '0 14px 32px rgba(0,0,0,0.14)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.04em',
                    padding: '4px',
                  }}
                >
                  <SelectItem className="rounded-md py-2.5 px-3.5 pr-8 text-[11px] leading-[1.25] tracking-[0.04em] [font-family:'IBM_Plex_Mono',monospace]" value="claude">CLAUDE</SelectItem>
                  <SelectItem className="rounded-md py-2.5 px-3.5 pr-8 text-[11px] leading-[1.25] tracking-[0.04em] [font-family:'IBM_Plex_Mono',monospace]" value="codex">CODEX</SelectItem>
                  <SelectItem className="rounded-md py-2.5 px-3.5 pr-8 text-[11px] leading-[1.25] tracking-[0.04em] [font-family:'IBM_Plex_Mono',monospace]" value="opencode">OPENCODE</SelectItem>
                  <SelectItem className="rounded-md py-2.5 px-3.5 pr-8 text-[11px] leading-[1.25] tracking-[0.04em] [font-family:'IBM_Plex_Mono',monospace]" value="copilot">COPILOT</SelectItem>
                  <SelectItem className="rounded-md py-2.5 px-3.5 pr-8 text-[11px] leading-[1.25] tracking-[0.04em] [font-family:'IBM_Plex_Mono',monospace]" value="pi">PI</SelectItem>
                  <SelectItem className="rounded-md py-2.5 px-3.5 pr-8 text-[11px] leading-[1.25] tracking-[0.04em] [font-family:'IBM_Plex_Mono',monospace]" value="all">ALL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
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
                <Button
                  onClick={() => {
                    setSearchText('')
                    setActiveTag(null)
                  }}
                  variant="outline"
                  size="sm"
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
                </Button>
              )}
            </div>
            {popularTags.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {popularTags.map(([tag, count]) => {
                  const selected = activeTag?.toLowerCase() === tag.toLowerCase()
                  return (
                    <Button
                      key={tag}
                      onClick={() => setActiveTag((prev) => prev?.toLowerCase() === tag.toLowerCase() ? null : tag)}
                      variant="outline"
                      size="sm"
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
                    </Button>
                  )
                })}
              </div>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Button
                onClick={() => onChangeScope('all')}
                variant="outline"
                size="sm"
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
              </Button>
              <Button
                onClick={() => canScopeToProject && onChangeScope('project')}
                disabled={!canScopeToProject}
                title={canScopeToProject ? 'Show only sessions for the current project' : 'Select a session or project first'}
                variant="outline"
                size="sm"
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
              </Button>
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
                <Label
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
                  <Checkbox
                    checked={includeWorktrees}
                    onCheckedChange={(checked) => onToggleWorktrees(checked === true)}
                    style={{
                      borderColor: 'var(--border)',
                      background: includeWorktrees ? 'var(--violet)' : 'var(--surface-2)',
                      color: includeWorktrees ? 'var(--bg)' : 'var(--text)',
                    }}
                  />
                  worktrees
                </Label>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
      </>}
    </div>
  )
}

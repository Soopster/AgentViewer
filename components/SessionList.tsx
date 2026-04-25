'use client'

import { memo, useState, useRef, useCallback, useEffect, useMemo, ViewTransition } from 'react'
import { normalizeProjectPath, pathBasename, pickCanonicalProjectPath, sameProjectPath } from '@/lib/projectPaths'
import type { AgentProvider, ProviderSelection, Session } from '@/lib/types'
import { parseSessionTagInput, parseStoredSessionTags, serializeSessionTags } from '@/lib/sessionTags'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption, nativeSelectBaseClassName } from '@/components/ui/native-select'
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGlyph,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  Bot,
  LayoutDashboard,
  ListTree,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import ThemeToggle from './ThemeToggle'

const providerNativeSelectClassName = cn(
  nativeSelectBaseClassName,
  'h-9 rounded-[9px] border-[var(--border)] bg-gradient-to-b from-[var(--surface)] to-[var(--surface-2)] px-3 text-[11px] font-medium tracking-[0.04em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
)

const collapsedIconButtonBaseStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 11,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-2)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}

const collapsedPrimaryButtonStyle: React.CSSProperties = {
  ...collapsedIconButtonBaseStyle,
  width: 46,
  height: 46,
  borderRadius: 15,
  border: '1px solid color-mix(in srgb, var(--violet) 28%, var(--border))',
  background: 'var(--violet)',
  color: 'var(--bg)',
  boxShadow: '0 8px 24px var(--violet-glow)',
}

function collapsedIconButtonStyle(active = false): React.CSSProperties {
  return {
    ...collapsedIconButtonBaseStyle,
    border: active ? '1px solid color-mix(in srgb, var(--violet) 46%, var(--border))' : collapsedIconButtonBaseStyle.border,
    background: active ? 'color-mix(in srgb, var(--violet) 16%, var(--surface-2))' : 'var(--surface-2)',
    color: active ? 'var(--violet)' : 'var(--text-2)',
    boxShadow: active ? '0 10px 18px var(--violet-glow)' : 'none',
  }
}

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
  onOpenCommandPalette: () => void
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

type CollapsedPanel = 'sessions' | 'provider' | 'search' | 'project' | 'filters' | 'overview'

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
      className={`av-session-row ${selected ? 'av-selected' : ''}`}
      style={{
        padding: '10px 16px 10px 24px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Session ID */}
      <div
        className="av-session-id"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          letterSpacing: '0.04em',
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
            className="av-session-title"
            style={{
              fontFamily: "'Oxanium', monospace",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
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
            color: 'var(--text-3)',
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
        className={`av-project-header ${isProjectSelected ? 'av-selected' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 14px 8px 16px',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          borderBottom: '1px solid var(--border)',
          zIndex: 1,
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
          className="av-project-name"
          style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
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
        <ViewTransition key={sessionTabKey(session)} enter="fade-in" default="none">
          <SessionRow
            session={session}
            selected={sessionTabKey(session) === selectedId}
            onSelect={onSelect}
            onRename={onRename}
            onTag={onTag}
          />
        </ViewTransition>
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
  onOpenCommandPalette,
}: Props) {
  const { state: sidebarState, width: sidebarWidth, setWidth: setSidebarWidth, applyWidth, setOpen } = useSidebar()
  const collapsed = sidebarState === 'collapsed'
  const [resizing, setResizing] = useState(false)
  const [collapsedPanel, setCollapsedPanel] = useState<CollapsedPanel | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const resizeWidthRef = useRef(sidebarWidth)
  const providerSelectRef = useRef<HTMLSelectElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    resizeWidthRef.current = sidebarWidth
  }, [sidebarWidth])
  const expandAndFocus = useCallback((target: 'provider' | 'search' | 'project' | 'view') => {
    setOpen(true)
    requestAnimationFrame(() => {
      if (target === 'provider') providerSelectRef.current?.focus()
      if (target === 'search') searchInputRef.current?.focus()
    })
  }, [setOpen])
  const handleCollapsedAction = useCallback((panel: CollapsedPanel) => {
    if (!collapsed) {
      if (panel === 'sessions') {
        setCollapsedPanel(null)
        return
      }
      if (panel === 'provider') expandAndFocus('provider')
      else if (panel === 'search') expandAndFocus('search')
      else expandAndFocus('view')
      return
    }
    setCollapsedPanel((current) => (current === panel ? null : panel))
  }, [collapsed, expandAndFocus])
  useEffect(() => {
    if (!collapsed) setCollapsedPanel(null)
  }, [collapsed])
  useEffect(() => {
    if (!collapsedPanel) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCollapsedPanel(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [collapsedPanel])
  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      const next = Math.max(220, Math.min(640, e.clientX))
      resizeWidthRef.current = next
      if (resizeFrameRef.current != null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        applyWidth(resizeWidthRef.current)
      })
    }
    const onUp = () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      setSidebarWidth(resizeWidthRef.current)
      setResizing(false)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [applyWidth, resizing, setSidebarWidth])
  const [searchText, setSearchText] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'project' | 'time'>('project')
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('agentViewer:sessionSort')
      if (stored === 'time' || stored === 'project') {
        setSortMode(stored)
      }
    } catch {
      // ignore storage failures
    }
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:sessionSort', sortMode)
  }, [sortMode])
  const normalizedSearch = searchText.trim().toLowerCase()
  const indexedSessions = useMemo(() => sessions.map(indexSession), [sessions])
  const filteredSessions = useMemo(
    () => indexedSessions.filter((session) => matchesIndexedSessionSearch(session, normalizedSearch, activeTag)),
    [indexedSessions, normalizedSearch, activeTag],
  )
  const groups = useMemo(() => groupByProject(filteredSessions), [filteredSessions])
  const sessionActivityMs = useCallback((session: Session): number => {
    const value = session.lastModified ?? session.createdAt
    if (value == null) return 0
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? 0 : ms
  }, [])
  const timeEntries = useMemo(() => {
    if (sortMode !== 'time') return [] as Array<
      | { type: 'header'; key: string; projectDir: string; projectName: string; count: number; projectSessions: Session[] }
      | { type: 'session'; key: string; session: Session }
    >
    const sorted = [...filteredSessions].sort(
      (a, b) => sessionActivityMs(b.session) - sessionActivityMs(a.session),
    )
    const projectSessionsByDir = new Map<string, Session[]>()
    for (const indexed of sorted) {
      const list = projectSessionsByDir.get(indexed.normalizedProjectDir)
      if (list) list.push(indexed.session)
      else projectSessionsByDir.set(indexed.normalizedProjectDir, [indexed.session])
    }
    const entries: Array<
      | { type: 'header'; key: string; projectDir: string; projectName: string; count: number; projectSessions: Session[] }
      | { type: 'session'; key: string; session: Session }
    > = []
    for (let i = 0; i < sorted.length; i++) {
      const indexed = sorted[i]
      const prev = i > 0 ? sorted[i - 1] : null
      if (!prev || prev.normalizedProjectDir !== indexed.normalizedProjectDir) {
        let run = 1
        while (
          i + run < sorted.length
          && sorted[i + run].normalizedProjectDir === indexed.normalizedProjectDir
        ) run++
        entries.push({
          type: 'header',
          key: `project:${indexed.normalizedProjectDir}:${i}`,
          projectDir: indexed.normalizedProjectDir,
          projectName: indexed.projectName,
          count: run,
          projectSessions: projectSessionsByDir.get(indexed.normalizedProjectDir) ?? [],
        })
      }
      entries.push({
        type: 'session',
        key: `${sessionTabKey(indexed.session)}:${i}`,
        session: indexed.session,
      })
    }
    return entries
  }, [filteredSessions, sortMode, sessionActivityMs])
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
  const summaryText = loading
    ? 'syncing…'
    : sortMode === 'time'
    ? filteredSessions.length === sessions.length
      ? `${sessions.length} session${sessions.length !== 1 ? 's' : ''} · by time`
      : `${filteredSessions.length}/${sessions.length} sessions · by time`
    : filteredSessions.length === sessions.length
    ? `${groups.length} project${groups.length !== 1 ? 's' : ''} · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`
    : `${filteredSessions.length}/${sessions.length} sessions · ${groups.length} projects`

  if (collapsed) {
    return (
      <div
        style={{
          width: '100%',
          minWidth: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'var(--surface)',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
          }}
        >
          <div
            style={{
              width: 76,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 9,
              padding: '11px 0 13px',
              borderRight: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                boxShadow: 'none',
                backdropFilter: 'blur(4px)',
                marginBottom: 8,
              }}
            >
              <SidebarGlyph size={15} strokeWidth={2} />
            </button>

            <button
              type="button"
              onClick={() => handleCollapsedAction('sessions')}
              aria-label="Show sessions"
              title="Show sessions"
              style={collapsedPrimaryButtonStyle}
            >
              <ListTree size={22} strokeWidth={2.3} />
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => handleCollapsedAction('provider')}
                aria-label="Provider controls"
                title="Provider"
                style={collapsedIconButtonStyle(collapsedPanel === 'provider')}
              >
                <Bot size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('search')}
                aria-label="Search"
                title="Search"
                style={collapsedIconButtonStyle(collapsedPanel === 'search')}
              >
                <Search size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('project')}
                aria-label="Project scope"
                title="Projects"
                style={collapsedIconButtonStyle(collapsedPanel === 'project')}
              >
                <LayoutDashboard size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('filters')}
                aria-label="Filters"
                title="Filters"
                style={collapsedIconButtonStyle(collapsedPanel === 'filters')}
              >
                <SlidersHorizontal size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('overview')}
                aria-label="Overview"
                title="Overview"
                style={collapsedIconButtonStyle(collapsedPanel === 'overview')}
              >
                <BookOpen size={20} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </div>
        {collapsedPanel && (
          <div
            onClick={() => setCollapsedPanel(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 40,
              background: 'transparent',
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                position: 'absolute',
                top: 76,
                left: 106,
                width: 318,
                maxWidth: 'calc(100vw - 114px)',
                maxHeight: 'calc(100vh - 104px)',
                borderRadius: 16,
                border: '1px solid var(--border)',
                background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
                boxShadow: '0 24px 60px var(--shadow, rgba(0,0,0,0.22))',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 12px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                }}
              >
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text-3)',
                  }}
                >
                  {collapsedPanel}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setCollapsedPanel(null)}
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-2)',
                    borderRadius: 8,
                    padding: '4px 8px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                  }}
                >
                  CLOSE
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: 12,
                  display: 'grid',
                  gap: 10,
                }}
              >
                {collapsedPanel === 'sessions' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          fontFamily: "'Oxanium', monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--text)',
                        }}
                      >
                        AGENTVIEWER
                      </div>
                      <div style={{ flex: 1 }} />
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: 'var(--text-3)',
                          background: 'var(--surface-3)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '3px 8px',
                        }}
                      >
                        {filteredSessions.length}
                      </div>
                    </div>
                    <div
                      style={{
                        maxHeight: 'min(72vh, 720px)',
                        overflowY: 'auto',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                      }}
                    >
                      {sortMode === 'project' && groups.map(({ projectDir, projectName, sessions: groupSessions }) => (
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
                      {sortMode === 'time' && timeEntries.map((entry) => {
                        if (entry.type === 'header') {
                          const isProjectSelected = sameProjectPath(selectedProject, entry.projectDir)
                          return (
                            <div
                              key={entry.key}
                              onClick={() => onSelectProject(entry.projectDir, entry.projectName, entry.projectSessions)}
                              className={`av-project-header ${isProjectSelected ? 'av-selected' : ''}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '8px 12px 8px 14px',
                                userSelect: 'none',
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              <span
                                className="av-project-name"
                                style={{
                                  fontFamily: "'Oxanium', monospace",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  letterSpacing: '0.08em',
                                  textTransform: 'uppercase',
                                  flex: 1,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {entry.projectName}
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
                                {entry.count}
                              </span>
                            </div>
                          )
                        }
                        return (
                          <ViewTransition key={entry.key} enter="fade-in" default="none">
                            <SessionRow
                              session={entry.session}
                              selected={sessionTabKey(entry.session) === selectedId}
                              onSelect={onSelect}
                              onRename={onRename}
                              onTag={onTag}
                            />
                          </ViewTransition>
                        )
                      })}
                    </div>
                  </>
                )}

                {collapsedPanel === 'provider' && (
                  <>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <Label
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 8,
                          color: 'var(--text-3)',
                          letterSpacing: '0.1em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        PROVIDER
                      </Label>
                      <NativeSelect
                        ref={providerSelectRef}
                        value={provider}
                        onChange={(event) => onChangeProvider(event.target.value as ProviderSelection)}
                        disabled={switchingProvider}
                        className={cn(providerNativeSelectClassName, switchingProvider ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
                      >
                        <NativeSelectOption value="claude">CLAUDE</NativeSelectOption>
                        <NativeSelectOption value="codex">CODEX</NativeSelectOption>
                        <NativeSelectOption value="opencode">OPENCODE</NativeSelectOption>
                        <NativeSelectOption value="copilot">COPILOT</NativeSelectOption>
                        <NativeSelectOption value="pi">PI</NativeSelectOption>
                        <NativeSelectOption value="all">ALL</NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                      Choose the provider to scope the session list. This panel behaves like the shadcn sidebar pop-out pattern.
                    </div>
                  </>
                )}

                {collapsedPanel === 'search' && (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input
                        ref={searchInputRef}
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Search title, tags, path, prompt…"
                        style={{
                          flex: 1,
                          height: 34,
                          borderRadius: 8,
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
                            height: 34,
                            padding: '0 10px',
                            borderRadius: 8,
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
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                      Search the current provider and scope. Popular tags stay available in the filter panel.
                    </div>
                  </>
                )}

                {collapsedPanel === 'project' && (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        onClick={() => setSortMode('project')}
                        variant="outline"
                        size="sm"
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${sortMode === 'project' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
                          background: sortMode === 'project' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
                          color: sortMode === 'project' ? 'var(--violet)' : 'var(--text-3)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 11,
                          letterSpacing: '0.06em',
                          cursor: 'pointer',
                        }}
                      >
                        BY PROJECT
                      </Button>
                      <Button
                        onClick={() => setSortMode('time')}
                        variant="outline"
                        size="sm"
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${sortMode === 'time' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
                          background: sortMode === 'time' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
                          color: sortMode === 'time' ? 'var(--violet)' : 'var(--text-3)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 11,
                          letterSpacing: '0.06em',
                          cursor: 'pointer',
                        }}
                      >
                        BY TIME
                      </Button>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        onClick={() => onChangeScope('all')}
                        variant="outline"
                        size="sm"
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
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
                          height: 32,
                          borderRadius: 8,
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
                      <Label
                        style={{
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
                    )}
                  </>
                )}

                {collapsedPanel === 'filters' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                      }}
                    >
                      {popularTags.length > 0 ? (
                        popularTags.map(([tag, count]) => {
                          const selected = activeTag?.toLowerCase() === tag.toLowerCase()
                          return (
                            <Button
                              key={tag}
                              onClick={() => setActiveTag((prev) => prev?.toLowerCase() === tag.toLowerCase() ? null : tag)}
                              variant="outline"
                              size="sm"
                              style={{
                                height: 26,
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
                        })
                      ) : (
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                          No tags available.
                        </div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                      Filter by the most common tags in the current session set.
                    </div>
                  </>
                )}

                {collapsedPanel === 'overview' && (
                  <>
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
                        {summaryText}
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                        {provider.toUpperCase()} · {sortMode === 'time' ? 'sorted by time' : 'grouped by project'}
                        {scopeMode === 'project' && scopeProjectName ? ` · ${scopeProjectName}` : ''}
                      </div>
                    </div>
                    <Button
                      onClick={() => setOpen(true)}
                      variant="outline"
                      size="sm"
                      style={{
                        height: 34,
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        color: 'var(--text)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        letterSpacing: '0.06em',
                        cursor: 'pointer',
                      }}
                    >
                      OPEN FULL SIDEBAR
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--surface)',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <SidebarRail
        onMouseDown={(e) => {
          e.preventDefault()
          resizeWidthRef.current = Math.max(220, Math.min(640, e.clientX))
          setResizing(true)
        }}
        onDoubleClick={() => {
          resizeWidthRef.current = 290
          applyWidth(290)
          setSidebarWidth(290)
        }}
        title="Drag to resize · double-click to reset"
        style={{
          background: resizing ? 'var(--violet-glow)' : 'transparent',
        }}
      />
      <SidebarHeader>
        <div
          style={{
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            background: 'linear-gradient(160deg, rgba(139,128,240,0.07) 0%, transparent 60%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                minWidth: 0,
              }}
            >
              {!collapsed && (
                <div
                  style={{
                    fontFamily: "'Oxanium', monospace",
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <LayoutDashboard size={13} strokeWidth={2.2} style={{ color: 'var(--violet)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>Agent Viewer</span>
                </div>
              )}
              <SidebarTrigger
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="ml-auto h-7 w-7 shrink-0 rounded-md border-border bg-[var(--surface-2)] px-0 text-[var(--text-3)] shadow-none hover:bg-[var(--surface-3)] [&_svg]:size-4"
              />
            </div>
            {!collapsed && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <Button
                  onClick={onOpenCommandPalette}
                  variant="outline"
                  size="sm"
                  title="Open command palette"
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                  }}
                >
                  ⌘K
                </Button>
                <ThemeToggle />
              </div>
            )}
          </div>
        </div>
        {!collapsed && (
          <Card
            style={{
              margin: '10px 14px 8px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
              boxShadow: '0 10px 24px var(--violet-glow)',
            }}
          >
            <CardContent style={{ padding: 12 }}>
              <div style={{ display: 'grid', gap: 5 }}>
                  <Label
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 8,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    PROVIDER
                  </Label>
                  <NativeSelect
                    ref={providerSelectRef}
                    value={provider}
                    onChange={(event) => onChangeProvider(event.target.value as ProviderSelection)}
                    disabled={switchingProvider}
                    className={cn(providerNativeSelectClassName, switchingProvider ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
                  >
                    <NativeSelectOption value="claude">CLAUDE</NativeSelectOption>
                    <NativeSelectOption value="codex">CODEX</NativeSelectOption>
                    <NativeSelectOption value="opencode">OPENCODE</NativeSelectOption>
                    <NativeSelectOption value="copilot">COPILOT</NativeSelectOption>
                    <NativeSelectOption value="pi">PI</NativeSelectOption>
                    <NativeSelectOption value="all">ALL</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Input
                    ref={searchInputRef}
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
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <Button
                    onClick={() => setSortMode('project')}
                    variant="outline"
                    size="sm"
                    style={{
                      flex: 1,
                      height: 28,
                      borderRadius: 5,
                      border: `1px solid ${sortMode === 'project' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
                      background: sortMode === 'project' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
                      color: sortMode === 'project' ? 'var(--violet)' : 'var(--text-3)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      letterSpacing: '0.06em',
                      cursor: 'pointer',
                    }}
                    title="Group sessions by project"
                  >
                    BY PROJECT
                  </Button>
                  <Button
                    onClick={() => setSortMode('time')}
                    variant="outline"
                    size="sm"
                    style={{
                      flex: 1,
                      height: 28,
                      borderRadius: 5,
                      border: `1px solid ${sortMode === 'time' ? 'rgba(139,128,240,0.32)' : 'var(--border)'}`,
                      background: sortMode === 'time' ? 'rgba(139,128,240,0.12)' : 'var(--surface-2)',
                      color: sortMode === 'time' ? 'var(--violet)' : 'var(--text-3)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      letterSpacing: '0.06em',
                      cursor: 'pointer',
                    }}
                    title="Sort sessions by most recent activity"
                  >
                    BY TIME
                  </Button>
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
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
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
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
        )}
      </SidebarHeader>
      {!collapsed && (
        <SidebarContent>
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

            {!loading && !error && sortMode === 'project' && groups.map(({ projectDir, projectName, sessions: groupSessions }) => (
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
            {!loading && !error && sortMode === 'time' && timeEntries.map((entry) => {
              if (entry.type === 'header') {
                const isProjectSelected = sameProjectPath(selectedProject, entry.projectDir)
                return (
                  <div
                    key={entry.key}
                    onClick={() => onSelectProject(entry.projectDir, entry.projectName, entry.projectSessions)}
                    className={`av-project-header ${isProjectSelected ? 'av-selected' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '8px 14px 8px 16px',
                      userSelect: 'none',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span
                      className="av-project-name"
                      style={{
                        fontFamily: "'Oxanium', monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.projectName}
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
                      {entry.count}
                    </span>
                  </div>
                )
              }
              return (
                <SessionRow
                  key={entry.key}
                  session={entry.session}
                  selected={sessionTabKey(entry.session) === selectedId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onTag={onTag}
                />
              )
            })}
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
        </SidebarContent>
      )}
      {!collapsed && (
        <SidebarFooter>
          <div
            style={{
              padding: '12px 14px 14px',
              borderTop: '1px solid var(--border)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              letterSpacing: '0.03em',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--green)',
                  flexShrink: 0,
                  animation: 'live-pulse 2.5s ease-in-out infinite',
                  display: 'inline-block',
                }}
              />
              <span>{summaryText}</span>
            </div>
          </div>
        </SidebarFooter>
      )}
    </div>
  )
}

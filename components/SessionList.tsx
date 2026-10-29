'use client'

import { useSidebarResize } from './session-list/useSidebarResize'

import { providerNativeSelectClassName, collapsedPrimaryButtonStyle, sidebarHeaderPrimaryActionStyle, collapsedIconButtonStyle, sidebarHeaderIconActionStyle, segmentStyle } from './session-list/appearance'
import { sessionTabKey, providerLabel } from './session-list/presentation'
import { ShowProviderContext, EMPTY_TEAM_ATTENTION, TeamAttentionContext } from './session-list/contexts'
import { type SessionListProps, type CollapsedPanel } from './session-list/types'
import { SessionRow } from './session-list/SessionRow'

import { ProjectGroup } from './session-list/ProjectGroup'

import { memo, useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_COLOR_TREATMENT,
  getCurrentColorTreatment,
  subscribeColorTreatment,
  type ColorTreatment,
} from '@/lib/colorTreatment'
import { sameProjectPath } from '@/lib/projectPaths'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { BookOpen, Bot, Command, GitBranch, LayoutDashboard, ListTree, MessageSquare, Search, SlidersHorizontal, UsersRound } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import { useSessionListModel } from './session-list/useSessionListModel'

function SessionListInner({
  sessions,
  loading,
  error,
  provider,
  providerInstanceId,
  providerInstances,
  switchingProvider,
  selectedId,
  selectedProject,
  dashboardSelected = false,
  agentOperationsSelected = false,
  messagingSelected = false,
  teamAttention,
  scrollToSessionRequest,
  onSelect,
  onSelectProject,
  onOpenDashboard,
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
  onOpenCoordinator,
  onOpenCrossSessionMessaging,
  canOpenGit,
  onOpenGit,
  onNewSession,
  creatingSession = false,
}: SessionListProps) {
  const { state: sidebarState, width: sidebarWidth, setWidth: setSidebarWidth, applyWidth, setOpen } = useSidebar()
  const collapsed = sidebarState === 'collapsed'
  const colorTreatment = useSyncExternalStore<ColorTreatment>(
    subscribeColorTreatment,
    getCurrentColorTreatment,
    () => DEFAULT_COLOR_TREATMENT,
  )
  const { resizing, startResize, resetWidth } = useSidebarResize(sidebarWidth, applyWidth, setSidebarWidth)
  const [collapsedPanel, setCollapsedPanel] = useState<CollapsedPanel | null>(null)
  const providerSelectClassName = colorTreatment === 'flat'
    ? cn(nativeSelectBaseClassName,
      'av-hover-control h-9 rounded-[9px] border-[var(--border)] bg-[var(--surface-2)] bg-none px-3 text-[11px] font-medium tracking-[0.04em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]')
    : providerNativeSelectClassName
  const providerSelectRef = useRef<HTMLSelectElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const previousProviderRef = useRef(provider)

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

  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
  }, [])
  const { searchText, setSearchText, activeTag, setActiveTag, sortMode, setSortMode, filteredSessions, groups, childrenByParentId, showProviderPerRow, timeEntries, popularTags } = useSessionListModel(sessions)

  useEffect(() => {
    if (previousProviderRef.current === provider) return
    previousProviderRef.current = provider
    const frameId = window.requestAnimationFrame(() => {
      const content = rootRef.current?.querySelector<HTMLElement>('[data-slot="sidebar-content"]')
      if (content) content.scrollTop = 0
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [provider])

  useEffect(() => {
    if (!scrollToSessionRequest) return
    const targetExists = sessions.some((session) => sessionTabKey(session) === scrollToSessionRequest.sessionKey)
    if (!targetExists) return
    const targetVisible = filteredSessions.some((indexed) => sessionTabKey(indexed.session) === scrollToSessionRequest.sessionKey)
    if (targetVisible) return
    setSearchText('')
    setActiveTag(null)
  }, [filteredSessions, scrollToSessionRequest, sessions])

  useEffect(() => {
    if (!scrollToSessionRequest || collapsed || loading) return

    let frameId: number | null = null
    let attempts = 0
    const scrollToRow = () => {
      const root = rootRef.current
      const row = root
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-session-key]'))
            .find((candidate) => candidate.dataset.sessionKey === scrollToSessionRequest.sessionKey)
        : null

      if (row) {
        row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
        return
      }

      attempts += 1
      if (attempts <= 12) frameId = window.requestAnimationFrame(scrollToRow)
    }

    frameId = window.requestAnimationFrame(scrollToRow)
    return () => {
      if (frameId != null) window.cancelAnimationFrame(frameId)
    }
  }, [
    collapsed,
    filteredSessions,
    loading,
    scrollToSessionRequest,
    sortMode,
  ])
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
        ref={rootRef}
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
            background: colorTreatment === 'flat' ? 'var(--surface)' : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
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
              className="av-hover-control"
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
              <SidebarGlyph size={15} strokeWidth={2} style={{ transform: 'scaleX(-1)' }} />
            </button>

            <button
              type="button"
              onClick={() => handleCollapsedAction('sessions')}
              aria-label="Show sessions"
              title="Show sessions"
              className="av-hover-control"
              style={collapsedPrimaryButtonStyle}
            >
              <ListTree size={22} strokeWidth={2.3} />
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setCollapsedPanel(null)
                  onOpenDashboard()
                }}
                aria-label="Run dashboard"
                title="Run dashboard"
                className="av-hover-control"
                style={collapsedIconButtonStyle(dashboardSelected)}
              >
                <LayoutDashboard size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollapsedPanel(null)
                  onOpenCoordinator()
                }}
                aria-label="Agent Operations dashboard"
                title="Agent Operations"
                className="av-hover-control"
                style={collapsedIconButtonStyle(agentOperationsSelected)}
              >
                <UsersRound size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('provider')}
                aria-label="Provider controls"
                title="Provider"
                className="av-hover-control"
                style={collapsedIconButtonStyle(collapsedPanel === 'provider')}
              >
                <Bot size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('search')}
                aria-label="Search"
                title="Search"
                className="av-hover-control"
                style={collapsedIconButtonStyle(collapsedPanel === 'search')}
              >
                <Search size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('project')}
                aria-label="Project scope"
                title="Projects"
                className="av-hover-control"
                style={collapsedIconButtonStyle(collapsedPanel === 'project')}
              >
                <LayoutDashboard size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('filters')}
                aria-label="Filters"
                title="Filters"
                className="av-hover-control"
                style={collapsedIconButtonStyle(collapsedPanel === 'filters')}
              >
                <SlidersHorizontal size={20} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => handleCollapsedAction('overview')}
                aria-label="Overview"
                title="Overview"
                className="av-hover-control"
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
                background: colorTreatment === 'flat' ? 'var(--surface)' : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
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
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    textTransform: 'capitalize',
                  }}
                >
                  {collapsedPanel}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setCollapsedPanel(null)}
                  className="av-hover-control"
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-2)',
                    borderRadius: 8,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Close
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
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      >
                        Sessions
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
                          hydrated={hydrated}
                          childrenByParentId={childrenByParentId}
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
                                  fontSize: 12,
                                  fontWeight: 600,
                                  letterSpacing: '0.01em',
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
                            hydrated={hydrated}
                            onSelect={onSelect}
                            onRename={onRename}
                            onTag={onTag}
                          />
                        )
                      })}
                    </div>
                  </>
                )}

                {collapsedPanel === 'provider' && (
                  <>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <NativeSelect
                        ref={providerSelectRef}
                        aria-label="Provider"
                        value={provider === 'all' ? 'all' : providerInstanceId}
                        onChange={(event) => {
                          if (event.target.value === 'all') return onChangeProvider('all')
                          const instance = providerInstances.find((candidate) => candidate.id === event.target.value)
                          if (instance) onChangeProvider(instance.provider, instance.id)
                        }}
                        disabled={switchingProvider}
className={cn(providerSelectClassName, switchingProvider ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
                      >
                        {providerInstances.map((instance) => (
                          <NativeSelectOption key={instance.id} value={instance.id}>
                            {instance.displayName}
                          </NativeSelectOption>
                        ))}
                        <NativeSelectOption value="all">All providers</NativeSelectOption>
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
                        className="av-hover-control"
                        style={{
                          flex: 1,
                          height: 34,
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-2)',
                          color: 'var(--text)',
                          padding: '0 10px',
                          fontSize: 12,
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
                          className="av-hover-control"
                          style={{
                            height: 34,
                            padding: '0 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--surface-2)',
                            color: 'var(--text-3)',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Clear
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
                        className={sortMode === 'project' ? 'av-control-btn av-hover-control av-active' : 'av-control-btn av-hover-control'}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        By project
                      </Button>
                      <Button
                        onClick={() => setSortMode('time')}
                        variant="outline"
                        size="sm"
                        className={sortMode === 'time' ? 'av-control-btn av-hover-control av-active' : 'av-control-btn av-hover-control'}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        By time
                      </Button>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        onClick={() => onChangeScope('all')}
                        variant="outline"
                        size="sm"
                        className={scopeMode === 'all' ? 'av-control-btn av-hover-control av-active' : 'av-control-btn av-hover-control'}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        All projects
                      </Button>
                      <Button
                        onClick={() => canScopeToProject && onChangeScope('project')}
                        disabled={!canScopeToProject}
                        title={canScopeToProject ? 'Show only sessions for the current project' : 'Select a session or project first'}
                        variant="outline"
                        size="sm"
                        className={scopeMode === 'project' ? 'av-control-btn av-hover-control av-active' : 'av-control-btn av-hover-control'}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          fontSize: 12,
                          opacity: canScopeToProject ? 1 : 0.45,
                        }}
                      >
                        This project
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
                              className="av-hover-control"
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
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        {summaryText}
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                        {provider === 'all' ? 'All providers' : providerLabel(provider)} · {sortMode === 'time' ? 'sorted by time' : 'grouped by project'}
                        {scopeMode === 'project' && scopeProjectName ? ` · ${scopeProjectName}` : ''}
                      </div>
                    </div>
                    <Button
                      onClick={() => setOpen(true)}
                      variant="outline"
                      size="sm"
                      className="av-hover-control"
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
    <TeamAttentionContext.Provider value={teamAttention ?? EMPTY_TEAM_ATTENTION}>
    <ShowProviderContext.Provider value={showProviderPerRow}>
    <div
      ref={rootRef}
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
          startResize(e.clientX)
        }}
        onDoubleClick={resetWidth}
        title="Drag to resize · double-click to reset"
        style={{
          background: resizing ? (colorTreatment === 'flat' ? 'color-mix(in srgb, var(--violet) 30%, transparent)' : 'var(--violet-glow)') : 'transparent',
        }}
      />
      <SidebarHeader>
        <div
          style={{
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            background: colorTreatment === 'flat' ? 'var(--surface)' : 'linear-gradient(160deg, rgba(139,128,240,0.07) 0%, transparent 60%)',
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
                  <img
                    src="/icon.png"
                    alt=""
                    width={16}
                    height={16}
                    style={{ borderRadius: 4, flexShrink: 0 }}
                  />
                  <span style={{ flex: 1 }}>Agent Viewer</span>
                </div>
              )}
              <SidebarTrigger
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="ml-auto size-7 shrink-0 rounded-md border-border bg-[var(--surface-2)] px-0 text-[var(--text-3)] shadow-none hover:bg-[var(--surface-3)]"
              />
            </div>
            {!collapsed && (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  width: '100%',
                  minWidth: 0,
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
                  {onNewSession && (
                    <Button
                      onClick={onNewSession}
                      disabled={creatingSession}
                      variant="outline"
                      size="sm"
                      aria-label="Start a new agent session"
                      className="av-hover-control"
                      style={{
                        ...sidebarHeaderPrimaryActionStyle,
                        cursor: creatingSession ? 'not-allowed' : 'pointer',
                        opacity: creatingSession ? 0.55 : 1,
                      }}
                    >
                      <span aria-hidden="true">{creatingSession ? '…' : '+'}</span>
                      <span>New</span>
                    </Button>
                  )}
                  <div
                    aria-label="Sidebar shortcuts"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginLeft: 'auto',
                    }}
                  >
                    <Button
                      onClick={onOpenDashboard}
                      variant="outline"
                      size="sm"
                      aria-label="Open run dashboard"
                      className="av-hover-control"
                      style={sidebarHeaderIconActionStyle({ active: dashboardSelected, accent: 'cyan' })}
                    >
                      <LayoutDashboard size={15} strokeWidth={2.2} />
                    </Button>
                    <Button
                      onClick={onOpenCoordinator}
                      variant="outline"
                      size="sm"
                      aria-label="Open Agent Operations dashboard"
                      className="av-hover-control"
                      style={sidebarHeaderIconActionStyle({ active: agentOperationsSelected, accent: 'cyan' })}
                    >
                      <UsersRound size={16} strokeWidth={2.2} />
                    </Button>
                    <Button
                      onClick={onOpenCrossSessionMessaging}
                      variant="outline"
                      size="sm"
                      aria-label="Open cross-session messaging"
                      className="av-hover-control"
                      style={sidebarHeaderIconActionStyle({ active: messagingSelected, accent: 'cyan' })}
                    >
                      <MessageSquare size={15} strokeWidth={2.2} />
                    </Button>
                    <Button
                      onClick={onOpenCommandPalette}
                      variant="outline"
                      size="sm"
                      aria-label="Open command palette"
                      className="av-hover-control"
                      style={sidebarHeaderIconActionStyle()}
                    >
                      <Command size={15} strokeWidth={2.2} />
                    </Button>
                    <Button
                      onClick={onOpenGit}
                      disabled={!canOpenGit}
                      variant="outline"
                      size="sm"
                      aria-label={canOpenGit ? 'Open git status' : 'Select a session or project to open git status'}
                      className="av-hover-control"
                      style={sidebarHeaderIconActionStyle({ disabled: !canOpenGit })}
                    >
                      <GitBranch size={15} strokeWidth={2.2} />
                    </Button>
                  </div>
                </div>
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
              background: 'var(--surface)',
              boxShadow: 'none',
            }}
          >
            <CardHeader className="sr-only">
              <CardTitle>Session filters</CardTitle>
            </CardHeader>
            <CardContent style={{ padding: 12 }}>
              <div style={{ display: 'grid', gap: 5 }}>
                  <NativeSelect
                    ref={providerSelectRef}
                    aria-label="Provider"
                    value={provider === 'all' ? 'all' : providerInstanceId}
                    onChange={(event) => {
                      if (event.target.value === 'all') return onChangeProvider('all')
                      const instance = providerInstances.find((candidate) => candidate.id === event.target.value)
                      if (instance) onChangeProvider(instance.provider, instance.id)
                    }}
                    disabled={switchingProvider}
                    className={cn(providerSelectClassName, switchingProvider ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
                  >
                    {providerInstances.map((instance) => (
                      <NativeSelectOption key={instance.id} value={instance.id}>
                        {instance.displayName}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value="all">All providers</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Input
                    ref={searchInputRef}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Search title, tags, path, prompt…"
                    className="av-hover-control"
                    style={{
                      flex: 1,
                      height: 30,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                      color: 'var(--text)',
                      padding: '0 10px',
                      fontSize: 12,
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
                      className="av-hover-control"
                      style={{
                        height: 30,
                        padding: '0 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        color: 'var(--text-3)',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
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
                          className="av-hover-control"
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
                <div role="group" aria-label="Sort sessions" style={{ marginTop: 10, display: 'flex' }}>
                  <Button
                    onClick={() => setSortMode('project')}
                    variant="outline"
                    size="sm"
                    aria-pressed={sortMode === 'project'}
                    style={segmentStyle(sortMode === 'project', 'first')}
                    title="Group sessions by project"
                  >
                    By project
                  </Button>
                  <Button
                    onClick={() => setSortMode('time')}
                    variant="outline"
                    size="sm"
                    aria-pressed={sortMode === 'time'}
                    style={segmentStyle(sortMode === 'time', 'last')}
                    title="Sort sessions by most recent activity"
                  >
                    By time
                  </Button>
                </div>
                <div role="group" aria-label="Session scope" style={{ marginTop: 6, display: 'flex' }}>
                  <Button
                    onClick={() => onChangeScope('all')}
                    variant="outline"
                    size="sm"
                    aria-pressed={scopeMode === 'all'}
                    style={segmentStyle(scopeMode === 'all', 'first')}
                  >
                    All projects
                  </Button>
                  <Button
                    onClick={() => canScopeToProject && onChangeScope('project')}
                    disabled={!canScopeToProject}
                    title={canScopeToProject ? 'Show only sessions for the current project' : 'Select a session or project first'}
                    variant="outline"
                    size="sm"
                    aria-pressed={scopeMode === 'project'}
                    style={segmentStyle(scopeMode === 'project', 'last', canScopeToProject)}
                  >
                    This project
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
                hydrated={hydrated}
                scrollToSessionKey={scrollToSessionRequest?.sessionKey ?? null}
                childrenByParentId={childrenByParentId}
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
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.01em',
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
                  hydrated={hydrated}
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
    </ShowProviderContext.Provider>
    </TeamAttentionContext.Provider>
  )
}

const SessionList = memo(SessionListInner)
export default SessionList

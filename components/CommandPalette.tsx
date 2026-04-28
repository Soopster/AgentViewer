'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Bot, FolderOpen, GitBranch, Layers3, PanelLeftOpen, PanelRightOpen, Search, SlidersHorizontal } from 'lucide-react'

import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { SidebarGlyph, useSidebar } from '@/components/ui/sidebar'
import { normalizeProjectPath, pathBasename, sameProjectPath } from '@/lib/projectPaths'
import { applyTheme, getCurrentTheme, subscribeTheme, THEME_GROUPS, THEME_META, type Theme } from '@/lib/themes'
import type { PersistedSearchResult, PersistedSessionRecord } from '@/lib/sessionPersistence'
import type { AgentProvider, ProviderSelection, Session } from '@/lib/types'

type ProjectSelection = {
  key: string
  dir: string
  sessions: Session[]
}

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: Session[]
  selectedSession: Session | null
  selectedProject: ProjectSelection | null
  provider: ProviderSelection
  scopeMode: 'all' | 'project'
  scopeProjectName: string | null
  includeWorktrees: boolean
  messagePaneCollapsed: boolean
  canOpenGit: boolean
  onSelectSession: (session: Session) => void
  onSelectProject: (projectDir: string, projectName: string, sessions: Session[]) => void
  onChangeProvider: (provider: ProviderSelection) => void
  onChangeScope: (mode: 'all' | 'project') => void
  onToggleWorktrees: (include: boolean) => void
  onToggleMessagePane: () => void
  onOpenGit: () => void
}

type PaletteItem = {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  active?: boolean
  group: 'actions' | 'projects' | 'sessions' | 'messages' | 'themes'
  keywords: string[]
  score: number
  run: () => void
}

type IndexedSearchResponse = {
  query: string
  total: number
  results: PersistedSearchResult[]
}

const PROVIDER_ITEMS: Array<{ provider: ProviderSelection; label: string; description: string }> = [
  { provider: 'claude', label: 'Claude', description: 'Use the Claude provider' },
  { provider: 'codex', label: 'Codex', description: 'Use the Codex provider' },
  { provider: 'opencode', label: 'OpenCode', description: 'Use the OpenCode provider' },
  { provider: 'copilot', label: 'Copilot', description: 'Use the GitHub Copilot provider' },
  { provider: 'pi', label: 'Pi', description: 'Use the Pi provider' },
  { provider: 'all', label: 'All providers', description: 'Show sessions from every provider' },
]

function sessionTabKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function getSessionTitle(session: Session): string {
  return (
    session.customTitle ??
    session.summary ??
    (typeof session.firstPrompt === 'string' ? session.firstPrompt.slice(0, 56) : undefined) ??
    session.sessionId.slice(-8)
  ) || 'Untitled'
}

function getSessionKeywords(session: Session): string[] {
  return [
    getSessionTitle(session),
    session.summary ?? '',
    session.customTitle ?? '',
    session.firstPrompt ?? '',
    session.cwd ?? '',
    session.tag ?? '',
    session.provider ?? '',
    session.sessionId,
  ]
}

function getSessionSortMs(session: Session): number {
  const value = session.lastModified ?? session.createdAt
  if (value == null) return 0
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function sessionFromPersistedRecord(record: PersistedSessionRecord): Session {
  return {
    sessionId: record.sessionId,
    provider: record.provider,
    summary: record.summary ?? record.title,
    customTitle: record.customTitle,
    firstPrompt: record.firstPrompt,
    cwd: record.cwd,
    tag: record.tag,
    createdAt: record.createdAt,
    lastModified: record.lastModified,
  }
}

function scoreMatch(text: string, query: string): number {
  if (!query) return 0
  const normalizedText = text.toLowerCase()
  if (normalizedText === query) return 300
  if (normalizedText.startsWith(query)) return 220 - normalizedText.length / 100
  const index = normalizedText.indexOf(query)
  if (index >= 0) return 160 - index
  const pieces = query.split(/\s+/).filter(Boolean)
  if (pieces.length > 1 && pieces.every((piece) => normalizedText.includes(piece))) return 120
  return -1
}

function bestScore(fields: string[], query: string): number {
  if (!query) return 0
  let best = -1
  for (const field of fields) {
    const score = scoreMatch(field, query)
    if (score > best) best = score
  }
  return best
}

function providerStyle(provider: AgentProvider): { color: string; background: string; border: string } {
  if (provider === 'codex') {
    return { color: 'var(--cyan)', background: 'rgba(56,217,245,0.10)', border: 'rgba(56,217,245,0.22)' }
  }
  if (provider === 'opencode') {
    return { color: 'var(--green)', background: 'rgba(45,212,160,0.10)', border: 'rgba(45,212,160,0.22)' }
  }
  if (provider === 'copilot') {
    return { color: 'var(--amber)', background: 'rgba(234,170,64,0.10)', border: 'rgba(234,170,64,0.22)' }
  }
  if (provider === 'pi') {
    return { color: 'var(--red)', background: 'rgba(240,80,80,0.10)', border: 'rgba(240,80,80,0.22)' }
  }
  return { color: 'var(--violet)', background: 'rgba(139,128,240,0.10)', border: 'rgba(139,128,240,0.22)' }
}

function providerIconLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'codex':
      return 'Cx'
    case 'claude':
      return 'Cl'
    case 'opencode':
      return 'Oc'
    case 'copilot':
      return 'Cp'
    case 'pi':
      return 'Pi'
    default:
      return 'Ai'
  }
}

function ActiveDot() {
  return (
    <span
      title="Active"
      aria-label="Active"
      className="ml-auto inline-flex size-2.5 shrink-0 rounded-full bg-[var(--violet)] shadow-[0_0_0_3px_var(--violet-glow)]"
    />
  )
}

function PaletteMetaChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="ml-auto inline-flex min-w-6 max-w-16 shrink-0 items-center justify-center truncate rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em] text-[var(--text-3)]"
    >
      {children}
    </span>
  )
}

function ShortcutChip({ value }: { value: string }) {
  const compact = value
    .replace(/^Ctrl\s+/i, '^')
    .replace(/^Project$/i, 'Prj')
    .replace(/^All$/i, 'All')
    .replace(/^On$/i, 'On')
    .replace(/^Off$/i, 'Off')
  return <PaletteMetaChip title={value}>{compact}</PaletteMetaChip>
}

export default function CommandPalette({
  open,
  onOpenChange,
  sessions,
  selectedSession,
  selectedProject,
  provider,
  scopeMode,
  scopeProjectName,
  includeWorktrees,
  messagePaneCollapsed,
  canOpenGit,
  onSelectSession,
  onSelectProject,
  onChangeProvider,
  onChangeScope,
  onToggleWorktrees,
  onToggleMessagePane,
  onOpenGit,
}: CommandPaletteProps) {
  const { state: sidebarState, toggleSidebar } = useSidebar()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const activeIdRef = useRef<string | null>(null)
  const lastKeyboardMoveAtRef = useRef(0)
  const theme = useSyncExternalStore(subscribeTheme, getCurrentTheme, () => 'dark')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const [indexedResults, setIndexedResults] = useState<PersistedSearchResult[]>([])
  const [indexedLoading, setIndexedLoading] = useState(false)

  useEffect(() => {
    if (!open || normalizedQuery.length < 2) {
      setIndexedResults([])
      setIndexedLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams()
      params.set('q', deferredQuery.trim())
      params.set('limit', '8')
      params.set('provider', provider)
      params.set('includeWorktrees', String(includeWorktrees))
      const searchDir = scopeMode === 'project'
        ? selectedProject?.dir ?? selectedSession?.cwd
        : undefined
      if (searchDir) params.set('dir', searchDir)

      setIndexedLoading(true)
      try {
        const response = await fetch(`/api/session-index/search?${params.toString()}`, {
          signal: controller.signal,
        })
        const data = await response.json() as IndexedSearchResponse & { error?: string }
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
        setIndexedResults(data.results ?? [])
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setIndexedResults([])
        }
      } finally {
        if (!controller.signal.aborted) setIndexedLoading(false)
      }
    }, 160)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [deferredQuery, includeWorktrees, normalizedQuery.length, open, provider, scopeMode, selectedProject?.dir, selectedSession?.cwd])

  useEffect(() => {
    if (!open) return
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange, open])

  const sidebarAction = sidebarState === 'expanded'
    ? {
        id: 'toggle-sidebar',
        label: 'Collapse sidebar',
        description: 'Hide the session list',
        icon: <SidebarGlyph size={16} />,
      }
    : {
        id: 'toggle-sidebar',
        label: 'Expand sidebar',
        description: 'Show the session list',
        icon: <SidebarGlyph size={16} />,
      }

  const actions = useMemo(() => {
    const items: PaletteItem[] = [
      {
        id: sidebarAction.id,
        label: sidebarAction.label,
        description: sidebarAction.description,
        icon: sidebarAction.icon,
        shortcut: 'Ctrl B',
        group: 'actions',
        keywords: ['sidebar', 'collapse', 'expand', 'session list', 'panel'],
        score: 0,
        run: toggleSidebar,
      },
      {
        id: 'toggle-message-pane',
        label: messagePaneCollapsed ? 'Expand message pane' : 'Collapse message pane',
        description: 'Show or hide the transcript area',
        icon: messagePaneCollapsed ? <PanelRightOpen size={16} /> : <PanelLeftOpen size={16} />,
        group: 'actions',
        keywords: ['message', 'pane', 'transcript', 'expand', 'collapse'],
        score: 0,
        run: onToggleMessagePane,
      },
      {
        id: 'open-git',
        label: 'Open Git status',
        description: canOpenGit ? 'Show working tree, branches, and commits for the active project' : 'Select a session or project first',
        icon: <GitBranch size={16} />,
        shortcut: 'Ctrl G',
        group: 'actions',
        keywords: ['git', 'status', 'diff', 'branch', 'commit', 'working tree'],
        score: 0,
        run: onOpenGit,
      },
      {
        id: 'scope-all',
        label: 'Show all projects',
        description: 'Clear the project scope filter',
        icon: <Layers3 size={16} />,
        shortcut: 'All',
        active: scopeMode === 'all',
        group: 'actions',
        keywords: ['scope', 'all', 'projects', 'filter'],
        score: 0,
        run: () => onChangeScope('all'),
      },
      {
        id: 'scope-current',
        label: 'Scope to current project',
        description: scopeProjectName ? `Focus on ${scopeProjectName}` : 'Focus on the selected project',
        icon: <FolderOpen size={16} />,
        shortcut: 'Project',
        active: scopeMode === 'project',
        group: 'actions',
        keywords: ['scope', 'project', 'current', 'focus'],
        score: 0,
        run: () => onChangeScope('project'),
      },
      {
        id: 'worktrees-toggle',
        label: includeWorktrees ? 'Hide worktrees' : 'Show worktrees',
        description: 'Include or exclude worktree sessions in project views',
        icon: <SlidersHorizontal size={16} />,
        shortcut: includeWorktrees ? 'On' : 'Off',
        group: 'actions',
        keywords: ['worktree', 'worktrees', 'project', 'filter'],
        score: 0,
        run: () => onToggleWorktrees(!includeWorktrees),
      },
    ]

    for (const item of PROVIDER_ITEMS) {
      items.push({
        id: `provider:${item.provider}`,
        label: item.label,
        description: item.description,
        icon: <Bot size={16} />,
        shortcut: provider === item.provider ? 'Active' : undefined,
        active: provider === item.provider,
        group: 'actions',
        keywords: ['provider', item.provider, item.label.toLowerCase(), 'switch'],
        score: 0,
        run: () => onChangeProvider(item.provider),
      })
      }

    return items
  }, [canOpenGit, includeWorktrees, messagePaneCollapsed, onChangeProvider, onChangeScope, onOpenGit, onToggleMessagePane, onToggleWorktrees, provider, scopeMode, scopeProjectName, sidebarAction, toggleSidebar])

  const projectItems = useMemo(() => {
    const groups = new Map<string, {
      projectDir: string
      projectName: string
      sessions: Session[]
      keywords: string[]
      score: number
      active: boolean
    }>()

    for (const session of sessions) {
      const normalizedDir = normalizeProjectPath(session.cwd) || '—'
      const projectName = pathBasename(normalizedDir) || '—'
      const current = groups.get(normalizedDir)
      const keywords = getSessionKeywords(session)
      if (current) {
        current.sessions.push(session)
        current.keywords.push(...keywords)
        current.score = Math.max(current.score, getSessionSortMs(session))
        continue
      }
      groups.set(normalizedDir, {
        projectDir: normalizedDir,
        projectName,
        sessions: [session],
        keywords,
        score: getSessionSortMs(session),
        active: sameProjectPath(selectedProject?.dir, normalizedDir),
      })
    }

    return [...groups.values()]
      .map((group) => {
        const score = normalizedQuery
          ? bestScore([group.projectName, group.projectDir, ...group.keywords], normalizedQuery)
          : group.score
        return {
          id: `project:${group.projectDir}`,
          label: group.projectName,
          description: group.projectDir === '—' ? 'Unknown project path' : group.projectDir,
          icon: <FolderOpen size={16} />,
          shortcut: `${group.sessions.length}`,
          active: group.active,
          group: 'projects' as const,
          keywords: [group.projectName, group.projectDir, ...group.keywords],
          score,
          run: () => onSelectProject(group.projectDir, group.projectName, group.sessions),
        }
      })
      .filter((item) => normalizedQuery ? item.score >= 0 : true)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 8)
  }, [onSelectProject, normalizedQuery, selectedProject?.dir, sessions])

  const sessionItems = useMemo(() => {
    return sessions
      .map((session) => {
        const title = getSessionTitle(session)
        const project = session.cwd ? pathBasename(session.cwd) || session.cwd : 'No project'
        const keywords = getSessionKeywords(session)
        const score = normalizedQuery
          ? bestScore(keywords, normalizedQuery)
          : getSessionSortMs(session)
        return {
          id: `session:${sessionTabKey(session)}`,
          label: title,
          description: session.cwd ? `${project} · ${session.provider ?? 'claude'}` : (session.provider ?? 'claude'),
          icon: <Search size={16} />,
          shortcut: session.sessionId.slice(-6),
          active: sessionTabKey(session) === sessionTabKey(selectedSession ?? { sessionId: '', provider: 'claude' }),
          group: 'sessions' as const,
          keywords,
          score,
          run: () => onSelectSession(session),
        }
      })
      .filter((item) => normalizedQuery ? item.score >= 0 : true)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 12)
  }, [onSelectSession, normalizedQuery, selectedSession, sessions])

  const indexedMessageItems = useMemo(() => {
    if (normalizedQuery.length < 2) return []
    return indexedResults.map((result) => {
      const session = sessionFromPersistedRecord(result.session)
      const match = result.matches[0]
      const project = result.session.cwd ? pathBasename(result.session.cwd) || result.session.cwd : 'No project'
      return {
        id: `message:${result.session.key}:${match?.uuid ?? 'metadata'}`,
        label: result.session.title,
        description: match?.snippet ?? result.session.cwd ?? result.session.sessionId,
        icon: <Search size={16} />,
        shortcut: `${result.matches.length || 1}`,
        active: sessionTabKey(session) === sessionTabKey(selectedSession ?? { sessionId: '', provider: 'claude' }),
        group: 'messages' as const,
        keywords: [result.session.title, result.session.cwd ?? '', project, match?.snippet ?? ''],
        score: result.score,
        run: () => onSelectSession(session),
      }
    })
  }, [indexedResults, normalizedQuery.length, onSelectSession, selectedSession])

  const themeItems = useMemo(() => THEME_GROUPS.map((group) => {
    const items = group.themes
      .map((themeName) => {
        const meta = THEME_META[themeName]
        const score = normalizedQuery
          ? bestScore([meta.label, themeName, meta.category, 'theme'], normalizedQuery)
          : 0
        return {
          id: `theme:${themeName}`,
          label: meta.label,
          description: `${group.label} theme`,
          icon: meta.icon,
          shortcut: theme === themeName ? 'Active' : undefined,
          active: theme === themeName,
          group: 'themes' as const,
          keywords: [meta.label, themeName, meta.category, 'theme'],
          score,
          run: () => {
            applyTheme(themeName)
          },
        }
      })
      .filter((item) => normalizedQuery ? item.score >= 0 : true)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))

    return { ...group, items }
  }).filter((group) => group.items.length > 0), [normalizedQuery, theme])

  const filteredActions = useMemo(
    () => actions.filter((item) => (normalizedQuery ? item.keywords.join(' ').toLowerCase().includes(normalizedQuery) || item.label.toLowerCase().includes(normalizedQuery) : true)),
    [actions, normalizedQuery],
  )

  const themeFlatItems = useMemo(() => themeItems.flatMap((group) => group.items), [themeItems])

  const visibleItems = useMemo(
    () => [...filteredActions, ...projectItems, ...sessionItems, ...indexedMessageItems, ...themeFlatItems],
    [filteredActions, indexedMessageItems, projectItems, sessionItems, themeFlatItems],
  )

  useEffect(() => {
    if (!open) {
      activeIdRef.current = null
      setActiveId(null)
      return
    }
    setActiveId((current) => {
      if (current && visibleItems.some((item) => item.id === current)) return current
      const nextId = visibleItems[0]?.id ?? null
      activeIdRef.current = nextId
      return nextId
    })
  }, [open, visibleItems])

  const activeIndex = visibleItems.findIndex((item) => item.id === activeId)
  const activeItem = activeIndex >= 0 ? visibleItems[activeIndex] : null

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  function scrollItemIntoView(id: string) {
    const list = listRef.current
    const item = itemRefs.current.get(id)
    if (!list || !item) return

    const buffer = 12
    const listRect = list.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const itemTop = itemRect.top - listRect.top + list.scrollTop
    const itemBottom = itemTop + item.offsetHeight
    const viewTop = list.scrollTop
    const viewBottom = viewTop + list.clientHeight

    if (visibleItems[0]?.id === id) {
      list.scrollTop = 0
      return
    }

    if (itemTop < viewTop + buffer) {
      list.scrollTop = Math.max(0, itemTop - buffer)
      return
    }

    if (itemBottom > viewBottom - buffer) {
      list.scrollTop = itemBottom - list.clientHeight + buffer
    }
  }

  function moveActive(delta: number) {
    if (visibleItems.length === 0) return
    const currentId = activeIdRef.current
    const currentIndex = currentId ? visibleItems.findIndex((item) => item.id === currentId) : -1
    const nextIndex = currentIndex < 0
      ? 0
      : Math.max(0, Math.min(visibleItems.length - 1, currentIndex + delta))
    const nextId = visibleItems[nextIndex]?.id ?? null
    activeIdRef.current = nextId
    lastKeyboardMoveAtRef.current = Date.now()
    setActiveId(nextId)
    if (nextId) requestAnimationFrame(() => scrollItemIntoView(nextId))
  }

  function runItem(item: PaletteItem) {
    item.run()
    onOpenChange(false)
  }

  function captureItemRef(id: string) {
    return (node: HTMLButtonElement | null) => {
      if (node) itemRefs.current.set(id, node)
      else itemRefs.current.delete(id)
    }
  }

  function activateFromPointer(id: string, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.type === 'pointerenter' && Date.now() - lastKeyboardMoveAtRef.current < 250) return
    activeIdRef.current = id
    setActiveId((current) => current === id ? current : id)
  }

  const hasResults = visibleItems.length > 0

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-[760px]">
      <Command>
        <div
          className="flex shrink-0 items-center justify-between gap-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]"
          style={{ padding: '14px 16px' }}
        >
          <div className="min-w-0">
            <div className="font-[Oxanium] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text)]">
              Command Palette
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-3)]">
              Search sessions, projects, message text, providers, and view controls.
            </div>
          </div>
          <div className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-3)]">
            Ctrl K
          </div>
        </div>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveId(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveActive(1)
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveActive(-1)
            }
            if (event.key === 'Enter' && activeItem) {
              event.preventDefault()
              runItem(activeItem)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onOpenChange(false)
            }
          }}
          placeholder="Type a command, session title, project path, or provider..."
        />
        <CommandList ref={listRef}>
          {!hasResults && normalizedQuery ? (
            <CommandEmpty>{indexedLoading ? 'Searching indexed messages...' : 'No matches found.'}</CommandEmpty>
          ) : null}

          {filteredActions.length > 0 && (
            <CommandGroup heading="Actions">
              {filteredActions.map((item) => (
                  <CommandItem
                    ref={captureItemRef(item.id)}
                    key={item.id}
                    active={item.id === activeId}
                    onPointerEnter={(event) => activateFromPointer(item.id, event)}
                    onPointerMove={(event) => activateFromPointer(item.id, event)}
                    onClick={() => runItem(item)}
                    title={item.description}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center text-[var(--cyan)]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[13px] text-[var(--text)]">{item.label}</span>
                      <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{item.description}</span>
                    </span>
                    {item.active ? (
                      <ActiveDot />
                    ) : item.shortcut ? (
                      <ShortcutChip value={item.shortcut} />
                    ) : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          )}

          {projectItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Projects">
                {projectItems.map((item) => (
                  <CommandItem
                    ref={captureItemRef(item.id)}
                    key={item.id}
                    active={item.id === activeId}
                    onPointerEnter={(event) => activateFromPointer(item.id, event)}
                    onPointerMove={(event) => activateFromPointer(item.id, event)}
                    onClick={() => runItem(item)}
                    title={item.description}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center text-[var(--violet)]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[13px] text-[var(--text)]">{item.label}</span>
                      <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{item.description}</span>
                    </span>
                    <ShortcutChip value={item.shortcut ?? ''} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {sessionItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Sessions">
                {sessionItems.map((item) => {
                  const provider = sessions.find((session) => sessionTabKey(session) === item.id.slice('session:'.length))?.provider ?? 'claude'
                  const style = providerStyle(provider)
                  return (
                    <CommandItem
                      ref={captureItemRef(item.id)}
                      key={item.id}
                      active={item.id === activeId}
                      onPointerEnter={(event) => activateFromPointer(item.id, event)}
                      onPointerMove={(event) => activateFromPointer(item.id, event)}
                      onClick={() => runItem(item)}
                      title={item.description}
                    >
                      <span
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold uppercase tracking-[-0.02em]"
                        style={{ color: style.color, background: style.background, borderColor: style.border }}
                        title={provider}
                      >
                        {providerIconLabel(provider)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[13px] text-[var(--text)]">{item.label}</span>
                        <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{item.description} · {provider}</span>
                      </span>
                      <PaletteMetaChip title={item.shortcut}>{item.shortcut}</PaletteMetaChip>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </>
          )}

          {indexedMessageItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Indexed message matches">
                {indexedMessageItems.map((item) => {
                  const provider = indexedResults.find((result) => item.id.startsWith(`message:${result.session.key}:`))?.session.provider ?? 'claude'
                  const style = providerStyle(provider)
                  return (
                    <CommandItem
                      ref={captureItemRef(item.id)}
                      key={item.id}
                      active={item.id === activeId}
                      onPointerEnter={(event) => activateFromPointer(item.id, event)}
                      onPointerMove={(event) => activateFromPointer(item.id, event)}
                      onClick={() => runItem(item)}
                      title={item.description}
                    >
                      <span
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold uppercase tracking-[-0.02em]"
                        style={{ color: style.color, background: style.background, borderColor: style.border }}
                        title={provider}
                      >
                        {providerIconLabel(provider)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[13px] text-[var(--text)]">{item.label}</span>
                        <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{item.description}</span>
                      </span>
                      <PaletteMetaChip title="Indexed message matches">{item.shortcut}</PaletteMetaChip>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </>
          )}

          {themeItems.length > 0 && (
            <>
              <CommandSeparator />
              {themeItems.map((group) => (
                <CommandGroup key={group.category} heading={`${group.label} themes`}>
                  {group.items.map((item) => (
                    <CommandItem
                      ref={captureItemRef(item.id)}
                      key={item.id}
                      active={item.id === activeId}
                      onPointerEnter={(event) => activateFromPointer(item.id, event)}
                      onPointerMove={(event) => activateFromPointer(item.id, event)}
                      onClick={() => runItem(item)}
                      title={item.description}
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center text-[var(--cyan)]">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[13px] text-[var(--text)]">{item.label}</span>
                        <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{item.description}</span>
                      </span>
                      {item.active ? (
                        <ActiveDot />
                      ) : item.shortcut ? (
                        <ShortcutChip value={item.shortcut} />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { BarChart3, Bookmark, BookOpen, Bot, Database, FileSearch, FolderOpen, GitBranch, GitPullRequest, Layers3, ListTodo, PanelLeftOpen, PanelRightOpen, Plug, Radio, RefreshCw, Search, SlidersHorizontal, UsersRound } from 'lucide-react'

import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { SidebarGlyph, useSidebar } from '@/components/ui/sidebar'
import { normalizeProjectPath, pathBasename, sameProjectPath } from '@/lib/projectPaths'
import { applyTheme, getCurrentTheme, subscribeTheme, THEME_GROUPS, THEME_META } from '@/lib/themes'
import type { PersistedSearchMatch, PersistedSearchResult, PersistedSessionRecord } from '@/lib/sessionPersistence'
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
  canOpenFiles: boolean
  canOpenTasks: boolean
  canOpenPromptLibrary: boolean
  canOpenChannelBridge: boolean
  channelBridgeRouting: boolean
  canOpenIdeBridge: boolean
  ideBridgeRouting: boolean
  onSelectSession: (session: Session, targetMessageId?: string) => void
  onSelectProject: (projectDir: string, projectName: string, sessions: Session[]) => void
  onChangeProvider: (provider: ProviderSelection) => void
  onChangeScope: (mode: 'all' | 'project') => void
  onToggleWorktrees: (include: boolean) => void
  onToggleMessagePane: () => void
  onOpenGit: () => void
  onOpenPullRequests: () => void
  onOpenFiles: () => void
  onOpenCoordinator: () => void
  onOpenTasks: () => void
  onOpenPromptLibrary: () => void
  onOpenChannelBridge: () => void
  onToggleChannelBridgeRoute: () => void
  onOpenIdeBridge: () => void
  onToggleIdeBridgeRoute: () => void
  onOpenBookmarks: () => void
  onOpenProvenance: () => void
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
  closeOnRun?: boolean
  run: () => void | Promise<void>
}

type IndexedSearchResponse = {
  query: string
  total: number
  results: PersistedSearchResult[]
}

type IndexRebuildResponse = {
  sessions: number
  messages: number
  errors: Array<{ provider: AgentProvider; sessionId?: string; message: string }>
}

type IndexRebuildState = {
  status: 'idle' | 'running' | 'done' | 'error'
  message?: string
}

type HighlightPart = {
  text: string
  highlight: boolean
}

type IndexedMessageItem = PaletteItem & {
  provider: AgentProvider
  meta: string
  matchCount: number
  snippetParts: HighlightPart[]
  timestampMs: number | null
}

const MESSAGE_SEARCH_SESSION_LIMIT = 32
const MESSAGE_SEARCH_RESULT_LIMIT = 12

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

function messageTypeLabel(type: PersistedSearchMatch['type']): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function formatMessageMatchTime(timestampMs: number | null): string | null {
  if (timestampMs == null) return null
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function highlightTermsForQuery(query: string): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const terms = [
    normalized,
    ...normalized.split(/[^a-z0-9_./-]+/),
  ]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)

  return [...new Set(terms)].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

function highlightedSnippetParts(snippet: string, terms: string[]): HighlightPart[] {
  if (terms.length === 0 || !snippet) return [{ text: snippet, highlight: false }]

  const lowerSnippet = snippet.toLowerCase()
  const parts: HighlightPart[] = []
  let cursor = 0

  while (cursor < snippet.length) {
    let matchIndex = -1
    let matchTerm = ''

    for (const term of terms) {
      const index = lowerSnippet.indexOf(term, cursor)
      if (index < 0) continue
      if (matchIndex < 0 || index < matchIndex || (index === matchIndex && term.length > matchTerm.length)) {
        matchIndex = index
        matchTerm = term
      }
    }

    if (matchIndex < 0) break
    if (matchIndex > cursor) parts.push({ text: snippet.slice(cursor, matchIndex), highlight: false })
    parts.push({ text: snippet.slice(matchIndex, matchIndex + matchTerm.length), highlight: true })
    cursor = matchIndex + matchTerm.length
  }

  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), highlight: false })
  return parts.length > 0 ? parts : [{ text: snippet, highlight: false }]
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
  canOpenFiles,
  canOpenTasks,
  canOpenPromptLibrary,
  canOpenChannelBridge,
  channelBridgeRouting,
  canOpenIdeBridge,
  ideBridgeRouting,
  onSelectSession,
  onSelectProject,
  onChangeProvider,
  onChangeScope,
  onToggleWorktrees,
  onToggleMessagePane,
  onOpenGit,
  onOpenPullRequests,
  onOpenFiles,
  onOpenCoordinator,
  onOpenTasks,
  onOpenPromptLibrary,
  onOpenChannelBridge,
  onToggleChannelBridgeRoute,
  onOpenIdeBridge,
  onToggleIdeBridgeRoute,
  onOpenBookmarks,
  onOpenProvenance,
}: CommandPaletteProps) {
  const { state: sidebarState, toggleSidebar } = useSidebar()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement> | null>(null)
  if (itemRefs.current === null) itemRefs.current = new Map<string, HTMLButtonElement>()
  const activeIdRef = useRef<string | null>(null)
  const lastKeyboardMoveAtRef = useRef(0)
  const theme = useSyncExternalStore(subscribeTheme, getCurrentTheme, () => 'dark')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const [indexedResults, setIndexedResults] = useState<PersistedSearchResult[]>([])
  const [indexedLoading, setIndexedLoading] = useState(false)
  const [indexRebuild, setIndexRebuild] = useState<IndexRebuildState>({ status: 'idle' })

  useEffect(() => {
    if (!open || normalizedQuery.length < 2) {
      setIndexedResults([])
      setIndexedLoading(false)
      return
    }

    const controller = new AbortController()
    setIndexedLoading(true)
    setIndexedResults([])
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams()
      params.set('q', deferredQuery.trim())
      params.set('limit', String(MESSAGE_SEARCH_SESSION_LIMIT))
      params.set('provider', 'all')
      params.set('includeWorktrees', String(includeWorktrees))
      params.set('messagesOnly', '1')
      const searchDir = scopeMode === 'project'
        ? selectedProject?.dir ?? selectedSession?.cwd
        : undefined
      if (searchDir) params.set('dir', searchDir)

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
  }, [deferredQuery, includeWorktrees, normalizedQuery.length, open, scopeMode, selectedProject?.dir, selectedSession?.cwd])

  useEffect(() => {
    if (!open) return
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

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

  const rebuildSearchIndex = useCallback(async () => {
    if (indexRebuild.status === 'running') return
    setIndexRebuild({ status: 'running', message: 'Scanning all providers...' })
    try {
      const response = await fetch('/api/session-index/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'all', includeWorktrees: true }),
      })
      const data = await response.json() as IndexRebuildResponse & { error?: string }
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
      const errorCount = data.errors?.length ?? 0
      setIndexedResults([])
      setIndexRebuild({
        status: errorCount > 0 ? 'error' : 'done',
        message: `${data.sessions} sessions · ${data.messages} messages${errorCount > 0 ? ` · ${errorCount} errors` : ''}`,
      })
    } catch (err) {
      setIndexRebuild({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to rebuild index',
      })
    }
  }, [indexRebuild.status])

  const actions = useMemo(() => {
    const items: PaletteItem[] = [
      {
        id: 'rebuild-search-index',
        label: indexRebuild.status === 'running' ? 'Rebuilding search index' : 'Rebuild search index',
        description: indexRebuild.message ?? 'Clear and rebuild indexed message search from all available sessions',
        icon: indexRebuild.status === 'running' ? <RefreshCw size={16} /> : <Database size={16} />,
        shortcut: indexRebuild.status === 'done' ? 'Done' : indexRebuild.status === 'error' ? 'Error' : undefined,
        active: indexRebuild.status === 'running',
        group: 'actions',
        keywords: ['search', 'index', 'cache', 'rebuild', 'refresh', 'analytics', 'messages', 'sessions'],
        score: 0,
        closeOnRun: false,
        run: () => { void rebuildSearchIndex() },
      },
      {
        id: 'open-cross-session-analytics',
        label: 'Open cross-session analytics',
        description: 'Aggregate metrics across every persisted session',
        icon: <BarChart3 size={16} />,
        group: 'actions',
        keywords: ['analytics', 'stats', 'cost', 'tokens', 'dashboard', 'metrics', 'history', 'all sessions'],
        score: 0,
        run: () => {
          if (typeof window !== 'undefined') window.location.href = '/analytics'
        },
      },
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
        id: 'open-pull-requests',
        label: 'Review pull requests',
        description: canOpenGit ? 'Review GitHub PRs, ask the agent, and publish comments with gh' : 'Select a session or project first',
        icon: <GitPullRequest size={16} />,
        shortcut: 'Ctrl Shift G',
        group: 'actions',
        keywords: ['github', 'pull request', 'pr', 'review', 'comment', 'approve', 'gh'],
        score: 0,
        run: onOpenPullRequests,
      },
      {
        id: 'open-files',
        label: 'Browse project files',
        description: canOpenFiles ? 'Open the three-pane project file viewer with syntax previews' : 'Select a session or project first',
        icon: <FolderOpen size={16} />,
        shortcut: 'Ctrl F',
        group: 'actions',
        keywords: ['file', 'files', 'folder', 'browse', 'viewer', 'preview', 'project', 'yazi'],
        score: 0,
        run: onOpenFiles,
      },
      {
        id: 'open-agent-team',
        label: 'Open Agent Operations dashboard',
        description: 'Open the multi-agent dashboard for teammates, tasks, messages, worktrees, and merge controls',
        icon: <UsersRound size={16} />,
        shortcut: 'Team',
        group: 'actions',
        keywords: ['agent', 'team', 'coordinator', 'coordination', 'teammate', 'task board', 'worktree', 'multiagent', 'multi-agent'],
        score: 0,
        run: onOpenCoordinator,
      },
      {
        id: 'open-task-panel',
        label: 'Open task panel',
        description: canOpenTasks ? 'Show the active Claude session task registry and lineage' : 'Select a Claude session with tasks first',
        icon: <ListTodo size={16} />,
        shortcut: 'Tasks',
        group: 'actions',
        keywords: ['task', 'tasks', 'todo', 'todos', 'task panel', 'task rail', 'lineage', 'registry', 'claude'],
        score: 0,
        run: () => {
          if (canOpenTasks) onOpenTasks()
        },
      },
      {
        id: 'open-prompt-library',
        label: 'Open prompt library',
        description: canOpenPromptLibrary ? 'Browse, edit, and insert saved prompt templates into the composer' : 'Select a session first',
        icon: <BookOpen size={16} />,
        shortcut: 'Prompts',
        group: 'actions',
        keywords: ['prompt', 'prompts', 'library', 'template', 'templates', 'snippet', 'snippets', 'saved', 'reuse', 'composer'],
        score: 0,
        run: () => {
          if (canOpenPromptLibrary) onOpenPromptLibrary()
        },
      },
      {
        id: 'open-channel-bridge',
        label: 'Open channel bridge',
        description: canOpenChannelBridge ? 'Push composer messages into a side-by-side `claude` CLI session' : 'Select a Claude session first',
        icon: <Radio size={16} />,
        shortcut: 'Bridge',
        group: 'actions',
        keywords: ['channel', 'bridge', 'cli', 'claude', 'live', 'relay', 'session', 'composer'],
        score: 0,
        run: () => {
          if (canOpenChannelBridge) onOpenChannelBridge()
        },
      },
      {
        id: 'toggle-channel-bridge-route',
        label: channelBridgeRouting ? 'Stop routing composer to channel bridge' : 'Route composer to channel bridge',
        description: canOpenChannelBridge
          ? (channelBridgeRouting
            ? 'Composer sends go to the live `claude` CLI session — switch back to the active provider'
            : 'Send composer messages to the live `claude` CLI session instead of the active provider')
          : 'Select a Claude session first',
        icon: <Radio size={16} />,
        shortcut: channelBridgeRouting ? 'Bridge on' : 'Bridge',
        group: 'actions',
        keywords: ['channel', 'bridge', 'route', 'routing', 'cli', 'claude', 'live', 'composer', 'send', 'toggle'],
        score: 0,
        run: () => {
          if (canOpenChannelBridge) onToggleChannelBridgeRoute()
        },
      },
      {
        id: 'open-ide-bridge',
        label: 'Open IDE bridge',
        description: canOpenIdeBridge ? 'Host a Claude Code IDE endpoint a `claude` CLI session connects to' : 'Select a Claude session first',
        icon: <Plug size={16} />,
        shortcut: 'IDE',
        group: 'actions',
        keywords: ['ide', 'bridge', 'mcp', 'websocket', 'claude', 'editor', 'diff', 'mention', 'vscode', 'neovim', 'lock', 'composer'],
        score: 0,
        run: () => {
          if (canOpenIdeBridge) onOpenIdeBridge()
        },
      },
      {
        id: 'toggle-ide-bridge-route',
        label: ideBridgeRouting ? 'Stop routing composer to IDE bridge' : 'Route composer to IDE bridge',
        description: canOpenIdeBridge
          ? (ideBridgeRouting
            ? 'Composer lines push as @mentions to the connected `claude` session — switch back to the active provider'
            : 'Push composer lines as @file mentions into the connected `claude` session instead of the active provider')
          : 'Select a Claude session first',
        icon: <Plug size={16} />,
        shortcut: ideBridgeRouting ? 'IDE on' : 'IDE',
        group: 'actions',
        keywords: ['ide', 'bridge', 'route', 'routing', 'mcp', 'claude', 'mention', 'composer', 'send', 'toggle'],
        score: 0,
        run: () => {
          if (canOpenIdeBridge) onToggleIdeBridgeRoute()
        },
      },
      {
        id: 'open-bookmarks',
        label: 'View all bookmarks',
        description: 'Browse every bookmarked message across all sessions and providers',
        icon: <Bookmark size={16} />,
        shortcut: 'Bookmarks',
        group: 'actions',
        keywords: ['bookmark', 'bookmarks', 'saved', 'star', 'starred', 'favorite', 'favourites', 'pin'],
        score: 0,
        run: onOpenBookmarks,
      },
      {
        id: 'open-provenance',
        label: 'Code provenance — agent blame',
        description: 'See which sessions wrote a file, or what code traces back to the current session',
        icon: <FileSearch size={16} />,
        shortcut: 'Blame',
        group: 'actions',
        keywords: ['provenance', 'blame', 'who wrote', 'origin', 'trace', 'code', 'file', 'history', 'agent blame'],
        score: 0,
        run: onOpenProvenance,
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

    if (!canOpenChannelBridge) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.id === 'open-channel-bridge' || items[index]?.id === 'toggle-channel-bridge-route') {
          items.splice(index, 1)
        }
      }
    }

    if (!canOpenIdeBridge) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.id === 'open-ide-bridge' || items[index]?.id === 'toggle-ide-bridge-route') {
          items.splice(index, 1)
        }
      }
    }

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
  }, [canOpenFiles, canOpenGit, canOpenTasks, canOpenPromptLibrary, canOpenChannelBridge, channelBridgeRouting, canOpenIdeBridge, ideBridgeRouting, includeWorktrees, indexRebuild.message, indexRebuild.status, messagePaneCollapsed, onChangeProvider, onChangeScope, onOpenFiles, onOpenGit, onOpenPullRequests, onOpenCoordinator, onOpenTasks, onOpenPromptLibrary, onOpenChannelBridge, onToggleChannelBridgeRoute, onOpenIdeBridge, onToggleIdeBridgeRoute, onOpenBookmarks, onOpenProvenance, onToggleMessagePane, onToggleWorktrees, provider, rebuildSearchIndex, scopeMode, scopeProjectName, sidebarAction, toggleSidebar])

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

  const indexedMessageItems = useMemo((): IndexedMessageItem[] => {
    if (normalizedQuery.length < 2) return []
    const highlightTerms = highlightTermsForQuery(deferredQuery)
    return indexedResults
      .filter((result) => result.matches.length > 0)
      .flatMap((result) => {
        const session = sessionFromPersistedRecord(result.session)
        const project = result.session.cwd ? pathBasename(result.session.cwd) || result.session.cwd : 'No project'
        return result.matches.map((match, matchIndex) => {
          const matchTime = formatMessageMatchTime(match.timestampMs)
          const metaParts = [messageTypeLabel(match.type), project, matchTime]
            .filter((part): part is string => Boolean(part))
          const meta = metaParts.join(' · ')
          return {
            id: `message:${result.session.key}:${match.messageKey}`,
            label: result.session.title,
            description: match.snippet,
            icon: <Search size={16} />,
            shortcut: result.matches.length > 1 ? `${result.matches.length}` : undefined,
            active: sessionTabKey(session) === sessionTabKey(selectedSession ?? { sessionId: '', provider: 'claude' }),
            group: 'messages' as const,
            keywords: [result.session.title, result.session.cwd ?? '', project, meta, match.snippet],
            score: match.score + result.score / 1000 - matchIndex / 100,
            provider: result.session.provider,
            meta,
            matchCount: result.matches.length,
            snippetParts: highlightedSnippetParts(match.snippet, highlightTerms),
            timestampMs: match.timestampMs,
            run: () => onSelectSession(session, match.uuid),
          }
        })
      })
      .sort((a, b) => b.score - a.score || (b.timestampMs ?? 0) - (a.timestampMs ?? 0) || a.label.localeCompare(b.label))
      .slice(0, MESSAGE_SEARCH_RESULT_LIMIT)
  }, [deferredQuery, indexedResults, normalizedQuery.length, onSelectSession, selectedSession])

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
    const item = itemRefs.current?.get(id)
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
    void item.run()
    if (item.closeOnRun !== false) onOpenChange(false)
  }

  function captureItemRef(id: string) {
    return (node: HTMLButtonElement | null) => {
      if (node) itemRefs.current?.set(id, node)
      else itemRefs.current?.delete(id)
    }
  }

  function activateFromPointer(id: string, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.type === 'pointerenter' && Date.now() - lastKeyboardMoveAtRef.current < 250) return
    activeIdRef.current = id
    setActiveId((current) => current === id ? current : id)
  }

  const hasResults = visibleItems.length > 0
  const showIndexedLoading = indexedLoading && normalizedQuery.length >= 2 && indexedMessageItems.length === 0

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
          placeholder="Search messages, sessions, projects, commands, or providers..."
        />
        <CommandList ref={listRef}>
          {!hasResults && normalizedQuery && !showIndexedLoading ? (
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

          {showIndexedLoading && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Messages">
                <div className="px-3 py-3 font-mono text-[11px] tracking-[0.04em] text-[var(--text-3)]">
                  Searching indexed messages...
                </div>
              </CommandGroup>
            </>
          )}

          {indexedMessageItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Messages">
                {indexedMessageItems.map((item) => {
                  const style = providerStyle(item.provider)
                  return (
                    <CommandItem
                      ref={captureItemRef(item.id)}
                      key={item.id}
                      active={item.id === activeId}
                      onPointerEnter={(event) => activateFromPointer(item.id, event)}
                      onPointerMove={(event) => activateFromPointer(item.id, event)}
                      onClick={() => runItem(item)}
                      title={`${item.label} · ${item.meta}\n${item.description}`}
                    >
                      <span
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold uppercase tracking-[-0.02em]"
                        style={{ color: style.color, background: style.background, borderColor: style.border }}
                        title={item.provider}
                      >
                        {providerIconLabel(item.provider)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium text-[13px] text-[var(--text)]">{item.label}</span>
                          <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-3)]">
                            {item.meta}
                          </span>
                        </span>
                        <span
                          className="mt-0.5 block font-mono text-[11px] leading-[1.45] text-[var(--text-3)]"
                          style={{
                            display: '-webkit-box',
                            overflow: 'hidden',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                          }}
                        >
                          {item.snippetParts.map((part, index) => part.highlight ? (
                            <mark
                              key={`${item.id}:hit:${index}`}
                              className="rounded-[3px] px-0.5 text-[var(--text)]"
                              style={{ background: 'color-mix(in_srgb,var(--cyan)_24%,transparent)' }}
                            >
                              {part.text}
                            </mark>
                          ) : (
                            <span key={`${item.id}:text:${index}`}>{part.text}</span>
                          ))}
                        </span>
                      </span>
                      <PaletteMetaChip title={`${item.matchCount} matches in this session`}>{item.matchCount}</PaletteMetaChip>
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

import type { PersistedSearchResult } from '@/lib/sessionPersistence'
import type { AgentProvider, ProviderInstanceSummary, ProviderSelection, Session } from '@/lib/types'
import { type RightPanelSurfaceKind } from '@/lib/rightPanel'

export type ProjectSelection = {
  key: string
  dir: string
  sessions: Session[]
}

export type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: Session[]
  selectedSession: Session | null
  selectedProject: ProjectSelection | null
  provider: ProviderSelection
  providerInstanceId: string
  providerInstances: ProviderInstanceSummary[]
  scopeMode: 'all' | 'project'
  scopeProjectName: string | null
  includeWorktrees: boolean
  messagePaneCollapsed: boolean
  messageViewMaximized: boolean
  messageViewFullscreen: boolean
  canMaximizeMessageView: boolean
  canOpenGit: boolean
  canOpenTasks: boolean
  canOpenPromptLibrary: boolean
  canOpenChannelBridge: boolean
  channelBridgeRouting: boolean
  canOpenIdeBridge: boolean
  ideBridgeRouting: boolean
  onSelectSession: (session: Session, targetMessageId?: string) => void
  onSelectProject: (projectDir: string, projectName: string, sessions: Session[]) => void
  onChangeProvider: (provider: ProviderSelection, providerInstanceId?: string) => void
  onChangeScope: (mode: 'all' | 'project') => void
  onToggleWorktrees: (include: boolean) => void
  onToggleMessagePane: () => void
  rightPanelOpen: boolean
  rightPanelAvailability: Readonly<Record<RightPanelSurfaceKind, boolean>>
  onToggleRightPanel: () => void
  onOpenRightPanelSurface: (kind: RightPanelSurfaceKind) => void
  onToggleMessageViewMaximized: () => void
  onEnterMessageViewFullscreen: () => void
  onOpenCrossSessionMessaging: () => void
  onOpenTasks: () => void
  onOpenPromptLibrary: () => void
  onOpenChannelBridge: () => void
  onToggleChannelBridgeRoute: () => void
  onOpenIdeBridge: () => void
  onToggleIdeBridgeRoute: () => void
  onOpenBookmarks: () => void
  onOpenProvenance: () => void
  onOpenRemoteAccess: () => void
  onOpenPlugins: () => void
}

export type PaletteItem = {
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

export type IndexedSearchResponse = {
  query: string
  total: number
  results: PersistedSearchResult[]
}

export type IndexRebuildResponse = {
  sessions: number
  messages: number
  errors: Array<{ provider: AgentProvider; sessionId?: string; message: string }>
}

export type IndexRebuildState = {
  status: 'idle' | 'running' | 'done' | 'error'
  message?: string
}

export type HighlightPart = {
  text: string
  highlight: boolean
}

export type IndexedMessageItem = PaletteItem & {
  provider: AgentProvider
  meta: string
  matchCount: number
  snippetParts: HighlightPart[]
  timestampMs: number | null
}

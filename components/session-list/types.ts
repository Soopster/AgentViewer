import type { ProviderInstanceSummary, ProviderSelection, Session } from '@/lib/types'

export type SessionTeamAttention = { waiting: number; finished: number }

export type SessionListProps = {
  sessions: Session[]
  loading: boolean
  error: string | null
  provider: ProviderSelection
  providerInstanceId: string
  providerInstances: ProviderInstanceSummary[]
  switchingProvider: boolean
  selectedId: string | null
  selectedProject: string | null
  dashboardSelected?: boolean
  agentOperationsSelected?: boolean
  messagingSelected?: boolean
  /** Teammate attention per `provider:sessionId`, from /api/agent-protocol/attention. */
  teamAttention?: Record<string, SessionTeamAttention>
  scrollToSessionRequest?: { sessionKey: string; requestId: number } | null
  onSelect: (session: Session) => void
  onSelectProject: (projectDir: string, projectName: string, sessions: Session[]) => void
  onOpenDashboard: () => void
  onRename: (sessionId: string, title: string) => void
  onTag: (sessionId: string, tag: string | null) => void
  onChangeProvider: (provider: ProviderSelection, providerInstanceId?: string) => void
  scopeMode: 'all' | 'project'
  scopeProjectName: string | null
  canScopeToProject: boolean
  includeWorktrees: boolean
  onChangeScope: (mode: 'all' | 'project') => void
  onToggleWorktrees: (include: boolean) => void
  onOpenCommandPalette: () => void
  onOpenCoordinator: () => void
  onOpenCrossSessionMessaging: () => void
  canOpenGit: boolean
  onOpenGit: () => void
  onNewSession?: () => void
  creatingSession?: boolean
}

export type CollapsedPanel = 'sessions' | 'provider' | 'search' | 'project' | 'filters' | 'overview'

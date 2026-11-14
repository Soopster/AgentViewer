import type { GitSummary } from '../gitProvider'

/** Read-only shell context; actions stay with the host that owns focus and navigation. */
export type ShellOverviewAction = 'repository' | 'session' | 'attention' | 'commands' | 'new-session'
export type ShellOverviewSnapshot = {
  readonly cwd: string
  readonly sessionKey: string | null
  readonly sessionTitle: string | null
  readonly provider?: string
  readonly activity: string
  readonly running: boolean
  readonly startedAt: number | null
  readonly runningCount: number
  readonly attentionCount: number
}
export type PluginShellOverview = {
  readonly snapshot: ShellOverviewSnapshot
  readonly readGit: (cwd: string) => Promise<GitSummary | null>
  readonly run: (action: ShellOverviewAction) => void
  /** Enabled, available plugin commands. Widgets choose their own shortcuts. */
  readonly commands?: {
    readonly ids: readonly string[]
    readonly run: (id: string) => void
  }
}

import type { PLUGIN_API_VERSION } from './types'

export type PluginSessionActivity = 'needs-input' | 'running' | 'waiting'
export type PluginActivitySnapshot = {
  readonly now: number
  /** Canonical host identities, including configured provider instances. */
  readonly activity: ReadonlyMap<string, PluginSessionActivity>
  readonly sessions: readonly { readonly key: string; readonly title: string; readonly target?: import('./bookmarks').PluginSessionRef }[]
  readonly selectedKey: string | null
  readonly focused: boolean | null
  /** Unanswered asks by session key. Absent when the host cannot read them. */
  /** Teammates waiting on the lead (after this client's reviewed markers), by session key. */
  readonly teams?: ReadonlyMap<string, { readonly waiting: number; readonly finished: number }>
  /** When each running turn began, by session key, where the host knows. */
  readonly started?: ReadonlyMap<string, number>
  /** The selected conversation's project directory, when it has one. */
  readonly cwd?: string | null
  readonly pending?: ReadonlyMap<string, readonly import('../permissions').PendingPermission[]>
}

export type PluginPermissionsService = {
  /** Answers one ask on the session that raised it. Rejects when the ask is gone or the reply fails. */
  readonly respond: (target: import('./bookmarks').PluginSessionRef, permissionId: string, response: import('../permissions').PermissionResponse) => Promise<void>
  /** Answers a question ask. */
  readonly answer: (target: import('./bookmarks').PluginSessionRef, permissionId: string, answers: import('../permissions').PendingQuestionAnswers) => Promise<void>
}

/** Read-only project state for the selected conversation; either read may answer null when unavailable. */
export type PluginRepositoryService = {
  readonly readGit: (cwd: string) => Promise<import('../gitProvider').GitSummary | null>
  readonly readProof: (cwd: string, signal: AbortSignal) => Promise<import('./proof').ProofSnapshot | null>
}

export type PluginApplicationServices = {
  readonly repository?: PluginRepositoryService
  readonly permissions?: PluginPermissionsService
  readonly activity?: Pick<import('./activityFeed').PluginActivityFeed, 'publish' | 'remove' | 'removeSource' | 'replaceSource'>
  readonly notifications?: import('./notifications').PluginNotifications & {
    /** `urgent`: it asks something of the person (input, an approval), so a focus block never holds it. */
    readonly notice: (text: string, options?: PluginDeliveryOptions) => void
    /** The host decides availability. Calling this never asks for permission. */
    readonly desktop: (title: string, body: string, options?: PluginDeliveryOptions) => void
  }
  /** Focus Mode's block, for the plugin that holds interruptions during one. */
  readonly focus?: import('./focusMode').FocusService
  /** The person's own editor (Open in IDE). */
  readonly ide?: import('./openInIde').PluginIdeService
}

export type PluginDeliveryOptions = { readonly urgent?: boolean; readonly target?: import('./bookmarks').PluginSessionRef }

export type PluginApplicationContext = {
  readonly signal: AbortSignal
  readonly services: PluginApplicationServices
  readonly defer: (cleanup: () => void) => () => void
}

export type PluginApplicationModule = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  /** Called per application host. Metadata and module import start no work. */
  readonly activate: (context: PluginApplicationContext) => {
    /** Synchronous observation; own async jobs with signal/defer instead of blocking publication. */
    readonly onSessionActivity: (snapshot: PluginActivitySnapshot) => void
  }
}

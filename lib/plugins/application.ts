import type { PLUGIN_API_VERSION } from './types'

export type PluginSessionActivity = 'needs-input' | 'running' | 'waiting'
export type PluginActivitySnapshot = {
  readonly now: number
  /** Canonical host identities, including configured provider instances. */
  readonly activity: ReadonlyMap<string, PluginSessionActivity>
  readonly sessions: readonly { readonly key: string; readonly title: string; readonly target?: import('./bookmarks').PluginSessionRef }[]
  readonly selectedKey: string | null
  readonly focused: boolean | null
}

export type PluginApplicationServices = {
  readonly activity?: Pick<import('./activityFeed').PluginActivityFeed, 'publish' | 'remove' | 'removeSource'>
  readonly notifications?: import('./notifications').PluginNotifications & {
    readonly notice: (text: string) => void
    /** The host decides availability. Calling this never asks for permission. */
    readonly desktop: (title: string, body: string) => void
  }
}

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

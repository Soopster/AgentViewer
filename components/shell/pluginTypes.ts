import type { ComponentType } from 'react'
import type { AnalyticsInput } from '@/lib/analytics'
import type { PluginPlacement, PluginTarget } from '@/lib/plugins/types'

/** Declared service values, resolved by the host for this view's target. */
export type WebPluginServices = {
  'session-transcript'?: AnalyticsInput
  repository?: {
    readonly cwd: string
    /** Scopes turn lists to one session; null means every turn in the repository. */
    readonly sessionId: string | null
  }
}

/** Everything a Web plugin view receives. Never the page's state or setters. */
export type WebPluginViewProps = {
  readonly pluginId: string
  readonly surfaceId: string
  readonly instanceId: string
  readonly placement: PluginPlacement
  readonly target: PluginTarget
  readonly services: WebPluginServices
  readonly useState: <T>(name: string, initial: T) => [T, (next: T | ((previous: T) => T)) => void]
  readonly onDispose: (cleanup: () => void) => () => void
  readonly close: () => void
}

export type WebPluginView = ComponentType<WebPluginViewProps>

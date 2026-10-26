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
    /** The provider of `sessionId`, which scopes reads made on its behalf. */
    readonly provider?: string | null
  }
  composer?: {
    /** Insert a file path into the composer the user is writing in; absent when no session composer is open. */
    readonly insertPath?: (path: string) => void
    /** Insert text (a question for the agent) into the composer the user is writing in. */
    readonly insertText?: (text: string) => void
  }
  'session-pull-request'?: {
    /** The pull request already linked to the selected session, if any. */
    readonly linkedNumber?: number
    /** Link a pull request to the selected session; absent with no session selected. */
    readonly link?: (pr: { repo: string; number: number; url: string; cwd: string }) => void
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

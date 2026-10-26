import type { ComponentType } from 'react'
import type { AnalyticsInput } from '@/lib/analytics'
import type { ProtocolAgent } from '@/lib/agentProtocol'
import type { ProviderSelection, Session } from '@/lib/types'
import type { PluginPlacement, PluginTarget } from '@/lib/plugins/types'
import type { SendAttachment } from '@/lib/types'

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
    /** Insert a file path into the composer the user is writing in. */
    readonly insertPath: (path: string) => void
    /** Attach a piece of context (a terminal selection, a page) to the message being written. */
    readonly attachContext?: (attachment: SendAttachment) => void
  }
  'browser-location'?: {
    /** Where this browser tab is pointed, kept by the host with the panel layout. */
    readonly url: string | null
    readonly navigate: (url: string) => void
  }
  /** Coordinator runs and a conversation's team, as the page and the session view host them. */
  coordination?: {
    readonly provider: ProviderSelection
    /** The conversation in view: the control center's context, the teammates panel's lead. */
    readonly selectedSession: Session | null
    readonly openSession: (session: Session) => void
    readonly sessionsChanged?: () => void
    /** The teammates panel: read a teammate's transcript beside the lead's. */
    readonly inspectTeammate?: (agent: ProtocolAgent) => void
    readonly returnToChat?: () => void
    /** How many things the team needs from the user, for the host's tab badge. */
    readonly attentionChanged?: (count: number) => void
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

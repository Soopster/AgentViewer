import type { MessageBookmark } from '../messageBookmarks'
import type { AgentProvider } from '../types'

/** Every saved bookmark, across sessions and providers, and unsaving one. */
export type PluginBookmarksService = {
  readonly list: (signal?: AbortSignal) => Promise<MessageBookmark[]>
  readonly remove: (bookmark: MessageBookmark) => Promise<void>
}

/** A session a plugin asks the host to show; the host owns selection and its provider switch. */
export type PluginSessionRef = {
  readonly provider: AgentProvider
  readonly sessionId: string
  readonly providerInstanceId?: string
}

/** Open a session in the reader, landing on a message once it has loaded when one is named. */
export type PluginSessionNavigation = {
  readonly open: (session: PluginSessionRef, messageUuid?: string) => void
}

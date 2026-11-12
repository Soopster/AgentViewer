import type { ThreadedMessage } from '../threading'
import type { SessionIdentity } from '../sessionIdentity'
import type { PLUGIN_API_VERSION } from './types'

export type PluginCommandTarget = {
  readonly session: Readonly<SessionIdentity> | null
  readonly cwd: string | null
}
export type PluginCommandServices = {
  readonly 'bridge-routing'?: import('./bridges').BridgeRoutingCommands
  readonly 'composer-accessories'?: { readonly open: (id: string) => void }
  /** The host binds this read to the captured source session. */
  readonly transcript?: { readonly read: (signal: AbortSignal) => Promise<readonly ThreadedMessage[]> }
  /** The writing destination is captured too; switching composers cancels the action. */
  readonly composer?: {
    readonly replaceText: (text: string) => void
    readonly insertText: (text: string) => void
  }
  readonly notices?: { readonly show: (kind: 'info' | 'error', text: string) => void }
}
export type PluginCommandContext = {
  readonly target: PluginCommandTarget
  readonly signal: AbortSignal
  readonly services: PluginCommandServices
  readonly defer: (cleanup: () => void) => () => void
}
export type PluginCommandModule = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly handlers: Readonly<Record<string, (context: PluginCommandContext) => void | Promise<void>>>
}

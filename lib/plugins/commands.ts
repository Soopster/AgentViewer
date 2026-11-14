import type { ThreadedMessage } from '../threading'
import type { SessionIdentity } from '../sessionIdentity'
import type { PLUGIN_API_VERSION } from './types'

/** Immutable text captured when a composer slash command is submitted. */
export type PluginCommandInput = {
  readonly slash: { readonly name: string; readonly arguments: string; readonly draft: string }
}

export type PluginCommandTarget = {
  readonly session: Readonly<SessionIdentity> | null
  readonly cwd: string | null
}
export type PluginCommandServices = {
  readonly notifications?: import('./notifications').PluginNotifications
  readonly 'bridge-routing'?: import('./bridges').BridgeRoutingCommands
  readonly 'composer-accessories'?: { readonly open: (id: string, input?: PluginCommandInput) => void }
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
  readonly input?: PluginCommandInput
  readonly signal: AbortSignal
  readonly services: PluginCommandServices
  readonly defer: (cleanup: () => void) => () => void
}
export type PluginCommandModule = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly handlers: Readonly<Record<string, (context: PluginCommandContext) => void | Promise<void>>>
}

export function decodePluginCommandInput(value: unknown): PluginCommandInput | undefined {
  const slash = (value && typeof value === 'object' ? value as { slash?: unknown } : {}).slash
  if (!slash || typeof slash !== 'object') return undefined
  const raw = slash as Record<string, unknown>
  return typeof raw.name === 'string' && /^[a-z][a-z0-9-]*$/.test(raw.name) && typeof raw.arguments === 'string' && raw.arguments.length <= 80_000 && typeof raw.draft === 'string' && raw.draft.length <= 80_000
    ? Object.freeze({ slash: Object.freeze({ name: raw.name, arguments: raw.arguments, draft: raw.draft }) }) : undefined
}

import type { ChannelBridgeStatus, ChannelDeliveryState, ChannelPermissionRequestEvent } from '../channelBridge'
import type { IdeBridgeStatus, IdeOpenDiffEvent } from '../ideBridge'

export type BridgeAccent = { readonly cssVar: string; readonly cssRgb: string; readonly label: string }
export type ChannelBridgeLogEntry =
  | { kind: 'sent'; id: string; text: string; chatId: string; messageId: string; delivery: ChannelDeliveryState }
  | { kind: 'reply'; id: string; text: string; chatId: string }
  | { kind: 'permission'; id: string; request: ChannelPermissionRequestEvent; resolved?: 'allow' | 'deny' }
export type IdeBridgeLogEntry =
  | { kind: 'mention'; id: string; filePath: string; lineStart?: number; lineEnd?: number }
  | { kind: 'tool'; id: string; name: string; arguments: Record<string, unknown> }
  | { kind: 'diff'; id: string; request: IdeOpenDiffEvent; resolved?: 'accept' | 'reject' }
  | { kind: 'lifecycle'; id: string; event: 'connected' | 'disconnected' | 'initialized' }

type BridgeViewConnection = {
  readonly baseUrl: string
  readonly token: string
  readonly setBaseUrl: (value: string) => void
  readonly setToken: (value: string) => void
  readonly sending: boolean
  readonly sendError: string | null
  readonly setSendError: (value: string | null) => void
  readonly routeComposer: boolean
  readonly setRouteComposer: (value: boolean) => void
  readonly unread: number
  readonly accent: BridgeAccent
  /** Retain presentation interest only; releasing never changes composer routing. Keep this function stable across snapshots. */
  readonly acquireView: () => () => void
}
export type ChannelBridgeViewService = BridgeViewConnection & {
  readonly status: ChannelBridgeStatus
  readonly entries: readonly ChannelBridgeLogEntry[]
  readonly send: (text: string) => Promise<{ chat_id: string; message_id: string; queued: boolean }>
  readonly respond: (entry: Extract<ChannelBridgeLogEntry, { kind: 'permission' }>, behavior: 'allow' | 'deny') => Promise<void>
}
export type IdeBridgeViewService = BridgeViewConnection & {
  readonly status: IdeBridgeStatus
  readonly claudeConnected: boolean
  readonly entries: readonly IdeBridgeLogEntry[]
  readonly send: (text: string) => Promise<{ delivered: boolean }>
  readonly respondDiff: (entry: Extract<IdeBridgeLogEntry, { kind: 'diff' }>, behavior: 'accept' | 'reject') => Promise<void>
}
export type BridgeRoutingCommands = {
  readonly channel?: { readonly toggle: () => void }
  readonly ide?: { readonly toggle: () => void }
}

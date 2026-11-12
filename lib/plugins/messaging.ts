import type { AddressableSession, SendCrossSessionMessageParams, SendCrossSessionMessageResult } from '../crossSessionMessagingTypes'

/** Transport capability; feature views decide when to discover and deliver. */
export type PluginMessagingService = {
  readonly list: (exclude?: string, signal?: AbortSignal) => Promise<AddressableSession[]>
  readonly send: (params: SendCrossSessionMessageParams, signal?: AbortSignal) => Promise<SendCrossSessionMessageResult>
}

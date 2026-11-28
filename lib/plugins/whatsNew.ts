import type { WhatsNew } from '../whatsNew'

/** Reads the repository's highlights revision by revision. `cwd` is honoured only by hosts that read in process. */
export type PluginWhatsNewService = {
  readonly read: (options?: { cwd?: string; limit?: number }, signal?: AbortSignal) => Promise<WhatsNew>
}

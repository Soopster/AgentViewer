import { manifest } from './manifest'
import type { ProviderExtension } from '../types'

export const extension = {
  manifest,
  loadAdapter: async () => (await import('../../../adapters/acp')).codexAcpAdapter,
  loadRuntime: async () => (await import('../transports/acpRuntime')).createAcpRuntime('codex-acp'),
} satisfies ProviderExtension

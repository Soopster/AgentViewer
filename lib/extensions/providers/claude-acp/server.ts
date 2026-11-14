import { manifest } from './manifest'
import type { ProviderExtension } from '../types'

export const extension = {
  manifest,
  loadAdapter: async () => (await import('../../../adapters/acp')).claudeAcpAdapter,
  loadRuntime: async () => (await import('../transports/acpRuntime')).createAcpRuntime('claude-acp'),
} satisfies ProviderExtension

import { manifest } from './manifest'
import type { ProviderExtension } from '../types'

export const extension = {
  manifest,
  loadAdapter: async () => (await import('../../../adapters/acp')).customAcpAdapter,
  loadRuntime: async () => (await import('../transports/acpRuntime')).createAcpRuntime('acp'),
} satisfies ProviderExtension

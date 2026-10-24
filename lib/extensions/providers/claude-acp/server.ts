import { manifest } from './manifest'
import type { ProviderExtension } from '../types'

export const extension = {
  manifest,
  loadAdapter: async () => (await import('../../../adapters/acp')).claudeAcpAdapter,
  // Compatibility bridge; never loaded by a transcript reader.
  loadRuntime: async () => (await import('../builtinRuntime')).builtinRuntime,
} satisfies ProviderExtension

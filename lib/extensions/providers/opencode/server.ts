import { manifest } from './manifest'
import type { ProviderExtension } from '../types'

export const extension = {
  manifest,
  loadAdapter: async () => (await import('../../../adapters/opencode')).opencodeAdapter,
  loadRuntime: async () => (await import('./runtime')).runtime,
} satisfies ProviderExtension

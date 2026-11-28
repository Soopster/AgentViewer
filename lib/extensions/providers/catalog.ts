import { manifest as provider_mod } from './mod/manifest'
// Browser-safe metadata only. Never import runtime entries or SDKs here.
import { manifest as claude } from './claude/manifest'
import { manifest as codex } from './codex/manifest'
import { manifest as opencode } from './opencode/manifest'
import { manifest as copilot } from './copilot/manifest'
import { manifest as pi } from './pi/manifest'
import { manifest as lmstudio } from './lmstudio/manifest'
import { manifest as claude_acp } from './claude-acp/manifest'
import { manifest as codex_acp } from './codex-acp/manifest'
import { manifest as custom_acp } from './acp/manifest'

export const PROVIDER_EXTENSIONS = {
  'mod': provider_mod,
  'claude': claude,
  'codex': codex,
  'opencode': opencode,
  'copilot': copilot,
  'pi': pi,
  'lmstudio': lmstudio,
  'claude-acp': claude_acp,
  'codex-acp': codex_acp,
  'acp': custom_acp,
} as const

export type RegisteredProvider = keyof typeof PROVIDER_EXTENSIONS
export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_EXTENSIONS) as RegisteredProvider[])

export function getProviderManifest(provider: RegisteredProvider): ProviderManifest {
  const manifest = Object.hasOwn(PROVIDER_EXTENSIONS, provider) ? PROVIDER_EXTENSIONS[provider] : undefined
  if (!manifest) throw new Error(`Unknown provider extension: ${provider}`)
  return manifest
}

import type { ProviderManifest } from './types'

/** Providers that can be staffed as Coordinator teammates, from their manifests. */
export const COORDINATOR_PROVIDER_IDS = Object.freeze(PROVIDER_IDS.filter(id => (getProviderManifest(id) as ProviderManifest).coordinatorTeammate === true))
export function isCoordinatorProvider(provider: unknown): boolean {
  return typeof provider === 'string' && (COORDINATOR_PROVIDER_IDS as readonly string[]).includes(provider)
}

/** The provider a session recorded before sessions stored one belongs to; the only place that assumption lives. */
export const LEGACY_SESSION_PROVIDER: RegisteredProvider = 'claude'

export const NEW_SESSION_PROVIDER_IDS = Object.freeze(PROVIDER_IDS.filter(id => getProviderManifest(id).newSession))
export const INDEXABLE_PROVIDER_IDS = Object.freeze(PROVIDER_IDS.filter(id => getProviderManifest(id).indexable))
export const PROVIDER_CHOICES = Object.freeze(PROVIDER_IDS.map(value => Object.freeze({ value, label: getProviderManifest(value).displayName })))

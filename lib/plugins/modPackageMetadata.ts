// Browser-safe package identity. Legacy loose mods may omit package metadata.
import { PLUGIN_API_VERSION } from './types'
export type ModPackageMetadata = {
  readonly version?: string
  readonly hostApi?: { readonly min: number; readonly max?: number }
}
export function parseModPackageMetadata(raw: Record<string, unknown>, options: { requireVersion?: boolean; hostApiVersion?: number } = {}): ModPackageMetadata {
  const version = raw.version
  if (version !== undefined) {
    const match = typeof version === 'string' && version.length <= 100 ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version) : null
    if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) throw new Error('version must be a semantic version such as 1.0.0')
  }
  if (options.requireVersion && version === undefined) throw new Error('Managed packages require a version in plugin.json')
  let hostApi: ModPackageMetadata['hostApi']
  if (raw.hostApi !== undefined) {
    if (!raw.hostApi || typeof raw.hostApi !== 'object' || Array.isArray(raw.hostApi)) throw new Error('hostApi must be an object with min and optional max API versions')
    const value = raw.hostApi as { min?: unknown; max?: unknown }
    if (typeof value.min !== 'number' || !Number.isSafeInteger(value.min) || value.min < 1 || (value.max !== undefined && (typeof value.max !== 'number' || !Number.isSafeInteger(value.max) || value.max < value.min))) throw new Error('hostApi requires positive integer min and optional max >= min')
    const current = options.hostApiVersion ?? PLUGIN_API_VERSION
    if (current < value.min || (typeof value.max === 'number' && current > value.max)) throw new Error(`Mod requires host API ${value.min}..${value.max ?? 'latest'}; this host provides ${current}`)
    hostApi = { min: value.min, ...(typeof value.max === 'number' ? { max: value.max } : {}) }
  }
  return { ...(typeof version === 'string' ? { version } : {}), ...(hostApi ? { hostApi } : {}) }
}

import { getSessionAdapter } from './adapters/registry'
import { withProviderInstance, listProviderInstanceSummaries } from './providerInstances'
import { PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS } from './providerWarmup'
import { withTimeout } from './withTimeout'
import type { AgentProvider, ProviderInstanceSummary, SessionModelInfo } from './types'

export type CoordinatorCapabilities = {
  provider: AgentProvider
  providerInstanceId: string
  instances?: ProviderInstanceSummary[]
  status: 'available' | 'unavailable' | 'unsupported'
  models: SessionModelInfo[]
  checkedAt: string
  error?: string
}

// Only coalesce concurrent reads. A retry rechecks the live catalog rather than
// treating an earlier unavailable result as permanent. No credentials escape.
const pending = new Map<string, Promise<CoordinatorCapabilities>>()
export function readCoordinatorCapabilities(provider: AgentProvider, cwd?: string, providerInstanceId = provider as string): Promise<CoordinatorCapabilities> {
  const key = JSON.stringify([provider, providerInstanceId, cwd])
  const existing = pending.get(key)
  if (existing) return existing
  const read = withProviderInstance(providerInstanceId, provider, async (): Promise<CoordinatorCapabilities> => {
    const instances = await readCoordinatorProviderInstances()
    const adapter = await getSessionAdapter(provider)
    if (!adapter.readProviderModels) return { provider, providerInstanceId, instances, status: 'unsupported', models: [], checkedAt: new Date().toISOString() }
    const models = await withTimeout(adapter.readProviderModels(cwd), PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS, `${provider} coordinator model discovery`)
    return { provider, providerInstanceId, instances, status: models.length ? 'available' : 'unavailable', models, checkedAt: new Date().toISOString(), ...(!models.length ? { error: 'Provider returned no advertised models. Refresh after checking provider configuration.' } : {}) }
  }).catch((): CoordinatorCapabilities => ({ provider, providerInstanceId, status: 'unavailable', models: [], checkedAt: new Date().toISOString(), error: 'Provider catalog is unavailable. Check provider configuration and refresh.' }))
    .finally(() => { if (pending.get(key) === read) pending.delete(key) })
  pending.set(key, read)
  return read
}

export async function validateCoordinatorSelection(provider: AgentProvider, cwd: string, model?: string, effort?: string, providerInstanceId?: string): Promise<void> {
  if (!model && !effort) return
  const catalog = await readCoordinatorCapabilities(provider, cwd, providerInstanceId)
  // Some providers lack a read-only catalog (Pi/ACP). Their own dispatcher
  // remains authoritative; opening an agent session merely to discover models
  // would make capability discovery a mutation.
  if (catalog.status === 'unsupported') return
  if (catalog.status !== 'available') throw new Error(catalog.error)
  const selected = model ? catalog.models.find(entry => entry.value === model) : undefined
  if (model && !selected) throw new Error(`Model ${model} is not advertised by ${provider}. Refresh the Coordinator model catalog.`)
  if (!effort) return
  const candidates = selected ? [selected] : catalog.models
  if (candidates.every(entry => entry.supportsEffort === false || (entry.supportedEffortLevels && !entry.supportedEffortLevels.some(level => level === effort)))) {
    throw new Error(`Effort ${effort} is not advertised for ${model ?? provider}. Refresh the Coordinator model catalog.`)
  }
}

/** Public configuration metadata only; never include environment or executable. */
export async function readCoordinatorProviderInstances() {
  return (await listProviderInstanceSummaries()).filter(instance => ['claude', 'codex', 'opencode', 'copilot', 'pi'].includes(instance.provider))
}

import type { ConfigProvidersResponse, Model as V1Model } from '@opencode-ai/sdk'
import type { ModelInfo, ProviderInfo } from '@opencode/client'
import type { SessionModelInfo } from './types'

export type OpenCodeModelRef = { providerID: string; modelID: string; variant?: string }
export type OpenCode2ModelMetadata = Pick<ModelInfo, 'limit' | 'capabilities' | 'status' | 'family' | 'cost'> & { variants: string[] }
export type OpenCodeModelConfig = ConfigProvidersResponse & { openCode2DefaultModel?: OpenCodeModelRef }
type CompatibleModel = V1Model & { openCode2?: OpenCode2ModelMetadata }

export function encodeOpenCodeModelValue(model: OpenCodeModelRef): string {
  return JSON.stringify({ providerID: model.providerID, modelID: model.modelID, ...(model.variant ? { variant: model.variant } : {}) })
}

export function decodeOpenCodeModelValue(value: string | null | undefined): OpenCodeModelRef | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const model = parsed as Partial<OpenCodeModelRef>
    if (typeof model.providerID !== 'string' || !model.providerID || typeof model.modelID !== 'string' || !model.modelID) return null
    if (model.variant !== undefined && (typeof model.variant !== 'string' || !model.variant)) return null
    return { providerID: model.providerID, modelID: model.modelID, ...(model.variant ? { variant: model.variant } : {}) }
  } catch { return null }
}

/** Only public catalogue metadata crosses this compatibility boundary. Never
 * expose provider credentials, request headers, or variant request bodies. */
export function openCode2ModelConfig(providers: ProviderInfo[], models: ModelInfo[], defaultModel: ModelInfo | null): OpenCodeModelConfig {
  const enabledProviders = providers.filter(provider => provider.activation !== 'disabled')
  const byProvider = new Map<string, Record<string, CompatibleModel>>()
  for (const model of models) {
    if (model.enabled === false) continue
    const entries = byProvider.get(model.providerID) ?? Object.create(null) as Record<string, CompatibleModel>
    entries[model.id] = {
      id: model.id, providerID: model.providerID, name: model.name ?? model.id,
      // v2 has no boolean reasoning capability. Variants are the native choices.
      capabilities: { reasoning: false },
      openCode2: { limit: model.limit, capabilities: model.capabilities, status: model.status,
        family: model.family, cost: model.cost, variants: [...new Set((model.variants ?? []).map(variant => variant.id))] },
    } as CompatibleModel
    byProvider.set(model.providerID, entries)
  }
  const config = {
    providers: enabledProviders.map(provider => ({ id: provider.id, name: provider.name ?? provider.id, models: byProvider.get(provider.id) ?? {} })),
    default: defaultModel ? { [defaultModel.providerID]: defaultModel.id } : {},
  } as OpenCodeModelConfig
  if (defaultModel && config.providers.some(provider => provider.id === defaultModel.providerID && Object.hasOwn(provider.models, defaultModel.id))) {
    config.openCode2DefaultModel = { providerID: defaultModel.providerID, modelID: defaultModel.id }
  }
  return config
}

export function mapOpenCodeModelsToSessionModels(config: OpenCodeModelConfig): SessionModelInfo[] {
  const models: SessionModelInfo[] = []
  for (const provider of config.providers) {
    for (const raw of Object.values(provider.models)) {
      const model = raw as CompatibleModel
      const metadata = model.openCode2
      const description = [`${provider.id}/${model.id}`,
        metadata?.limit?.context ? `${metadata.limit.context.toLocaleString('en-US')} context tokens` : '',
        metadata?.capabilities?.input?.includes('image') ? 'image input' : '',
        metadata?.capabilities?.tools === false ? 'no tools' : '',
        metadata?.status && metadata.status !== 'active' ? metadata.status : '',
        metadata?.cost?.[0] ? `$${metadata.cost[0].input}/$${metadata.cost[0].output} per 1M input/output tokens` : '',
      ].filter(Boolean).join(' · ')
      // Arbitrary custom variants belong in the model picker, not the shared
      // reasoning-effort enum (which cannot represent names such as "review").
      for (const variant of [undefined, ...(metadata?.variants ?? [])]) {
        models.push({
          value: encodeOpenCodeModelValue({ providerID: provider.id, modelID: model.id, ...(variant ? { variant } : {}) }),
          displayName: `${provider.name} · ${model.name}${variant ? ` · ${variant}` : ''}`,
          description,
          supportsEffort: metadata ? false : Boolean(model.capabilities.reasoning),
          ...(metadata ? { contextWindowTokens: metadata.limit?.context, maxInputTokens: metadata.limit?.input,
            maxOutputTokens: metadata.limit?.output, inputModalities: metadata.capabilities?.input,
            outputModalities: metadata.capabilities?.output, supportsTools: metadata.capabilities?.tools,
            modelStatus: metadata.status,
            pricing: metadata.cost?.map(tier => ({ input: tier.input, output: tier.output, cacheRead: tier.cache?.read, cacheWrite: tier.cache?.write, ...(tier.tier ? { contextAboveTokens: tier.tier.size } : {}) })) } : {}),
        })
      }
    }
  }
  const defaultValue = config.openCode2DefaultModel ? encodeOpenCodeModelValue(config.openCode2DefaultModel) : null
  if (defaultValue) {
    const index = models.findIndex(model => model.value === defaultValue)
    if (index > 0) models.unshift(...models.splice(index, 1))
  }
  return models
}

/** OpenCode 2 records the current choice on the session even before a model
 * has answered; relying on the last assistant would restore the old choice. */
export function selectedOpenCodeSessionModel(session: unknown): string | null {
  const model = (session as { openCode2Model?: OpenCodeModelRef } | null)?.openCode2Model
  if (!model) return null
  const value = encodeOpenCodeModelValue(model)
  return decodeOpenCodeModelValue(value) ? value : null
}

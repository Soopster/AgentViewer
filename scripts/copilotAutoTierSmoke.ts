import assert from 'node:assert/strict'
import { copilotIntegrationDiagnostics, copilotSessionConfigOverrides } from '../lib/copilotClient'
import { mapCopilotModelsToSessionModels, mapCopilotUsageToContextUsage } from '../lib/copilotMapper'
import type { Model, SessionEvent } from '@microsoft/copilot-sdk'

const previous = process.env.COPILOT_AUTO_TIER
try {
  for (const tier of ['efficiency', 'balance', 'intelligence', 'fast'] as const) {
    process.env.COPILOT_AUTO_TIER = tier
    assert.equal(copilotSessionConfigOverrides().github?.capi?.autoTier, tier)
    assert.equal(copilotSessionConfigOverrides().model, 'auto')
    assert.ok(copilotIntegrationDiagnostics().includes(`Auto model routing tier: ${tier}`))
  }
  process.env.COPILOT_AUTO_TIER = ' FAST '
  assert.equal(copilotSessionConfigOverrides().github?.capi?.autoTier, 'fast')
  process.env.COPILOT_AUTO_TIER = 'unsupported'
  assert.equal(copilotSessionConfigOverrides().github?.capi, undefined)
  assert.equal(copilotSessionConfigOverrides().model, undefined)
  assert.ok(!copilotIntegrationDiagnostics().some((item) => item.startsWith('Auto model routing tier:')))
  delete process.env.COPILOT_AUTO_TIER
  assert.equal(copilotSessionConfigOverrides().github?.capi, undefined)
  assert.equal(copilotSessionConfigOverrides().model, undefined)
} finally {
  if (previous === undefined) delete process.env.COPILOT_AUTO_TIER
  else process.env.COPILOT_AUTO_TIER = previous
}

const catalog: Model[] = [
  {
    id: 'priced-model',
    name: 'Priced model',
    capabilities: { limits: { max_context_window_tokens: 128_000, max_output_tokens: 8_000 } },
    billing: { tokenPrices: { longContext: { maxPromptTokens: 248_000 } } },
  },
  {
    id: 'provider/model',
    name: 'Provider model',
    capabilities: {},
    supportedContextTiers: ['default', 'long_context'],
  },
  { id: 'basic', name: 'Basic', capabilities: {} },
]
const [priced, provider, basic] = mapCopilotModelsToSessionModels(catalog)
assert.equal(priced.supportsLongContext, true)
assert.equal(priced.contextWindowTokens, 128_000)
assert.match(priced.description, /Long .*256/)
assert.equal(provider.supportsLongContext, true)
assert.equal(provider.description, 'Long context available')
assert.equal(basic.supportsLongContext, false)
assert.equal(basic.description, '')
const usage = { type: 'assistant.usage', data: { model: priced.value, inputTokens: 128_000 } } as
  Extract<SessionEvent, { type: 'assistant.usage' }>
const modelsById = new Map(catalog.map(model => [model.id, model]))
assert.equal(mapCopilotUsageToContextUsage(usage, modelsById)?.maxTokens, 128_000)
assert.equal(mapCopilotUsageToContextUsage(usage, modelsById, 'long_context')?.percentage, 50)
const providerUsage = { ...usage, data: { ...usage.data, model: provider.value } }
assert.equal(mapCopilotUsageToContextUsage(providerUsage, modelsById, 'long_context')?.maxTokens, 0)

console.log('Copilot Auto routing and model context tier smoke passed')

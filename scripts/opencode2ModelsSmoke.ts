import assert from 'node:assert/strict'
import type { ConfigProvidersResponse } from '@opencode-ai/sdk'
import type { ModelInfo, ProviderInfo } from '@opencode/client'
import { createOpenCode2Clients } from '../lib/opencode2Client'
import { decodeOpenCodeModelValue, encodeOpenCodeModelValue, mapOpenCodeModelsToSessionModels, openCode2ModelConfig, selectedOpenCodeSessionModel } from '../lib/opencodeModels'
import { currentOpenCodeModelValue, latestOpenCodeModelValue, mapOpenCodeContextUsage } from '../lib/opencodeMapper'
import { toV1MessageBundles, toV1Session, type V2SessionInfo } from '../lib/opencode2Mapping'

const providers = [
  { id: 'custom', name: 'Custom host', activation: 'enabled', package: 'custom-adapter' },
  { id: 'other', name: 'Other host', activation: 'auto', package: 'adapter' },
  { id: 'disabled', name: 'Disabled host', activation: 'disabled', package: 'adapter' },
] satisfies ProviderInfo[]
const model: ModelInfo = {
  id: 'nested/model', modelID: 'upstream-model', providerID: 'custom', name: 'My model',
  variants: [{ id: 'review', headers: { authorization: 'do-not-export' } }, { id: 'fast' }],
  capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
  time: { released: 1 }, cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
  status: 'beta', enabled: true, limit: { context: 200_000, input: 190_000, output: 10_000 },
}
const models = [model, { ...model, providerID: 'other', variants: [] }, { ...model, providerID: 'disabled' }, { ...model, id: 'hidden', enabled: false }]
const config = openCode2ModelConfig(providers, models, model)
const choices = mapOpenCodeModelsToSessionModels(config)
assert.equal(choices.length, 4)
const base = choices[0]!
assert.equal(base.value, '{"providerID":"custom","modelID":"nested/model"}')
assert.match(base.description, /200,000 context tokens.*image input.*beta/)
assert.equal(base.supportsEffort, false, 'custom variants must not be mapped to the generic effort enum')
assert.equal(base.contextWindowTokens, 200_000)
assert.equal(base.supportsTools, true)
assert.deepEqual(base.pricing, [{ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 }])
assert.match(base.description, /\$1\/\$2 per 1M/)
assert.equal(base.maxOutputTokens, 10_000)
assert.deepEqual(base.inputModalities, ['text', 'image'])
assert.doesNotMatch(JSON.stringify(config), /do-not-export|authorization/)
const review = choices.find(choice => choice.displayName.endsWith(' · review'))!
assert.deepEqual(decodeOpenCodeModelValue(review.value), { providerID: 'custom', modelID: 'nested/model', variant: 'review' })
assert.notEqual(choices.at(-1)!.value, base.value, 'same model ID across providers must remain distinct')
for (const invalid of ['null', '[]', '{"providerID":"","modelID":"x"}', '{"providerID":"x","modelID":"y","variant":3}']) assert.equal(decodeOpenCodeModelValue(invalid), null)
const defaultOther = mapOpenCodeModelsToSessionModels(openCode2ModelConfig(providers, models, models[1]!))
assert.equal(decodeOpenCodeModelValue(defaultOther[0]!.value)?.providerID, 'other')
assert.deepEqual(openCode2ModelConfig(providers, models, null).default, {})
const v1 = mapOpenCodeModelsToSessionModels({ providers: [{ id: 'v1', name: 'Legacy', models: { old: { id: 'old', name: 'Old', capabilities: { reasoning: true } } } }], default: {} } as unknown as ConfigProvidersResponse)
assert.equal(v1.length, 1); assert.equal(v1[0]!.supportsEffort, true)

const session: V2SessionInfo = { id: 'session', projectID: 'project', agent: 'build', model: { providerID: 'custom', id: 'nested/model', variant: 'review' }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 2 }, location: { directory: '/project' } }
assert.equal(selectedOpenCodeSessionModel(toV1Session(session)), review.value)
const bundles = toV1MessageBundles([
  { id: 'switch', type: 'model-switched', time: { created: 1 }, model: session.model },
  { id: 'user', type: 'user', time: { created: 2 }, text: 'Hi' },
  { id: 'assistant', type: 'assistant', time: { created: 3, completed: 4 }, model: session.model, tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 20, write: 0 } }, content: [{ type: 'text', text: 'Hello' }] },
], { sessionId: 'session' })
assert.equal(currentOpenCodeModelValue(bundles[0]?.info), review.value)
assert.equal(latestOpenCodeModelValue(bundles), review.value)
const usage = mapOpenCodeContextUsage(bundles.at(-1)?.info, base.contextWindowTokens)!
assert.equal(usage.maxTokens, 200_000)
assert.equal(usage.model, review.value)
assert.equal(usage.percentage, usage.totalTokens / 200_000 * 100)

const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = []
let selected = session.model!
let failSwitch = false
const { client } = createOpenCode2Clients({ baseUrl: 'http://opencode-model-smoke.invalid', fetch: async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const body = request.method === 'GET' ? null : await request.json() as Record<string, unknown>
  requests.push({ method: request.method, path: url.pathname, body })
  if (url.pathname === '/api/provider') {
    assert.equal(url.searchParams.get('location[directory]'), '/project')
    return Response.json({ data: providers })
  }
  if (url.pathname === '/api/model/default') return Response.json({ data: null })
  if (url.pathname === '/api/model') return Response.json({ data: models })
  if (url.pathname === '/api/session/session' && request.method === 'GET') return Response.json({ data: { ...session, model: selected } })
  if (url.pathname.endsWith('/model')) {
    if (failSwitch) return Response.json({ type: 'UnknownError', message: 'model unavailable' }, { status: 500 })
    selected = body!.model as typeof selected
  }
  if (url.pathname.endsWith('/prompt')) return Response.json({ data: { id: 'user' } })
  return new Response(null, { status: 204 })
} })
const catalogue = await client.config.providers({ query: { directory: '/project' } })
assert.equal(mapOpenCodeModelsToSessionModels((catalogue.data ?? catalogue) as ConfigProvidersResponse).length, 4)
const promptModel = decodeOpenCodeModelValue(choices.find(choice => choice.displayName.endsWith(' · fast'))!.value)!
await client.session.promptAsync({ path: { id: 'session' }, body: { model: promptModel, parts: [{ type: 'text', text: 'Hello' }] } })
assert.deepEqual(selected, { id: 'nested/model', providerID: 'custom', variant: 'fast' })
assert.equal(requests.filter(request => request.path.endsWith('/model') && request.method === 'POST').length, 1)
await client.session.promptAsync({ path: { id: 'session' }, body: { model: promptModel, parts: [{ type: 'text', text: 'Again' }] } })
assert.equal(requests.filter(request => request.path.endsWith('/model') && request.method === 'POST').length, 1, 'repeated selection must not create redundant model-switched messages')
await client.session.command({ path: { id: 'session' }, body: { command: 'review', arguments: '', ...{ openCodeModel: decodeOpenCodeModelValue(review.value)! } } })
assert.equal(selected.variant, 'review', 'commands must apply the full provider/model/variant')
await client.session.shell({ path: { id: 'session' }, body: { agent: 'build', command: 'pwd', model: decodeOpenCodeModelValue(base.value)! } })
assert.equal(selected.variant, undefined, 'selecting the base model must clear the old variant')
failSwitch = true
const before = requests.length
await assert.rejects(client.session.promptAsync({ path: { id: 'session' }, body: { model: promptModel, parts: [{ type: 'text', text: 'Do not send' }] } }))
assert.ok(!requests.slice(before).some(request => request.path.endsWith('/prompt')), 'a failed model switch must not run under the old model')
console.log('OpenCode 2 models smoke passed: catalogue, custom variants, metadata, defaults, session/history, prompt/command/shell selection, no-op switches, failure ordering, and v1 compatibility')

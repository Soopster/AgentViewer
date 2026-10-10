import assert from 'node:assert/strict'
import { getProviderCapabilities } from '../lib/provider'
import { planFeature, type DegradableFeature } from '../lib/providerDegradation'
import type { AgentProvider } from '../lib/types'

const providers: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio', 'claude-acp', 'codex-acp']
const features: DegradableFeature[] = ['steer', 'fork', 'rewind']

// Every provider answers every feature, and "native" always agrees with its flag.
for (const provider of providers) {
  const caps = getProviderCapabilities(provider)
  for (const feature of features) assert.ok(planFeature(provider, feature), `${provider}/${feature} has a plan`)
  assert.equal(planFeature(provider, 'steer').mode === 'native', caps.activeSteering, `${provider} steer`)
  assert.equal(planFeature(provider, 'fork').mode === 'native', caps.messageFork, `${provider} fork`)
  assert.equal(planFeature(provider, 'rewind').mode === 'native', caps.inPlaceRewind, `${provider} rewind`)
}

// The shipped composer behaviour: Codex/OpenCode rewind in place, Claude/Pi in a fork.
assert.equal(planFeature('codex', 'rewind').mode, 'native')
assert.equal(planFeature('opencode', 'rewind').mode, 'native')
for (const provider of ['claude', 'pi'] as const) {
  assert.deepEqual(planFeature(provider, 'rewind'), { ...planFeature(provider, 'rewind'), mode: 'fallback', strategy: 'fork_before_prompt' })
}
assert.equal((planFeature('copilot', 'rewind') as { strategy: string }).strategy, 'context_handoff')
assert.equal((planFeature('claude-acp', 'steer') as { strategy: string }).strategy, 'interrupt_restart')
console.log('provider degradation smoke: ok')

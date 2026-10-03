import assert from 'node:assert/strict'
import { copilotIntegrationDiagnostics, copilotSessionConfigOverrides } from '../lib/copilotClient'

const previous = process.env.COPILOT_AUTO_TIER
try {
  for (const tier of ['efficiency', 'balance', 'intelligence', 'fast'] as const) {
    process.env.COPILOT_AUTO_TIER = tier
    assert.equal(copilotSessionConfigOverrides().capi?.autoTier, tier)
    assert.equal(copilotSessionConfigOverrides().model, 'auto')
    assert.ok(copilotIntegrationDiagnostics().includes(`Auto model routing tier: ${tier}`))
  }
  process.env.COPILOT_AUTO_TIER = ' FAST '
  assert.equal(copilotSessionConfigOverrides().capi?.autoTier, 'fast')
  process.env.COPILOT_AUTO_TIER = 'unsupported'
  assert.equal(copilotSessionConfigOverrides().capi, undefined)
  assert.equal(copilotSessionConfigOverrides().model, undefined)
  assert.ok(!copilotIntegrationDiagnostics().some((item) => item.startsWith('Auto model routing tier:')))
  delete process.env.COPILOT_AUTO_TIER
  assert.equal(copilotSessionConfigOverrides().capi, undefined)
  assert.equal(copilotSessionConfigOverrides().model, undefined)
} finally {
  if (previous === undefined) delete process.env.COPILOT_AUTO_TIER
  else process.env.COPILOT_AUTO_TIER = previous
}

console.log('copilot auto tier smoke passed')

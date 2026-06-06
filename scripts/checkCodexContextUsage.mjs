import assert from 'node:assert/strict'

import { mapCodexTokenUsageToContextUsage } from '../lib/codexMapper.ts'

const currentContext = {
  totalTokens: 113_250,
  inputTokens: 113_227,
  cachedInputTokens: 112_512,
  outputTokens: 23,
  reasoningOutputTokens: 0,
}

const usage = mapCodexTokenUsageToContextUsage({
  total: {
    totalTokens: 3_335_222,
    inputTokens: 3_324_701,
    cachedInputTokens: 3_118_208,
    outputTokens: 10_521,
    reasoningOutputTokens: 4_275,
  },
  last: currentContext,
  modelContextWindow: 258_400,
}, 'gpt-5.5')

assert.equal(usage.totalTokens, currentContext.totalTokens, 'context usage should use the latest request, not lifetime thread usage')
assert.equal(usage.maxTokens, 258_400)
assert.equal(Math.round(usage.percentage), 44)
assert.equal(usage.categories.find((category) => category.name === 'Input')?.tokens, currentContext.inputTokens)

const legacyUsage = mapCodexTokenUsageToContextUsage({
  total: currentContext,
  last: null,
  modelContextWindow: 258_400,
}, 'gpt-5.5')

assert.equal(legacyUsage.totalTokens, currentContext.totalTokens, 'older payloads without last usage should fall back to total')

console.log('Codex context usage checks passed')

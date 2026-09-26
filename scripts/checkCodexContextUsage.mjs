import assert from 'node:assert/strict'

import {
  advanceCodexTurnOutputUsage,
  mapCodexTokenUsageToContextUsage,
} from '../lib/codexMapper.ts'

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

let turnUsage = {
  lastTotalOutputTokens: 10_000,
  outputTokens: 0,
}
turnUsage = advanceCodexTurnOutputUsage(turnUsage, {
  total: { ...currentContext, outputTokens: 10_125 },
  last: { ...currentContext, outputTokens: 125 },
  modelContextWindow: 258_400,
})
assert.equal(turnUsage.outputTokens, 125, 'first model pass should use the lifetime output-token delta')

turnUsage = advanceCodexTurnOutputUsage(turnUsage, {
  total: { ...currentContext, outputTokens: 10_200 },
  last: { ...currentContext, outputTokens: 75 },
  modelContextWindow: 258_400,
})
assert.equal(turnUsage.outputTokens, 200, 'later model passes should accumulate without double-counting')

turnUsage = advanceCodexTurnOutputUsage(turnUsage, {
  total: { ...currentContext, outputTokens: 10_200 },
  last: { ...currentContext, outputTokens: 75 },
  modelContextWindow: 258_400,
})
assert.equal(turnUsage.outputTokens, 200, 'repeated usage notifications should not increment the turn total')

const coldTurnUsage = advanceCodexTurnOutputUsage({
  lastTotalOutputTokens: null,
  outputTokens: 0,
}, {
  total: { ...currentContext, outputTokens: 20_125 },
  last: { ...currentContext, outputTokens: 125 },
  modelContextWindow: 258_400,
})
assert.equal(coldTurnUsage.outputTokens, 125, 'a cold stream should fall back to the latest model-pass usage')

console.log('Codex context usage checks passed')

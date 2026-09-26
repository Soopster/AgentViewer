import assert from 'node:assert/strict'

import { mapCopilotUsageToContextUsage } from '../lib/copilotMapper.ts'
import {
  mapOpenCodeContextUsage,
  updateOpenCodeTurnOutputUsage,
} from '../lib/opencodeMapper.ts'

const openCodeUsageMessage = {
  id: 'message',
  sessionID: 'session',
  role: 'assistant',
  time: { created: 0 },
  parentID: 'parent',
  modelID: 'gpt-5',
  providerID: 'openai',
  mode: 'build',
  agent: 'build',
  path: { cwd: '/tmp', root: '/tmp' },
  cost: 0,
  tokens: {
    total: 20_100,
    input: 20_000,
    output: 100,
    reasoning: 0,
    cache: { read: 18_000, write: 0 },
  },
}
const openCodeUsage = mapOpenCodeContextUsage(openCodeUsageMessage)

assert.equal(openCodeUsage?.totalTokens, 20_100, 'OpenCode should use its normalized total without double-counting cached input')

const openCodeOutputByMessage = new Map()
let openCodeTurnOutput = updateOpenCodeTurnOutputUsage(
  openCodeOutputByMessage,
  { ...openCodeUsageMessage, id: 'assistant-1', tokens: { ...openCodeUsageMessage.tokens, output: 75 } },
  0,
)
openCodeTurnOutput = updateOpenCodeTurnOutputUsage(
  openCodeOutputByMessage,
  { ...openCodeUsageMessage, id: 'assistant-1', tokens: { ...openCodeUsageMessage.tokens, output: 100 } },
  openCodeTurnOutput,
)
openCodeTurnOutput = updateOpenCodeTurnOutputUsage(
  openCodeOutputByMessage,
  { ...openCodeUsageMessage, id: 'assistant-2', tokens: { ...openCodeUsageMessage.tokens, output: 40 } },
  openCodeTurnOutput,
)
assert.equal(openCodeTurnOutput, 140, 'OpenCode message snapshots should replace prior counts and sum model passes')

const models = new Map([
  ['claude-sonnet', {
    id: 'claude-sonnet',
    name: 'Claude Sonnet',
    capabilities: {
      supports: { vision: true, reasoningEffort: true },
      limits: { max_context_window_tokens: 200_000 },
    },
    billing: {
      tokenPrices: {
        longContext: { contextMax: 1_000_000 },
      },
    },
  }],
])

const rootUsageEvent = {
  id: 'usage',
  type: 'assistant.usage',
  timestamp: new Date(0).toISOString(),
  parentId: null,
  ephemeral: true,
  data: {
    model: 'claude-sonnet',
    inputTokens: 10_000,
    outputTokens: 500,
    cacheReadTokens: 20_000,
    cacheWriteTokens: 1_000,
  },
}

const copilotUsage = mapCopilotUsageToContextUsage(rootUsageEvent, models, 'long_context')
assert.equal(copilotUsage?.totalTokens, 31_500)
assert.equal(copilotUsage?.maxTokens, 1_000_000, 'Copilot long-context mode should use the long-context limit')
assert.equal(Math.round(copilotUsage?.percentage ?? 0), 3)

assert.equal(
  mapCopilotUsageToContextUsage({ ...rootUsageEvent, agentId: 'subagent' }, models),
  null,
  'sub-agent usage must not replace root conversation context',
)
assert.equal(
  mapCopilotUsageToContextUsage({
    ...rootUsageEvent,
    data: { ...rootUsageEvent.data, initiator: 'mcp-sampling' },
  }, models),
  null,
  'internally initiated API calls must not replace root conversation context',
)

const unknownModelUsage = mapCopilotUsageToContextUsage({
  ...rootUsageEvent,
  data: { ...rootUsageEvent.data, model: 'unknown' },
}, new Map())
assert.equal(unknownModelUsage?.maxTokens, 0, 'missing model metadata should omit the percentage instead of reporting 100%')

const openAiUsage = mapCopilotUsageToContextUsage({
  ...rootUsageEvent,
  data: {
    ...rootUsageEvent.data,
    model: 'gpt-5',
    apiEndpoint: '/responses',
  },
}, new Map([
  ['gpt-5', {
    id: 'gpt-5',
    name: 'GPT-5',
    capabilities: {
      supports: { vision: true, reasoningEffort: true },
      limits: { max_context_window_tokens: 400_000 },
    },
  }],
]))
assert.equal(openAiUsage?.totalTokens, 10_500, 'OpenAI cached tokens are already included in input and must not be added again')

console.log('provider context usage checks passed')

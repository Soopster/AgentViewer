import assert from 'node:assert/strict'
import {
  claudeAgentPolicyKey,
  claudeAgentPolicyOptions,
  claudeQueryBudgetOptions,
  parseClaudeAgentPolicy,
} from '../lib/claudeRuntimePolicy'

const policy = parseClaudeAgentPolicy({
  name: 'reviewer',
  description: 'Review a scoped change',
  prompt: 'Inspect and report; do not edit.',
  tools: ['Read', 'Grep', 'Read'],
  disallowedTools: ['Edit', 'Write'],
  skills: ['review-skill'],
  model: 'sonnet',
  mcpServers: ['project-search', { docs: { type: 'http', url: 'https://example.test/mcp' } }],
  criticalSystemReminder: 'Never modify files.',
  initialPrompt: '/context',
  maxTurns: 4,
  background: true,
  memory: 'project',
  effort: 'high',
  permissionMode: 'plan',
  observer: 'review-observer',
  observerMessage: 'Report policy violations.',
  sandbox: { enabled: true, failIfUnavailable: true },
  ignoredFutureField: true,
})

assert.ok(policy)
assert.deepEqual(policy.tools, ['Read', 'Grep'])
const options = claudeAgentPolicyOptions(policy)
assert.equal(options.agent, 'reviewer')
assert.deepEqual(options.tools, ['Read', 'Grep'])
assert.equal(options.agents?.reviewer?.permissionMode, 'plan')
assert.equal(options.agents?.reviewer?.effort, 'high')
assert.equal(options.agents?.reviewer?.maxTurns, 4)
assert.equal(options.agents?.reviewer?.initialPrompt, '/context')
assert.equal(options.agents?.reviewer?.background, true)
assert.equal(options.agents?.reviewer?.memory, 'project')
assert.equal(options.agents?.reviewer?.observer, 'review-observer')
assert.equal(options.agents?.reviewer?.observerMessage, 'Report policy violations.')
assert.equal(options.agents?.reviewer?.criticalSystemReminder_EXPERIMENTAL, 'Never modify files.')
assert.deepEqual(options.agents?.reviewer?.mcpServers, ['project-search', { docs: { type: 'http', url: 'https://example.test/mcp' } }])
assert.deepEqual(options.sandbox, { enabled: true, failIfUnavailable: true })

assert.equal(parseClaudeAgentPolicy({ permissionMode: 'auto' })?.permissionMode, undefined)
assert.equal(parseClaudeAgentPolicy({ permissionMode: 'dontAsk' })?.permissionMode, 'dontAsk')
assert.equal(parseClaudeAgentPolicy({ effort: 'impossible' }), undefined)
assert.equal(parseClaudeAgentPolicy({ mcpServers: [{ bad: { type: 'file', url: 'file:///tmp/mcp' } }] }), undefined)
assert.equal(claudeAgentPolicyKey(policy), claudeAgentPolicyKey({ ...policy }))
assert.notEqual(claudeAgentPolicyKey(policy), claudeAgentPolicyKey({ ...policy, tools: ['Read'] }))
assert.deepEqual(claudeQueryBudgetOptions(12_345.9, 1.25), {
  taskBudget: { total: 12_345 },
  maxBudgetUsd: 1.25,
})
assert.deepEqual(claudeQueryBudgetOptions(0, Number.NaN), {})

console.log('claude runtime policy smoke: ok')

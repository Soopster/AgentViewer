import assert from 'node:assert/strict'
import { deriveProtocolClaudeAgentPolicy } from '../lib/agentCoordination'
import { parseRunPlaybook } from '../lib/agentProtocol'

const watcher = deriveProtocolClaudeAgentPolicy({
  title: 'Audit SDK usage',
  prompt: 'Inspect the runtime and report findings.',
  roleName: 'Usage auditor',
  roleDescription: 'Read-only evidence gathering.',
  seat: 'watcher',
  paths: ['lib/agentCoordination.ts'],
  requestedModel: 'claude-sonnet-4-5',
  requestedEffort: 'high',
})
assert.equal(watcher.name, 'usage-auditor')
assert.equal(watcher.permissionMode, 'plan')
assert.equal(watcher.model, 'claude-sonnet-4-5')
assert.equal(watcher.effort, 'high')
assert.deepEqual(watcher.sandbox?.filesystem?.denyWrite, ['**'])
assert.ok(watcher.disallowedTools?.includes('Edit'))

const executor = deriveProtocolClaudeAgentPolicy({
  title: 'Implement runtime adapter',
  prompt: 'Add the adapter.',
  seat: 'executor',
  paths: ['lib/runtime.ts'],
  requestedModel: undefined,
  requestedEffort: undefined,
}, {
  name: 'runtime-specialist',
  skills: ['sdk-runtime'],
  permissionMode: 'acceptEdits',
})
assert.equal(executor.name, 'runtime-specialist')
assert.deepEqual(executor.skills, ['sdk-runtime'])
assert.equal(executor.permissionMode, 'acceptEdits')
assert.equal(executor.sandbox?.enabled, true)

const playbook = parseRunPlaybook({
  name: 'claude-policy-smoke',
  budget: { maxTokens: 12_000, maxCostUsd: 2.5, maxDurationMinutes: 15 },
  phases: [{
    title: 'Build',
    tasks: [{
      title: 'Implement',
      detail: 'Make the change',
      claude: {
        tools: ['Read', 'Edit'],
        disallowedTools: ['Bash'],
        skills: ['typescript'],
        mcpServers: ['project-search', { docs: { type: 'http', url: 'https://example.test/mcp' } }],
        criticalSystemReminder: 'Stay inside lib/**.',
        initialPrompt: '/context',
        maxTurns: 6,
        background: false,
        memory: 'project',
        permissionMode: 'acceptEdits',
        observer: 'policy-observer',
        observerMessage: 'Report scope drift.',
        sandbox: { enabled: true, filesystem: { allowWrite: ['lib/**'] } },
      },
    }],
  }],
})
assert.equal(playbook.budget?.maxCostUsd, 2.5)
assert.deepEqual(playbook.phases[0]?.tasks[0]?.claude?.tools, ['Read', 'Edit'])
assert.equal(playbook.phases[0]?.tasks[0]?.claude?.permissionMode, 'acceptEdits')
assert.equal(playbook.phases[0]?.tasks[0]?.claude?.maxTurns, 6)
assert.equal(playbook.phases[0]?.tasks[0]?.claude?.memory, 'project')
assert.equal(playbook.phases[0]?.tasks[0]?.claude?.observer, 'policy-observer')
assert.deepEqual(playbook.phases[0]?.tasks[0]?.claude?.mcpServers, ['project-search', { docs: { type: 'http', url: 'https://example.test/mcp' } }])

console.log('coord Claude policy smoke: ok')

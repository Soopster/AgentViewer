import assert from 'node:assert/strict'
import {
  buildCoordinatorCodexDynamicTools,
  registerCoordinatorMcpServer,
  resolveCoordinatorToolCall,
  unregisterCoordinatorMcpServer,
} from '../lib/agentCoordinationSdkTools'
import { coordinatorClaudeMcpOptions } from '../lib/claudePool'

const sessionId = 'coord-claude-binding-smoke'

const reviewPlanTool = buildCoordinatorCodexDynamicTools().find((candidate) => candidate.name === 'coord_review_plan')
assert.ok(reviewPlanTool, 'Coordinator providers must expose coord_review_plan')
assert.equal(reviewPlanTool.type, 'function', 'coord_review_plan must be a callable dynamic tool')
if (reviewPlanTool.type !== 'function') throw new Error('coord_review_plan has an invalid dynamic tool type')
const reviewPlanSchema = reviewPlanTool.inputSchema as {
  properties?: Record<string, unknown>
  required?: string[]
}
assert.ok(reviewPlanSchema.properties?.approved, 'coord_review_plan must expose the canonical approved field')
assert.equal(reviewPlanSchema.properties?.approve, undefined, 'coord_review_plan must not expose the obsolete approve field')
assert.ok(reviewPlanSchema.required?.includes('approved'), 'coord_review_plan must require an approval decision')

const reviewPlanInvocation = resolveCoordinatorToolCall('coord_review_plan', {
  task_id: 'task-1',
  approved: true,
})
assert.equal(reviewPlanInvocation?.action, 'review_plan')
assert.equal(reviewPlanInvocation?.args.approved, true, 'approved=true must reach the Coordinator action unchanged')
assert.equal(reviewPlanInvocation && 'approve' in reviewPlanInvocation.args, false)

assert.deepEqual(
  coordinatorClaudeMcpOptions(sessionId),
  {},
  'ordinary Claude sessions must continue loading their configured MCP servers',
)

registerCoordinatorMcpServer(sessionId, {
  runId: 'run-1',
  agentId: 'lead',
  token: 'smoke-token',
})

try {
  const options = coordinatorClaudeMcpOptions(sessionId)
  assert.equal(options.strictMcpConfig, true)
  assert.deepEqual(Object.keys(options.mcpServers ?? {}), ['agent-viewer'])
} finally {
  unregisterCoordinatorMcpServer(sessionId)
}

console.log('Coordinator Claude binding smoke passed')

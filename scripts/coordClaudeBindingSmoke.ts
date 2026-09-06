import assert from 'node:assert/strict'
import {
  buildCoordinatorCodexDynamicTools,
  COORD_FINDING_DETAIL_MAX_CHARS,
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

const sendMessageTool = buildCoordinatorCodexDynamicTools().find((candidate) => candidate.name === 'coord_send_message')
assert.ok(sendMessageTool, 'Coordinator providers must expose coord_send_message')
if (sendMessageTool.type !== 'function') throw new Error('coord_send_message has an invalid dynamic tool type')
const sendMessageSchema = sendMessageTool.inputSchema as {
  properties?: Record<string, unknown>
  required?: string[]
}
assert.ok(sendMessageSchema.properties?.message, 'coord_send_message must expose the canonical message field')
assert.equal(sendMessageSchema.properties?.summary, undefined, 'coord_send_message must not advertise the broken summary field')
assert.equal(sendMessageSchema.properties?.detail, undefined, 'coord_send_message must not advertise the broken detail field')
assert.ok(sendMessageSchema.required?.includes('message'), 'coord_send_message must require a message body')

const sendMessageInvocation = resolveCoordinatorToolCall('coord_send_message', {
  to: 'teammate',
  message: 'Canonical mailbox body',
  kind: 'review_request',
  correlation_id: 'review-1',
})
assert.equal(sendMessageInvocation?.args.message, 'Canonical mailbox body')
assert.equal(sendMessageInvocation?.args.kind, 'review_request')
assert.equal(sendMessageInvocation?.args.correlationId, 'review-1')
assert.equal(
  resolveCoordinatorToolCall('coord_send_message', { to: 'teammate', summary: 'Legacy summary', detail: 'Legacy detail' })?.args.message,
  'Legacy summary\n\nLegacy detail',
  'sessions holding the old summary/detail schema must still deliver a body',
)
assert.equal(
  resolveCoordinatorToolCall('coord_send_message', { to: 'teammate', body: 'Compatibility body' })?.args.message,
  'Compatibility body',
  'the bridge compatibility body field must still deliver a message',
)

const publishFindingTool = buildCoordinatorCodexDynamicTools().find((candidate) => candidate.name === 'coord_publish_finding')
assert.ok(publishFindingTool, 'Coordinator providers must expose coord_publish_finding')
if (publishFindingTool.type !== 'function') throw new Error('coord_publish_finding has an invalid dynamic tool type')
const publishFindingSchema = publishFindingTool.inputSchema as {
  properties?: Record<string, { maxLength?: number }>
}
assert.equal(
  publishFindingSchema.properties?.detail?.maxLength,
  COORD_FINDING_DETAIL_MAX_CHARS,
  'coord_publish_finding must accept detailed audit reports larger than the old 8K limit',
)
const detailedFinding = 'ranked hotspot evidence\n'.repeat(500)
assert.ok(detailedFinding.length > 8000)
assert.equal(
  resolveCoordinatorToolCall('coord_publish_finding', {
    kind: 'finding',
    summary: 'Heap-profiler audit',
    detail: detailedFinding,
    task_id: 'task-2',
  })?.args.detail,
  detailedFinding,
  'finding detail must reach the Coordinator action unchanged',
)

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

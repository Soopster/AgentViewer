import assert from 'node:assert/strict'
import { copilotSubagentEvents } from '../lib/extensions/providers/copilot/subagents'
import { mapCopilotEventsToSessionMessages } from '../lib/copilotMapper'
const events = [
  { id: 'root', type: 'assistant.message', timestamp: '2026-10-26T00:00:00Z', data: { messageId: 'root', content: 'parent only' } },
  { id: 'start', type: 'subagent.started', agentId: 'agent-a', timestamp: '2026-10-26T00:00:01Z', data: { toolCallId: 'tool-a' } },
  { id: 'child', type: 'assistant.message', agentId: 'agent-a', timestamp: '2026-10-26T00:00:02Z', data: { messageId: 'child', content: 'captured child transcript' } },
  { id: 'sibling', type: 'assistant.message', agentId: 'agent-b', timestamp: '2026-10-26T00:00:02Z', data: { messageId: 'sibling', content: 'another agent' } },
] as unknown as Parameters<typeof copilotSubagentEvents>[0]
const captured = copilotSubagentEvents(events, 'tool-a')
assert.deepEqual(captured.map(event => event.id), ['start', 'child'])
assert.deepEqual(copilotSubagentEvents(events, 'agent-a'), captured)
assert.deepEqual(copilotSubagentEvents(events, 'missing'), [])
const messages = mapCopilotEventsToSessionMessages('parent', captured)
assert.equal(messages.length, 1)
assert.ok(JSON.stringify(messages).includes('captured child transcript'))
assert.ok(!JSON.stringify(messages).includes('parent only'))
assert.ok(!JSON.stringify(messages).includes('another agent'))
console.log('Captured Copilot subagent transcripts are isolated from parent and sibling activity')

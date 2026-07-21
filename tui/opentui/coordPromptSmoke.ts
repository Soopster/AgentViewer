import assert from 'node:assert/strict'
import {
  buildLeadPlanPreamble,
  buildLeadSynthesisPreamble,
  buildTeammatePlanPreamble,
  buildTeammateTurnPreamble,
  makeA2AStreamResponse,
  makeProtocolBlock,
  parseAgentProtocolEvents,
  type ProtocolAgent,
  type ProtocolTask,
} from '../../lib/agentProtocol'
import { formatTranscriptCard } from '../format'

const timestamp = new Date(0).toISOString()
const agent: ProtocolAgent = {
  id: 'agent-1',
  runId: 'run-1',
  name: 'nova',
  role: 'teammate',
  provider: 'codex',
  sessionId: 'session-1',
  worktreePath: '/repo',
  worktreeBranch: '',
  taskId: 'task-1',
  status: 'working',
  createdAt: timestamp,
  updatedAt: timestamp,
}
const task: ProtocolTask = {
  id: 'task-1',
  runId: 'run-1',
  title: 'Update coordinator guidance',
  prompt: 'Keep checkout directions mode-aware.',
  status: 'in_progress',
  ownerAgentId: agent.id,
  paths: ['lib/agentProtocol.ts'],
  blockedBy: [],
  resultSummary: 'Verified the Coordinator guidance.',
  resultDetail: 'The focused smoke passed.',
  createdAt: timestamp,
  updatedAt: timestamp,
}

function prompts(useWorktrees: boolean): string[] {
  const roster = [agent]
  const agentsById = new Map([[agent.id, agent]])
  return [
    buildLeadPlanPreamble({
      runId: 'run-1',
      agent: { id: 'lead', name: 'lead' },
      prompt: 'Coordinate the change.',
      teammateCount: 1,
      useWorktrees,
    }),
    buildTeammatePlanPreamble({
      runId: 'run-1',
      agent,
      roster,
      task,
      allTasks: [task],
      inbox: [],
      agentsById,
      useWorktrees,
    }),
    buildTeammateTurnPreamble({
      runId: 'run-1',
      agent,
      roster,
      task,
      allTasks: [task],
      inbox: [],
      agentsById,
      gateCommand: 'npm run tui:check',
      useWorktrees,
    }),
    buildLeadSynthesisPreamble({
      runId: 'run-1',
      agent: { id: 'lead', name: 'lead' },
      prompt: 'Coordinate the change.',
      tasks: [task],
      knowledge: [],
      agentsById,
      useWorktrees,
    }),
  ]
}

const sharedCheckoutPrompts = prompts(false)
for (const prompt of sharedCheckoutPrompts) {
  assert.match(prompt, /shared checkout/i)
  assert.doesNotMatch(prompt, /worktree/i)
}
for (const prompt of prompts(true)) assert.match(prompt, /worktree/i)
assert.match(sharedCheckoutPrompts[3]!, /result: Verified the Coordinator guidance.*The focused smoke passed/)

const protocolPromptCard = formatTranscriptCard({
  role: 'user',
  uuid: 'coordinator-prompt',
  provider: 'codex',
  blocks: [{ type: 'text', text: sharedCheckoutPrompts[1]! }],
})
assert.equal(protocolPromptCard.category, 'technical')
assert.equal(protocolPromptCard.autoFold, true)
assert.equal(protocolPromptCard.markdownContent, undefined)

const messageEvent = {
  version: '1.0' as const,
  runId: 'run-1',
  agentId: 'agent-1',
  type: 'message' as const,
  taskId: 'task-1',
  to: 'lead',
  summary: 'Need review',
  detail: 'Please review the implementation.',
  timestamp,
}
const messageResponse = makeA2AStreamResponse(messageEvent)
assert.ok('message' in messageResponse)
if ('message' in messageResponse) {
  assert.equal(messageResponse.message.contextId, 'run-1')
  assert.equal(messageResponse.message.taskId, 'task-1')
  assert.equal(messageResponse.message.role, 'ROLE_AGENT')
  assert.deepEqual(messageResponse.message.extensions, ['https://agent-viewer.dev/extensions/coordination/v1'])
}
const parsedMessage = parseAgentProtocolEvents(makeProtocolBlock(messageEvent))[0]
assert.equal(parsedMessage?.type, messageEvent.type)
assert.equal(parsedMessage?.runId, messageEvent.runId)
assert.equal(parsedMessage?.agentId, messageEvent.agentId)
assert.equal(parsedMessage?.to, messageEvent.to)
assert.equal(parsedMessage?.detail, messageEvent.detail)

const completedEvent = {
  ...messageEvent,
  type: 'task.completed' as const,
  to: undefined,
  summary: 'Implemented and verified',
}
const completedResponse = makeA2AStreamResponse(completedEvent)
assert.ok('task' in completedResponse)
if ('task' in completedResponse) {
  assert.equal(completedResponse.task.status.state, 'TASK_STATE_COMPLETED')
  assert.equal(completedResponse.task.artifacts?.[0]?.artifactId, 'task-1:result')
}
const parsedCompletion = parseAgentProtocolEvents(makeProtocolBlock(completedEvent))[0]
assert.equal(parsedCompletion?.type, completedEvent.type)
assert.equal(parsedCompletion?.summary, completedEvent.summary)
assert.equal(parsedCompletion?.taskId, completedEvent.taskId)

const legacy = parseAgentProtocolEvents(`\`\`\`agent-protocol\n${JSON.stringify({
  version: 'AVP/2',
  runId: 'legacy-run',
  agentId: 'legacy-agent',
  type: 'agent.heartbeat',
})}\n\`\`\``)
assert.equal(legacy[0]?.version, '1.0')
assert.equal(legacy[0]?.type, 'agent.heartbeat')

console.log('Coordinator prompt smoke passed')

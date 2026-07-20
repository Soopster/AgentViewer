import assert from 'node:assert/strict'
import {
  buildLeadPlanPreamble,
  buildLeadSynthesisPreamble,
  buildTeammatePlanPreamble,
  buildTeammateTurnPreamble,
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

const protocolPromptCard = formatTranscriptCard({
  role: 'user',
  uuid: 'coordinator-prompt',
  provider: 'codex',
  blocks: [{ type: 'text', text: sharedCheckoutPrompts[1]! }],
})
assert.equal(protocolPromptCard.category, 'technical')
assert.equal(protocolPromptCard.autoFold, true)
assert.equal(protocolPromptCard.markdownContent, undefined)

console.log('Coordinator prompt smoke passed')

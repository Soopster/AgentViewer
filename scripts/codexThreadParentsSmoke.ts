// Hermetic half of codexSubagentApprovalSmoke.ts: every record Codex uses to
// report a spawned sub-agent teaches the client the thread's parent, so the
// chat's turn claims that sub-agent's approvals.
import assert from 'node:assert/strict'
import { getCodexClient } from '../lib/codexClient'

// The singleton spawns nothing until a request is made.
const client = getCodexClient()
const note = (params: Record<string, unknown>) => (client as unknown as { noteThreadParent(p: Record<string, unknown>): void }).noteThreadParent(params)

// codex-cli 0.157: a subAgentActivity item on the parent's thread.
note({ threadId: 'root', item: { type: 'subAgentActivity', kind: 'started', agentThreadId: 'child', agentPath: '/root/a' } })
// The schema's other two shapes: the child's own start, and a collab call naming receivers.
note({ thread: { id: 'grandchild', source: { subAgent: { thread_spawn: { parent_thread_id: 'child', depth: 2 } } } } })
note({ threadId: 'root', item: { type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'root', receiverThreadIds: ['sibling'] } })
// Noise that must teach nothing.
note({ threadId: 'root', item: { type: 'collabAgentToolCall', tool: 'wait', senderThreadId: 'root', receiverThreadIds: [] } })
note({ threadId: 'other-root', item: { type: 'subAgentActivity', kind: 'started', agentThreadId: 'unrelated', agentPath: '/x' } })
note({ thread: { id: 'plain', source: 'vscode' } })

assert.ok(client.threadDescendsFrom('root', 'root'), 'a thread is within itself')
assert.ok(client.threadDescendsFrom('child', 'root'), 'subAgentActivity records the parent')
assert.ok(client.threadDescendsFrom('grandchild', 'root'), 'descent is transitive')
assert.ok(client.threadDescendsFrom('sibling', 'root'), 'a collab spawn records its receivers')
assert.ok(!client.threadDescendsFrom('unrelated', 'root'), 'another chat\'s sub-agent must not be claimed')
assert.ok(!client.threadDescendsFrom('root', 'child'), 'a parent is not within its child')
assert.ok(!client.threadDescendsFrom('plain', 'root'), 'a thread with no spawn record is not a sub-agent')

// A cycle in reported parentage must terminate rather than spin.
note({ threadId: 'loop-b', item: { type: 'subAgentActivity', kind: 'started', agentThreadId: 'loop-a', agentPath: '/l' } })
note({ threadId: 'loop-a', item: { type: 'subAgentActivity', kind: 'started', agentThreadId: 'loop-b', agentPath: '/l' } })
assert.ok(!client.threadDescendsFrom('loop-a', 'root'))
console.log('codex thread parents smoke passed')

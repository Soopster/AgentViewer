import assert from 'node:assert/strict'
import { buildTaskRegistry, isStoppableTask } from '../lib/taskRegistry'
import type { ThreadedMessage } from '../lib/threading'

const shell = {
  uuid: 'bash-message', provider: 'claude', timestamp: '2026-10-28T00:00:00Z',
  blocks: [{ type: 'tool_thread', toolUse: { id: 'bash-1', name: 'Bash', input: { command: 'sleep 30', description: 'Wait' } },
    result: { content: 'Command running in background with ID: shell-1. Output is being written to: /tmp/shell-1.output' } }],
} as unknown as ThreadedMessage
const started = buildTaskRegistry([shell]).get('shell-1')!
assert.equal(started.command, 'sleep 30')
assert.equal(started.outputFile, '/tmp/shell-1.output')
assert.equal(started.taskType, 'local_bash')
assert.ok(isStoppableTask(started))
const finished = buildTaskRegistry([shell, {
  uuid: 'done', provider: 'claude', blocks: [{ type: 'claude_system', payload: {
    subtype: 'task_notification', task_id: 'shell-1', status: 'completed', summary: 'Done',
  } }],
} as unknown as ThreadedMessage]).get('shell-1')!
assert.equal(finished.status, 'completed')
assert.equal(finished.outputFile, '/tmp/shell-1.output')
assert.equal(isStoppableTask(finished), false)
assert.equal(buildTaskRegistry([{ ...shell, provider: 'codex' }]).size, 0)
console.log('Background shell smoke: PASS')

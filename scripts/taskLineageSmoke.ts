// Pins SDK 0.3.292's task lineage fields end to end: parent_task_id and run_id are read off
// task events by the registry and survive background_tasks_changed. A resumed task keeps its
// id and gets a new run id, so two distinct runs must read as two runs rather than one.
import assert from 'node:assert/strict'
import { buildTaskRegistry } from '../lib/taskRegistry'
import { getClaudeBackgroundTasks } from '../lib/claudeSdkFeatures'
import type { ThreadedMessage } from '../lib/threading'

let n = 0
const event = (payload: Record<string, unknown>): ThreadedMessage => ({
  role: 'system',
  uuid: `u${++n}`,
  provider: 'claude',
  blocks: [{ type: 'claude_system', payload: { type: 'system', ...payload } }],
} as unknown as ThreadedMessage)

const registry = buildTaskRegistry([
  event({ subtype: 'task_started', task_id: 'parent', run_id: 'r1', description: 'lead agent', subagent_type: 'general', spawn_depth: 1 }),
  event({ subtype: 'task_started', task_id: 'child', run_id: 'c1', parent_task_id: 'parent', description: 'nested', spawn_depth: 2 }),
  event({ subtype: 'task_updated', task_id: 'child', run_id: 'c1', patch: { status: 'completed' } }),
  // Same task id, new run: a resume.
  event({ subtype: 'task_started', task_id: 'child', run_id: 'c2', parent_task_id: 'parent', description: 'nested again' }),
  // A progress event that omits the lineage must not clobber what task_started established.
  event({ subtype: 'task_progress', task_id: 'child', description: 'working' }),
])

const child = registry.get('child')
assert.ok(child, 'child task exists')
assert.equal(child.parentTaskId, 'parent')
assert.equal(child.spawnDepth, 2)
assert.deepEqual(child.runIds, ['c1', 'c2'], 'a resumed task records both runs, oldest first')
assert.equal(registry.get('parent')?.parentTaskId, undefined, 'a main-thread launch has no parent')
assert.deepEqual(registry.get('parent')?.runIds, ['r1'])

const live = getClaudeBackgroundTasks({
  type: 'system',
  subtype: 'background_tasks_changed',
  tasks: [{ task_id: 'child', task_type: 'local_agent', description: 'nested', parent_task_id: 'parent', run_id: 'c2' }],
} as never)[0]
assert.ok(live, 'background_tasks_changed yields a live task')
assert.equal(live.parent_task_id, 'parent')
assert.equal(live.run_id, 'c2')

console.log('Task lineage smoke: PASS')

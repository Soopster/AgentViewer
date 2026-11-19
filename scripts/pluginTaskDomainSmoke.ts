import assert from 'node:assert/strict'
import type { ThreadedMessage } from '../lib/threading'
import { buildPluginTaskRegistry, mergeTaskMessages } from '../plugins/tasks/domain/registry'

const event = (uuid: string, payload: Record<string, unknown>): ThreadedMessage => ({
  role: 'system', uuid, provider: 'claude',
  blocks: [{ type: 'claude_system', payload: { type: 'system', ...payload } }],
} as unknown as ThreadedMessage)
const started = event('start', { subtype: 'task_started', task_id: 'one', description: 'Read the source' })
const oldProgress = event('progress', { subtype: 'task_progress', task_id: 'one', description: 'Still working' })
const liveProgress = event('progress', { subtype: 'task_progress', task_id: 'one', description: 'Finishing checks' })
const completed = event('complete', { subtype: 'task_notification', task_id: 'one', status: 'completed', summary: 'Verified' })
const persisted = Object.freeze([started, oldProgress])
const live = Object.freeze([liveProgress, completed])
const merged = mergeTaskMessages(persisted, live)
assert.deepEqual(merged.map(message => message.uuid), ['start', 'progress', 'complete'])
assert.equal(merged[1], liveProgress, 'a newer snapshot replaces the persisted message without duplicating it')
assert.equal(persisted[1], oldProgress, 'the caller-owned transcript remains unchanged')
const copied = mergeTaskMessages(persisted, [])
copied.pop()
assert.equal(persisted.length, 2, 'a merged list never exposes a mutable caller-owned array')
const finished = buildPluginTaskRegistry({ persisted, live })
assert.equal(finished.get('one')?.status, 'completed', 'live task events apply after older persisted events')
assert.equal(finished.get('one')?.latestEventUuid, 'complete')
assert.equal(finished.get('one')?.summary, 'Verified')

// Equal text in distinct messages is still two distinct task events.
const sameA = event('same-a', { subtype: 'task_progress', task_id: 'one', description: 'Checking' })
const sameB = event('same-b', { subtype: 'task_progress', task_id: 'one', description: 'Checking' })
assert.deepEqual(mergeTaskMessages([sameA], [sameB]).map(message => message.uuid), ['same-a', 'same-b'])
const unique = mergeTaskMessages([started], [oldProgress, liveProgress])
assert.deepEqual(unique.map(message => message.uuid), ['start', 'progress'])
assert.equal(unique[1], liveProgress, 'the newest repeated live UUID is authoritative')

const overlaid = buildPluginTaskRegistry({ persisted: [started], todos: [{ id: 'one', content: 'Provider snapshot', status: 'completed', priority: 'high' }], plan: [{ id: 'plan-one', step: 'Check the plan', status: 'in_progress' }] })
assert.equal(overlaid.get('one')?.subject, 'Provider snapshot')
assert.equal(overlaid.get('one')?.status, 'completed')
assert.equal([...overlaid.values()].some(task => task.subject === 'Check the plan' && task.status === 'in_progress'), true)
assert.equal(buildPluginTaskRegistry({ persisted: [] }).size, 0)
console.log('Task plugin domain: PASS (live replacement, event chronology, identity-only deduplication, provider snapshots and immutable inputs)')

// Copilot background tasks → the runtime's waiting registry (herdr #3291: a
// Copilot agent read as idle while background agents were still running).
// Each rule fails silently in one direction: a live turn marked "waiting"
// shows up in the attention inbox mid-turn; a missed task lets the Coordinator
// call a teammate available while its background agent is still working.
import assert from 'node:assert/strict'
import { clearRunningSession, clearWaitingSession, listWaitingSessions, setRunningSession } from '../lib/sessionRuntime'
import { refreshCopilotBackgroundTasks, watchCopilotBackgroundTasks } from '../lib/copilotClient'
import { coordinatorBackgroundWork } from '../lib/coordinatorInteractiveState'

type Task = { id: string; type: string; status: string; description: string }
function fakeSession(tasks: () => Task[] | Promise<never>) {
  return { rpc: { tasks: { list: async () => ({ tasks: await tasks() }) } } } as never
}
const waiting = (id: string) => listWaitingSessions().find(entry => entry.sessionId === id)

const id = 'copilot-bg-smoke'
let tasks: Task[] = [
  { id: 'a', type: 'agent', status: 'running', description: 'research' },
  { id: 's', type: 'shell', status: 'running', description: 'npm run dev' },
  { id: 'i', type: 'agent', status: 'idle', description: 'waiting for input' },
  { id: 'd', type: 'agent', status: 'completed', description: 'done' },
]
const session = fakeSession(() => tasks)

setRunningSession(id, { provider: 'copilot', interrupt: async () => {} })
await refreshCopilotBackgroundTasks(id, session)
assert.equal(waiting(id), undefined, 'a session with a live turn is running, not waiting')
clearRunningSession(id)

// A turn that starts while the task list is in flight must win the race.
await refreshCopilotBackgroundTasks(id, fakeSession(() => { setRunningSession(id, { provider: 'copilot', interrupt: async () => {} }); return tasks }))
assert.equal(waiting(id), undefined, 'a turn that started during the RPC is not overwritten by a stale waiting marker')
clearRunningSession(id)

await refreshCopilotBackgroundTasks(id, session)
assert.deepEqual(waiting(id)?.backgroundTasks.map(task => [task.id, task.type]), [['a', 'subagent'], ['s', 'shell']],
  'running tasks are recorded in Claude\'s vocabulary; idle and completed ones are not')
assert.deepEqual(coordinatorBackgroundWork(waiting(id)!.backgroundTasks, waiting(id)!.sessionCrons), { tasks: 1, wakeups: 0 },
  'the shared classifier counts the background agent and not the shell')

await refreshCopilotBackgroundTasks(id, fakeSession(() => Promise.reject(new Error('rpc down'))))
assert.ok(waiting(id), 'an unreachable task list is not evidence the work finished')

tasks = [{ id: 'a', type: 'agent', status: 'completed', description: 'research' }]
await refreshCopilotBackgroundTasks(id, session)
assert.equal(waiting(id), undefined, 'the marker clears once nothing is running')

// The pooled watcher reacts to the session's own events, after the turn's
// listener is gone.
let listener: ((event: { type: string }) => void) | null = null
tasks = [{ id: 'b', type: 'agent', status: 'running', description: 'later' }]
const watched = { rpc: (session as { rpc: unknown }).rpc, on: (handler: (event: { type: string }) => void) => { listener = handler; return () => { listener = null } } } as never
const stop = watchCopilotBackgroundTasks(id, watched)
listener!({ type: 'session.background_tasks_changed' })
await new Promise(resolve => setTimeout(resolve, 10))
assert.deepEqual(waiting(id)?.backgroundTasks.map(task => task.id), ['b'], 'a task change after the turn marks the session waiting')
listener!({ type: 'assistant.turn_start' })
assert.equal(waiting(id), undefined, 'a new turn clears the marker at once')
stop()
assert.equal(listener, null, 'eviction can unsubscribe the watcher')
clearWaitingSession(id)
console.log('Copilot background tasks: live turn excluded, running-only, shared vocabulary, RPC failure keeps state, clears when done, event watcher passed')

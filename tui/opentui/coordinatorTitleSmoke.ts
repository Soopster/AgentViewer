import assert from 'node:assert/strict'
import { parseCoordinatorSessionTitle as p, retitleCoordinatorSession as r } from '../../lib/coordinatorSessionTitle'
const goals = new Map([['chat-98451e', 'Fix the flaky sidebar test\nmore detail']])
assert.deepEqual(p('Coordinator run chat-98451e'), { runId: 'chat-98451e', agent: null })
assert.deepEqual(p('Coordinator run chat-18a52adc orion teammate'), { runId: 'chat-18a52adc', agent: 'orion' })
assert.deepEqual(p('Coordinator run as oc-worker'), { runId: null, agent: 'oc-worker' })
assert.equal(p('Fix the Coordinator run page'), null)
assert.equal(r('Coordinator run chat-98451e', goals), 'Fix the flaky sidebar test')
assert.equal(r('Coordinator run chat-98451e as nova', goals), 'Fix the flaky sidebar test · nova')
assert.equal(r('Coordinator run chat-unknown orion teammate', goals), 'Coordinator · orion')
assert.equal(r('Coordinator run chat-unknown', goals), 'Coordinator run chat-unknown')
assert.equal(r('Refactor the sidebar', goals), 'Refactor the sidebar')
console.log('coordinatorTitleSmoke ok')

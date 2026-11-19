// The running registry says when a turn began: what the Web's Omni bar times.
// A turn that registers again (a reattach, a steer) keeps its first time; a new
// turn after the old one cleared starts its own.
import assert from 'node:assert/strict'
import { clearRunningSession, listRunningSessionRefs, setRunningSession } from '../lib/sessionRuntime'

const turn = { provider: 'claude' as const, interrupt: async () => {} }
const startedAt = () => listRunningSessionRefs().find(ref => ref.sessionId === 'started-at-smoke')?.startedAt
const before = Date.now()
setRunningSession('started-at-smoke', { ...turn, requestId: 'r1' } as never)
const first = startedAt()
assert.ok(first && first >= before && first <= Date.now(), 'a running turn reports when it began')
await new Promise(resolve => setTimeout(resolve, 20))
setRunningSession('started-at-smoke', { ...turn, requestId: 'r1' } as never)
assert.equal(startedAt(), first, 're-registering the same turn keeps its start time')
clearRunningSession('started-at-smoke')
assert.equal(startedAt(), undefined)
await new Promise(resolve => setTimeout(resolve, 20))
setRunningSession('started-at-smoke', { ...turn, requestId: 'r2' } as never)
assert.ok(startedAt()! > first, 'a new turn starts its own clock')
clearRunningSession('started-at-smoke')
console.log('Running started-at smoke: PASS')

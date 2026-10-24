import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import { windowSessionTarget, filterWindowTargets, snapshotBroadcastTargets, type WindowTarget } from './windowTargets'
import { BroadcastDeliveryError, deliverWindowBroadcast, validateBroadcast } from './windowBroadcast'

const a: Session = { sessionId: 'a', provider: 'claude', providerInstanceId: 'work-account', summary: 'Review', cwd: '/repo/frontend' }
const b: Session = { sessionId: 'b', provider: 'codex', summary: 'Debugging', cwd: '/repo/backend' }
const c: Session = { sessionId: 'c', provider: 'pi', summary: 'Scratch', isPending: true }
const targets: WindowTarget[] = [windowSessionTarget(a, false), windowSessionTarget(b, true), windowSessionTarget(c, false), { key: 'surface:terminal', surface: 'terminal', title: 'Terminal', detail: '/repo', hidden: true }]
assert.deepEqual(filterWindowTargets(targets, 'codex backend').map((target) => target.key), ['codex:b'])
assert.deepEqual(filterWindowTargets(targets, 'review').map((target) => target.key), ['claude:a'])
assert.deepEqual(filterWindowTargets(targets, 'hidden').map((target) => target.key), ['codex:b'])
assert.deepEqual(filterWindowTargets(targets, 'unmatched'), [])
const selected = snapshotBroadcastTargets(targets, new Set(['claude:a', 'codex:b', 'pi:c', 'surface:terminal']))
assert.equal(selected.length, 2)
assert.equal(selected[0]?.providerInstanceId, 'work-account')
assert.notEqual(selected[0], a, 'review captures identity rather than retaining a mutable target object')
assert.ok(validateBroadcast('', selected))
assert.ok(validateBroadcast('/model expensive', selected))
assert.ok(validateBroadcast('!rm something', selected))
assert.ok(validateBroadcast('hello', []))
assert.ok(validateBroadcast('hello', [a, a]))
assert.ok(validateBroadcast('hello', [c]))
assert.ok(validateBroadcast('x'.repeat(20_001), selected))
const attempts: string[] = []
const requestIds: string[] = []
const results = await deliverWindowBroadcast(selected, '  Review this change\nCheck edge cases.  ', async (session, text, requestId) => {
  attempts.push(session.sessionId)
  requestIds.push(requestId)
  assert.equal(text, 'Review this change\nCheck edge cases.')
  if (session.sessionId === 'b') throw new BroadcastDeliveryError('Busy')
  return { mode: 'started' }
})
assert.deepEqual(attempts.sort(), ['a', 'b'])
assert.equal(new Set(requestIds).size, 2)
assert.deepEqual(results.map((result) => result.status), ['sent', 'failed'])
const unknown = await deliverWindowBroadcast([a], 'hello', async () => { throw new Error('Transport lost') })
assert.equal(unknown[0]?.status, 'unknown', 'transport errors must not claim that nothing was sent')
let calls = 0
await assert.rejects(deliverWindowBroadcast([], 'hello', async () => { calls += 1; return { mode: 'started' } }))
assert.equal(calls, 0)
console.log('Window search, frozen broadcast identities, validation, and independent delivery outcomes passed.')

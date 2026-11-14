// Alerts fire on transitions, never on what the first observation already held.
import assert from 'node:assert/strict'
import { createSessionAlertTracker, sessionAlertDelivery, MIN_RUN_FOR_FINISHED_MS, type SessionActivity } from '../../plugins/session-alerts/domain/alerts'

const at = (entries: Array<[string, SessionActivity]>) => new Map(entries)
const t0 = 1_000_000
const tracker = createSessionAlertTracker()
assert.deepEqual(tracker.observe(at([['a', 'running'], ['b', 'needs-input']]), t0), [], 'the first observation is a baseline')
assert.deepEqual(tracker.observe(at([['a', 'running'], ['b', 'needs-input']]), t0 + 1000), [], 'unchanged: nothing')
assert.deepEqual(tracker.observe(at([['a', 'running'], ['b', 'needs-input'], ['c', 'needs-input']]), t0 + 2000), [{ key: 'c', kind: 'needs-input' }], 'a new question')
assert.deepEqual(tracker.observe(at([['b', 'needs-input'], ['c', 'needs-input']]), t0 + MIN_RUN_FOR_FINISHED_MS + 5000), [{ key: 'a', kind: 'finished' }], 'a long turn ended')
// A short turn ending is not news; a turn that ends by asking is a question, not a finish.
const quick = createSessionAlertTracker()
quick.observe(at([]), t0)
quick.observe(at([['q', 'running']]), t0 + 1000)
assert.deepEqual(quick.observe(at([]), t0 + 4000), [], 'short turn')
quick.observe(at([['r', 'running']]), t0 + 5000)
assert.deepEqual(quick.observe(at([['r', 'needs-input']]), t0 + 60_000), [{ key: 'r', kind: 'needs-input' }])
assert.deepEqual(quick.observe(at([]), t0 + 61_000), [], 'answering it is not a finish')
// Delivery: desktop only for a blurred terminal; the in-app notice only when elsewhere and present.
assert.deepEqual(sessionAlertDelivery('desktop', true, false), { desktop: true, notice: false }, 'blurred while viewing: desktop')
assert.deepEqual(sessionAlertDelivery('desktop', false, true), { desktop: false, notice: true }, 'present, elsewhere: notice')
assert.deepEqual(sessionAlertDelivery('desktop', true, true), { desktop: false, notice: false }, 'present and looking: quiet')
assert.deepEqual(sessionAlertDelivery('desktop', true, null), { desktop: false, notice: false }, 'unknown focus counts as present')
assert.deepEqual(sessionAlertDelivery('in-app', false, false), { desktop: false, notice: false }, 'in-app mode never reaches a blurred terminal')
assert.deepEqual(sessionAlertDelivery('off', false, false), { desktop: false, notice: false })
console.log('Session alerts smoke passed (baseline, transitions, long-turn rule, delivery)')

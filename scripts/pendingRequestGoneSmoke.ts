import assert from 'node:assert/strict'
import { isPendingRequestGone, PendingRequestGoneError, PENDING_REQUEST_GONE_CODE } from '../lib/pendingRequestGone'

// The class, its message after an HTTP round trip, and a coded body all read as gone.
assert.ok(isPendingRequestGone(new PendingRequestGoneError('Question')))
assert.ok(isPendingRequestGone(new Error(new PendingRequestGoneError('Approval request').message)), 'survives serialization to a message')
assert.ok(isPendingRequestGone(Object.assign(new Error('x'), { code: PENDING_REQUEST_GONE_CODE })))
// Ordinary failures must keep their error treatment — retiring a live card would drop a real ask.
for (const other of [new Error('permissionId is required'), new Error('network down'), 'boom', null, undefined]) {
  assert.equal(isPendingRequestGone(other), false)
}
console.log('pending request gone smoke: ok')

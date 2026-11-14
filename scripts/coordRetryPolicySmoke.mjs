import assert from 'node:assert/strict'
import { CoordinatorAhpClient } from '../bin/agent-viewer-ahp-client.mjs'
import { COORDINATOR_READ_ACTIONS, COORDINATOR_KEYED_ACTIONS } from '../bin/agent-viewer-coordinator-tools.mjs'

// Drive the real request/retry method while replacing only its wire endpoint.
// A live response-loss/reconnect case also runs in mcpAhpCoordinatorSmoke.
async function attempt(action, payload, code, { alwaysFail = false, abort = false } = {}) {
  const client = new CoordinatorAhpClient({ attachUrl: 'http://127.0.0.1:1' })
  const controller = new AbortController()
  const calls = []
  client.ensureConnected = async () => {}
  client.rememberRunSubscription = async () => {}
  client.sendRequest = async (method, params) => {
    calls.push(structuredClone({ method, params }))
    if (calls.length === 1 || alwaysFail) {
      if (abort) controller.abort(new Error('shutdown'))
      throw Object.assign(new Error('injected failure'), { code })
    }
    return { recovered: true }
  }
  let error
  let result
  try { result = await client.request(action, payload, 100, controller.signal) } catch (caught) { error = caught }
  if (calls.length === 2) assert.deepEqual(calls[1], calls[0], `${action}: retry must preserve the full request`)
  return { calls: calls.length, result, error }
}

for (const code of ['AHP_TRANSPORT_CLOSED', 'AHP_REQUEST_TIMEOUT']) {
  for (const action of COORDINATOR_READ_ACTIONS) {
    const result = await attempt(action, {}, code)
    assert.equal(result.calls, 2, `${action}: read retries on ${code}`)
    assert.ok(result.result?.recovered)
  }
  for (const action of COORDINATOR_KEYED_ACTIONS) {
    const result = await attempt(action, { runId: 'run', agentId: 'caller', requestId: 'first-call-key' }, code)
    assert.equal(result.calls, 2, `${action}: keyed mutation retries on ${code}`)
    assert.ok(result.result?.recovered)
    assert.equal((await attempt(action, {}, code)).calls, 1, `${action}: unkeyed mutation must not be repeated`)
  }
  assert.equal((await attempt('read_inbox', { acknowledge: false }, code)).calls, 2)
  for (const action of ['create_run', 'join_run', 'unknown_action']) {
    assert.equal((await attempt(action, { requestId: 'not-supported' }, code)).calls, 1, `${action}: no blind retry`)
  }
}
assert.equal((await attempt('create_task', { requestId: 'key' }, 'VALIDATION_ERROR')).calls, 1)
const exhausted = await attempt('create_task', { requestId: 'key' }, 'AHP_REQUEST_TIMEOUT', { alwaysFail: true })
assert.equal(exhausted.calls, 2, 'retries must be bounded')
assert.ok(exhausted.error)
const aborted = await attempt('wait', {}, 'AHP_TRANSPORT_CLOSED', { abort: true })
assert.equal(aborted.calls, 1, 'shutdown must not reconnect')
assert.match(aborted.error?.message, /shutdown/)
console.log('Coordinator retry policy smoke passed')

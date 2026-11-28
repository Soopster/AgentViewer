import assert from 'node:assert/strict'
import {
  addressableSessionName,
  beginDetachedTurnDrain,
  resolveAddressableSession,
  type AddressableSession,
} from '../lib/crossSessionMessaging'
import { parseCrossSessionComposerCommand } from '../lib/crossSessionCommands'

const windowsName = addressableSessionName({
  sessionId: '12345678-abcd',
  provider: 'codex',
  cwd: 'C:\\Users\\Ada Lovelace\\agent viewer',
  summary: 'Fix https://example.test/a b',
})
assert.equal(windowsName, 'Fix-https-example.test-a-b-5678abcd')
assert.doesNotMatch(windowsName, /[\\/:\s]/)

const sessions: AddressableSession[] = [
  { sessionId: 'one-111111', provider: 'claude', name: 'worker-one-111111', title: 'Worker one', running: true },
  { sessionId: 'two-222222', provider: 'codex', name: 'worker-two-222222', title: 'Worker two', running: false },
  { sessionId: 'three-333333', provider: 'pi', name: 'worker-three-333333', title: 'Worker three', running: false },
]

assert.equal(resolveAddressableSession(sessions, 'worker-two-222222')?.sessionId, 'two-222222')
assert.equal(resolveAddressableSession(sessions, 'worker-three')?.sessionId, 'three-333333')
assert.equal(resolveAddressableSession(sessions, 'worker'), undefined, 'ambiguous prefixes must not pick an arbitrary recipient')
assert.equal(resolveAddressableSession(sessions, 'missing'), undefined)
assert.equal(resolveAddressableSession([
  { sessionId: 'same-prefix-first', provider: 'codex', name: 'duplicate-name', running: false },
  { sessionId: 'same-prefix-second', provider: 'codex', name: 'duplicate-name', running: false },
], 'duplicate-name'), undefined, 'duplicate display names must never route to the first session')
assert.deepEqual(parseCrossSessionComposerCommand('/sessions'), { kind: 'list' })
assert.deepEqual(parseCrossSessionComposerCommand('/message worker-two-222222 please review this'), {
  kind: 'message',
  target: 'worker-two-222222',
  text: 'please review this',
})
assert.deepEqual(parseCrossSessionComposerCommand('/message'), { kind: 'message', target: '', text: '' })
assert.equal(parseCrossSessionComposerCommand('/compact'), null)

const acceptedDrain = beginDetachedTurnDrain(new Response([
  'event: session\ndata: {"sessionId":"recipient"}\n\n',
  'event: turn-accepted\ndata: {"sessionId":"recipient","provider":"codex"}\n\n',
  'data: {"type":"assistant"}\n\n',
].join('')))
await acceptedDrain.accepted
await acceptedDrain.completion

const rejectedDrain = beginDetachedTurnDrain(new Response(
  'event: error\ndata: {"error":"turn already running"}\n\n',
))
await assert.rejects(rejectedDrain.accepted, /turn already running/)
await rejectedDrain.completion

console.log('cross-session messaging smoke passed')

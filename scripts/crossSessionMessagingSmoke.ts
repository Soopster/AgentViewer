import assert from 'node:assert/strict'
import {
  addressableSessionName,
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
assert.equal(windowsName, 'Fix-https-example.test-a-b-123456')
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
assert.deepEqual(parseCrossSessionComposerCommand('/sessions'), { kind: 'list' })
assert.deepEqual(parseCrossSessionComposerCommand('/message worker-two-222222 please review this'), {
  kind: 'message',
  target: 'worker-two-222222',
  text: 'please review this',
})
assert.deepEqual(parseCrossSessionComposerCommand('/message'), { kind: 'message', target: '', text: '' })
assert.equal(parseCrossSessionComposerCommand('/compact'), null)

console.log('cross-session messaging smoke passed')

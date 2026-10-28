// The attach handshake (herdr's `status`): a client must be able to tell an
// older daemon from a working one, and must never act on the difference by
// restarting a server that may be serving somebody else's turns.
import assert from 'node:assert/strict'
import { DAEMON_FEATURES, DAEMON_PROTOCOL, daemonCompatibilityWarning, type DaemonStatus } from '../lib/daemonProtocol'

const current: DaemonStatus = { name: 'agent-viewer', version: '0.1.0', protocol: DAEMON_PROTOCOL, features: [...DAEMON_FEATURES] }
assert.equal(daemonCompatibilityWarning(current), null, 'a current daemon is usable')
assert.equal(daemonCompatibilityWarning({ ...current, protocol: DAEMON_PROTOCOL + 5, features: [...DAEMON_FEATURES, 'future.thing'] }), null,
  'a newer daemon is usable: this client only asks for what it knows')
assert.match(daemonCompatibilityWarning(null) ?? '', /older than the TUI/, 'a daemon with no handshake is reported, not assumed good')
assert.match(daemonCompatibilityWarning({ ...current, protocol: DAEMON_PROTOCOL - 1 }) ?? '', new RegExp(`protocol ${DAEMON_PROTOCOL - 1}`))
assert.match(daemonCompatibilityWarning({ ...current, features: [] }) ?? '', /coordination\.interactive/, 'missing capabilities are named')
assert.equal(daemonCompatibilityWarning({ ...current, features: ['coordination.interactive'] }, ['coordination.interactive']), null,
  'a caller may require only what it uses')

// The route's shape is the contract; a client reads these three fields.
const route = await import('../app/api/version/route')
const payload = await (await route.GET()).json() as DaemonStatus
assert.equal(payload.name, 'agent-viewer')
assert.equal(payload.protocol, DAEMON_PROTOCOL)
assert.deepEqual(payload.features, [...DAEMON_FEATURES])
assert.equal(daemonCompatibilityWarning(payload), null, 'the route answers its own client')

console.log('Daemon protocol: current/newer/older/missing-capability handshake, route contract passed')

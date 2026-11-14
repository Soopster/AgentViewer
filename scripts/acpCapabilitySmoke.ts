// Pins how an ACP agent's advertisement is read.
//
// `lib/adapters/acp.ts` used to assume ACP could not list, load, delete or fork
// — the agents can, and the protocol gates each on an advertisement. Reading
// that advertisement wrong fails in both directions and both are quiet:
//
//   read as unsupported when it is  -> the provider silently stays transient,
//                                      exactly the bug this replaced
//   read as supported when it isn't -> every op fails at its first call, and
//                                      the sidebar fills with sessions that
//                                      open empty
//
// The schema's shape is the trap: session capabilities are `{}`-means-yes and
// absent-or-null-means-no, so `Boolean(caps.list)` is right for `{}` and wrong
// for `null` only if you forget that `null` is a legal value the agents
// actually send. These are pure classification checks — no subprocess.
import assert from 'node:assert/strict'
import { readAcpAgentSupport } from '../lib/acpCapabilities'

type Caps = Parameters<typeof readAcpAgentSupport>[0]

// --- nothing advertised ----------------------------------------------------
// An older agent sends no capabilities at all. Every flag must be false, or the
// adapter calls methods the agent has never heard of.
for (const empty of [undefined, null, {} as Caps]) {
  const support = readAcpAgentSupport(empty)
  assert.deepEqual(support, {
    loadSession: false,
    listSessions: false,
    resumeSession: false,
    deleteSession: false,
    forkSession: false,
  }, `an agent advertising ${JSON.stringify(empty)} must support nothing`)
}

// --- `{}` means yes --------------------------------------------------------
// This is the whole subtlety. An empty object is the schema's way of saying
// "supported", so a truthiness check on the VALUE is not enough — the presence
// of the key is the signal.
const claudeLike = readAcpAgentSupport({
  loadSession: true,
  sessionCapabilities: { list: {}, delete: {}, fork: {}, resume: {}, close: {} },
} as Caps)
assert.deepEqual(claudeLike, {
  loadSession: true,
  listSessions: true,
  resumeSession: true,
  deleteSession: true,
  forkSession: true,
}, 'claude-agent-acp 0.70.0 advertises all five')

// --- `null` and absent both mean no ---------------------------------------
// Both spellings appear in the schema, and treating either as support would
// make the op fail at its first call instead of staying unavailable.
const partial = readAcpAgentSupport({
  loadSession: true,
  sessionCapabilities: { list: {}, delete: null, resume: {} },
} as Caps)
assert.equal(partial.listSessions, true)
assert.equal(partial.resumeSession, true)
assert.equal(partial.deleteSession, false, 'an explicit null must read as unsupported')
assert.equal(partial.forkSession, false, 'an absent key must read as unsupported')

// codex-acp 1.6.2 exactly: everything claude has except fork.
const codexLike = readAcpAgentSupport({
  loadSession: true,
  sessionCapabilities: { resume: {}, list: {}, close: {}, delete: {}, additionalDirectories: {} },
} as Caps)
assert.equal(codexLike.forkSession, false, 'codex-acp does not advertise fork')
assert.equal(codexLike.listSessions, true)
assert.equal(codexLike.loadSession, true)

// --- loadSession is a boolean, not a presence check ------------------------
// Unlike the session capabilities it is declared `loadSession?: boolean`, so
// `false` must read as false. Applying the presence rule here would report
// support for an agent that explicitly denied it.
assert.equal(readAcpAgentSupport({ loadSession: false } as Caps).loadSession, false)
assert.equal(readAcpAgentSupport({ loadSession: true } as Caps).loadSession, true)

// --- session capabilities are independent of loadSession -------------------
// An agent may enumerate without replaying. Listing is gated on replay
// separately (see verifyAcpHistoryReadable) precisely because these two can
// disagree, so the reader must not fold one into the other.
const listOnly = readAcpAgentSupport({ sessionCapabilities: { list: {} } } as Caps)
assert.equal(listOnly.listSessions, true)
assert.equal(listOnly.loadSession, false, 'list must not imply load')

console.log('ACP capability smoke passed (absent/null/{} semantics, per-agent shapes, load vs list independence)')

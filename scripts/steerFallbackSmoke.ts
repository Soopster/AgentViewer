import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'steer-fallback-')))
const { setRunningSession, clearRunningSession } = await import('../lib/sessionRuntime')
const { runViewSessionAction } = await import('../lib/sessionBackend')

async function steer(provider: 'claude-acp' | 'codex', withSteer: boolean) {
  let interrupts = 0
  let steers = 0
  setRunningSession('s1', {
    provider,
    requestId: 't1',
    interrupt: async () => { interrupts += 1 },
    ...(withSteer ? { steer: async () => { steers += 1 } } : {}),
  })
  try {
    const result = await runViewSessionAction({ sessionId: 's1', provider, body: { action: 'steer', message: 'also do X', turnRequestId: 't1' } })
    return { result, interrupts, steers }
  } finally {
    clearRunningSession('s1')
  }
}

// A runtime with no mid-turn input ends the turn, and says the message was not delivered so the caller queues it.
const acp = await steer('claude-acp', false)
assert.deepEqual(acp.result, { delivered: false, interrupted: true })
assert.equal(acp.interrupts, 1)

// A runtime that steers natively is never interrupted.
const native = await steer('codex', true)
assert.equal(native.result.delivered, true)
assert.equal(native.interrupts, 0)
assert.equal(native.steers, 1)
console.log('steer fallback smoke: ok')
process.exit(0)

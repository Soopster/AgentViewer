import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import { BroadcastDeliveryError } from './windowBroadcast'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }
let running = false
let delivered = true
let unknown = false
let responseStatus = 200
let streamCalls = 0
let steerCalls = 0
const session: Session = { sessionId: 'old-session', provider: 'codex', providerInstanceId: 'second-account', cwd: '/project', lastModified: 1 }
mock.module('../../lib/tui/service', () => ({
  listTuiRunningSessions: async () => running ? [{ sessionId: session.sessionId, provider: session.provider }] : [],
  runTuiSessionAction: async (target: Session, body: Record<string, unknown>) => {
    steerCalls += 1
    assert.equal(target.providerInstanceId, 'second-account')
    assert.equal(body.allowInterrupt, false)
    assert.equal(body.steerRequestId, 'request-1')
    return { delivered, deliveryUncertain: unknown }
  },
  streamTuiSessionTurn: async (target: Session, body: Record<string, unknown>) => {
    streamCalls += 1
    assert.equal(target.sessionId, 'old-session')
    assert.equal(target.providerInstanceId, 'second-account')
    assert.equal(body.message, 'hello')
    assert.equal(body.approvalPolicy, 'on-request')
    assert.equal(body.detachOnClientAbort, true)
    assert.equal(body.turnRequestId, 'request-1')
    return responseStatus === 200 ? new Response('event: turn-accepted\ndata: {}\n\n') : Response.json({ error: 'Rejected' }, { status: responseStatus })
  },
}))
const { sendWindowBroadcastPrompt } = await import('./windowBroadcastDelivery')
const send = () => sendWindowBroadcastPrompt(session, 'hello', 'request-1', { approvalPolicy: 'on-request' })
assert.equal((await send()).mode, 'started')
running = true
assert.equal((await send()).mode, 'steered')
assert.equal(streamCalls, 1, 'steering must not start a competing turn')
delivered = false
await assert.rejects(send(), (error: unknown) => error instanceof BroadcastDeliveryError && !error.uncertain)
unknown = true
await assert.rejects(send(), (error: unknown) => error instanceof BroadcastDeliveryError && error.uncertain)
assert.equal(streamCalls, 1, 'a refused or uncertain steer must not fall through to a new turn')
running = false
responseStatus = 409
await assert.rejects(send(), (error: unknown) => error instanceof BroadcastDeliveryError && !error.uncertain)
assert.equal(steerCalls, 3)
console.log('Broadcast delivery preserves account/settings, waits for acceptance, and never restarts a busy target.')

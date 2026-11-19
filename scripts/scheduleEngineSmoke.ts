import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const dir = process.env.AGENT_VIEWER_SCHEDULES_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'schedules-smoke-'))
process.env.AGENT_VIEWER_SCHEDULES_DIR = dir

const { acquireScheduleLease, runScheduleTick, setScheduleRunner, SCHEDULE_TICK_MS } = await import('../lib/schedules/engine')
const { readScheduleState, updateScheduleState } = await import('../lib/schedules/store')
import type { Schedule } from '../lib/schedules/types'

if (process.argv[2] === 'lease-child') {
  process.stdout.write(acquireScheduleLease() ? 'owner' : 'denied')
  process.exit(0)
}

const base = (id: string, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  name: id,
  trigger: { kind: 'every', amount: 1, unit: 'm' },
  action: { kind: 'new-session', provider: 'claude', cwd: '/tmp' },
  prompt: 'hi',
  overlap: 'skip',
  catchUp: 'once',
  enabled: true,
  createdAt: 0,
  ...patch,
})

const fired: string[] = []
setScheduleRunner(async schedule => {
  fired.push(schedule.id)
  return schedule.id === 'boom' ? { outcome: 'failed', error: 'nope' } : { outcome: 'ok', sessionId: 's1' }
})
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
const T = 1_000_000_000_000

// First tick only plans; nothing fires.
updateScheduleState(state => { state.schedules.push(base('a'), base('boom'), base('stale', { catchUp: 'skip' }), base('exp', { expiresAt: T - 1 }), base('off', { enabled: false })) })
await runScheduleTick(T)
assert.deepEqual(fired, [], 'a fresh schedule is planned, not fired')
const planned = readScheduleState().schedules
assert.equal(planned.find(s => s.id === 'a')!.nextRunAt, T + 60_000)
assert.equal(planned.find(s => s.id === 'exp')!.enabled, false, 'an expired schedule disables itself')

// Due: fires once, advances, records a run.
await runScheduleTick(T + 60_000)
await settle()
assert.deepEqual(fired.sort(), ['a', 'boom', 'stale'].sort())
assert.equal(readScheduleState().schedules.find(s => s.id === 'a')!.nextRunAt, T + 120_000)
assert.equal(readScheduleState().runs.filter(r => r.scheduleId === 'a' && r.outcome === 'ok').length, 1)
assert.equal(readScheduleState().runs.find(r => r.scheduleId === 'boom')!.outcome, 'failed')

// Re-ticking the same instant does not double-fire.
fired.length = 0
await runScheduleTick(T + 60_000)
await settle()
assert.deepEqual(fired, [])

// Catch-up: missed by many ticks. 'once' fires once; 'skip' only records a skip.
fired.length = 0
const late = T + 60_000 + SCHEDULE_TICK_MS * 10 + 5 * 60_000
await runScheduleTick(late)
await settle()
assert.ok((fired as string[]).includes('a'), 'catchUp once fires a missed run')
assert.equal((fired as string[]).filter(id => id === 'a').length, 1, 'and only once')
assert.ok(!(fired as string[]).includes('stale'), 'catchUp skip does not fire')
assert.equal(readScheduleState().runs.filter(r => r.scheduleId === 'stale').at(-1)!.outcome, 'skipped')

// Lease: a live second process is denied; this one still owns it.
assert.equal(acquireScheduleLease(), true)
const child = spawnSync(process.execPath, [process.argv[1]!, 'lease-child'], { env: process.env, encoding: 'utf-8' })
assert.equal(child.stdout, 'denied', 'a second process must not fire while the lease is held')
// A stale heartbeat is taken over.
writeFileSync(path.join(dir, 'schedules.lease.json'), JSON.stringify({ pid: process.pid + 99999, heartbeat: 1 }))
const takeover = spawnSync(process.execPath, [process.argv[1]!, 'lease-child'], { env: process.env, encoding: 'utf-8' })
assert.equal(takeover.stdout, 'owner', 'a stale lease is taken over')

// Seconds-level wake and one-offs.
const { nextWakeDelay } = await import('../lib/schedules/engine')
const wakeNow = Date.now()
updateScheduleState(state => {
  state.schedules = [base('fast', { trigger: { kind: 'every', amount: 10, unit: 's' }, nextRunAt: wakeNow + 4000 })]
})
assert.ok(nextWakeDelay(wakeNow) >= 3900 && nextWakeDelay(wakeNow) <= 4000, 'wakes for the nearest due schedule, not a fixed tick')
updateScheduleState(state => { state.schedules = [base('idle', { nextRunAt: wakeNow + 3_600_000 })] })
assert.equal(nextWakeDelay(wakeNow), SCHEDULE_TICK_MS, 'never sleeps past a tick')
updateScheduleState(state => { state.schedules = [base('due', { nextRunAt: wakeNow - 5000 })] })
assert.equal(nextWakeDelay(wakeNow), 1000, 'never spins faster than once a second')
fired.length = 0
const at = wakeNow + 1000
updateScheduleState(state => { state.schedules = [base('once', { trigger: { kind: 'at', at }, nextRunAt: at })] })
await runScheduleTick(at)
await settle()
assert.deepEqual(fired, ['once'], 'a one-off fires')
assert.equal(readScheduleState().schedules[0]!.enabled, false, 'and turns itself off')
fired.length = 0
await runScheduleTick(at + 120_000)
await settle()
assert.deepEqual(fired, [], 'and never fires again')

// Kill switch.
process.env.AGENT_VIEWER_SCHEDULES = '0'
assert.deepEqual(await runScheduleTick(late + 10 * 60_000), [])
console.log('scheduleEngineSmoke ok')

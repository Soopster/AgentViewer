import assert from 'node:assert/strict'
import { describeTrigger, nextCronFire, nextTriggerFire, parseEvery, validateTrigger } from '../lib/schedules/cron'

const iso = (value: string) => Date.parse(value)
const fire = (expression: string, after: string, zone = 'UTC') => {
  const next = nextCronFire(expression, iso(after), zone)
  return next === null ? null : new Date(next).toISOString()
}

// Table of known next-fire times (UTC).
assert.equal(fire('* * * * *', '2026-03-01T10:00:30Z'), '2026-03-01T10:01:00.000Z')
assert.equal(fire('*/15 * * * *', '2026-03-01T10:00:00Z'), '2026-03-01T10:15:00.000Z')
assert.equal(fire('0 9 * * 1-5', '2026-03-06T09:00:00Z'), '2026-03-09T09:00:00.000Z') // Fri -> Mon
assert.equal(fire('30 2 29 2 *', '2026-01-01T00:00:00Z'), '2028-02-29T02:30:00.000Z')
assert.equal(fire('0 0 1 jan *', '2026-01-01T00:00:00Z'), '2027-01-01T00:00:00.000Z')
assert.equal(fire('0 12 * * 7', '2026-03-01T00:00:00Z'), '2026-03-01T12:00:00.000Z') // 7 = Sunday
// Day-of-month OR weekday when both restricted.
assert.equal(fire('0 0 13 * 5', '2026-03-01T00:00:00Z'), '2026-03-06T00:00:00.000Z')

// DST: America/New_York spring forward 2026-03-08 02:00 -> 03:00; 02:30 does not exist.
assert.equal(fire('30 2 * * *', '2026-03-07T12:00:00Z', 'America/New_York'), '2026-03-09T06:30:00.000Z')
// Fall back 2026-11-01: 01:30 happens twice; fires once, first occurrence (EDT, 05:30Z).
assert.equal(fire('30 1 * * *', '2026-11-01T00:00:00Z', 'America/New_York'), '2026-11-01T05:30:00.000Z')
assert.equal(fire('30 1 * * *', '2026-11-01T05:30:00Z', 'America/New_York'), '2026-11-02T06:30:00.000Z')
// Sydney spring forward 2026-10-04 02:00 -> 03:00.
assert.equal(fire('0 9 * * *', '2026-10-02T23:00:00Z', 'Australia/Sydney'), '2026-10-03T22:00:00.000Z') // 09:00 AEST then 09:00 AEDT, 23h apart

// Validation.
for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '5-1 * * * *', '*/0 * * * *', 'a b c d e']) {
  assert.ok(validateTrigger({ kind: 'cron', expression: bad }), `rejects "${bad}"`)
}
assert.ok(validateTrigger({ kind: 'cron', expression: '* * * * *', timeZone: 'Nope/Zone' }))
assert.equal(validateTrigger({ kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC' }), null)

// every.
assert.deepEqual(parseEvery('every 1h'), { kind: 'every', amount: 1, unit: 'h' })
assert.equal(parseEvery('every 0m'), null)
assert.equal(nextTriggerFire({ kind: 'every', amount: 30, unit: 'm' }, 1000), 1000 + 30 * 60_000)
assert.equal(describeTrigger({ kind: 'every', amount: 2, unit: 'h' }), 'every 2 hours')
console.log('scheduleCronSmoke ok')

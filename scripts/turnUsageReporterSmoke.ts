// The `turn-usage` frame is the composer status line's live token counter, and
// every provider feeds it from a differently-shaped source. This pins what the
// frame means, so no provider can drift back to emitting a delta (which is how
// the Claude counter used to inflate all turn — see claudeTurnUsageSmoke.ts).
import assert from 'node:assert/strict'
import { createTurnUsageReporter } from '../lib/sessionBackend'

const collect = (drive: (report: (value: number | null | undefined) => void) => void): number[] => {
  const frames: string[] = []
  drive(createTurnUsageReporter((chunk) => frames.push(chunk)))
  return frames.map((frame) => {
    assert.match(frame, /^event: turn-usage\n/, `unexpected frame: ${JSON.stringify(frame)}`)
    const line = frame.split('\n').find((candidate) => candidate.startsWith('data: '))
    assert.ok(line, `turn-usage frame carried no data line: ${JSON.stringify(frame)}`)
    return (JSON.parse(line.slice('data: '.length)) as { outputTokens: number }).outputTokens
  })
}

// Totals are absolute: the client assigns them, so a rising total reports the
// running figure rather than the increment.
assert.deepEqual(collect((report) => { for (const value of [10, 25, 40]) report(value) }), [10, 25, 40])

// An unchanged total costs nothing — no SSE frame, no status-line re-render.
// Codex and OpenCode both re-report usage on events that often carry no new
// tokens, so this suppression is load-bearing, not cosmetic.
assert.deepEqual(collect((report) => { for (const value of [40, 40, 40, 70, 70]) report(value) }), [40, 70])

// The first report is emitted even when it is zero — the counter appearing at
// 0 is meaningful, and -1 must not be mistaken for "already sent 0".
assert.deepEqual(collect((report) => { report(0); report(0); report(5) }), [0, 5])

// Providers must never be able to publish a negative or fractional counter.
assert.deepEqual(collect((report) => { report(-12) }), [0])
assert.deepEqual(collect((report) => { report(41.9) }), [41])

// Missing or malformed usage is skipped rather than rendering NaN/null into
// the status line — several providers report usage optionally.
assert.deepEqual(
  collect((report) => {
    report(undefined)
    report(null)
    report(Number.NaN)
    report(Number.POSITIVE_INFINITY)
    report('40' as unknown as number)
    report(40)
  }),
  [40],
)

// Reporters are per-stream: two concurrent turns must not suppress each
// other's frames through shared state.
{
  const a: string[] = []
  const b: string[] = []
  const reportA = createTurnUsageReporter((chunk) => a.push(chunk))
  const reportB = createTurnUsageReporter((chunk) => b.push(chunk))
  reportA(40)
  reportB(40)
  assert.equal(a.length, 1, 'first reporter emitted nothing')
  assert.equal(b.length, 1, 'second reporter was suppressed by the first')
}

console.log('Shared turn-usage reporter smoke passed')

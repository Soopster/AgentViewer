// The reader's first focus expands the preview's cards without moving what the
// reader is looking at: staged from the bottom at the tail (the bottom stays
// pinned through every stage), and anchored in one commit when the preview was
// scrolled up (the row at the top stays where it was).
//
// Drives the real App on inputPerf's realistic fixture, through the harness's
// INPUT_FOCUS_TRACE modes, and reads the per-frame trace they print. Without the
// anchor the scrolled-up trace jumps 132 cards in one frame, which is how this
// was verified to fail.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const harness = fileURLToPath(new URL('./inputPerf.tsx', import.meta.url))
const trace = (mode: string) => {
  const run = spawnSync('bun', [harness], {
    env: { ...process.env, INPUT_CHILD: '1', INPUT_SCENARIO: 'focus-toggle', INPUT_SECONDS: '1', INPUT_FOCUS_TRACE: mode },
    encoding: 'utf8',
    timeout: 240_000,
  })
  const line = `${run.stdout}${run.stderr}`.split('\n').find((text) => text.startsWith('FOCUS TRACE'))
  assert.ok(line, `no focus trace for ${mode} (exit ${run.status})`)
  return line
}

const tail = trace('1')
const distances = tail.split(':').pop()!.trim().split(',').map(Number)
assert.ok(distances.length >= 20 && distances.every((distance) => distance === 0), `the bottom moved during a staged first focus: ${tail}`)

const detached = trace('detached')
const match = detached.match(/before (\S+) frames (.+)$/)
assert.ok(match, detached)
assert.deepEqual(match[2].trim().split(' '), [match[1]], `the view moved during a scrolled-up first focus: ${detached}`)

console.log(`Reader first-focus smoke passed (tail pinned over ${distances.length} frames; scrolled-up view held at ${match[1]})`)

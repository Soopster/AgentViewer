import assert from 'node:assert/strict'

import {
  compareComposerBenchmarks,
  parseComposerBenchmarkSummaries,
  type ComposerBenchmarkSummary,
} from '../lib/composerBenchmarkComparison'

const viewer: ComposerBenchmarkSummary = {
  type: 'summary',
  surface: 'agentviewer',
  provider: 'codex',
  runs: 5,
  successes: 5,
  failures: 0,
  firstEventP95Ms: 1_100,
  completionP95Ms: 3_200,
  ackP95Ms: 4,
}
const native: ComposerBenchmarkSummary = {
  type: 'summary',
  surface: 'native-cli',
  provider: 'codex',
  runs: 5,
  successes: 5,
  failures: 0,
  firstEventP95Ms: 1_000,
  completionP95Ms: 3_000,
}

const mixedOutput = `npm prefix noise\n${JSON.stringify({ type: 'sample' })}\n${JSON.stringify(viewer)}\n`
assert.deepEqual(parseComposerBenchmarkSummaries(mixedOutput), [viewer])
assert.equal(compareComposerBenchmarks([viewer], [native])[0]?.passed, true)

const slow = { ...viewer, firstEventP95Ms: 1_500 }
const slowComparison = compareComposerBenchmarks([slow], [native])[0]!
assert.equal(slowComparison.passed, false)
assert.match(slowComparison.reasons.join(' '), /first-event p95/)

const unreliable = { ...viewer, successes: 4, failures: 1 }
const unreliableComparison = compareComposerBenchmarks([unreliable], [native])[0]!
assert.equal(unreliableComparison.passed, false)
assert.match(unreliableComparison.reasons.join(' '), /success rate/)

assert.throws(() => compareComposerBenchmarks([viewer], []), /Missing native CLI summary/)
console.log('Composer native-parity benchmark comparison passed')

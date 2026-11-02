import assert from 'node:assert/strict'
import { estimateSessionCostUsd } from '../../lib/analytics'
const m = (id: string | undefined, usage: object | undefined, type = 'assistant') => ({ type, message: { id, model: 'claude-sonnet-4-5', usage } })
// 1M in + 1M out at sonnet-4 list price ($3 / $15) = $18, counted once for a repeated API id.
const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 }
assert.equal(estimateSessionCostUsd([m('a', usage), m('a', usage)]), 18)
assert.equal(estimateSessionCostUsd([m('a', usage), m('b', usage)]), 36)
assert.equal(estimateSessionCostUsd([m('a', undefined), m(undefined, usage, 'user')]), null, 'no usage is unknown, not free')
assert.equal(estimateSessionCostUsd([m('a', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })]), 0.3)
console.log('sessionCostSmoke ok')

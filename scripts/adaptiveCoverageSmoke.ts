// A card that looks right on the payload it was designed against can read most fields as empty on real ones.
// Coverage says so, and samples are kept as valid JSON so the check has something real to read.
import assert from 'node:assert/strict'
import { ruleCoverage, sampleCalls } from '../lib/adaptiveUi/coverage'
import { parseCardRule } from '../lib/plugins/cardTemplates'
import { redactResultText, SHAPE_LIMITS } from '../lib/adaptiveUi/shapes'

const rule = parseCardRule({ id: 'c', status: 'draft', match: { tool: 'mcp__a__b' }, title: '{{input.id}} · {{result.json.title}}', blocks: [{ type: 'kv', rows: [['Owner', '{{result.json.owner.name | default none}}']] }],
  samples: [{ input: { id: 'A' }, result: { text: '{"title":"One","owner":{"name":"Ada"}}' } }, { input: { id: 'B' }, result: { text: '{"title":"Two"}' } }, { input: { id: 'C' } }] }).rule!
const cov = ruleCoverage(rule, sampleCalls(rule))
assert.deepEqual(cov.bindings.map(b => [b.path, b.checked, b.empty]), [['input.id', 3, 0], ['result.json.title', 2, 0], ['result.json.owner.name', 2, 1]], 'a call still running says nothing about result bindings')
assert.deepEqual(cov.warnings, ['result.json.owner.name is empty in 1 of 2 samples'])
// Not JSON at all: one clear message instead of every field being "empty".
const text = parseCardRule({ ...rule, samples: [{ input: { id: 'A' }, result: { text: 'plain words' } }, { input: { id: 'B' }, result: { text: 'more words' } }] }).rule!
assert.deepEqual(ruleCoverage(text, sampleCalls(text)).warnings, ['the result is not JSON in all 2 samples, so every result.json field reads empty: use result.text'])
// Some JSON, some not.
const mixed = parseCardRule({ ...rule, samples: [{ input: { id: 'A' }, result: { text: '{"title":"x","owner":{"name":"y"}}' } }, { input: { id: 'B' }, result: { text: 'oops' } }] }).rule!
assert.ok(ruleCoverage(mixed, sampleCalls(mixed)).warnings[0]!.includes('not JSON in 1 of 2'))
// A rule that reads everything it reads has nothing to say; one with no samples is not accused.
const full = parseCardRule({ ...rule, samples: [{ input: { id: 'A' }, result: { text: '{"title":"x","owner":{"name":"y"}}' } }] }).rule!
assert.deepEqual(ruleCoverage(full, sampleCalls(full)).warnings, [])
assert.deepEqual(ruleCoverage(parseCardRule({ ...rule, samples: undefined }).rule!, []).warnings, [])
// Static card: nothing read, nothing missing.
assert.deepEqual(ruleCoverage(parseCardRule({ id: 's', status: 'draft', match: { tool: 'x' }, title: 'static', blocks: [] }).rule!, []).bindings, [])

// Samples stay JSON: a large structured result is thinned, never cut mid-object, and secrets are gone.
const wide = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`field${i}`, 'v'.repeat(300)]))
const big = JSON.stringify({ task: { id: 't1', title: 'x'.repeat(500), status: 'completed', owner: { id: 'a', token: 'SECRET-VALUE' }, files: Array.from({ length: 40 }, (_, i) => ({ path: `f${i}`, diff: 'd'.repeat(300) })) }, run: { id: 'r', apiKey: 'SECRET-2' }, ...wide })
const kept = redactResultText(big)
assert.ok(JSON.stringify(wide).length > 3 * SHAPE_LIMITS.resultChars, 'the fixture needs thinning'); assert.ok(kept.length <= SHAPE_LIMITS.resultChars); assert.doesNotThrow(() => JSON.parse(kept), 'a thinned sample is still valid JSON')
assert.ok(!kept.includes('SECRET'), 'secrets are redacted'); assert.equal(JSON.parse(kept).task.status, 'completed', 'the structure a card is designed against survives')
assert.equal(redactResultText('plain '.repeat(1000)).length, SHAPE_LIMITS.resultChars, 'text that is not JSON keeps a prefix')
assert.equal(redactResultText('{ not json'), '{ not json')
console.log('adaptiveCoverageSmoke: ok')

import assert from 'node:assert/strict'
import { proofFixPrompt, proofFreshness, proofSummary, type ProofCheck, type ProofResult, type ProofSnapshot } from '../lib/plugins/proof'
import { proofKeyAction } from '../plugins/proof/keys'
const key = { name: 'r', sequence: 'r', ctrl: false, shift: false }
assert.equal(proofKeyAction(key, 'normal'), 'run')
assert.equal(proofKeyAction({ ...key, ctrl: true }, 'normal'), null)
assert.equal(proofKeyAction(key, 'editor'), null)
assert.equal(proofKeyAction({ ...key, name: 's', ctrl: true }, 'editor'), 'save')
const check: ProofCheck = { id: 'types', label: 'TypeScript', executable: 'node', args: ['-e', 'process.exit(0)'], cwd: '.', timeoutMs: 5000 }
const result: ProofResult = { check, status: 'passed', before: 'same', after: 'same' }
const state: ProofSnapshot = { cwd: '/repo', config: { version: 'v1', checks: [check] }, suggestions: [], fingerprint: 'same', runs: [{ id: 'run', cwd: '/repo', createdAt: 1, finishedAt: 2, configVersion: 'v1', results: [result] }] }
assert.equal(proofSummary(state), 'passed')
assert.equal(proofFreshness(result, { ...state, fingerprint: 'other' }), 'stale')
assert.equal(proofFreshness({ ...result, after: 'changed' }, state), 'unstable')
assert.equal(proofFreshness(result, { ...state, fingerprint: null }), 'unknown')
assert.equal(proofFreshness(result, { ...state, config: { version: 'v2', checks: [{ ...check, args: ['different'] }] } }), 'stale')
assert.equal(proofSummary({ ...state, runs: [] }), 'unchecked')
assert.equal(proofSummary({ ...state, config: { ...state.config, checks: [check, { ...check, id: 'browser' }] } }), 'partially checked')
assert.equal(proofSummary({ ...state, runs: [{ ...state.runs[0], finishedAt: undefined }] }), 'running')
assert.equal(proofSummary({ ...state, runs: [{ ...state.runs[0], results: [{ ...result, status: 'failed' }] }] }), 'failed')
const prompt = proofFixPrompt(state.runs[0], { ...result, status: 'failed' }, 'stale', 'x'.repeat(20_000))
assert(prompt.includes('stale') && prompt.length < 13_000 && prompt.includes('/repo'))
console.log('Proof rules: PASS (coverage, current/stale/unstable/unknown evidence, definition changes, bounded fix prompt)')

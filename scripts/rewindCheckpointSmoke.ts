// A rewind that restores files must restore THIS prompt's files. Repeated prompts are the trap.
import assert from 'node:assert/strict'
import type { TurnCheckpoint } from '../lib/checkpoints'
import { checkpointForPrompt, REWIND_CHECKPOINT_WINDOW_MS } from '../lib/rewindCheckpoint'

const T = Date.parse('2026-10-04T09:00:00Z')
const ck = (sha: string, createdAt: number, label: string, sessionId = 's1'): TurnCheckpoint => ({ ref: `r-${sha}`, sha, createdAt, label, sessionId })
const list = [
  ck('late', T + 3_600_000, 'continue'),
  ck('mid', T + 1_800_000, 'continue'),
  ck('early', T, 'continue'),
  ck('other', T, 'something else'),
  ck('foreign', T, 'continue', 's2'),
]
const at = (ms: number) => new Date(ms).toISOString()

assert.equal(checkpointForPrompt(list, { sessionId: 's1', text: 'continue', timestamp: at(T + 2_000) })?.sha, 'early')
assert.equal(checkpointForPrompt(list, { sessionId: 's1', text: 'continue', timestamp: at(T + 1_800_500) })?.sha, 'mid', 'the same words later resolve by time, not label')
assert.equal(checkpointForPrompt(list, { sessionId: 's1', text: 'continue\nmore detail', timestamp: at(T) })?.sha, 'early', 'matches on the first line')
assert.equal(checkpointForPrompt(list, { sessionId: 's1', text: 'continue', timestamp: at(T + 900_000) }), null, 'nothing near enough means no restore, not the nearest guess')
assert.equal(checkpointForPrompt(list, { sessionId: 's1', text: 'continue' }), null, 'no timestamp, no match')
assert.equal(checkpointForPrompt(list, { sessionId: 's3', text: 'continue', timestamp: at(T) }), null, 'another session\'s checkpoint is never used')
assert.ok(REWIND_CHECKPOINT_WINDOW_MS < 1_800_000)
console.log('rewind checkpoint smoke: ok')

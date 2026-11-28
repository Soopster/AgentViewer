import assert from 'node:assert/strict'
import type { ThreadedMessage } from '../../lib/threading'
import { createLiveTextBatch } from './liveTextBatch'
import { upsertThreadedMessage } from './liveTranscriptState'
import { resolveRenderPolicy } from './renderPolicy'

const message = (uuid: string, text: string, sessionId = 'a', provider: 'claude' | 'codex' = 'claude'): ThreadedMessage => ({
  uuid, sessionId, provider, role: 'assistant', blocks: [{ type: 'text', text }],
})
let state: ThreadedMessage[] = []
let publishes = 0
const batch = createLiveTextBatch(update => { state = update(state); publishes++ }, 10)
// Interleaved blocks, replacements, and colliding provider/session UUIDs.
const input = [message('one', 'a'), message('two', 'b'), message('one', 'abc'),
  message('one', 'other session', 'b'), message('one', 'other provider', 'a', 'codex')]
for (const next of input) batch.push(next)
assert.equal(publishes, 0)
batch.flush()
assert.equal(publishes, 1)
assert.deepEqual(state, input.reduce(upsertThreadedMessage, [] as ThreadedMessage[]))
// Flush at the tool boundary, then continue an earlier block without moving it.
batch.push(message('three', 'before tool'))
batch.flush()
state = upsertThreadedMessage(state, message('tool', 'tool result'))
batch.push(message('three', 'continued'))
await new Promise(resolve => setTimeout(resolve, 30))
assert.deepEqual(state.map(item => item.uuid), ['one', 'two', 'one', 'one', 'three', 'tool'])
assert.deepEqual(state[4].blocks, [{ type: 'text', text: 'continued' }])
// A canceled/failed send cannot publish later, including after an explicit flush.
const before = publishes
batch.push(message('canceled', 'must not appear'))
batch.cancel()
batch.flush()
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(publishes, before)
assert(!state.some(item => item.uuid === 'canceled'))
assert.deepEqual(resolveRenderPolicy('win32', {}), { maxFps: 60, liveTextFlushMs: 34 })
assert.deepEqual(resolveRenderPolicy('darwin', {}), { maxFps: 120, liveTextFlushMs: 16 })
assert.deepEqual(resolveRenderPolicy('linux', { WT_SESSION: 'windows-terminal-profile' }), { maxFps: 60, liveTextFlushMs: 34 })
assert.deepEqual(resolveRenderPolicy('linux', { WT_SESSION: ' ' }), { maxFps: 120, liveTextFlushMs: 16 })
assert.deepEqual(resolveRenderPolicy('linux', { WT_SESSION: 'windows-terminal-profile', AGENT_VIEWER_TUI_MAX_FPS: '30' }), { maxFps: 30, liveTextFlushMs: 67 })
assert.deepEqual(resolveRenderPolicy('win32', { AGENT_VIEWER_TUI_MAX_FPS: '30' }), { maxFps: 30, liveTextFlushMs: 67 })
for (const invalid of ['', '0', '-1', 'Infinity', 'NaN', '999', '60junk']) {
  assert.equal(resolveRenderPolicy('win32', { AGENT_VIEWER_TUI_MAX_FPS: invalid }).maxFps, 60)
}
assert.equal(resolveRenderPolicy('linux', { AGENT_VIEWER_TUI_MAX_FPS: '90' }).maxFps, 90)
console.log('live text batch smoke passed (identity, ordering, timer, EOF flush, cancel, platform pacing)')

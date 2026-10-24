// A text block's deltas are coalesced for render cost, never held back: the
// coalescer must flush on a timer, or a reply under the spill size appears only
// when its block ends — i.e. it does not stream at all.
import assert from 'node:assert/strict'
import { createClaudeDeltaCoalescer } from '../lib/sessionBackend'

const frames: string[] = []
const coalescer = createClaudeDeltaCoalescer((chunk) => frames.push(chunk))
const delta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
}) as never

coalescer.emit(delta('1\n'))
coalescer.emit(delta('2\n'))
assert.equal(frames.length, 0, 'same-block deltas coalesce rather than forwarding one frame each')
await new Promise((resolve) => setTimeout(resolve, 120))
assert.equal(frames.length, 1, 'a pending delta must flush on its own, mid-block, without waiting for the block to end')
assert.match(frames[0]!, /1\\n2\\n/, 'the flushed frame carries the merged text')

coalescer.emit(delta('3\n'))
coalescer.flush()
await new Promise((resolve) => setTimeout(resolve, 120))
assert.equal(frames.length, 2, 'an explicit flush cancels the timer rather than emitting twice')

console.log('Claude delta flush smoke passed')
process.exit(0)

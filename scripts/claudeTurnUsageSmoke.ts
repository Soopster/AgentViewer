// Claude live output-token accounting: Anthropic reports `usage.output_tokens`
// on message_delta as the RUNNING TOTAL for the current message, and a turn
// holds several assistant messages once tools run. This pins the arithmetic
// that turns those cumulative per-message counts into one turn total — the
// number the composer status line shows next to the elapsed clock.
import assert from 'node:assert/strict'
import { createClaudeTurnUsageTracker } from '../lib/sessionBackend'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const totals = (frames: string[]): number[] => frames.map((frame) => {
  const line = frame.split('\n').find((candidate) => candidate.startsWith('data: '))
  assert.ok(line, `turn-usage frame carried no data line: ${JSON.stringify(frame)}`)
  assert.match(frame, /^event: turn-usage\n/, `unexpected frame: ${JSON.stringify(frame)}`)
  return (JSON.parse(line.slice('data: '.length)) as { outputTokens: number }).outputTokens
})

const streamEvent = (event: unknown, parentToolUseId: string | null = null): SDKMessage =>
  ({ type: 'stream_event', parent_tool_use_id: parentToolUseId, event } as unknown as SDKMessage)

const messageStart = (id: string) => streamEvent({ type: 'message_start', message: { id } })
const messageDelta = (outputTokens: number, parentToolUseId: string | null = null) =>
  streamEvent({ type: 'message_delta', usage: { output_tokens: outputTokens } }, parentToolUseId)

// One message reporting a growing running total must report that total, not
// its sum — the bug this replaces turned 10/25/40 into 75.
{
  const frames: string[] = []
  const track = createClaudeTurnUsageTracker((chunk) => frames.push(chunk))
  track(messageStart('msg_1'))
  for (const value of [10, 25, 40]) track(messageDelta(value))
  assert.deepEqual(totals(frames), [10, 25, 40], 'cumulative per-message counts must not be summed')
}

// A tool turn spans several assistant messages: each contributes its own final
// running total, so the turn total is the sum ACROSS messages.
{
  const frames: string[] = []
  const track = createClaudeTurnUsageTracker((chunk) => frames.push(chunk))
  track(messageStart('msg_1'))
  track(messageDelta(40))
  track(messageStart('msg_2'))
  track(messageDelta(5))
  track(messageDelta(30))
  assert.deepEqual(totals(frames), [40, 45, 70], 'each assistant message contributes its own final total')
}

// Subagent streams carry their own usage and must not inflate the main-loop
// counter the composer status line claims to show.
{
  const frames: string[] = []
  const track = createClaudeTurnUsageTracker((chunk) => frames.push(chunk))
  track(messageStart('msg_1'))
  track(messageDelta(40))
  track(messageDelta(900, 'toolu_subagent'))
  assert.deepEqual(totals(frames), [40], 'subagent usage must not reach the turn counter')
}

// An unchanged total emits nothing: the status line should not re-render on a
// message_delta that carries no new tokens.
{
  const frames: string[] = []
  const track = createClaudeTurnUsageTracker((chunk) => frames.push(chunk))
  track(messageStart('msg_1'))
  track(messageDelta(40))
  track(messageDelta(40))
  assert.deepEqual(totals(frames), [40], 'a repeated total must not re-emit')
}

// A message_delta with no preceding message_start overwrites its bucket rather
// than opening a new one — undercounting beats resurrecting the inflation bug.
{
  const frames: string[] = []
  const track = createClaudeTurnUsageTracker((chunk) => frames.push(chunk))
  track(messageDelta(10))
  track(messageDelta(25))
  assert.deepEqual(totals(frames), [10, 25], 'unkeyed deltas must accumulate as one message')
}

// Malformed usage is ignored rather than emitting NaN into the status line.
{
  const frames: string[] = []
  const track = createClaudeTurnUsageTracker((chunk) => frames.push(chunk))
  track(messageStart('msg_1'))
  track(streamEvent({ type: 'message_delta', usage: { output_tokens: 'lots' } }))
  track(streamEvent({ type: 'message_delta' }))
  track(streamEvent({ type: 'content_block_stop', index: 0 }))
  track({ type: 'assistant', message: { usage: { output_tokens: 99 } } } as unknown as SDKMessage)
  assert.deepEqual(frames, [], 'only well-formed main-loop message_delta usage counts')
}

console.log('Claude turn output-token accounting smoke passed')

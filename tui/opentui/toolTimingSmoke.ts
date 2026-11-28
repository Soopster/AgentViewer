// Tool timing: calls grouped by turn (newest first), bars scaled within the turn,
// and the Bash duration is read from the result the card was built from.
import assert from 'node:assert/strict'
import { timedTurns, durationBar } from '../../plugins/session-insights/tui/tool-timing/model'
import { formatTranscriptCard } from '../format'
import type { TuiTranscriptCard } from '../format'
import type { ThreadedMessage } from '../../lib/threading'

const card = (key: string, role: string, text: string, toolTimings?: unknown) => ({ key, role, category: 'technical', lines: [{ text, tone: 'default' }], toolTimings }) as unknown as TuiTranscriptCard
const turns = timedTurns([
  card('u1', 'user', 'First'), card('a', 'assistant', 'x', [{ name: 'Bash', label: 'sleep 1', durationMs: 1000 }, { name: 'Bash', label: 'bun test', durationMs: 4000 }]),
  card('u2', 'user', 'Second'), card('b', 'assistant', 'x'),
  card('u3', 'user', 'Third'), card('c', 'assistant', 'x', [{ name: 'Bash', label: 'tsc', durationMs: 50_000 }]),
])
assert.deepEqual(turns.map((turn) => turn.title), ['Third', 'First'], 'newest first; untimed turn dropped')
assert.deepEqual([turns[1]!.totalMs, turns[1]!.maxMs], [5000, 4000])
assert.equal(durationBar(4000, 4000, 8), '████████')
assert.equal(durationBar(1000, 4000, 8), '██░░░░░░')
assert.equal(durationBar(1, 4000, 8), '█░░░░░░░', 'a short call still shows one cell')

const message = {
  uuid: 'm', role: 'assistant', session_id: 's', timestamp: new Date().toISOString(),
  blocks: [{ type: 'tool_thread', toolUse: { id: 't', name: 'Bash', input: { command: 'bun test' } }, result: { tool_use_id: 't', content: 'ok\nduration_ms: 47000', is_error: false } }],
} as unknown as ThreadedMessage
const built = formatTranscriptCard(message)
assert.deepEqual(built.toolTimings, [{ name: 'Bash', label: 'bun test', durationMs: 47000 }])
assert.ok(built.lines.some((line) => line.tone === 'system' && line.text.includes('47s')), 'a 30s+ call is tinted')
console.log('Tool timing smoke passed (grouping, bars, card timings, slow tint)')

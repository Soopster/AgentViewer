// Session insights' shared half: the Web's tool-timing derivation from a raw
// transcript, and the Web service's requests (the TUI's goes in-process).
import assert from 'node:assert/strict'
import { timedTurnsFromMessages } from '../lib/plugins/sessionInsights'
import { createWebSessionInsightsService } from '../components/shell/sessionInsightsService'
import type { SessionMessage } from '../lib/types'

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 14, 9, 0, seconds)).toISOString()
const msg = (uuid: string, type: 'user' | 'assistant', content: unknown, seconds: number): SessionMessage => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: at(seconds), message: { role: type, content } } as SessionMessage)
const transcript = [
  msg('u1', 'user', 'run the tests', 0),
  msg('a1', 'assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a.ts' } }], 1),
  msg('r1', 'user', [{ type: 'tool_result', tool_use_id: 't2', content: 'x' }], 2),
  msg('r2', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], 13),
  msg('u2', 'user', 'thanks', 20),
  msg('a2', 'assistant', [{ type: 'text', text: 'done' }], 21),
  msg('u3', 'user', 'now lint', 30),
  msg('a3', 'assistant', [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm run lint' } }], 31),
  msg('r3', 'user', [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }], 34),
]
const turns = timedTurnsFromMessages(transcript)
assert.deepEqual(turns.map(turn => turn.title), ['now lint', 'run the tests'], 'newest first; a turn with no timed call is dropped')
assert.deepEqual(turns[1]!.calls, [{ label: 'Read a.ts', durationMs: 1000 }, { label: 'Bash npm test', durationMs: 12_000 }], 'a call lasts from its message to its result, in the order results land')
assert.equal(turns[1]!.totalMs, 13_000)
assert.equal(turns[1]!.maxMs, 12_000)
assert.equal(turns[0]!.calls[0]!.durationMs, 3000)
assert.deepEqual(timedTurnsFromMessages([msg('a', 'assistant', [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }], 1)]), [], 'a call with no result is not timed')
console.log('Tool timing: a call lasts from its request to its result, per turn, newest first; unanswered calls are not timed.')

const requests: string[] = []
const service = createWebSessionInsightsService((async (url: string) => {
  requests.push(String(url))
  return new Response(JSON.stringify(String(url).includes('provenance') ? { sessionId: 's', files: [], edits: [{ id: 1 }] } : { query: 'q', total: 0, results: [] }), { status: 200 })
}) as typeof fetch)
const provenance = await service.provenance({ provider: 'codex', sessionId: 's/1' })
assert.deepEqual(provenance.edits, [{ id: 1 }])
assert.equal((provenance.summary as unknown as { edits?: unknown }).edits, undefined, 'edits are split from the summary')
await service.search({ query: 'boom', limit: 25, provider: 'claude', hasError: true, touchedFile: 'a.ts', sinceMs: 5 })
assert.equal(requests[0], '/api/sessions/s%2F1/provenance?provider=codex&edits=1')
assert.match(requests[1]!, /^\/api\/session-index\/search\?q=boom&messagesOnly=0&limit=25&provider=claude&sinceMs=5&hasError=1&touchedFile=a\.ts$/)
console.log('Web service: provenance asks for the recorded edits; search carries every facet.')
console.log('Session insights smoke: PASS')

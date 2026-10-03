// /rewind lists only what the user typed, and returns to just before it.
// A wrong fork point is silent: Claude's fork is inclusive, so forking AT the
// prompt keeps the turn being rewound and the transcript looks unchanged.
import assert from 'node:assert/strict'
import type { SessionMessage } from '../lib/types'
import { forkPointBefore, rewindCandidates } from '../tui/opentui/rewindTargets'

const row = (uuid: string, type: 'user' | 'assistant', content: unknown, extra: Partial<SessionMessage> = {}): SessionMessage => ({
  type, uuid, session_id: 's', parent_tool_use_id: null, message: { role: type, content } as SessionMessage['message'], ...extra,
})

const raw = [
  row('u1', 'user', 'first prompt'),
  row('a1', 'assistant', [{ type: 'text', text: 'reply' }]),
  row('t1', 'user', [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }]),
  row('b1', 'user', '<bash-input>ls</bash-input>'),
  row('sub', 'user', 'subagent prompt', { parent_tool_use_id: 'task-1' } as unknown as Partial<SessionMessage>),
  row('u2', 'user', [{ type: 'text', text: 'second prompt' }]),
  row('a2', 'assistant', [{ type: 'text', text: 'reply 2' }]),
]

assert.deepEqual(rewindCandidates(raw).map((c) => c.uuid), ['u2', 'u1'],
  'newest first; tool results, ! rows and subagent prompts are not the user\'s prompts')
assert.equal(forkPointBefore(raw, 'u2'), 'b1', 'forks at the main-chain message just before the prompt')
assert.equal(forkPointBefore(raw, 'u1'), null, 'the opening prompt rewinds to a fresh session')
assert.equal(forkPointBefore(raw, 'missing'), undefined, 'an unknown prompt is reported, not guessed')

console.log('Rewind targets list typed prompts and fork just before them')

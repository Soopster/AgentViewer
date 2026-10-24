import assert from 'node:assert/strict'
import { buildContextHandoffPrompt, conversationTail } from '../lib/contextHandoff'
import type { SessionMessage } from '../lib/types'

const row = (uuid: string, type: 'user' | 'assistant' | 'system', content: unknown, extra: Partial<SessionMessage> = {}): SessionMessage => ({
  type, uuid, session_id: 's', parent_tool_use_id: null, message: { role: type, content } as SessionMessage['message'], ...extra,
})
const raw = [
  row('u1', 'user', 'add a retry to fetchThing'),
  row('a1', 'assistant', [{ type: 'tool_use', id: 't', name: 'Edit', input: { secret: 'TOOL_INPUT' } }, { type: 'text', text: 'Added exponential backoff.' }]),
  row('t1', 'user', [{ type: 'tool_result', tool_use_id: 't', content: 'TOOL_OUTPUT' }]),
  row('b1', 'user', '<bash-input>ls</bash-input>'),
  row('sub', 'user', 'SUBAGENT_PROMPT', { parent_tool_use_id: 'x' } as unknown as Partial<SessionMessage>),
  row('s1', 'system', 'SYSTEM_ROW'),
  row('u2', 'user', 'now the tests'),
]
const tail = conversationTail(raw)
assert.equal(tail, 'User: add a retry to fetchThing\n\nAssistant: Added exponential backoff.\n\nUser: now the tests')
for (const leaked of ['TOOL_INPUT', 'TOOL_OUTPUT', 'bash-input', 'SUBAGENT_PROMPT', 'SYSTEM_ROW']) assert.ok(!tail.includes(leaked), `${leaked} stays out of the handoff`)

// Bounded: a long conversation keeps the newest turns, and a huge message is cut.
const long = Array.from({ length: 80 }, (_, i) => row(`m${i}`, i % 2 ? 'assistant' : 'user', `turn ${i} ${'x'.repeat(2000)}`))
const bounded = conversationTail(long)
assert.ok(bounded.length < 12_000)
assert.ok(bounded.includes('turn 79') && !bounded.includes('turn 10 '), 'newest turns survive')
assert.ok(bounded.includes('…'), 'long messages are excerpted')

const prompt = buildContextHandoffPrompt({ fromProvider: 'claude', brief: '# Handoff Brief\n- Provider: `claude`', raw })
assert.ok(prompt.startsWith('You are continuing work that was started in a claude session'))
assert.ok(prompt.includes('# Handoff Brief') && prompt.includes('## Recent conversation'))
assert.equal(buildContextHandoffPrompt({ fromProvider: 'pi', brief: 'b', raw: [] }).includes('## Recent conversation'), false)
console.log('context handoff smoke: ok')

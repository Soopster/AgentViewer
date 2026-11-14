import assert from 'node:assert/strict'
import { aggregateMessages, mapPersistedMessages } from '../lib/session-index/messages'
import type { ApiMessage, SessionMessage } from '../lib/types'

const encoded = 'A'.repeat(1024)
const make = (uuid: string, payload: ApiMessage): SessionMessage => ({
  uuid, type: payload.role, session_id: 'session', providerInstanceId: 'work', parent_tool_use_id: null,
  timestamp: '2026-10-28T00:00:00Z', message: payload,
})
const messages: SessionMessage[] = [
  make('prompt', { role: 'user', content: [{ type: 'text', text: 'Fix the quasar function' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: encoded } }] }),
  make('duplicate', { role: 'assistant', content: [{ type: 'tool_use', id: 'failed-edit', name: 'Edit', input: { file_path: '/repo/file.ts', old_string: 'old', new_string: 'bad', data: encoded } }], usage: { input_tokens: 10, output_tokens: 5 } }),
  make('result', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'failed-edit', is_error: true, content: 'Edit failed' }] }),
  make('duplicate', { role: 'assistant', content: [{ type: 'tool_use', id: 'good-edit', name: 'Edit', input: { file_path: '/repo/file.ts', old_string: 'old', new_string: 'good' } }] }),
  { ...make('delegated', { role: 'user', content: 'Worker briefing' }), origin: { kind: 'subagent' }, timestamp: 'invalid' },
]
const records = mapPersistedMessages('claude', 'session', messages)
assert.equal(records[0].sessionKey, 'work:session', 'provider instance identity must be retained')
assert.ok(records.every(record => !record.text.includes(encoded)), 'image bytes must not enter searchable text')
assert.equal(new Set(records.map(record => record.key)).size, records.length, 'duplicate native UUIDs need distinct index keys')
assert.equal(records[1].key, 'work:session:duplicate')
assert.equal(records[3].key, 'work:session:duplicate:2')
assert.deepEqual(records[1].errorTools, ['Edit'])
assert.deepEqual(records[1].fileEdits, [], 'failed edits must not claim file provenance')
assert.equal(records[3].fileEdits.length, 1)
assert.deepEqual(records[3].fileEdits[0].addedLines, ['good'])
assert.equal(records[3].fileEdits[0].prompt, 'Fix the quasar function')
assert.equal(records[0].isPrompt, true)
assert.equal(records[2].isPrompt, false, 'tool results are not prompts')
assert.equal(records[4].isPrompt, false, 'delegated messages are not prompts')
assert.equal(records[4].timestampMs, null)
const aggregate = aggregateMessages(records, 123)
assert.equal(aggregate.messageCount, 5)
assert.equal(aggregate.userMessages, 3)
assert.equal(aggregate.assistantMessages, 2)
assert.equal(aggregate.inputTokens, 10)
assert.equal(aggregate.outputTokens, 5)
assert.equal(aggregate.indexedAt, 123)
assert.equal(aggregate.firstMessageAt, Date.parse('2026-10-28T00:00:00Z'))
assert.equal(aggregateMessages([], 123).lastMessageAt, null)
console.log('Index message mapping: provider identity, duplicate UUIDs, image exclusion, tool errors and prompt attribution passed')

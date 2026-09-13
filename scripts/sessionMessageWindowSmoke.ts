import assert from 'node:assert/strict'
import { mergeOrderedSessionMessageWindow } from '../lib/sessionMessageWindow'
import type { SessionMessage } from '../lib/types'

function message(uuid: string, type: 'user' | 'assistant', timestamp: string, text = uuid): SessionMessage {
  return {
    type,
    uuid,
    session_id: 'thread-1',
    parent_tool_use_id: null,
    provider: 'codex',
    turnId: 'turn-1',
    timestamp,
    message: { role: type, content: text },
  }
}

const assistant = message('assistant', 'assistant', '2026-08-21T13:57:03.000Z')
const tool = message('tool', 'assistant', '2026-08-21T13:57:03.000Z')
const user = message('user', 'user', '2026-08-21T13:57:04.448Z')

// A live transcript may first learn about assistant/tool items, then receive an
// authoritative backfill where the user item is first despite its later
// timestamp. The ordered window must repair the mounted sequence immediately.
const repaired = mergeOrderedSessionMessageWindow(
  [assistant, tool],
  [user, assistant, tool],
  { offset: 0, previousTotal: 2 },
)
assert.deepEqual(repaired?.map((entry) => entry.uuid), ['user', 'assistant', 'tool'])
assert.equal(repaired?.[1], assistant, 'unchanged messages should retain identity')

const unchanged = mergeOrderedSessionMessageWindow(
  repaired!,
  [user, assistant, tool],
  { offset: 0, previousTotal: 3 },
)
assert.equal(unchanged, repaired, 'unchanged authoritative windows should preserve array identity')

const updatedAssistant = message('assistant', 'assistant', assistant.timestamp!, 'updated reply')
const updated = mergeOrderedSessionMessageWindow(
  repaired!,
  [user, updatedAssistant, tool],
  { offset: 0, previousTotal: 3 },
)
assert.equal(updated?.[1], updatedAssistant, 'in-place provider updates must replace stale content')

console.log('Ordered message windows preserve provider sequence and repair delayed Codex user rows')

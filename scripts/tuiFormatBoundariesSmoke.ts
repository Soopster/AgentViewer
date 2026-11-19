import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildThreadedMessages } from '../lib/threading'
import type { SessionMessage, ToolUseBlock } from '../lib/types'
import {
  buildTranscriptTaskContext, formatTranscriptCards, formatMessageExpanded,
  formatTranscriptLines, formatTranscriptExpandedText,
} from '../tui/format'

// Captured against the monolithic formatter before extraction. Check complete
// public output, including code blocks, search fields, preview and expanded rows.
const raw: SessionMessage[] = []
function tool(name: string, input: ToolUseBlock['input'], content?: string, isError = false) {
  const id = `tool-${raw.length}`
  raw.push({ type: 'assistant', uuid: `${id}-call`, session_id: 'format-boundaries', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
  if (content !== undefined) raw.push({ type: 'user', uuid: `${id}-result`, session_id: 'format-boundaries', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } })
}
tool('task_create', { subject: 'Extract boundaries', activeForm: 'Extracting boundaries' }, 'Task #1 created successfully: Extract boundaries')
tool('TaskUpdate', { taskId: '1', status: 'in_progress', activeForm: 'Checking parity' }, JSON.stringify({ statusChange: { from: 'pending', to: 'in_progress' } }))
tool('TaskList', {}, JSON.stringify({ tasks: [
  { id: '1', subject: 'Extract boundaries', status: 'in_progress' },
  { id: '2', subject: 'Blocked task', blockedBy: ['1'], status: 'pending' },
  { id: '3', subject: 'Finished task', status: 'completed' },
  { id: '4', subject: 'Ready task', blockedBy: ['3'], status: 'pending' },
  { id: '5', subject: 'Paused task', status: 'paused', owner: 'reviewer' },
] }))
tool('TaskGet', { taskId: '2' }, JSON.stringify({ task: { id: '2', subject: 'Blocked task', description: 'Waiting for extraction', blockedBy: ['1'] } }))
tool('TaskStop', { task_id: '5' }, 'stopped')
tool('TaskGet', { taskId: 'missing' }, 'invalid task', true)
tool('TaskList', {}, 'not JSON')
tool('task', { description: 'Review extraction', subagent_type: 'reviewer', background: true }, 'task_id: review-12345678\nstate: running\n<task_result>review started</task_result>')
tool('task_status', { task_id: 'review-12345678' }, 'state: error\n<task_error>review failed\nretry later</task_error>', true)
tool('task', { description: 'Pending task' })
tool('mcp__agent-viewer__coord_status', {}, JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ runStatus: 'running', tasks: [], agents: [] }) }] }))
tool('coord_complete_task', { value: { task_id: 'task-1' } }, JSON.stringify({ accepted: false, reason: 'Review required' }))
tool('shell', { command: "bun client.mjs binding.json coord_read_inbox '{}'" }, 'stdout:\n{"messages":[],"notes":["No new mail"]}')
tool('coord_send_message', { to: 'reviewer', body: 'Please review' })
tool('read_file', { path: 'example.ts' }, '1\tconst answer = 42\n2\texport { answer }')
tool('edit', { path: 'example.ts', edits: [{ oldText: '42', newText: '43' }] }, 'updated')
tool('write_file', { path: 'new.ts', content: 'export {}' }, 'written')
tool('mcp__custom__lookup', { query: 'hello' }, '[{"type":"text","text":"result"}]')
const messages = buildThreadedMessages(raw)
const context = buildTranscriptTaskContext(messages)
assert.equal(context.activeForms?.get('1'), 'Checking parity')
const output = {
  cards: (['dense', 'balanced', 'comfortable'] as const).map(density => formatTranscriptCards(messages, density)),
  expanded: messages.map(message => formatMessageExpanded(messages, message.uuid)),
  lines: formatTranscriptLines(messages),
  text: formatTranscriptExpandedText(messages),
}
const digest = createHash('sha256').update(JSON.stringify(output)).digest('hex')
assert.equal(digest, '5ba07c4fa112caa770312d2cf0e56d225f43cda578cf1b88115aac4e39a9e9a6')
console.log('TUI formatting boundaries: public output parity passed')

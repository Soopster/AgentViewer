import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import MessageItem, { MessageDensityProvider, ViewModeProvider } from '../components/MessageItem'
import { buildThreadedMessages } from '../lib/threading'
import type { SessionMessage, ToolUseBlock, SystemMessagePayload } from '../lib/types'
import { normalizeToolThreadForNativeCard } from '../components/message-item/toolModel'
import { dedupeStreamToolThreads, streamFileUpdateData } from '../components/message-item/streamModel'
import { describeClaudeSystem } from '../components/message-item/claudeSystemModel'

// Capture the Web's rendered output before extracting its presentation models
// and system cards. No browser, server, or live provider is required.
const raw: SessionMessage[] = []
function tool(name: string, input: ToolUseBlock['input'], content?: string, isError = false) {
  const id = `tool-${raw.length}`
  raw.push({ type: 'assistant', uuid: `${id}-call`, session_id: 'web-boundaries', provider: 'claude',
    parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
  if (content !== undefined) raw.push({ type: 'user', uuid: `${id}-result`, session_id: 'web-boundaries',
    parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } })
}
tool('shell', { command: 'echo hello' })
tool('shell', { command: 'echo hello' }, 'hello\nProcess exited with code 0\nWall time: 0.2 seconds')
tool('read_file', { path: 'example.ts', offset: 10, limit: 2 }, '10\tconst answer = 42\n11\texport { answer }')
tool('grep', { pattern: 'answer', path: 'src' }, 'example.ts:10: answer')
tool('edit', { path: 'example.ts', oldText: '42', newText: '43' }, 'updated')
tool('Edit', { file_path: 'example.ts', old_string: '43', new_string: '44' }, 'updated')
tool('write_file', { path: 'new.ts', content: 'one\ntwo\nthree' }, 'written')
tool('FileChange', { changes: [{ path: 'deleted.ts', kind: 'delete', diff: '--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0 @@\n-old' }] }, 'applied')
tool('TodoWrite', { todos: [{ content: 'Done', status: 'completed' }, { content: 'Working', status: 'in_progress' }] }, 'updated')
tool('mcp__fixture__lookup', { query: 'answer' }, 'found')
tool('Bash', { command: 'false' }, 'failed', true)
tool('task', { description: 'Review extraction', subagent_type: 'reviewer' }, 'task_id: review-123\nstate: completed\n<task_result>done</task_result>')
const messages = buildThreadedMessages(raw)
const systemPayloads: Array<[string, Omit<SystemMessagePayload, 'subtype'>]> = [
  ['result', { type: 'system', result_subtype: 'success', num_turns: 3, duration_ms: 1250, total_cost_usd: 0.01 }],
  ['result', { type: 'system', result_subtype: 'error_during_execution', stop_reason: 'refusal', errors: ['denied'] }],
  ['worker_shutting_down', { type: 'system', reason: 'restart' }],
  ['conversation_reset', { type: 'system', trigger: 'context_limit', new_conversation_id: 'next' }],
  ['api_retry', { type: 'system', attempt: 1, max_retries: 3, retry_delay_ms: 1000, no_response: { waited_ms: 1000 } }],
  ['rate_limit_event', { type: 'system', rate_limit_info: { status: 'allowed_warning', utilization: 0.8 } }],
  ['task_notification', { type: 'system', summary: 'Worker finished', status: 'completed', usage: { total_tokens: 1234 } }],
  ['hook_response', { type: 'system', hook_name: 'check', outcome: 'success', additionalContext: 'All checks passed.' }],
  ['memory_recall', { type: 'system', mode: 'recall', memories: [{ path: 'notes.md', scope: 'project' }] }],
  ['unknown_signal', { type: 'system', content: 'Unknown signals remain readable.' }],
]
const systemMessages = systemPayloads.map(([subtype, payload], index) => ({
  ...messages[0]!, uuid: `system-${index}`, role: 'system' as const,
  blocks: [{ type: 'claude_system' as const, subtype, payload: { ...payload, type: 'system' as const, subtype } }],
}))
const html = (['dense', 'balanced', 'comfortable'] as const).flatMap(density => [
  ...(['stream', 'agents'] as const).map(mode => renderToStaticMarkup(
    <MessageDensityProvider density={density}><ViewModeProvider mode={mode}>
      {messages.map(message => <MessageItem key={message.uuid} message={message} />)}
    </ViewModeProvider></MessageDensityProvider>,
  )),
  ...(['conversation', 'full', 'continue'] as const).map(mode => renderToStaticMarkup(
    <MessageDensityProvider density={density}><ViewModeProvider mode={mode}>
      {systemMessages.map(message => <MessageItem key={message.uuid} message={message} />)}
    </ViewModeProvider></MessageDensityProvider>,
  )),
])
assert.ok(html[0]!.includes('example.ts'))
assert.ok(html.some(value => value.includes('worker shutting down')))
const digest = createHash('sha256').update(JSON.stringify(html)).digest('hex')
assert.equal(digest, '0ac5c6989c6501d32f88323e1a56d2bcaa837ff20f9b57504126d067bcd3cafc')

const threads = messages.flatMap(message => message.blocks).filter(block => block.type === 'tool_thread')
const pending = threads.find(thread => thread.toolUse.name === 'shell' && !thread.result)!
const completed = threads.find(thread => thread.toolUse.name === 'shell' && thread.result)!
assert.deepEqual(dedupeStreamToolThreads([pending, completed]), [completed], 'completed status replaces pending activity')
const failed = { ...completed, result: { ...completed.result!, is_error: true } }
assert.deepEqual(dedupeStreamToolThreads([pending, failed, completed]), [failed], 'failure stays visible after a later duplicate success')
const edits = threads.filter(thread => ['edit', 'Edit'].includes(thread.toolUse.name))
assert.equal(dedupeStreamToolThreads(edits).length, 2, 'repeated edits preserve chronological history')
const source = structuredClone(edits[0]!)
const normalized = normalizeToolThreadForNativeCard(source)
assert.equal(normalized.toolUse.name, 'Edit')
assert.equal(normalized.toolUse.input.file_path, 'example.ts')
assert.equal(source.toolUse.name, 'edit', 'normalization does not mutate provider input')
const write = threads.find(thread => thread.toolUse.name === 'write_file')!
const longWrite = { ...write, toolUse: { ...write.toolUse, input: {
  path: 'long.txt', content: Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n'),
} } }
const preview = streamFileUpdateData(longWrite)!
assert.equal(preview.operation, 'Create')
assert.equal(preview.additions, 10)
assert.equal(preview.preview.length, 7)
assert.equal(preview.hiddenLines, 3)
const retry = describeClaudeSystem('api_retry', {
  type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3,
  no_response: { waited_ms: 1500, retry_wait_ms: 500 },
})
assert.ok(retry.detailPreview.includes('no response in 1.5s'))
assert.ok(retry.body.includes('No response headers after 1.5s · retry waits 0.5s'))
assert.equal(retry.tone, 'var(--yellow)')
const refusal = describeClaudeSystem('result', {
  type: 'system', subtype: 'result', stop_reason: 'refusal', result_subtype: 'success',
})
assert.ok(refusal.detailPreview.startsWith('Run refused'))
assert.ok(refusal.body.includes('Outcome: refused'))
assert.equal(refusal.tone, 'var(--red)')
assert.ok(refusal.badges.includes('stop refusal'))
const hook = describeClaudeSystem('hook_response', {
  type: 'system', subtype: 'hook_response', hook_name: 'check', outcome: 'success',
  hookSpecificOutput: { additionalContext: 'Nested context' },
})
assert.ok(hook.body.includes('Additional context:\nNested context'))
console.log('Web message boundaries: rendered markup parity passed across views and densities')

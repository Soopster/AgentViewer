import assert from 'node:assert/strict'
import { createBetterProgress, betterElapsed } from '../lib/plugins/betterProgress'
import { readBetterResponse } from '../lib/plugins/betterTransport'
const native = createBetterProgress()
let state = native.update({ type: 'pi_event', event: { type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'docs/raw.md' } } }, '')
assert.equal(state.total, 1)
assert.equal(state.tools[0].status, 'running')
assert.equal(state.tools[0].label, 'read docs/raw.md')
state = native.update({ type: 'pi_event', event: { type: 'tool_execution_end', toolCallId: 'read-1', isError: true } }, '(3) Methods')
assert.equal(state.stage, 3); assert.equal(state.failed, 1); assert.equal(state.tools[0].status, 'error')
assert.equal(native.update({}, '(1) Earlier step').stage, 3)
assert.equal(native.update({}, '<improved-prompt>Ready').stage, 5)
const cases = [
  [{ type: 'codex_item_started', item: { type: 'commandExecution', id: '1', command: 'rg TODO src' } }, { type: 'codex_item_completed', item: { type: 'commandExecution', id: '1', exitCode: 0 } }],
  [{ type: 'copilot_event', event: { type: 'tool.execution_start', data: { toolCallId: '1', toolName: 'view', arguments: { path: 'README.md' } } } }, { type: 'copilot_event', event: { type: 'tool.execution_complete', data: { toolCallId: '1', success: true } } }],
  [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'a.ts' } }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: '1', is_error: false }] } }],
  [{ type: 'opencode_event', event: { type: 'message.part.updated', properties: { part: { type: 'tool', callID: '1', tool: 'grep', state: { status: 'running', input: { pattern: 'TODO' } } } } } }, { type: 'opencode_event', event: { type: 'message.part.updated', properties: { part: { type: 'tool', callID: '1', tool: 'grep', state: { status: 'completed' } } } } }],
  [{ type: 'acp_message', message: { message: { content: [{ type: 'tool_use', id: '1', name: 'read' }] } } }, { type: 'acp_message', message: { message: { content: [{ type: 'tool_result', tool_use_id: '1' }] } } }],
]
for (const [start, end] of cases) {
  const reducer = createBetterProgress()
  reducer.update(start, '')
  const result = reducer.update(end, '')
  assert.equal(result.total, 1); assert.equal(result.failed, 0); assert.equal(result.tools[0].status, 'ok')
}
assert.equal(betterElapsed(0, 87000), '1m 27s')
const result = { prompt: 'Rewrite', summary: 'Notes', helper: { provider: 'pi', sessionId: 'h' } }
let observed = 0
const wire = `data: ${JSON.stringify({ type: 'progress', value: state })}\n\ndata: ${JSON.stringify({ type: 'result', value: result })}\n\n`
const response = new Response(new ReadableStream({ start(controller) { for (const char of wire) controller.enqueue(new TextEncoder().encode(char)); controller.close() } }))
assert.deepEqual(await readBetterResponse(response, new AbortController().signal, () => observed++), result)
assert.equal(observed, 1)
await assert.rejects(readBetterResponse(new Response('data: {"type":"error","value":"Sign in"}\n\n'), new AbortController().signal), /Sign in/)
console.log('Better progress: PASS (native provider tools, ACP, errors, deduplication, monotonic six stages, elapsed time, fragmented transport)')

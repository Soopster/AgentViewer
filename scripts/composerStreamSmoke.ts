import assert from 'node:assert/strict'
import * as web from '../components/message-view/liveStream'
import * as terminal from '../tui/opentui/app/liveStream'
import { planComposerRetry } from '../lib/composerRetry'
import { prepareComposerTurnRequest } from '../lib/composerSubmission'
import { MAX_TRANSIENT_SEND_RETRIES, TransientAwareSendError } from '../lib/transientError'

const fixtures: Array<[unknown, string | null, string | null, boolean]> = [
  [null, null, null, false],
  [{ type: 'codex_agent_message_delta', delta: 'hello' }, 'hello', null, false],
  [{ type: 'codex_reasoning_delta', delta: 'thinking' }, null, 'thinking', false],
  [{ type: 'codex_item_completed', item: { type: 'agentMessage', text: 'done' } }, 'done', null, true],
  [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } }, 'hello', null, false],
  [{ type: 'stream_event', parent_tool_use_id: 'child', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'private' } } }, null, null, false],
  [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'thinking' } } }, null, 'thinking', false],
  [{ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }, 'done', null, true],
  [{ type: 'opencode_event', messageRole: 'assistant', event: { type: 'message.part.delta', properties: { field: 'text', delta: 'hello' } } }, 'hello', null, false],
  [{ type: 'opencode_event', messageRole: 'user', event: { type: 'message.part.delta', properties: { field: 'text', delta: 'private' } } }, null, null, false],
  [{ type: 'opencode_event', messageRole: 'assistant', event: { type: 'message.part.updated', properties: { part: { type: 'text', text: 'done' } } } }, 'done', null, true],
  [{ type: 'copilot_event', event: { type: 'assistant.message_delta', data: { deltaContent: 'hello' } } }, 'hello', null, false],
  [{ type: 'copilot_event', event: { type: 'assistant.message', data: { content: 'done' } } }, 'done', null, true],
  [{ type: 'copilot_event', event: { type: 'assistant.reasoning_delta', data: { deltaContent: 'thinking' } } }, null, 'thinking', false],
  [{ type: 'pi_event', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' } } }, 'hello', null, false],
  [{ type: 'pi_event', event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } } }, 'done', null, true],
  [{ type: 'lmstudio_delta', delta: 'hello' }, 'hello', null, false],
  [{ type: 'copilot_event', event: null }, null, null, false],
]
for (const decoder of [web, terminal]) {
  for (const [event, answer, reasoning, replace] of fixtures) {
    assert.equal(decoder.extractStreamingAssistantText(event), answer, JSON.stringify(event))
    assert.equal(decoder.extractStreamingReasoningText(event), reasoning, JSON.stringify(event))
    assert.equal(decoder.shouldReplaceLiveAssistantText(event), replace, JSON.stringify(event))
  }
  // Every split position, including CR/LF boundaries and multi-line data.
  const wire = ': heartbeat\r\n\r\nevent: update\r\ndata: one\r\ndata: two\r\n\r\ndata: final\r\n\r\n'
  for (let split = 0; split <= wire.length; split++) {
    const first = decoder.extractSseFrames(wire.slice(0, split))
    const second = decoder.extractSseFrames(first.remaining + wire.slice(split))
    assert.deepEqual([...first.frames, ...second.frames], [{ event: 'update', data: 'one\ntwo' }, { event: 'message', data: 'final' }])
    assert.equal(second.remaining, '')
  }
}
const terminalOnly = { type: 'codex_realtime_transcript_done', role: 'assistant', text: 'final realtime answer' }
assert.equal(web.extractStreamingAssistantText(terminalOnly), null)
assert.equal(terminal.extractStreamingAssistantText(terminalOnly), 'final realtime answer')
assert.equal(terminal.shouldReplaceLiveAssistantText(terminalOnly), true)
assert.equal(terminal.extractStreamingAssistantText({ type: 'codex_error', error: { message: 'failed', additionalDetails: 'details' } }), 'failed\n\ndetails')

const transient = new TransientAwareSendError('overloaded', 503)
assert.ok(planComposerRetry(transient, { producedOutput: false, attempts: 0 }))
assert.equal(planComposerRetry(transient, { producedOutput: true, attempts: 0 }), null)
assert.equal(planComposerRetry(transient, { producedOutput: false, attempts: MAX_TRANSIENT_SEND_RETRIES }), null)
assert.equal(planComposerRetry(new DOMException('timeout', 'AbortError'), { producedOutput: false, attempts: 0 }), null)
assert.equal(planComposerRetry(new Error('invalid agent'), { producedOutput: false, attempts: 0 }), null)
assert.equal(planComposerRetry(new TransientAwareSendError('rate limit', 429, 'limit-reached'), { producedOutput: false, attempts: 0 }), null)
for (const provider of ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio'] as const) {
  const request = prepareComposerTurnRequest({ sessionId: 'target', provider, isPending: true, cwd: '/workspace' }, { message: 'hello', attachments: [] }, {
    turnRequestId: 'stable-across-retry', model: '', agent: 'agent', mode: 'mode', contextTier: 'tier',
    permissionMode: 'default', approvalPolicy: 'on-request', enableWorkflow: true, taskBudgetTokens: 0,
  })
  assert.equal(request.agent, provider === 'opencode' ? 'agent' : undefined)
  assert.equal(request.mode, provider === 'copilot' ? 'mode' : undefined)
  assert.equal(request.contextTier, provider === 'copilot' ? 'tier' : undefined)
  assert.equal(request.permissionMode, provider === 'claude' || provider === 'copilot' ? 'default' : undefined)
  assert.equal(request.approvalPolicy, provider === 'codex' ? 'on-request' : undefined)
  assert.equal(request.manualPermissions, provider === 'claude' || provider === 'copilot' ? true : undefined)
  assert.equal(request.enableWorkflow, provider === 'claude' ? true : undefined)
  assert.equal(request.turnRequestId, 'stable-across-retry')
  assert.equal(request.taskBudgetTokens, 0)
  assert.equal(request.model, undefined)
  assert.equal(request.isPendingSession, true)
}
for (const permissionMode of ['plan', 'bypassPermissions']) {
  assert.equal(prepareComposerTurnRequest({ sessionId: 'target', provider: 'claude' }, { message: 'hello' }, { turnRequestId: 'turn', permissionMode }).manualPermissions, undefined)
}
console.log('Composer stream decoding, surface policies, fragmented SSE, submission policy and retry safety passed')

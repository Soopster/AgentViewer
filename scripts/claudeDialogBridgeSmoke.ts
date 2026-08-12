import assert from 'node:assert/strict'
import {
  createClaudeUserDialogBridge,
  claudeResultErrorMessage,
  runViewSessionAction,
} from '../lib/sessionBackend'
import { classifyProviderTurnFailure } from '../lib/agentCoordination'

const budgetError = claudeResultErrorMessage({ type: 'result', subtype: 'error_max_budget_usd' })
assert.deepEqual(budgetError, { message: 'Claude reached the maximum cost budget before finishing.' })
assert.equal(classifyProviderTurnFailure(budgetError!.message).kind, 'budget_exhausted')

const frames: string[] = []
const controller = {
  enqueue(chunk: Uint8Array) {
    frames.push(new TextDecoder().decode(chunk))
  },
} as ReadableStreamDefaultController<Uint8Array>
const encoder = new TextEncoder()
const sessionId = `dialog-smoke-${Date.now()}`
const bridge = createClaudeUserDialogBridge(sessionId, controller, encoder)

const abort = new AbortController()
const pending = bridge({
  dialogKind: 'refusal_fallback_prompt',
  payload: { message: 'Use the fallback model?' },
}, { signal: abort.signal, requestId: 'dialog-1' })

await new Promise((resolve) => setImmediate(resolve))
assert.match(frames.join(''), /claude_elicitation/)
assert.match(frames.join(''), /Use the fallback model/)

await runViewSessionAction({
  sessionId,
  provider: 'claude',
  body: {
    action: 'respondQuestion',
    permissionId: 'dialog-1',
    answers: { continue: ['true'] },
  },
})
assert.deepEqual(await pending, {
  behavior: 'completed',
  result: { continue: true, answers: { continue: ['true'] }, response: undefined, annotations: undefined },
})
assert.match(frames.join(''), /elicitation.completed/)

assert.deepEqual(await bridge({ dialogKind: 'unknown', payload: {} }, {
  signal: new AbortController().signal,
  requestId: 'dialog-unknown',
}), { behavior: 'cancelled' })

const cancelledAbort = new AbortController()
cancelledAbort.abort()
assert.deepEqual(await bridge({ dialogKind: 'refusal_fallback_prompt', payload: {} }, {
  signal: cancelledAbort.signal,
  requestId: 'dialog-aborted',
}), { behavior: 'cancelled' })

console.log('claude native dialog bridge smoke: ok')

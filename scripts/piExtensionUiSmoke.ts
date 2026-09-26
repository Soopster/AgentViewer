import assert from 'node:assert/strict'
import { extractPendingPermission } from '../lib/permissions'
import {
  getServerMemoryDiagnostics,
  runViewSessionAction,
} from '../lib/sessionBackend'
import { createPiUiBridge } from '../lib/piExtensionUi'

const sessionId = 'pi-ui-smoke-session'
const frames: string[] = []
const activeIds = new Set<string>()
const bridge = createPiUiBridge(sessionId, (frame) => frames.push(frame), activeIds)

function newestPrompt() {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index]!
    if (!frame.startsWith('data: ')) continue
    const permission = extractPendingPermission(JSON.parse(frame.slice(6)))
    if (permission) return permission
  }
  throw new Error('Pi UI bridge did not emit a structured question')
}

const selected = bridge({
  method: 'select',
  title: 'Choose a strategy',
  options: ['Minimal', 'Complete'],
})
const selectPrompt = newestPrompt()
assert.equal(selectPrompt.provider, 'pi')
assert.deepEqual(selectPrompt.questions?.[0]?.options.map((option) => option.value), ['Minimal', 'Complete'])
await runViewSessionAction({
  sessionId,
  provider: 'pi',
  body: {
    action: 'respondQuestion',
    permissionId: selectPrompt.id,
    answers: { value: ['Complete'] },
  },
})
assert.equal(await selected, 'Complete')

const custom = bridge({
  method: 'input',
  title: 'Name the release',
  placeholder: 'release name',
})
const inputPrompt = newestPrompt()
assert.equal(inputPrompt.questions?.[0]?.allowFreeform, true)
await runViewSessionAction({
  sessionId,
  provider: 'pi',
  body: {
    action: 'respondQuestion',
    permissionId: inputPrompt.id,
    answers: { value: ['alpha, beta'] },
  },
})
assert.equal(await custom, 'alpha, beta')

const confirmed = bridge({
  method: 'confirm',
  title: 'Publish changes?',
  message: 'This action can be cancelled.',
})
const confirmPrompt = newestPrompt()
assert.deepEqual(confirmPrompt.questions?.[0]?.options.map((option) => option.value), ['true', 'false'])
await runViewSessionAction({
  sessionId,
  provider: 'pi',
  body: {
    action: 'respondPermission',
    permissionId: confirmPrompt.id,
    response: 'reject',
  },
})
assert.equal(await confirmed, false)

const approved = bridge({
  method: 'confirm',
  title: 'Continue?',
  message: 'This confirmation should resolve affirmatively.',
})
const approvePrompt = newestPrompt()
await runViewSessionAction({
  sessionId,
  provider: 'pi',
  body: {
    action: 'respondPermission',
    permissionId: approvePrompt.id,
    response: 'once',
  },
})
assert.equal(await approved, true)

const timedOut = bridge({
  method: 'input',
  title: 'Short-lived prompt',
  timeout: 5,
})
assert.equal(await timedOut, undefined)

assert.equal(activeIds.size, 0)
assert.equal(getServerMemoryDiagnostics().pendingPiUiRequests, 0)
assert.ok(frames.some((frame) => frame.includes('question.completed')))

console.log('Pi extension UI select, input, confirm, cancel, explicit timeout, and cleanup passed')

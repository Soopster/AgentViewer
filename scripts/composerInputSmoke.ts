import assert from 'node:assert/strict'
import { getCodexClient } from '../lib/codexClient'
import { buildCodexComposerInput } from '../lib/codexComposerInput'
import {
  clearComposerQueueTarget,
  createComposerQueueItemId,
  mergeComposerAttachments,
  planComposerAttachments,
  rekeyComposerQueueTarget,
  removeComposerQueueItem,
  resolveLocalComposerAttachmentPath,
  restoreComposerDraftPayload,
  selectComposerQueueTarget,
} from '../lib/composerAttachments'
import { commandResultExpectsTranscript, isNativeComposerCommandText } from '../lib/composerCommands'
import { deliverComposerSteer } from '../lib/composerSteering'
import { steerCopilotSession } from '../lib/copilotClient'
import { piSessionPathCacheSize } from '../lib/piClient'
import { extractCodexApproval, extractPendingPermissions } from '../lib/permissions'
import { getProviderCapabilities } from '../lib/provider'
import { getProviderComposer } from '../lib/providerComposer'
import {
  clearRunningSession,
  getRunningSessionInfo,
  interruptRunningSession,
  setRunningSession,
  steerRunningSession,
  steerRunningSessionIdempotent,
} from '../lib/sessionRuntime'
import { runViewSessionAction, startTurnWatchdog } from '../lib/sessionBackend'
import type { AgentProvider, SendAttachment } from '../lib/types'

const providers: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio']
const queueItemIds = new Set(Array.from({ length: 100 }, () => createComposerQueueItemId('codex:shared')))
assert.equal(queueItemIds.size, 100, 'queue item ids must remain unique across independent producers')
for (const provider of providers) {
  assert.equal(getProviderCapabilities(provider).respondToPermission, true, `${provider} interactive response capability`)
  const composer = getProviderComposer(provider)
  assert.match(composer.placeholderStreaming, /Enter steers this turn or queues it safely/)
  assert.match(composer.footerHintSending, /⏎ steer\/queue follow-up/)
  assert.doesNotMatch(composer.placeholderStreaming, /Tab/i, `${provider} must not advertise an unimplemented Tab send binding`)
}
const copilotSteerCalls: unknown[] = []
const copilotSteerTarget = {
  send: async (options: unknown) => {
    copilotSteerCalls.push(options)
    return 'copilot-steer-1'
  },
} as unknown as Parameters<typeof steerCopilotSession>[0]
const copilotSteerId = await steerCopilotSession(copilotSteerTarget, 'Change course now')
assert.equal(copilotSteerId, 'copilot-steer-1')
assert.deepEqual(copilotSteerCalls, [{ prompt: 'Change course now', mode: 'immediate' }])
const watchdogProbeTimes: number[] = []
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('watchdog cadence smoke timed out')), 500)
  const cancel = startTurnWatchdog({
    label: 'smoke',
    idleTimeoutMs: 15,
    minimumDelayMs: 1,
    isClosed: () => false,
    lastActivityAt: () => 0,
    probe: async () => {
      watchdogProbeTimes.push(performance.now())
      return watchdogProbeTimes.length === 1 ? 'running' : 'idle'
    },
    onResolved: () => {
      clearTimeout(timeout)
      cancel()
      resolve()
    },
  })
})
assert.equal(watchdogProbeTimes.length, 2)
assert.ok(watchdogProbeTimes[1]! - watchdogProbeTimes[0]! >= 10, 'watchdog must wait a full silence window after a running probe')
assert.equal(isNativeComposerCommandText('/compact'), true)
assert.equal(isNativeComposerCommandText('!git status'), true)
assert.equal(isNativeComposerCommandText('explain /compact'), false)
assert.equal(commandResultExpectsTranscript({}), true)
assert.equal(commandResultExpectsTranscript({ transcriptExpected: true }), true)
assert.equal(commandResultExpectsTranscript({ transcriptExpected: false }), false)
const codexQuestion = extractCodexApproval({
  type: 'codex_approval',
  event: {
    type: 'approval.requested',
    requestId: 'question-request',
    method: 'item/tool/requestUserInput',
    threadId: 'thread-1',
    params: {
      questions: [{
        id: 'scope',
        header: 'Scope',
        question: 'Which scope?',
        isOther: true,
        isSecret: true,
        options: [{ label: 'Current file', description: 'Only edit the active file.' }],
      }],
    },
  },
})
assert.equal(codexQuestion?.title, 'Which scope?')
assert.equal(codexQuestion?.questions?.[0]?.id, 'scope')
assert.equal(codexQuestion?.questions?.[0]?.options[0]?.label, 'Current file')
assert.equal(codexQuestion?.questions?.[0]?.allowFreeform, true)
assert.equal(codexQuestion?.questions?.[0]?.secret, true)
const codexElicitation = extractCodexApproval({
  type: 'codex_approval',
  event: {
    type: 'approval.requested',
    requestId: 'elicitation-request',
    method: 'mcpServer/elicitation/request',
    threadId: 'thread-1',
    params: {
      mode: 'form',
      serverName: 'example-mcp',
      message: 'Configure the export',
      requestedSchema: {
        type: 'object',
        required: ['format'],
        properties: {
          format: { type: 'string', title: 'Format', enum: ['json', 'csv'] },
          notes: { type: 'string', title: 'Notes' },
          includeDrafts: { type: 'boolean', title: 'Include drafts' },
        },
      },
    },
  },
})
assert.equal(codexElicitation?.title, 'Configure the export')
assert.equal(codexElicitation?.elicitation?.mode, 'form')
assert.deepEqual(codexElicitation?.questions?.map((question) => question.id), ['format', 'notes', 'includeDrafts'])
assert.deepEqual(codexElicitation?.questions?.[0]?.options.map((option) => option.value), ['json', 'csv'])
assert.equal(codexElicitation?.questions?.[0]?.required, true)
assert.equal(codexElicitation?.questions?.[1]?.allowFreeform, true)
assert.deepEqual(codexElicitation?.questions?.[2]?.options.map((option) => option.value), ['true', 'false'])
const claudeElicitation = extractPendingPermissions([{
  type: 'claude_elicitation',
  event: {
    type: 'elicitation.requested',
    data: {
      requestId: 'claude-elicit-1',
      sessionId: 'claude-session',
      serverName: 'example-mcp',
      message: 'Provide an email',
      mode: 'form',
      requestedSchema: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', title: 'Email', format: 'email' } },
      },
    },
  },
}], { sessionId: 'fallback', provider: 'claude' })[0]
assert.equal(claudeElicitation?.id, 'claude-elicit-1')
assert.equal(claudeElicitation?.elicitation?.serverName, 'example-mcp')
assert.equal(claudeElicitation?.questions?.[0]?.allowFreeform, true)
const copilotElicitation = extractPendingPermissions([{
  type: 'copilot_event',
  event: {
    type: 'elicitation.requested',
    data: {
      requestId: 'copilot-elicit-1',
      message: 'Choose a target',
      mode: 'form',
      elicitationSource: 'copilot-mcp',
      requestedSchema: {
        type: 'object',
        required: ['target'],
        properties: { target: { type: 'string', title: 'Target', enum: ['local', 'remote'] } },
      },
    },
  },
}], { sessionId: 'copilot-session', provider: 'copilot' })[0]
assert.equal(copilotElicitation?.id, 'copilot-elicit-1')
assert.equal(copilotElicitation?.elicitation?.serverName, 'copilot-mcp')
assert.deepEqual(copilotElicitation?.questions?.[0]?.options.map((option) => option.value), ['local', 'remote'])
const openCodeQuestion = extractPendingPermissions([{
  type: 'opencode_event',
  event: {
    type: 'question.asked',
    properties: {
      id: 'opencode-question-1',
      sessionID: 'opencode-session',
      questions: [{
        header: 'Strategy',
        question: 'How should this be implemented?',
        multiple: false,
        custom: true,
        options: [
          { label: 'Minimal', description: 'Make the smallest change.' },
          { label: 'Complete', description: 'Cover the full workflow.' },
        ],
      }],
    },
  },
}], { sessionId: 'fallback', provider: 'opencode' })[0]
assert.equal(openCodeQuestion?.id, 'opencode-question-1')
assert.equal(openCodeQuestion?.sessionId, 'opencode-session')
assert.equal(openCodeQuestion?.questions?.[0]?.id, '0')
assert.equal(openCodeQuestion?.questions?.[0]?.allowFreeform, true)
assert.deepEqual(openCodeQuestion?.questions?.[0]?.options.map((option) => option.value), ['Minimal', 'Complete'])
const piQuestion = extractPendingPermissions([{
  type: 'pi_ui',
  event: {
    type: 'question.requested',
    data: {
      requestId: 'pi-ui-1',
      sessionId: 'pi-session',
      method: 'confirm',
      title: 'Deploy changes?',
      message: 'This will publish the current branch.',
    },
  },
}], { sessionId: 'fallback', provider: 'pi' })[0]
assert.equal(piQuestion?.id, 'pi-ui-1')
assert.equal(piQuestion?.sessionId, 'pi-session')
assert.deepEqual(piQuestion?.questions?.[0]?.options.map((option) => option.value), ['true', 'false'])
const reattachedPermissions = extractPendingPermissions([
  {
    type: 'opencode_event',
    event: { type: 'permission.updated', properties: { id: 'oc-1', type: 'bash', title: 'Run tests' } },
  },
  {
    type: 'copilot_event',
    event: {
      type: 'permission.requested',
      data: { requestId: 'cp-1', permissionRequest: { kind: 'url', url: 'https://example.test' } },
    },
  },
], { sessionId: 'reattached-session', provider: 'opencode' })
assert.deepEqual(reattachedPermissions.map((permission) => permission.id), ['oc-1', 'cp-1'])
assert.deepEqual(reattachedPermissions.map((permission) => permission.sessionId), ['reattached-session', 'reattached-session'])
assert.deepEqual(reattachedPermissions.map((permission) => permission.provider), ['opencode', 'copilot'])
assert.equal(resolveLocalComposerAttachmentPath('src/index.ts', '/workspace/project'), '/workspace/project/src/index.ts')
assert.equal(resolveLocalComposerAttachmentPath('/absolute/index.ts', '/workspace/project'), '/absolute/index.ts')
const restoredComposer = restoreComposerDraftPayload(
  {
    text: 'Newest draft',
    attachments: [{ id: 'new', type: 'file', path: 'new.ts' }],
  },
  [
    {
      text: 'Queued follow-up',
      attachments: [{ id: 'queued', type: 'image', path: '/tmp/queued.png' }],
    },
  ],
  {
    text: 'Failed prompt',
    attachments: [{ id: 'failed', type: 'mention', path: 'failed.ts' }],
  },
)
assert.equal(restoredComposer.text, 'Failed prompt\n\nQueued follow-up\n\nNewest draft')
assert.deepEqual(restoredComposer.attachments.map((attachment) => attachment.id), ['failed', 'queued', 'new'])
const sessionOwnedQueue = [
  { id: 'a-1', targetKey: 'claude:a', text: 'first' },
  { id: 'b-1', targetKey: 'codex:b', text: 'other session' },
  { id: 'a-2', targetKey: 'claude:a', text: 'second' },
]
assert.deepEqual(
  selectComposerQueueTarget(sessionOwnedQueue, 'claude:a').map((entry) => entry.id),
  ['a-1', 'a-2'],
)
assert.deepEqual(
  clearComposerQueueTarget(sessionOwnedQueue, 'claude:a').map((entry) => entry.id),
  ['b-1'],
)
assert.deepEqual(
  removeComposerQueueItem(sessionOwnedQueue, 'a-1').map((entry) => entry.id),
  ['b-1', 'a-2'],
)
assert.deepEqual(
  rekeyComposerQueueTarget(sessionOwnedQueue, 'claude:a', 'claude:real').map((entry) => entry.targetKey),
  ['claude:real', 'codex:b', 'claude:real'],
)
assert.deepEqual(
  mergeComposerAttachments(
    [{ id: 'same', type: 'file', path: 'first.ts' }],
    [
      { id: 'same', type: 'file', path: 'duplicate.ts' },
      { id: 'second', type: 'file', path: 'second.ts' },
    ],
  ).map((attachment) => attachment.path),
  ['first.ts', 'second.ts'],
)
const attachmentMatrix: SendAttachment[] = [
  { id: 'file', type: 'file', path: 'lib/types.ts', displayName: 'types.ts' },
  { id: 'directory', type: 'directory', path: 'lib', displayName: 'lib' },
  {
    id: 'selection',
    type: 'selection',
    filePath: 'components/MessageView.tsx',
    displayName: 'MessageView.tsx',
    text: 'const selected = true',
    selection: {
      start: { line: 41, character: 0 },
      end: { line: 43, character: 1 },
    },
  },
  { id: 'image', type: 'image', path: '/tmp/screenshot.png', displayName: 'screenshot.png' },
  { id: 'mention', type: 'mention', path: 'README.md', displayName: 'README.md' },
  { id: 'skill', type: 'skill', path: '.agents/skills/example/SKILL.md', displayName: 'example' },
  { id: 'blob', type: 'blob', data: 'aW1hZ2U=', mimeType: 'image/png', displayName: 'pasted.png' },
  { id: 'agent', type: 'agent', displayName: 'reviewer', text: '@reviewer' },
  {
    id: 'extension_context',
    type: 'extension_context',
    displayName: 'Issue context',
    extensionId: 'issues',
    capturedAt: '2026-07-26T00:00:00Z',
    payload: { issue: 42, state: 'open' },
  },
]

const expectedNative: Record<AgentProvider, SendAttachment['type'][]> = {
  claude: ['image', 'blob'],
  codex: ['file', 'directory', 'image', 'mention', 'skill', 'blob'],
  opencode: ['file', 'image', 'mention', 'blob', 'agent'],
  copilot: ['file', 'directory', 'selection', 'image', 'mention', 'blob', 'extension_context'],
  pi: ['image', 'blob'],
  lmstudio: [],
}

for (const provider of providers) {
  const plan = planComposerAttachments(provider, attachmentMatrix)
  assert.deepEqual(plan.native.map((attachment) => attachment.type), expectedNative[provider])
  assert.equal(plan.unsupported.length, 0, `${provider} silently lost a representative attachment`)
  assert.equal(
    plan.native.length + plan.portable.length,
    attachmentMatrix.length,
    `${provider} did not classify every representative attachment`,
  )
  assert.deepEqual(
    new Set([...plan.native, ...plan.portable].map((attachment) => attachment.id)),
    new Set(attachmentMatrix.map((attachment) => attachment.id)),
    `${provider} classified an attachment more than once or not at all`,
  )
}

const remoteImage: SendAttachment = {
  type: 'image',
  path: 'https://example.test/screenshot.png',
  displayName: 'remote.png',
}
assert.deepEqual(
  providers.filter((provider) => planComposerAttachments(provider, [remoteImage]).native.length > 0),
  ['codex', 'opencode'],
)
assert.deepEqual(
  providers.filter((provider) => planComposerAttachments(provider, [remoteImage]).portable.length > 0),
  ['claude', 'copilot', 'pi'],
)

const native = buildCodexComposerInput('Inspect these.', [
  { type: 'file', path: 'lib/types.ts', displayName: 'types.ts' },
  { type: 'image', path: 'https://example.test/screenshot.png' },
], '/workspace/project')
assert.equal(native[0]?.type, 'text')
assert.equal(native[0]?.type === 'text' ? native[0].text : '', 'Inspect these.')
assert.deepEqual(native.slice(1).map((input) => input.type), ['mention', 'image'])
assert.equal(native[1]?.type === 'mention' ? native[1].path : '', '/workspace/project/lib/types.ts')

const portable = buildCodexComposerInput('Fix the selected behavior.', [
  {
    type: 'selection',
    filePath: 'components/MessageView.tsx',
    displayName: 'MessageView.tsx',
    text: 'const selected = true',
    selection: {
      start: { line: 41, character: 0 },
      end: { line: 43, character: 1 },
    },
  },
  { type: 'agent', displayName: 'reviewer', text: '@reviewer' },
  {
    type: 'extension_context',
    displayName: 'Issue context',
    extensionId: 'issues',
    capturedAt: '2026-07-26T00:00:00Z',
    payload: { issue: 42, state: 'open' },
  },
])
assert.equal(portable.length, 1)
assert.equal(portable[0]?.type, 'text')
const portableText = portable[0]?.type === 'text' ? portable[0].text : ''
assert.match(portableText, /\[selection: MessageView\.tsx\] components\/MessageView\.tsx:42-44/)
assert.match(portableText, /const selected = true/)
assert.match(portableText, /\[agent: reviewer\]\n@reviewer/)
assert.match(portableText, /\[extension_context: Issue context\]\n\{"issue":42,"state":"open"\}/)

assert.throws(
  () => buildCodexComposerInput('Read this.', [
    { type: 'blob', displayName: 'opaque.bin', mimeType: 'application/octet-stream', data: 'AA==' },
  ]),
  /cannot represent blob attachment "opaque\.bin"/,
)

const opaqueBlob: SendAttachment = {
  type: 'blob',
  displayName: 'opaque.bin',
  mimeType: 'application/octet-stream',
  data: 'AA==',
}
assert.deepEqual(
  providers.filter((provider) => planComposerAttachments(provider, [opaqueBlob]).native.length > 0),
  ['copilot'],
)
assert.deepEqual(
  providers.filter((provider) => planComposerAttachments(provider, [opaqueBlob]).unsupported.length > 0),
  ['claude', 'codex', 'opencode', 'pi'],
)

// A retry/new turn can replace the running registry before the old stream's
// finally block executes. Stale cleanup and stale interrupts must not erase or
// cancel the replacement turn.
const lifecycleSessionId = 'composer-lifecycle-race'
let oldInterrupts = 0
let newInterrupts = 0
let steeredMessages = 0
setRunningSession(lifecycleSessionId, {
  provider: 'codex',
  requestId: 'turn-old',
  interrupt: async () => { oldInterrupts += 1 },
})
setRunningSession(lifecycleSessionId, {
  provider: 'codex',
  requestId: 'turn-new',
  interrupt: async () => { newInterrupts += 1 },
  steer: async () => { steeredMessages += 1 },
})
assert.equal(clearRunningSession(lifecycleSessionId, 'turn-old'), false)
assert.deepEqual(getRunningSessionInfo(lifecycleSessionId), {
  running: true,
  provider: 'codex',
  canSteer: true,
  canInterrupt: true,
  canBackground: false,
})
await interruptRunningSession(lifecycleSessionId, 'turn-old')
assert.equal(oldInterrupts, 0)
assert.equal(newInterrupts, 0)
assert.deepEqual(await steerRunningSession(lifecycleSessionId, 'stale', 'turn-old'), { delivered: false })
assert.equal(steeredMessages, 0)
assert.equal((await steerRunningSession(lifecycleSessionId, 'current', 'turn-new')).delivered, true)
assert.equal(steeredMessages, 1)
const idempotentResults = await Promise.all([
  steerRunningSessionIdempotent(lifecycleSessionId, 'exactly once', 'turn-new', 'steer-request-1'),
  steerRunningSessionIdempotent(lifecycleSessionId, 'exactly once', 'turn-new', 'steer-request-1'),
])
assert.equal(idempotentResults.every((result) => result.delivered), true)
assert.equal(steeredMessages, 2, 'concurrent retries with one steer request id must invoke the provider once')
await assert.rejects(
  steerRunningSessionIdempotent(lifecycleSessionId, 'different payload', 'turn-new', 'steer-request-1'),
  /different payload/,
)

let ambiguousTransportAttempts = 0
const ambiguousTransportRequestIds = new Set<string>()
const retryResult = await deliverComposerSteer(async (payload) => {
  ambiguousTransportAttempts += 1
  ambiguousTransportRequestIds.add(payload.steerRequestId)
  const result = await steerRunningSessionIdempotent(
    lifecycleSessionId,
    payload.message,
    payload.turnRequestId,
    payload.steerRequestId,
  )
  if (ambiguousTransportAttempts === 1) throw new Error('response connection lost after delivery')
  return result
}, {
  message: 'retry safely',
  provider: 'codex',
  turnRequestId: 'turn-new',
})
assert.equal(retryResult.delivered, true)
assert.equal(ambiguousTransportAttempts, 2)
assert.equal(ambiguousTransportRequestIds.size, 1, 'transport retry must reuse one request id')
assert.equal(steeredMessages, 3, 'same-id transport retry must not invoke the provider twice')

const actionPayload = {
  action: 'steer',
  message: 'action layer retry',
  turnRequestId: 'turn-new',
  steerRequestId: 'steer-action-request-1',
}
const actionResults = await Promise.all([
  runViewSessionAction({ sessionId: lifecycleSessionId, body: actionPayload, provider: 'codex' }),
  runViewSessionAction({ sessionId: lifecycleSessionId, body: actionPayload, provider: 'codex' }),
])
assert.equal(actionResults.every((result) => result.delivered === true), true)
assert.equal(steeredMessages, 4, 'action-layer retries must share the runtime steer receipt')
await assert.rejects(
  runViewSessionAction({
    sessionId: lifecycleSessionId,
    provider: 'codex',
    body: { ...actionPayload, steerRequestId: 'x'.repeat(257) },
  }),
  /steerRequestId is too long/,
)

let definiteRejectionAttempts = 0
const definiteRejection = await deliverComposerSteer(async () => {
  definiteRejectionAttempts += 1
  return { delivered: false }
}, {
  message: 'queue this instead',
  provider: 'codex',
  turnRequestId: 'turn-new',
})
assert.equal(definiteRejection.delivered, false)
assert.equal(definiteRejectionAttempts, 1, 'a definite not-delivered result must fall back without retrying')
await interruptRunningSession(lifecycleSessionId, 'turn-new')
assert.equal(newInterrupts, 1)
assert.equal(clearRunningSession(lifecycleSessionId, 'turn-new'), true)
assert.equal(getRunningSessionInfo(lifecycleSessionId).running, false)

let uncorrelatedInterrupts = 0
setRunningSession(lifecycleSessionId, {
  provider: 'pi',
  interrupt: async () => { uncorrelatedInterrupts += 1 },
})
await interruptRunningSession(lifecycleSessionId, 'turn-targeted')
assert.equal(uncorrelatedInterrupts, 0)
await interruptRunningSession(lifecycleSessionId)
assert.equal(uncorrelatedInterrupts, 1)
clearRunningSession(lifecycleSessionId)

let pendingInterrupts = 0
await interruptRunningSession(lifecycleSessionId, 'turn-future')
setRunningSession(lifecycleSessionId, {
  provider: 'opencode',
  requestId: 'turn-unrelated',
  interrupt: async () => { pendingInterrupts += 100 },
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(pendingInterrupts, 0)
setRunningSession(lifecycleSessionId, {
  provider: 'opencode',
  requestId: 'turn-future',
  interrupt: async () => { pendingInterrupts += 1 },
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(pendingInterrupts, 1)
clearRunningSession(lifecycleSessionId, 'turn-future')

// Next.js can evaluate sessionRuntime again during a development/module reload
// while the original provider turn is still alive. A second module instance
// must see and control the same real registry entry rather than an empty Map.
setRunningSession(lifecycleSessionId, {
  provider: 'claude',
  requestId: 'turn-reload',
  interrupt: async () => {},
  steer: async () => {},
})
const reloadedRuntimeUrl = new URL(`../lib/sessionRuntime.ts?composer-reload=${Date.now()}`, import.meta.url).href
const reloadedRuntime = await import(reloadedRuntimeUrl) as typeof import('../lib/sessionRuntime')
assert.deepEqual(reloadedRuntime.getRunningSessionInfo(lifecycleSessionId), {
  running: true,
  provider: 'claude',
  canSteer: true,
  canInterrupt: true,
  canBackground: false,
})
assert.equal(reloadedRuntime.clearRunningSession(lifecycleSessionId, 'turn-reload'), true)
assert.equal(getRunningSessionInfo(lifecycleSessionId).running, false)

// Provider-owned singleton state must survive the same reload boundary. Codex
// must not spawn a second app-server, and Pi must not discard its session path
// index (which would force an all-session disk scan on the next send).
const codexClient = getCodexClient()
const reloadedCodexUrl = new URL(`../lib/codexClient.ts?composer-reload=${Date.now()}`, import.meta.url).href
const reloadedCodex = await import(reloadedCodexUrl) as typeof import('../lib/codexClient')
assert.equal(reloadedCodex.getCodexClient(), codexClient)
globalThis.__agentViewerPiSessionPathCache?.set('composer-reload-path', '/tmp/composer-reload-path.jsonl')
const reloadedPiUrl = new URL(`../lib/piClient.ts?composer-reload=${Date.now()}`, import.meta.url).href
const reloadedPi = await import(reloadedPiUrl) as typeof import('../lib/piClient')
assert.equal(piSessionPathCacheSize(), 1)
assert.equal(reloadedPi.piSessionPathCacheSize(), 1)

console.log('cross-provider composer attachment and lifecycle conformance passed')

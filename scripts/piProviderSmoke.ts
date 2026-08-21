import assert from 'node:assert/strict'
import { appendFile, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  beginPiSessionOperation,
  deletePiSession,
  getPiSessionMessages,
  listPiSessions,
  openPiSessionManager,
  piSessionOperationCount,
  piSessionScopedSettings,
  setPiSessionName,
} from '../lib/piClient'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  mapPiEntriesToSessionMessages,
  mapPiMessagesToSessionMessages,
  piAgentMessageDuplicateKey,
} from '../lib/piMapper'
import { reducePiTurnLifecycle } from '../lib/piTurnLifecycle'
import { buildThreadedMessages } from '../lib/threading'

let lifecycle = reducePiTurnLifecycle(undefined, {
  type: 'agent_end',
  messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'retry me' }],
})
assert.equal(lifecycle.settled, false)
assert.equal(lifecycle.terminalError, 'retry me')
lifecycle = reducePiTurnLifecycle(lifecycle.terminalError, {
  type: 'agent_end',
  messages: [{ role: 'assistant', stopReason: 'stop' }],
})
assert.equal(lifecycle.settled, false, 'agent_end must not close an extension continuation')
assert.equal(lifecycle.terminalError, undefined, 'a successful continuation clears an earlier error')
lifecycle = reducePiTurnLifecycle(lifecycle.terminalError, { type: 'agent_settled' })
assert.equal(lifecycle.settled, true)

const terminalFailure = reducePiTurnLifecycle(
  reducePiTurnLifecycle(undefined, {
    type: 'agent_end',
    messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'terminal failure' }],
  }).terminalError,
  { type: 'agent_settled' },
)
assert.deepEqual(terminalFailure, { settled: true, terminalError: 'terminal failure' })

const releaseTurn = beginPiSessionOperation('operation-test', 'turn')
assert.equal(piSessionOperationCount(), 1)
assert.throws(
  () => beginPiSessionOperation('operation-test', 'delete'),
  /Cannot delete Pi session while turn is active/,
)
releaseTurn()
releaseTurn()
assert.equal(piSessionOperationCount(), 0, 'operation release should be idempotent')
const releaseFork = beginPiSessionOperation('operation-test', 'fork')
releaseFork()
const releaseCompaction = beginPiSessionOperation('operation-test', 'compact')
assert.throws(
  () => beginPiSessionOperation('operation-test', 'turn'),
  /Cannot turn Pi session while compact is active/,
)
releaseCompaction()

const settingsWrites: string[] = []
const settingsFixture = {
  marker: 'bound',
  getMarker() { return this.marker },
  setDefaultModelAndProvider() { settingsWrites.push('model') },
  setDefaultThinkingLevel() { settingsWrites.push('thinking') },
  setTheme() { settingsWrites.push('theme') },
}
const scopedSettings = piSessionScopedSettings(settingsFixture as never) as unknown as typeof settingsFixture
scopedSettings.setDefaultModelAndProvider()
scopedSettings.setDefaultThinkingLevel()
scopedSettings.setTheme()
assert.deepEqual(settingsWrites, ['theme'], 'only legacy implicit model/thinking default writes should be suppressed')
assert.equal(scopedSettings.getMarker(), 'bound', 'forwarded SettingsManager methods must retain their receiver')

const repeatedBashBase = {
  role: 'bashExecution',
  command: 'pwd',
  output: '/tmp',
  exitCode: 0,
  cancelled: false,
  truncated: false,
} as unknown as AgentMessage
assert.equal(
  piAgentMessageDuplicateKey({ ...repeatedBashBase, timestamp: 1 } as AgentMessage),
  piAgentMessageDuplicateKey({ ...repeatedBashBase, timestamp: 2 } as AgentMessage),
  'a final live bash result should converge with its separately timestamped persisted result',
)
assert.notEqual(
  piAgentMessageDuplicateKey(repeatedBashBase),
  piAgentMessageDuplicateKey({ ...repeatedBashBase, output: '/other' } as AgentMessage),
  'repeated commands with different output must remain distinct',
)

const mappedImageResult = mapPiMessagesToSessionMessages('image-session', [{
  role: 'toolResult',
  toolCallId: 'image-call',
  toolName: 'screenshot',
  content: [
    { type: 'text', text: 'captured' },
    { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
  ],
  isError: false,
  timestamp: 1,
} as AgentMessage])
const mappedToolResult = (mappedImageResult[0].message as { content: Array<{ content: unknown }> }).content[0]
assert.deepEqual(mappedToolResult.content, [
  { type: 'text', text: 'captured' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
])

const mappedCustomImage = mapPiMessagesToSessionMessages('image-session', [{
  role: 'custom',
  customType: 'preview',
  display: true,
  content: [{ type: 'image', mimeType: 'image/jpeg', data: 'cHJldmlldw==' }],
  timestamp: 2,
} as AgentMessage])
assert.deepEqual((mappedCustomImage[0].message as { content: unknown }).content, [{
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: 'cHJldmlldw==' },
}])

const mappedToolThread = mapPiEntriesToSessionMessages('tool-session', [
  {
    type: 'session', version: 3, id: 'tool-session', timestamp: '2026-08-21T00:00:00.000Z', cwd: '/tmp',
  },
  {
    type: 'message', id: 'assistant-tool-entry', parentId: null, timestamp: '2026-08-21T00:00:01.000Z',
    message: {
      role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a' } }],
      api: 'anthropic-messages', provider: 'anthropic', model: 'test',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'toolUse', timestamp: 1,
    },
  },
  {
    type: 'message', id: 'tool-result-entry', parentId: 'assistant-tool-entry', timestamp: '2026-08-21T00:00:02.000Z',
    message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 2 },
  },
] as never)
assert.equal(
  buildThreadedMessages(mappedToolThread)[0].providerMessageId,
  'tool-result-entry',
  'forking a rendered tool row must branch after its paired tool result',
)

const root = await mkdtemp(join(tmpdir(), 'agent-viewer-pi-provider-'))
const previousSessionDir = process.env.PI_SESSION_DIR

try {
  process.env.PI_SESSION_DIR = root
  await mkdir(root, { recursive: true })

  const sourceId = '11111111-1111-4111-8111-111111111111'
  const timestamp = '2026-08-21T00:00:00.000Z'
  const sourcePath = join(root, `2026-08-21T00-00-00-000Z_${sourceId}.jsonl`)
  const entries = [
    { type: 'session', version: 3, id: sourceId, timestamp, cwd: root },
    {
      type: 'message',
      id: 'user-entry',
      parentId: null,
      timestamp,
      message: { role: 'user', content: 'hello', timestamp: Date.parse(timestamp) },
    },
    {
      type: 'message',
      id: 'assistant-entry',
      parentId: 'user-entry',
      timestamp,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test-model',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.parse(timestamp),
      },
    },
  ]
  await writeFile(sourcePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)

  const firstList = await listPiSessions()
  assert.deepEqual(firstList.map((session) => session.id), [sourceId], 'custom PI_SESSION_DIR should be listed')
  const cachedList = await listPiSessions()
  assert.strictEqual(cachedList, firstList, 'duplicate list reads should reuse the short-lived cache')

  const firstMessages = await getPiSessionMessages(sourceId)
  const cachedMessages = await getPiSessionMessages(sourceId)
  assert.equal(firstMessages.length, 2)
  assert.strictEqual(cachedMessages[0], firstMessages[0], 'unchanged transcript reads should reuse parsed messages')

  await appendFile(sourcePath, `${JSON.stringify({
    type: 'message',
    id: 'second-user-entry',
    parentId: 'assistant-entry',
    timestamp: '2026-08-21T00:00:01.000Z',
    message: { role: 'user', content: 'again', timestamp: Date.parse(timestamp) + 1_000 },
  })}\n`)
  const refreshedMessages = await getPiSessionMessages(sourceId)
  assert.equal(refreshedMessages.length, 3, 'a changed JSONL stat should invalidate the parsed transcript cache')

  const movedSourcePath = join(root, `2026-08-21T00-00-02-000Z_${sourceId}.jsonl`)
  await rename(sourcePath, movedSourcePath)
  const messagesAfterMove = await getPiSessionMessages(sourceId)
  assert.equal(messagesAfterMove.length, 3, 'a stale cached path should recover after native Pi moves a session file')
  assert.equal((await openPiSessionManager(sourceId)).getSessionId(), sourceId)

  const { forkViewSession, listViewSessionMessages, streamViewSessionTurn } = await import('../lib/sessionBackend')
  const beforeBranchSwitch = await listViewSessionMessages(sourceId, { offset: 0, limit: 20 }, 'pi')
  assert.equal((beforeBranchSwitch.at(-1)?.message as { content?: unknown }).content, 'again')
  await appendFile(movedSourcePath, `${JSON.stringify({
    type: 'message',
    id: 'alternate-user-entry',
    parentId: 'assistant-entry',
    timestamp: '2026-08-21T00:00:03.000Z',
    message: { role: 'user', content: 'alternate branch', timestamp: Date.parse(timestamp) + 3_000 },
  })}\n`)
  const afterBranchSwitch = await listViewSessionMessages(sourceId, { offset: 0, limit: 20 }, 'pi')
  assert.equal(afterBranchSwitch.length, beforeBranchSwitch.length, 'alternate branch fixture should retain depth')
  assert.equal(
    (afterBranchSwitch.at(-1)?.message as { content?: unknown }).content,
    'alternate branch',
    'same-depth native branch switches must invalidate the mapped transcript cache',
  )
  const forkTarget = afterBranchSwitch.find((message) => message.providerMessageId === 'assistant-entry')
  assert.ok(forkTarget)
  assert.match(forkTarget.uuid, /assistant-entry$/, 'persisted Pi UUIDs should remain anchored to entry ids')

  const aborted = new AbortController()
  aborted.abort()
  const abortedResponse = await streamViewSessionTurn({
    sessionId: sourceId,
    provider: 'pi',
    signal: aborted.signal,
    body: { message: 'must not be submitted' },
  })
  const abortedFrames = await abortedResponse.text()
  assert.match(abortedFrames, /^:ok\n\n/)
  assert.doesNotMatch(abortedFrames, /event: error/, 'an expected early abort should close quietly')
  assert.equal(piSessionOperationCount(), 0, 'an early abort must release the turn reservation')
  assert.equal((await getPiSessionMessages(sourceId)).length, 3, 'an early abort must not append a user message')

  const helpResponse = await streamViewSessionTurn({
    sessionId: sourceId,
    provider: 'pi',
    signal: new AbortController().signal,
    body: { message: '/help' },
  })
  const helpFrames = await helpResponse.text()
  assert.match(helpFrames, /Pi commands:/)
  assert.equal(piSessionOperationCount(), 0, 'native Pi commands must release the turn reservation')

  for (let index = 0; index < 2; index += 1) {
    const shellResponse = await streamViewSessionTurn({
      sessionId: sourceId,
      provider: 'pi',
      signal: new AbortController().signal,
      body: { message: "!printf 'pi-shell-output'" },
    })
    const shellFrames = await shellResponse.text()
    assert.match(shellFrames, /pi_bash_delta/)
    assert.match(shellFrames, /pi-shell-output/)
    assert.equal(piSessionOperationCount(), 0, 'direct Pi shell turns must release the turn reservation')
  }
  const afterShellMessages = await listViewSessionMessages(sourceId, { offset: 0, limit: 50 }, 'pi')
  const persistedShellEntries = afterShellMessages.filter((message) => {
    const content = (message.message as { content?: unknown }).content
    return Array.isArray(content) && content.some((block) => (
      typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_use'
      && 'name' in block && block.name === 'bash'
    ))
  })
  assert.equal(persistedShellEntries.length, 2, 'identical direct shell commands must persist as distinct entries')
  assert.notEqual(persistedShellEntries[0].uuid, persistedShellEntries[1].uuid)

  await setPiSessionName(sourceId, 'Viewer and Pi title')
  assert.equal((await openPiSessionManager(sourceId)).getSessionName(), 'Viewer and Pi title')
  await setPiSessionName(sourceId, '')
  assert.equal((await openPiSessionManager(sourceId)).getSessionName(), undefined, 'empty native names should clear')

  const { sessionId: forkedId } = await forkViewSession({
    sessionId: sourceId,
    provider: 'pi',
    body: { upToMessageId: forkTarget.providerMessageId },
  })
  assert.ok(forkedId)
  assert.notEqual(forkedId, sourceId)
  assert.match(forkedId, /^[0-9a-f-]{36}$/i, 'fork should return the header id, not the timestamped filename')

  const { sessionId: wholeSessionForkId } = await forkViewSession({
    sessionId: sourceId,
    provider: 'pi',
    body: {},
  })
  assert.match(wholeSessionForkId, /^[0-9a-f-]{36}$/i, 'whole-session Pi fork should use the active leaf')

  const afterFork = await listPiSessions()
  assert.deepEqual(new Set(afterFork.map((session) => session.id)), new Set([sourceId, forkedId, wholeSessionForkId]))

  await deletePiSession(forkedId)
  await deletePiSession(wholeSessionForkId)
  const afterDelete = await listPiSessions()
  assert.deepEqual(afterDelete.map((session) => session.id), [sourceId])
} finally {
  if (previousSessionDir === undefined) delete process.env.PI_SESSION_DIR
  else process.env.PI_SESSION_DIR = previousSessionDir
  await rm(root, { recursive: true, force: true })
}

console.log('Pi provider reliability smoke passed')

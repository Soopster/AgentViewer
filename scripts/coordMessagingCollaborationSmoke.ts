import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatInbox, formatProtocolMailboxMessage, type ProtocolMessage, type ExternalProtocolInboxResult } from '../lib/agentProtocol'
import { COORD_TOOL_SPECS } from '../lib/coordinatorToolContract.mjs'

const sample: ProtocolMessage = {
  id: 'original-request', runId: 'fixture', fromAgentId: 'lead', toAgentId: 'worker',
  body: 'Choose the strict parser', kind: 'request', priority: 'urgent', replyRequired: true,
  correlationId: 'parser-thread', inReplyTo: 'previous-request', createdAt: new Date().toISOString(),
}
for (const rendered of [formatInbox([sample], new Map()), formatProtocolMailboxMessage(sample, 'lead')]) {
  for (const expected of ['original-request', 'priority=urgent', 'URGENT', 'reply-required', 'correlation_id=parser-thread', 'in_reply_to=previous-request']) {
    assert.ok(rendered.includes(expected), `delivery retains ${expected}`)
  }
}
const overflow = Array.from({ length: 7 }, (_, i) => ({ ...sample, id: `overflow-${i}`, replyRequired: false, priority: 'normal' as const, body: 'x'.repeat(7000) }))
const digest = formatInbox(overflow, new Map())
assert.ok(digest.includes('shortened to one line'))
for (const message of overflow) assert.ok(digest.includes(message.id), 'even truncated/digested mail retains its reply id')

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-messaging-collaboration-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const inboxTool = COORD_TOOL_SPECS.find(spec => spec.name === 'coord_read_inbox')!
assert.equal(inboxTool.fields.unresolved.t, 'boolean')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Mailbox collaboration', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
try {
  const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant
  const outsider = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'outsider' })).participant
  let key = 0
  const read = (args: Record<string, unknown> = {}, identity = worker) => execute({
    ...identity, action: inboxTool.action,
    ...inboxTool.mapArgs({ request_id: `mail-read-${++key}`, ...args }),
  }) as Promise<ExternalProtocolInboxResult>
  const task = (await coord.createExternalProtocolTask(lead, { assignTo: worker.agentId, title: 'Answer before completing', detail: 'No edits required', paths: [] })).task!
  await read() // assignment notification
  await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: 'Required status must be immediately answerable', kind: 'status', priority: 'urgent', replyRequired: true })
  const first = await read({ request_id: 'required-delivery' })
  assert.equal(first.messages.length, 1, 'required status bypasses batch delay')
  const original = first.messages[0]!
  assert.ok(!original.id.startsWith('status-summary:'), 'required message keeps persisted id')
  assert.equal(original.priority, 'urgent')
  assert.equal(original.replyRequired, true)
  assert.equal(JSON.stringify(await read({ request_id: 'required-delivery' })), JSON.stringify(first), 'keyed retry returns exact original wire delivery')
  assert.equal((await read()).messages.length, 0, 'ordinary reads retain unread-only semantics')
  const recovered = await read({ unresolved: true })
  assert.equal(recovered.messages[0]?.id, original.id, 'new read recovers acknowledged obligation')
  assert.deepEqual(recovered.acknowledged, [], 'unresolved mode has no acknowledgement side effect')
  assert.equal((await read({ unresolved: true }, outsider)).messages.length, 0, 'unresolved retrieval is recipient scoped')
  const restartRead = execFileSync(process.execPath, ['--eval', `
    const coord = await import(${JSON.stringify(fileURLToPath(new URL('../lib/agentCoordination.ts', import.meta.url)))});
    const result = await coord.readExternalProtocolInbox(${JSON.stringify(worker)}, { unresolved: true });
    console.log(JSON.stringify(result));
  `], { cwd, encoding: 'utf8' })
  assert.equal(JSON.parse(restartRead).messages[0]?.id, original.id, 'a fresh process recovers the acknowledged obligation from the ledger')

  await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: 'Second required request', replyRequired: true })
  const page1 = await read({ unresolved: true, limit: 1 })
  const page2 = await read({ unresolved: true, limit: 1, after: page1.nextCursor })
  assert.equal(page1.messages.length, 1)
  assert.equal(page2.messages.length, 1)
  assert.notEqual(page1.messages[0]!.id, page2.messages[0]!.id, 'unresolved cursor advances')
  assert.equal((await read({ unresolved: true, after: page2.nextCursor })).messages.length, 0)
  await assert.rejects(coord.completeExternalProtocolTask(worker, { taskId: task.id, summary: 'Premature', filesChanged: [], commandsRun: [] }), /Unanswered reply-required messages/, 'successful completion requires answering obligations')
  for (const message of [page1.messages[0]!, page2.messages[0]!]) {
    await coord.sendExternalProtocolMessage(worker, { to: 'lead', body: 'Use strict parser', kind: 'response', inReplyTo: message.id })
  }
  assert.equal((await read({ unresolved: true })).messages.length, 0, 'correlated replies resolve recovered obligations')
  await read() // consume the second request's normal delivery before status test

  await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: 'Urgent status without an obligation', kind: 'status', priority: 'urgent' })
  const urgentStatus = (await read()).messages[0]!
  assert.equal(urgentStatus.body, 'Urgent status without an obligation')
  assert.equal(urgentStatus.priority, 'urgent')
  assert.ok(!urgentStatus.id.startsWith('status-summary:'))
  await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: 'Required status without urgency', kind: 'status', replyRequired: true })
  const requiredStatus = (await read()).messages[0]!
  assert.equal(requiredStatus.body, 'Required status without urgency')
  assert.equal(requiredStatus.replyRequired, true)
  await coord.sendExternalProtocolMessage(worker, { to: 'lead', body: 'Status reply', kind: 'status', inReplyTo: requiredStatus.id })
  const statusReply = (await coord.readExternalProtocolInbox(lead)).messages.find(message => message.inReplyTo === requiredStatus.id)!
  assert.ok(statusReply, 'a correlated status reply bypasses delay')
  assert.ok(!statusReply.id.startsWith('status-summary:'), 'a correlated status reply retains its persisted identity')

  for (let i = 0; i < 3; i++) await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: `Progress ${i}`, kind: 'status' })
  const batch = await read()
  assert.equal(batch.messages.length, 1, 'ordinary status still batches')
  assert.equal(batch.messages[0]!.batchedMessageIds?.length, 3)
  assert.equal(batch.messages[0]!.replyRequired, false)
  const runtime = await import('../lib/sessionRuntime')
  const live = await coord.joinSessionToCoordinatorRun({ runId: lead.runId, sessionId: 'live-mailbox', provider: 'codex', cwd, name: 'live' })
  let steering = ''
  runtime.setRunningSession('live-mailbox', { provider: 'codex', interrupt: async () => {}, steer: async text => { steering = text } })
  try {
    await coord.sendExternalProtocolMessage(lead, { to: 'live', body: 'Live question', kind: 'status', priority: 'urgent', replyRequired: true, correlationId: 'live-thread' })
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const delivered = (await coord.readProtocolRun(lead.runId))!.messages.some(message => message.toAgentId === live.agentId && message.body === 'Live question' && message.deliveredAt)
      if (steering && delivered) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const liveMessage = (await coord.readProtocolRun(lead.runId))!.messages.find(message => message.toAgentId === live.agentId && message.body === 'Live question')!
    assert.equal(steering, formatProtocolMailboxMessage(liveMessage, 'lead'), 'actual live delivery uses the same structured formatter as inbox injection')
    assert.ok(liveMessage.deliveredAt, 'successful live steering acknowledges delivery')
    assert.equal(liveMessage.resolvedAt, undefined, 'live steering does not resolve the obligation')
    await coord.recordProtocolEvent({ version: '1.0', runId: lead.runId, agentId: live.agentId, type: 'message', to: 'lead', summary: 'Answered live', payload: { inReplyTo: liveMessage.id } })
  } finally { runtime.clearRunningSession('live-mailbox') }
  const completed = await coord.completeExternalProtocolTask(worker, { taskId: task.id, summary: 'Answered all obligations', filesChanged: [], commandsRun: [] })
  assert.equal(completed.accepted, true)
  console.log('Messaging collaboration: IDs/metadata, actionable status, keyed replay, restart recovery, recipient-scoped unresolved pagination, correlated resolution, live steering and completion guard passed')
} finally {
  await coord.stopProtocolRun(lead.runId)
}

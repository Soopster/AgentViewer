import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { COORD_TOOL_SPECS } from '../lib/coordinatorToolContract.mjs'

const completion = COORD_TOOL_SPECS.find(spec => spec.name === 'coord_complete_task')!
const args = { task_id: 'task-1', summary: 'Done' }
for (const value of ['', '{broken', '{}', 'null', '[null]', '[{}]', '[{"question":" "}]', '[{"question":"Choose?","status":"typo"}]']) {
  assert.throws(() => completion.mapArgs({ ...args, needs_decision_json: value }), /needs_decision_json|needsDecision/)
}
const overflow = Array.from({ length: 21 }, (_, index) => ({ question: `Question ${index}` }))
assert.throws(() => completion.mapArgs({ ...args, needs_decision_json: JSON.stringify(overflow) }), /at most 20/)
assert.equal(completion.mapArgs(args).needsDecision, undefined)
assert.deepEqual(completion.mapArgs({ ...args, needs_decision_json: '[]' }).needsDecision, [])

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-completion-contract-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Completion contract', provider: 'codex', baseCwd: cwd, participantName: 'lead', autonomy: 'medium' })).participant
try {
  const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant
  const task = (await coord.createExternalProtocolTask(lead, { assignTo: worker.agentId, title: 'Decision receipt', detail: 'Keep unresolved decisions visible', paths: [] })).task!
  const body = { ...worker, action: 'complete_task', taskId: task.id, summary: 'Ready', requestId: 'completion-attempt' }
  for (const needsDecision of [null, {}, [null], [{}], overflow]) {
    await assert.rejects(execute({ ...body, needsDecision }), /needsDecision/)
    const unchanged = (await coord.readExternalProtocolRun(lead)).tasks.find(entry => entry.id === task.id)!
    assert.equal(unchanged.status, 'claimed', 'invalid receipts cannot complete the task')
    assert.equal(unchanged.receipt, undefined, 'validation happens before receipt persistence')
  }
  // The same request key is usable after correcting an invalid argument: no
  // mutation was reserved before the validation failure.
  const mapped = completion.mapArgs({ task_id: task.id, summary: 'Needs a choice', request_id: 'completion-attempt', needs_decision_json: '[{"question":"Which parser?"}]' })
  const result = await execute({ ...worker, action: completion.action, ...mapped }) as { accepted: boolean }
  assert.equal(result.accepted, false, 'a valid unresolved decision still hits the autonomy gate')
  const recorded = (await coord.readExternalProtocolRun(lead)).tasks.find(entry => entry.id === task.id)!
  assert.equal(recorded.receipt?.needsDecision[0]?.question, 'Which parser?')
  assert.equal(recorded.receipt?.needsDecision[0]?.status, 'open')
  await coord.resolveExternalProtocolDecision(lead, { taskId: task.id, decisionId: recorded.receipt!.needsDecision[0]!.id, answer: 'Use the strict parser' })
  const resolved = (await coord.readExternalProtocolRun(lead)).tasks.find(entry => entry.id === task.id)!
  const answered = await execute({ ...body, requestId: 'answered-decision', needsDecision: resolved.receipt!.needsDecision }) as { accepted: boolean }
  assert.equal(answered.accepted, true, 'lead-resolved decisions can be included in a completed receipt')
  const emptyTask = (await coord.createExternalProtocolTask(lead, { assignTo: worker.agentId, title: 'No decisions', detail: 'Verify empty receipt', paths: [] })).task!
  const completed = await execute({ ...body, taskId: emptyTask.id, requestId: 'no-decisions', needsDecision: [] }) as { accepted: boolean }
  assert.equal(completed.accepted, true, 'an explicit empty decision receipt remains supported')
  console.log('Completion contract: invalid JSON/shape/overflow rejected before mutation; corrected request, persisted open decision gate, and empty receipt passed')
} finally {
  await coord.stopProtocolRun(lead.runId)
}

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-task-inspection-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Long run task reads', provider: 'codex', baseCwd: cwd, participantName: 'lead', maxAgents: 3 })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant
const privatePeer = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'peer' })).participant
const secretMail = 'private-mail-not-part-of-task-inspection'
await coord.sendExternalProtocolMessage(worker, { to: privatePeer.agentId, body: secretMail })
const longPrompt = 'Full original prompt. '.repeat(300).trim()
const longResult = 'Full verified detail. '.repeat(300).trim()
const old = (await coord.createExternalProtocolTask(lead, { title: 'Old verified result', detail: longPrompt, targetRole: 'teammate' })).task!
await coord.claimExternalProtocolTask(worker, old.id)
assert.equal((await coord.completeExternalProtocolTask(worker, { taskId: old.id, summary: 'Verified old result', detail: longResult, commandsRun: ['manual fixture assertion'] })).accepted, true)
const created = [old.id]
for (let i = 0; i < 25; i++) {
  const task = (await coord.createExternalProtocolTask(lead, { title: `Later task ${i}`, detail: 'Outcome fixture', targetRole: 'teammate' })).task!
  created.push(task.id)
  await coord.claimExternalProtocolTask(worker, task.id)
  await coord.failExternalProtocolTask(worker, { taskId: task.id, summary: `Known fixture failure ${i}` })
}
assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.tasks.find(task => task.id === old.id)?.receipt, undefined, 'ordinary status omits receipts outside its terminal detail window')
const { Database } = await (0, eval)('import("bun:sqlite")')
const fixtureDb = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
fixtureDb.query('UPDATE protocol_tasks SET claude_agent_policy_json = ? WHERE run_id = ? AND id = ?').run(JSON.stringify({ permissionMode: 'default', env: { PRIVATE_DISPATCH_VALUE: 'private-policy-secret' } }), lead.runId, old.id)
fixtureDb.close()
const full = await execute({ ...worker, action: 'read_task', taskId: old.id }) as Awaited<ReturnType<typeof coord.readExternalProtocolTask>>
assert.equal(full.task.prompt, longPrompt)
assert.equal(full.task.resultDetail, longResult)
assert.deepEqual(full.task.receipt!.commandsRun, ['manual fixture assertion'])
assert.equal(JSON.stringify(full).includes(secretMail), false)
assert.equal('claudeAgentPolicy' in full.task, false, 'private dispatch policy is not exposed by exact task reads')
assert.equal(JSON.stringify(full).includes('private-policy-secret'), false)
assert.equal(JSON.stringify(full).includes(worker.token), false)
assert.ok(full.claimGeneration > 0)
assert.equal(full.revision.length, 64)
await assert.rejects(execute({ ...lead, token: 'wrong', action: 'read_task', taskId: old.id }), /Invalid Coordinator participant/)
const other = (await coord.createExternalProtocolRun({ prompt: 'Another run', provider: 'codex', baseCwd: cwd, participantName: 'other-lead' })).participant
await assert.rejects(execute({ ...other, action: 'read_task', taskId: old.id }), /not found/)
const seen: string[] = []
let cursor: string | undefined
let firstCursor: string | undefined
for (;;) {
  const page = await execute({ ...lead, action: 'list_tasks', limit: 7, cursor }) as Awaited<ReturnType<typeof coord.listExternalProtocolTasks>>
  assert.ok(page.tasks.length <= 7)
  assert.equal(JSON.stringify(page).includes(longPrompt), false, 'listing is compact')
  seen.push(...page.tasks.map(task => task.id))
  if (!page.hasMore) { assert.equal(page.nextCursor, null); break }
  cursor = page.nextCursor!
  firstCursor ??= cursor
}
assert.deepEqual(seen, created, 'keyset pages contain every task exactly once')
await assert.rejects(execute({ ...other, action: 'list_tasks', cursor: firstCursor }), /another run or filter/)
await assert.rejects(execute({ ...lead, action: 'list_tasks', cursor: firstCursor, status: 'failed' }), /another run or filter/)
await assert.rejects(execute({ ...lead, action: 'list_tasks', cursor: 'not-json' }), /Invalid task cursor/)
await assert.rejects(execute({ ...lead, action: 'list_tasks', status: 'invented' }), /Invalid task status/)
await assert.rejects(execute({ ...lead, action: 'list_tasks', limit: 0 }), /Task limit/)
const completed = await execute({ ...lead, action: 'list_tasks', status: 'completed' }) as Awaited<ReturnType<typeof coord.listExternalProtocolTasks>>
assert.deepEqual(completed.tasks.map(task => task.id), [old.id])
console.log('Task inspection passed: old full receipt/result, compact keyset pagination, filters, scope/authentication and mailbox/token privacy.')
process.exit(0)

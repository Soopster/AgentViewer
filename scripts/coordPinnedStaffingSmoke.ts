import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-pinned-staffing-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
execFileSync('git', ['config', 'user.name', 'Smoke'])
execFileSync('git', ['config', 'user.email', 'smoke@example.test'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
const { Database } = await (0, eval)('import("bun:sqlite")')
const instances = await import('../lib/providerInstances')
await instances.writeProviderInstancesFile({ version: 1, instances: [{ id: 'claude-staffing', provider: 'claude' }] })
let created = 0
let replacementAttempts = 0
let duringReplacement: (() => void) | undefined
const turns = new Map<string, () => void>()
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
  createNewViewSession: async ({ provider, cwd }: { provider: string; cwd: string }) => {
    if (provider === 'claude' && ++replacementAttempts === 1) throw new Error('fixture replacement unavailable')
    if (provider === 'claude') duringReplacement?.()
    return { provider, sessionId: `fixture-staffing-${++created}`, cwd, isPending: false }
  },
  streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => new Response(new ReadableStream({
    start(stream) { turns.set(sessionId, () => { turns.delete(sessionId); stream.close() }) },
  })),
}))
const coord = await import('../lib/agentCoordination')
const { readExternalCoordinatorResultReview, readExternalCoordinatorResultDiff, integrateExternalCoordinatorResult } = await import('../lib/coordinatorResultReviewServer')
const { coordinatorCheckoutRevision } = await import('../lib/coordinatorResultGit')
const { executeExternalCoordinatorAction } = await import('../lib/agentCoordinationExternal')
const recipe = { name: 'pinned-staffing', maxAgents: 2, phases: [{ title: 'Work', tasks: [
  { key: 'first', title: 'Create evidence', detail: 'Write artifact.txt', paths: ['artifact.txt'], provider: 'codex' },
  { title: 'Review evidence', detail: 'Review the first result', provider: 'claude', dependsOn: ['first'] },
] }] }
await coord.writeRunPlaybook(cwd, recipe)
execFileSync('git', ['add', '.agent-viewer/playbooks'])
execFileSync('git', ['commit', '-qm', 'Save fixture workflow'])
const preview = await coord.previewInteractiveWorkflow({ cwd, name: recipe.name, provider: 'codex' })
assert.deepEqual(preview.providers, ['codex', 'claude'], 'distinct sequential routes fit one reusable teammate slot')
const { snapshot: initial } = await coord.startProtocolRun({
  provider: 'codex', prompt: 'Verify sequential routing', baseCwd: cwd, playbookName: recipe.name,
})
const runId = initial.run.id
const controller = globalThis.__agentViewerCoordinatorControllers!.get(runId)!
const lead = controller.sdkIdentities.get('lead')!
const database = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
const until = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('staffing fixture did not settle')
}
const read = async () => (await coord.readProtocolRun(runId))!
try {
  await until(() => turns.has('fixture-staffing-2'))
  const firstWorker = (await read()).agents.find(agent => agent.role === 'teammate')!
  const oldIdentity = controller.sdkIdentities.get(firstWorker.id)!
  database.query('UPDATE protocol_tasks SET requested_provider_instance_id = ? WHERE run_id = ? AND id = ?')
    .run('claude-staffing', runId, 'task-2')
  const file = path.join(firstWorker.worktreePath, 'artifact.txt')
  writeFileSync(file, 'durable first result\n')
  const completed = await coord.completeExternalProtocolTask(oldIdentity, {
    taskId: 'task-1', summary: 'First result', filesChanged: ['artifact.txt'],
  })
  assert.equal(completed.accepted, true)
  await coord.runProtocolMaintenanceSweep()
  assert.equal(replacementAttempts, 0, 'a live execution cannot be retired after its receipt arrives')
  turns.get(firstWorker.sessionId)!()
  await until(async () => (await read()).agents.some(agent => agent.id === firstWorker.id && agent.status === 'done'))
  await coord.runProtocolMaintenanceSweep()
  assert.equal(replacementAttempts, 0, 'a completed isolated result still needs integration')
  assert.deepEqual((await coord.readExternalProtocolActionableStatus(lead)).actionable.awaitingIntegration?.map(entry => entry.taskId), ['task-2'])
  database.query('UPDATE protocol_runs SET require_review = 1 WHERE id = ?').run(runId)
  assert.match((await coord.readExternalProtocolActionableStatus(lead)).actionable.awaitingIntegration?.[0]?.reason ?? '', /run-wide review/)
  database.query('UPDATE protocol_runs SET require_review = 0 WHERE id = ?').run(runId)
  const review = await readExternalCoordinatorResultReview(lead, 'task-1')
  assert.ok(review.checkout, review.integrationBlockers.join(' '))
  assert.equal((await integrateExternalCoordinatorResult(lead, 'task-1', review.checkout.token, 'stage-task-1')).staged, true)
  await coord.runProtocolMaintenanceSweep()
  assert.equal(replacementAttempts, 0, 'staging alone cannot start the dependent')
  writeFileSync(path.join(cwd, 'artifact.txt'), 'wrong result\n')
  execFileSync('git', ['add', 'artifact.txt'])
  execFileSync('git', ['commit', '-qm', 'Commit a different tree'])
  await coord.runProtocolMaintenanceSweep()
  assert.equal(replacementAttempts, 0, 'a different committed tree cannot start the dependent')
  writeFileSync(path.join(cwd, 'artifact.txt'), 'durable first result\n')
  execFileSync('git', ['add', 'artifact.txt'])
  execFileSync('git', ['commit', '-qm', 'Commit the reviewed tree'])
  assert.equal((await coord.readExternalProtocolActionableStatus(lead)).actionable.awaitingIntegration, undefined)
  await coord.runProtocolMaintenanceSweep()
  await until(async () => (await read()).events.some(event => event.summary?.includes('fixture replacement unavailable')))
  await until(() => Boolean(controller.pinnedStaffingRetryAt?.has('claude-staffing')))
  assert.equal((await coord.readExternalProtocolStatus(oldIdentity)).actionable.runStatus, 'running')
  assert.equal((await coord.readExternalProtocolTask(lead, 'task-2')).task.status, 'pending')

  // Closing the gate while provider creation is in flight must undo the swap.
  duringReplacement = () => database.query("UPDATE protocol_runs SET status = 'blocked' WHERE id = ?").run(runId)
  controller.pinnedStaffingRetryAt!.clear()
  await coord.runProtocolMaintenanceSweep()
  assert.equal(replacementAttempts, 2)
  assert.equal((await coord.readExternalProtocolStatus(oldIdentity)).actionable.runStatus, 'blocked')
  assert.equal((await read()).agents.filter(agent => agent.role === 'teammate').length, 1)
  assert.equal((await coord.readExternalProtocolTask(lead, 'task-2')).task.status, 'pending')

  duringReplacement = undefined
  database.query("UPDATE protocol_runs SET status = 'running' WHERE id = ?").run(runId)
  controller.pinnedStaffingRetryAt!.clear()
  await Promise.all([coord.runProtocolMaintenanceSweep(), coord.runProtocolMaintenanceSweep()])
  const snapshot = await read()
  const replacement = snapshot.agents.find(agent => agent.provider === 'claude')!
  assert.equal(replacementAttempts, 3, 'concurrent sweeps staff the lane once')
  assert.equal(snapshot.agents.filter(agent => agent.role === 'teammate' && agent.status !== 'stopped').length, 1)
  assert.equal(snapshot.agents.find(agent => agent.id === firstWorker.id)?.status, 'stopped')
  assert.equal(snapshot.tasks.find(task => task.id === 'task-2')?.ownerAgentId, replacement.id)
  assert.equal(replacement.providerInstanceId, 'claude-staffing')
  assert.equal(snapshot.tasks.find(task => task.id === 'task-1')?.ownerAgentId, firstWorker.id)
  assert.equal(snapshot.tasks.find(task => task.id === 'task-1')?.receipt?.actualProvider, 'codex')
  assert.equal(readFileSync(file, 'utf8'), 'durable first result\n')
  assert.equal(readFileSync(path.join(replacement.worktreePath, 'artifact.txt'), 'utf8'), 'durable first result\n')
  const result = await readExternalCoordinatorResultReview(lead, 'task-1')
  assert.equal(result.checkout?.path, firstWorker.worktreePath)
  assert.ok(result.checkout?.files.includes('artifact.txt'))
  await assert.rejects(coord.readExternalProtocolStatus(oldIdentity), /Invalid Coordinator participant capability/)
  await until(() => turns.has(replacement.sessionId))
} finally {
  database.close()
  await coord.stopProtocolRun(runId)
  for (const close of turns.values()) close()
}

const reviewedRecipe = { name: 'reviewed-staffing', maxAgents: 2, requireReview: true, phases: [{ title: 'Work', tasks: [
  { key: 'first', title: 'Create prerequisite', detail: 'Write prerequisite.txt', paths: ['prerequisite.txt'], verifyCommands: ['git diff --check'], provider: 'codex' },
  { key: 'inspect', title: 'Inspect prerequisite', detail: 'Read prerequisite.txt without editing', paths: ['prerequisite.txt'], provider: 'claude', dependsOn: ['first'] },
  { title: 'Use prerequisite', detail: 'Write downstream.txt', paths: ['downstream.txt'], provider: 'codex', dependsOn: ['inspect'] },
] }] }
await coord.writeRunPlaybook(cwd, reviewedRecipe)
execFileSync('git', ['add', '.agent-viewer/playbooks'])
execFileSync('git', ['commit', '-qm', 'Save reviewed workflow'])
const { snapshot: reviewed } = await coord.startProtocolRun({
  provider: 'codex', prompt: 'Test dependency integration before final review', baseCwd: cwd, playbookName: reviewedRecipe.name,
})
const reviewedRunId = reviewed.run.id
const reviewedController = globalThis.__agentViewerCoordinatorControllers!.get(reviewedRunId)!
const reviewer = reviewedController.sdkIdentities.get('lead')!
const readReviewed = async () => (await coord.readProtocolRun(reviewedRunId))!
try {
  await until(async () => (await readReviewed()).agents.some(agent => agent.role === 'teammate' && turns.has(agent.sessionId)))
  const first = (await readReviewed()).agents.find(agent => agent.role === 'teammate')!
  writeFileSync(path.join(first.worktreePath, 'prerequisite.txt'), 'reviewed prerequisite\n')
  assert.equal((await coord.completeExternalProtocolTask(reviewedController.sdkIdentities.get(first.id)!, {
    taskId: 'task-1', summary: 'Prerequisite written', filesChanged: ['prerequisite.txt'],
  })).accepted, true)
  turns.get(first.sessionId)!()
  await until(async () => (await readReviewed()).agents.some(agent => agent.id === first.id && agent.status === 'done'))
  const target = await readExternalCoordinatorResultReview(reviewer, 'task-1')
  assert.match(target.integrationBlockers.join(' '), /run review is not approved/)
  await assert.rejects(integrateExternalCoordinatorResult(reviewer, 'task-1', target.checkout!.token, 'early-main'), /run review is not approved/)
  await assert.rejects(coord.reviewProtocolRunAdmin(reviewedRunId, { approved: true, summary: 'Early approval' }), /every task to be terminal/)
  writeFileSync('staged-local.txt', 'keep staged\n')
  execFileSync('git', ['add', 'staged-local.txt'])
  writeFileSync('untracked-local.txt', 'keep untracked\n')
  const before = await coordinatorCheckoutRevision(cwd)
  const sourceBefore = await coordinatorCheckoutRevision(first.worktreePath)
  const dependency = await readExternalCoordinatorResultReview(reviewer, 'task-1', false, 'dependencies')
  assert.deepEqual(dependency.integrationBlockers, [])
  assert.equal(dependency.verification, 'current')
  assert.notEqual(dependency.checkout!.token, target.checkout!.token)
  const diff = await readExternalCoordinatorResultDiff(reviewer, {
    taskId: 'task-1', destination: 'dependencies', reviewToken: dependency.checkout!.token, file: 'prerequisite.txt',
  })
  assert.match(diff.diff, /\+reviewed prerequisite/)
  await assert.rejects(readExternalCoordinatorResultDiff(reviewer, {
    taskId: 'task-1', reviewToken: dependency.checkout!.token,
  }), /changed since review/)
  const publish = () => executeExternalCoordinatorAction({
    ...reviewer, action: 'integrate_result', taskId: 'task-1', reviewToken: dependency.checkout!.token,
    requestId: 'publish-prerequisite', destination: 'dependencies',
  }) as ReturnType<typeof integrateExternalCoordinatorResult>
  const published = await publish()
  assert.ok(published.dependency)
  assert.deepEqual(await publish(), published, 'retry returns the exact published dependency')
  assert.equal(await coordinatorCheckoutRevision(cwd), before)
  assert.equal(await coordinatorCheckoutRevision(first.worktreePath), sourceBefore)
  assert.equal((await readReviewed()).run.review.status, 'pending')
  assert.equal((await coord.readExternalProtocolActionableStatus(reviewer)).actionable.awaitingIntegration, undefined)
  await coord.runProtocolMaintenanceSweep()
  await until(async () => (await readReviewed()).agents.some(agent => agent.provider === 'claude' && turns.has(agent.sessionId)))
  const inspection = (await readReviewed()).agents.find(agent => agent.provider === 'claude')!
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: inspection.worktreePath, encoding: 'utf8' }).trim(), published.dependency.commit)
  assert.equal(readFileSync(path.join(inspection.worktreePath, 'prerequisite.txt'), 'utf8'), 'reviewed prerequisite\n')
  assert.equal((await coord.completeExternalProtocolTask(reviewedController.sdkIdentities.get(inspection.id)!, {
    taskId: 'task-2', summary: 'Prerequisite inspected',
  })).accepted, true)
  turns.get(inspection.sessionId)!()
  assert.equal((await readReviewed()).tasks.find(task => task.id === 'task-2')!.receipt!.requiresIntegration, undefined)
  await until(async () => (await readReviewed()).agents.some(agent => agent.provider === 'codex' && agent.role === 'teammate' && turns.has(agent.sessionId)))
  const next = (await readReviewed()).agents.find(agent => agent.provider === 'codex' && agent.role === 'teammate' && turns.has(agent.sessionId))!
  assert.equal(readFileSync(path.join(next.worktreePath, 'prerequisite.txt'), 'utf8'), 'reviewed prerequisite\n')
  writeFileSync(path.join(next.worktreePath, 'downstream.txt'), 'built with prerequisite\n')
  assert.equal((await coord.completeExternalProtocolTask(reviewedController.sdkIdentities.get(next.id)!, {
    taskId: 'task-3', summary: 'Downstream result', filesChanged: ['downstream.txt'],
  })).accepted, true)
  turns.get(next.sessionId)!()
  await until(async () => (await readReviewed()).agents.some(agent => agent.id === next.id && agent.status === 'done'))
  assert.match((await readExternalCoordinatorResultReview(reviewer, 'task-3')).integrationBlockers.join(' '), /run review is not approved/)
  execFileSync('git', ['add', 'untracked-local.txt'])
  execFileSync('git', ['commit', '-qm', 'Save local fixture state'])
  await coord.reviewProtocolRunAdmin(reviewedRunId, { approved: true, summary: 'Final review approved' })
  const final = await readExternalCoordinatorResultReview(reviewer, 'task-3')
  assert.deepEqual(final.integrationBlockers, [])
  assert.deepEqual(final.checkout!.files.sort(), ['downstream.txt', 'prerequisite.txt'])
  assert.ok((await integrateExternalCoordinatorResult(reviewer, 'task-3', final.checkout!.token, 'approved-main')).staged)
  assert.equal(readFileSync('prerequisite.txt', 'utf8'), 'reviewed prerequisite\n')
  assert.equal(readFileSync('downstream.txt', 'utf8'), 'built with prerequisite\n')
  execFileSync('git', ['commit', '-qm', 'Integrate the approved workflow'])
} finally {
  await coord.stopProtocolRun(reviewedRunId)
  for (const close of turns.values()) close()
}

const sessionId = 'staffing-chat'
await coord.configureInteractiveCoordinator({ sessionId, provider: 'codex', cwd, maxAgents: 2, useWorktrees: false })
const chat = await coord.sessionCoordinatorIdentity(sessionId, 'codex')
try {
  const started = await coord.startInteractiveWorkflow(chat, { requestId: 'rotate-chat', playbook: recipe })
  assert.deepEqual(started.warnings, [], 'an interactive recipe can defer the second route')
  const first = (await coord.readProtocolRun(chat.runId))!.agents.find(agent => agent.role === 'teammate')!
  assert.equal(first.provider, 'codex')
  assert.equal((await coord.readExternalProtocolTask(chat, started.taskIds[1]!)).task.status, 'pending')
  await until(() => turns.has(first.sessionId))
  const live = globalThis.__agentViewerCoordinatorControllers!.get(chat.runId)!
  assert.equal((await coord.completeExternalProtocolTask(live.sdkIdentities.get(first.id)!, {
    taskId: started.taskIds[0]!, summary: 'Fixture prerequisite complete',
  })).accepted, true)
  turns.get(first.sessionId)!()
  await until(async () => (await coord.readProtocolRun(chat.runId))!.agents
    .some(agent => agent.provider === 'claude' && Boolean(agent.taskId)))
  const snapshot = (await coord.readProtocolRun(chat.runId))!
  assert.equal(snapshot.agents.find(agent => agent.id === first.id)?.status, 'stopped')
  assert.equal(snapshot.agents.filter(agent => agent.role === 'teammate' && agent.status !== 'stopped').length, 1)
} finally {
  await coord.stopProtocolRun(chat.runId)
  for (const close of turns.values()) close()
}
console.log('Pinned staffing passed: managed and interactive rotation, live ownership, startup failure, gate rollback, reviewed dependency handoff and final approval')
process.exit(0)

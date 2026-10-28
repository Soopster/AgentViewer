import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-chat-workflow-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
let sessions = 0
let startupFailures = 1
const turns: string[] = []
const prompts: string[] = []
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async ({ provider }: { provider: string }) => {
    if (startupFailures-- > 0) throw new Error('fixture provider unavailable')
    return { provider, sessionId: `fixture-session-${++sessions}`, isPending: false }
  },
  streamViewSessionTurn: async ({ sessionId, body }: { sessionId: string; body: { message: string } }) => { prompts.push(body.message); turns.push(sessionId); return new Promise<Response>(() => {}) },
}))
const coord = await import('../lib/agentCoordination')
const recipe = { name: 'review-change', maxAgents: 3, requirePlanApproval: true, requireReview: true, phases: [
  { title: 'Implement', tasks: [{ key: 'build', title: 'Build {{args.feature}}', detail: 'Implement {{args.feature}}', paths: ['src/{{args.file}}'], provider: 'codex' }] },
  { title: 'Review', tasks: [{ key: 'review', title: 'Review', detail: 'Check the implementation', provider: 'claude', seat: 'validator', paths: [], dependsOn: ['build'] }] },
] }
await coord.writeRunPlaybook(cwd, recipe)
const preview = await coord.previewInteractiveWorkflow({ cwd, name: recipe.name, provider: 'codex', args: { feature: 'search', file: 'search.ts' } })
assert.equal(preview.tasks[0]!.title, 'Build search')
assert.deepEqual(preview.tasks[0]!.paths, ['src/search.ts'])
assert.deepEqual(preview.tasks[1]!.blockedBy, ['task-1'])
assert.deepEqual(preview.providers, ['codex', 'claude'])
// Saving a new version after preview cannot change the confirmed board.
await coord.writeRunPlaybook(cwd, { ...recipe, phases: [{ title: 'Changed', tasks: [{ title: 'Unexpected', detail: 'Unexpected' }] }] }, recipe.name)
const lead = (await coord.createExternalProtocolRun({ prompt: 'Interactive conversation', baseCwd: cwd, provider: 'codex', participantName: 'lead', maxAgents: 3 })).participant
const controller = {
  interactiveLeadId: lead.agentId, runId: lead.runId, prompt: 'Interactive conversation', provider: 'codex' as const, teammateProviders: ['codex' as const], baseCwd: cwd,
  maxAgents: 3, requirePlanApproval: false, autonomy: 'medium' as const, requireReview: false, acceptanceContract: {}, useWorktrees: false,
  stopped: false, synthesisStarted: false, synthesisFindingFloorRowid: 0, interventionsUsed: 0, forcedInterventionsUsed: 0,
  turnInFlight: new Set<string>(), sessionIds: new Map(), pendingSessions: new Set<string>(), nudges: new Map(), dispatchNotes: new Map(),
  failedProviders: new Map(), sdkIdentities: new Map([['lead', lead]]), executionStarted: true, sameProviderRetries: new Map(), claudeUsageCumulative: new Map(),
}
globalThis.__agentViewerCoordinatorControllers!.set(lead.runId, controller as any)
try {
  const request = { requestId: 'start-previewed-team', playbook: preview.playbook, args: preview.args }
  const first = await coord.startInteractiveWorkflow(lead, request)
  assert.equal(first.warnings.length, 1)
  assert.match(first.warnings[0]!, /unavailable/)
  let snapshot = (await coord.readExternalProtocolStatus(lead)).snapshot
  assert.equal(snapshot.tasks.length, 2)
  assert.equal(snapshot.tasks[0]!.title, 'Build search')
  assert.equal(snapshot.run.requirePlanApproval, true)
  assert.equal(snapshot.run.requireReview, true)
  const result = await coord.startInteractiveWorkflow(lead, request)
  assert.deepEqual(result.taskIds, first.taskIds)
  assert.deepEqual(result.warnings, [])
  await new Promise(resolve => setTimeout(resolve, 40))
  snapshot = (await coord.readExternalProtocolStatus(lead)).snapshot
  assert.equal(snapshot.tasks.length, 2)
  assert.equal(snapshot.agents.length, 3)
  assert.equal(sessions, 2)
  assert.equal(snapshot.tasks[0]!.requestedProvider, 'codex')
  assert.equal(snapshot.tasks[1]!.requestedProvider, 'claude')
  assert.deepEqual(snapshot.tasks[1]!.blockedBy, [snapshot.tasks[0]!.id])
  const reviewAgent = snapshot.agents.find(agent => agent.provider === 'claude')!
  const reviewer = controller.sdkIdentities.get(reviewAgent.id)!
  await assert.rejects(coord.claimExternalProtocolTask(reviewer, snapshot.tasks[1]!.id), /blocked by incomplete dependencies/, 'phase barrier prevents early reviewer work')
  assert.equal(turns.includes(reviewAgent.sessionId), false)
  assert.ok(prompts.some(prompt => prompt.includes('THIS TURN IS PLAN-ONLY')), 'first implementation lane launches only a plan turn')
  const before = turns.length
  await coord.startInteractiveWorkflow(lead, request)
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(sessions, 2, 'same key must not create more workers')
  assert.equal(turns.length, before, 'same key must not restart a running turn')
  await assert.rejects(coord.startInteractiveWorkflow(lead, { ...request, requestId: 'new-team-while-busy' }), /Finish or cancel/)
  assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.tasks.length, 2)
  const parallel = { name: 'parallel-team', maxAgents: 3, phases: [{ title: 'Parallel', tasks: [
    { title: 'API', detail: 'Implement API', paths: ['api.ts'] },
    { title: 'UI', detail: 'Implement UI', paths: ['ui.ts'] },
    { title: 'Docs', detail: 'Write docs', paths: ['docs.md'] },
  ] }] }
  await coord.writeRunPlaybook(cwd, parallel)
  const parallelPreview = await coord.previewInteractiveWorkflow({ cwd, name: parallel.name, provider: 'codex' })
  assert.deepEqual(parallelPreview.providers, ['codex', 'codex'], 'parallel phase fills capacity instead of serializing one provider')
  const secondLead = (await coord.createExternalProtocolRun({ prompt: 'Second chat', baseCwd: cwd, provider: 'codex', participantName: 'lead', maxAgents: 3 })).participant
  const secondController = { ...controller, interactiveLeadId: secondLead.agentId, runId: secondLead.runId,
    sessionIds: new Map(), turnInFlight: new Set(), sdkIdentities: new Map([['lead', secondLead]]) }
  globalThis.__agentViewerCoordinatorControllers!.set(secondLead.runId, secondController as any)
  const previousSessions = sessions
  try {
    const parallelRequest = { requestId: 'parallel-start', playbook: parallelPreview.playbook }
    await coord.startInteractiveWorkflow(secondLead, parallelRequest)
    await new Promise(resolve => setTimeout(resolve, 40))
    const board = (await coord.readExternalProtocolStatus(secondLead)).snapshot
    assert.equal(sessions, previousSessions + 2)
    assert.equal(board.tasks.filter(task => task.ownerAgentId).length, 2, 'two independent lanes claim concurrently within capacity')
    await coord.startInteractiveWorkflow(secondLead, parallelRequest)
    assert.equal(sessions, previousSessions + 2)
  } finally { secondController.stopped = true; globalThis.__agentViewerCoordinatorControllers!.delete(secondLead.runId) }
  console.log('Interactive workflow smoke passed: frozen preview, phase barriers, provider lanes, plan/review gates, failed startup recovery, exact retries without extra tasks or turns.')
} finally { controller.stopped = true; globalThis.__agentViewerCoordinatorControllers!.delete(lead.runId) }
process.exit(0)

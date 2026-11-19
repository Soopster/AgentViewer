import assert from 'node:assert/strict'
import type { StartProtocolRunParams, StartProtocolRunResult } from '../lib/agentProtocol'
import { createWebRunLaunchService } from '../components/shell/runLaunchService'

const params: StartProtocolRunParams = {
  prompt: 'Build the requested outcome', baseCwd: '/project/work', provider: 'codex', providerInstanceId: 'work',
  teammateProviders: ['codex', 'claude'], model: 'captured-model', effort: 'high', maxAgents: 3,
  playbookName: 'review', playbookArgs: { target: 'src' }, useWorktrees: true,
  gateCommand: 'npm run check', requirePlanApproval: true, requireReview: true, autonomy: 'medium',
  acceptanceContract: { goal: 'Observable result', nonGoals: ['No deployment'] }, budget: { maxTokens: 20000, maxDurationMinutes: 30 },
}
const result = { snapshot: { run: { id: 'run-work' } }, sessions: [{ sessionId: 'same', provider: 'codex', providerInstanceId: 'work', cwd: params.baseCwd, summary: 'Team lead', isPending: true }] } as StartProtocolRunResult
const calls: Array<{ url: string; init: RequestInit }> = []
let complete!: (response: Response) => void
const service = createWebRunLaunchService(async (input, init) => {
  calls.push({ url: String(input), init: init! })
  return new Promise<Response>(resolve => { complete = resolve })
})
const aborted = new AbortController()
aborted.abort()
await assert.rejects(service.start(params, aborted.signal), { name: 'AbortError' })
assert.equal(calls.length, 0, 'closed presentation cannot submit another run')

const lifetime = new AbortController()
const accepted = service.start(params, lifetime.signal)
assert.equal(calls.length, 1)
assert.equal(calls[0]!.url, '/api/agent-protocol/runs')
assert.equal(calls[0]!.init.method, 'POST')
assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), params, 'all explicit launch choices reach the backend')
assert.equal(calls[0]!.init.signal, undefined, 'closing a view cannot abort the receipt for an accepted launch')
lifetime.abort()
complete(Response.json(result))
assert.deepEqual(await accepted, result, 'accepted runtime identity remains available to its host after view cancellation')

for (const response of [Response.json({ error: 'Configured account is disabled' }, { status: 400 }), Response.json({ error: 'Launch refused' })]) {
  await assert.rejects(createWebRunLaunchService(async () => response).start(params), /disabled|refused/)
}
await assert.rejects(createWebRunLaunchService(async () => new Response('{}', { status: 503 })).start(params), /503/)
const failure = new Error('Connection lost')
await assert.rejects(createWebRunLaunchService(async () => { throw failure }).start(params), error => error === failure)
console.log('Run launch service: PASS (full request/account identity, pre-dispatch refusal, accepted-run receipt lifetime and visible failures)')

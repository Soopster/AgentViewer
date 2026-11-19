import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextRequest } from 'next/server'
import type { AgentProvider } from '../lib/types'
import type { StartProtocolRunResult } from '../lib/agentProtocol'

const originalCwd = process.cwd()
const cwd = mkdtempSync(path.join(tmpdir(), 'coord-run-launch-identity-'))
process.chdir(cwd)
const instances = await import('../lib/providerInstances')
await instances.writeProviderInstancesFile({ version: 1, instances: [
  { id: 'personal', provider: 'codex' }, { id: 'work', provider: 'codex' },
  { id: 'disabled', provider: 'codex', enabled: false }, { id: 'claude-work', provider: 'claude' },
] })
const { mock } = await (0, eval)('import("bun:test")')
const creations: Array<{ instance: string; provider: AgentProvider; sessionId: string; tools: boolean }> = []
const turns: Array<{ instance: string; sessionId: string; body: Record<string, unknown>; release: () => void }> = []
const inspections: string[] = []
let collisionId: string | undefined
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async (params: { provider: AgentProvider; codexDynamicTools?: unknown }) => {
    const instance = instances.currentProviderInstanceId(params.provider)
    const sessionId = collisionId ?? `native-${creations.length + 1}`
    creations.push({ instance, provider: params.provider, sessionId, tools: Boolean(params.codexDynamicTools) })
    return { provider: params.provider, providerInstanceId: instance, sessionId, cwd, isPending: false }
  },
  streamViewSessionTurn: async ({ sessionId, body }: { sessionId: string; body: Record<string, unknown> }) => new Promise<Response>(resolve => {
    turns.push({ instance: instances.currentProviderInstanceId(), sessionId, body, release: () => resolve(new Response('')) })
  }),
  readViewSessionInfo: async (sessionId: string, provider: AgentProvider) => {
    const providerInstanceId = instances.currentProviderInstanceId(provider)
    inspections.push(providerInstanceId)
    return { sessionId, provider, providerInstanceId, cwd }
  },
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [] }),
}))
const coord = await import('../lib/agentCoordination')
const { POST } = await import('../app/api/agent-protocol/runs/route')
const { getCoordinatorCodexIdentity } = await import('../lib/agentCoordinationSdkTools')
const { inspectRecoveryAgent } = await import('../lib/coordinatorRecoveryServer')
const runIds: string[] = []
const post = (extra: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/agent-protocol/runs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Prove launch identity', baseCwd: cwd, provider: 'codex', useWorktrees: false, ...extra }),
}))
async function until(predicate: () => boolean | Promise<boolean>) {
  for (let index = 0; index < 150; index += 1) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('Expected scoped dispatch did not arrive')
}
try {
  for (const providerInstanceId of ['missing', 'disabled', 'claude-work']) {
    const response = await post({ providerInstanceId })
    assert.equal(response.status, 500)
    assert.match((await response.json()).error, /Unknown or disabled|uses claude/)
  }
  for (const providerInstanceId of ['', '   ', 12, null]) assert.equal((await post({ providerInstanceId })).status, 400)
  await assert.rejects(() => coord.startProtocolRun({ prompt: 'Invalid explicit account', baseCwd: cwd, provider: 'codex', providerInstanceId: ' ' }), /non-empty string/)
  assert.equal(creations.length, 0, 'invalid identity is refused before provider sessions')
  assert.equal(existsSync(path.join(cwd, '.agent-viewer-data/agent-coordination')), false, 'invalid identity is refused before coordinator storage')

  const personalResponse = await post({ providerInstanceId: 'personal', teammateProviders: ['codex', 'claude'], model: 'personal-model', effort: 'high' })
  assert.equal(personalResponse.status, 200, await personalResponse.clone().text())
  const personal = await personalResponse.json() as StartProtocolRunResult
  runIds.push(personal.snapshot.run.id)
  assert.equal(personal.sessions[0]!.providerInstanceId, 'personal', 'route forwards the selected account')
  assert.equal(personal.snapshot.agents[0]!.providerInstanceId, 'personal')
  assert.equal(creations[0]!.instance, 'personal')
  assert.equal(creations[0]!.tools, true)
  await until(() => turns.some(turn => turn.sessionId === personal.sessions[0]!.sessionId))
  assert.equal(turns[0]!.instance, 'personal')
  assert.equal(turns[0]!.body.model, 'personal-model')
  assert.equal(turns[0]!.body.effort, 'high')
  const identity = getCoordinatorCodexIdentity(personal.sessions[0]!.sessionId, 'personal')!
  assert.ok(identity)
  assert.equal(getCoordinatorCodexIdentity(personal.sessions[0]!.sessionId, 'work'), undefined)
  await coord.createExternalProtocolTask(identity, { assignTo: 'auto', teammateName: 'same-account', title: 'Same account', detail: 'Continue on the selected account', requestedProvider: 'codex' })
  await until(() => turns.length >= 2)
  assert.equal(creations[1]!.instance, 'personal', 'same-provider teammates inherit the launch account')
  assert.equal(turns[1]!.instance, 'personal')
  assert.equal(turns[1]!.body.model, 'personal-model')
  await coord.createExternalProtocolTask(identity, { assignTo: 'auto', teammateName: 'other-driver', title: 'Other provider', detail: 'Use the provider default', requestedProvider: 'claude' })
  await until(() => turns.length >= 3)
  assert.equal(creations[2]!.instance, 'claude', 'another provider retains explicit default account semantics')
  assert.equal(turns[2]!.instance, 'claude')
  const snapshot = (await coord.readExternalProtocolStatus(identity)).snapshot
  const teammate = snapshot.agents.find(agent => agent.name === 'same-account')!
  assert.equal(teammate.providerInstanceId, 'personal')
  assert.equal((await inspectRecoveryAgent(teammate)).conversation.available, true)
  assert.equal(inspections.at(-1), 'personal', 'recovery reads the durable account')

  const work = await instances.withProviderInstance('personal', 'codex', () => coord.startProtocolRun({
    prompt: 'Explicit work overrides an existing context', baseCwd: cwd, provider: 'codex', providerInstanceId: 'work', useWorktrees: false,
  }))
  runIds.push(work.snapshot.run.id)
  assert.equal(work.sessions[0]!.providerInstanceId, 'work')
  assert.equal(creations.at(-1)!.instance, 'work')
  await until(() => turns.some(turn => turn.sessionId === work.sessions[0]!.sessionId))
  assert.equal(turns.find(turn => turn.sessionId === work.sessions[0]!.sessionId)!.instance, 'work')

  const beforeCollision = (await coord.listProtocolRuns()).length
  const controllerCount = globalThis.__agentViewerCoordinatorControllers!.size
  collisionId = personal.sessions[0]!.sessionId
  const collision = await post({ providerInstanceId: 'work' })
  collisionId = undefined
  assert.equal(collision.status, 500)
  assert.match((await collision.json()).error, /ambiguous runtime binding/)
  assert.equal((await coord.listProtocolRuns()).length, beforeCollision, 'native-ID collision cannot persist an aliased run')
  assert.equal(globalThis.__agentViewerCoordinatorControllers!.size, controllerCount, 'failed launch leaves no active controller')
  assert.equal(getCoordinatorCodexIdentity(personal.sessions[0]!.sessionId, 'work'), undefined)

  const legacy = await instances.withProviderInstance('personal', 'codex', () => coord.startProtocolRun({ prompt: 'Existing SDK binding', baseCwd: cwd, provider: 'codex', useWorktrees: false }))
  runIds.push(legacy.snapshot.run.id)
  assert.equal(legacy.sessions[0]!.providerInstanceId, 'personal', 'omitted ID preserves explicitly bound SDK callers')
  const defaults = await coord.startProtocolRun({ prompt: 'Default SDK caller', baseCwd: cwd, provider: 'codex', useWorktrees: false })
  runIds.push(defaults.snapshot.run.id)
  assert.equal(defaults.sessions[0]!.providerInstanceId, 'codex', 'unbound callers use the provider default')
  console.log('Run launch identity: PASS (route forwarding, pre-side-effect validation, scoped lead/teammate/tools/turns/recovery, default compatibility and native-ID collision refusal)')
} finally {
  for (const runId of runIds) await coord.stopProtocolRun(runId)
  for (const turn of turns) turn.release()
  process.chdir(originalCwd)
  rmSync(cwd, { recursive: true, force: true })
}
process.exit(0)

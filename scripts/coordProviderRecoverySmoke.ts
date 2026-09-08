import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ExternalProtocolIdentity } from '../lib/agentProtocol'

const testCwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-provider-recovery-'))
process.chdir(testCwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'recovery smoke\n')
execFileSync('git', ['add', 'README.md'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coordination = await import('../lib/agentCoordination')
const sdk = await import('../lib/agentCoordinationSdkTools')
const bridge = await import('../lib/coordinatorBridgeServer')
const { AgentViewerCoordinatorPlugin } = await import('../lib/opencodePlugin/agentViewerCoordinator.mjs')

type Invoke = (name: string, args?: Record<string, unknown>) => Promise<any>
const expectedTools = sdk.buildCoordinatorCodexDynamicTools().map((tool) => tool.name).sort()
const requiredTools = ['coord_handoff_task', 'coord_leave_run', 'coord_cancel_turn', 'coord_read_inbox']

async function adapter(provider: string, identity: ExternalProtocolIdentity): Promise<Invoke> {
  const sessionId = `${provider}-${identity.agentId}`
  if (provider === 'codex') {
    sdk.registerCoordinatorCodexTools(sessionId, identity)
    const tools = sdk.buildCoordinatorCodexDynamicTools()
    for (const name of requiredTools) {
      const spec = tools.find((entry) => entry.name === name)
      assert.ok(spec?.type === 'function', `${provider}: ${name} function tool`)
      assert.ok((spec.inputSchema as any)?.properties?.request_id, `${provider}: ${name} retry schema`)
    }
    return async (name, args = {}) => {
      const result = await sdk.dispatchCoordinatorCodexToolCall(sessionId, name, args)
      assert.ok(result)
      assert.equal(result.isError, false, result.text)
      return JSON.parse(result.text)
    }
  }
  if (provider === 'opencode') {
    sdk.registerCoordinatorOpenCodeTools(sessionId, identity)
    process.env.AGENT_VIEWER_COORD_BRIDGE_URL = await bridge.getCoordinatorBridgeUrl()
    process.env.AGENT_VIEWER_COORD_BRIDGE_SECRET = await bridge.getCoordinatorBridgeSecret()
    const plugin = await AgentViewerCoordinatorPlugin() as {
      tool: Record<string, { args: z.ZodRawShape; execute: (args: unknown, context: { sessionID: string }) => Promise<string> }>
    }
    assert.deepEqual(Object.keys(plugin.tool).sort(), expectedTools, 'OpenCode must expose the complete provider contract')
    for (const name of requiredTools) assert.ok(plugin.tool[name]?.args.request_id, `${provider}: ${name} retry schema`)
    return async (name, args = {}) => {
      const tool = plugin.tool[name]
      return JSON.parse(await tool.execute(z.object(tool.args).parse(args), { sessionID: sessionId }))
    }
  }
  const tools: any[] = provider === 'claude' ? sdk.buildCoordinatorSdkTools(identity)
    : provider === 'pi' ? sdk.buildCoordinatorPiTools(identity) : sdk.buildCoordinatorCopilotTools(identity)
  assert.deepEqual(tools.map((tool) => tool.name).sort(), expectedTools, `${provider}: full tool inventory`)
  for (const name of requiredTools) {
    const tool = tools.find((entry) => entry.name === name)
    assert.ok(tool, `${provider}: ${name}`)
    assert.ok(provider === 'claude' ? tool.inputSchema.request_id
      : provider === 'pi' ? tool.parameters.properties.request_id : tool.parameters.shape.request_id,
    `${provider}: ${name} retry schema`)
  }
  return async (name, args = {}) => {
    const tool = tools.find((entry) => entry.name === name)
    assert.ok(tool, `${provider}: ${name}`)
    if (provider === 'copilot') return JSON.parse(await tool.handler(tool.parameters.parse(args)))
    const result = provider === 'claude'
      ? await tool.handler(z.object(tool.inputSchema).parse(args), {})
      : await tool.execute('smoke-call', args)
    assert.ok(!result.isError && !result.details?.error, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }
}

try {
  for (const provider of ['claude', 'codex', 'opencode', 'copilot', 'pi'] as const) {
    const lead = (await coordination.createExternalProtocolRun({
      prompt: `Verify ${provider} recovery`, provider, baseCwd: testCwd,
      participantName: `${provider}-lead`, maxAgents: 2,
    })).participant
    const teammate = (await coordination.joinExternalProtocolRun({
      runId: lead.runId, provider, cwd: testCwd, participantName: `${provider}-teammate`,
    })).participant
    const leadCall = await adapter(provider, lead)
    const teammateCall = await adapter(provider, teammate)
    const createArgs = { title: 'Recover this lane', detail: 'Checkpoint and return work.', paths: ['README.md'], request_id: 'create-lane' }
    const created = await leadCall('coord_create_task', createArgs)
    const replayed = await leadCall('coord_create_task', createArgs)
    assert.equal(replayed.task.id, created.task.id, `${provider}: create replay`)
    const taskId = created.task.id
    await teammateCall('coord_claim_task', { task_id: taskId })
    await teammateCall('coord_progress', { status: 'working', task_id: taskId })
    await assert.rejects(teammateCall('coord_cancel_turn', { agent_id: lead.agentId }), /Only the Coordinator lead/)
    await leadCall('coord_cancel_turn', { agent_id: teammate.agentId, request_id: 'cancel-turn' })
    const status = await leadCall('coord_status')
    assert.ok(status.snapshot.agents.find((agent: any) => agent.id === teammate.agentId)?.cancelRequestedAt,
      `${provider}: caller authenticates while target gets cancellation`)
    assert.equal(status.snapshot.tasks.find((task: any) => task.id === taskId)?.ownerAgentId, teammate.agentId)
    await leadCall('coord_send_message', { to: teammate.agentId, message: 'Recover safely', request_id: 'send-recovery' })
    const inbox = await teammateCall('coord_read_inbox', { request_id: 'read-recovery' })
    assert.ok(inbox.messages.some((message: any) => message.body === 'Recover safely'))
    assert.deepEqual(await teammateCall('coord_read_inbox', { request_id: 'read-recovery' }), inbox,
      `${provider}: acknowledged inbox replay`)
    const fresh = await teammateCall('coord_read_inbox', { request_id: 'read-next' })
    assert.ok(!fresh.messages.some((message: any) => message.body === 'Recover safely'))
    const handoffArgs = { task_id: taskId, summary: 'Resume from checkpoint', failure_class: 'context_exhausted', request_id: 'handoff' }
    const handoff = await teammateCall('coord_handoff_task', handoffArgs)
    assert.deepEqual(await teammateCall('coord_handoff_task', handoffArgs), handoff, `${provider}: handoff replay`)
    const after = await leadCall('coord_status')
    const task = after.snapshot.tasks.find((entry: any) => entry.id === taskId)
    assert.equal(task.status, 'pending')
    assert.ok(!task.ownerAgentId)
    assert.ok(!after.snapshot.locks.some((lock: any) => lock.agentId === teammate.agentId && lock.status === 'active'), `${provider}: handoff releases locks`)
    await teammateCall('coord_leave_run', { reason: 'Recovery handed off', request_id: 'leave' })
    const final = await leadCall('coord_status')
    assert.equal(final.snapshot.agents.find((agent: any) => agent.id === teammate.agentId)?.status, 'stopped')
    await coordination.stopProtocolRun(lead.runId)
    console.log(`${provider}: retry, cancellation, inbox replay, handoff, and leave passed`)
  }
} finally {
  const runningBridge = await globalThis.__agentViewerCoordinatorBridgePromise
  if (runningBridge) await new Promise<void>((resolve) => runningBridge.server.close(() => resolve()))
}
console.log('Coordinator provider recovery smoke passed')

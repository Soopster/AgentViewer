import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-sdk-bindings-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'SDK binding fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const instances = await import('../lib/providerInstances')
await instances.writeProviderInstancesFile({ version: 1, instances: [
  { id: 'claude-one', provider: 'claude' }, { id: 'claude-two', provider: 'claude' },
  { id: 'codex-one', provider: 'codex' }, { id: 'codex-two', provider: 'codex' },
] })
const coord = await import('../lib/agentCoordination')
const sdk = await import('../lib/agentCoordinationSdkTools')
const first = (await coord.createExternalProtocolRun({ prompt: 'First team', provider: 'claude', baseCwd: cwd, participantName: 'lead' })).participant
const second = (await coord.createExternalProtocolRun({ prompt: 'Second team', provider: 'claude', baseCwd: cwd, participantName: 'lead' })).participant
const sessionId = 'same-native-session'
try {
  sdk.registerCoordinatorMcpServer(sessionId, first, 'claude-one')
  sdk.registerCoordinatorMcpServer(sessionId, second, 'claude-two')
  const servers = sdk.getCoordinatorMcpServers(sessionId, 'claude-one')!
  assert.ok(servers)
  assert.notStrictEqual(servers, sdk.getCoordinatorMcpServers(sessionId, 'claude-two'))
  sdk.registerCoordinatorMcpServer(sessionId, first, 'claude-one')
  assert.strictEqual(servers, sdk.getCoordinatorMcpServers(sessionId, 'claude-one'), 'unchanged identity must preserve the warm Claude subprocess binding')
  assert.equal(sdk.getCoordinatorMcpServers(sessionId), undefined, 'default account must not borrow another account binding')
  assert.strictEqual(await instances.withProviderInstance('claude-one', 'claude', () => sdk.getCoordinatorMcpServers(sessionId)), servers)
  const secondServers = sdk.getCoordinatorMcpServers(sessionId, 'claude-two')
  sdk.registerCoordinatorMcpServer(sessionId, { ...first, token: 'rotated-token' }, 'claude-one')
  assert.notStrictEqual(servers, sdk.getCoordinatorMcpServers(sessionId, 'claude-one'))
  assert.strictEqual(secondServers, sdk.getCoordinatorMcpServers(sessionId, 'claude-two'), 'token rotation in one account must not invalidate another pool')
  sdk.registerCoordinatorCodexTools(sessionId, first, 'codex-one')
  sdk.registerCoordinatorCodexTools(sessionId, second, 'codex-two')
  assert.equal(sdk.getCoordinatorCodexIdentity(sessionId), undefined)
  const results = await Promise.all([
    sdk.dispatchCoordinatorCodexToolCall(sessionId, 'coord_status', {}, 'codex-one'),
    sdk.dispatchCoordinatorCodexToolCall(sessionId, 'coord_status', {}, 'codex-two'),
  ])
  for (const [index, result] of results.entries()) {
    assert.ok(result && !result.isError, result?.text ?? 'No Coordinator tool result')
    assert.equal(JSON.parse(result.text).snapshot.run.id, [first.runId, second.runId][index])
  }
  assert.equal(await sdk.dispatchCoordinatorCodexToolCall(sessionId, 'coord_status', {}), null, 'unscoped event must fail closed')
  const scoped = await instances.withProviderInstance('codex-two', 'codex', () => sdk.dispatchCoordinatorCodexToolCall(sessionId, 'coord_status', {}))
  assert.equal(JSON.parse(scoped!.text).snapshot.run.id, second.runId)
  sdk.unregisterCoordinatorCodexTools(sessionId, 'codex-one')
  assert.equal(sdk.getCoordinatorCodexIdentity(sessionId, 'codex-one'), undefined)
  assert.equal(sdk.getCoordinatorCodexIdentity(sessionId, 'codex-two')!.runId, second.runId)
  sdk.registerCoordinatorCodexTools(sessionId, first, 'codex-one')
  sdk.registerCoordinatorCodexTools('realized-alias', first, 'codex-one')
  sdk.unregisterCoordinatorRunTools(first.runId, sessionId, 'claude-one')
  assert.equal(sdk.getCoordinatorMcpServers(sessionId, 'claude-one'), undefined)
  assert.ok(sdk.getCoordinatorCodexIdentity(sessionId, 'codex-one'), 'instance-filtered cleanup must leave other account bindings alone')
  assert.strictEqual(secondServers, sdk.getCoordinatorMcpServers(sessionId, 'claude-two'))
  sdk.registerCoordinatorMcpServer(sessionId, first, 'claude-one')
  // No process-local controller exists for an external run. Terminal cleanup
  // must still remove all restored SDK bindings and aliases for only that run.
  await coord.stopProtocolRun(first.runId)
  assert.equal(sdk.getCoordinatorMcpServers(sessionId, 'claude-one'), undefined)
  assert.equal(sdk.getCoordinatorCodexIdentity(sessionId, 'codex-one'), undefined)
  assert.equal(sdk.getCoordinatorCodexIdentity('realized-alias', 'codex-one'), undefined)
  assert.ok(sdk.getCoordinatorMcpServers(sessionId, 'claude-two'))
  assert.equal(sdk.getCoordinatorCodexIdentity(sessionId, 'codex-two')!.runId, second.runId)
  await coord.deleteProtocolRun(second.runId)
  assert.equal(sdk.getCoordinatorMcpServers(sessionId, 'claude-two'), undefined)
  assert.equal(sdk.getCoordinatorCodexIdentity(sessionId, 'codex-two'), undefined)
  console.log('SDK binding isolation passed: duplicate native IDs, scoped and explicit lookup/dispatch, fail-closed defaults, stable warm binding, isolated token rotation, filtered cleanup, and stop/delete alias cleanup without a controller.')
} finally {
  sdk.unregisterCoordinatorRunTools(first.runId)
  sdk.unregisterCoordinatorRunTools(second.runId)
}
process.exit(0)

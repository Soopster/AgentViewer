import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-native-guard-')))
const { mock } = await (0, eval)('import("bun:test")')
const responses: { id: number; result: unknown }[] = []
mock.module('../lib/codexClient', () => ({ getCodexClient: () => ({ respond: (id: number, result: unknown) => { responses.push({ id, result }) }, respondError: () => { throw new Error('Unexpected unsupported approval') } }) }))
const backend = await import('../lib/sessionBackend')
const { setRunningSession, clearRunningSession } = await import('../lib/sessionRuntime')
const { extractPendingPermissions } = await import('../lib/permissions')
const { coordinatorPermissionToken } = await import('../lib/coordinatorNativePermission')
const pending = (globalThis as typeof globalThis & { __agentViewerPendingCodexApprovals: Map<string, { rawId: number; method: string; params: Record<string, unknown> }> }).__agentViewerPendingCodexApprovals
const ask = (command: string) => ({ rawId: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'native-a', command } })
pending.set('native-a:1', ask('inspect A'))
pending.set('native-b:1', { ...ask('inspect B'), params: { threadId: 'native-b', command: 'inspect B' } })
setRunningSession('native-a', { provider: 'codex', interrupt: async () => {} })
setRunningSession('native-b', { provider: 'codex', interrupt: async () => {} })
const parsed = extractPendingPermissions(backend.readViewSessionRunning('native-a').pendingPermissions, { sessionId: 'native-a', provider: 'codex' })[0]
const token = coordinatorPermissionToken(parsed)
const body = { action: 'respondPermission', permissionId: '1', response: 'once', expectedPermissionToken: token }
await assert.rejects(backend.runViewSessionAction({ sessionId: 'native-b', provider: 'codex', body }), /no longer pending|already|request/i)
assert.equal(responses.length, 0)
pending.set('native-a:1', ask('changed command'))
await assert.rejects(backend.runViewSessionAction({ sessionId: 'native-a', provider: 'codex', body }))
assert.equal(responses.length, 0)
pending.set('native-a:1', ask('inspect A'))
await backend.runViewSessionAction({ sessionId: 'native-a', provider: 'codex', body })
assert.equal(responses.length, 1)
assert.deepEqual(responses[0].result, { decision: 'accept' })
assert.ok(pending.has('native-b:1'), 'same request id in another session remains unanswered')
await assert.rejects(backend.runViewSessionAction({ sessionId: 'native-a', provider: 'codex', body }))
assert.equal(responses.length, 1)
clearRunningSession('native-a'); clearRunningSession('native-b')
console.log('Native backend guard passed: actual Codex approval bridge, full prompt token, changed command, colliding session IDs, one exact response and disappeared request rejection (scripted RPC)')
process.exit(0)

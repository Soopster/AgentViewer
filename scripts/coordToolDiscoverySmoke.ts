import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { COORD_TOOL_SPECS, coordinatorToolSpecsForRole } from '../lib/coordinatorToolContract.mjs'

process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-tool-discovery-')))
const coord = await import('../lib/agentCoordination')
const sdk = await import('../lib/agentCoordinationSdkTools')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Discovery profiles', provider: 'codex', baseCwd: process.cwd(), participantName: 'lead' })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: process.cwd(), participantName: 'worker' })).participant
const leadSpecs = coordinatorToolSpecsForRole(lead.role)
const workerSpecs = coordinatorToolSpecsForRole(worker.role)
const names = workerSpecs.map(spec => spec.name)
for (const name of ['coord_create_task', 'coord_claim_task', 'coord_read_task', 'coord_list_tasks', 'coord_send_message', 'coord_read_inbox', 'coord_request_locks', 'coord_submit_plan', 'coord_complete_task', 'coord_inspect_operation']) assert.ok(names.includes(name), name)
for (const name of ['coord_delegate', 'coord_finalize_run', 'coord_read_result', 'coord_read_result_diff', 'coord_integrate_result', 'coord_cancel_task', 'coord_review_run']) assert.equal(names.includes(name), false, name)
assert.equal(leadSpecs.length, COORD_TOOL_SPECS.length, 'leads can still execute their own lead tasks')
assert.equal(coordinatorToolSpecsForRole(undefined).length, COORD_TOOL_SPECS.length, 'unknown legacy bindings keep the complete catalog')
assert.deepEqual(sdk.buildCoordinatorSdkTools(worker).map(tool => tool.name), names)
assert.deepEqual(sdk.buildCoordinatorPiTools(worker).map(tool => tool.name), names)
assert.deepEqual(sdk.buildCoordinatorCodexDynamicTools('teammate').map(tool => tool.name), names)
assert.equal(sdk.buildCoordinatorCopilotTools(worker).length, names.length)
sdk.registerCoordinatorMcpServer('same-session', worker, 'claude')
const workerServer = sdk.getCoordinatorMcpServers('same-session', 'claude')
sdk.registerCoordinatorMcpServer('same-session', worker, 'claude')
assert.equal(sdk.getCoordinatorMcpServers('same-session', 'claude'), workerServer, 'unchanged identity/role keeps the warm binding')
sdk.registerCoordinatorMcpServer('same-session', { ...worker, role: 'lead' }, 'claude')
assert.notEqual(sdk.getCoordinatorMcpServers('same-session', 'claude'), workerServer, 'role changes rebuild discovery even with unchanged credentials')
sdk.registerCoordinatorOpenCodeTools('opencode-session', worker, 'opencode')
const mask = sdk.getCoordinatorOpenCodeToolMask('opencode-session', 'opencode')!
assert.equal(mask.coord_delegate, false)
assert.equal(mask.coord_create_task, true)
assert.equal(sdk.getCoordinatorOpenCodeToolMask('opencode-session', 'other-instance'), undefined, 'another account cannot borrow the mask')
sdk.registerCoordinatorOpenCodeTools('opencode-session', lead, 'opencode')
assert.equal(sdk.getCoordinatorOpenCodeToolMask('opencode-session', 'opencode')!.coord_delegate, true, 'lead rebind restores tools')
const forged = sdk.buildCoordinatorPiTools({ ...worker, role: 'lead' }).find(tool => tool.name === 'coord_cancel_task')!
const response = await (forged.execute as unknown as (id: string, args: object) => Promise<{ details?: { error?: string } }>)('forged-role', { task_id: 'missing', expected_revision: 'anything', reason: 'Not authorized', request_id: 'forged-hint' })
assert.match(response.details!.error!, /Only the Coordinator lead/, 'discovery hints never grant backend authority')
const chars = (role: 'lead' | 'teammate') => JSON.stringify(sdk.buildCoordinatorCodexDynamicTools(role)).length
console.log(`Role discovery passed: lead=${leadSpecs.length} tools/${chars('lead')} chars, teammate=${workerSpecs.length} tools/${chars('teammate')} chars; scoped masks, warm/rebind behavior and backend authorization retained.`)
process.exit(0)

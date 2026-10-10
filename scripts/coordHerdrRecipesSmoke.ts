// Herdr's documented agent-automation recipes (docs/agent-automation.mdx),
// run through Coordinator's own MCP tool surface — the same COORD_TOOL_SPECS
// argument mapping an agent's coord_* call goes through — against a real
// ledger. This is the "just as effective" check: each recipe a herdr user runs
// must have a Coordinator equivalent that completes the same job, in the same
// number of steps or fewer.
//
//   herdr agent start reviewer --kind codex …
//   herdr agent prompt reviewer "Review the current diff" --wait
//   herdr agent read reviewer --source recent-unwrapped
//
//   herdr agent wait reviewer --until blocked
//   herdr agent read reviewer …                 (inspect the question)
//   herdr agent send-keys reviewer esc          (answer / stop it)
//
// Teammates are external participants driven by this script, standing in for
// a provider — the live-provider runs are recorded in the comparison doc.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'coord-herdr-recipes-'))
process.chdir(root)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction } = await import('../lib/agentCoordinationExternal')
const { COORD_TOOL_SPECS } = await import('../lib/coordinatorToolContract.mjs') as { COORD_TOOL_SPECS: Array<{ name: string; action: string; mapArgs: (args: Record<string, unknown>) => Record<string, unknown> }> }

const lead = (await coord.createExternalProtocolRun({ prompt: 'Herdr recipes', provider: 'codex', baseCwd: root, participantName: 'lead', maxAgents: 6 })).participant
// What an agent's tool call does: map the tool's arguments, then run the action.
let calls = 0
async function tool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const spec = COORD_TOOL_SPECS.find(entry => entry.name === name)
  assert.ok(spec, `${name} is a Coordinator tool`)
  calls += 1
  return executeExternalCoordinatorAction({ action: spec.action, ...lead, ...spec.mapArgs(args) }) as Promise<T>
}
// Another idle teammate joins first, so an unnamed delegation would go to it:
// naming the reviewer has to be what routes the work.
await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: 'nova' })
const reviewer = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: 'reviewer' })).participant
const taskFor = async () => (await coord.readExternalProtocolRun(lead)).tasks.filter(task => task.ownerAgentId === reviewer.agentId).at(-1)!
const soon = (work: () => Promise<unknown>) => setTimeout(() => { void work() }, 300)

// ── Recipe 1: give the reviewer work and wait for it to settle ──────────────
// herdr: agent prompt reviewer "…" --wait, then agent read reviewer.
calls = 0
soon(async () => {
  const task = await taskFor()
  await coord.reportExternalProtocolProgress(reviewer, { status: 'working', taskId: task.id, summary: 'Reviewing the diff' })
  await coord.completeExternalProtocolTask(reviewer, { taskId: task.id, summary: 'Two findings: an unchecked null and a missing test' })
})
const reviewed = await tool<{ settled?: { outcome: string; summary?: string } }>('coord_delegate', {
  name: 'reviewer', title: 'Review the current diff', detail: 'Review the current diff and report only actionable findings.', wait_ms: 20_000,
})
assert.equal(reviewed.settled?.outcome, 'completed', 'the recipe completes')
assert.match(reviewed.settled?.summary ?? '', /unchecked null/, 'and the result comes back with it — no separate read step')
assert.equal(calls, 1, 'herdr needs prompt --wait then read (2 calls); this is 1')

// ── Recipe 2: wait for the reviewer to ask, inspect, answer ─────────────────
// herdr: agent wait reviewer --until blocked; agent read reviewer; send-keys.
calls = 0
const second = await tool<{ task: { id: string } }>('coord_delegate', { to: 'reviewer', title: 'Pick a parser', detail: 'Choose between the parsers.' })
soon(async () => {
  await coord.reportExternalProtocolProgress(reviewer, { status: 'working', taskId: second.task.id, summary: 'Comparing parsers' })
  await coord.sendExternalProtocolMessage(reviewer, { to: 'lead', body: 'Strict or compatible parser?', replyRequired: true })
  await coord.reportExternalProtocolProgress(reviewer, { status: 'blocked', taskId: second.task.id, summary: 'Waiting for the parser choice' })
})
const waited = await tool<{ changed: boolean; inbox: { messages: Array<{ id: string; body: string; replyRequired?: boolean }> } }>('coord_wait', { agent: 'reviewer', until: ['blocked'], timeout_ms: 20_000 })
assert.equal(waited.changed, true, 'the wait returns when the reviewer needs the lead')
// The question arrives with the wait — herdr has to read the pane to find it.
const question = waited.inbox.messages.find(message => message.replyRequired && /parser/.test(message.body))
assert.ok(question, 'the reviewer\'s actual question is in the wait result, not behind a separate read')
await tool('coord_send_message', { to: 'reviewer', message: 'Use strict.', in_reply_to: question.id })
// A participant's own snapshot leaves mail out; the run's full ledger has it.
const answered = (await coord.readProtocolRun(lead.runId))!.messages.find(message => message.id === question.id)
assert.ok(answered?.resolvedAt, 'answering resolves the question in the ledger — herdr can only type into a dialog')
assert.ok(calls <= 3, `herdr needs wait, read and send-keys (3 calls); this took ${calls}`)

// ── Recipe 2b: stop a teammate that has gone the wrong way ──────────────────
// herdr: agent send-keys reviewer ctrl+c. The reviewer is an external worker
// here, so this is the cancel flag its supervisor polls; a managed teammate is
// interrupted in-process (coordConversationSmoke covers that path).
await coord.reportExternalProtocolProgress(reviewer, { status: 'working', taskId: second.task.id, summary: 'Resuming with strict' })
await tool('coord_cancel_turn', { agent_id: reviewer.agentId })
const afterCancel = (await coord.readExternalProtocolRun(lead)).agents.find(agent => agent.id === reviewer.agentId)
assert.ok(afterCancel?.cancelRequestedAt, 'the teammate is told to stop its turn')
assert.equal((await taskFor()).ownerAgentId, reviewer.agentId, 'and keeps its task, as ctrl+c does not close the pane')

console.log('Herdr recipes via coord_* tools: prompt+wait+read in 1 call with the result, wait-until-blocked returns the question itself, a reply resolves it in the ledger, cancel keeps the task')
process.exit(0)

// The session list's team marks (herdr's state rollup) are read on a poll from
// boot, so the read must come from the ledger alone: this pins that it never
// resolves the send path, and that the ledger-only summary agrees with the
// full Coordinator's answer, per conversation, for waiting items and results.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const resolved = new Set<string>()
type ResolveBuild = { onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => undefined): void }
const { Bun } = globalThis as unknown as { Bun: { plugin(plugin: { name: string; setup(build: ResolveBuild): void }): void } }
Bun.plugin({
  name: 'resolve-trace',
  setup(build) {
    build.onResolve({ filter: /(agentCoordination|sessionBackend|claudePool)(\.ts)?$/ }, (args) => {
      resolved.add(args.path)
      return undefined
    })
  },
})

const fixture = mkdtempSync(path.join(tmpdir(), 'team-attention-'))
process.chdir(fixture)

// Phase 1, before anything seeds a ledger: no ledger means no marks, and still no send path.
const { readTuiInteractiveAttention } = await import('../lib/tui/service')
assert.deepEqual(await readTuiInteractiveAttention(), [], 'no ledger reads as no teams')
assert.equal(resolved.size, 0, `a ledger-less attention read resolved the send path: ${[...resolved].join(', ')}`)

// Phase 2: seed two conversations through the real Coordinator (which is
// allowed to load the send path — only the READ must not).
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')
await coord.configureInteractiveCoordinator({ sessionId: 'asks', provider: 'codex', cwd: fixture, autoContinue: false })
const asksLead = await coord.sessionCoordinatorIdentity('asks', 'codex')
const asker = (await coord.joinExternalProtocolRun({ runId: asksLead.runId, participantName: 'asker', provider: 'codex', cwd: fixture })).participant
await coord.sendExternalProtocolMessage(asker, { to: 'lead', body: 'Strict or compatible?', replyRequired: true })
await coord.configureInteractiveCoordinator({ sessionId: 'done', provider: 'claude', cwd: fixture, autoContinue: false })
const doneLead = await coord.sessionCoordinatorIdentity('done', 'claude')
const worker = (await coord.joinExternalProtocolRun({ runId: doneLead.runId, participantName: 'worker', provider: 'claude', cwd: fixture })).participant
const task = await coord.createExternalProtocolTask(doneLead, { assignTo: worker.agentId, title: 'Survey', detail: 'Report' })
await coord.completeExternalProtocolTask(worker, { taskId: task.task!.id, summary: 'Survey done' })

const light = await readTuiInteractiveAttention()
const full = await coord.readInteractiveAttention()
const byKey = (list: typeof light) => Object.fromEntries(list.map(entry => [`${entry.provider}:${entry.sessionId}`, { waiting: entry.waiting, finished: entry.finished, resultIds: entry.resultIds }]))
assert.deepEqual(byKey(light), byKey(full), 'the ledger-only summary must agree with the full Coordinator')
assert.equal(byKey(light)['codex:asks']?.waiting, 1, 'a teammate asking the lead is waiting on the user')
assert.equal(byKey(light)['claude:done']?.finished, 1, 'a finished task is a result to review')

// Reviewing clears a result mark; a question stays until it is answered.
const { teamAttentionMark } = await import('../lib/coordinatorAttention')
const done = light.find(entry => entry.sessionId === 'done')!
assert.equal(teamAttentionMark(done, done.resultIds), null, 'a reviewed result must not keep the row marked')
assert.deepEqual(teamAttentionMark(done, []), { waiting: 0, finished: 1 })

console.log('team attention ledger smoke passed (no send path, agrees with the Coordinator, reviewed results clear)')
process.exit(0)

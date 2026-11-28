// Opt-in live fixture: one pinned teammate completes two ordered tasks with a Codex lead.
// Run with: node --import tsx scripts/coordManagedWorkflowLive.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProtocolTask } from '../lib/agentProtocol'
import type { AgentProvider } from '../lib/types'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-managed-live-'))
process.chdir(cwd)
const provider = process.env.COORD_WORKFLOW_LIVE_TEAMMATE ?? 'claude'
const nextProvider = process.env.COORD_WORKFLOW_LIVE_NEXT_TEAMMATE ?? provider
const writeDependency = process.env.COORD_WORKFLOW_LIVE_WRITE === '1'
assert.ok(provider === 'claude' || provider === 'codex' || provider === 'opencode', 'Select claude, codex or opencode')
assert.ok(nextProvider === 'claude' || nextProvider === 'codex' || nextProvider === 'opencode', 'Select claude, codex or opencode')
const coord = await import('../lib/agentCoordination')
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })
git('init', '-q')
git('config', 'user.name', 'Smoke')
git('config', 'user.email', 'smoke@example.test')
writeFileSync('.gitignore', '.agent-viewer-data/\n')
const codes = [randomUUID().slice(0, 8), randomUUID().slice(0, 8)]
for (const [index, code] of codes.entries()) writeFileSync(`evidence-${index + 1}.txt`, `Review code: ${code}\n`)
const name = 'managed-pinned-dependencies'
await coord.writeRunPlaybook(cwd, {
  name, maxAgents: 2, phases: [
    { title: 'Evidence', tasks: [
      { key: 'first', title: 'Read first evidence', provider, paths: writeDependency ? ['rule.ts'] : [],
        detail: writeDependency
          ? 'Read evidence-1.txt and create rule.ts exporting its review code as the string constant reviewCode. Report that code in your task completion summary. Only write rule.ts.'
          : 'Read evidence-1.txt and include its review code in your task completion summary. This is read-only. Do not inspect the second file.' },
      { title: 'Read second evidence', provider: nextProvider, dependsOn: ['first'],
        detail: writeDependency
          ? 'Read the reviewCode export from rule.ts in your checkout and the code in evidence-2.txt. Include both codes in your task completion summary. This is read-only.'
          : 'Read evidence-2.txt and include its review code in your task completion summary. This is read-only.' },
    ] },
  ],
})
git('add', '.')
git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture')
const started = Date.now()
const { snapshot: initial, sessions } = await coord.startProtocolRun({
  prompt: 'Complete the evidence workflow and summarize both reported review codes. The fixture harness reviews and commits the prerequisite result. The lead must leave all files and Git refs alone.',
  provider: 'codex', teammateProviders: [...new Set<AgentProvider>([provider === 'codex' ? 'claude' : 'codex', provider, nextProvider])],
  baseCwd: cwd, playbookName: name, useWorktrees: writeDependency,
})
const runId = initial.run.id
const firstId = initial.tasks.find(task => task.title === 'Read first evidence')?.id
const secondId = initial.tasks.find(task => task.title === 'Read second evidence')?.id
try {
  assert.ok(firstId && secondId)
  const lead = writeDependency ? await coord.sessionCoordinatorIdentity(sessions[0]!.sessionId, 'codex') : undefined
  const results = writeDependency ? await import('../lib/coordinatorResultReviewServer') : undefined
  let integrated = false
  let last = ''
  const deadline = started + 180_000
  while (Date.now() < deadline) {
    const snapshot = await coord.readProtocolRun(runId)
    assert.ok(snapshot, 'the run disappeared')
    const first: ProtocolTask | undefined = snapshot.tasks.find(task => task.id === firstId)
    const second: ProtocolTask | undefined = snapshot.tasks.find(task => task.id === secondId)
    const workers = snapshot.agents.filter(agent => agent.role === 'teammate')
    assert.ok(first && second)
    assert.deepEqual(second.blockedBy, [first.id])
    assert.ok(workers.filter(worker => !['failed', 'stopped'].includes(worker.status)).length <= 1)
    if (first.ownerAgentId) assert.equal(workers.find(worker => worker.id === first.ownerAgentId)?.provider, provider)
    if (second.ownerAgentId) assert.equal(workers.find(worker => worker.id === second.ownerAgentId)?.provider, nextProvider)
    if (second.ownerAgentId) assert.equal(first.status, 'completed', 'dependency must settle before the second claim')
    if (writeDependency && !integrated) {
      assert.equal(second.status, 'pending', 'the successor must wait for the reviewed commit')
      if (first.status === 'completed' && lead && results) {
        const review = await results.readExternalCoordinatorResultReview(lead, firstId)
        if (review.checkout && !review.integrationBlockers.length) {
          assert.equal(first.receipt?.requiresIntegration, true)
          assert.deepEqual(review.checkout.files, ['rule.ts'])
          const diff = await results.readExternalCoordinatorResultDiff(lead, { taskId: firstId, reviewToken: review.checkout.token, file: 'rule.ts' })
          assert.ok(diff.diff.includes(codes[0]!))
          assert.equal((await results.integrateExternalCoordinatorResult(lead, firstId, review.checkout.token, 'fixture-integrate')).staged, true)
          await coord.runProtocolMaintenanceSweep()
          assert.equal((await coord.readExternalProtocolTask(lead, secondId)).task.status, 'pending')
          git('commit', '-qm', 'Integrate reviewed rule')
          integrated = true
          console.log(JSON.stringify({ stage: 'dependency-integrated' }))
        }
      }
    }
    const stage = JSON.stringify({ status: snapshot.run.status, first: first.status, second: second.status })
    if (stage !== last) console.log(stage)
    last = stage
    if (snapshot.run.status === 'completed') {
      assert.ok([first, second].every((task, index) => task.status === 'completed'
        && task.receipt?.actualProvider === [provider, nextProvider][index] && task.resultSummary?.includes(codes[index]!)))
      assert.equal(first.ownerAgentId === second.ownerAgentId, provider === nextProvider && !writeDependency)
      if (writeDependency) assert.ok(second.resultSummary?.includes(codes[0]!), 'the downstream receipt must prove it read rule.ts')
      assert.ok(codes.every(code => snapshot.run.summary?.includes(code)), 'lead must synthesize both durable results')
      assert.equal(git('status', '--porcelain'), '')
      console.log(JSON.stringify({ stage: 'passed', providers: [provider, nextProvider], lead: 'codex', lanes: 2, integrated, elapsedSeconds: Math.round((Date.now() - started) / 1000) }))
      break
    }
    const fault = snapshot.events.findLast(event => event.type === 'agent.blocked')
    if (fault && [first, second].some(task => task.status === 'blocked')) {
      const quota = /usage[_ ]limit|rate[_ ]limit|out of usage credits/i.test(fault.detail ?? '')
      throw new Error(quota ? 'A provider reported a usage limit' : fault.summary ?? 'The workflow needs execution recovery')
    }
    assert.ok(!['failed', 'stopped'].includes(snapshot.run.status), fault?.summary ?? 'the run did not complete')
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal((await coord.readProtocolRun(runId))?.run.status, 'completed', 'fixture timed out before synthesis')
} finally {
  await coord.stopProtocolRun(runId).catch(() => {})
}
process.exit(0)

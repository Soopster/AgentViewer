import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCoordinatorTurnPacing } from '../bin/agent-viewer-coord-pacing.mjs'

import { workerRecordPath } from '../bin/agent-viewer-coord-state.mjs'

const pacing = createCoordinatorTurnPacing()
const runnable = { myTask: { id: 'task', status: 'in_progress' }, inboxCount: 0 }
assert.deepEqual(Array.from({ length: 9 }, () => pacing.observe(runnable)), [0, 0, 1000, 2000, 4000, 8000, 16000, 30000, 30000])
assert.equal(pacing.changed({ ...runnable, inboxCount: 1 }), true)
assert.equal(pacing.observe({ ...runnable, inboxCount: 1 }), 0)
assert.equal(pacing.observe(null), 0)

const root = await mkdtemp(path.join(tmpdir(), 'coord-worker-scheduling-'))
process.env.AGENT_VIEWER_COORD_HOME = path.join(root, 'coord-home')
const admin = fileURLToPath(new URL('../bin/agent-viewer-coord-admin.mjs', import.meta.url))
const fakeCli = path.join(root, 'codex.mjs')
await writeFile(fakeCli, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const record = JSON.parse(readFileSync(process.env.WORKER_RECORD_FILE, 'utf8'))
if (record.activity?.state !== 'working') throw new Error('Active provider turn was not reported as working')
let count = 0
try { count = Number(readFileSync(process.env.TICK_COUNT_FILE, 'utf8')) } catch {}
writeFileSync(process.env.TICK_COUNT_FILE, String(count + 1))
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'scheduling-smoke' }))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Returned to supervisor' } }))
`)
await chmod(fakeCli, 0o700)
const worker = fileURLToPath(new URL('../bin/agent-viewer-coord-worker.mjs', import.meta.url))

for (const scenario of [
  { name: 'idle-until-mail', idle: true, wakeByMail: true },
  { name: 'blocked-heartbeat-flood', status: 'blocked', planState: 'approved', wakeByMail: true, wakeAfter: 12 },
  { name: 'resume-runnable-immediately', status: 'in_progress', planState: 'approved', resume: true, runnable: true },
  { name: 'resume-blocked-until-mail', status: 'blocked', planState: 'approved', wakeByMail: true, resume: true },
  { name: 'resume-planned-until-approved', status: 'planned', planState: 'awaiting', resume: true },
  { name: 'resume-outage-then-terminal', status: 'blocked', planState: 'approved', outage: 'read', terminal: true, resume: true },
  { name: 'read-outage-until-mail', status: 'blocked', planState: 'approved', wakeByMail: true, outage: 'read' },
  { name: 'wait-outage-until-mail', status: 'blocked', planState: 'approved', wakeByMail: true, outage: 'wait' },
  { name: 'outage-then-terminal', status: 'blocked', planState: 'approved', outage: 'read', terminal: true },
  { name: 'blocked-until-mail', status: 'blocked', planState: 'approved', wakeByMail: true },
  { name: 'planned-until-approved', status: 'planned', planState: 'awaiting' },
  { name: 'awaiting-plan-state', status: 'in_progress', planState: 'awaiting' },
  { name: 'unchanged-runnable-until-mail', status: 'in_progress', planState: 'approved', wakeByMail: true, paced: true },
  { name: 'unchanged-runnable-resumes-after-delay', status: 'in_progress', planState: 'approved', paced: true, expires: true },
]) {
  const countFile = path.join(root, `${scenario.name}-count`)
  await writeFile(countFile, '0')
  const identityFile = path.join(root, `${scenario.name}.json`)
  if (scenario.resume) await writeFile(identityFile, JSON.stringify({
    runId: 'scheduling-run', agentId: 'teammate', token: 'test-secret',
    name: scenario.name, role: 'teammate', provider: 'codex', cwd: root,
    providerSessionId: 'existing-provider-session',
  }))
  const wakeAfter = scenario.wakeAfter ?? 3
  const waitTimes = []
  let longWaits = 0
  let outageInjected = false
  let outageActivityChecked = false
  let observedError
  const daemon = createServer(async (request, response) => {
    try {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw || '{}')
      const snapshot = { run: { id: 'scheduling-run', status: 'running' }, agents: [], tasks: [], locks: [], messages: [], events: [] }
      response.setHeader('Content-Type', 'application/json')
      if (body.action === 'join_run') {
        response.end(JSON.stringify({ participant: {
          runId: 'scheduling-run', agentId: 'teammate', token: 'test-secret',
          name: scenario.name, role: 'teammate', provider: 'codex', cwd: root,
        }, snapshot }))
        return
      }
      if (body.action !== 'wait') { response.end(JSON.stringify({ snapshot })); return }
      // Normalize away the fresh worker's bootstrap turn for shared assertions.
      const count = Number(await readFile(countFile, 'utf8')) + (scenario.resume ? 1 : 0)
      if (scenario.outage && !outageInjected && (scenario.outage === 'read' || body.timeoutMs > 0)) {
        outageInjected = true
        response.statusCode = 503
        response.end(JSON.stringify({ error: 'Temporary coordinator outage' }))
        return
      }
      if (outageInjected && !outageActivityChecked) {
        const record = JSON.parse(await readFile(workerRecordPath(identityFile), 'utf8'))
        assert.equal(record.activity.state, 'unknown', 'observation outages must not retain a confident activity label')
        outageActivityChecked = true
      }
      if (scenario.outage) assert.equal(count, longWaits >= wakeAfter && !scenario.terminal ? 2 : 1,
        'observation failure must retry observation without another model turn')
      if (scenario.terminal && outageInjected) {
        snapshot.run.status = 'completed'
        response.end(JSON.stringify({ snapshot }))
        return
      }
      if (body.timeoutMs > 0) {
        const record = JSON.parse(await readFile(workerRecordPath(identityFile), 'utf8'))
        const expectedActivity = scenario.idle ? 'idle' : scenario.paced ? 'ready' : scenario.planState === 'awaiting' ? 'awaiting_approval' : 'blocked'
        assert.equal(record.activity.state, expectedActivity)
        assert.equal(record.activity.taskId, scenario.idle ? undefined : 'owned-task')
        assert.ok(Number.isFinite(Date.parse(record.activity.observedAt)))
        if (scenario.wakeAfter && longWaits === 0) {
          const listed = JSON.parse(execFileSync(process.execPath, [admin, 'workers', '--activity', 'blocked', '--json'], { encoding: 'utf8' }))
          assert.equal(listed.length, 1)
          assert.equal(listed[0].name, scenario.name)
          const display = execFileSync(process.execPath, [admin, 'workers', '--activity', 'blocked'], { encoding: 'utf8' })
          assert.ok(display.includes('running\tblocked\t'))
          assert.ok(display.includes('task=owned-task'))
        }
        waitTimes.push(Date.now())
        longWaits += 1
        assert.equal(count, scenario.paced ? 3 : 1, `${scenario.name}: waiting must not spend another model turn`)
      }
      const awakened = !scenario.expires && longWaits >= wakeAfter
      // A spin bug produces a second tick before any long wait. Finish the
      // process anyway, then fail the observed wait-count assertion below.
      if (count >= (scenario.paced ? 4 : 2)) snapshot.run.status = 'completed'
      response.end(JSON.stringify({
        snapshot, cursor: `cursor-${longWaits}`, changed: awakened,
        timedOut: !awakened, inbox: { messages: [] }, events: [],
        actionable: {
          runStatus: snapshot.run.status,
          inboxCount: awakened && scenario.wakeByMail ? 1 : 0,
          replyRequiredCount: 0, plansAwaitingReview: [],
          // A spare lane must not wake a teammate already owning blocked work.
          claimableTasks: scenario.idle ? [] : [{ id: 'other-task', targetRole: 'teammate' }],
          myTask: scenario.idle ? null : { id: 'owned-task', status: awakened && !scenario.wakeByMail ? 'in_progress' : scenario.status,
            planState: awakened && !scenario.wakeByMail ? 'approved' : scenario.planState },
          allTasksTerminal: snapshot.run.status === 'completed',
        },
      }))
    } catch (error) {
      observedError = error
      response.statusCode = 500
      response.end(JSON.stringify({ error: error.message }))
    }
  })
  daemon.listen(0, '127.0.0.1')
  await once(daemon, 'listening')
  const child = spawn(process.execPath, [worker, ...(scenario.resume ? [] : ['--join', 'scheduling-run', '--shared', '--name', scenario.name]), '--provider', 'codex', '--attach', String(daemon.address().port),
    '--cwd', root, '--identity', identityFile], {
    env: { ...process.env, AGENT_VIEWER_COORD_TRANSPORT: 'http',
      AGENT_VIEWER_COORD_HOME: path.join(root, 'coord-home'), CODEX_PATH: fakeCli, TICK_COUNT_FILE: countFile, WORKER_RECORD_FILE: workerRecordPath(identityFile) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 15_000)
  try {
    const [code] = await once(child, 'exit')
    if (observedError) throw observedError
    assert.equal(code, 0, stderr)
    const stoppedRecord = JSON.parse(await readFile(workerRecordPath(identityFile), 'utf8'))
    assert.equal(stoppedRecord.activity, null, 'stopped workers must clear their live activity')
    if (scenario.wakeAfter) assert.ok(waitTimes.at(-1) - waitTimes[0] >= 900,
      'non-actionable heartbeat events must not drive a tight polling loop')
    if (scenario.outage) assert.equal(outageInjected, true)
    if (scenario.terminal || scenario.runnable) assert.equal(longWaits, 0)
    else if (scenario.expires) assert.ok(longWaits > 0, 'unchanged work must wait, then resume after bounded pacing')
    else assert.equal(longWaits, wakeAfter, `${scenario.name}: must wait until actionable change`)
    assert.equal(Number(await readFile(countFile, 'utf8')), (scenario.terminal ? 1 : scenario.paced ? 4 : 2) - (scenario.resume ? 1 : 0), `${scenario.name}: actionable change must wake the model`)
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) child.kill('SIGKILL')
    await new Promise((resolve) => daemon.close(resolve))
  }
  console.log(`${scenario.name}: waited without model turns and resumed on actionable change`)
}
console.log('Coordinator worker scheduling smoke passed')

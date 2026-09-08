import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCoordinatorTurnPacing } from '../bin/agent-viewer-coord-pacing.mjs'

const pacing = createCoordinatorTurnPacing()
const runnable = { myTask: { id: 'task', status: 'in_progress' }, inboxCount: 0 }
assert.deepEqual(Array.from({ length: 9 }, () => pacing.observe(runnable)), [0, 0, 1000, 2000, 4000, 8000, 16000, 30000, 30000])
assert.equal(pacing.changed({ ...runnable, inboxCount: 1 }), true)
assert.equal(pacing.observe({ ...runnable, inboxCount: 1 }), 0)
assert.equal(pacing.observe(null), 0)

const root = await mkdtemp(path.join(tmpdir(), 'coord-worker-scheduling-'))
const fakeCli = path.join(root, 'codex.mjs')
await writeFile(fakeCli, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
let count = 0
try { count = Number(readFileSync(process.env.TICK_COUNT_FILE, 'utf8')) } catch {}
writeFileSync(process.env.TICK_COUNT_FILE, String(count + 1))
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'scheduling-smoke' }))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Returned to supervisor' } }))
`)
await chmod(fakeCli, 0o700)
const worker = fileURLToPath(new URL('../bin/agent-viewer-coord-worker.mjs', import.meta.url))

for (const scenario of [
  { name: 'blocked-until-mail', status: 'blocked', planState: 'approved', wakeByMail: true },
  { name: 'planned-until-approved', status: 'planned', planState: 'awaiting' },
  { name: 'awaiting-plan-state', status: 'in_progress', planState: 'awaiting' },
  { name: 'unchanged-runnable-until-mail', status: 'in_progress', planState: 'approved', wakeByMail: true, paced: true },
  { name: 'unchanged-runnable-resumes-after-delay', status: 'in_progress', planState: 'approved', paced: true, expires: true },
]) {
  const countFile = path.join(root, `${scenario.name}-count`)
  let longWaits = 0
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
      const count = Number(await readFile(countFile, 'utf8'))
      if (body.timeoutMs > 0) {
        longWaits += 1
        assert.equal(count, scenario.paced ? 3 : 1, `${scenario.name}: waiting must not spend another model turn`)
      }
      const awakened = !scenario.expires && longWaits >= 3
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
          claimableTasks: [{ id: 'other-task', targetRole: 'teammate' }],
          myTask: { id: 'owned-task', status: awakened && !scenario.wakeByMail ? 'in_progress' : scenario.status,
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
  const child = spawn(process.execPath, [worker, '--join', 'scheduling-run', '--shared',
    '--name', scenario.name, '--provider', 'codex', '--attach', String(daemon.address().port),
    '--cwd', root, '--identity', path.join(root, `${scenario.name}.json`)], {
    env: { ...process.env, AGENT_VIEWER_COORD_TRANSPORT: 'http',
      AGENT_VIEWER_COORD_HOME: path.join(root, 'coord-home'), CODEX_PATH: fakeCli, TICK_COUNT_FILE: countFile },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 15_000)
  try {
    const [code] = await once(child, 'exit')
    if (observedError) throw observedError
    assert.equal(code, 0, stderr)
    if (scenario.expires) assert.ok(longWaits > 0, 'unchanged work must wait, then resume after bounded pacing')
    else assert.equal(longWaits, 3, `${scenario.name}: must wait until actionable change`)
    assert.equal(Number(await readFile(countFile, 'utf8')), scenario.paced ? 4 : 2, `${scenario.name}: actionable change must wake the model`)
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) child.kill('SIGKILL')
    await new Promise((resolve) => daemon.close(resolve))
  }
  console.log(`${scenario.name}: waited without model turns and resumed on actionable change`)
}
console.log('Coordinator worker scheduling smoke passed')

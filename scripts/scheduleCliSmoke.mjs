// Pins `agent-viewer schedule <verb>` against a fake daemon: wire shapes, flag validation
// and the launcher's mirrored verb list.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const { runScheduleCli, SCHEDULE_CLI_VERBS, triggerFromFlags, actionFromFlags } = await import('../bin/agent-viewer-schedule-cli.mjs')

const launcher = readFileSync(new URL('../bin/agent-viewer.mjs', import.meta.url), 'utf8')
const mirrored = /const SCHEDULE_CLI_VERBS = (\[[^\]]*\])/.exec(launcher)?.[1]
assert.deepEqual(JSON.parse(mirrored.replaceAll("'", '"')), SCHEDULE_CLI_VERBS, 'launcher verb list drifted')
assert.match(launcher, /command === 'schedule'/, 'launcher dispatches schedule')

assert.deepEqual(triggerFromFlags({ every: '30m' }), { kind: 'every', amount: 30, unit: 'm' })
assert.deepEqual(triggerFromFlags({ cron: '0 9 * * 1-5', tz: 'UTC' }), { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC' })
assert.throws(() => triggerFromFlags({}), /trigger is required/)
assert.throws(() => triggerFromFlags({ every: '1h', cron: '* * * * *' }), /not both/)
assert.throws(() => triggerFromFlags({ every: 'soon' }), /number and a unit/)
assert.throws(() => actionFromFlags({ provider: 'claude' }), /target is required/)
assert.deepEqual(actionFromFlags({ provider: 'claude', session: 's1' }), { kind: 'prompt-session', sessionId: 's1', provider: 'claude' })

const requests = []
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ schedules: [], ok: true }))
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const originalLog = console.log
console.log = () => {}
try {
  await runScheduleCli(['list', '--attach', String(port)])
  await runScheduleCli(['add', 'check', 'the', 'build', '--every', '1h', '--session', 's1', '--provider', 'claude', '--overlap', 'queue', '--attach', String(port)])
  await runScheduleCli(['pause', 'abc', '--attach', String(port)])
  await runScheduleCli(['run', 'abc', '--attach', String(port)])
  await runScheduleCli(['rm', 'abc', '--attach', String(port)])
} finally {
  console.log = originalLog
  server.close()
}
assert.equal(requests[0].method, 'GET')
const created = requests[1].body
assert.equal(created.action, 'create')
assert.equal(created.schedule.prompt, 'check the build')
assert.deepEqual(created.schedule.trigger, { kind: 'every', amount: 1, unit: 'h' })
assert.equal(created.schedule.overlap, 'queue')
assert.deepEqual(requests.slice(2).map(r => r.body.action), ['pause', 'run-now', 'delete'], 'rm and run map to the route\'s verbs')
await assert.rejects(runScheduleCli(['wat']), /Unknown schedule verb/)
console.log('scheduleCliSmoke ok')

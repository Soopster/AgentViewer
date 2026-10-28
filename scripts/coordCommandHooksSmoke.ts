// Pins the user-level command hooks: argv-only parsing, event and project
// filters, the payload on stdin and in the environment, and that a hook which
// hangs or does not exist never rejects or outlives its timeout.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await mkdtemp(path.join(os.tmpdir(), 'coord-hooks-'))
process.env.AGENT_VIEWER_COORD_HOME = home
const hooks = await import('../lib/coordinatorCommandHooks')

try {
  assert.equal(hooks.commandHooksFilePath(), path.join(home, 'hooks.json'))
  assert.deepEqual(await hooks.readCommandHooks(), [], 'no file means no hooks')

  const parsed = hooks.parseCommandHooks({ commands: [
    { run: ['a', 'b'] },
    { run: 'rm -rf /' },
    { run: [] },
    { run: ['ok', 3] },
    { run: ['c'], events: ['task.failed', 7], project: home },
  ] })
  assert.deepEqual(parsed, [{ run: ['a', 'b'] }, { run: ['c'], events: ['task.failed'], project: home }], 'a shell string or a non-string argument is not a command')

  const payload = { kind: 'task.completed', runId: 'run-1', agentId: 'agent-1', taskId: 'task-1', summary: 'it\'s "done"; $(touch pwned)' }
  assert.equal(hooks.commandHookMatches({ run: ['x'] }, payload, home), true)
  assert.equal(hooks.commandHookMatches({ run: ['x'], events: ['run.failed'] }, payload, home), false)
  assert.equal(hooks.commandHookMatches({ run: ['x'], project: '/elsewhere' }, payload, home), false)

  const out = path.join(home, 'out.json')
  const script = path.join(home, 'hook.mjs')
  await writeFile(script, `import { writeFileSync } from 'node:fs'
let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => writeFileSync(process.argv[2], JSON.stringify({ stdin: JSON.parse(input), event: process.env.AGENT_VIEWER_HOOK_EVENT, task: process.env.AGENT_VIEWER_HOOK_TASK_ID, cwd: process.cwd() })))
`)
  await writeFile(path.join(home, 'hooks.json'), JSON.stringify({ commands: [
    { run: [process.execPath, script, out], events: ['task.completed'] },
    { run: [process.execPath, script, path.join(home, 'filtered.json')], events: ['run.failed'] },
    { run: ['agent-viewer-no-such-binary'] },
  ] }))
  await hooks.dispatchCommandHooks(payload, home)
  const seen = JSON.parse(await readFile(out, 'utf8'))
  assert.deepEqual(seen.stdin, payload, 'the event reaches the hook on stdin verbatim')
  assert.equal(seen.event, 'task.completed')
  assert.equal(seen.task, 'task-1')
  assert.equal(await readFile(path.join(home, 'filtered.json'), 'utf8').catch(() => null), null, 'a hook ran for an event it did not subscribe to')
  assert.equal(await readFile(path.join(home, 'pwned'), 'utf8').catch(() => null), null, 'event text was interpreted by a shell')

  const started = Date.now()
  await hooks.runCommandHook({ run: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] }, payload, home, 300)
  assert.ok(Date.now() - started < 3_000, 'a hung hook outlived its timeout')
  console.log('Coordinator command hooks smoke passed (argv parsing, filters, stdin/env payload, missing binary, timeout)')
} finally {
  await rm(home, { recursive: true, force: true })
}

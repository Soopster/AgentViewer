// Pins `agent-viewer coord <verb>` against a daemon that records what it is
// sent: the binding a run leaves behind, that the token is saved and never
// printed, each verb's wire shape, the wait loop and its exit code, and the
// usage errors a script would otherwise discover as a server rejection.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const home = await mkdtemp(path.join(os.tmpdir(), 'coord-cli-'))
process.env.AGENT_VIEWER_COORD_HOME = path.join(home, 'state')
for (const key of ['AGENT_VIEWER_ATTACH', 'AGENT_VIEWER_COORD_IDENTITY_FILE', 'AGENT_VIEWER_COORD_RUN_ID', 'AGENT_VIEWER_COORD_AGENT_ID', 'AGENT_VIEWER_COORD_TOKEN', 'AGENT_VIEWER_CALLER_PROVIDER', 'CLAUDECODE', 'CODEX_THREAD_ID']) delete process.env[key]
const { runCoordCli, COORD_CLI_VERBS, parseCoordCliArgs } = await import('../bin/agent-viewer-coord-cli.mjs')

const seen = []
let waitsUntilChange = 0
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const body = JSON.parse(raw)
    seen.push(body)
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (body.action === 'create_run' || body.action === 'join_run') return reply(200, { participant: { runId: 'run-1', agentId: body.action === 'join_run' ? 'agent-2' : 'agent-1', token: 'SECRET-TOKEN', name: body.name } })
    if (body.action === 'list_runs') return reply(200, { runs: [] })
    if (body.token !== 'SECRET-TOKEN') return reply(401, { error: 'bad identity' })
    if (body.action === 'status') return reply(200, { cursor: 'c0', actionable: {} })
    if (body.action === 'wait') {
      waitsUntilChange -= 1
      return reply(200, waitsUntilChange <= 0 && body.timeoutMs > 0 ? { changed: true, timedOut: false, cursor: 'c9' } : { changed: false, timedOut: true, cursor: `c${seen.length}` })
    }
    if (body.action === 'finding') return reply(400, { error: 'detail too long' })
    reply(200, { ok: true, action: body.action })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const attach = String(server.address().port)
const cwd = path.join(home, 'repo')
const cli = (...argv) => runCoordCli([...argv, '--attach', attach], { cwd })
const last = () => seen.at(-1)
const usage = async (argv, pattern) => assert.rejects(() => cli(...argv), (error) => error.constructor.name === 'UsageError' && pattern.test(error.message), `expected a usage error for: ${argv.join(' ')}`)

try {
  const launcher = readFileSync(new URL('../bin/agent-viewer.mjs', import.meta.url), 'utf8')
  assert.deepEqual(JSON.parse(launcher.match(/const COORD_CLI_VERBS = (\[[^\]]+\])/)[1].replace(/'/g, '"')), COORD_CLI_VERBS, 'the launcher routes a different verb list than the CLI implements')
  assert.deepEqual(parseCoordCliArgs(['a', '--wait-ms', '5', '--peek', 'b', '--x=1'], new Set(['peek'])), { positionals: ['a', 'b'], flags: { wait_ms: '5', peek: true, x: '1' } })

  await assert.rejects(() => cli('status'), /not bound to a Coordinator run/)

  const created = await cli('run', 'Ship the parser', '--name', 'ci')
  assert.equal(last().action, 'create_run')
  assert.equal(last().prompt, 'Ship the parser')
  assert.equal(last().cwd, cwd)
  assert.equal(last().client.protocolVersion, 2)
  assert.equal(last().provider, 'codex', 'an unmarked caller is still recorded as codex')
  assert.ok(!JSON.stringify(created.json).includes('SECRET-TOKEN'), 'the capability token was printed')
  const saved = JSON.parse(await readFile(created.json.identityFile, 'utf8'))
  assert.equal(saved.token, 'SECRET-TOKEN')
  assert.equal((await stat(created.json.identityFile)).mode & 0o777, 0o600, 'the identity file is readable by others')

  // The launcher scrubs Claude Code's markers before spawning the CLI and hands
  // the caller's provider on instead; without it a Claude agent joined as codex.
  process.env.AGENT_VIEWER_CALLER_PROVIDER = 'claude'
  // Joined from its own directory, naming the lead's checkout as --cwd.
  const helperDir = path.join(home, 'helper')
  await runCoordCli(['join', 'run-1', '--name', 'helper', '--cwd', cwd, '--attach', attach], { cwd: helperDir })
  delete process.env.AGENT_VIEWER_CALLER_PROVIDER
  assert.deepEqual([last().action, last().provider, last().cwd], ['join_run', 'claude', cwd], 'the calling agent\'s provider was not inferred')
  assert.equal((await runCoordCli(['whoami'], { cwd })).json.agentId, 'agent-1', 'a join naming the lead\'s checkout took the lead\'s directory binding')
  assert.equal((await runCoordCli(['whoami'], { cwd: helperDir })).json.agentId, 'agent-2', 'the joiner is not bound where it ran')
  // Joined from the lead's own directory: the lead keeps it, the joiner is told how to address itself.
  const shared = await runCoordCli(['join', 'run-1', '--name', 'sharer', '--attach', attach], { cwd })
  assert.equal(shared.json.directoryBinding, 'kept')
  assert.match(shared.json.hint, /--identity/)
  assert.equal((await runCoordCli(['whoami'], { cwd })).json.agentId, 'agent-1', 'a teammate joining in the lead\'s directory took its binding')

  await cli('status')
  assert.deepEqual([last().action, last().runId, last().agentId, last().token], ['status', 'run-1', 'agent-1', 'SECRET-TOKEN'])
  assert.equal(last().requestId, undefined, 'a read was given an idempotency key')
  assert.deepEqual((await runCoordCli(['whoami'], { cwd })).json.attach, `http://127.0.0.1:${attach}`, 'a later command forgot which daemon the run lives on')

  await cli('delegate', 'Fix the lexer', '--to', 'nova', '--paths', 'a.ts, b.ts', '--wait-ms', '1000', '--model', 'gpt-x')
  assert.equal(last().action, 'create_task')
  assert.deepEqual([last().title, last().detail, last().assignTo, last().waitMs], ['Fix the lexer', 'Fix the lexer', 'nova', 1000])
  assert.deepEqual(last().paths, ['a.ts', 'b.ts'])
  assert.match(last().requestId, /^cli-/, 'a mutation went out without an idempotency key')

  await cli('send', 'lead', 'Done?', '--reply-required')
  assert.deepEqual([last().action, last().to, last().message, last().replyRequired], ['send_message', 'lead', 'Done?', true])
  await cli('inbox', '--peek')
  assert.deepEqual([last().action, last().acknowledge], ['read_inbox', false])

  await cli('call', 'coord_claim_task', '{"task_id":"task-3"}', '--request-id', 'mine')
  assert.deepEqual([last().action, last().taskId, last().requestId], ['claim_task', 'task-3', 'mine'])
  await cli('call', 'query-context', '--query', 'auth', '--limit', '3')
  assert.deepEqual([last().action, last().query, last().limit], ['query_context', 'auth', 3])

  waitsUntilChange = 3
  const before = seen.length
  const waited = await cli('wait', '--agent', 'nova', '--until', 'idle,blocked', '--timeout', '60000')
  const waits = seen.slice(before).filter((body) => body.action === 'wait')
  assert.equal(waited.json.changed, true)
  assert.equal(waited.exitCode, undefined)
  assert.equal(waits.length, 3, 'the wait did not loop past the server\'s slice')
  assert.deepEqual([waits[0].agent, waits[0].until, waits[0].cursor], ['nova', ['idle', 'blocked'], 'c0'])
  assert.notEqual(waits[1].cursor, waits[0].cursor, 'a later slice did not advance its cursor')
  waitsUntilChange = Infinity
  assert.equal((await cli('wait', '--timeout', '0')).exitCode, 3, 'a timed-out wait did not exit 3')

  await usage(['call', 'coord_nope'], /Unknown Coordinator tool/)
  await usage(['call', 'coord_claim_task', '--bogus', '1'], /no field "bogus"/)
  await usage(['call', 'coord_send_message', '--to', 'lead'], /requires: message/)
  await usage(['call', 'query_context', '--query', 'x', '--limit', 'many'], /must be a number/)
  await usage(['delegate'], /requires a title/)
  await usage(['run'], /requires a goal/)
  await usage(['run', 'x', '--provider', 'gemini'], /--provider must be one of/)
  await usage(['status', 'extra'], /Unexpected argument/)
  await assert.rejects(() => cli('call', 'publish_finding', '--kind', 'finding', '--summary', 's'), /detail too long/, 'a server rejection was swallowed')
  await assert.rejects(() => runCoordCli(['runs', '--attach', '1'], { cwd }), /Could not reach an agent-viewer daemon/)

  const joined = await runCoordCli(['join', 'run-1', '--name', 'second', '--attach', attach], { cwd: path.join(home, 'other') })
  assert.equal(joined.json.participant.agentId, 'agent-2')
  assert.equal((await runCoordCli(['whoami'], { cwd })).json.agentId, 'agent-1', 'joining from another directory rebound this one')
  console.log('Coordinator CLI smoke passed (binding, token privacy, verb wire shapes, wait loop + exit 3, tool coercion, usage errors)')
} finally {
  server.close()
  await rm(home, { recursive: true, force: true })
}

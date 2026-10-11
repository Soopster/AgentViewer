// `coord worker --acp-command` drives an agent this app has no adapter for.
// Pins the argv parsing (nothing reaches a shell) and a whole tick against a
// minimal ACP agent: it is spawned from the user's command, handed the
// Coordinator's MCP server on session/new, and prompted.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseAcpCommand, runAcpProviderTick } from '../bin/agent-viewer-acp-client.mjs'

assert.deepEqual(parseAcpCommand('gemini --experimental-acp'), ['gemini', '--experimental-acp'])
assert.deepEqual(parseAcpCommand(`"/opt/my agents/goose" acp --name 'a b' ""`), ['/opt/my agents/goose', 'acp', '--name', 'a b', ''])
assert.deepEqual(parseAcpCommand('["x","$(touch pwned); y"]'), ['x', '$(touch pwned); y'])
assert.deepEqual(parseAcpCommand('agent $HOME;rm'), ['agent', '$HOME;rm'], 'shell syntax must stay literal text')
for (const bad of ['', '   ', '"unterminated', '[1]', '[]', '[not json']) assert.throws(() => parseAcpCommand(bad), /--acp-command/, `accepted ${JSON.stringify(bad)}`)

const dir = await mkdtemp(path.join(os.tmpdir(), 'acp-custom-'))
try {
  const seen = path.join(dir, 'seen.json')
  const agent = path.join(dir, 'fake agent.mjs')
  await writeFile(agent, `import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
const seen = { argv: process.argv.slice(2), methods: [] }
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  seen.methods.push(message.method)
  if (message.method === 'initialize') reply(message.id, { protocolVersion: message.params.protocolVersion, agentCapabilities: {} })
  else if (message.method === 'session/new') { seen.session = message.params; reply(message.id, { sessionId: 'custom-1' }) }
  else if (message.method === 'session/prompt') { seen.prompt = message.params.prompt; writeFileSync(${JSON.stringify(seen)}, JSON.stringify(seen)); reply(message.id, { stopReason: 'end_turn' }) }
  else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported' } }) + '\\n')
})
`)
  const argv = parseAcpCommand(JSON.stringify([process.execPath, agent, '--flag']))
  const result = await runAcpProviderTick({
    providerId: 'opencode', // no built-in ACP adapter: only the custom command can make this work
    command: argv[0],
    args: argv.slice(1),
    cwd: dir,
    prompt: 'Start with coord_status.',
    mcpServer: { name: 'agent-viewer', command: 'node', args: ['bridge.mjs'] },
    signal: AbortSignal.timeout(15_000),
  })
  assert.deepEqual(result, { sessionId: 'custom-1', stopReason: 'end_turn' })
  const recorded = JSON.parse(await readFile(seen, 'utf8'))
  assert.deepEqual(recorded.argv, ['--flag'], 'the command\'s own arguments did not reach the agent')
  assert.deepEqual(recorded.methods.slice(0, 2), ['initialize', 'session/new'])
  assert.deepEqual(recorded.session.mcpServers.map((server) => [server.name, server.command, server.args]), [['agent-viewer', 'node', ['bridge.mjs']]], 'the agent was not handed the Coordinator tools')
  assert.match(JSON.stringify(recorded.prompt), /coord_status/)
  await assert.rejects(() => runAcpProviderTick({ providerId: 'opencode', cwd: dir, prompt: 'x', mcpServer: { name: 'a', command: 'b', args: [] } }), /No ACP agent adapter known/, 'a provider with no adapter and no custom command must fail loudly')
  console.log('Custom ACP agent smoke passed (argv parsing without a shell, full tick against a hand-written ACP agent, MCP server handoff)')
} finally {
  await rm(dir, { recursive: true, force: true })
}

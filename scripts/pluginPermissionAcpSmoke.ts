// The permission hook on the ACP path, end to end: a hand-written ACP agent
// asks permission for commands mid-turn, a mod's permission hook answers, and
// the agent receives the plugin's choice without a person — through the real
// pool, provider runtime and send path. Run with bun.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.argv[2] !== 'child') {
  const dir = mkdtempSync(path.join(tmpdir(), 'acp-permission-'))
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', dir], { stdio: 'inherit', timeout: 90_000, env: { ...process.env, AGENT_VIEWER_COORD_HOME: path.join(dir, 'coord-home') } })
  assert.equal(child.status, 0, 'ACP permission smoke child failed')
  console.log('ACP permission hook smoke passed (a mod denies and allows an ACP agent\'s commands mid-turn; no request reaches a person)')
} else {
  const dir = process.argv[3]!
  process.chdir(dir)
  const seenPath = path.join(dir, 'seen.json')
  const agentPath = path.join(dir, 'asking agent.mjs')
  writeFileSync(agentPath, `import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
const out = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
const answers = new Map()
const ask = (sessionId, command) => new Promise((resolve) => {
  const id = 'perm-' + answers.size
  answers.set(id, resolve)
  out({ id, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: id, kind: 'execute', title: 'Run ' + command, rawInput: { command } }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Allow' }, { optionId: 'no', kind: 'reject_once', name: 'Reject' }] } })
})
createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === undefined) { answers.get(message.id)?.(message.result?.outcome?.optionId); return }
  if (message.method === 'initialize') out({ id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } })
  else if (message.method === 'session/new') out({ id: message.id, result: { sessionId: 'native-asker' } })
  else if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId
    const outcome = { rm: await ask(sessionId, 'rm -rf build'), ls: await ask(sessionId, 'ls -la') }
    writeFileSync(${JSON.stringify(seenPath)}, JSON.stringify(outcome))
    out({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'rm=' + outcome.rm + ' ls=' + outcome.ls } } } })
    out({ id: message.id, result: { stopReason: 'end_turn' } })
  } else out({ id: message.id, error: { code: -32601, message: 'unsupported' } })
})
`)
  const mods = path.join(dir, 'mods')
  mkdirSync(path.join(mods, 'guard'), { recursive: true })
  writeFileSync(path.join(mods, 'guard', 'plugin.json'), JSON.stringify({ id: 'guard', title: 'Guard', behavior: { hooks: ['permission'] } }))
  writeFileSync(path.join(mods, 'guard', 'server.mjs'), `
export const asked = []
export function permission({ request, target }) {
  asked.push({ ...request, provider: target.provider })
  if (request.kind === 'command' && /^rm /.test(request.command ?? '')) return { decision: 'deny', reason: 'guard: no rm' }
  if (request.kind === 'command' && /^ls /.test(request.command ?? '')) return { decision: 'allow' }
}`)
  process.env.AGENT_VIEWER_PLUGINS_DIR = mods
  process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(dir, 'plugin-settings.json')
  process.env.AGENT_VIEWER_ACP_COMMAND = JSON.stringify([process.execPath, agentPath])

  const backend = await import('../lib/sessionBackend')
  const created = await backend.createNewViewSession({ provider: 'acp', cwd: dir })
  const response = await backend.streamViewSessionTurn({ provider: 'acp', sessionId: created.sessionId, body: { message: 'tidy up', cwd: dir }, signal: new AbortController().signal })
  const text = await new Response(response.body).text()
  const seen = JSON.parse(readFileSync(seenPath, 'utf8')) as { rm: string; ls: string }
  assert.equal(seen.rm, 'no', 'the mod\'s deny did not reach the agent')
  assert.equal(seen.ls, 'yes', 'the mod\'s allow did not reach the agent')
  assert.match(text, /rm=no ls=yes/)
  assert.doesNotMatch(text, /permission\.requested|request_permission/, 'a decided approval was still put to a person')
  const { loadLocalPluginModule } = await import('../lib/plugins/localPluginRuntime')
  const asked = (await loadLocalPluginModule('guard')).asked as Array<{ kind: string; command: string; provider: string }>
  assert.deepEqual(asked.map(entry => [entry.kind, entry.command, entry.provider]), [['command', 'rm -rf build', 'acp'], ['command', 'ls -la', 'acp']])
  process.exit(0)
}

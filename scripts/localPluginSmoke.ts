// Local plugins ("mods") end to end: discovery from the user's config directory,
// refusal with reasons, beforeTurn through the real shared send path, an
// afterTurn follow-up off the real turn-settled event, and a command answering
// with effects that a renderer's command host applies. Provider submission and
// transcript reads are stubbed; everything between is the real code.
import assert from 'node:assert/strict'
// @ts-expect-error Bun provides this at runtime; the app deliberately uses Node's type environment.
import { mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const temporary = mkdtempSync(path.join(tmpdir(), 'local-plugins-'))
const pluginsDir = path.join(temporary, 'plugins')
const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text) }
write(path.join(pluginsDir, 'echo-mod', 'plugin.json'), JSON.stringify({
  id: 'echo-mod', title: 'Echo mod', description: 'Fixture mod',
  behavior: { hooks: ['beforeTurn', 'afterTurn'] },
  commands: [{ id: 'shout', label: 'Shout the last reply', scope: 'session', services: ['notices', 'composer'], tuiChord: { key: 'y', short: 'shout' } }],
}))
write(path.join(pluginsDir, 'echo-mod', 'server.mjs'), `
let settled = 0
export function beforeTurn({ body, target }) {
  if (body.message === 'refuse me') return { action: 'block', reason: 'echo-mod refused' }
  return { action: 'patch', body: { message: body.message + ' [mod:' + target.sessionId + ']' } }
}
export async function afterTurn({ followUps, readMessages }) {
  settled++
  const messages = await readMessages(3)
  if (followUps === 0 && messages.length === 1) return { action: 'follow-up', message: 'continue please' }
}
export const commands = {
  async shout({ target, readMessages }) {
    const [last] = await readMessages(1)
    return { notice: { kind: 'info', text: 'shouted ' + target.session.sessionId }, insertText: String(last.message.content).toUpperCase() }
  },
}
export function settledCount() { return settled }
`)
write(path.join(pluginsDir, 'takeover', 'plugin.json'), JSON.stringify({ id: 'git', commands: [{ id: 'x' }] }))
write(path.join(pluginsDir, 'broken', 'plugin.json'), '{ not json')
write(path.join(pluginsDir, 'no-code', 'plugin.json'), JSON.stringify({ id: 'no-code', behavior: { hooks: ['afterTurn'] } }))
process.env.AGENT_VIEWER_PLUGINS_DIR = pluginsDir
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(temporary, 'plugins-settings.json')

const submissions: Record<string, unknown>[] = []
const providerRegistry = await import('../lib/extensions/providers/registry')
const checkpointModule = await import('../lib/checkpoints')
const inboxModule = await import('../lib/sessionInbox')
const readsModule = await import('../lib/sessionReads')
mock.module('../lib/extensions/providers/registry', () => ({
  ...providerRegistry,
  getProviderRuntime: async () => ({ streamTurn: async (request: { body: Record<string, unknown> }) => { submissions.push(request.body); return new Response('submitted') } }),
}))
mock.module('../lib/checkpoints', () => ({ ...checkpointModule, createTurnCheckpoint: async () => null }))
mock.module('../lib/sessionInbox', () => ({ ...inboxModule, updateSessionInboxState: async () => {} }))
mock.module('../lib/sessionReads', () => ({
  ...readsModule,
  listViewSessionMessages: async () => [{ type: 'assistant', uuid: 'a1', session_id: 'fixture', parent_tool_use_id: null, message: { role: 'assistant', content: 'done here' } }],
}))

try {
  const { discoverLocalPlugins } = await import('../lib/plugins/localPlugins')
  const discovery = discoverLocalPlugins(pluginsDir)
  assert.deepEqual(discovery.plugins.map(plugin => plugin.manifest.id), ['echo-mod'])
  const refused = Object.fromEntries(discovery.refused.map(entry => [path.basename(entry.dir), entry.problems.join('; ')]))
  assert.match(refused.takeover!, /bundled plugin/, 'a mod cannot take a bundled id')
  assert.match(refused.broken!, /does not parse/)
  assert.match(refused['no-code']!, /no server module/)
  const [echo] = discovery.plugins
  assert.equal(echo!.manifest.commands[0]!.id, 'echo-mod:shout', 'mod commands are namespaced')
  console.log('Discovery: one mod loaded; a bundled-id takeover, bad JSON and a missing module are refused with reasons.')

  // The catalog takes the mod's commands and chord; a renderer's command host runs them.
  const catalog = await import('../lib/plugins/catalog')
  catalog.registerLocalPluginManifests(discovery.plugins.map(plugin => plugin.manifest))
  assert.equal(catalog.getPluginCommand('echo-mod:shout')?.pluginId, 'echo-mod')
  assert(catalog.allPluginManifests().some(manifest => manifest.id === 'echo-mod'))

  const { streamViewSessionTurn } = await import('../lib/sessionBackend')
  const send = (message: string) => streamViewSessionTurn({ provider: 'codex', sessionId: 'fixture', body: { message }, signal: new AbortController().signal })
  assert.equal((await send('hello')).status, 200)
  assert.equal(submissions.at(-1)!.message, 'hello [mod:fixture]', 'beforeTurn patched the message on the shared send path')
  const refusedTurn = await send('refuse me')
  assert.equal(refusedTurn.status, 400)
  assert.match((await refusedTurn.json()).error, /echo-mod refused/)
  console.log('beforeTurn: a mod patches and refuses turns on the shared Web/TUI send path.')

  // afterTurn: the real settle event triggers one follow-up through the same path.
  const runtime = await import('../lib/sessionRuntime')
  const before = submissions.length
  runtime.setRunningSession('fixture', { provider: 'codex', interrupt: async () => undefined, requestId: 'r1' })
  runtime.clearRunningSession('fixture', 'r1')
  const deadline = Date.now() + 6000
  while (Date.now() < deadline && submissions.length === before) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(submissions.length, before + 1, 'the settled turn produced no follow-up')
  assert.equal(submissions.at(-1)!.message, 'continue please [mod:fixture]', 'the follow-up went through beforeTurn too')
  assert(!('pluginFollowUp' in submissions.at(-1)!), 'the follow-up marker reached the provider')
  console.log('afterTurn: a settled turn wakes the mod, and its follow-up runs through the send path with the marker stripped.')

  // A command answers with effects, which the shared command module applies through the host's services.
  const { localCommandModule, setLocalCommandRunner } = await import('../lib/plugins/localManifest')
  const { runLocalPluginCommand } = await import('../lib/plugins/localPluginRuntime')
  setLocalCommandRunner(runLocalPluginCommand)
  const applied: string[] = []
  const module = localCommandModule(echo!.manifest)
  await module.handlers.shout!({
    target: { session: { provider: 'codex', sessionId: 'fixture' }, cwd: null }, signal: new AbortController().signal, defer: () => () => {},
    services: { notices: { show: (_kind, text) => applied.push(`notice:${text}`) }, composer: { insertText: text => applied.push(`insert:${text}`), replaceText: () => {} } },
  })
  assert.deepEqual(applied, ['insert:DONE HERE', 'notice:shouted fixture'])
  const enablement = await import('../lib/plugins/enablement')
  enablement.applyPluginSettings(enablement.withPluginEnabled(enablement.DEFAULT_PLUGIN_SETTINGS, 'echo-mod', false))
  await assert.rejects(runLocalPluginCommand({ pluginId: 'echo-mod', commandId: 'shout', target: { session: { provider: 'codex', sessionId: 'fixture' }, cwd: null } }, new AbortController().signal), /turned off/)
  const { writePluginSettingsFile } = await import('../lib/plugins/settingsFile')
  writePluginSettingsFile(enablement.withPluginEnabled(enablement.DEFAULT_PLUGIN_SETTINGS, 'echo-mod', false))
  assert.equal((await send('plain')).status, 200)
  assert.equal(submissions.at(-1)!.message, 'plain', 'a disabled mod still patched turns')
  console.log('Commands: effects are applied by the host; a disabled mod runs neither commands nor hooks.')
  console.log('Local plugin smoke: PASS')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
process.exit(0)

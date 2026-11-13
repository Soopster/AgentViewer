// A provider from a mod, end to end through the real host: the mod appears as
// an instance of `mod`, sessions list and read through the read path, a new
// session is created and a turn streams through the shared send path, and two
// provider mods never see each other's sessions.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const temporary = mkdtempSync(path.join(tmpdir(), 'mod-provider-'))
const plugins = path.join(temporary, 'plugins')
const agent = (id: string, name: string, reply: string) => {
  mkdirSync(path.join(plugins, id), { recursive: true })
  writeFileSync(path.join(plugins, id, 'plugin.json'), JSON.stringify({ id, title: name, provider: { displayName: name } }))
  writeFileSync(path.join(plugins, id, 'server.mjs'), `
const sessions = new Map()
let n = 0
export const provider = {
  listSessions: () => [...sessions.values()].map(({ messages, ...session }) => session),
  readMessages: (id) => sessions.get(id)?.messages ?? [],
  createSession: ({ cwd, title }) => { const id = '${id}-' + (++n); sessions.set(id, { id, cwd, title, updatedAt: Date.now(), messages: [] }); return { id } },
  async *sendTurn({ sessionId, message, history }) {
    const session = sessions.get(sessionId)
    session.messages.push({ role: 'user', text: message })
    const words = ['${reply}', '(' + history.length + ' before)', message.toUpperCase()]
    for (const word of words) { yield word + ' '; await new Promise(r => setTimeout(r, 5)) }
    session.messages.push({ role: 'assistant', text: words.join(' ') + ' ' })
    session.updatedAt = Date.now()
  },
}`)
}
agent('echo-agent', 'Echo agent', 'echo:')
agent('shout-agent', 'Shout agent', 'SHOUT:')
process.env.AGENT_VIEWER_PLUGINS_DIR = plugins
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(temporary, 'plugin-settings.json')
process.chdir(temporary)

try {
  const { listProviderInstances, withProviderInstance } = await import('../lib/providerInstances')
  const instances = (await listProviderInstances()).filter(instance => instance.provider === 'mod')
  assert.deepEqual(instances.map(instance => instance.id).sort(), ['mod', 'mod-echo-agent', 'mod-shout-agent'])
  assert.equal(instances.find(instance => instance.id === 'mod-echo-agent')?.displayName, 'Echo agent')
  console.log('Instances: each provider mod is an instance of `mod`, named by the mod.')

  const backend = await import('../lib/sessionBackend')
  const created = await withProviderInstance('mod-echo-agent', 'mod', () => backend.createNewViewSession({ provider: 'mod', cwd: temporary, title: 'first' }))
  assert.equal(created.provider, 'mod')
  const response = await withProviderInstance('mod-echo-agent', 'mod', () => backend.streamViewSessionTurn({ provider: 'mod', sessionId: created.sessionId, body: { message: 'hello there' }, signal: new AbortController().signal }))
  const frames = await response.text()
  assert.match(frames, /turn-accepted/)
  assert.match(frames, /"type":"mod_delta","delta":"echo: "/)
  // The UIs read reply text out of frames through the shared composer stream.
  const { extractSseFrames, extractStreamingAssistantText } = await import('../lib/composerStream')
  const streamed = extractSseFrames(frames).frames.map(frame => { try { return extractStreamingAssistantText(JSON.parse(frame.data)) } catch { return null } }).filter(Boolean).join('')
  assert.equal(streamed.trim(), 'echo: (0 before) HELLO THERE', `the composer stream did not read the reply: ${streamed}`)
  console.log('Send path: a new session is created and a turn streams mod_delta frames through streamViewSessionTurn.')

  const reads = await import('../lib/sessionReads')
  const listed = await withProviderInstance('mod-echo-agent', 'mod', () => reads.listViewSessions({ limit: 20, offset: 0, provider: 'mod', providerInstanceId: 'mod-echo-agent' }))
  assert(listed.some(session => session.sessionId === created.sessionId && session.customTitle === 'first'), `the mod session is not listed: ${JSON.stringify(listed.map(s => s.sessionId))}`)
  const messages = await withProviderInstance('mod-echo-agent', 'mod', () => reads.listViewSessionMessages(created.sessionId, { limit: 50, offset: 0 }, 'mod'))
  assert.deepEqual(messages.map(message => message.type), ['user', 'assistant'])
  assert.match(JSON.stringify(messages[1]), /echo: \(0 before\) HELLO THERE/)
  console.log('Read path: the session lists and its transcript reads back in the shared wire format.')

  const other = await withProviderInstance('mod-shout-agent', 'mod', () => reads.listViewSessions({ limit: 20, offset: 0, provider: 'mod', providerInstanceId: 'mod-shout-agent' }))
  assert(!other.some(session => session.sessionId === created.sessionId), 'one provider mod listed another mod\'s session')
  console.log('Isolation: a provider mod sees only its own sessions.')

  const enablement = await import('../lib/plugins/enablement')
  const { writePluginSettingsFile } = await import('../lib/plugins/settingsFile')
  enablement.applyPluginSettings(enablement.withPluginEnabled(enablement.DEFAULT_PLUGIN_SETTINGS, 'shout-agent', false))
  writePluginSettingsFile(enablement.withPluginEnabled(enablement.DEFAULT_PLUGIN_SETTINGS, 'shout-agent', false))
  assert(!(await listProviderInstances()).some(instance => instance.id === 'mod-shout-agent'), 'a disabled provider mod is still an instance')
  console.log('Enablement: turning a provider mod off removes its instance.')
  console.log('Mod provider smoke: PASS')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
process.exit(0)

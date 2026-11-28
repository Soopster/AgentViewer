import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseModConfigSchema, resolveModConfig } from '../lib/plugins/modConfig'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { decodeModView } from '../lib/plugins/modViews'
import { createModHarness } from '../lib/plugins/modTesting'
import { readModConfig, modConfigPath, writeModConfig } from '../lib/plugins/modConfigStore'
import { resetLocalPluginDiscovery } from '../lib/plugins/localPlugins'
import { renderLocalPluginView, runLocalPluginViewAction, runLocalPluginCommand, localBehaviorLoaders } from '../lib/plugins/localPluginRuntime'
import { applyWebLocalPlugins } from '../components/shell/localPlugins'
import { listLocalPluginManifests } from '../lib/plugins/catalog'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-sdk-'))
const previousDir = process.env.AGENT_VIEWER_PLUGINS_DIR
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'plugins')
const schema = parseModConfigSchema({ greeting: { type: 'string', title: 'Greeting', default: 'Hello' }, retries: { type: 'number', title: 'Retries', min: 0, max: 5, default: 2 }, token: { type: 'string', title: 'Token', secretEnv: 'MOD_FIXTURE_SECRET', required: true } })
try {
  for (const bad of [{ bad: { type: 'number', title: 'Bad', default: '3' } }, { bad: { type: 'number', title: 'Bad', min: 5, max: 1 } }, { bad: { type: 'string', title: 'Bad', secretEnv: 'TOKEN', default: 'secret' } }]) assert.throws(() => parseModConfigSchema(bad))
  assert.throws(() => resolveModConfig(schema), /Missing/)
  assert.throws(() => resolveModConfig(schema, { token: 'leak' }), /secretEnv/)
  assert.throws(() => resolveModConfig(schema, { retries: '3' }), /Invalid/)
  const resolved = resolveModConfig(schema, { retries: 4 }, { MOD_FIXTURE_SECRET: 'fixture-only' })
  assert.equal(resolved.token, 'fixture-only'); assert(Object.isFrozen(resolved))
  writeModConfig('fixture', schema, { retries: 3 })
  const original = readFileSync(modConfigPath('fixture'), 'utf8')
  assert.throws(() => writeModConfig('fixture', schema, { retries: 8 }))
  assert.equal(readFileSync(modConfigPath('fixture'), 'utf8'), original)
  assert(!original.includes('fixture-only'))
  assert.throws(() => modConfigPath('../escape'))
  const dir = path.join(process.env.AGENT_VIEWER_PLUGINS_DIR!, 'fixture'); mkdirSync(dir, { recursive: true })
  const raw = { id: 'fixture', title: 'Fixture', config: schema, behavior: { hooks: ['beforeTurn'] }, views: [{ id: 'board', title: 'Board' }], commands: [{ id: 'hello', services: ['notices'] }] }
  writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(raw))
  writeFileSync(path.join(dir, 'server.mjs'), `export function beforeTurn({config}) { return {action:'patch',body:{message:config.greeting}} }; export const views = { board: ({config}) => ({title:config.greeting,blocks:[]}) }; export const commands = {hello: ({config}) => ({notice: config.greeting})}; export const actions = { echo: ({item,config}) => ({notice: item === '' ? 'empty' : config.greeting}) }`)
  resetLocalPluginDiscovery()
  // Configuration is available even if required credentials are missing; it never resolves their values.
  const settings = await renderLocalPluginView('fixture', 'mod-config') as { blocks: unknown[] }
  assert(JSON.stringify(settings).includes('MOD_FIXTURE_SECRET'))
  assert(!JSON.stringify(settings).includes('fixture-only'))
  await runLocalPluginViewAction('fixture', 'mod-config', 'config:greeting', '')
  process.env.MOD_FIXTURE_SECRET = 'fixture-only'
  assert.equal(readModConfig('fixture', schema).greeting, '')
  assert.equal((await runLocalPluginViewAction('fixture', 'board', 'echo', '')).notice?.text, 'empty')
  assert.equal((await runLocalPluginCommand({ pluginId: 'fixture', commandId: 'hello', target: { session: null, cwd: null } }, new AbortController().signal)).notice?.text, '')
  const behavior = await localBehaviorLoaders().fixture!()
  assert.deepEqual(await behavior.beforeTurn!({ target: { provider: 'claude', sessionId: 's' }, signal: new AbortController().signal, body: {} }), { action: 'patch', body: { message: '' } })
  const manifest = parseLocalPluginManifest(raw, new Set()).manifest!
  const wireManifest = JSON.stringify(manifest)
  assert(wireManifest.includes('mod-config'))
  applyWebLocalPlugins({ local: { plugins: [JSON.parse(wireManifest)] } })
  assert(listLocalPluginManifests().find(mod => mod.id === 'fixture')?.localViews?.some(view => view.id === 'mod-config'))
  assert.equal(listLocalPluginManifests().find(mod => mod.id === 'fixture')?.config?.token.secretEnv, 'MOD_FIXTURE_SECRET')
  applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'fixture', false))
  await assert.rejects(renderLocalPluginView('fixture', 'mod-config'), /enabled/)
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  const content = decodeModView({ blocks: [{ type: 'progress', label: 'Build', value: 20, max: 10 }, { type: 'progress', label: 'Bad', value: NaN, max: 1 }, { type: 'select', id: 'mode', label: 'Mode', action: 'mode', options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'a' }] }, { type: 'table', columns: ['One'], rows: [['ok', 'extra']] }] }, 'test')
  assert.equal(content.blocks.length, 2)
  assert.deepEqual(content.blocks[0], { type: 'progress', label: 'Build', value: 10, max: 10 })
  let release: (() => void) | undefined, deactivations = 0
  const fixture = createModHarness({ views: { board: () => ({ title: 'Board', blocks: [{ type: 'button', label: 'Wait', action: 'wait' }] }) }, actions: { wait: async () => { await new Promise<void>(resolve => { release = resolve }); return { notice: { kind: 'info', text: 'late' } } } }, deactivate: () => { deactivations++ } })
  const pending = fixture.press('board', 'wait')
  while (!release) await Promise.resolve()
  fixture.disable(); fixture.disable()
  await assert.rejects(pending); release(); assert.equal(deactivations, 1)
  await assert.rejects(fixture.render('board'))
  const cli = (args: string[], input?: string) => spawnSync(process.execPath, ['run', 'bin/agent-viewer-mod-tools.ts', ...args], { encoding: 'utf8', input })
  const scaffold = path.join(temp, 'created')
  let result = cli(['create', 'created', '--path', scaffold]); assert.equal(result.status, 0, result.stderr)
  result = cli(['create', 'created', '--path', scaffold]); assert.notEqual(result.status, 0); assert(existsSync(path.join(scaffold, 'server.mjs')))
  const dispatched = spawnSync(process.execPath, [process.cwd() + '/bin/agent-viewer.mjs', 'mods', 'check', scaffold, '--json'], { encoding: 'utf8' })
  assert.equal(dispatched.status, 0, dispatched.stderr)
  result = cli(['test', scaffold]); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /PASS main.test/)
  writeFileSync(path.join(scaffold, 'fail.test.mjs'), 'export default async function() { throw new Error("deliberate fixture failure") }')
  const failed = cli(['test', scaffold]); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /deliberate fixture failure/)
  rmSync(path.join(scaffold, 'fail.test.mjs'))
  writeFileSync(path.join(scaffold, 'config.test.mjs'), `import assert from 'node:assert/strict'; export const fixture={config:{greeting:'Fixture'}}; export default async h=>{assert.equal((await h.command('hello')).notice.text,'Fixture')}`)
  result = cli(['test', scaffold]); assert.equal(result.status, 0, result.stderr)
  result = cli(['configure', 'fixture', '--values-stdin'], '{"retries":4}'); assert.equal(result.status, 0, result.stderr); assert(!result.stdout.includes('fixture-only'))
  const checked = spawnSync(process.execPath, ['run', 'bin/agent-viewer-mod-check.ts', scaffold, '--render', '--json'], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  console.log('Mod SDK: PASS (schema, atomic validation, secret references, generated settings, Web round trip, empty actions, hook config, disablement, author cancellation, scaffold/check/test/configure CLI)')
} finally {
  if (previousDir === undefined) delete process.env.AGENT_VIEWER_PLUGINS_DIR; else process.env.AGENT_VIEWER_PLUGINS_DIR = previousDir
  delete process.env.MOD_FIXTURE_SECRET
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS); resetLocalPluginDiscovery(); rmSync(temp, { recursive: true, force: true })
}

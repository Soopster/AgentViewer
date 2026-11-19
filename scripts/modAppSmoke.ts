import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { registerLocalPluginManifests, getPluginCommand } from '../lib/plugins/catalog'
import { applyPluginSettings } from '../lib/plugins/enablement'
import { modAppFor, modAppStore, modAppCommands, EMPTY_MOD_APP, applyModAppEffects, decodeModAppSnapshot } from '../lib/plugins/modApp'
import { recordModDiagnostic, readModDiagnostics } from '../lib/plugins/modDiagnostics'
import { readAppInspections, writeAppInspection } from '../lib/plugins/appInspection.mjs'
import { fileNavigationTarget } from '../plugins/files/domain/navigation'
import { sessionIdentityKey } from '../lib/sessionIdentity'

const temp = mkdtempSync(path.join(tmpdir(), 'mod-app-smoke-'))
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'mods')
process.env.AGENT_VIEWER_INSPECTION_DIR = path.join(temp, 'inspection')
const fixture = path.join(temp, 'mods', 'app-fixture')
mkdirSync(fixture, { recursive: true })
const raw = { id: 'app-fixture', appServices: ['data', 'navigation'], views: [{ id: 'board', title: 'Board' }], commands: [{ id: 'inspect', label: 'Inspect' }], widgets: [{ id: 'state' }] }
writeFileSync(path.join(fixture, 'plugin.json'), JSON.stringify(raw))
writeFileSync(path.join(fixture, 'server.mjs'), `
export const views = { board: ({ app }) => ({ title: app.instanceId, blocks: [{ type: 'text', text: app.selectedKey }] }) }
export const actions = { open: ({ app }) => ({ appEffects: [{ type: 'session', target: app.sessions[0].target }] }), fail: () => { throw new Error('fixture failure') } }
export const commands = { inspect: ({ app }) => ({ notice: app.selectedKey }) }
export const widgets = { state: ({ app }) => ({ text: app.selectedKey }) }
`)
const parsed = parseLocalPluginManifest(raw, new Set())
assert.deepEqual(parsed.problems, [])
assert.equal(parseLocalPluginManifest({ ...raw, appServices: ['private-root-state'] }, new Set()).manifest, null)
assert.equal(parseLocalPluginManifest({ ...raw, views: [raw.views[0], raw.views[0]] }, new Set()).manifest, null)
assert.equal(parseLocalPluginManifest({ ...raw, commands: [{ id: 'view-board' }] }, new Set()).manifest, null)
assert.deepEqual(fileNavigationTarget('/repo', 'src/../README.md'), { path: '/repo/README.md', directory: '/repo' })
assert.deepEqual(fileNavigationTarget('C:\\repo', 'README.md'), { path: 'C:/repo/README.md', directory: 'C:/repo' })
assert.deepEqual(fileNavigationTarget('C:/repo', 'C:\\file.txt'), { path: 'C:/file.txt', directory: 'C:/' })
assert.deepEqual(fileNavigationTarget('/repo', '/file.txt'), { path: '/file.txt', directory: '/' })
registerLocalPluginManifests([parsed.manifest!])
const targets = ['one', 'two'].map(providerInstanceId => ({ sessionId: 'same', provider: 'codex' as const, providerInstanceId }))
const snapshot = { ...EMPTY_MOD_APP, instanceId: 'web-fixture', cwd: temp, selectedKey: sessionIdentityKey(targets[0]), sessions: targets.map(target => ({ key: sessionIdentityKey(target), target, title: target.providerInstanceId, cwd: temp, activity: 'running' as const })), commands: modAppCommands('web', temp, sessionIdentityKey(targets[0])) }
try {
  let changes = 0
  const unsubscribe = modAppStore.subscribe(() => changes++)
  modAppStore.publish(snapshot)
  modAppStore.publish(snapshot)
  assert.equal(changes, 1, 'unchanged app data does not notify')
  assert.notEqual(snapshot.sessions[0].key, snapshot.sessions[1].key)
  assert(Object.isFrozen(modAppStore.getSnapshot().sessions[0].target))
  const decoded = decodeModAppSnapshot({ ...snapshot, credentials: 'private', transcript: ['private'] })!
  assert.equal('credentials' in decoded, false)
  assert.equal('transcript' in decoded, false)
  const calls: unknown[] = []
  const unbind = modAppStore.bind({ runCommand: id => { calls.push(id); return true }, openSession: target => { calls.push(target) }, openFile: file => { calls.push(file) } })
  const app = modAppFor(parsed.manifest!)!
  await app.commands.run('git')
  await app.openSession(targets[1])
  await app.openFile('/fixture/file.ts')
  assert.deepEqual(calls, ['git', targets[1], '/fixture/file.ts'])
  assert(app.commands.list().every(command => !getPluginCommand(command.id)?.handler))
  await assert.rejects(app.commands.run('reuse-last-prompt'), /unavailable/)
  modAppStore.publish({ ...snapshot, selectedKey: snapshot.sessions[1].key })
  await assert.rejects(applyModAppEffects(parsed.manifest!.id, [{ type: 'command', id: 'git' }], snapshot), /no longer active/)
  assert.equal(calls.length, 3)
  await assert.rejects(modAppFor(parsed.manifest!, () => false)!.commands.run('git'), /closed/)
  applyPluginSettings({ version: 1, disabled: [raw.id] })
  await assert.rejects(app.commands.run('git'), /no longer active/)
  applyPluginSettings({ version: 1, disabled: [] })
  modAppStore.publish(snapshot)
  const runtime = await import('../lib/plugins/localPluginRuntime')
  const rendered = await runtime.renderLocalPluginView(raw.id, 'board', new AbortController().signal, snapshot) as { title: string }
  assert.equal(rendered.title, 'web-fixture')
  const effects = await runtime.runLocalPluginViewAction(raw.id, 'board', 'open', undefined, new AbortController().signal, snapshot)
  assert.deepEqual(effects.appEffects, [{ type: 'session', target: targets[0] }])
  const command = await runtime.runLocalPluginCommand({ pluginId: raw.id, commandId: 'inspect', target: { session: null, cwd: temp }, app: snapshot }, new AbortController().signal)
  assert.equal(command.notice?.text, snapshot.selectedKey)
  const widgets = await runtime.readLocalPluginWidgets(new AbortController().signal, snapshot)
  assert.equal(widgets[0].lines[0], snapshot.selectedKey!)
  await assert.rejects(runtime.runLocalPluginViewAction(raw.id, 'board', 'fail', undefined), /fixture failure/)
  assert(readModDiagnostics().some(error => error.pluginId === raw.id && error.contribution === 'action:fail'))
  for (let i = 0; i < 70; i++) recordModDiagnostic('broken-mod', `widget:${i}`, 'broken')
  assert.equal(readModDiagnostics().length, 50)
  writeAppInspection({ app: snapshot, mods: [{ id: raw.id, title: 'Fixture', enabled: true }], diagnostics: readModDiagnostics() })
  writeAppInspection({ app: { ...snapshot, instanceId: 'tui-fixture', renderer: 'tui' }, mods: [], diagnostics: [] })
  assert.equal(readAppInspections().length, 2)
  assert.equal(readAppInspections('web-fixture').length, 1)
  assert.equal(readAppInspections('web-fixture', Date.now() + 16_000)[0].stale, true)
  const cli = (args: string[]) => spawnSync(process.execPath, ['bin/agent-viewer.mjs', ...args], { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 25_000 })
  const status = cli(['app', 'status', '--instance', 'tui-fixture', '--json'])
  assert.equal(status.status, 0, status.stderr)
  assert.equal(JSON.parse(status.stdout).instances[0].app.instanceId, 'tui-fixture')
  const mods = cli(['mods', 'status', '--instance', 'web-fixture', '--json'])
  assert.equal(JSON.parse(mods.stdout).instances[0].mods[0].status, 'enabled')
  assert.equal(cli(['app', 'status', '--instance', 'missing']).status, 1)
  assert.equal(cli(['app', 'status', '--unknown']).status, 2)
  const marker = path.join(temp, 'executed')
  writeFileSync(path.join(fixture, 'server.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'yes');\n` + readFileSync(path.join(fixture, 'server.mjs'), 'utf8'))
  const check = cli(['mods', 'check', fixture, '--json'])
  assert.equal(check.status, 0, check.stderr + check.stdout)
  assert.equal(existsSync(marker), false, 'static checks do not run mod code')
  const render = cli(['mods', 'check', fixture, '--render', '--json'])
  assert.equal(render.status, 0, render.stderr + render.stdout)
  assert.equal(existsSync(marker), true, 'explicit render checks execute trusted code')
  const componentMod = path.join(temp, 'component-mod')
  mkdirSync(componentMod)
  writeFileSync(path.join(componentMod, 'plugin.json'), JSON.stringify({ id: 'component-check', appServices: ['data'], views: [{ id: 'meter', component: true }] }))
  writeFileSync(path.join(componentMod, 'server.mjs'), 'export const actions = {}')
  writeFileSync(path.join(componentMod, 'web.mjs'), `export const views = ({ React }) => ({ meter: ({ app }) => React.createElement('div', null, app.getSnapshot().instanceId) })`)
  writeFileSync(path.join(componentMod, 'tui.mjs'), `export const views = ({ React }) => ({ meter: ({ app }) => React.createElement('text', null, app.getSnapshot().instanceId) })`)
  const components = cli(['mods', 'check', componentMod, '--render', '--json'])
  assert.equal(components.status, 0, components.stderr + components.stdout)
  assert(JSON.parse(components.stdout).checks.includes('web initial render / exports'))
  assert(JSON.parse(components.stdout).checks.includes('tui initial render / exports'))
  writeFileSync(path.join(componentMod, 'web.mjs'), `export const views = () => ({ wrong: () => null })`)
  const missing = cli(['mods', 'check', componentMod, '--render', '--json'])
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /Missing web component/)
  writeFileSync(path.join(fixture, 'server.mjs'), `export const views = { board: () => new Promise(() => {}) }; export const widgets = {}; export const commands = { inspect() {} }; setInterval(() => {}, 1000)`)
  const timedOut = cli(['mods', 'check', fixture, '--render', '--json'])
  assert.equal(timedOut.status, 1)
  assert.match(timedOut.stdout, /ETIMEDOUT/)
  writeFileSync(path.join(fixture, 'server.mjs'), 'export const views = { broken:')
  assert.equal(cli(['mods', 'check', fixture, '--json']).status, 1)
  unsubscribe(); unbind()
  console.log('Mod app: PASS (live identity, immutable data, navigation, stale/disabled/closed actions, runtime contexts, bounded diagnostics, instance inspection and static/render CLI checks)')
} finally {
  rmSync(temp, { recursive: true, force: true })
}

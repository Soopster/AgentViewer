import assert from 'node:assert/strict'
import { listPluginComposerSlashCommands, matchPluginComposerSlashCommand, pluginComposerSlashInput } from '../lib/plugins/composerSlash'
import { registerLocalPluginManifests } from '../lib/plugins/catalog'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../lib/plugins/enablement'
import { createPluginCommandHost } from '../lib/plugins/commandHost'
import { createComposerAccessoryController } from '../lib/plugins/composerHost'
import { PLUGIN_API_VERSION } from '../lib/plugins/types'
import type { PluginCommandInput } from '../lib/plugins/commands'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import type { LocalPluginManifest } from '../lib/plugins/localManifest'
const fixture: LocalPluginManifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'slash-fixture', title: 'Fixture', description: 'Reusable slash contribution', source: 'local',
  renderers: ['web', 'tui'], stateVersion: 1, surfaces: [],
  commands: [{ id: 'slash-fixture:inspect', label: 'Inspect', category: 'Session', scope: 'session', requires: 'session', renderers: ['web', 'tui'], handler: 'inspect', services: [], composerSlash: { name: 'inspect-fixture', description: 'Inspect the captured arguments', argumentHint: '[path]' } }],
}
const decoded = parseLocalPluginManifest({ id: 'declared-slash', title: 'Declared slash', commands: [{ id: 'inspect', scope: 'session', composerSlash: { name: 'declared-inspect', description: 'Inspect a path' } }] }, new Set())
assert.deepEqual(decoded.problems, [])
assert.equal(decoded.manifest!.commands[0].composerSlash?.name, 'declared-inspect')
assert.equal(parseLocalPluginManifest({ id: 'invalid-slash', title: 'Invalid', commands: [{ id: 'inspect', composerSlash: { name: '/bad', description: 'Bad' } }] }, new Set()).manifest, null)
registerLocalPluginManifests([fixture])
try {
  for (const renderer of ['web', 'tui'] as const) {
    assert.ok(listPluginComposerSlashCommands(renderer, 'pi').some(entry => entry.command === '/better'))
    const command = matchPluginComposerSlashCommand('/inspect-fixture src/a.ts\nMore context', renderer, 'codex')!
    assert.equal(command.id, 'slash-fixture:inspect')
    const input = pluginComposerSlashInput(command, '/inspect-fixture src/a.ts\nMore context')
    assert.equal(input.slash.arguments, 'src/a.ts\nMore context')
    let captured: PluginCommandInput | undefined
    const host = createPluginCommandHost(renderer, [fixture], { 'slash-fixture': async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'slash-fixture', handlers: { inspect: context => { captured = context.input } } }) })
    await host.run(command.id, { target: { session: { provider: 'codex', providerInstanceId: 'work', sessionId: 'same' }, cwd: '/fixture' }, services: {}, input })
    assert.deepEqual(captured, input)
    assert.equal(Object.isFrozen(captured?.slash), true)
    host.dispose()
    assert.equal(matchPluginComposerSlashCommand('/better-other', renderer, 'pi'), undefined)
    assert.equal(matchPluginComposerSlashCommand('explain /better', renderer, 'pi'), undefined)
    applyPluginSettings({ version: 1, disabled: ['better', 'slash-fixture'] })
    assert.equal(matchPluginComposerSlashCommand('/better do work', renderer, 'pi'), undefined)
    assert.equal(matchPluginComposerSlashCommand('/inspect-fixture', renderer, 'pi'), undefined)
    assert.ok(!listPluginComposerSlashCommands(renderer).some(entry => entry.command === '/better'))
    applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  }
  const controller = createComposerAccessoryController([{ id: 'fixture', title: 'Fixture', pluginId: 'slash-fixture', maxRows: 2, services: [] }])
  const token = Symbol('test')
  let cancel = 0
  controller.report('fixture', token, { rows: 2, backgroundKeys: true })
  controller.keys('fixture', token, key => { if (key.name === 'escape') { cancel++; return true }; return false })
  assert.equal(controller.getSnapshot().rows, 2)
  assert.equal(controller.handleKey({ name: 'x', sequence: 'x', ctrl: false, shift: false }), false)
  assert.equal(controller.handleKey({ name: 'escape', sequence: '\u001b', ctrl: false, shift: false }), true)
  assert.equal(cancel, 1)
  controller.report('fixture', token, { rows: 0, backgroundKeys: false })
  assert.equal(controller.handleKey({ name: 'escape', sequence: '\u001b', ctrl: false, shift: false }), false)
  controller.dispose()
  console.log('Plugin composer slash commands: PASS (second plugin, Web/TUI discovery, exact matching, arguments, immutable dispatch, enablement, two-row allocation and background Escape)')
} finally { registerLocalPluginManifests([]); applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) }

import assert from 'node:assert/strict'
import { createComposerAccessoryController, createPluginComposerRegistry, listComposerAccessories } from '../lib/plugins/composerHost'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../lib/plugins/enablement'
import { manifest } from '../plugins/goals/manifest'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import type { PluginComposerModule } from '../lib/plugins/composer'

applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const specs = listComposerAccessories('web', [manifest])
assert.equal(specs[0].id, 'session-goal')
assert.throws(() => listComposerAccessories('web', [manifest, manifest]), /Invalid composer accessory/)
for (const maxRows of [0, 5, 1.5]) assert.throws(() => listComposerAccessories('web', [{ ...manifest, composer: [{ ...manifest.composer[0], maxRows }] }]), /Invalid/)
const later: PluginManifest = { ...manifest, id: 'later', composer: [{ ...manifest.composer[0], id: 'later', order: -1 }] }
assert.deepEqual(listComposerAccessories('tui', [manifest, later]).map(spec => spec.id), ['later', 'session-goal'])
assert.throws(() => createPluginComposerRegistry('web', [manifest], {}), /no web composer loader/)

const view = () => null
const module: PluginComposerModule<typeof view> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'goals', accessories: { 'session-goal': view } }
let loads = 0
const registry = createPluginComposerRegistry('web', [manifest], { goals: async () => { loads++; return module } })
assert.equal(loads, 0)
await Promise.all([registry.load('goals'), registry.load('goals')])
assert.equal(loads, 1)
assert.equal(registry.peek('goals'), module)
applyPluginSettings({ version: 1, disabled: ['goals'] })
assert.equal(registry.peek('goals'), undefined)
await assert.rejects(registry.load('goals'), { name: 'AbortError' })
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await registry.load('goals')
assert.equal(loads, 2)
registry.dispose()
await assert.rejects(registry.load('goals'), { name: 'AbortError' })
for (const invalid of [{ ...module, apiVersion: 0 }, { ...module, pluginId: 'other' }, { ...module, accessories: {} }]) {
  const bad = createPluginComposerRegistry('tui', [manifest], { goals: async () => invalid as typeof module })
  await assert.rejects(bad.load('goals'), /mismatch|accessory/)
  bad.dispose()
}
let release!: (value: typeof module) => void
let began!: () => void
const started = new Promise<void>(resolve => { began = resolve })
const pendingRegistry = createPluginComposerRegistry('web', [manifest], { goals: () => { began(); return new Promise<typeof module>(resolve => { release = resolve }) } })
const pending = pendingRegistry.load('goals')
await started
applyPluginSettings({ version: 1, disabled: ['goals'] })
release(module)
await assert.rejects(pending, { name: 'AbortError' })
assert.equal(pendingRegistry.peek('goals'), undefined)
pendingRegistry.dispose()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

const controller = createComposerAccessoryController(specs)
const token = Symbol(), stale = Symbol()
controller.report('session-goal', token, { rows: 99, modal: true, summary: 'Objective' })
assert.equal(controller.getSnapshot().rows, 1)
controller.report('session-goal', stale, { rows: 0 })
controller.remove('session-goal', stale)
assert.equal(controller.getSnapshot().modal, true)
const key = { name: 'escape', ctrl: false, shift: false, sequence: '' }
assert.equal(controller.handleKey(key), 'input', 'modal typing stays in the native input without a registered handler')
controller.keys('session-goal', token, () => true)
assert.equal(controller.handleKey(key), true)
assert.equal(controller.open('missing'), false)
assert.equal(controller.open('session-goal'), true)
assert.equal(controller.request('session-goal'), 1)
applyPluginSettings({ version: 1, disabled: ['goals'] })
controller.prune()
assert.equal(controller.getSnapshot().rows, 0)
assert.equal(controller.getSnapshot().modal, false)
assert.equal(controller.request('session-goal'), 0)
assert.equal(controller.open('session-goal'), false)
assert.equal(controller.handleKey(key), false)
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
controller.dispose()
controller.report('session-goal', token, { rows: 1 })
assert.equal(controller.getSnapshot().rows, 0)
controller.activate()
controller.report('session-goal', token, { rows: 1 })
assert.equal(controller.getSnapshot().rows, 1, 'StrictMode effect restart can activate a fresh lifetime')
controller.remove('session-goal', token)
assert.equal(controller.getSnapshot().rows, 0)
controller.dispose()
console.log('Composer accessory contracts: PASS (metadata, lazy loading, validation, disable races, bounded rows, modal keys, owner tokens and effect restart)')

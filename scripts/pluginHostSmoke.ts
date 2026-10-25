// Feature plugin host contract: manifests are metadata only, activation is lazy
// and retryable, API and service mismatches are refused before a view mounts,
// scoped state survives a placement move and is released on close, and the
// state codec keeps what it cannot apply. Hermetic: no renderer, no network.
import assert from 'node:assert/strict'
import { PLUGIN_MANIFESTS, getPluginCommand, isPluginSurfaceId, listPluginCommands, listPluginSurfaces } from '../lib/plugins/catalog'
import { createPluginViewRegistry, pluginStateVersions } from '../lib/plugins/activation'
import { createPluginStateStore, decodePluginStateSnapshot } from '../lib/plugins/scopedState'
import { dispatchPluginCommand, subscribePluginCommands } from '../lib/plugins/commandBus'
import { PLUGIN_API_VERSION, type PluginManifest, type PluginViewModule } from '../lib/plugins/types'

const tick = () => new Promise(resolve => setTimeout(resolve, 5))

// Catalog: every command opens a declared surface; ids are unique and resolvable.
assert.ok(PLUGIN_MANIFESTS.length >= 1)
for (const manifest of PLUGIN_MANIFESTS) {
  assert.equal(manifest.apiVersion, PLUGIN_API_VERSION)
  for (const surface of manifest.surfaces) assert.equal(isPluginSurfaceId(surface.id), true)
  for (const command of manifest.commands) assert.equal(getPluginCommand(command.id)?.pluginId, manifest.id)
}
assert.equal(isPluginSurfaceId('__proto__'), false)
assert.equal(isPluginSurfaceId('editor'), false, 'built-in kinds are not plugin surfaces')
assert.deepEqual(listPluginCommands('tui').map(command => command.id).includes('analytics'), true)
assert.deepEqual(listPluginSurfaces('web').map(surface => surface.id).includes('analytics'), true)

// Manifests are browser-safe: bundling the catalog reaches no dependency, view,
// worker or server module.
const graph: string[] = []
const bundle = await Bun.build({
  entrypoints: ['./lib/plugins/catalog.ts'], target: 'browser', minify: true,
  plugins: [{ name: 'plugin-metadata-boundary', setup(build) { build.onLoad({ filter: /.*/ }, args => { graph.push(args.path); return undefined }) } }],
})
assert.equal(bundle.success, true, String(bundle.logs))
assert.equal(graph.some(name => /\/node_modules\/|\/plugins\/[^/]+\/(tui|web|server)\/|\/tui\/opentui\/|\/components\//.test(name)), false,
  `plugin metadata escaped its browser-safe boundary: ${graph.join(', ')}`)

// Activation: lazy, deduplicated, retryable, validated.
const fixture: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'fixture', title: 'Fixture', renderers: ['tui'], stateVersion: 1,
  surfaces: [{ id: 'fixture-view', title: '◇ Fixture', pin: null, single: true, keys: 'window', placements: ['overlay'], windowLabel: 'Fixture', services: ['session-transcript'] }],
  commands: [],
}
const view = () => null
let loads = 0
let flaky = 0
let shape: 'good' | 'old-api' | 'wrong-id' | 'no-view' = 'good'
const moduleFor = (): PluginViewModule<typeof view> => {
  if (shape === 'old-api') return { apiVersion: 0 as never, pluginId: 'fixture', views: { 'fixture-view': view } }
  if (shape === 'wrong-id') return { apiVersion: PLUGIN_API_VERSION, pluginId: 'other', views: { 'fixture-view': view } }
  if (shape === 'no-view') return { apiVersion: PLUGIN_API_VERSION, pluginId: 'fixture', views: {} }
  return { apiVersion: PLUGIN_API_VERSION, pluginId: 'fixture', views: { 'fixture-view': view } }
}
const registry = createPluginViewRegistry<typeof view>('tui', {
  fixture: async () => { loads++; if (++flaky === 1) throw new Error('chunk offline'); return moduleFor() },
} as never, ['session-transcript'], [fixture])
assert.equal(loads, 0, 'registration activates nothing')
assert.equal(registry.isLoaded('fixture'), false)
await assert.rejects(registry.load('fixture'), /chunk offline/)
assert.equal(registry.isLoaded('fixture'), false, 'a failed load is evicted')
for (const bad of ['old-api', 'wrong-id', 'no-view'] as const) {
  shape = bad
  await assert.rejects(registry.load('fixture'), /API|identity|no tui view/)
  assert.equal(registry.isLoaded('fixture'), false, `${bad} is refused, not cached`)
}
shape = 'good'
const before = loads
const loaded = await Promise.all(Array.from({ length: 10 }, () => registry.load('fixture')))
assert.equal(loads, before + 1, 'concurrent opens share one load')
assert.ok(loaded.every(entry => entry === loaded[0]))
assert.equal(registry.peek('fixture')?.views['fixture-view'], view)
await assert.rejects(registry.load('missing'), /Unknown extension/)
// A host lacking a declared service refuses activation.
const noServices = createPluginViewRegistry<typeof view>('tui', { fixture: async () => moduleFor() } as never, [], [fixture])
await assert.rejects(noServices.load('fixture'), /needs services this host lacks: session-transcript/)
// A manifest claiming a renderer with no loader is a registration error, at boot.
assert.throws(() => createPluginViewRegistry('tui', {}, [], [fixture]), /no tui loader/)

// Scoped state: survives an unmount/remount in one tick (a placement move),
// is released after a close, and runs cleanups once.
const store = createPluginStateStore()
let cleanups = 0
let release = store.hold('fixture', 'a')
store.set('fixture', 'a', 'pane', 3)
store.onDispose('fixture', 'a', () => { cleanups++ })
release()
release = store.hold('fixture', 'a')
await tick()
assert.equal(store.get('fixture', 'a', 'pane', 0), 3, 'a move keeps state')
assert.equal(cleanups, 0)
release()
release()
await tick()
assert.equal(store.has('fixture', 'a'), false, 'a closed view releases its instance')
assert.equal(cleanups, 1, 'cleanups run once, on dispose')
assert.equal(store.get('fixture', 'a', 'pane', 0), 0)
// Instances are independent: two sessions' views never share a value.
store.set('fixture', 'x', 'pane', 1)
store.set('fixture', 'y', 'pane', 2)
assert.equal(store.get('fixture', 'x', 'pane', 0), 1)
assert.equal(store.get('fixture', 'y', 'pane', 0), 2)
let notified = 0
const unsubscribe = store.subscribe('fixture', 'x', () => { notified++ })
store.set('fixture', 'x', 'pane', 1)
store.set('fixture', 'y', 'pane', 5)
assert.equal(notified, 0, 'an unchanged value or another instance does not notify')
store.set('fixture', 'x', 'pane', 4)
assert.equal(notified, 1)
unsubscribe()

// Codec: unknown plugins and other state versions survive a round trip.
const versions = { fixture: 2, ...pluginStateVersions([]) }
const saved = {
  version: 1,
  plugins: {
    fixture: { stateVersion: 2, instances: { b: { pane: 6 } } },
    uninstalled: { stateVersion: 1, instances: { z: { note: 'keep me' } } },
    downgraded: { stateVersion: 9, instances: { q: { pane: 1 } } },
  },
}
const restoredStore = createPluginStateStore()
restoredStore.restore(saved, { ...versions, downgraded: 1 })
assert.equal(restoredStore.get('fixture', 'b', 'pane', 0), 6)
assert.equal(restoredStore.get('downgraded', 'q', 'pane', 0), 0, 'a state version mismatch restores defaults')
const roundTrip = restoredStore.snapshot({ ...versions, downgraded: 1 })
assert.deepEqual(roundTrip.plugins.uninstalled, saved.plugins.uninstalled, 'an unknown plugin keeps its data')
assert.deepEqual(roundTrip.plugins.downgraded, saved.plugins.downgraded, 'a mismatched version keeps its data')
assert.deepEqual(roundTrip.plugins.fixture, saved.plugins.fixture)
for (const junk of [null, 'x', [], { version: 2 }, { version: 1, plugins: [] }, { version: 1, plugins: { a: { stateVersion: 'x' } } }]) {
  assert.deepEqual(decodePluginStateSnapshot(junk).plugins, {})
}

// Command bus: the first host that claims a command handles it.
const seen: string[] = []
const offA = subscribePluginCommands(id => { seen.push(`a:${id}`); return false })
const offB = subscribePluginCommands(id => { seen.push(`b:${id}`); return id === 'analytics' })
assert.equal(dispatchPluginCommand('analytics'), true)
assert.equal(dispatchPluginCommand('nothing'), false)
offA(); offB()
assert.equal(dispatchPluginCommand('analytics'), false)
assert.deepEqual(seen, ['a:analytics', 'b:analytics', 'a:nothing', 'b:nothing'])

console.log(JSON.stringify({ test: 'plugin host', passed: true, plugins: PLUGIN_MANIFESTS.length, metadataModules: graph.length }))

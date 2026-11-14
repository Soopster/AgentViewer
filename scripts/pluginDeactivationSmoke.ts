import assert from 'node:assert/strict'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'
import { createPluginResourceScope } from '../lib/plugins/lifecycle'
import { createPluginViewRegistry } from '../lib/plugins/activation'
import { createPluginStateStore } from '../lib/plugins/scopedState'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'

const fixture: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'lifecycle-fixture', title: 'Lifecycle', description: 'Lifecycle fixture', renderers: ['tui'], stateVersion: 1,
  surfaces: [{ id: 'lifecycle-view', title: 'Lifecycle', pin: null, single: true, keys: 'window', placements: ['overlay'], windowLabel: 'Lifecycle', services: [] }], commands: [],
}
const disable = (id: string) => applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, id, false))
let disposed = 0, loads = 0
const module = { apiVersion: PLUGIN_API_VERSION, pluginId: fixture.id, views: { 'lifecycle-view': () => null }, deactivate: () => { disposed++ } }
const registry = createPluginViewRegistry('tui', { [fixture.id]: async () => { loads++; return module } } as never, [], [fixture])
assert.equal(loads, 0)
disable(fixture.id)
await assert.rejects(registry.load(fixture.id), { name: 'AbortError' })
assert.equal(loads, 0, 'disabled before first use must remain unloaded')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await registry.load(fixture.id)
assert.equal(registry.isLoaded(fixture.id), true)
const scope = createPluginResourceScope(fixture.id)
let cleaned = 0
scope.defer(() => { cleaned++ })
const cancelled = new Promise<void>(resolve => scope.signal.addEventListener('abort', () => resolve(), { once: true }))
const store = createPluginStateStore()
const release = store.hold(fixture.id, 'mounted')
store.set(fixture.id, 'mounted', 'large-result', new Uint8Array(1024))
store.set(fixture.id, 'parked', 'result', 'cached')
disable(fixture.id)
await cancelled
assert.equal(cleaned, 1)
assert.equal(disposed, 1)
assert.equal(registry.peek(fixture.id), undefined)
assert.equal(store.has(fixture.id, 'mounted'), false)
assert.equal(store.has(fixture.id, 'parked'), false)
store.set(fixture.id, 'late-work', 'result', new Uint8Array(1024))
store.hold(fixture.id, 'late-work')
assert.equal(store.has(fixture.id, 'late-work'), false, 'late callbacks resurrected disabled state')
release(); scope.dispose()
assert.equal(cleaned, 1)
let disabledCleanup = 0
createPluginResourceScope(fixture.id).defer(() => { disabledCleanup++ })
assert.equal(disabledCleanup, 1, 'late work cannot allocate resources while disabled')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await registry.load(fixture.id)
assert.equal(loads, 2)
registry.dispose()

// Disable/re-enable while a chunk is loading: an old completion cannot populate or evict the new cache.
const resolves: Array<(value: typeof module) => void> = []
const racing = createPluginViewRegistry('tui', { [fixture.id]: () => new Promise(resolve => { resolves.push(resolve) }) } as never, [], [fixture])
const old = racing.load(fixture.id)
const oldRejected = assert.rejects(old, { name: 'AbortError' })
await Promise.resolve()
disable(fixture.id)
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const fresh = racing.load(fixture.id)
await Promise.resolve()
resolves[0]!(module)
await oldRejected
assert.equal(racing.peek(fixture.id), undefined)
resolves[1]!(module)
await fresh
assert.equal(racing.peek(fixture.id), module)
racing.dispose()

// Exercise the production worker clients without depending on CPU scheduling.
const originalWorker = globalThis.Worker
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  terminated = false
  sent: Array<{ id: number }> = []
  constructor(..._args: unknown[]) { TestWorker.instances.push(this) }
  postMessage(message: { id: number }) { this.sent.push(message) }
  terminate() { this.terminated = true }
}
globalThis.Worker = TestWorker as unknown as typeof Worker
try {
  const { computeAnalyticsAsync } = await import('../plugins/analytics/tui/analyticsWorkerClient')
  const pending = computeAnalyticsAsync(null)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  const worker = TestWorker.instances.at(-1)!
  const lateError = worker.onerror!
  disable('analytics')
  await rejected
  assert.equal(worker.terminated, true)
  const blocked = computeAnalyticsAsync(null)
  await assert.rejects(blocked, { name: 'AbortError' })
  assert.equal(TestWorker.instances.at(-1), worker, 'disabled client restarted its worker')
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  const resumed = computeAnalyticsAsync(null)
  const replacement = TestWorker.instances.at(-1)!
  assert.notEqual(replacement, worker)
  lateError({ message: 'stale worker failure' })
  assert.equal(replacement.terminated, false)
  replacement.onmessage!({ data: { id: replacement.sent[0]!.id, ok: true, analytics: { restored: true } } })
  assert.deepEqual(await resumed, { restored: true } as never)
  disable('analytics')
  assert.equal(replacement.terminated, true)
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  const { searchEditorProjectAsync } = await import('../plugins/editor/tui/editorProjectSearchWorkerClient')
  const search = searchEditorProjectAsync('/tmp', 'query', { regex: false, matchCase: false, wholeWord: false }, [])
  const searchRejected = assert.rejects(search, { name: 'AbortError' })
  const searchWorker = TestWorker.instances.at(-1)!
  disable('editor')
  await searchRejected
  assert.equal(searchWorker.terminated, true)
} finally {
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  globalThis.Worker = originalWorker
}
console.log('Plugin deactivation: lazy disable, resource abort, state/cache release, load races, worker termination and restart passed')

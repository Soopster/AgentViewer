import assert from 'node:assert/strict'
import { createPluginApplicationHost } from '../lib/plugins/applicationHost'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import type { PluginActivitySnapshot, PluginApplicationModule } from '../lib/plugins/application'
import { DEFAULT_PLUGIN_SETTINGS, applyPluginSettings } from '../lib/plugins/enablement'
import { createAlertObserver } from '../plugins/session-alerts/domain/observer'
import { createNotificationCenter } from '../lib/plugins/notifications'
import { pluginRuntimeActivity } from '../lib/plugins/runtimeActivity'

const manifest = (id: string): PluginManifest => ({ apiVersion: PLUGIN_API_VERSION, id, title: id, description: id,
  renderers: ['web', 'tui'], surfaces: [], commands: [], stateVersion: 1,
  application: { events: ['sessionActivity'], services: ['notifications'] },
})
const event = (activity: Record<string, 'running' | 'needs-input' | 'waiting'>, now = 0): PluginActivitySnapshot => ({
  now, activity: new Map(Object.entries(activity)), selectedKey: 'claude@personal:same', focused: true,
  sessions: [{ key: 'claude@personal:same', title: 'Personal' }, { key: 'claude@work:same', title: 'Work' }],
})
const notices: string[] = []
const desktop: string[] = []
const services = { notifications: { ...createNotificationCenter().service, notice: (text: string) => notices.push(text), desktop: (title: string, body: string) => desktop.push(`${title}:${body}`) } }
const alerts: PluginApplicationModule = { apiVersion: PLUGIN_API_VERSION, pluginId: 'alerts', activate: context => createAlertObserver(context, () => 'desktop') }
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
let loads = 0
const host = createPluginApplicationHost('web', [manifest('alerts')], { alerts: async () => { loads++; return alerts } }, services)
assert.equal(loads, 0)
await host.publish(event({ 'claude@work:same': 'running' }))
assert.equal(loads, 1)
await host.publish(event({ 'claude@work:same': 'needs-input' }, 100))
assert.deepEqual(notices, ['Work needs you'])
await host.publish(event({ 'claude@work:same': 'needs-input' }, 200))
assert.equal(notices.length, 1, 'steady states never replay')
await host.publish({ ...event({ 'claude@work:same': 'running' }, 1000), focused: false })
await host.publish({ ...event({}, 20_000), focused: false })
assert.equal(desktop.length, 1)
assert.match(desktop[0], /Work finished/)
applyPluginSettings({ version: 1, disabled: ['alerts'] })
assert.equal(host.isLoaded('alerts'), false)
await host.publish(event({ 'claude@work:same': 'needs-input' }))
assert.equal(notices.length, 1)
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await host.publish(event({ 'claude@work:same': 'needs-input' }))
assert.equal(notices.length, 1, 're-enable baselines current state without replay')
host.dispose()

// Bounded/latest snapshots while loading; disabled in-flight generations cannot activate.
let resolveModule!: (module: PluginApplicationModule) => void
let started!: () => void
const ready = new Promise<void>(resolve => { started = resolve })
let activations = 0
const pending = createPluginApplicationHost('tui', [manifest('pending')], {
  pending: () => { started(); return new Promise(resolve => { resolveModule = resolve }) },
}, services)
const initial = pending.publish(event({}))
await ready
const newer = pending.publish(event({ 'claude@work:same': 'needs-input' }))
applyPluginSettings({ version: 1, disabled: ['pending'] })
resolveModule({ apiVersion: PLUGIN_API_VERSION, pluginId: 'pending', activate() { activations++; return { onSessionActivity() {} } } })
await Promise.all([initial, newer])
assert.equal(activations, 0)
assert.equal(pending.isLoaded('pending'), false)
pending.dispose()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

let earlyLoads = 0
const early = createPluginApplicationHost('web', [manifest('early')], {
  early: async () => { earlyLoads++; return { ...alerts, pluginId: 'early' } },
}, services)
const earlyEvent = early.publish(event({}))
applyPluginSettings({ version: 1, disabled: ['early'] })
await earlyEvent
assert.equal(earlyLoads, 0, 'disable before the load microtask must not import code')
early.dispose()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

let resolveCoalesced!: (module: PluginApplicationModule) => void
const observed: PluginActivitySnapshot[] = []
const coalescing = createPluginApplicationHost('web', [manifest('coalesced')], {
  coalesced: () => new Promise(resolve => { resolveCoalesced = resolve }),
}, services)
const first = coalescing.publish(event({}))
await Promise.resolve()
const source = event({ 'claude@work:same': 'running' }, 100)
const second = coalescing.publish(source)
const third = coalescing.publish({ ...source, now: 200 })
;(source.activity as Map<string, string>).clear()
resolveCoalesced({ apiVersion: PLUGIN_API_VERSION, pluginId: 'coalesced', activate: () => ({ onSessionActivity: snapshot => { observed.push(snapshot) } }) })
await Promise.all([first, second, third])
assert.equal(observed.length, 1, 'only the latest snapshot is delivered after activation')
assert.equal(observed[0].now, 200)
assert.equal(observed[0].activity.get('claude@work:same'), 'running', 'publication captures caller-owned maps')
coalescing.dispose()

const failures: string[] = []
let healthy = 0, cleanups = 0
let lateNotice: (() => void) | undefined
const isolated = createPluginApplicationHost('web', [manifest('broken'), manifest('healthy')], {
  broken: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'broken', activate: () => ({ onSessionActivity(snapshot) {
    ;(snapshot.activity as Map<string, string>).set('leak', 'running')
    throw new Error('observer failure')
  } }) }),
  healthy: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'healthy', activate(context) {
    context.defer(() => { cleanups++ })
    lateNotice = () => context.services.notifications!.notice('late')
    return { onSessionActivity(snapshot) { healthy++; assert.equal(snapshot.activity.size, 0) } }
  } }),
}, services, id => failures.push(id))
await isolated.publish(event({}))
assert.deepEqual(failures, ['broken'])
assert.equal(healthy, 1)
applyPluginSettings({ version: 1, disabled: ['healthy'] })
lateNotice!()
assert.equal(cleanups, 1)
assert.equal(notices.includes('late'), false, 'late jobs cannot notify after disposal')
isolated.dispose()
assert.equal(cleanups, 1)
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
let missingLoads = 0
const missing = createPluginApplicationHost('web', [manifest('missing')], {
  missing: async () => { missingLoads++; return alerts },
}, {}, id => failures.push(id))
await missing.publish(event({}))
assert.equal(missingLoads, 0, 'missing capabilities refuse before loading')
assert.equal(failures.at(-1), 'missing')
missing.dispose()

const asyncErrors: unknown[] = []
const invalidAsync = createPluginApplicationHost('web', [manifest('async')], {
  async: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'async', activate: () => ({
    onSessionActivity: async () => { throw new Error('unobserved rejection') },
  }) }),
}, services, (_id, error) => asyncErrors.push(error))
await invalidAsync.publish(event({}))
assert.match(String(asyncErrors[0]), /must be synchronous/)
invalidAsync.dispose()

const activity = pluginRuntimeActivity({ running: [
  { sessionId: 'same', provider: 'claude', providerInstanceId: 'personal', pendingPrompts: [], pendingPermissions: [] },
  { sessionId: 'same', provider: 'claude', providerInstanceId: 'work', pendingPrompts: [], pendingPermissions: [{}] },
], waiting: [], attention: [] })
assert.equal(activity.get('claude@personal:same'), 'running')
assert.equal(activity.get('claude@work:same'), 'needs-input')
assert.throws(() => pluginRuntimeActivity({}), /Invalid runtime/)
console.log('Plugin application observers: PASS (lazy activation, shared alerts, instance isolation, disable races, failure isolation, scoped cleanup and late delivery)')

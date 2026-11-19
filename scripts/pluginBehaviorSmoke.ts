import assert from 'node:assert/strict'
import { createPluginBehaviorHost } from '../lib/plugins/behaviorHost'
import { PluginTurnBlockedError, type PluginBehaviorModule, type PluginBeforeTurnContext } from '../lib/plugins/behavior'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'

const manifest = (id: string, order = 0): PluginManifest => ({
  apiVersion: PLUGIN_API_VERSION, id, title: id, description: id, renderers: ['web', 'tui'],
  stateVersion: 1, surfaces: [], commands: [], behavior: { hooks: ['beforeTurn'], order },
})
const context = (instance = 'account-a'): PluginBeforeTurnContext => ({
  target: { provider: 'codex', providerInstanceId: instance, sessionId: 'same-native-id' },
  signal: new AbortController().signal, body: { message: 'hello', nested: { keep: true } },
})
const entry = (id: string, beforeTurn: PluginBehaviorModule['beforeTurn']): PluginBehaviorModule => ({
  apiVersion: PLUGIN_API_VERSION, pluginId: id, beforeTurn,
})
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

// Deterministic ordered composition, private input copies, no redirected target.
let loads = 0
const host = createPluginBehaviorHost([manifest('later', 10), manifest('b'), manifest('a')], {
  later: async () => { loads++; return entry('later', ({ body }) => ({ action: 'patch', body: { message: `${body.message}!` } })) },
  b: async () => { loads++; return entry('b', ({ body, target }) => {
    assert.equal(Object.isFrozen(target), true)
    assert.equal(body.message, 'hello:a')
    assert.deepEqual(body.nested, { keep: true })
    return { action: 'patch', body: { message: `${body.message}:b` } }
  }) },
  a: async () => { loads++; return entry('a', ({ body }) => {
    ;(body.nested as { keep: boolean }).keep = false
    return { action: 'patch', body: { message: `${body.message}:a` } }
  }) },
})
assert.equal(loads, 0)
const original = context()
assert.equal((await host.beforeTurn(original)).message, 'hello:a:b!')
assert.deepEqual(original.body.nested, { keep: true })
await Promise.all([host.beforeTurn(context('account-a')), host.beforeTurn(context('account-b'))])
assert.equal(loads, 3, 'concurrent sends share lazy entries')
host.dispose()

let next = 0
const blocked = createPluginBehaviorHost([manifest('block'), manifest('next', 1)], {
  block: async () => entry('block', () => ({ action: 'block', reason: 'Pick a project first' })),
  next: async () => { next++; return entry('next', () => {}) },
})
await assert.rejects(blocked.beforeTurn(context()), (error) => error instanceof PluginTurnBlockedError && error.pluginId === 'block')
assert.equal(next, 0, 'a refusal prevents later activation')
blocked.dispose()

// A failed load is retryable; invalid APIs/outputs never enter the provider.
let attempts = 0
const retry = createPluginBehaviorHost([manifest('retry')], {
  retry: async () => { if (++attempts === 1) throw new Error('unavailable'); return entry('retry', () => {}) },
})
await assert.rejects(retry.beforeTurn(context()), /unavailable/)
assert.equal((await retry.beforeTurn(context())).message, 'hello')
retry.dispose()
for (const module of [
  { ...entry('wrong', () => {}), pluginId: 'wrong' },
  { ...entry('invalid', () => {}), apiVersion: 0 },
  entry('invalid', () => ({ action: 'patch', body: [] }) as never),
]) {
  const invalid = createPluginBehaviorHost([manifest('invalid')], { invalid: async () => module as PluginBehaviorModule })
  await assert.rejects(invalid.beforeTurn(context()), /mismatch|invalid/)
  invalid.dispose()
}

// Disable while importing invalidates the generation. No stale completion is used.
let resolveImport!: (module: PluginBehaviorModule) => void
let began!: () => void
const started = new Promise<void>(resolve => { began = resolve })
let calls = 0
const pending = createPluginBehaviorHost([manifest('pending')], {
  pending: () => { began(); return new Promise(resolve => { resolveImport = resolve }) },
})
const stale = pending.beforeTurn(context())
await started
applyPluginSettings({ version: 1, disabled: ['pending'] })
await assert.rejects(stale, (error) => error instanceof Error && error.name === 'AbortError')
resolveImport(entry('pending', () => { calls++ }))
await Promise.resolve()
assert.equal(calls, 0)
assert.equal(pending.isLoaded('pending'), false)
assert.equal((await pending.beforeTurn(context())).message, 'hello', 'disabled plugins are skipped')
pending.dispose()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

// Disable before the lazy-load microtask starts must not load executable code.
let earlyLoads = 0
const early = createPluginBehaviorHost([manifest('early')], {
  early: async () => { earlyLoads++; return entry('early', () => {}) },
})
const earlyTurn = early.beforeTurn(context())
applyPluginSettings({ version: 1, disabled: ['early'] })
await assert.rejects(earlyTurn, (error) => error instanceof Error && error.name === 'AbortError')
assert.equal(earlyLoads, 0)
early.dispose()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)

// Each overlapping turn owns its target and cancellation; ignored signals cannot hang Stop.
const releases = new Map<string, () => void>()
const arrived = new Map<string, () => void>()
const readyA = new Promise<void>(resolve => arrived.set('account-a', resolve))
const readyB = new Promise<void>(resolve => arrived.set('account-b', resolve))
const concurrent = createPluginBehaviorHost([manifest('hold')], {
  hold: async () => entry('hold', ({ target }) => new Promise(resolve => {
    const id = target.providerInstanceId!
    releases.set(id, () => resolve({ action: 'patch', body: { message: id } }))
    arrived.get(id)!()
  })),
})
const abort = new AbortController()
const a = concurrent.beforeTurn({ ...context(), signal: abort.signal })
const b = concurrent.beforeTurn(context('account-b'))
await Promise.all([readyA, readyB])
abort.abort()
await assert.rejects(a, (error) => error instanceof Error && error.name === 'AbortError')
releases.get('account-b')!()
assert.equal((await b).message, 'account-b')
releases.get('account-a')!()
concurrent.dispose()
await assert.rejects(concurrent.beforeTurn(context()), /disposed/)

// afterTurn: ordered observers, failure isolation, first follow-up wins, declared hooks validated, disable.
const afterManifest = (id: string, order = 0, hooks: ('beforeTurn' | 'afterTurn')[] = ['afterTurn']): PluginManifest => ({ ...manifest(id, order), behavior: { hooks, order } })
const seen: string[] = []
const after = createPluginBehaviorHost([afterManifest('observer', 0), afterManifest('broken', 1), afterManifest('asker', 2), afterManifest('late-asker', 3)], {
  observer: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'observer', afterTurn: async ({ target, readMessages, followUps }) => {
    assert.equal(Object.isFrozen(target), true)
    assert.equal(followUps, 2)
    seen.push(`observer:${(await readMessages(5)).length}`)
  } }),
  broken: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'broken', afterTurn: () => { seen.push('broken'); throw new Error('fixture failure') } }),
  asker: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'asker', afterTurn: () => { seen.push('asker'); return { action: 'follow-up', message: 'keep going' } } }),
  'late-asker': async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'late-asker', afterTurn: () => { seen.push('late'); return { action: 'follow-up', message: 'ignored' } } }),
})
const settled = { target: { provider: 'codex' as const, providerInstanceId: 'account-a', sessionId: 'same-native-id' }, readMessages: async () => [], followUps: 2 }
assert.equal(after.observesSettledTurns(), true)
const errors: unknown[] = []
const originalError = console.error
console.error = (...args: unknown[]) => { errors.push(args) }
try {
  assert.deepEqual(await after.afterTurn(settled), { pluginId: 'asker', message: 'keep going' })
} finally { console.error = originalError }
assert.deepEqual(seen, ['observer:0', 'broken', 'asker', 'late'], 'every observer runs, in order, past a failing one')
assert.equal(errors.length, 1, 'a failing afterTurn hook is reported once')
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'asker', false))
seen.length = 0
assert.deepEqual(await after.afterTurn(settled), { pluginId: 'late-asker', message: 'ignored' }, 'a disabled plugin no longer answers')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const onlyBefore = createPluginBehaviorHost([manifest('before-only')], { 'before-only': async () => entry('before-only', () => undefined) })
assert.equal(onlyBefore.observesSettledTurns(), false, 'a host with no afterTurn contributor skips settle work')
const missing = createPluginBehaviorHost([afterManifest('declares-after')], { 'declares-after': async () => entry('declares-after', () => undefined) })
console.error = () => {}
try { assert.equal(await missing.afterTurn(settled), null, 'a module missing a declared hook is refused') } finally { console.error = originalError }
await assert.rejects(missing.beforeTurn(context()).then(() => missing.isLoaded('declares-after') ? Promise.resolve() : Promise.reject(new Error('refused'))), /refused/)
console.log('plugin behavior: PASS (composition, laziness, refusal, retry, disable race, cancellation, instance isolation and afterTurn ordering/isolation/follow-up)')

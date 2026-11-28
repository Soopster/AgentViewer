import assert from 'node:assert/strict'
import { createPluginBehaviorHost } from '../lib/plugins/behaviorHost'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import type { PluginBehaviorModule, PluginPermissionResult } from '../lib/plugins/behavior'
import { readPluginPermissionHistory, clearPluginPermissionHistory } from '../lib/plugins/permissionHistory'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
const saved = readPluginSettings()
const target = { provider: 'claude' as const, providerInstanceId: 'account-a', sessionId: 'same' }
const request = { kind: 'command' as const, toolName: 'Bash', command: 'private-command', paths: ['/private/path'], input: { token: 'private-token' } }
const manifest = (id: string, mode: 'policy' | 'automation', order = 0): PluginManifest => ({ apiVersion: PLUGIN_API_VERSION, id, title: id, description: '', renderers: ['web', 'tui'], surfaces: [], commands: [], stateVersion: 1, behavior: { hooks: ['permission'], permissionMode: mode, order } })
const makeHost = (entries: Array<{ id: string; mode: 'policy' | 'automation'; run: NonNullable<PluginBehaviorModule['permission']>; order?: number }>) => createPluginBehaviorHost(entries.map(entry => manifest(entry.id, entry.mode, entry.order)), Object.fromEntries(entries.map(entry => [entry.id, async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: entry.id, permission: entry.run })])))
const hosts: ReturnType<typeof makeHost>[] = []
const hostFor = (entries: Parameters<typeof makeHost>[0]) => { const host = makeHost(entries); hosts.push(host); return host }
try {
  clearPluginPermissionHistory()
  const calls: string[] = []
  const host = hostFor([
    { id: 'policy-smoke-auto', mode: 'automation', order: -100, run: () => { calls.push('auto'); return { decision: 'allow' } } },
    { id: 'policy-smoke-deny', mode: 'policy', order: 100, run: () => { calls.push('policy'); return { decision: 'deny', reason: 'private-reason' } } },
  ])
  assert.equal((await host.permission({ target, request }))?.decision, 'deny')
  assert.deepEqual(calls, ['policy'])
  const combined = hostFor([
    { id: 'policy-smoke-allow', mode: 'policy', run: () => ({ decision: 'allow' }) },
    { id: 'policy-smoke-deny-2', mode: 'policy', order: 1, run: () => ({ decision: 'deny' }) },
  ])
  const immutable = hostFor([{ id: 'policy-smoke-immutable', mode: 'policy', run: ({request}) => { assert(Object.isFrozen(request.input)); assert(Object.isFrozen(request.paths)); return undefined } }])
  await immutable.permission({target, request})
  assert.equal((await immutable.permission({target, request, fallbackAllow: {pluginId:'research'}}))?.pluginId, 'research')
  assert.equal((await combined.permission({ target, request }))?.decision, 'deny')
  for (const mode of ['policy', 'automation'] as const) {
    const broken = hostFor([
      { id: `policy-smoke-broken-${mode}`, mode, run: () => { throw new Error('private-error') } },
      { id: 'policy-smoke-later-allow', mode: 'automation', order: 10, run: () => ({ decision: 'allow' }) },
    ])
    assert.equal(await broken.permission({ target, request }), null)
    assert.equal(await broken.permission({ target, request, fallbackAllow: {pluginId:'research'} }), null)
    const ask = hostFor([{ id: `policy-smoke-ask-${mode}`, mode, run: () => ({ decision: 'ask' }) }, { id: 'policy-smoke-allow-later', mode: 'automation', order: 10, run: () => ({ decision: 'allow' }) }])
    assert.equal(await ask.permission({ target, request }), null)
    assert.equal(await ask.permission({ target, request, fallbackAllow: {pluginId:'research'} }), null)
  }
  const controller = new AbortController()
  const pending = hostFor([{ id: 'policy-smoke-pending', mode: 'policy', run: () => new Promise<PluginPermissionResult>(() => {}) }, { id: 'policy-smoke-auto-later', mode: 'automation', run: () => ({ decision: 'allow' }) }])
  const result = pending.permission({ target, request, signal: controller.signal }); controller.abort()
  assert.equal(await result, null)
  const automatic = hostFor([{ id: 'policy-smoke-pass', mode: 'policy', run: () => undefined }, { id: 'policy-smoke-auto-allow', mode: 'automation', run: () => ({ decision: 'allow' }) }])
  assert.equal((await automatic.permission({ target, request }))?.pluginId, 'policy-smoke-auto-allow')
  applyPluginSettings(withPluginEnabled(saved, 'policy-smoke-deny', false))
  assert.equal((await host.permission({ target, request }))?.decision, 'allow')
  const history = readPluginPermissionHistory(target)
  assert(history.length > 0)
  const serialized = JSON.stringify(history)
  for (const secret of ['private-command', '/private/path', 'private-token', 'private-reason', 'private-error']) assert(!serialized.includes(secret))
  assert.equal(readPluginPermissionHistory({ ...target, providerInstanceId: 'account-b' }).length, 0)
  const detached = readPluginPermissionHistory(target) as unknown as Array<{ target: { sessionId: string } }>
  detached[0]!.target.sessionId = 'changed'
  assert.equal(readPluginPermissionHistory(target)[0]?.target.sessionId, 'same')
  for (let i = 0; i < 205; i++) await automatic.permission({ target, request })
  assert.equal(readPluginPermissionHistory().length, 200)
  console.log('Plugin permission policy: PASS (policy deny precedence, explicit ask, failure/cancellation fallback, automation, disablement, bounded redacted qualified history)')
} finally { for (const host of hosts) host.dispose(); applyPluginSettings(saved); clearPluginPermissionHistory() }

import assert from 'node:assert/strict'
import { createPluginCommandHost } from '../lib/plugins/commandHost'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../lib/plugins/enablement'
import { commands } from '../plugins/bridges/commands'
import { manifest } from '../plugins/bridges/manifest'

applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const target = { session: { provider: 'claude' as const, providerInstanceId: 'personal', sessionId: 'same' }, cwd: '/fixture' }
for (const renderer of ['web', 'tui'] as const) {
  const toggles: string[] = []
  let loads = 0
  const host = createPluginCommandHost(renderer, [manifest], { bridges: async () => { loads++; return commands } })
  const services = { 'bridge-routing': { channel: { toggle: () => toggles.push('channel') }, ide: { toggle: () => toggles.push('ide') } } }
  assert.equal(loads, 0)
  await assert.rejects(host.run('toggle-channel-bridge-route', { target: { ...target, session: { ...target.session, provider: 'codex' } }, services }), /unavailable for this provider/)
  assert.equal(loads, 0, 'unsupported providers refuse before executable code loads')
  await host.run('toggle-channel-bridge-route', { target, services })
  await host.run('toggle-ide-bridge-route', { target, services })
  assert.deepEqual(toggles, ['channel', 'ide'])
  assert.equal(loads, 1)
  await assert.rejects(host.run('toggle-ide-bridge-route', { target, services: { 'bridge-routing': { channel: services['bridge-routing'].channel } } }), /IDE bridge/)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(host.run('toggle-channel-bridge-route', { target, services, signal: abort.signal }), { name: 'AbortError' })
  assert.deepEqual(toggles, ['channel', 'ide'])
  applyPluginSettings({ version: 1, disabled: ['bridges'] })
  await assert.rejects(host.run('toggle-channel-bridge-route', { target, services }), { name: 'AbortError' })
  assert.deepEqual(toggles, ['channel', 'ide'], 'disabling presentation does not perform a routing mutation')
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  await host.run('toggle-channel-bridge-route', { target, services })
  assert.equal(loads, 2)
  host.dispose()
}
console.log('Bridge plugin commands: PASS (shared Web/TUI handlers, lazy modules, capability/provider refusal, cancellation and disable/re-enable)')

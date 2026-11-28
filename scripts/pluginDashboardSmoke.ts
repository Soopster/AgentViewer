import assert from 'node:assert/strict'
import { listPluginDashboards, isPluginDashboardId } from '../lib/plugins/dashboard'
import type { PluginManifest } from '../lib/plugins/types'
import { manifest } from '../plugins/messaging/manifest'

assert.equal(isPluginDashboardId('messaging'), true)
assert.equal(isPluginDashboardId('__proto__'), false)
assert.equal(listPluginDashboards().find(dashboard => dashboard.id === 'messaging')?.command, 'open-cross-session-messaging')
assert.equal(listPluginDashboards([{ ...manifest, renderers: ['tui'] }]).length, 0)
assert.throws(() => listPluginDashboards([manifest, manifest]), /Invalid plugin dashboard/)
for (const patch of [
  { id: 'sessions' }, { id: '' }, { surface: 'missing' }, { command: 'missing' },
]) {
  assert.throws(() => listPluginDashboards([{ ...manifest, dashboards: [{ ...manifest.dashboards[0], ...patch }] }]), /Invalid plugin dashboard/)
}
const invalid: PluginManifest = { ...manifest, commands: manifest.commands.map(command => command.id === 'open-cross-session-messaging' ? { ...command, scope: 'session' } : command) }
assert.throws(() => listPluginDashboards([invalid]), /Invalid plugin dashboard/)
const ordered: PluginManifest = { ...manifest, id: 'first', dashboards: [{ ...manifest.dashboards[0], id: 'first', command: 'open-first', order: -10 }], commands: [{ ...manifest.commands[1], id: 'open-first', webDashboard: 'first' }] }
assert.deepEqual(listPluginDashboards([manifest, ordered]).map(dashboard => dashboard.id), ['first', 'messaging'])
console.log('Plugin dashboards: PASS (catalog-derived IDs, metadata-only registration, renderer support, ordering and invalid contributions)')

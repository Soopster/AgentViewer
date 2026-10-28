// A provider turned off in the plugin manager disappears from every instance
// list and cannot be resolved; turning it back on restores it, and the last
// provider cannot be turned off.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(os.tmpdir(), 'provider-plugin-')))
const { listProviderInstances, resolveProviderInstance } = await import('../lib/providerInstances')
const { getConfiguredProvider } = await import('../lib/providerState')
const { PROVIDER_PLUGINS, providerPluginId, wouldDisableEveryProvider } = await import('../lib/plugins/providerPlugins')
const { writePluginSettingsFile } = await import('../lib/plugins/settingsFile')

const ids = async () => (await listProviderInstances()).map(instance => instance.provider)
assert.ok((await ids()).includes('codex'), 'on by default')

writePluginSettingsFile({ version: 1, disabled: [providerPluginId('codex')] })
assert.ok(!(await ids()).includes('codex'), 'disabled provider is not listed')
await assert.rejects(resolveProviderInstance(undefined, 'codex'), /disabled/)
assert.ok((await ids()).includes('claude'), 'others stay on')

mkdirSync('.agent-viewer-data', { recursive: true })
writeFileSync('.agent-viewer-data/provider.json', JSON.stringify({ provider: 'codex' }))
assert.notEqual(await getConfiguredProvider(), 'codex', 'a disabled selection falls back')

const registry = await import('../lib/extensions/providers/registry')
await assert.rejects(registry.getSessionAdapter('codex'), /disabled/, 'registry will not activate a disabled provider')
await assert.rejects(registry.getProviderRuntime('codex'), /disabled/)

writePluginSettingsFile({ version: 1, disabled: [] })
assert.ok((await ids()).includes('codex'), 'turning it back on restores it')
assert.equal(await getConfiguredProvider(), 'codex', 'and the saved selection with it')

assert.equal(wouldDisableEveryProvider(new Set(PROVIDER_PLUGINS.map(p => p.id))), true)
assert.equal(wouldDisableEveryProvider(new Set(PROVIDER_PLUGINS.slice(1).map(p => p.id))), false)
console.log(JSON.stringify({ test: 'provider plugins', passed: true }))

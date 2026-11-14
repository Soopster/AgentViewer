import assert from 'node:assert/strict'
import { createLazyRegistry } from '../lib/extensions/lazyRegistry'
import { PROVIDER_IDS, getProviderManifest } from '../lib/extensions/providers/catalog'
import { getProviderCapabilities, isAgentProvider } from '../lib/provider'
import { getProviderComposer } from '../lib/providerComposer'
import '../lib/extensions/providers/registry'

const imported = Object.keys(require.cache)
assert.equal(imported.some(name => name.includes('/node_modules/')), false, 'metadata and host import no SDK/dependency runtime')
assert.equal(imported.some(name => /sessionBackend|builtinRuntime|\/adapters\/(claude|codex|opencode|copilot|pi|lmstudio|acp)\.ts/.test(name)), false)
assert.equal(isAgentProvider('__proto__'), false)
assert.equal(isAgentProvider('constructor'), false)
assert.equal(isAgentProvider('not-installed'), false)
for (const id of PROVIDER_IDS) {
  assert.equal(isAgentProvider(id), true)
  assert.equal(getProviderManifest(id).id, id)
  assert.equal(getProviderManifest(id).apiVersion, 1)
  assert.equal(getProviderCapabilities(id), getProviderManifest(id).capabilities)
  assert.ok(getProviderComposer(id).label)
}

let loads = 0
let retryLoads = 0
let badValidation = true
const value = { apiVersion: 1 }
const registry = createLazyRegistry({
  fixture: async () => { loads++; return value },
  retry: async () => { if (++retryLoads === 1) throw new Error('offline'); return value },
  invalid: async () => value,
}, (id, loaded) => {
  if (id === 'invalid' && badValidation) throw new Error('API mismatch')
  assert.equal(loaded.apiVersion, 1)
})
assert.equal(loads, 0, 'registration does not activate')
assert.equal(registry.peek('fixture'), undefined)
const concurrent = await Promise.all(Array.from({ length: 20 }, () => registry.get('fixture')))
assert.equal(loads, 1)
assert.ok(concurrent.every(loaded => loaded === value))
assert.equal(registry.peek('fixture'), value)
assert.equal(await registry.get('fixture'), value)
assert.equal(loads, 1, 'hot lookups preserve the resolved instance')
await assert.rejects(registry.get('retry'), /offline/)
assert.equal(registry.peek('retry'), undefined)
assert.equal(await registry.get('retry'), value, 'failed loading is retryable')
await assert.rejects(registry.get('invalid'), /API mismatch/)
badValidation = false
assert.equal(await registry.get('invalid'), value, 'failed validation does not poison the cache')
await assert.rejects(registry.get('__proto__'), /Unknown extension/)

const graph = []
const bundle = await Bun.build({
  entrypoints: ['./lib/extensions/providers/catalog.ts'], target: 'browser', minify: true,
  plugins: [{ name: 'provider-metadata-boundary', setup(build) {
    build.onLoad({ filter: /.*/ }, args => { graph.push(args.path); return undefined })
  } }],
})
assert.equal(bundle.success, true, String(bundle.logs))
assert.equal(graph.some(name => /\/node_modules\/|\/adapters\/|\/sessionBackend|\/server\.ts$|\/runtime\.ts$|\/registry\.ts$/.test(name)), false,
  `provider metadata escaped its browser-safe boundary: ${graph.join(', ')}`)
console.log(JSON.stringify({ test: 'provider extension host', passed: true, providers: PROVIDER_IDS.length,
  metadataBundleBytes: bundle.outputs.reduce((sum, output) => sum + output.size, 0), metadataModules: graph.length }))

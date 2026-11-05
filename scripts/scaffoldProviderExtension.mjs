import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Trusted bundled extensions only. Generates static imports for Next and Bun. */
export async function scaffoldProviderExtension(root, id, displayName) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id ?? '') || ['all', 'constructor', 'prototype'].includes(id)) {
    throw new Error('Use a unique lowercase provider id (letters, digits, hyphens; maximum 64 characters).')
  }
  if (typeof displayName !== 'string' || !displayName.trim()) throw new Error('A display name is required.')
  const base = path.join(root, 'lib/extensions/providers')
  const directory = path.join(base, id)
  try { await access(directory); throw new Error(`Provider directory already exists: ${id}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const catalogPath = path.join(base, 'catalog.ts')
  const registryPath = path.join(base, 'registry.ts')
  const [catalog, registry] = await Promise.all([readFile(catalogPath, 'utf8'), readFile(registryPath, 'utf8')])
  const catalogMarker = 'export const PROVIDER_EXTENSIONS = {'
  const registryMarker = 'const loaders = {'
  if (!catalog.includes(catalogMarker) || !registry.includes(registryMarker)) {
    throw new Error('Provider registration format changed; update the scaffold before generating files.')
  }
  const quote = JSON.stringify
  const manifest = `import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: ${quote(id)},
  displayName: ${quote(displayName.trim())},
  assistantLabel: ${quote(displayName.trim().toUpperCase())},
  transport: 'native',
  indexable: true,
  newSession: true,
  supportsInstances: false,
  // Native attachments are opt-in. Other representable inputs use portable text.
  attachments: { types: [] },
  capabilities: {
    messageFork: false, resumeAtMessage: false, fileRewind: false,
    rollback: false, deleteSession: false, shareSession: false,
    unshareSession: false, summarizeSession: false, unrevertSession: false,
    respondToPermission: false, activeSteering: false, inPlaceRewind: false,
  },
} as const satisfies ProviderManifest
`
  const server = `import { manifest } from './manifest'
import type { ProviderExtension } from '../types'

export const extension = {
  manifest,
  loadAdapter: async () => (await import('./adapter')).adapter,
  loadRuntime: async () => (await import('./runtime')).runtime,
} satisfies ProviderExtension
`
  const adapter = `import type { SessionAdapter } from '../../../adapters/types'

// Add supported read methods here. Import your SDK only in this module/runtime.
// Omit unsupported operations; do not return fabricated empty transcripts.
export const adapter: SessionAdapter = { provider: ${quote(id)} }
`
  const runtime = `import type { ProviderRuntime } from '../types'

// Use params.providerInstanceId to scope SDK resources. Respect AbortSignal,
// await checkpoint before the first agent write, and release resources on close.
export const runtime: ProviderRuntime = {
  async createSession(_params) { throw new Error(${quote(id + ': implement createSession')}) },
  async streamTurn(_params, _checkpoint) { throw new Error(${quote(id + ': implement streamTurn')}) },
  async closeSession(_sessionId, _provider, _providerInstanceId) {},
}
`
  await mkdir(directory)
  await Promise.all(Object.entries({ manifest, server, adapter, runtime }).map(([name, content]) => writeFile(path.join(directory, `${name}.ts`), content)))
  const binding = `provider_${id.replaceAll('-', '_')}`
  await writeFile(catalogPath, `import { manifest as ${binding} } from './${id}/manifest'\n` + catalog.replace(catalogMarker, `${catalogMarker}\n  '${id}': ${binding},`))
  await writeFile(registryPath, registry.replace(registryMarker, `${registryMarker}\n  '${id}': async () => (await import('./${id}/server')).extension,`))
  return directory
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [id, ...name] = process.argv.slice(2)
  const directory = await scaffoldProviderExtension(process.cwd(), id, name.join(' '))
  console.log(`Created ${directory}. Implement adapter.ts and runtime.ts; see docs/provider-extensions.md.`)
}

// Discovering local plugins ("mods") — node-only.
//
// They live in the USER's config directory, never the project's:
//   $AGENT_VIEWER_PLUGINS_DIR, else $XDG_CONFIG_HOME/agent-viewer/plugins,
//   else ~/.config/agent-viewer/plugins
// with one directory per plugin holding plugin.json and a server module
// (server.mjs, server.js or server.ts). A plugin read from a cloned repository
// would run its author's code the first time a turn was sent there — the same
// rule keys.json and the Coordinator's command hooks follow.
//
// Discovery is synchronous and cached per explicit reload revision. Web/TUI
// inspection heartbeats observe reload markers without scanning project folders.
// Refused declarations are reported without loading executable code.
import { readModReloadRequest } from './modReload'
import { ensureModWatcher } from './modWatch'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PLUGIN_MANIFESTS } from './catalog'
import { parseLocalPluginManifest, localManifestNeedsServer, type LocalPluginManifest } from './localManifest'

const SERVER_ENTRIES = ['server.mjs', 'server.js', 'server.ts']

export type LocalPlugin = { readonly manifest: LocalPluginManifest; readonly dir: string; readonly entry: string | null }
export type LocalPluginProblem = { readonly dir: string; readonly id: string | null; readonly problems: readonly string[] }
export type LocalPluginDiscovery = { readonly revision?: string; readonly dir: string; readonly plugins: readonly LocalPlugin[]; readonly refused: readonly LocalPluginProblem[] }

export function localPluginsDir(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENT_VIEWER_PLUGINS_DIR) return path.resolve(env.AGENT_VIEWER_PLUGINS_DIR)
  const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(config, 'agent-viewer', 'plugins')
}

function discoverDirectories(dir: string, directories: readonly string[], revision?: string): LocalPluginDiscovery {
  const plugins: LocalPlugin[] = []
  const refused: LocalPluginProblem[] = []
  const reserved = new Set<string>(PLUGIN_MANIFESTS.map(manifest => manifest.id))
  for (const pluginDir of [...new Set(directories)]) {
    try { if (!statSync(pluginDir).isDirectory()) continue } catch { refused.push({ dir: pluginDir, id: null, problems: ['directory is unavailable'] }); continue }
    const manifestFile = path.join(pluginDir, 'plugin.json')
    if (!existsSync(manifestFile)) { refused.push({ dir: pluginDir, id: null, problems: ['no plugin.json'] }); continue }
    let raw: unknown
    try { raw = JSON.parse(readFileSync(manifestFile, 'utf8')) } catch (error) {
      refused.push({ dir: pluginDir, id: null, problems: [`plugin.json does not parse: ${error instanceof Error ? error.message : String(error)}`] })
      continue
    }
    const { manifest, problems } = parseLocalPluginManifest(raw, reserved)
    const entry = SERVER_ENTRIES.map(file => path.join(pluginDir, file)).find(file => existsSync(file)) ?? null
    if (manifest && !entry && localManifestNeedsServer(manifest)) problems.push(`no server module (${SERVER_ENTRIES.join(', ')})`)
    if (!manifest || problems.length) { refused.push({ dir: pluginDir, id: manifest?.id ?? (typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : null), problems }); continue }
    reserved.add(manifest.id)
    plugins.push({ manifest, dir: pluginDir, entry })
  }
  return { dir, plugins, refused, ...(revision ? { revision } : {}) }
}
function installedDirectories(dir: string): string[] {
  try { return readdirSync(dir).sort().filter(name => !name.startsWith('.')).map(name => path.join(dir, name)) } catch { return [] }
}
export function discoverLocalPlugins(dir = localPluginsDir()): LocalPluginDiscovery {
  return discoverDirectories(dir, installedDirectories(dir))
}
const reloadListeners = new Set<(previous: LocalPluginDiscovery, next: LocalPluginDiscovery) => void>()
export function subscribeLocalPluginReload(listener: (previous: LocalPluginDiscovery, next: LocalPluginDiscovery) => void): () => void {
  reloadListeners.add(listener)
  return () => { reloadListeners.delete(listener) }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerLocalPlugins: LocalPluginDiscovery | undefined
}

/** The process's discovery, read once. */
export function localPluginDiscovery(): LocalPluginDiscovery {
  const request = readModReloadRequest()
  const dir = localPluginsDir()
  // Editing a mod reloads it: watch the directories this discovery reads (once per process).
  ensureModWatcher(() => [dir, ...readModReloadRequest().developmentDirs])
  const previous = globalThis.__agentViewerLocalPlugins
  if (previous?.revision === request.revision && previous.dir === dir) return previous
  const next = discoverDirectories(dir, [...installedDirectories(dir), ...request.developmentDirs], request.revision)
  globalThis.__agentViewerLocalPlugins = next
  if (previous) for (const listener of [...reloadListeners]) { try { listener(previous, next) } catch (error) { console.error('Mod reload cleanup failed:', error) } }
  return next
}

/** Test seam and `--reload`-style refresh: forget the cached discovery. */
export function resetLocalPluginDiscovery(): void { globalThis.__agentViewerLocalPlugins = undefined }

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
// Discovery is synchronous and runs once per process (the TUI before its root
// loads, the Web daemon on first use); a plugin added later appears after a
// restart. A refused plugin is reported with its reasons and never loaded.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PLUGIN_MANIFESTS } from './catalog'
import { parseLocalPluginManifest, type LocalPluginManifest } from './localManifest'

const SERVER_ENTRIES = ['server.mjs', 'server.js', 'server.ts']

export type LocalPlugin = { readonly manifest: LocalPluginManifest; readonly dir: string; readonly entry: string | null }
export type LocalPluginProblem = { readonly dir: string; readonly id: string | null; readonly problems: readonly string[] }
export type LocalPluginDiscovery = { readonly dir: string; readonly plugins: readonly LocalPlugin[]; readonly refused: readonly LocalPluginProblem[] }

export function localPluginsDir(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENT_VIEWER_PLUGINS_DIR) return path.resolve(env.AGENT_VIEWER_PLUGINS_DIR)
  const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(config, 'agent-viewer', 'plugins')
}

export function discoverLocalPlugins(dir = localPluginsDir()): LocalPluginDiscovery {
  const plugins: LocalPlugin[] = []
  const refused: LocalPluginProblem[] = []
  let names: string[] = []
  try { names = readdirSync(dir).sort() } catch { return { dir, plugins, refused } }
  const reserved = new Set<string>(PLUGIN_MANIFESTS.map(manifest => manifest.id))
  for (const name of names) {
    const pluginDir = path.join(dir, name)
    try { if (!statSync(pluginDir).isDirectory()) continue } catch { continue }
    const manifestFile = path.join(pluginDir, 'plugin.json')
    if (!existsSync(manifestFile)) { refused.push({ dir: pluginDir, id: null, problems: ['no plugin.json'] }); continue }
    let raw: unknown
    try { raw = JSON.parse(readFileSync(manifestFile, 'utf8')) } catch (error) {
      refused.push({ dir: pluginDir, id: null, problems: [`plugin.json does not parse: ${error instanceof Error ? error.message : String(error)}`] })
      continue
    }
    const { manifest, problems } = parseLocalPluginManifest(raw, reserved)
    const entry = SERVER_ENTRIES.map(file => path.join(pluginDir, file)).find(file => existsSync(file)) ?? null
    if (manifest && !entry) problems.push(`no server module (${SERVER_ENTRIES.join(', ')})`)
    if (!manifest || problems.length) { refused.push({ dir: pluginDir, id: manifest?.id ?? (typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : null), problems }); continue }
    if (plugins.some(plugin => plugin.manifest.id === manifest.id)) { refused.push({ dir: pluginDir, id: manifest.id, problems: [`id "${manifest.id}" is already used by another local plugin`] }); continue }
    reserved.add(manifest.id)
    plugins.push({ manifest, dir: pluginDir, entry })
  }
  return { dir, plugins, refused }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerLocalPlugins: LocalPluginDiscovery | undefined
}

/** The process's discovery, read once. */
export function localPluginDiscovery(): LocalPluginDiscovery {
  globalThis.__agentViewerLocalPlugins ??= discoverLocalPlugins()
  return globalThis.__agentViewerLocalPlugins
}

/** Test seam and `--reload`-style refresh: forget the cached discovery. */
export function resetLocalPluginDiscovery(): void { globalThis.__agentViewerLocalPlugins = undefined }

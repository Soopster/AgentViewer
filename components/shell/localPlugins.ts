'use client'

// The Web's half of local plugins: register the manifests the daemon found,
// and run their commands there (their code is the daemon's, never the page's).
import { registerLocalPluginManifests } from '@/lib/plugins/catalog'
import { decodeLocalCommandEffects, parseLocalPluginManifest, setLocalCommandRunner, type LocalPluginManifest } from '@/lib/plugins/localManifest'
import { PLUGIN_MANIFESTS } from '@/lib/plugins/catalog'

export type WebLocalPluginReport = { dir: string; refused: { id: string | null; dir: string; problems: string[] }[] }
let report: WebLocalPluginReport | null = null
export function webLocalPluginReport(): WebLocalPluginReport | null { return report }

setLocalCommandRunner(async (request, signal) => {
  const response = await fetch('/api/plugins/local', {
    method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.error) throw new Error(body?.error || `Plugin command failed (${response.status})`)
  return decodeLocalCommandEffects(body)
})

/** Apply the daemon's `local` section of GET /api/plugins. Manifests are re-validated, never trusted. */
export function applyWebLocalPlugins(value: unknown): void {
  const local = (value as { local?: { dir?: unknown; plugins?: unknown; refused?: unknown } } | null)?.local
  if (!local) return
  const reserved = new Set<string>(PLUGIN_MANIFESTS.map(manifest => manifest.id))
  const manifests: LocalPluginManifest[] = []
  for (const raw of Array.isArray(local.plugins) ? local.plugins : []) {
    // The daemon sends normalized manifests; re-parse their source shape conservatively.
    const entry = raw as LocalPluginManifest
    if (entry?.source !== 'local' || typeof entry.id !== 'string' || reserved.has(entry.id)) continue
    const reparsed = parseLocalPluginManifest({
      id: entry.id, title: entry.title, description: entry.description, behavior: entry.behavior,
      commands: (entry.commands ?? []).map(command => ({ ...command, id: command.handler })),
    }, reserved)
    if (reparsed.manifest) manifests.push(reparsed.manifest)
  }
  registerLocalPluginManifests(manifests)
  report = {
    dir: typeof local.dir === 'string' ? local.dir : '',
    refused: (Array.isArray(local.refused) ? local.refused : []).flatMap((item: { id?: unknown; dir?: unknown; problems?: unknown }) => typeof item?.dir === 'string'
      ? [{ id: typeof item.id === 'string' ? item.id : null, dir: item.dir, problems: Array.isArray(item.problems) ? item.problems.filter((p): p is string => typeof p === 'string') : [] }] : []),
  }
}

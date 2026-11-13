'use client'

// The Web's half of local plugins: register the manifests the daemon found,
// and run their commands there (their code is the daemon's, never the page's).
import { registerLocalPluginManifests } from '@/lib/plugins/catalog'
import { decodeLocalCommandEffects, decodeLocalWidgetContent, parseLocalPluginManifest, setLocalCommandRunner, setLocalWidgetReader, type LocalPluginManifest, type LocalWidgetContent } from '@/lib/plugins/localManifest'
import { PLUGIN_MANIFESTS, listLocalPluginManifests } from '@/lib/plugins/catalog'
import * as React from 'react'
import { decodeModView, readModComponentViews, setModViewService } from '@/lib/plugins/modViews'
import { isPluginEnabled } from '@/lib/plugins/enablement'

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

setLocalWidgetReader(async (signal) => {
  const response = await fetch('/api/plugins/local', { signal })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !Array.isArray(body?.widgets)) return []
  return (body.widgets as Array<Record<string, unknown>>).flatMap((entry): LocalWidgetContent[] => {
    if (typeof entry.pluginId !== 'string' || typeof entry.id !== 'string') return []
    const decoded = decodeLocalWidgetContent(entry.pluginId, entry.id, entry.pluginId, { ...entry, text: Array.isArray(entry.lines) ? (entry.lines as unknown[]).join('\n') : '' })
    return decoded ? [decoded] : []
  })
})

setModViewService({
  list: () => listLocalPluginManifests().filter(manifest => isPluginEnabled(manifest.id))
    .flatMap(manifest => (manifest.localViews ?? []).map(view => ({ pluginId: manifest.id, viewId: view.id, title: view.title, ...(view.component ? { component: true } : {}) }))),
  render: async (view, signal) => {
    const response = await fetch(`/api/plugins/local/views?plugin=${encodeURIComponent(view.pluginId)}&view=${encodeURIComponent(view.viewId)}`, { signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.error) throw new Error(body?.error || `View failed (${response.status})`)
    return decodeModView(body.view, view.title)
  },
  act: async (view, action, item, signal) => {
    const response = await fetch('/api/plugins/local/views', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plugin: view.pluginId, view: view.viewId, action, ...(item ? { item } : {}) }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.error) throw new Error(body?.error || `Action failed (${response.status})`)
    return decodeLocalCommandEffects(body)
  },
  // web.mjs: a plain ES module the daemon serves; imported from a blob URL
  // (outside the bundler) and handed the page's own React.
  loadComponent: async (view) => {
    const response = await fetch(`/api/plugins/local/component?plugin=${encodeURIComponent(view.pluginId)}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Could not load ${view.pluginId}'s component (${response.status})`)
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }))
    try {
      const exported = await importAtRuntime(url)
      return readModComponentViews(exported, React)[view.viewId] ?? null
    } finally {
      URL.revokeObjectURL(url)
    }
  },
})
const importAtRuntime = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>

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
      id: entry.id, title: entry.title, description: entry.description, behavior: entry.behavior, widgets: entry.localWidgets, views: entry.localViews, provider: entry.localProvider,
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

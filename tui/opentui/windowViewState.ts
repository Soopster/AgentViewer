import { createPluginStateStore } from '../../lib/plugins/scopedState'
import type { WorkspaceRuntime } from './spacesStore'

export function workspacePluginState(runtime: WorkspaceRuntime) {
  return runtime.get('ref:pluginState', () => createPluginStateStore(), false)
}

/** A panel tab and a window each own a view, even when their content kind matches. */
export function surfaceViewNamespace(kind: string, windowId?: string, panelId?: string): string {
  return `surface:${windowId ?? (panelId ? `panel:${panelId}` : 'panel')}:${kind}`
}

/** Relocation preserves live UI state; the old copy remains available for layout undo. */
export function copySurfaceViewState(runtime: WorkspaceRuntime, from: string, to: string, pluginId?: string): void {
  if (from === to) return
  workspacePluginState(runtime).copyOwner(from, to, pluginId)
  const source = `${from}:`, destination = `${to}:`
  const fields = [...runtime.values].filter(([key]) => key.startsWith(source))
  for (const key of [...runtime.values.keys()]) if (key.startsWith(destination)) {
    runtime.values.delete(key); runtime.persistent.delete(key); delete runtime.workspace.values[key]
  }
  for (const [key, value] of fields) {
    const next = destination + key.slice(source.length)
    if (runtime.persistent.has(key)) runtime.persistent.add(next)
    runtime.set(next, value)
  }
}

/** Upgrade the former kind-wide panel state once, onto the active matching tab. */
export function migratePanelViewState(runtime: WorkspaceRuntime, panels: readonly { id: string; kind: string }[], activeId: string | null): void {
  const migrated = runtime.get('ref:panelViewMigrations', () => new Set<string>(), false)
  const ordered = [...panels].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId))
  for (const panel of ordered) {
    if (migrated.has(panel.kind)) continue
    migrated.add(panel.kind)
    const legacy = surfaceViewNamespace(panel.kind)
    const target = surfaceViewNamespace(panel.kind, undefined, panel.id)
    if ([...runtime.restoredKeys].some(key => key.startsWith(`${legacy}:`)) && ![...runtime.restoredKeys].some(key => key.startsWith(`${target}:`))) copySurfaceViewState(runtime, legacy, target)
  }
}

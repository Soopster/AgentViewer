// The TUI's half of local plugins: discover the user's mods and register them
// before the root loads (the ⌃K chord table and the command catalog are built
// from manifests at module load), and run their commands in this process.
import { modAppStore } from '../../../lib/plugins/modApp'
import { setModInspectionPublisher } from '../../../lib/plugins/useModAppHost'
import { writeAppInspection } from '../../../lib/plugins/appInspection.mjs'
import { registerLocalPluginManifests } from '../../../lib/plugins/catalog'
import { setLocalCommandRunner, setLocalWidgetReader } from '../../../lib/plugins/localManifest'
import { isPluginEnabled } from '../../../lib/plugins/enablement'
import { localPluginDiscovery } from '../../../lib/plugins/localPlugins'
import { decodeModView, readModComponentViews, setModViewService } from '../../../lib/plugins/modViews'
import { pathToFileURL } from 'node:url'
import { statSync } from 'node:fs'

export function installTuiLocalPlugins(): void {
  const discovery = localPluginDiscovery()
  setModInspectionPublisher(value => writeAppInspection({ ...value, refused: discovery.refused }))
  registerLocalPluginManifests(discovery.plugins.map(plugin => plugin.manifest))
  setLocalCommandRunner(async (request, signal) => {
    const { runLocalPluginCommand } = await import('../../../lib/plugins/localPluginRuntime')
    return runLocalPluginCommand(request, signal)
  })
  setModViewService({
    list: () => localPluginDiscovery().plugins.filter(plugin => isPluginEnabled(plugin.manifest.id))
      .flatMap(plugin => (plugin.manifest.localViews ?? []).map(view => ({ pluginId: plugin.manifest.id, viewId: view.id, title: view.title, ...(view.component ? { component: true } : {}) }))),
    render: async (view, signal) => {
      const { renderLocalPluginView } = await import('../../../lib/plugins/localPluginRuntime')
      return decodeModView(await renderLocalPluginView(view.pluginId, view.viewId, signal, modAppStore.getSnapshot()), view.title)
    },
    act: async (view, action, item, signal) => {
      const { runLocalPluginViewAction } = await import('../../../lib/plugins/localPluginRuntime')
      return runLocalPluginViewAction(view.pluginId, view.viewId, action, item, signal, modAppStore.getSnapshot())
    },
    // tui.mjs: a plain ES module (no imports), loaded directly under Bun with the app's React.
    loadComponent: async (view) => {
      const { localPluginComponentFile } = await import('../../../lib/plugins/localPluginRuntime')
      const file = localPluginComponentFile(view.pluginId, 'tui')
      if (!file) return null
      const React = await import('react')
      const exported = await import(`${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`)
      return readModComponentViews(exported, (React as { default?: unknown }).default ?? React)[view.viewId] ?? null
    },
  })
  setLocalWidgetReader(async (signal) => {
    const { readLocalPluginWidgets } = await import('../../../lib/plugins/localPluginRuntime')
    return readLocalPluginWidgets(signal, modAppStore.getSnapshot())
  })
}

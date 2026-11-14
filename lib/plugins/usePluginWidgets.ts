// The widgets an enabled plugin set contributes to one slot, loaded lazily.
// A widget whose module fails to load is left out (and logged) rather than
// taking its slot down with it.
import { useEffect, useMemo, useState } from 'react'
import { PLUGIN_MANIFESTS } from './catalog'
import { useDisabledPlugins } from './useDisabledPlugins'
import { listPluginWidgets, type PluginWidgetRegistry, type PluginWidgetSpec } from './widgetHost'
import type { PluginManifest, PluginRenderer, PluginWidgetSlot } from './types'

export type LoadedPluginWidget<Widget> = PluginWidgetSpec & { readonly view: Widget }

export function usePluginWidgets<Widget>(renderer: PluginRenderer, registry: PluginWidgetRegistry<Widget>, slot: PluginWidgetSlot, manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS): LoadedPluginWidget<Widget>[] {
  const disabled = useDisabledPlugins()
  const specs = useMemo(() => listPluginWidgets(renderer, manifests, slot).filter(spec => !disabled.has(spec.pluginId)), [renderer, manifests, slot, disabled])
  const [, setGeneration] = useState(0)
  useEffect(() => {
    let live = true
    for (const pluginId of new Set(specs.map(spec => spec.pluginId))) {
      if (registry.peek(pluginId)) continue
      registry.load(pluginId).then(
        () => { if (live) setGeneration(value => value + 1) },
        (error: unknown) => { if (!(error instanceof Error && error.name === 'AbortError')) console.error(`Plugin ${pluginId} widget failed to load:`, error) },
      )
    }
    return () => { live = false }
  }, [registry, specs])
  return specs.flatMap(spec => {
    const module = registry.peek(spec.pluginId)
    const view = module?.widgets[spec.id]
    return view ? [{ ...spec, view }] : []
  })
}

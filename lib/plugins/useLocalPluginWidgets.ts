// Mod widgets for the corner slot: content polled from where the mods run, at
// the fastest interval any enabled widget asks for. Nothing is polled while no
// enabled mod has a widget.
import { modAppStore } from './modApp'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { listLocalPluginManifests, localPluginsVersion, subscribeLocalPlugins } from './catalog'
import { useDisabledPlugins } from './useDisabledPlugins'
import { LOCAL_WIDGET_REFRESH_MS, localWidgetReader, type LocalWidgetContent } from './localManifest'

export function useLocalPluginWidgets(enabled = true): LocalWidgetContent[] {
  const version = useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  const app = useSyncExternalStore(modAppStore.subscribe, modAppStore.getSnapshot, modAppStore.getSnapshot)
  const disabled = useDisabledPlugins()
  const [content, setContent] = useState<LocalWidgetContent[]>([])
  const widgets = listLocalPluginManifests().filter(manifest => !disabled.has(manifest.id)).flatMap(manifest => manifest.localWidgets ?? [])
  const readsApp = listLocalPluginManifests().some(manifest => !disabled.has(manifest.id) && manifest.localWidgets?.length && manifest.appServices?.length)
  const appRevision = readsApp ? app : null
  const interval = enabled && widgets.length ? Math.min(...widgets.map(widget => widget.refreshMs)) : 0
  useEffect(() => {
    const read = localWidgetReader()
    if (!interval || !read) { setContent([]); return undefined }
    const controller = new AbortController()
    let inFlight = false
    const poll = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        const next = await read(controller.signal)
        if (!controller.signal.aborted) setContent(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
      } catch { /* keep the last content through a transient failure */ } finally { inFlight = false }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, interval)
    return () => { controller.abort(); clearInterval(timer) }
  }, [interval, version, disabled, appRevision])
  return content.filter(entry => !disabled.has(entry.pluginId))
}

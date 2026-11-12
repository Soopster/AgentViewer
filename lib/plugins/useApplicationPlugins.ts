import { useCallback, useEffect, useRef } from 'react'
import { PLUGIN_MANIFESTS } from './catalog'
import { useDisabledPlugins } from './useDisabledPlugins'
import { createPluginApplicationHost, type PluginApplicationLoaders } from './applicationHost'
import type { PluginActivitySnapshot, PluginApplicationServices } from './application'
import type { PluginManifest, PluginRenderer } from './types'

export function useApplicationPlugins(renderer: PluginRenderer, loaders: PluginApplicationLoaders, services: PluginApplicationServices) {
  const host = useRef<ReturnType<typeof createPluginApplicationHost> | null>(null)
  const disabled = useDisabledPlugins()
  useEffect(() => {
    const current = createPluginApplicationHost(renderer, PLUGIN_MANIFESTS, loaders, services)
    host.current = current
    return () => { host.current = null; current.dispose() }
  }, [renderer, loaders, services])
  const publish = useCallback((snapshot: PluginActivitySnapshot) => { void host.current?.publish(snapshot) }, [])
  const observesActivity = (PLUGIN_MANIFESTS as readonly PluginManifest[]).some(m => !disabled.has(m.id) && m.renderers.includes(renderer) && m.application?.events.includes('sessionActivity'))
  return { publish, observesActivity }
}

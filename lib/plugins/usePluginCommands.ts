import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { allPluginManifests, listLocalPluginManifests, localPluginsVersion, subscribeLocalPlugins } from './catalog'
import { createPluginCommandHost, type PluginCommandLoaders } from './commandHost'
import { localCommandModule } from './localManifest'
import type { PluginCommandServices, PluginCommandTarget } from './commands'
import type { PluginRenderer } from './types'

/** One command host per shell owner. Renderers supply bound services at dispatch. */
export function usePluginCommands(renderer: PluginRenderer, loaders: PluginCommandLoaders, owner: string | null) {
  const host = useRef<ReturnType<typeof createPluginCommandHost> | null>(null)
  const generation = useRef<{ owner: string | null; value: number; abort: AbortController } | null>(null)
  generation.current ??= { owner, value: 0, abort: new AbortController() }
  if (generation.current.owner !== owner) generation.current = { owner, value: generation.current.value + 1, abort: new AbortController() }
  const binding = generation.current
  // Local plugins registered after mount (the Web learns them from its daemon) rebuild the host.
  const localVersion = useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  useEffect(() => {
    const local = Object.fromEntries(listLocalPluginManifests().filter(manifest => manifest.commands.length > 0)
      .map(manifest => [manifest.id, async () => localCommandModule(manifest)]))
    const current = createPluginCommandHost(renderer, allPluginManifests(), { ...loaders, ...local })
    host.current = current
    return () => { current.dispose(); if (host.current === current) host.current = null }
  }, [renderer, loaders, localVersion])
  useEffect(() => {
    // StrictMode restarts effects on the same owner; each activation gets a live signal.
    if (binding.abort.signal.aborted) binding.abort = new AbortController()
    const controller = binding.abort
    return () => controller.abort()
  }, [binding])
  return useCallback((id: string, target: PluginCommandTarget, services: PluginCommandServices): Promise<void> => {
    const current = host.current
    if (!current) return Promise.reject(new Error('Plugin command host is not mounted'))
    const captured = generation.current!
    return current.run(id, { target, services, signal: captured.abort.signal, isCurrent: () => generation.current?.value === captured.value })
  }, [])
}

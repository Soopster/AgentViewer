// Shared state for drawing a mod's view: the views on offer, the selected one's
// content, and running an action (its notice, then a re-render). Renderers keep
// only presentation and input.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { localPluginsVersion, subscribeLocalPlugins } from './catalog'
import { useDisabledPlugins } from './useDisabledPlugins'
import { modViewService, type ModViewContent, type ModViewRef } from './modViews'

export function useModView(selectedKey: string | null) {
  useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  const disabled = useDisabledPlugins()
  const service = modViewService()
  const views: readonly ModViewRef[] = service ? service.list().filter(view => !disabled.has(view.pluginId)) : []
  const selected = views.find(view => `${view.pluginId}:${view.viewId}` === selectedKey) ?? views[0] ?? null
  const [content, setContent] = useState<ModViewContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)
  const live = useRef<AbortController | null>(null)
  const key = selected ? `${selected.pluginId}:${selected.viewId}` : null
  useEffect(() => {
    if (!service || !selected) { setContent(null); return undefined }
    const controller = new AbortController()
    live.current = controller
    setError(null)
    service.render(selected, controller.signal)
      .then(next => { if (!controller.signal.aborted) setContent(next) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => controller.abort()
  }, [service, key, generation])
  const refresh = useCallback(() => setGeneration(value => value + 1), [])
  const run = useCallback(async (action: string, item?: string): Promise<{ kind: 'info' | 'error'; text: string } | null> => {
    if (!service || !selected) return null
    setBusy(true)
    try {
      const effects = await service.act(selected, action, item, live.current?.signal ?? new AbortController().signal)
      setGeneration(value => value + 1)
      return effects.notice ?? null
    } catch (cause) {
      return { kind: 'error', text: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      setBusy(false)
    }
  }, [service, key])
  return { views, selected, key, content, error, busy, refresh, run }
}

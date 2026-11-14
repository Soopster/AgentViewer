// Shared state for drawing a mod's view: the views on offer, the selected one's
// content, and running an action (its notice, then a re-render). Renderers keep
// only presentation and input.
import { applyModAppEffects, modAppFor, modAppStore } from './modApp'
import { listLocalPluginManifests } from './catalog'
import { recordModDiagnostic } from './modDiagnostics'
import { isPluginEnabled } from './enablement'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { localPluginsVersion, subscribeLocalPlugins } from './catalog'
import { useDisabledPlugins } from './useDisabledPlugins'
import { modViewService, type ModViewContent, type ModViewRef } from './modViews'

export function useModView(selectedKey: string | null) {
  useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  const appSnapshot = useSyncExternalStore(modAppStore.subscribe, modAppStore.getSnapshot, modAppStore.getSnapshot)
  const disabled = useDisabledPlugins()
  const service = modViewService()
  const views: readonly ModViewRef[] = service ? service.list().filter(view => !disabled.has(view.pluginId)) : []
  const selected = views.find(view => `${view.pluginId}:${view.viewId}` === selectedKey) ?? views[0] ?? null
  const [content, setContent] = useState<ModViewContent | null>(null)
  // A `component` view is the mod's own component; a plain view is data.
  const [component, setComponent] = useState<{ key: string; view: unknown; generation: number } | null>(null)
  // Refresh reloads a component; an action's re-render does not.
  const [reloads, setReloads] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)
  const manifest = listLocalPluginManifests().find(item => item.id === selected?.pluginId)
  const actionLife = useMemo(() => ({ controller: new AbortController(), active: false }), [selected?.pluginId, selected?.viewId, disabled])
  useEffect(() => {
    actionLife.controller = new AbortController(); actionLife.active = true
    return () => { actionLife.active = false; actionLife.controller.abort() }
  }, [actionLife])
  const app = useMemo(() => manifest ? modAppFor(manifest, () => actionLife.active) : undefined, [manifest, actionLife])
  const dataRevision = !selected?.component && manifest?.appServices?.length ? appSnapshot : null
  const key = selected ? `${selected.pluginId}:${selected.viewId}` : null
  useEffect(() => {
    if (!service || !selected) { setContent(null); return undefined }
    const controller = new AbortController()
    setError(null)
    if (selected.component) {
      // A component re-renders itself; reloading it after an action would
      // remount it and lose its state. Only a new view (or Refresh) reloads.
      if (component?.key === `${selected.pluginId}:${selected.viewId}` && component.generation === reloads) return undefined
      service.loadComponent(selected)
        .then(view => {
          if (controller.signal.aborted) return
          if (!view) setError(`${selected.title}: the mod ships no component for this view in this app`)
          else setComponent({ key: `${selected.pluginId}:${selected.viewId}`, view, generation: reloads })
        })
        .catch((cause: unknown) => { if (!controller.signal.aborted) { recordModDiagnostic(selected.pluginId, 'component-load', cause); setError(cause instanceof Error ? cause.message : String(cause)) } })
      return () => controller.abort()
    }
    const timer = setTimeout(() => {
      void service.render(selected, controller.signal)
        .then(next => { if (!controller.signal.aborted) setContent(next) })
        .catch((cause: unknown) => { if (!controller.signal.aborted) { recordModDiagnostic(selected.pluginId, `view:${selected.viewId}`, cause); setError(cause instanceof Error ? cause.message : String(cause)) } })
    }, 50)
    return () => { clearTimeout(timer); controller.abort() }
  }, [service, key, generation, dataRevision])
  const refresh = useCallback(() => { setGeneration(value => value + 1); setReloads(value => value + 1) }, [])
  const run = useCallback(async (action: string, item?: string): Promise<{ kind: 'info' | 'error'; text: string } | null> => {
    if (!service || !selected) return null
    setBusy(true)
    const captured = modAppStore.getSnapshot()
    const signal = actionLife.controller.signal
    try {
      const effects = await service.act(selected, action, item, signal)
      signal.throwIfAborted()
      if (!isPluginEnabled(selected.pluginId) || !actionLife.active) return null
      const current = modAppStore.getSnapshot()
      if (current.instanceId !== captured.instanceId || current.selectedKey !== captured.selectedKey || current.cwd !== captured.cwd) return null
      if (effects.appEffects?.length) await applyModAppEffects(selected.pluginId, effects.appEffects, captured)
      setGeneration(value => value + 1)
      return effects.notice ?? null
    } catch (cause) {
      recordModDiagnostic(selected.pluginId, `action:${action}`, cause)
      return { kind: 'error', text: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      setBusy(false)
    }
  }, [service, key, actionLife])
  return { app, views, selected, key, content, error, busy, refresh, run, component: component && component.key === key ? component.view : null }
}

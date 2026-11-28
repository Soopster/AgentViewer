// One poller serves every local-widget slot. Slot consumers cannot multiply
// reads or let a slow response restore content from a removed/disabled mod.
import { useSyncExternalStore } from 'react'
import { modAppStore } from './modApp'
import { listLocalPluginManifests, subscribeLocalPlugins } from './catalog'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { localWidgetReader, subscribeLocalWidgetReader, type LocalWidgetContent, type LocalWidgetSlot } from './localManifest'

const EMPTY: LocalWidgetContent[] = []
const listeners = new Set<() => void>()
let content: LocalWidgetContent[] = EMPTY
let stop: (() => void) | null = null
let stopPoll: (() => void) | null = null
let readsApp = false
const publish = (next: LocalWidgetContent[], force = false) => {
  if (!force && JSON.stringify(content) === JSON.stringify(next)) return
  content = force ? [...next] : next
  for (const listener of listeners) listener()
}

/** Trusted manifest metadata chooses a widget's slot, never the widget response. */
export function selectLocalPluginWidgets(entries: readonly LocalWidgetContent[], slot?: LocalWidgetSlot): LocalWidgetContent[] {
  const specs = listLocalPluginManifests().filter(manifest => isPluginEnabled(manifest.id))
    .flatMap(manifest => (manifest.localWidgets ?? []).map(widget => ({ ...widget, pluginId: manifest.id })))
    .filter(widget => !slot || widget.slot === slot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id))
  return specs.flatMap(spec => {
    const entry = entries.find(entry => entry.pluginId === spec.pluginId && entry.id === spec.id)
    return entry ? [entry] : []
  })
}

function restart() {
  stopPoll?.(); stopPoll = null
  const manifests = listLocalPluginManifests().filter(manifest => isPluginEnabled(manifest.id))
  const widgets = manifests.flatMap(manifest => manifest.localWidgets ?? [])
  readsApp = manifests.some(manifest => manifest.localWidgets?.length && manifest.appServices?.length)
  publish(selectLocalPluginWidgets(content), true)
  const reader = localWidgetReader()
  if (!widgets.length || !reader) { publish(EMPTY); return }
  const interval = Math.min(...widgets.map(widget => widget.refreshMs))
  const controller = new AbortController()
  let inFlight = false
  const poll = async () => {
    if (inFlight || controller.signal.aborted) return
    inFlight = true
    try {
      const next = await reader(controller.signal)
      if (!controller.signal.aborted) publish(selectLocalPluginWidgets(next))
    } catch { /* preserve the previous content through a transient failure */ }
    finally { inFlight = false }
  }
  const timer = setInterval(() => { void poll() }, interval)
  stopPoll = () => { controller.abort(); clearInterval(timer) }
  void poll()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    const cleanups = [subscribeLocalWidgetReader(restart), subscribeLocalPlugins(restart), subscribePluginEnablement(restart), modAppStore.subscribe(() => { if (readsApp) restart() })]
    stop = () => { for (const cleanup of cleanups) cleanup(); stopPoll?.(); stopPoll = null }
    restart()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { stop?.(); stop = null; content = EMPTY }
  }
}
const noSubscribe = () => () => {}
const snapshot = () => content
const emptySnapshot = () => EMPTY

export function useLocalPluginWidgets(enabled = true, slot?: LocalWidgetSlot): LocalWidgetContent[] {
  const entries = useSyncExternalStore(enabled ? subscribe : noSubscribe, snapshot, emptySnapshot)
  return enabled ? selectLocalPluginWidgets(entries, slot) : EMPTY
}

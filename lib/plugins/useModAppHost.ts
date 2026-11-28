import { useEffect, useRef } from 'react'
import { modAppCommands, modAppStore, type ModAppSnapshot } from './modApp'
import { listLocalPluginManifests, subscribeLocalPlugins } from './catalog'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { readLocalModDiagnostics, readModDiagnostics, subscribeModDiagnostics } from './modDiagnostics'

type Publication = { revision: number; app: ModAppSnapshot; mods: { id: string; title: string; enabled: boolean }[]; diagnostics: ReturnType<typeof readModDiagnostics> }
let publisher: ((value: Publication) => void | Promise<void>) | null = null
export function setModInspectionPublisher(next: NonNullable<typeof publisher>): void { publisher = next }
export function useModAppHost(value: Omit<ModAppSnapshot, 'version' | 'instanceId' | 'commands'>, actions: Parameters<typeof modAppStore.bind>[0] & { readFocus?: () => boolean | null }): void {
  const instance = useRef<string>('')
  const revision = useRef(0)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    instance.current ||= `${value.renderer}-${globalThis.crypto.randomUUID()}`
    const unbind = modAppStore.bind(actions)
    let stopped = false
    let pending = false
    let dirty = false
    const publish = async () => {
      if (stopped) return
      if (pending) { dirty = true; return }
      pending = true
      const current = latest.current
      modAppStore.publish({ ...current, focused: actions.readFocus ? actions.readFocus() : current.focused, version: 1, instanceId: instance.current, commands: modAppCommands(current.renderer, current.cwd, current.selectedKey) })
      try {
        await publisher?.({ revision: ++revision.current, app: modAppStore.getSnapshot(), mods: listLocalPluginManifests().map(mod => ({ id: mod.id, title: mod.title, enabled: isPluginEnabled(mod.id) })), diagnostics: readLocalModDiagnostics() })
      } catch { /* inspection failures never interrupt the app */ }
      finally { pending = false; if (dirty) { dirty = false; queueMicrotask(() => { void publish() }) } }
    }
    void publish()
    const timer = setInterval(() => { void publish() }, 5000)
    const offMods = subscribeLocalPlugins(() => { void publish() })
    const offEnabled = subscribePluginEnablement(() => { void publish() })
    const offSnapshots = modAppStore.subscribe(() => { void publish() })
    const offErrors = subscribeModDiagnostics(() => { void publish() })
    return () => { stopped = true; clearInterval(timer); offMods(); offEnabled(); offErrors(); offSnapshots(); unbind() }
  }, [value.renderer, actions])
  useEffect(() => {
    if (instance.current) modAppStore.publish({ ...value, focused: actions.readFocus ? actions.readFocus() : value.focused, version: 1, instanceId: instance.current, commands: modAppCommands(value.renderer, value.cwd, value.selectedKey) })
  }, [value, actions])
}

import React, { useMemo, useState } from 'react'
import FileViewer from '../plugins/files/web/FileViewer'
import { createRoot } from 'react-dom/client'
import { modViewSurfaces } from '../plugins/mod-views/web'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { registerLocalPluginManifests } from '../lib/plugins/catalog'
import { setModViewService } from '../lib/plugins/modViews'
import { modAppStore, type ModApp } from '../lib/plugins/modApp'
import { useModAppHost } from '../lib/plugins/useModAppHost'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const manifest = parseLocalPluginManifest({ id: 'browser-mod', appServices: ['data', 'navigation'], views: [{ id: 'board', title: 'Board' }, { id: 'meter', title: 'Meter', component: true }] }, new Set()).manifest!
registerLocalPluginManifests([manifest])
let release: (() => void) | undefined
function Meter({ app }: { app: ModApp }) {
  const snapshot = React.useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot)
  const [count, setCount] = useState(0)
  ;(window as unknown as { savedApp: ModApp }).savedApp = app
  return <div><span>Meter {count} {snapshot.sessions[0]?.activity}</span><button onClick={() => setCount(value => value + 1)}>Increment</button><button onClick={() => { void app.commands.run('git') }}>Git</button><button onClick={() => { void app.openSession(snapshot.sessions[1].target) }}>Session</button></div>
}
setModViewService({
  list: () => manifest.localViews!.map(view => ({ pluginId: manifest.id, viewId: view.id, title: view.title, component: view.component })),
  render: async () => ({ title: 'Live board', blocks: [{ type: 'text', text: modAppStore.getSnapshot().sessions[0]?.activity ?? 'unknown' }, { type: 'button', label: 'Late action', action: 'late' }] }),
  act: async () => { await new Promise<void>(resolve => { release = resolve }); return { appEffects: [{ type: 'command', id: 'git' }] } },
  loadComponent: async () => Meter,
})
const views = modViewSurfaces(manifest).views
const Board = views['browser-mod.board']!
const MeterView = views['browser-mod.meter']!
function Fixture() {
  const [filePath, setFilePath] = useState<string | undefined>()
  const [activity, setActivity] = useState<'running' | 'needs-input'>('running')
  const [selected, setSelected] = useState('claude@one:same')
  const [visible, setVisible] = useState(true)
  const [events, setEvents] = useState<string[]>([])
  const actions = useMemo(() => ({ runCommand: (id: string) => { setEvents(current => [...current, id]); return true }, openSession: (target: { providerInstanceId?: string }) => { setEvents(current => [...current, target.providerInstanceId ?? 'missing']) } }), [])
  const value = useMemo(() => ({ renderer: 'web' as const, cwd: '/fixture', theme: 'dark', focused: true, focusedSurface: 'browser-mod.board', surfaces: [{ id: 'browser-mod.board', placement: 'window' }], selectedKey: selected,
    sessions: ['one', 'two'].map(providerInstanceId => ({ key: `claude@${providerInstanceId}:same`, title: providerInstanceId, cwd: '/fixture', activity, target: { provider: 'claude' as const, providerInstanceId, sessionId: 'same' } })),
  }), [activity, selected])
  useModAppHost(value, actions)
  const props = { pluginId: manifest.id, surfaceId: 'browser-mod.board', instanceId: 'fixture', placement: 'window', target: { sessionKey: null, cwd: '/fixture' }, services: {}, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, close: () => setVisible(false) } as WebPluginViewProps
  return <><button onClick={() => setActivity('needs-input')}>Change activity</button><button onClick={() => setSelected('claude@two:same')}>Retarget</button><button onClick={() => release?.()}>Release</button><button onClick={() => setVisible(false)}>Close views</button><output>{events.join(',')}</output><button onClick={() => setFilePath('/fixture/a.md')}>Show first file</button><button onClick={() => setFilePath('/fixture/z.md')}>Show second file</button>{filePath ? <div style={{ height: 500 }}><FileViewer open cwd="/fixture" initialPath={filePath} variant="docked" canInsert={false} onOpenChange={() => {}} /></div> : null}{visible ? <><Board {...props} /><MeterView {...props} surfaceId="browser-mod.meter" /></> : null}</>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)

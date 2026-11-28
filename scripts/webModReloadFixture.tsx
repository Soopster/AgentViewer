import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { applyWebLocalPlugins } from '../components/shell/localPlugins'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { localPluginsVersion, subscribeLocalPlugins, getPluginCommand, getPluginSurface } from '../lib/plugins/catalog'
import { modViewSurfaces } from '../plugins/mod-views/web'
import { useModAppHost } from '../lib/plugins/useModAppHost'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const initial = parseLocalPluginManifest({ id: 'reload-ui', version: '1.0.0', appServices: ['navigation'], views: [{ id: 'board', title: 'Board' }, { id: 'meter', title: 'Meter', component: true }], commands: [{ id: 'old', label: 'Old action' }] }, new Set()).manifest!
applyWebLocalPlugins({ local: { revision: 'r1', plugins: [initial] } })
const views = modViewSurfaces(initial).views, Board = views['reload-ui.board']!, Meter = views['reload-ui.meter']!
function Fixture() {
  useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  const [revision, setRevision] = useState(1), [events, setEvents] = useState<string[]>([])
  const actions = useMemo(() => ({ runCommand: (id: string) => { setEvents(previous => [...previous, id]); return true }, openSession() {} }), [])
  const app = useMemo(() => ({ renderer: 'web' as const, cwd: '/fixture', theme: revision === 1 ? 'dark' : 'light', focused: true, focusedSurface: 'reload-ui.board', surfaces: [{ id: 'reload-ui.board', placement: 'panel' }], selectedKey: 'claude@work:fixture', sessions: [{ key: 'claude@work:fixture', title: 'Fixture', cwd: '/fixture', activity: 'idle' as const, target: { provider: 'claude' as const, providerInstanceId: 'work', sessionId: 'fixture' } }] }), [revision])
  useModAppHost(app, actions)
  const advanceRevision = async () => {
    const response = await fetch('/advance', { method: 'POST' })
    if (response.ok) setRevision(2)
  }
  const command = getPluginCommand('reload-ui:new')
  const placement = getPluginSurface('reload-ui.board' as Parameters<typeof getPluginSurface>[0])?.placements.join(',')
  const props = { pluginId: initial.id, surfaceId: 'reload-ui.board', instanceId: 'fixture', placement: 'panel', target: { sessionKey: null, cwd: '/fixture' }, services: {}, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, close() {} } as WebPluginViewProps
  return <><button onClick={() => { void advanceRevision() }}>Advance revision</button><button onClick={() => { void fetch('/release', { method: 'POST' }) }}>Release old action</button><output aria-label="Navigation effects">{events.join(',')}</output><output aria-label="Catalog state">{command ? `${command.label}:${getPluginCommand('reload-ui:view-board')?.placement}:${placement}:${getPluginCommand('reload-ui:old') ? 'old-present' : 'old-removed'}` : 'Old catalog'}</output><Board {...props} /><Meter {...props} surfaceId="reload-ui.meter" /></>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)

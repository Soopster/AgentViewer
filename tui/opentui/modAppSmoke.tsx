/** @jsxImportSource @opentui/react */
import React, { useMemo, useState } from 'react'
import assert from 'node:assert/strict'
import { modViewSurfaces } from '../../plugins/mod-views/tui'
import { parseLocalPluginManifest } from '../../lib/plugins/localManifest'
import { registerLocalPluginManifests } from '../../lib/plugins/catalog'
import { setModViewService } from '../../lib/plugins/modViews'
import { modAppStore, type ModApp } from '../../lib/plugins/modApp'
import { useModAppHost } from '../../lib/plugins/useModAppHost'
import { getThemePalette } from '../theme'
import type { TuiPluginViewProps } from './shell/pluginTypes'
import { testRender, act } from './testRender'
const manifest = parseLocalPluginManifest({ id: 'native-mod', appServices: ['data', 'navigation'], views: [{ id: 'board', title: 'Board' }, { id: 'meter', title: 'Meter', component: true }] }, new Set()).manifest!
registerLocalPluginManifests([manifest])
const calls: string[] = []
let savedApp: ModApp | undefined
const keys = new Map<string, (key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => void>()
function Meter({ app, registerKeys }: { app: ModApp; registerKeys: (handler: (key: { sequence: string }) => boolean) => void }) {
  const snapshot = React.useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot)
  const [count, setCount] = useState(0)
  savedApp = app
  React.useEffect(() => {
    registerKeys(key => { if (key.sequence === '+') { setCount(value => value + 1); return true }; if (key.sequence === 'g') { void app.commands.run('git'); return true }; return false })
  }, [app, registerKeys])
  return <text>{`Meter ${count} ${snapshot.sessions[0]?.activity}`}</text>
}
setModViewService({
  list: () => manifest.localViews!.map(view => ({ pluginId: manifest.id, viewId: view.id, title: view.title, component: view.component })),
  render: async () => ({ title: 'Live board', blocks: [{ type: 'text', text: modAppStore.getSnapshot().sessions[0]?.activity ?? 'unknown' }] }),
  act: async () => ({}), loadComponent: async () => Meter,
})
const views = modViewSurfaces(manifest).views
const Board = views['native-mod.board']!
const MeterView = views['native-mod.meter']!
let update: (() => void) | undefined
let close: (() => void) | undefined
function Fixture() {
  const [activity, setActivity] = useState<'running' | 'needs-input'>('running')
  const [visible, setVisible] = useState(true)
  update = () => setActivity('needs-input'); close = () => setVisible(false)
  const actions = useMemo(() => ({ runCommand: (id: string) => { calls.push(id); return true }, openSession: (target: { providerInstanceId?: string }) => { calls.push(target.providerInstanceId ?? '') } }), [])
  const value = useMemo(() => ({ renderer: 'tui' as const, cwd: '/fixture', theme: 'dark', focused: null, focusedSurface: null, surfaces: [], selectedKey: 'claude@one:same', sessions: ['one', 'two'].map(providerInstanceId => ({ key: `claude@${providerInstanceId}:same`, title: providerInstanceId, cwd: '/fixture', activity, target: { provider: 'claude' as const, providerInstanceId, sessionId: 'same' } })) }), [activity])
  useModAppHost(value, actions)
  const props = { pluginId: manifest.id, surfaceId: 'native-mod.board', instanceId: 'fixture', placement: 'window', target: { sessionKey: null, cwd: '/fixture' }, services: {}, theme: getThemePalette('dark'), accent: '#00ffff', width: 70, height: 16, focused: true, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, close: () => setVisible(false), registerKeys: (handler: unknown) => { if (handler) keys.set('board', handler as never) } } as unknown as TuiPluginViewProps
  return <box flexDirection="column">{visible ? <><Board {...props} /><MeterView {...props} surfaceId="native-mod.meter" registerKeys={handler => { if (handler) keys.set('meter', handler as never) }} /></> : <text>Closed</text>}</box>
}
const setup = await testRender(<Fixture />, { width: 100, height: 40 })
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await setup.flush() }) }
try {
  await settle()
  assert.match(setup.captureCharFrame(), /Live board/)
  assert.match(setup.captureCharFrame(), /Meter 0 running/)
  await act(async () => { keys.get('meter')?.({ name: '+', sequence: '+', ctrl: false, shift: false }); update?.() })
  await settle()
  const frame = setup.captureCharFrame()
  assert.match(frame, /Meter 1 needs-input/)
  assert.match(frame, /Live board[\s\S]*needs-input/)
  await act(async () => { keys.get('meter')?.({ name: 'g', sequence: 'g', ctrl: false, shift: false }) })
  await savedApp!.openSession({ provider: 'claude', sessionId: 'same', providerInstanceId: 'two' })
  assert.deepEqual(calls, ['git', 'two'])
  await act(async () => { close?.() })
  await assert.rejects(savedApp!.commands.run('git'), /closed/)
  console.log('OpenTUI mod app: PASS (rendered live data and component updates, state retention, keyboard command, qualified navigation and closed-view rejection)')
} finally { setup.renderer.destroy() }
process.exit(0)

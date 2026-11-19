/** @jsxImportSource @opentui/react */
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { PluginWidgetHost } from './shell/PluginWidgetHost'
import { getThemePalette } from '../theme'
import { PLUGIN_MANIFESTS, registerLocalPluginManifests } from '../../lib/plugins/catalog'
import { parseLocalPluginManifest, setLocalWidgetReader, type LocalWidgetContent } from '../../lib/plugins/localManifest'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../../lib/plugins/enablement'
import { setModViewService } from '../../lib/plugins/modViews'
import { modViewSurfaces } from '../../plugins/mod-views/tui'
import type { TuiPluginViewProps } from './shell/pluginTypes'
const baseSettings = { version: 1 as const, disabled: PLUGIN_MANIFESTS.map(manifest => manifest.id) }
applyPluginSettings(baseSettings)
const manifest = parseLocalPluginManifest({ id: 'slot-mod', views: [{ id: 'board', title: 'Panel board', placements: ['panel'], defaultPlacement: 'panel' }], widgets: [{ id: 'corner', slot: 'corner' }, { id: 'center', slot: 'top-center' }, { id: 'notice', slot: 'viewport' }] }, new Set()).manifest!
registerLocalPluginManifests([manifest])
let reads = 0
const entries: LocalWidgetContent[] = ['corner', 'center', 'notice'].map(id => ({ pluginId: 'slot-mod', id, title: id.toUpperCase(), lines: [`${id} content`], tone: 'info' }))
setLocalWidgetReader(async () => { reads++; return entries })
setModViewService({ list: () => [{ pluginId: 'slot-mod', viewId: 'board', title: 'Panel board' }], render: async () => ({ title: 'Panel content', blocks: [{ type: 'text', text: 'A local panel' }] }), act: async () => ({}), loadComponent: async () => null })
const Panel = modViewSurfaces(manifest).views['slot-mod.board']!
function Fixture() {
  const props = { pluginId: 'slot-mod', surfaceId: 'slot-mod.board', instanceId: 'panel', placement: 'panel', target: { sessionKey: null, cwd: null }, services: {}, theme: getThemePalette('dark'), accent: '#00ffff', width: 60, height: 12, focused: true, syntaxStyle: null, zIndex: 1, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, registerKeys() {}, setCapture() {}, runCommand: () => false, close() {} } as TuiPluginViewProps
  return <box><Panel {...props} />{(['corner', 'top-center', 'viewport'] as const).map(slot => <PluginWidgetHost key={slot} slot={slot} theme={props.theme} width={120} height={30} zIndex={48} />)}</box>
}
const setup = await testRender(<Fixture />, { width: 120, height: 30 })
const settle = async (ms = 120) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); await setup.flush() }) }
try {
  await settle()
  assert.equal(reads, 1, 'three slots must share one server read')
  for (const id of ['corner', 'center', 'notice']) assert(setup.renderer.root.findDescendantById(`plugin-widget:slot-mod:${id}`), `${id} widget missing`)
  assert.match(setup.captureCharFrame(), /A local panel/)
  await act(async () => { applyPluginSettings({ ...baseSettings, disabled: [...baseSettings.disabled, 'slot-mod'] }) })
  await settle()
  for (const id of ['corner', 'center', 'notice']) assert(!setup.renderer.root.findDescendantById(`plugin-widget:slot-mod:${id}`))
  await act(async () => { applyPluginSettings(baseSettings) })
  await settle()
  assert.equal(reads, 2)
  let release: ((value: LocalWidgetContent[]) => void) | undefined
  setLocalWidgetReader(async () => new Promise(resolve => { release = resolve }))
  await act(async () => { registerLocalPluginManifests([manifest]) })
  await settle(20)
  assert(release)
  await act(async () => { registerLocalPluginManifests([]); release!(entries) })
  await settle()
  for (const id of ['corner', 'center', 'notice']) assert(!setup.renderer.root.findDescendantById(`plugin-widget:slot-mod:${id}`), 'late content restored a removed mod')
  console.log('OpenTUI mod contributions: PASS (panel adapter, all three widget slots, single poller, disable/re-enable, late read cannot restore removed widgets)')
} finally { act(() => setup.renderer.destroy()); registerLocalPluginManifests([]); applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) }
process.exit(0)

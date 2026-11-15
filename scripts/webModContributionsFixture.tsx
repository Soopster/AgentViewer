import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PluginWidgetHost } from '../components/shell/PluginWidgetHost'
import { modViewSurfaces } from '../plugins/mod-views/web'
import { parseLocalPluginManifest, setLocalWidgetReader } from '../lib/plugins/localManifest'
import { PLUGIN_MANIFESTS, registerLocalPluginManifests } from '../lib/plugins/catalog'
import { applyPluginSettings } from '../lib/plugins/enablement'
import { setModViewService } from '../lib/plugins/modViews'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const settings = { version: 1 as const, disabled: PLUGIN_MANIFESTS.map(manifest => manifest.id) }
applyPluginSettings(settings)
const manifest = parseLocalPluginManifest({ id: 'web-contributor', views: [{ id: 'board', title: 'Panel board', placements: ['panel'], defaultPlacement: 'panel' }], widgets: [{ id: 'corner', slot: 'corner' }, { id: 'center', slot: 'top-center' }, { id: 'notice', slot: 'viewport' }] }, new Set()).manifest!
registerLocalPluginManifests([manifest])
let reads = 0
setLocalWidgetReader(async () => { reads++; return ['corner', 'center', 'notice'].map(id => ({ pluginId: manifest.id, id, title: id, lines: [`${id} content`], tone: 'info' })) })
setModViewService({ list: () => [{ pluginId: manifest.id, viewId: 'board', title: 'Panel board' }], render: async () => ({ title: 'Panel content', blocks: [{ type: 'text', text: 'Local panel body' }] }), act: async () => ({}), loadComponent: async () => null })
const Panel = modViewSurfaces(manifest).views['web-contributor.board']!
;(window as unknown as { widgetReads: () => number }).widgetReads = () => reads
function Fixture() {
  const [disabled, setDisabled] = useState(false)
  const props = { pluginId: manifest.id, surfaceId: 'web-contributor.board', instanceId: 'panel', placement: 'panel', target: { sessionKey: null, cwd: null }, services: {}, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, close() {} } as WebPluginViewProps
  return <><button onClick={() => { setDisabled(value => !value); applyPluginSettings({ ...settings, disabled: disabled ? settings.disabled : [...settings.disabled, manifest.id] }) }}>Toggle mod</button><Panel {...props} />{(['corner', 'top-center', 'viewport'] as const).map(slot => <PluginWidgetHost key={slot} slot={slot} />)}</>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

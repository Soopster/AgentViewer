import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { modViewSurfaces } from '../plugins/mod-views/web'
import { applyWebLocalPlugins } from '../components/shell/localPlugins'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const manifest = parseLocalPluginManifest({ id: 'portable', title: 'Portable', config: { greeting: { type: 'string', title: 'Greeting', default: 'Hello' }, enabled: { type: 'boolean', title: 'Enabled', default: false }, retries: { type: 'number', title: 'Retries', default: 2, min: 0, max: 5 } }, views: [{ id: 'board', title: 'Board' }] }, new Set()).manifest!
applyWebLocalPlugins({ local: { plugins: [manifest] } })
const { views } = modViewSurfaces(manifest)
const Board = views['portable.board']!, Config = views['portable.mod-config']!
function Fixture() {
  const [settings, setSettings] = useState(false)
  const props = { pluginId: 'portable', surfaceId: settings ? 'portable.mod-config' : 'portable.board', instanceId: 'fixture', placement: 'window', target: { sessionKey: null, cwd: null }, services: {}, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, close() {} } as WebPluginViewProps
  return <><button onClick={() => setSettings(value => !value)}>Switch view</button>{settings ? <Config {...props} /> : <Board {...props} />}</>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)

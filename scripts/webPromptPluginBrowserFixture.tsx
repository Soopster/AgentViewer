import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PluginSurfaceHost from '../components/shell/PluginSurfaceHost'
import { dispatchPluginCommand, subscribePluginCommands } from '../lib/plugins/commandBus'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'
import { getPluginCommand } from '../lib/plugins/catalog'
import { createPluginStateStore } from '../lib/plugins/scopedState'

const store = createPluginStateStore()
const command = getPluginCommand('open-prompt-library')!
function Fixture() {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'overlay' | 'window'>('overlay')
  const [text, setText] = useState('')
  const disabled = useDisabledPlugins().has(command.pluginId)
  useEffect(() => subscribePluginCommands(id => {
    if (id !== command.id || disabled) return false
    setOpen(true)
    return true
  }), [disabled])
  return <>
    {!disabled && <button onClick={() => dispatchPluginCommand(command.id)} aria-label={command.webComposerLabel}>{command.webComposerGlyph}</button>}
    <button onClick={() => setPlacement(value => value === 'overlay' ? 'window' : 'overlay')} style={{ position: 'fixed', right: 0, top: 0, zIndex: 100 }}>Move placement</button>
    <button onClick={() => applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, command.pluginId, disabled))} style={{ position: 'fixed', right: 0, top: 30, zIndex: 100 }}>{disabled ? 'Enable plugin' : 'Disable plugin'}</button>
    <output data-testid="inserted">{text}</output>
    {open && <PluginSurfaceHost ownerId="prompt-fixture" surfaceId="prompt-library" placement={placement}
      sessionKey="claude:fixture" store={store} services={{ composer: { insertText: setText }, session: { session: { sessionId: 'fixture', provider: 'claude' } } }}
      onClose={() => setOpen(false)} />}
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

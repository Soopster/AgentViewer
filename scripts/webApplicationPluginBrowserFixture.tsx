import React from 'react'
import { createRoot } from 'react-dom/client'
import { ApplicationPluginHost } from '../components/shell/ApplicationPluginHost'
import { dispatchPluginCommand } from '../lib/plugins/commandBus'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'

const sessions = ['personal', 'work'].map(instance => ({ sessionId: 'same', provider: 'claude' as const, providerInstanceId: instance, customTitle: instance === 'work' ? 'Work' : 'Personal' }))
function Fixture() {
  const disabled = useDisabledPlugins().has('session-alerts')
  return <>
    <ApplicationPluginHost sessions={sessions} selectedSession={sessions[0]} />
    <button onClick={() => dispatchPluginCommand('session-alerts')}>Open alerts</button>
    <button onClick={() => applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'session-alerts', disabled))}>{disabled ? 'Enable observer' : 'Disable observer'}</button>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

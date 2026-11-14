import { StrictMode, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import PluginSurfaceHost from '../components/shell/PluginSurfaceHost'
import { DashboardViews, DashboardView } from '../components/shell/DashboardViews'
import { usePluginDashboards, usePluginDashboardCommands } from '../components/shell/usePluginDashboards'
import { dispatchPluginCommand } from '../lib/plugins/commandBus'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'
import type { DashboardTab } from '../components/viewer-navigation/model'
import type { PluginDashboardId } from '../lib/plugins/dashboard'
import PluginPage from '../components/shell/PluginPage'

const requests: Array<{ url: string; init?: RequestInit; resolve: (body: unknown, status?: number) => void }> = []
let visible = true
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' })
Object.assign(window, { __requests: requests,
  __setMessagingEnabled: (enabled: boolean) => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'messaging', enabled)),
  fetch: (url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ url, init, resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) })
  }),
})
function PluginFixture() {
  const [tab, setTab] = useState<DashboardTab>('sessions')
  const [handled, setHandled] = useState(false)
  const [placement, setPlacement] = useState<'overlay' | 'window'>('window')
  const dashboards = usePluginDashboards({ includeDisabled: true })
  const disabled = useDisabledPlugins().has('messaging')
  usePluginDashboardCommands(useCallback((id: PluginDashboardId) => setTab(id), []))
  return <>
    <div style={{ position: 'relative', zIndex: 100 }}>
      <button onClick={() => setHandled(dispatchPluginCommand('open-cross-session-messaging'))}>Open messaging command</button>
      <output data-testid="handled">{String(handled)}</output>
      <button onClick={() => setPlacement(value => value === 'window' ? 'overlay' : 'window')}>Move placement</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'messaging', disabled))}>{disabled ? 'Enable messaging' : 'Disable messaging'}</button>
    </div>
    <DashboardViews value={tab} onValueChange={setTab}>
      <DashboardView value="sessions">Core shell</DashboardView>
      <DashboardView value="agents">Core operations</DashboardView>
      {dashboards.map(dashboard => {
        const view = <PluginSurfaceHost ownerId="messaging-fixture" surfaceId={dashboard.surface} placement={placement}
          sessionKey={null} services={{ session: { session: null } }} onClose={() => setTab('sessions')} />
        return <DashboardView key={dashboard.id} value={dashboard.id as DashboardTab}>
          {placement === 'window' ? <div data-placement="window">{view}</div> : <section data-placement="overlay">{view}</section>}
        </DashboardView>
      })}
    </DashboardViews>
  </>
}
const params = new URLSearchParams(location.search)
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode>
  <button onClick={() => { visible = !visible; document.dispatchEvent(new Event('visibilitychange')) }}>Toggle visibility</button>
  {params.has('plugin') ? <PluginFixture /> : params.has('standalone') ? <PluginPage surfaceId="messaging" /> : <PluginSurfaceHost surfaceId="messaging" placement="window" sessionKey={null} services={{ session: { session: null } }} onClose={() => {}} />}
</StrictMode>)
Object.assign(window, { __unmount: () => root.unmount() })

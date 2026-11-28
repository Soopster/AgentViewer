import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PluginSurfaceHost from '../components/shell/PluginSurfaceHost'
import { ApplicationPluginHost } from '../components/shell/ApplicationPluginHost'
import { createWebRunLaunchService } from '../components/shell/runLaunchService'
import MessageView from '../components/MessageView'
import { dispatchPluginCommand } from '../lib/plugins/commandBus'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'
import type { WebPluginServices } from '../components/shell/pluginTypes'
import type { Session } from '../lib/types'

const opened: Session[] = []
const completed: Array<{ aborted: boolean }> = []
Object.assign(window, { __runOpened: opened, __runCompleted: completed })
function Fixture() {
  const [account, setAccount] = useState('work')
  const [cwd, setCwd] = useState('/fixture/one')
  const [open, setOpen] = useState(true)
  const [placement, setPlacement] = useState<'window' | 'overlay'>('overlay')
  const [mode, setMode] = useState<'standalone' | 'embedded' | 'command' | 'chat'>('standalone')
  const disabled = useDisabledPlugins().has('coordination')
  const close = useCallback(() => setOpen(false), [])
  const session = useMemo<Session>(() => ({ sessionId: 'same', provider: 'claude', providerInstanceId: account, cwd }), [account, cwd])
  const launch = useMemo(() => {
    const adapter = createWebRunLaunchService()
    return { defaults: { provider: 'claude' as const, providerInstanceId: account, model: `model-${account}`, effort: 'high' },
      async start(...args: Parameters<typeof adapter.start>) {
        const result = await adapter.start(...args)
        completed.push({ aborted: Boolean(args[1]?.aborted) })
        return result
      },
    }
  }, [account])
  const services = useMemo<WebPluginServices>(() => ({ 'run-launch': launch, repository: { cwd, sessionId: 'same' }, session: { session },
    coordination: { provider: 'claude', selectedSession: session, openSession: value => opened.push(value), sessionsChanged() {} },
  }), [launch, cwd, session])
  const host = open && <PluginSurfaceHost ownerId="run-launch-fixture" surfaceId={mode === 'embedded' ? 'coordination' : 'new-workflow'}
    placement={placement} sessionKey={null} cwd={cwd} services={services} onClose={close} />
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'relative', zIndex: 200 }}>
      <button onClick={() => setOpen(true)}>Open launch</button>
      <button onClick={close}>Hide launch</button>
      <button onClick={() => setAccount(value => value === 'work' ? 'personal' : 'work')}>Switch account</button>
      <button onClick={() => setCwd(value => value === '/fixture/one' ? '/fixture/two' : '/fixture/one')}>Switch repository</button>
      <button onClick={() => setPlacement(value => value === 'overlay' ? 'window' : 'overlay')}>Move placement</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'coordination', disabled))}>{disabled ? 'Enable coordination' : 'Disable coordination'}</button>
      <button onClick={() => setMode('command')}>Use command host</button>
      <button onClick={() => setMode('embedded')}>Use embedded</button>
      <button onClick={() => setMode('chat')}>Use chat</button>
      <button onClick={() => dispatchPluginCommand('coord-start')}>Dispatch start</button>
    </div>
    {mode === 'command' ? <ApplicationPluginHost sessions={[session]} selectedSession={session} cwd={cwd} />
      : mode === 'chat' ? <div style={{ flex: 1, display: 'flex', minHeight: 0 }}><MessageView messages={[]} loading={false} session={session} hideCoordinator /></div>
      : placement === 'window' ? <section style={{ width: 1300, height: 950 }}>{host}</section> : host}
  </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)

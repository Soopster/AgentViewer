import React, { useContext, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { module } from '../plugins/instructions-manager/web'
import { webInstructionsManager } from '../components/shell/instructionsManagerService'
import { createPluginStateStore, useScopedPluginState } from '../lib/plugins/scopedState'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const data = (window as unknown as { INSTRUCTIONS_FIXTURE: { cwd: string; other: string } }).INSTRUCTIONS_FIXTURE
const Owner = React.createContext(data.cwd)
const useFixtureState: WebPluginViewProps['useState'] = (name, initial) => { const cwd = useContext(Owner); return useScopedPluginState(store, 'instructions-manager', cwd, name, initial) }
const store = createPluginStateStore(), View = module.views['instructions-manager']!
function Fixture() {
  const [placement, setPlacement] = useState<'panel' | 'window' | 'overlay'>('panel'), [cwd, setCwd] = useState(data.cwd), [open, setOpen] = useState(true)
  return <Owner.Provider value={cwd}><button onClick={() => setPlacement(placement === 'panel' ? 'window' : 'panel')}>Relocate</button><button onClick={() => { setPlacement('overlay'); setOpen(true) }}>Overlay</button><button onClick={() => setCwd(cwd === data.cwd ? data.other : data.cwd)}>Switch repository</button><button onClick={() => setOpen(true)}>Reopen</button>{open ? <div style={{ height: 850 }}><View key={cwd} pluginId="instructions-manager" surfaceId="instructions-manager" instanceId={cwd} placement={placement} target={{ cwd, sessionKey: null }} services={{ 'instructions-manager': webInstructionsManager, repository: { cwd, sessionId: null } }} useState={useFixtureState} close={() => setOpen(false)} onDispose={() => () => {}} /></div> : null}</Owner.Provider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)

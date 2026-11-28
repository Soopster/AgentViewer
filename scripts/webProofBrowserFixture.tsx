import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { module, widgets } from '../plugins/proof/web'
import { webProof } from '../components/shell/proofService'
import { modAppStore, EMPTY_MOD_APP } from '../lib/plugins/modApp'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const cwd = (window as unknown as { PROOF_CWD: string }).PROOF_CWD
const target = { provider: 'codex' as const, providerInstanceId: 'personal', sessionId: 'proof-session' }
const session = { ...target, cwd, summary: 'Proof fixture', lastModified: 1 }
function publish(other = false) {
  modAppStore.publish({ ...EMPTY_MOD_APP, instanceId: 'web-proof', cwd, selectedKey: other ? 'other' : 'source', sessions: [{ key: other ? 'other' : 'source', title: 'Fixture', cwd, activity: 'idle', target: other ? { ...target, providerInstanceId: 'work' } : target }] })
}
publish()
const useFixtureState: WebPluginViewProps['useState'] = (_name, initial) => useState(initial)
function Fixture() {
  const [draft, setDraft] = useState('Keep my existing draft'), [open, setOpen] = useState(true), [placement, setPlacement] = useState<'overlay' | 'window' | 'panel'>('panel')
  const View = module.views.proof, Widget = widgets.widgets.status
  const services = { proof: webProof, repository: { cwd, sessionId: target.sessionId }, session: { session }, composer: { insertText: (text: string) => setDraft(previous => `${previous}\n${text}`) } }
  return <><button onClick={() => setOpen(!open)}>Toggle Proof</button><button onClick={() => publish(true)}>Switch account</button><button onClick={() => publish()}>Original account</button><button onClick={() => setPlacement('overlay')}>Overlay Proof</button><button onClick={() => setPlacement(placement === 'panel' ? 'window' : 'panel')}>Relocate Proof</button>
    <textarea aria-label="Composer draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <Widget slot="corner" services={services} />
    {open ? <div style={{ height: 800 }}><View pluginId="proof" surfaceId="proof" instanceId="fixture" placement={placement} target={{ cwd, sessionKey: 'source' }} services={services} close={() => setOpen(false)} useState={useFixtureState} onDispose={() => () => {}} /></div> : null}</>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

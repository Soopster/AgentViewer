import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerAccessoryHost } from '../components/shell/ComposerAccessoryHost'
import { useComposerAccessories } from '../lib/plugins/useComposerAccessories'
import { useComposerTurnContext } from '../lib/plugins/useComposerTurnContext'
import { applyPluginSettings } from '../lib/plugins/enablement'
import { sessionIdentityKey } from '../lib/sessionIdentity'

function Fixture() {
  const [sessionNumber, setSessionNumber] = useState(1)
  const [start, setStart] = useState<number | null>(null)
  const [attention, setAttention] = useState(false)
  const [visible, setVisible] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const session = { provider: 'codex' as const, providerInstanceId: 'fixture', sessionId: `session-${sessionNumber}`, cwd: '/fixture' }
  const accessories = useComposerAccessories('web', sessionIdentityKey(session))
  const turn = useComposerTurnContext(session, start !== null, attention, start)
  const toggle = () => { applyPluginSettings({ version: 1, disabled: enabled ? ['tips'] : [] }); setEnabled(!enabled) }
  return <main style={{ width: 'min(720px, 100%)', fontFamily: 'monospace', color: 'var(--text-2)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      <button onClick={() => { setAttention(false); setStart(Date.now()) }}>Start</button>
      <button onClick={() => setStart(null)}>Settle</button>
      <button onClick={() => setAttention(true)}>Attention</button>
      <button onClick={() => setVisible(!visible)}>Visibility</button>
      <button onClick={() => setSessionNumber(sessionNumber + 1)}>Switch target</button>
      <button onClick={toggle}>Toggle Tips</button>
    </div>
    <textarea aria-label="Draft" defaultValue="Keep this draft" style={{ width: '100%', height: 65, boxSizing: 'border-box', marginTop: 12, background: 'var(--surface)', color: 'var(--text-2)' }} />
    <div>Working · esc to interrupt</div>
    <ComposerAccessoryHost key={sessionIdentityKey(session)} placement="footer" turn={turn} visible={visible} session={session} draft="Keep this draft" disabled={start !== null}
      controller={accessories.controller} isCurrent={accessories.isCurrent} services={{}} />
    <output data-rows>{accessories.snapshot.rows}</output>
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)

import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useSessionCatalog } from '../components/session-catalog/useSessionCatalog'
import { useSessionCatalogQuery } from '../components/session-catalog/useSessionCatalogQuery'
import type { SessionCatalogQuery } from '../components/session-catalog/api'

const requests: Array<{ url: string; init?: RequestInit; resolve: (body: unknown, status?: number) => void }> = []
Object.assign(window, { __requests: requests,
  fetch: (url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    // Deliberately ignore abort so stale-response guards are independently tested.
    requests.push({ url, init, resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) })
  }),
})
function Fixture() {
  const catalog = useSessionCatalog()
  useEffect(() => { Object.assign(window, { __refreshCatalog: catalog.refresh }) }, [catalog.refresh])
  const [instance, setInstance] = useState('work')
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  const [enabled, setEnabled] = useState(() => new URLSearchParams(location.search).has('enabled'))
  const [render, rerender] = useState(0)
  const query: SessionCatalogQuery = { provider: 'codex', providerInstanceId: instance, projectDir, includeWorktrees: true }
  useSessionCatalogQuery({ query, enabled, visible, load: catalog.load, cancel: catalog.cancel })
  return <>
    <button onClick={() => setEnabled(value => !value)}>Toggle enabled</button>
    <button onClick={() => setInstance(value => value === 'work' ? 'personal' : 'work')}>Switch instance</button>
    <button onClick={() => setProjectDir(value => value ? null : '/alpha')}>Toggle scope</button>
    <button onClick={() => setVisible(value => !value)}>Toggle visibility</button>
    <button onClick={() => { void catalog.refresh(); void catalog.refresh() }}>Refresh twice</button>
    <button onClick={() => catalog.update(previous => previous.map(session => ({ ...session, customTitle: 'Other runtime' })), {
      sessionId: 'shared', provider: 'codex', providerInstanceId: 'work',
    })}>Mutate other instance</button>
    <button onClick={() => catalog.update(previous => previous.map(session => ({ ...session, customTitle: 'Optimistic' })))}>Rename</button>
    <button onClick={() => rerender(value => value + 1)}>Rerender</button>
    <output>{JSON.stringify({ render, loading: catalog.loading, error: catalog.error, sessions: catalog.sessions })}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { __unmount: () => root.unmount() })
root.render(<StrictMode><Fixture /></StrictMode>)

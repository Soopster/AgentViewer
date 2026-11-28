import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useProviderSelection } from '../components/provider-selection/useProviderSelection'
import { useSessionCatalog } from '../components/session-catalog/useSessionCatalog'
import { useSessionCatalogQuery } from '../components/session-catalog/useSessionCatalogQuery'
import type { ProviderSelection } from '../lib/types'

const requests: Array<{ url: string; init?: RequestInit; resolve: (body: unknown, status?: number) => void }> = []
Object.assign(window, { __requests: requests,
  fetch: (url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ url, init, resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) })
  }),
})
function Fixture() {
  const provider = useProviderSelection()
  const catalog = useSessionCatalog()
  const [scope, setScope] = useState<string | null>(null)
  const [resets, setResets] = useState(0)
  const query = useMemo(() => ({ provider: provider.provider, providerInstanceId: provider.providerInstanceId,
    projectDir: scope, includeWorktrees: true }), [provider.provider, provider.providerInstanceId, scope])
  useSessionCatalogQuery({ query, enabled: provider.ready, visible: true, load: catalog.load, cancel: catalog.cancel })
  const choose = async (selection: ProviderSelection, instance?: string) => {
    if (await provider.select(selection, instance)) setResets(value => value + 1)
  }
  return <>
    <button onClick={() => { void choose('codex', 'work') }}>Choose work</button>
    <button onClick={() => { void choose('codex', 'personal') }}>Choose personal</button>
    <button onClick={() => { void choose('all', 'ignored') }}>Choose all</button>
    <button onClick={() => { void choose('codex', 'work'); void choose('codex', 'work') }}>Choose twice</button>
    <button onClick={() => provider.adopt('opencode', 'local')}>Adopt session</button>
    <button onClick={() => setScope(value => value ? null : '/alpha')}>Toggle scope</button>
    <output>{JSON.stringify({ provider: provider.provider, instance: provider.providerInstanceId, ready: provider.ready,
      switching: provider.switching, error: provider.error, instances: provider.instances, resets,
      catalogLoading: catalog.loading, sessions: catalog.sessions })}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { __unmount: () => root.unmount() })
root.render(<StrictMode><Fixture /></StrictMode>)

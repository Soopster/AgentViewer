import { StrictMode, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useSessionCreation } from '../components/session-creation/useSessionCreation'
import { sessionCreationTarget } from '../components/session-creation/target'
import { useViewerNavigation } from '../components/viewer-navigation/useViewerNavigation'
import { getLoadingProviders } from '../lib/providerLoading'
import type { Session } from '../lib/types'

const requests: Array<{ body: string; signal?: AbortSignal | null; resolve: (body: unknown, status?: number) => void }> = []
Object.assign(window, { __requests: requests, __loadingProviders: getLoadingProviders,
  fetch: (_url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ body: String(init?.body), signal: init?.signal,
      resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) })
  }),
})
const alpha: Session = { sessionId: 'alpha', provider: 'codex', providerInstanceId: 'work', summary: 'Alpha', cwd: '/alpha' }
const beta: Session = { ...alpha, sessionId: 'beta', providerInstanceId: 'personal', summary: 'Beta', cwd: '/beta' }
const catalog = [alpha, beta]
function Fixture() {
  const navigation = useViewerNavigation({ sessions: catalog, provider: 'all', scope: 'all' })
  const creation = useSessionCreation()
  const create = useCallback(async () => {
    const isCurrent = navigation.captureIntent()
    const target = sessionCreationTarget({ provider: 'all', providerInstanceId: 'all', session: navigation.currentSession(), projectDir: navigation.currentProjectDir() })
    const draft = await creation.create(target, { isCurrent })
    if (!draft) return
    if (isCurrent()) navigation.openSession(draft)
    else navigation.addTab(draft)
  }, [navigation.captureIntent, navigation.currentSession, navigation.currentProjectDir, navigation.openSession, navigation.addTab, creation.create])
  useEffect(() => { Object.assign(window, { __createSaved: create }) }, [create])
  return <>
    <button onClick={() => { creation.clearError(); navigation.openSession(alpha) }}>Alpha</button>
    <button onClick={() => { creation.clearError(); navigation.openSession(beta) }}>Beta</button>
    <button onClick={() => { void create() }}>Create</button>
    <button onClick={() => { void create(); void create() }}>Create twice</button>
    <button onClick={navigation.invalidateIntent}>Provider intent</button>
    <div data-testid="active-content">{navigation.selectedSession?.summary ?? 'Empty'}</div>
    <output>{JSON.stringify({ selected: navigation.selectedSession, creating: creation.creating,
      error: creation.error, tabs: navigation.openTabSessions.map(session => session.sessionId) })}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)
Object.assign(window, { __unmount: () => root.unmount() })

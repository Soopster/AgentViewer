import { StrictMode, startTransition, useMemo, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import TabBar from '../components/TabBar'
import { useViewerNavigation } from '../components/viewer-navigation/useViewerNavigation'
import { createSessionDeleteCallback } from '../components/session-catalog/actions'
import type { Session } from '../lib/types'

const alpha: Session = { sessionId: 'same', provider: 'codex', providerInstanceId: 'work', summary: 'Alpha', cwd: '/alpha' }
const beta: Session = { ...alpha, providerInstanceId: 'personal', summary: 'Beta', cwd: '/beta' }
const pending: Session = { ...alpha, sessionId: 'pending', summary: 'Pending', isPending: true }
const catalog = [alpha, beta]
function Fixture() {
  const navigation = useViewerNavigation({ sessions: catalog, provider: 'all', scope: 'all' })
  const [clears, setClears] = useState(0)
  const [resourceClears, setResourceClears] = useState(0)
  useEffect(() => {
    if (navigation.empty && navigation.isEmpty()) setResourceClears(value => value + 1)
  }, [navigation.empty, navigation.isEmpty])
  const [followed, setFollowed] = useState(false)
  const deleted = useMemo(() => createSessionDeleteCallback({ remove: navigation.remove, isActive: navigation.isActiveTab,
    clearActive: () => setClears(value => value + 1),
  }), [navigation.remove, navigation.isActiveTab])
  const materialize = () => {
    const follow = navigation.isCurrentSession(pending)
    const next = { ...pending, sessionId: 'materialized', summary: 'Materialized', isPending: false }
    navigation.materialize(pending, next)
    if (follow) navigation.openSession(next)
    setFollowed(follow)
  }
  return <>
    <button onClick={() => navigation.openSession(alpha, 'alpha-anchor')}>Alpha</button>
    <button onClick={() => navigation.openSession(beta, 'beta-anchor')}>Beta</button>
    <button onClick={() => navigation.openSession(pending)}>Pending</button>
    <button onClick={() => navigation.openDashboard('messaging')}>Dashboard</button>
    <button onClick={() => navigation.openProject({ key: 'Alpha project', dir: '/alpha', sessions: [alpha] })}>Project</button>
    <button onClick={() => navigation.updateProjectSessions('/alpha', [{ ...alpha, summary: 'Late project' }])}>Complete project</button>
    <button onClick={() => navigation.patch(alpha, { customTitle: 'Renamed alpha', summary: 'Renamed alpha' })}>Rename alpha</button>
    <button onClick={() => { startTransition(() => navigation.openSession(beta, 'beta-anchor')); deleted(alpha) }}>Queue beta and delete alpha</button>
    <button onClick={() => { startTransition(() => navigation.openSession(beta)); materialize() }}>Queue beta and materialize</button>
    <button onClick={materialize}>Materialize</button>
    <button onClick={() => {
      navigation.closeTab('personal:same')
      navigation.closeTab('work:same')
    }}>Close both</button>
    <TabBar tabs={navigation.openTabSessions} activeId={navigation.selectedTabKey} onSelect={navigation.openSession} onClose={navigation.closeTab} />
    <div data-testid="active-content">{navigation.selectedSession?.summary ?? navigation.selectedProject?.key ?? 'Empty'}</div>
    <output>{JSON.stringify({ selected: navigation.selectedTabKey, project: navigation.selectedProject?.dir,
      target: navigation.targetMessage?.messageId, dashboard: navigation.dashboardTab,
      tabs: navigation.openTabSessions.map(session => ({ id: session.sessionId, instance: session.providerInstanceId, title: session.summary })),
      clears, resourceClears, followed })}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)

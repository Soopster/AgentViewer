import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import type { ProviderSelection, Session } from '@/lib/types'
import { sessionIdentityKey, type SessionIdentity } from '@/lib/sessionIdentity'
import type { SessionMetadataPatch } from '@/components/session-catalog/actions'
import { initialViewerNavigation, selectedViewerSession, viewerNavigationReducer, viewerSessionKey,
  RUN_DASHBOARD_KEY, type DashboardTab, type ProjectSelection, type ViewerNavigationAction } from './model'

export function useViewerNavigation({ sessions, provider, scope }: {
  sessions: Session[]; provider: ProviderSelection; scope: 'all' | 'project'
}) {
  const [state, dispatch] = useReducer(viewerNavigationReducer, undefined, initialViewerNavigation)
  // Imperative actions read the latest intent, including transitions React has
  // not committed yet. Rendering continues to consume the reducer snapshot.
  const intentRef = useRef(state)
  const catalogRef = useRef(sessions)
  const sequenceRef = useRef(0)
  const intentVersionRef = useRef(0)
  const mountedRef = useRef(false)
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; intentVersionRef.current++ }
  }, [])
  useLayoutEffect(() => { catalogRef.current = sessions }, [sessions])
  const send = useCallback((action: ViewerNavigationAction) => {
    if (!mountedRef.current) return
    const location = intentRef.current.location
    const navigates = ['session', 'project', 'dashboard', 'dashboard-tab', 'clear'].includes(action.type)
      || (action.type === 'close-tab' && location.kind === 'session' && location.key === action.key)
      || (action.type === 'remove' && location.kind === 'session' && location.key === viewerSessionKey(action.target))
    if (navigates) intentVersionRef.current++
    intentRef.current = viewerNavigationReducer(intentRef.current, action)
    dispatch(action)
  }, [])
  useEffect(() => { send({ type: 'catalog', sessions, provider, scope }) }, [sessions, provider, scope, send])
  const actions = useMemo(() => ({
    captureIntent: () => {
      const version = intentVersionRef.current
      return () => mountedRef.current && intentVersionRef.current === version
    },
    invalidateIntent: () => { intentVersionRef.current++ },
    currentSession: () => mountedRef.current ? selectedViewerSession(intentRef.current, catalogRef.current) : null,
    openSession: (session: Session, messageId?: string) => send({ type: 'session', session,
      target: messageId ? { messageId, requestId: ++sequenceRef.current } : null }),
    openProject: (project: ProjectSelection) => send({ type: 'project', project }),
    openDashboard: (tab: DashboardTab) => send({ type: 'dashboard', tab, context: selectedViewerSession(intentRef.current, catalogRef.current) }),
    setDashboardTab: (tab: DashboardTab) => send({ type: 'dashboard-tab', tab }),
    scrollToSession: (session: Session) => send({ type: 'scroll', sessionKey: viewerSessionKey(session), requestId: ++sequenceRef.current }),
    closeTab: (key: string) => {
      const prior = intentRef.current.location
      const wasActive = prior.kind === 'session' && prior.key === key
      send({ type: 'close-tab', key })
      return { wasActive, adjacent: wasActive ? selectedViewerSession(intentRef.current, catalogRef.current) : null }
    },
    clear: () => send({ type: 'clear' }),
    isEmpty: () => intentRef.current.location.kind === 'empty',
    currentProjectDir: () => {
      if (!mountedRef.current) return null
      const location = intentRef.current.location
      return location.kind === 'project' ? location.project.dir
        : selectedViewerSession(intentRef.current, catalogRef.current)?.cwd ?? null
    },
    updateProjectSessions: (dir: string, sessions: Session[]) => send({ type: 'project-sessions', dir, sessions }),
    patch: (target: SessionIdentity, patch: SessionMetadataPatch) => send({ type: 'patch', target, patch }),
    remove: (target: SessionIdentity) => send({ type: 'remove', target }),
    materialize: (source: SessionIdentity, session: Session) => send({ type: 'materialize', source, session }),
    addTab: (session: Session) => send({ type: 'add-tab', session }),
    isActiveTab: (target: SessionIdentity) => mountedRef.current && intentRef.current.location.kind === 'session'
      && intentRef.current.location.key === viewerSessionKey(target),
    isCurrentSession: (target: SessionIdentity) => {
      if (!mountedRef.current) return false
      const selected = selectedViewerSession(intentRef.current, catalogRef.current)
      return !!selected && sessionIdentityKey(selected) === sessionIdentityKey(target)
    },
    isDashboardContext: (target: SessionIdentity) => {
      if (!mountedRef.current) return false
      const location = intentRef.current.location
      return location.kind === 'dashboard' && !!location.context && sessionIdentityKey(location.context) === sessionIdentityKey(target)
    },
  }), [send])
  const selectedSession = useMemo(() => selectedViewerSession(state, sessions), [state, sessions])
  return {
    ...actions, selectedSession, openTabSessions: state.tabs,
    selectedTabKey: state.location.kind === 'session' ? state.location.key : state.location.kind === 'dashboard' ? RUN_DASHBOARD_KEY : null,
    selectedProject: state.location.kind === 'project' ? state.location.project : null,
    targetMessage: state.location.kind === 'session' ? state.location.target : null,
    dashboardTab: state.location.kind === 'dashboard' ? state.location.tab : 'sessions' as DashboardTab,
    sessionListScrollRequest: state.scrollRequest,
    empty: state.location.kind === 'empty',
  }
}

import { sessionSelectionKey as viewerSessionKey } from '@/components/session-catalog/selectionKey'
export { viewerSessionKey }
import type { ProviderSelection, Session } from '@/lib/types'
import { sessionIdentityKey, type SessionIdentity } from '@/lib/sessionIdentity'
import { sameProjectPath } from '@/lib/projectPaths'
import { stabilizeSessionIdentities, refreshOpenSessionMetadata } from '@/components/session-catalog/model'
import { patchSessionList, removeSessionFromList, type SessionMetadataPatch } from '@/components/session-catalog/actions'

export const RUN_DASHBOARD_KEY = '__run-dashboard__'
export type DashboardTab = 'sessions' | 'agents' | 'messaging'
export type ProjectSelection = { key: string; dir: string; sessions: Session[] }
export type MessageTarget = { messageId: string; requestId: number }
export type ViewerLocation =
  | { kind: 'empty' }
  | { kind: 'session'; key: string; target: MessageTarget | null }
  | { kind: 'project'; project: ProjectSelection }
  | { kind: 'dashboard'; tab: DashboardTab; context: Session | null }
export type ViewerNavigationState = {
  tabs: Session[]
  location: ViewerLocation
  scrollRequest: { sessionKey: string; requestId: number } | null
}

export function initialViewerNavigation(): ViewerNavigationState {
  return { tabs: [], location: { kind: 'empty' }, scrollRequest: null }
}
export function selectedViewerSession(state: ViewerNavigationState, catalog: Session[]): Session | null {
  if (state.location.kind === 'dashboard') return state.location.context
  if (state.location.kind !== 'session') return null
  const key = state.location.key
  return state.tabs.find(session => viewerSessionKey(session) === key)
    ?? catalog.find(session => viewerSessionKey(session) === key) ?? null
}
function openTab(tabs: Session[], session: Session): Session[] {
  const key = sessionIdentityKey(session)
  if (!tabs.some(tab => sessionIdentityKey(tab) === key)) return [...tabs, session]
  return tabs.map(tab => {
    if (sessionIdentityKey(tab) !== key) return tab
    const merged = { ...tab, ...session }
    if (session.isPending === undefined) delete merged.isPending
    return merged
  })
}
export function materializeSessionList(sessions: Session[], source: SessionIdentity, materialized: Session, addIfMissing = false): Session[] {
  const oldKey = sessionIdentityKey(source)
  const newKey = sessionIdentityKey(materialized)
  let matched = false
  const next = sessions.map(session => {
    const key = sessionIdentityKey(session)
    if (key !== oldKey && key !== newKey) return session
    matched = true
    return { ...session, ...materialized }
  })
  if (!matched && !addIfMissing) return sessions
  if (!matched) next.push(materialized)
  const seen = new Set<string>()
  return next.filter(session => {
    const key = sessionIdentityKey(session)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function updateLocationSessions(location: ViewerLocation, update: (sessions: Session[]) => Session[]): ViewerLocation {
  if (location.kind === 'project') {
    const sessions = update(location.project.sessions)
    return sessions === location.project.sessions ? location : { ...location, project: { ...location.project, sessions } }
  }
  if (location.kind === 'dashboard' && location.context) {
    const context = update([location.context])[0] ?? null
    return context === location.context ? location : { ...location, context }
  }
  return location
}
export type ViewerNavigationAction =
  | { type: 'session'; session: Session; target: MessageTarget | null }
  | { type: 'project'; project: ProjectSelection }
  | { type: 'dashboard'; tab: DashboardTab; context: Session | null }
  | { type: 'dashboard-tab'; tab: DashboardTab }
  | { type: 'add-tab'; session: Session }
  | { type: 'close-tab'; key: string }
  | { type: 'clear' }
  | { type: 'scroll'; sessionKey: string; requestId: number }
  | { type: 'project-sessions'; dir: string; sessions: Session[] }
  | { type: 'catalog'; sessions: Session[]; provider: ProviderSelection; scope: 'all' | 'project' }
  | { type: 'patch'; target: SessionIdentity; patch: SessionMetadataPatch }
  | { type: 'remove'; target: SessionIdentity }
  | { type: 'materialize'; source: SessionIdentity; session: Session }

export function viewerNavigationReducer(state: ViewerNavigationState, action: ViewerNavigationAction): ViewerNavigationState {
  switch (action.type) {
    case 'session': return { ...state, tabs: openTab(state.tabs, action.session), location: { kind: 'session', key: viewerSessionKey(action.session), target: action.target } }
    case 'project': return { ...state, location: { kind: 'project', project: action.project } }
    case 'dashboard': return { ...state, location: { kind: 'dashboard', tab: action.tab, context: action.context } }
    case 'dashboard-tab': return state.location.kind === 'dashboard' && state.location.tab !== action.tab
      ? { ...state, location: { ...state.location, tab: action.tab } } : state
    case 'add-tab': return { ...state, tabs: openTab(state.tabs, action.session) }
    case 'clear': return { ...state, location: { kind: 'empty' }, scrollRequest: null }
    case 'scroll': return { ...state, scrollRequest: { sessionKey: action.sessionKey, requestId: action.requestId } }
    case 'close-tab': {
      const index = state.tabs.findIndex(tab => viewerSessionKey(tab) === action.key)
      if (index < 0) return state
      const tabs = state.tabs.filter((_, position) => position !== index)
      if (state.location.kind !== 'session' || state.location.key !== action.key) return { ...state, tabs }
      const adjacent = tabs[Math.min(index, tabs.length - 1)]
      return { ...state, tabs, location: adjacent ? { kind: 'session', key: viewerSessionKey(adjacent), target: null } : { kind: 'empty' } }
    }
    case 'project-sessions': {
      if (state.location.kind !== 'project' || !sameProjectPath(state.location.project.dir, action.dir)) return state
      const project = state.location.project
      const sessions = stabilizeSessionIdentities(project.sessions, action.sessions)
      return sessions === project.sessions ? state : { ...state, location: { kind: 'project', project: { ...project, sessions } } }
    }
    case 'catalog': {
      const tabs = refreshOpenSessionMetadata(state.tabs, action.sessions)
      let location = state.location
      if (location.kind === 'project') {
        const project = location.project
        const sessions = action.sessions.filter(session => sameProjectPath(project.dir, session.cwd))
        if (!sessions.length) {
          if (action.provider !== 'all' || action.scope === 'project') location = { kind: 'empty' }
        } else {
          const stable = stabilizeSessionIdentities(project.sessions, sessions)
          if (stable !== project.sessions) location = { kind: 'project', project: { ...project, sessions: stable } }
        }
      } else if (location.kind === 'dashboard' && location.context) {
        const key = sessionIdentityKey(location.context)
        const context = action.sessions.find(session => sessionIdentityKey(session) === key) ?? location.context
        if (context !== location.context) location = { ...location, context }
      } else if (location.kind === 'session') {
        const key = location.key
        if (![...tabs, ...action.sessions].some(session => viewerSessionKey(session) === key)) location = { kind: 'empty' }
      }
      return tabs === state.tabs && location === state.location ? state : { ...state, tabs, location }
    }
    case 'patch': {
      const tabs = patchSessionList(state.tabs, action.target, action.patch)
      const location = updateLocationSessions(state.location, sessions => patchSessionList(sessions, action.target, action.patch))
      return tabs === state.tabs && location === state.location ? state : { ...state, tabs, location }
    }
    case 'remove': {
      const tabs = removeSessionFromList(state.tabs, action.target)
      let location = updateLocationSessions(state.location, sessions => removeSessionFromList(sessions, action.target))
      if (location.kind === 'session' && location.key === viewerSessionKey(action.target)) location = { kind: 'empty' }
      return tabs === state.tabs && location === state.location ? state : { ...state, tabs, location }
    }
    case 'materialize': {
      const update = (sessions: Session[]) => materializeSessionList(sessions, action.source, action.session)
      const tabs = materializeSessionList(state.tabs, action.source, action.session, true)
      let location = updateLocationSessions(state.location, update)
      if (location.kind === 'session' && location.key === viewerSessionKey(action.source)) location = { ...location, key: viewerSessionKey(action.session) }
      return { ...state, tabs, location }
    }
  }
}

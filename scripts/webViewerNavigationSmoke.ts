import assert from 'node:assert/strict'
import { initialViewerNavigation, viewerNavigationReducer as reduce, viewerSessionKey, selectedViewerSession, materializeSessionList } from '../components/viewer-navigation/model'
import type { Session } from '../lib/types'

const alpha: Session = { sessionId: 'same', provider: 'codex', providerInstanceId: 'work', summary: 'Alpha', cwd: '/alpha' }
const beta: Session = { ...alpha, providerInstanceId: 'personal', summary: 'Beta', cwd: '/beta' }
let state = initialViewerNavigation()
state = reduce(state, { type: 'session', session: alpha, target: { messageId: 'anchor', requestId: 1 } })
assert.equal(state.location.kind, 'session')
state = reduce(state, { type: 'session', session: beta, target: null })
assert.equal(state.tabs.length, 2)
assert.equal(selectedViewerSession(state, []), state.tabs[1])
state = reduce(state, { type: 'dashboard', tab: 'messaging', context: beta })
state = reduce(state, { type: 'patch', target: beta, patch: { customTitle: 'Updated beta' } })
assert.equal(state.tabs[0], alpha)
assert.equal(state.tabs[1]!.customTitle, 'Updated beta')
assert.equal(state.location.kind === 'dashboard' && state.location.context?.customTitle, 'Updated beta')
state = reduce(state, { type: 'remove', target: alpha })
assert.equal(state.tabs.length, 1)
assert.equal(state.location.kind, 'dashboard')
state = reduce(state, { type: 'remove', target: beta })
assert.equal(state.location.kind === 'dashboard' && state.location.context, null)

state = reduce(state, { type: 'session', session: alpha, target: null })
state = reduce(state, { type: 'session', session: beta, target: null })
state = reduce(state, { type: 'close-tab', key: viewerSessionKey(beta) })
assert.equal(selectedViewerSession(state, [])?.providerInstanceId, 'work')
state = reduce(state, { type: 'close-tab', key: viewerSessionKey(alpha) })
assert.equal(state.location.kind, 'empty')
assert.equal(state.tabs.length, 0)
state = reduce(state, { type: 'project', project: { key: 'Alpha', dir: '/alpha', sessions: [alpha] } })
const project = state
assert.equal(reduce(state, { type: 'project-sessions', dir: '/beta', sessions: [beta] }), project)
state = reduce(state, { type: 'project-sessions', dir: '/alpha', sessions: [{ ...alpha, summary: 'Current alpha' }] })
assert.equal(state.location.kind === 'project' && state.location.project.sessions[0]!.summary, 'Current alpha')
state = reduce(state, { type: 'session', session: beta, target: { messageId: 'fresh-anchor', requestId: 2 } })
const selected = state
assert.equal(reduce(state, { type: 'project-sessions', dir: '/alpha', sessions: [alpha] }), selected,
  'project results cannot replace a newer session location')
state = reduce(state, { type: 'remove', target: alpha })
assert.equal(state.location.kind === 'session' && state.location.target?.messageId, 'fresh-anchor')
state = reduce(state, { type: 'catalog', sessions: [], provider: 'all', scope: 'all' })
assert.equal(state.location.kind, 'session', 'open tabs survive narrower catalog queries')
state = reduce(state, { type: 'project', project: { key: 'Alpha', dir: '/alpha', sessions: [alpha] } })
assert.equal(reduce(state, { type: 'catalog', sessions: [], provider: 'all', scope: 'all' }), state)
assert.equal(reduce(state, { type: 'catalog', sessions: [], provider: 'codex', scope: 'all' }).location.kind, 'empty')

const pending: Session = { ...alpha, sessionId: 'pending', isPending: true }
const existing: Session = { ...alpha, sessionId: 'materialized', summary: 'Already discovered' }
const other: Session = { ...pending, providerInstanceId: 'personal' }
const materialized: Session = { ...pending, sessionId: 'materialized', isPending: false }
const collapsed = materializeSessionList([pending, existing, other], pending, materialized)
assert.equal(collapsed.length, 2)
assert.equal(collapsed[1], other)
state = reduce(initialViewerNavigation(), { type: 'session', session: pending, target: { messageId: 'anchor', requestId: 3 } })
state = reduce(state, { type: 'add-tab', session: existing })
state = reduce(state, { type: 'materialize', source: pending, session: materialized })
assert.equal(state.tabs.length, 1)
assert.equal(state.location.kind === 'session' && state.location.key, viewerSessionKey(materialized))
assert.equal(state.location.kind === 'session' && state.location.target?.messageId, 'anchor')
state = reduce(state, { type: 'session', session: beta, target: null })
state = reduce(state, { type: 'materialize', source: pending, session: materialized })
assert.equal(selectedViewerSession(state, [])?.providerInstanceId, 'personal', 'background materialization cannot steal focus')
state = reduce(state, { type: 'clear' })
assert.equal(state.location.kind, 'empty')
assert.equal(state.tabs.length, 2, 'provider selection reset retains open tabs')
console.log('Web viewer navigation: atomic locations, exact identities, adjacent tabs, project result guards, context updates, and materialization passed')

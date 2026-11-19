// The Web tab strip's pins (the Tab manager plugin's rules, as the TUI keeps
// them): pinned tabs lead, move only within their group, and refuse to close.
import assert from 'node:assert/strict'
import { initialViewerNavigation, viewerNavigationReducer, viewerSessionKey } from '../components/viewer-navigation/model'
import type { Session } from '../lib/types'

const session = (id: string) => ({ sessionId: id, provider: 'claude', summary: id } as Session)
let state = initialViewerNavigation()
for (const id of ['a', 'b', 'c', 'd']) state = viewerNavigationReducer(state, { type: 'session', session: session(id), target: null })
const order = () => state.tabs.map(tab => tab.sessionId).join('')
const key = (id: string) => viewerSessionKey(session(id))
assert.equal(order(), 'abcd')

state = viewerNavigationReducer(state, { type: 'pin-tab', key: key('c') })
assert.equal(order(), 'cabd', 'a pinned tab leads the strip')
state = viewerNavigationReducer(state, { type: 'pin-tab', key: key('d') })
assert.equal(order(), 'cdab', 'and joins the end of the pinned group')
state = viewerNavigationReducer(state, { type: 'move-tab', key: key('d'), delta: 1 })
assert.equal(order(), 'cdab', 'a pinned tab cannot move among unpinned ones')
state = viewerNavigationReducer(state, { type: 'move-tab', key: key('d'), delta: -1 })
assert.equal(order(), 'dcab', 'it moves within its group')
state = viewerNavigationReducer(state, { type: 'move-tab', key: key('b'), delta: -1 })
assert.equal(order(), 'dcba')
state = viewerNavigationReducer(state, { type: 'move-tab', key: key('b'), delta: -1 })
assert.equal(order(), 'dcba', 'an unpinned tab cannot move into the pinned group')
const selected = state.location
state = viewerNavigationReducer(state, { type: 'close-tab', key: key('c') })
assert.equal(order(), 'dcba', 'a pinned tab refuses to close')
assert.equal(state.location, selected)
state = viewerNavigationReducer(state, { type: 'pin-tab', key: key('c') })
assert.equal(order(), 'dcba', 'unpinning leaves it first among the unpinned')
assert.deepEqual(state.pinned, [key('d')])
state = viewerNavigationReducer(state, { type: 'close-tab', key: key('c') })
assert.equal(order(), 'dba', 'once unpinned it closes')
console.log('Session tabs: pins lead, move within their group, refuse to close until unpinned.')
console.log('Session tabs smoke: PASS')

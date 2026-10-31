import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import TabBar from '../components/TabBar'
import RunDashboard from '../components/RunDashboard'
import { sessionSelectionKey } from '../components/session-catalog/selectionKey'
import type { Session } from '../lib/types'

const work: Session = { sessionId: 'shared', provider: 'codex', providerInstanceId: 'work', summary: 'Work instance', cwd: '/work' }
const personal: Session = { ...work, providerInstanceId: 'personal', summary: 'Personal instance' }
const sessions = [work, personal]
assert.equal(sessionSelectionKey(work), 'work:shared')
assert.equal(sessionSelectionKey(personal), 'personal:shared')
assert.equal(sessionSelectionKey({ sessionId: 'shared', provider: 'codex' }), 'codex:shared')
const tabs = renderToStaticMarkup(<TabBar tabs={sessions} activeId={sessionSelectionKey(personal)} onSelect={() => {}} onClose={() => {}} />)
assert.equal((tabs.match(/av-active/g) ?? []).length, 1)
assert.match(tabs, /title="Personal instance" class="av-session-tab av-hover-control av-active"/)
const dashboard = renderToStaticMarkup(<RunDashboard sessions={sessions} selectedSession={personal} messages={[]} loading={false}
  providerLabel="all" scopeLabel={null} onSelectSession={() => {}} />)
assert.equal((dashboard.match(/av-selected/g) ?? []).length, 1, 'dashboard selection must distinguish matching native IDs in configured instances')
console.log('Web session selection: configured-instance keys and single active tab/dashboard row passed')

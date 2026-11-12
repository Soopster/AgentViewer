/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { DARK_THEME, LIGHT_THEME, type TuiDensity } from '../theme'
import { act, testRender } from './testRender'
import { SessionRail } from './app/overlays/SessionRail'
import { runBuildSidebarRow, type BuildSidebarRowContext } from './app/actions/sidebarRow'
import type { SidebarEntry } from './app/types'
import { sessionKey } from './app/sessionList'

const sessions = Array.from({ length: 25 }, (_, i) => ({
  sessionId: `sidebar-${i}`, provider: 'codex' as const, cwd: '/tmp/sidebar-preview',
  summary: i === 0 ? 'Improve image functionality' : `Session ${i}`, lastModified: Date.now() - (i + 1) * 3600_000,
}))
const entries: SidebarEntry[] = [
  { type: 'project', key: 'project:viewer', projectName: 'AGENTVIEWER', count: 25, collapsible: true },
  { type: 'project', key: 'date:today', projectName: 'Today', count: 25, dateGroup: true },
  ...sessions.map((session, absoluteIndex) => ({ type: 'session' as const, key: sessionKey(session), session, absoluteIndex, indented: true })),
]
for (const density of ['comfortable', 'balanced', 'dense'] as const satisfies readonly TuiDensity[])
for (const width of [28, 44, 64]) for (const theme of [DARK_THEME, LIGHT_THEME]) {
  let created = 0
  let scopeChanged = 0
  let collapsed = ''
  let chosen = ''
  const scroll = React.createRef<ScrollBoxRenderable>()
  const context: BuildSidebarRowContext = {
    sessionInsightsOn: false, toggleDateGroup: key => { collapsed = key }, coordinatorRunGoals: new Map(),
    sidebarEntries: entries, sidebarInnerWidth: width - 5, firstSidebarEntryKey: entries[0].key, theme,
    sidebarSessionActivity: new Map([[sessionKey(sessions[1]), 'needs-input']]), showProviderInSessionRows: false,
    selectSidebarSession: session => { chosen = session.sessionId }, setSidebarSubagentCursor: () => {},
    setSubagentTranscriptSelection: () => {}, setPluginOverlay: () => {}, recentlyWrittenKeys: new Set(),
    teamAttention: new Map(), density, renameSessionKey: null, childrenByParentId: new Map(),
    splitPaneActions: { close: () => {}, promote: () => {}, openLayout: () => {}, fullscreen: () => {}, sessionMenu: () => {} },
    sessionDragHandlers: { press: (_session, _pane, _event, onClick) => onClick?.(), move: () => {}, release: () => {} },
    renameDraft: '', setRenameDraft: () => {}, commitRename: async () => {}, toggleSidebarSubagents: () => {}, collapsedSubagentSet: new Set(),
  }
  function Fixture() {
    const [view, setView] = useState<'sessions' | 'coordinator'>('sessions')
    return <box width={width} height={24}>
    <SessionRail onViewChange={setView} showRail sidebarWidth={width} sidebarExtraRows={0} mainContentHeight={22} sidebarView={view}
      effectiveFocus="sessions" theme={theme} coordinatorSidebarHeader="Coordinator" sidebarHeaderBaseText="SESSIONS 25 · CODEX"
      toggleSidebarSort={() => {}} showToggleOutcome={() => {}} sidebarSort="project" sidebarHeaderPrefixWidth={14}
      sidebarProviderBadgeText="CODEX" sidebarProviderAccent={theme.cyan} workspacesEnabled={false} openSpaces={() => {}}
      fullScreenPopoverOpen={false} setAllProjects={() => { scopeChanged++ }} allProjects={false} sidebarInnerWidth={width - 5}
      sidebarRowBudget={20} density={density} sidebarScrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      loadingSessions={false} sessions={sessions} sidebarEntries={entries} sidebarScrollRef={scroll}
      sidebarRowElements={entries.map((entry, i) => runBuildSidebarRow(context, entry, i === 2))} onNewSession={() => { created++ }} />
  </box>
  }
  const setup = await testRender(<Fixture />, { width, height: 24 })
  try {
    await act(async () => { await setup.flush() })
    const frame = setup.captureCharFrame()
    assert.match(frame, width < 34 ? /Sessions\s+Coordinator\s+\+ / : /Sessions\s+Coordinator\s+\+ New/, 'New sits at the end of the tabs row')
    assert.match(frame, /This project/)
    assert.match(frame, /Today\s+25/)
    assert.ok(!frame.includes('Today /'), 'Counts have their own trailing column')
    const row = setup.renderer.root.findDescendantById(`sidebar:${entries[2].key}`)!
    assert.equal(row.height, density === 'comfortable' ? 2 : 1, `${density}: session row height`)
    const nextRow = setup.renderer.root.findDescendantById(`sidebar:${entries[3].key}`)!
    assert.equal(nextRow.y - row.y, density === 'comfortable' ? 3 : 1, `${density}: session spacing`)
    assert.equal(setup.renderer.root.findDescendantById('sidebar-new-session')!.height, 1, `${density}: button height`)
    assert.equal(setup.renderer.root.findDescendantById('sidebar-new-session')!.y, setup.renderer.root.findDescendantById('sidebar-tabs')!.y, `${density}: New shares the tabs row`)
    const group = setup.renderer.root.findDescendantById('sidebar:project:viewer')!
    const date = setup.renderer.root.findDescendantById('sidebar:date:today')!
    assert.equal(date.y - group.y, 1, `${density}: a date header sits right under its project`)
    const click = async (id: string) => {
      const node = setup.renderer.root.findDescendantById(id)!
      assert.ok(node, id)
      await act(async () => { await setup.mockMouse.click(node.x + 1, node.y + Math.floor(node.height / 2)) })
    }
    await click('sidebar-new-session')
    assert.equal(created, 1, 'Compose action opens session creation')
    await click('sidebar-project-scope')
    assert.equal(scopeChanged, 1)
    await click('sidebar:date:today')
    assert.equal(collapsed, 'date:today')
    await click(`sidebar:${entries[2].key}`)
    assert.equal(chosen, sessions[0].sessionId)
    if (setup.renderer.root.findDescendantById('sidebar-title-detail')) {
      await act(async () => { setup.mockInput.pressEscape(); await new Promise(resolve => setTimeout(resolve, 60)) }); await setup.flush()
      assert.ok(!setup.renderer.root.findDescendantById('sidebar-title-detail'), 'Escape dismisses the shared full-title preview')
    }
    const composeY = setup.renderer.root.findDescendantById('sidebar-new-session')!.y
    await act(async () => { scroll.current!.scrollTo(1000); await setup.flush() })
    assert.match(setup.captureCharFrame(), /Session 24/, 'Last session is reachable')
    assert.equal(setup.renderer.root.findDescendantById('sidebar-new-session')!.y, composeY, 'Compose stays fixed while the list scrolls')
    const offset = scroll.current!.scrollTop
    const frameNode = setup.renderer.root.findDescendantById('session-rail')
    await click('sidebar-tab:coordinator')
    assert.equal(scroll.current, null, 'Session content unmounts when Coordinator is selected')
    await click('sidebar-tab:sessions')
    assert.equal(setup.renderer.root.findDescendantById('session-rail'), frameNode, 'Tabs keep the same border frame')
    assert.equal(scroll.current!.scrollTop, offset, 'Returning to Sessions restores its scroll position')
    if (width === 44 && theme === DARK_THEME) console.log(`${density}: row height ${row.height}, spacing ${nextRow.y - row.y}`)
  } finally { await act(async () => { setup.renderer.destroy() }) }
}
console.log('Sidebar redesign: narrow/wide, dark/light, all three densities, creation, scope, folding, selection and scroll passed')
process.exit(0)

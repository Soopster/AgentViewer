import assert from 'node:assert/strict'
import { SPLIT_CHORD_HELP } from './splitPaneState'
import { WINDOW_MENU_CHORDS, windowMenuHint, focusAfterWindowClose, WINDOW_CONTROL_ACTIONS, WINDOW_MENU_ACTIONS, type WindowControlContext } from './windowControls'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describeSavedLayout, listSavedWindowLayouts, saveWindowLayout, updateWindowLayout, type WindowLayoutContents } from './windowLayoutStore'
import { SpacesController } from './spacesStore'
import { copySurfaceViewState, migratePanelViewState, surfaceViewNamespace } from './windowViewState'

const cwd = mkdtempSync(path.join(tmpdir(), 'av-window-audit-'))
process.chdir(cwd)
const contents: WindowLayoutContents = { arrangement: 'split', orientation: 'columns', readerLast: false, readerShare: 0, secondaryShare: 0, primaryOpen: false, reader: null, panes: [], surfaces: ['browser'], floating: { key: 'claude:session', slot: 1, rect: { x: 12, y: 3, width: 70, height: 20 } }, popoverTabs: ['files'], activePopoverTab: 'files' }
const saved = saveWindowLayout('project', contents, 'Kept views')
assert.deepEqual(listSavedWindowLayouts('project')[0]?.floating, contents.floating)
assert.ok(describeSavedLayout(saved).includes('3 windows'), 'counts actual views, including floating and strip tabs')
assert.ok(describeSavedLayout({ ...saved, surfaces: [], popoverTabs: [], floating: null }).includes('0 windows'), 'empty layouts have no phantom reader')
const file = path.join(cwd, '.agent-viewer-data/window-layouts.json')
for (const invalid of [{ weights: { split: [1, -2] } }, { weights: { split: ['large'] } }, { surfaceMeta: { browser: null } }, { surfaceMeta: { browser: { cwd: 42 } } }, { coordinatorRunId: [] }]) {
  const bytes = JSON.stringify({ version: 1, projects: { project: [{ ...saved, ...invalid }] } })
  writeFileSync(file, bytes)
  assert.deepEqual(listSavedWindowLayouts('project'), [], 'invalid saved metadata is skipped')
  assert.throws(() => saveWindowLayout('project', contents), /preserved/)
  assert.equal(readFileSync(file, 'utf8'), bytes, 'invalid metadata is preserved for recovery')
}
const damaged = JSON.stringify({ version: 1, projects: { project: [saved, { ...saved, id: 'bad', panes: null }], malformed: {} } })
writeFileSync(file, damaged)
assert.deepEqual(listSavedWindowLayouts('project'), [saved], 'bad neighbours do not hide valid layouts')
assert.deepEqual(listSavedWindowLayouts('malformed'), [], 'bad project collections do not crash the menu')
assert.throws(() => updateWindowLayout('project', saved.id, { name: 'No data loss' }), /preserved/)
assert.equal(readFileSync(file, 'utf8'), damaged, 'editing never overwrites unreadable saved layouts')
writeFileSync(file, '{broken')
assert.deepEqual(listSavedWindowLayouts('project'), [])
assert.throws(() => saveWindowLayout('project', contents), /preserved/)
assert.equal(readFileSync(file, 'utf8'), '{broken')
const controller = new SpacesController(cwd)
assert.equal(focusAfterWindowClose(2, 0, 4), 1, 'closing an earlier pane preserves the focused view')
assert.equal(focusAfterWindowClose(1, 3, 4), 1, 'closing a later pane preserves focus')
assert.equal(focusAfterWindowClose(2, 2, 4), 2, 'closing the focused pane selects its next neighbour')
assert.equal(focusAfterWindowClose(3, 3, 4), 2, 'closing the last pane selects its previous neighbour')
assert.equal(focusAfterWindowClose(null, 1, 4), null, 'closing a neighbour preserves primary focus')
assert.equal(focusAfterWindowClose(64, 1, 4), 64, 'closing a docked pane preserves floating focus')
const runtime = controller.runtime(controller.activeWorkspace()!)
const first = surfaceViewNamespace('browser', undefined, 'browser:1'), second = surfaceViewNamespace('browser', undefined, 'browser:2')
runtime.persistent.add(`${first}:browser:draft`)
runtime.set(`${first}:browser:draft`, 'first draft')
runtime.set(`${second}:browser:draft`, 'other draft')
const window = surfaceViewNamespace('browser', 'browser#2')
runtime.set(`${window}:stale`, 'old view')
copySurfaceViewState(runtime, first, window)
assert.equal(runtime.values.get(`${window}:browser:draft`), 'first draft')
assert.equal(runtime.persistent.has(`${window}:browser:draft`), true)
assert.equal(runtime.values.has(`${window}:stale`), false)
assert.equal(runtime.values.get(`${second}:browser:draft`), 'other draft')
runtime.set(`${window}:browser:draft`, 'edited after move')
copySurfaceViewState(runtime, window, first)
assert.equal(runtime.values.get(`${first}:browser:draft`), 'edited after move')
const legacy = surfaceViewNamespace('terminal')
runtime.set(`${legacy}:process:selectedId`, 'kept-shell')
runtime.restoredKeys.add(`${legacy}:process:selectedId`)
migratePanelViewState(runtime, [{ id: 't1', kind: 'terminal' }, { id: 't2', kind: 'terminal' }], 't2')
assert.equal(runtime.values.get(`${surfaceViewNamespace('terminal', undefined, 't2')}:process:selectedId`), 'kept-shell')
assert.equal(runtime.values.has(`${surfaceViewNamespace('terminal', undefined, 't1')}:process:selectedId`), false)
console.log('Windowing audit model smoke passed (floating persistence, view counts, corrupt-layout preservation, independent view state, migration)')

const { workspaceWindowOverview, subscribeWorkspaceOverview } = await import('./workspaceOverviewData')
const put = (key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
put('readerSession', { sessionId: 'session', provider: 'claude', summary: 'Session title' })
put('openTabSessions', [{ sessionId: 'session', provider: 'claude', summary: 'Session title' }])
put('workspaceHasSession', true); put('primaryWindowOpen', true); put('selectedSessionKey', 'claude:session')
put('windowOrder', ['surface:browser']); put('windowSurfaces', ['browser']); put('splitPinnedKeys', []); put('splitPaneCount', 0)
put('windowStacks', [['surface:browser', 'surface:files', 'claude:session']]); put('popoverTabs', ['diff']); put('activePopoverTab', 'diff')
put('floatingWindow', { key: 'surface:terminal#2' }); put('windowAttention', new Map([['surface:browser', { unread: true }]]))
runtime.set('windowOverviewWindows', [{ key: 'surface:ghost', title: 'Closed ghost', detail: 'window', hidden: false }, { key: 'surface:browser', title: 'Browser title', detail: 'window · hidden', hidden: false }])
let windows = workspaceWindowOverview(runtime)
assert.ok(!windows.some(window => window.key === 'surface:ghost'), 'cached metadata cannot resurrect a closed window')
assert.ok(windows.find(window => window.key === 'surface:browser')?.tabs?.find(tab => tab.key === 'claude:session')?.hidden, 'a session behind a tool tab is hidden within its frame')
assert.equal(windows.find(window => window.key === 'surface:diff')?.hidden, false)
assert.ok(windows.find(window => window.key === 'surface:diff')?.title.includes('Diff'), 'restored surfaces use the same titles as live windows')
assert.equal(windows.find(window => window.key === 'surface:browser')?.badge, '●')
assert.ok(windows.find(window => window.key === 'surface:browser')?.tabs?.find(tab => tab.key === 'surface:files')?.hidden)
assert.equal(windows.find(window => window.key === 'surface:browser')?.detail, 'window', 'hidden labels are not duplicated')
put('windowStacks', [['surface:browser', 'surface:files', 'surface:files', 'claude:deleted', 'surface:terminal#2', 'surface:diff', 'surface:unknown']])
windows = workspaceWindowOverview(runtime)
assert.deepEqual(windows.find(window => window.key === 'surface:browser')?.tabs?.map(tab => tab.key), ['surface:browser', 'surface:files'], 'overview excludes duplicate, missing, floating, strip-tab and unknown stack members')
put('windowZoom', 0)
windows = workspaceWindowOverview(runtime)
assert.equal(windows.find(window => window.key === 'surface:browser')?.hidden, false)
assert.equal(windows.find(window => window.key === 'surface:diff')?.hidden, true)
put('windowSurfaces', []); put('windowOrder', []); put('windowStacks', [])
assert.ok(!workspaceWindowOverview(runtime).some(window => window.key === 'surface:browser'))
await new Promise(resolve => setTimeout(resolve, 0))
let notifications = 0
const unsubscribe = subscribeWorkspaceOverview(controller, () => notifications++)
put('windowOrder', ['surface:files']); put('windowSurfaces', ['files']); put('windowZoom', null)
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(notifications, 1, 'overview batches an atomic multi-field layout change')
put('windowSurfaceMeta', { files: { path: 'README.md' } })
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(notifications, 2, 'overview observes restored surface metadata changes')
assert.ok(workspaceWindowOverview(runtime).find(window => window.key === 'surface:files')?.title.includes('README.md'))
unsubscribe(); put('windowAttention', new Map())
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(notifications, 2, 'closed overviews stop observing runtimes')
console.log('Window overview model passed (restored titles, hidden tools and sessions, cached membership, attention, batched subscriptions)')

// Which window-menu entries a window is offered, by the state it is in. The
// same table serves sessions, surfaces, popover tabs and the floating window,
// so a state that hides an entry hides it for every kind.
const offered = (context: Partial<WindowControlContext>) => WINDOW_MENU_ACTIONS.filter(id => {
  const action = WINDOW_CONTROL_ACTIONS.find(entry => entry.id === id)!
  return !action.available || action.available({ floating: false, tabbed: false, canTab: true, zoomed: false, others: true, ...context })
})
assert.deepEqual(WINDOW_MENU_ACTIONS.filter(id => !WINDOW_CONTROL_ACTIONS.some(entry => entry.id === id)), [], 'every menu entry is a control action')
assert.ok(['split-columns', 'split-rows', 'resize', 'swap', 'tab'].every(id => offered({}).includes(id as never)), 'a docked window is offered the layout entries')
assert.ok(['split-columns', 'split-rows', 'resize', 'swap'].every(id => !offered({ zoomed: true }).includes(id as never)), 'a zoomed window is offered nothing that needs the layout')
assert.ok(['split-columns', 'split-rows', 'resize', 'swap'].every(id => !offered({ floating: true }).includes(id as never)), 'a floating window is in no slot to split, resize or swap')
assert.ok(!offered({ canTab: false }).includes('tab') && !offered({}).includes('detach') && offered({ tabbed: true }).includes('detach'), 'tab and detach follow what there is to tab with or detach')
for (const always of ['focus', 'zoom', 'fullscreen', 'float', 'layout', 'close', 'move-workspace'] as const) {
  for (const context of [{}, { floating: true }, { zoomed: true }, { tabbed: true }]) assert.ok(offered(context).includes(always), `${always} is offered in every state`)
}
console.log('Window menu availability is one table for every window kind.')

// A menu entry's keyboard hint must name a chord that exists: it is the menu's
// way of teaching the keyboard, and a rebound key would otherwise mislead.
const chordTokens = new Set(SPLIT_CHORD_HELP.flatMap(section => section.entries.flatMap(entry => entry.keys.split(/\s·\s|\s…\s|\s/).filter(Boolean))))
for (const [id, chord] of Object.entries(WINDOW_MENU_CHORDS)) assert.ok(chordTokens.has(chord!), `${id} hints ⌃B ${chord}, which the chord table does not list`)
assert.equal(windowMenuHint('zoom'), '⌃B m')
assert.equal(windowMenuHint('manage'), '⌃K w', 'an entry without a chord keeps its own keys')
for (const id of WINDOW_MENU_ACTIONS) {
  const action = WINDOW_CONTROL_ACTIONS.find(entry => entry.id === id)!
  if (['split-columns', 'split-rows', 'zoom', 'float', 'tab', 'detach', 'layout', 'close'].includes(id)) assert.ok(windowMenuHint(id), `${action.label} has a keyboard hint in the menu`)
}
console.log('Window menu entries teach their ⌃B keys, and every hint names a real chord.')

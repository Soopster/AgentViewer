/** @jsxImportSource @opentui/react */
// Custom transcript views end to end, against the real root: a stored view is
// restored at boot (with fields the registry does not know dropped), the View
// Studio opens from the `v` menu, its changes draw on the live transcript, a
// save lands in tui.json and the menu, Esc discards with a confirm, and a
// delete takes two presses and falls back to the view's base.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import { normalizeCustomViews } from '../viewSpec'

const workdir = path.join(mkdtempSync(path.join(tmpdir(), 'agent-viewer-view-studio-')), 'studio')
mkdirSync(path.join(workdir, '.agent-viewer-data'), { recursive: true })
process.chdir(workdir)
const stateFile = path.join(workdir, '.agent-viewer-data', 'tui.json')
// A view saved by an earlier run, carrying a field and a value this build does not know.
writeFileSync(stateFile, JSON.stringify({
  transcriptView: 'stream',
  customViewId: 'view-9',
  customViews: [{ id: 'view-9', name: 'Seeded', base: 'stream', overrides: { markers: 'codex', bogus: 1, promptBand: 'nope' } }],
}))
assert.deepEqual(normalizeCustomViews(JSON.parse(readFileSync(stateFile, 'utf8')).customViews)[0]!.overrides, { promptMarker: '›', replyMarker: '•' },
  'unknown fields and values are dropped on read, and the old markers field becomes the prompt and reply glyphs')

const { buildThreadedMessages } = await import('../../lib/threading')
const { formatTranscriptCards } = await import('../format')
type SessionMessage = import('../../lib/types').SessionMessage
const session = { sessionId: 'studio', provider: 'claude' as const, cwd: workdir, summary: 'Studio', lastModified: 1_600_000_000_000 }
let n = 0
const message = (type: 'user' | 'assistant', content: unknown): SessionMessage => ({
  type, uuid: `studio-${n += 1}`, session_id: session.sessionId, parent_tool_use_id: null, timestamp: '2020-09-13T12:00:00.000Z',
  message: { role: type, content } as SessionMessage['message'],
})
const rawMessages = [
  message('user', 'Why does the pool respawn?'),
  message('assistant', 'Only cwd and thinking transitions respawn it.'),
  message('user', 'Thanks.'),
  message('assistant', 'Any time.'),
]
const threadedMessages = buildThreadedMessages(rawMessages)
const detail = { info: session, rawMessages, threadedMessages, transcriptCards: formatTranscriptCards(threadedMessages),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }

const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module: (name: string, factory: () => unknown) => void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => [session], readTuiSessionDetailAsync: async () => detail, warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'claude',
  readTuiSessions: async () => [session], readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App } = await import('./App')
const setup = await testRender(<App />, { width: 150, height: 44, kittyKeyboard: true })
const settle = async (ms = 250) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const frame = () => setup.captureCharFrame()
const fail = (message: string): never => { throw new Error(`${message}\n${frame()}`) }
const press = async (key: string) => {
  act(() => { setup.mockInput.pressKey(key) }); await settle(180)
  if (process.env.STUDIO_DEBUG && studioOpen()) console.log(`after ${key}:\n` + frame().split('\n').filter((row) => row.includes('▸') || row.includes('Why does')).join('\n'))
}
const pressEnter = async () => { act(() => { setup.mockInput.pressEnter() }); await settle(250) }
const pressEscape = async () => { act(() => { setup.mockInput.pressEscape() }); await settle(250) }
const promptRow = () => frame().split('\n').find((row) => row.includes('Why does the pool respawn?')) ?? ''
const stored = () => JSON.parse(readFileSync(stateFile, 'utf8')) as { customViews?: Array<{ id: string; name: string; overrides: Record<string, unknown> }>; customViewId?: string | null; transcriptView?: string }
const studioOpen = () => frame().includes('VIEW STUDIO')

try {
  await settle(2500)
  await pressEnter()
  if (!/› Why does the pool respawn\?/.test(promptRow())) fail('the stored custom view (codex markers) was not restored at boot')

  // ── the menu lists it, checked ──
  await press('v')
  if (!frame().includes('★ Seeded ✓')) fail('the v menu does not list the restored custom view as current')
  await pressEscape()

  // ── a new view from STREAM ──
  await press('v')
  // The menu opens on the current row (Seeded, after the 13 built-ins); STREAM is the fourth.
  for (let i = 0; i < 10; i += 1) { act(() => { setup.mockInput.pressArrow('up') }); await settle(120) }
  if (!frame().includes('STREAM') ) fail('the v menu does not list STREAM')
  await press('n')
  if (!studioOpen()) fail('n in the v menu did not open the View Studio')
  if (!frame().includes('Base  ‹')) fail('the studio shows no base')
  if (!frame().includes('STREAM copy')) fail('a view cloned from STREAM is not named after it')

  // Style → Prompt marker: cycle to › and watch the live transcript change.
  await press('3')
  await press('j')
  if (!/❯ Why does the pool respawn\?/.test(promptRow())) fail('a view from STREAM does not start with STREAM\'s markers')
  await press('l')
  if (!/› Why does the pool respawn\?/.test(promptRow())) fail('changing Markers did not change the live transcript')
  // Layout → Cursor: none (stored below; the built-in parity smoke covers how it draws).
  await press('1')
  await press('j')
  await press('l')
  if (!frame().includes('none (scroll)')) fail('Cursor did not cycle to none')

  // Rename and save.
  await press('r')
  for (let i = 0; i < 16; i += 1) { act(() => { setup.mockInput.pressBackspace() }); await settle(40) }
  for (const ch of 'Focus') await press(ch)
  await pressEnter()
  if (!frame().includes('Focus')) fail('the rename did not reach the name field')
  await press('s')
  if (studioOpen()) fail('s did not close the studio')
  await settle(400)
  {
    const state = stored()
    const focus = state.customViews?.find((view) => view.name === 'Focus')
    assert.ok(focus, `the saved view is in tui.json: ${JSON.stringify(state)}`)
    assert.equal(state.customViewId, focus.id, 'the saved view is the active one')
    assert.equal(focus.overrides.cursor, 'none')
    assert.equal(focus.overrides.promptMarker, '›', 'the prompt marker change is stored')
    assert.ok(!('bogus' in (state.customViews?.find((view) => view.id === 'view-9')?.overrides ?? {})), 'the unknown field is not written back')
  }
  await press('v')
  if (!frame().includes('★ Focus ✓')) fail('the saved view is not the checked row in the v menu')

  // ── edit, change, Esc asks, Esc again discards ──
  await press('e')
  if (!studioOpen() || !frame().includes('Focus')) fail('e on a custom row did not open it in the studio')
  await press('3')
  await press('j')
  await press('l')
  await pressEscape()
  if (!frame().includes('Discard changes?')) fail('Esc with unsaved changes did not ask first')
  await pressEscape()
  if (studioOpen()) fail('the second Esc did not discard')
  if (!/› Why does the pool respawn\?/.test(promptRow())) fail('discarding left the edited markers on screen')
  if (stored().customViews?.find((view) => view.name === 'Focus')?.overrides.promptMarker !== '›') fail('discarding changed the stored view')

  // ── delete takes two presses and falls back to the base ──
  await press('v')
  await press('e')
  await press('x')
  if (!frame().includes('x again deletes')) fail('the first x did not ask to confirm')
  await press('x')
  if (studioOpen()) fail('the second x did not delete')
  await settle(400)
  {
    const state = stored()
    assert.ok(!state.customViews?.some((view) => view.name === 'Focus'), 'the deleted view is gone from tui.json')
    assert.equal(state.customViewId, null, 'no custom view is active after deleting the active one')
    assert.equal(state.transcriptView, 'stream', 'the view falls back to its base')
  }
  if (!/❯ Why does the pool respawn\?/.test(promptRow())) fail('after the delete the transcript is not back on STREAM')

  // ── a built-in edited in place, then reset to its defaults ──
  await press('v')
  for (let i = 0; i < 12; i += 1) { act(() => { setup.mockInput.pressArrow('up') }); await settle(80) }
  for (let i = 0; i < 3; i += 1) { act(() => { setup.mockInput.pressArrow('down') }); await settle(80) }
  await press('e')
  if (!frame().includes('built-in view')) fail('e on STREAM did not open the built-in in the studio')
  await press('3')
  await press('j')
  await press('l')
  await press('s')
  await settle(400)
  if (!/› Why does the pool respawn\?/.test(promptRow())) fail('the edited STREAM does not draw its new markers')
  if ((stored() as { builtinViewEdits?: Record<string, Record<string, unknown>> }).builtinViewEdits?.stream?.promptMarker !== '›') fail('the STREAM edit is not stored')
  await press('v')
  if (!frame().includes('STREAM • ✓')) fail('the edited built-in is not marked in the v menu')
  await press('e')
  await press('x')
  if (!frame().includes('to its defaults?')) fail('x on a built-in did not offer to reset it')
  await press('x')
  await settle(400)
  if (!/❯ Why does the pool respawn\?/.test(promptRow())) fail('resetting STREAM did not bring its defaults back')
  if (Object.keys((stored() as { builtinViewEdits?: object }).builtinViewEdits ?? {}).length) fail('the reset left STREAM edits stored')

  // ── a Panels pin: this view hides the session rail ──
  await press('v')
  await press('c')
  // Composer: a square dock border; Layout: no scrollbar.
  const dockRow = () => frame().split('\n').find((row) => row.includes('To:')) ?? ''
  if (!dockRow().trimStart().startsWith('╭')) fail('the dock does not start rounded')
  await press('4')
  for (let i = 0; i < 5; i += 1) await press('j')
  await press('l')
  if (!/Dock border\s+‹ square ›/.test(frame())) fail('Dock border did not cycle to square')
  if (!dockRow().trimStart().startsWith('┌')) fail('a square dock border did not reach the dock')
  await press('1')
  for (let i = 0; i < 6; i += 1) await press('j')
  await press('l')
  await press('l')
  if (!/Scrollbar\s+‹ hidden ›/.test(frame())) fail('Scrollbar did not cycle to hidden')
  {
    const sb = setup.renderer.root.findDescendantById('transcript-scroll') as unknown as { verticalScrollBar: { visible: boolean } }
    if (sb.verticalScrollBar.visible) fail('a hidden scrollbar is still shown')
  }
  // Tabs: numbered, then the underline style.
  await press('5')
  for (let i = 0; i < 5; i += 1) await press('j')
  await press('l')
  if (!/Numbered tabs\s+‹ on ›/.test(frame())) fail('Numbered tabs did not cycle on')
  if (!/1 Studio/.test(frame())) fail('numbered tabs did not number the strip')
  for (let i = 0; i < 3; i += 1) await press('k')
  await press('l')
  if (!/Tab style\s+‹ underline ›/.test(frame())) fail('Tab style did not cycle to underline')
  if (!frame().includes('━━━')) fail('the underline style did not rule the active tab')
  await press('6')
  await press('l')
  await press('l')
  if (!/Session rail\s+‹ hidden ›/.test(frame())) fail('Session rail did not cycle to hidden')
  if (frame().includes('SESSIONS')) fail('pinning the rail hidden did not hide it')
  // Content → Show: my prompts only (STREAM starts at "no system rows").
  await press('2')
  await press('l')
  await press('l')
  if (!/Show\s+‹ my prompts only ›/.test(frame())) fail('Show did not cycle to prompts only')
  if (frame().includes('Only cwd and thinking')) fail('prompts only still draws replies')
  if (!frame().includes('Why does the pool respawn?')) fail('prompts only dropped the prompts')
  await pressEscape()
  await pressEscape()
  if (!frame().includes('SESSIONS')) fail('discarding the draft did not bring the rail back')

  // ── the mouse alone ──
  await press('v')
  await press('n')
  const at = (needle: string, last = false) => {
    const rows = frame().split('\n')
    const y = last ? rows.findLastIndex((row) => row.includes(needle)) : rows.findIndex((row) => row.includes(needle))
    if (y < 0) fail(`no "${needle}" on screen`)
    return { x: rows[y]!.indexOf(needle) + 1, y }
  }
  const click = async (needle: string, button = 0) => {
    const { x, y } = at(needle)
    await act(async () => { await setup.mockMouse.click(x, y, button as never) })
    await settle(200)
  }
  await click('Pins')
  if (!frame().includes('Density')) fail('clicking a section tab did not switch to it')
  await click('Density')
  if (!/Density\s+‹ comfortable ›/.test(frame())) fail('clicking a field did not cycle its value')
  await click('Density', 2)
  if (!/Density\s+‹ global ›/.test(frame())) fail('right-clicking a field did not cycle it back')
  await click(' esc ')
  if (studioOpen()) fail('the esc button did not close an unchanged new view')
} finally {
  await act(async () => setup.renderer.destroy())
}
console.log('View studio smoke passed: boot restore, unknown fields dropped, clone, live markers and cursor, rename, save, discard confirm, two-press delete, built-in edit and reset, square dock, hidden scrollbar, numbered and underlined tabs, rail pin, prompts-only filter, mouse')
process.exit(0)

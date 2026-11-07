/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React from 'react'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { EngineeringPreferences } from './engineering/model'
import { sessionKey } from './app/sessionList'
import { act, testRender } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-shared-sidebar-')))
delete process.env.AGENT_VIEWER_ATTACH
const sessions: Session[] = ['alpha', 'running', 'attention', 'remote', 'settled'].map((name, index) => ({
  sessionId: name, provider: 'claude', summary: `${name} session`, firstPrompt: `${name} session`,
  inbox: name === 'settled' ? { settledAt: Date.now() - 3600_000 } : undefined,
  cwd: name === 'remote' ? `${process.cwd()}-sibling` : process.cwd(), lastModified: Date.now() - (index + 1) * 3600_000,
}))
const running = [{ sessionId: 'running', provider: 'claude' as const, pendingPermissions: [], pendingQuestions: [], pendingPrompts: [] }]
const detail = { info: null, rawMessages: [], threadedMessages: [], transcriptCards: [], transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }
const bunTest = 'bun:test'
const { mock } = await import(bunTest) as { mock: { module: (name: string, factory: () => unknown) => void } }
const worker = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...worker, readTuiSessionsAsync: async () => sessions, readTuiSessionDetailAsync: async () => detail }))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiSessions: async () => sessions, readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running, waiting: [], attention: [{ id: 'attention', sessionId: 'attention', provider: 'claude', title: 'Needs a reply', createdAt: Date.now() }] }),
  listTuiRunningSessions: async () => running, prewarmTuiSession: async () => {},
}))
const spaces = await import('./spacesStore')
let controller: InstanceType<typeof spaces.SpacesController> | null = null
mock.module('./spacesStore', () => ({ ...spaces, SpacesController: class extends spaces.SpacesController { constructor() { super(); controller = this } } }))
const copied: string[] = []
const clipboard = await import('./app/clipboard')
mock.module('./app/clipboard', () => ({ ...clipboard, writeClipboard: async (text: string) => { copied.push(text) } }))
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 140, height: 40, kittyKeyboard: true })
const settle = async (ms = 100) => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, ms)); await setup.flush() }) }
const click = async (id: string) => {
  let node = setup.renderer.root.findDescendantById(id)
  if (!node && /(?:sidebar|engineering)-(scope|activity):/.test(id)) { await click(id.split(':')[0]!); node = setup.renderer.root.findDescendantById(id) }
  assert.ok(node, `Missing ${id}\n${setup.captureCharFrame()}`)
  await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
  await settle()
}
const row = (index: number) => setup.renderer.root.findDescendantById(`sidebar:session:${sessionKey(sessions[index]!)}`)
try {
  await settle(1600)
  const ctl = controller as unknown as InstanceType<typeof spaces.SpacesController>
  assert.ok(ctl)
  const runtime = ctl.runtime(ctl.activeWorkspace()!)
  const alphaKey = sessionKey(sessions[0]!)
  const prefs = () => runtime.get<EngineeringPreferences>('engineering:preferences', null as never, true)
  const view = async (name: string) => { await act(async () => { ctl.preferences.set('transcriptView', name) }); await settle(200) }
  for (const name of ['chat', 'conversation', 'full', 'continue', 'stream', 'agents', 'transcript', 'scrollback', 'codex', 'claude-code', 'copilot', 'opencode']) {
    await view(name)
    for (const id of ['sidebar-input:search', 'sidebar-scope', 'sidebar-activity']) assert.ok(setup.renderer.root.findDescendantById(id), `${name}: ${id}`)
  }
  await view('chat')
  await click('sidebar-scope:repo')
  assert.ok(row(0))
  assert.ok(!row(3), 'This repo excludes sibling paths')
  assert.ok(!row(4), 'Normal visibility hides settled sessions')
  await click('sidebar-activity:settled')
  assert.ok(row(4), 'Settled filter includes hidden settled sessions')
  assert.ok(!row(0)); assert.ok(!row(1)); assert.ok(!row(2))
  await click('sidebar-activity:all')
  assert.ok(!row(4), 'All sessions restores normal settled visibility')
  const menuFor = async (index: number) => {
    const target = row(index)!
    assert.ok(target)
    await act(async () => { await setup.mockMouse.click(target.x + 3, target.y, 2) })
    await settle()
    assert.ok(setup.renderer.root.findDescendantById('context-menu'), 'Session menu opens')
  }
  const menuChoose = async (label: string) => {
    const menu = setup.renderer.root.findDescendantById('context-menu')!
    const lines = setup.captureCharFrame().split('\n')
    const y = lines.findIndex((line, index) => index > menu.y && index < menu.y + menu.height && line.slice(menu.x, menu.x + menu.width).includes(label))
    assert.ok(y >= 0, `Menu action ${label}`)
    await act(async () => { await setup.mockMouse.click(menu.x + 2, y) })
    await settle()
  }
  await menuFor(2)
  for (const label of ['Pin session', 'Rename session', 'Settle session', 'Session goal', 'Change model', 'Fork session', 'Rewind conversation', 'Copy CLI resume command', 'Copy session ID', 'Copy transcript', 'Export transcript', 'Open transcript in pager', 'Session diagnostics']) assert.ok(setup.captureCharFrame().includes(label), `Menu includes ${label}`)
  await menuChoose('Pin session')
  const attentionKey = sessionKey(sessions[2]!)
  assert.ok(prefs().pinned.includes(attentionKey), 'Context pin acts on the clicked session')
  assert.ok(!prefs().pinned.includes(alphaKey), 'Context pin does not change the selected session')
  await menuFor(2)
  await menuChoose('Unpin session')
  assert.ok(!prefs().pinned.includes(attentionKey))
  await menuFor(2)
  await menuChoose('Copy session ID')
  assert.equal(copied.at(-1), sessions[2]!.sessionId, 'Copy uses the clicked session identity')
  await click(`sidebar-pin:${alphaKey}`)
  assert.ok(prefs().pinned.includes(alphaKey))
  assert.ok(setup.renderer.root.findDescendantById('sidebar:project:PINNED'), 'Pinned section is visible')
  const pin = setup.renderer.root.findDescendantById(`sidebar-pin:${alphaKey}`)!
  const pinLine = setup.captureCharFrame().split('\n')[pin.y]!
  assert.ok(pinLine.slice(pin.x, pin.x + 3).includes('−'), 'Pinned sessions show a minus action for unpin')
  await click('sidebar-activity:pinned')
  assert.ok(row(0)); assert.ok(!row(1)); assert.ok(!row(2))
  await click(`sidebar-pin:${alphaKey}`)
  assert.ok(!prefs().pinned.includes(alphaKey))
  assert.ok(!row(0), 'Unpin removes the row from the pinned filter immediately')
  await click('sidebar-activity:all')
  await click('sidebar-activity:running')
  assert.ok(row(1)); assert.ok(!row(0)); assert.ok(!row(2))
  await click('sidebar-activity:attention')
  assert.ok(row(2)); assert.ok(!row(0)); assert.ok(!row(1))
  await click('sidebar-activity:all')
  await click('sidebar-scope:all')
  assert.ok(row(3))
  await click('sidebar-input:search')
  await act(async () => { await setup.mockInput.pasteBracketedText('remote') })
  await settle(200)
  assert.ok(row(3)); assert.ok(!row(0))
  await act(async () => { setup.mockInput.pressEscape() })
  await settle()
  assert.ok(row(0), 'Escape clears inline search')
  await click(`sidebar-pin:${alphaKey}`)
  assert.ok(prefs().pinned.includes(alphaKey))
  await view('engineering')
  await click('engineering-activity:settled')
  assert.ok(setup.renderer.root.findDescendantById(`engineering-session:${sessionKey(sessions[4]!)}`), 'Engineering settled filter works')
  assert.ok(!setup.renderer.root.findDescendantById(`engineering-session:${alphaKey}`))
  await click('engineering-activity:all')
  await click('engineering-input:search')
  await act(async () => { await setup.mockInput.pasteBracketedText('alpha') })
  await settle()
  assert.ok(setup.renderer.root.findDescendantById(`engineering-session:${alphaKey}`), 'Engineering inline search keeps matching sessions')
  assert.ok(!setup.renderer.root.findDescendantById(`engineering-session:${sessionKey(sessions[3]!)}`))
  await act(async () => { setup.mockInput.pressKey('v') })
  await settle()
  assert.ok(!setup.renderer.root.findDescendantById('transcript-view-lightweight'), 'Typing into Engineering search does not trigger view shortcuts')
  await act(async () => { setup.mockInput.pressEscape() }); await settle()
  await act(async () => { runtime.set('engineering:preferences', { ...prefs(), query: '' }) }); await settle()
  assert.ok(setup.renderer.root.findDescendantById(`engineering-pin:${alphaKey}`), 'Pins carry into Engineering')
  await click(`engineering-pin:${alphaKey}`)
  assert.ok(!prefs().pinned.includes(alphaKey))
  await click(`engineering-pin:${alphaKey}`)
  await view('chat')
  assert.ok(setup.renderer.root.findDescendantById(`sidebar-pin:${alphaKey}`), 'Engineering pins carry back to Chat')
  await act(async () => { setup.resize(100, 24) }); await settle(200)
  await menuFor(0)
  const menu = setup.renderer.root.findDescendantById('context-menu')!
  assert.ok(menu.y >= 0 && menu.y + menu.height <= 24, 'Expanded menu stays inside a short terminal')
  for (let i = 0; i < 35; i++) await act(async () => { setup.mockInput.pressArrow('down') })
  await settle()
  assert.match(setup.captureCharFrame(), /Checkpoints/, 'Keyboard scroll reaches the final session action')
  await act(async () => { setup.mockInput.pressEscape() }); await settle()
  ctl.flush()
  const restored = new spaces.SpacesController(process.cwd())
  assert.ok(restored.runtime(restored.activeWorkspace()!).get<EngineeringPreferences>('engineering:preferences', null as never, true).pinned.includes(alphaKey), 'Pins survive disk round trip')
  console.log('Shared sidebar controls, all session views, pin/unpin icon, contextual actions, short menus, groups, scope, activity/settled, inline search, cross-view pins and persistence passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)

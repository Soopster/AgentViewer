/** @jsxImportSource @opentui/react */
// The Run dashboard in the terminal: the Web's dashboard plugin, now drawn by
// the TUI over the same session-fleet service. The view orders runs that need
// you first, filters, and opens a run through the fleet; ⌃K r opens it in the
// real App.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import type { Session } from '../../lib/types'

const workspace = await mkdtemp(path.join(tmpdir(), 'tui-run-dashboard-'))
process.chdir(workspace)
for (const dir of ['claude-home', 'codex-home']) await mkdir(path.join(workspace, dir))
process.env.CLAUDE_CONFIG_DIR = path.join(workspace, 'claude-home')
process.env.CODEX_HOME = path.join(workspace, 'codex-home')

const { module, runStatus } = await import('../../plugins/run-dashboard/tui')
const { sessionIdentityKey } = await import('./shell/sdk')
const now = Date.now()
const session = (id: string, minutesAgo: number, cwd = '/work/alpha'): Session => ({ sessionId: id, provider: 'claude', summary: `run ${id}`, cwd, lastModified: now - minutesAgo * 60_000 } as Session)
const sessions = [session('old', 3 * 1440), session('busy', 1), session('blocked', 30, '/work/beta'), session('fresh', 10)]
const activity = new Map([[sessionIdentityKey(sessions[1]!), 'running' as const], [sessionIdentityKey(sessions[2]!), 'needs-input' as const]])
assert.equal(runStatus(undefined, now - 3 * 86_400_000, now), 'paused')
assert.equal(runStatus(undefined, now - 60_000, now), 'recent')
assert.equal(runStatus('needs-input', 0, now), 'needs-you')

const opened: string[] = []
let keys: ((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => unknown) | null = null
const View = module.views['run-dashboard']!
const view = await testRender(<View pluginId="run-dashboard" surfaceId="run-dashboard" instanceId="r" placement="overlay" target={{ sessionKey: null, cwd: null }} theme={DARK_THEME} accent={DARK_THEME.cyan} syntaxStyle={null} width={130} height={30} focused zIndex={60}
  services={{ 'session-fleet': { sessions, activity, alerts: [{ key: 'a1', sessionKey: sessionIdentityKey(sessions[3]!), provider: 'claude', sessionTitle: 'run fresh', title: 'failed' }], selected: null, selectedCards: null, selectedContext: null, selectedModel: null, selectedMessageCount: null, open: (s: Session) => { opened.push(s.sessionId) }, openAlert: () => false } as never }}
  useState={((name: string, initial: unknown) => React.useState(initial)) as never} onDispose={() => () => {}} registerKeys={(handler) => { keys = handler as never }} setCapture={() => {}} runCommand={() => false} close={() => {}} />, { width: 130, height: 30 })
const settle = async (s = view) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) }); await act(async () => { await s.flush() }) }
const press = async (name: string, sequence = name) => { await act(async () => { keys?.({ name, sequence, ctrl: false, shift: false }) }); await settle() }
try {
  await settle()
  const lines = view.captureCharFrame().split('\n').filter(line => line.includes('run '))
  assert.deepEqual(lines.map(line => /run (\w+)/.exec(line)![1]), ['blocked', 'busy', 'fresh', 'old'], `runs that need you first, then live, then by last movement:\n${view.captureCharFrame()}`)
  assert.match(lines[0]!, /needs you/)
  assert.match(lines[2]!, /!1/, 'a run with an alert says so')
  assert.match(view.captureCharFrame(), /4 runs\s+·\s+1 active\s+·\s+1 need you/)
  await press('f')
  assert.deepEqual(view.captureCharFrame().split('\n').filter(line => line.includes('run ')).map(line => /run (\w+)/.exec(line)![1]), ['blocked', 'busy'], 'the live filter keeps running and blocked runs')
  await press('j')
  await press('return', '\r')
  assert.deepEqual(opened, ['busy'], 'Enter opens the selected run through the fleet')
  console.log('View: runs needing you lead, alerts show, the filter narrows, and Enter opens the run.')
} finally {
  act(() => view.renderer.destroy())
}

const { default: OpenTuiApp } = await import('./App')
const app = await testRender(<OpenTuiApp />, { width: 140, height: 40, kittyKeyboard: true })
try {
  await settle(app)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 2500)) })
  if (app.captureCharFrame().includes('New workspace')) { await act(async () => { app.mockInput.pressEnter() }); await settle(app) }
  await act(async () => { app.mockInput.pressKey('k', { ctrl: true }) })
  await settle(app)
  await act(async () => { app.mockInput.pressKey('r') })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !app.renderer.root.findDescendantById('run-dashboard')) await settle(app)
  assert(app.renderer.root.findDescendantById('run-dashboard'), `⌃K r did not open the run dashboard:\n${app.captureCharFrame()}`)
  assert.match(app.captureCharFrame(), /No sessions in scope|\d+ runs/)
  console.log('App: ⌃K r opens the run dashboard.')
} finally {
  act(() => app.renderer.destroy())
}
console.log('Run dashboard TUI smoke passed')
process.exit(0)

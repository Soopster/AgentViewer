/** @jsxImportSource @opentui/react */
// Provenance and remote access in the TUI. Remote access runs in the real App
// (palette → view) against a stand-in daemon speaking /api/remote-access;
// provenance renders its plugin view over a real index seeded with a session
// that wrote a file, blames the file, and opens the session at the edit.
import React from 'react'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import type { SessionMessage } from '../../lib/types'

const workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'tui-prov-remote-')))
process.chdir(workspace)
// Hermetic: no real sessions (a live one in the reader changes what has focus).
await mkdir(path.join(workspace, 'claude-home'), { recursive: true })
await mkdir(path.join(workspace, 'codex-home'), { recursive: true })
process.env.CLAUDE_CONFIG_DIR = path.join(workspace, 'claude-home')
process.env.CODEX_HOME = path.join(workspace, 'codex-home')

// ── A stand-in daemon ─────────────────────────────────────────────────────
let state = { enabled: false, pairing: null as null | { id: string; token: string; scope: string; expiresAt: string }, sessions: [{ id: 'dev-1', label: 'Pixel phone', scope: 'full', createdAt: '2026-11-01T00:00:00Z', lastSeenAt: null, userAgent: null }], port: 3917, endpoints: [{ id: 'lan', kind: 'lan', host: '192.168.1.20', source: 'en0', https: false, label: 'LAN' }], defaultId: 'lan' }
const server = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    if (request.method === 'POST') {
      const input = JSON.parse(body || '{}')
      if (input.action === 'enable' || input.action === 'pair') state = { ...state, enabled: true, pairing: { id: 'p1', token: 'TOKEN-123', scope: input.scope ?? 'full', expiresAt: new Date(Date.now() + 600_000).toISOString() } }
      if (input.action === 'disable') state = { ...state, enabled: false, pairing: null }
      if (input.action === 'revoke') state = { ...state, sessions: state.sessions.filter(device => device.id !== input.sessionId) }
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(state))
  })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
process.env.AGENT_VIEWER_DAEMON_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 150, height: 44, kittyKeyboard: true })
const settle = async (ms = 200) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) }); await act(async () => { await setup.flush() }) }
const screen = () => setup.captureCharFrame()
const waitFor = async (what: string, predicate: () => boolean, s = setup) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !predicate()) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) }); await act(async () => { await s.flush() }) }
  assert(predicate(), `${what}:\n${s.captureCharFrame()}`)
}
try {
  await settle(2500)
  if (screen().includes('New workspace')) { await act(async () => { setup.mockInput.pressEnter() }); await settle(500) }
  // Open the palette. (Not Esc first: on an idle app Esc asks whether to quit.)
  for (let attempt = 0; attempt < 5 && !screen().includes('type to filter'); attempt++) {
    await act(async () => { setup.mockInput.pressKey('?') })
    await settle(400)
  }
  await waitFor('the palette opens', () => screen().includes('type to filter'))
  await act(async () => { await setup.mockInput.typeText('Remote access') })
  await settle(300)
  await act(async () => { setup.mockInput.pressEnter() })
  await settle(800)
  await waitFor('the remote access view opens off', () => screen().includes('Remote access is off') && screen().includes('Pixel phone'))
  await act(async () => { await setup.mockInput.typeText('e') })
  await waitFor('e turns it on with a scannable code', () => screen().includes('TOKEN-123') && screen().includes('192.168.1.20:3917/pair#token=') && /[█▀▄]{6}/.test(screen()))
  await act(async () => { await setup.mockInput.typeText('x') })
  await waitFor('x revokes the selected device', () => screen().includes('PAIRED DEVICES · 0') && !screen().includes('Pixel phone'))
  console.log('Remote access: the TUI view turns pairing on, draws a QR code and URL, and revokes a device, against the daemon.')
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(300)
} finally {
  act(() => setup.renderer.destroy())
  server.close()
}

// ── Provenance over a real index ──────────────────────────────────────────
const repo = path.join(workspace, 'repo')
await mkdir(path.join(repo, 'src'), { recursive: true })
await writeFile(path.join(repo, 'src', 'login.ts'), 'export const login = true\nexport const user = null\n')
const { syncPersistedSessions, syncPersistedSessionMessages } = await import('../../lib/sessionPersistence')
const now = Date.now()
const message = (uuid: string, type: 'user' | 'assistant', content: unknown): SessionMessage => ({ type, uuid, session_id: 'sess-p', parent_tool_use_id: null, timestamp: new Date(now - 30_000).toISOString(), message: { role: type, content } as SessionMessage['message'] })
await syncPersistedSessions([{ sessionId: 'sess-p', provider: 'claude', cwd: repo, summary: 'Login work', lastModified: now }])
await syncPersistedSessionMessages('claude', 'sess-p', [
  message('u1', 'user', 'add a login module'),
  message('a1', 'assistant', [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: path.join(repo, 'src', 'login.ts'), content: 'export const login = true\nexport const user = null\n' } }]),
  message('u2', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'File created' }]),
])
const { module } = await import('../../plugins/provenance/tui')
const { tuiProvenance } = await import('./shell/provenanceService')
const opened: string[] = []
let keys: ((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => unknown) | null = null
const Provenance = module.views.provenance!
const view = await testRender(<Provenance pluginId="provenance" surfaceId="provenance" instanceId="p" placement="overlay" target={{ sessionKey: null, cwd: repo }} theme={DARK_THEME} accent={DARK_THEME.cyan} syntaxStyle={null} width={130} height={30} focused zIndex={60}
  services={{ provenance: tuiProvenance, session: { session: { sessionId: 'sess-p', provider: 'claude', cwd: repo } as never }, 'session-navigation': { open: (session, uuid) => { opened.push(`${session.sessionId}:${uuid}`) } } }}
  useState={((name: string, initial: unknown) => React.useState(initial)) as never} onDispose={() => () => {}} registerKeys={(handler) => { keys = handler as never }} setCapture={() => {}} runCommand={() => false} close={() => {}} />, { width: 130, height: 30 })
try {
  await waitFor('the session\'s files list', () => view.captureCharFrame().includes('src/login.ts') && view.captureCharFrame().includes('2/2 lines'), view)
  await act(async () => { keys?.({ name: 'return', sequence: '\r', ctrl: false, shift: false }) })
  await waitFor('Enter blames the file', () => view.captureCharFrame().includes('2/2 lines from agent sessions') && view.captureCharFrame().includes('L1-2'), view)
  await act(async () => { keys?.({ name: 'return', sequence: '\r', ctrl: false, shift: false }) })
  assert.deepEqual(opened, ['sess-p:a1'], 'Enter on a run did not open the session at its edit')
  console.log('Provenance: the TUI view lists what a session wrote, blames a file, and opens the session at the edit.')
} finally {
  act(() => view.renderer.destroy())
}
console.log('Provenance and remote access TUI smoke passed')
process.exit(0)

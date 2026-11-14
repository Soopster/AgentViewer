/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module, widgets } from '../../plugins/proof/tui'
import { nativeProof } from '../../lib/proof/service'
import { modAppStore, EMPTY_MOD_APP } from '../../lib/plugins/modApp'
import type { TuiPluginViewProps, TuiPluginKeyHandler } from './shell/pluginTypes'
const exec = promisify(execFile), temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'proof-tui-'))), cwd = path.join(temp, 'repo')
process.env.AGENT_VIEWER_PROOF_DIR = path.join(temp, 'data')
await mkdir(cwd); await exec('git', ['init', '-q', cwd]); await writeFile(path.join(cwd, 'source.txt'), 'initial'); await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { extra: 'echo extra' } }))
const check = { id: 'failure', label: 'Focused failure', executable: process.execPath, args: ['-e', 'for(let i=0;i<20;i++)console.log("line-"+i);process.exit(2)'], cwd: '.', timeoutMs: 5000 }
const config = await nativeProof.configure(cwd, [check], '0')
let handler: TuiPluginKeyHandler | null = null, focused = true, draft = 'existing draft'
const identity = { provider: 'codex' as const, providerInstanceId: 'personal', sessionId: 'proof-session' }
modAppStore.publish({ ...EMPTY_MOD_APP, renderer: 'tui', instanceId: 'tui-proof', cwd, selectedKey: 'source', sessions: [{ key: 'source', title: 'Proof', cwd, activity: 'idle', target: identity }] })
const View = module.views.proof!, Widget = widgets.widgets.status!
const services = { proof: nativeProof, repository: { cwd, sessionId: identity.sessionId }, session: { session: { ...identity, cwd } as never }, composer: { appendDiffNote: () => {}, insertText: (text: string) => { draft += '\n' + text } } }
const props = (): TuiPluginViewProps => ({ pluginId: 'proof', surfaceId: 'proof', instanceId: 'proof-smoke', placement: 'panel', target: { cwd, sessionKey: 'source' }, services, theme: DARK_THEME, accent: DARK_THEME.cyan, syntaxStyle: null, width: 110, height: 36, focused, zIndex: 50, useState: ((_name: string, initial: unknown) => React.useState(initial)) as never, onDispose: () => () => {}, registerKeys: value => { handler = value }, setCapture: () => {}, runCommand: () => false, close: () => {} })
let update: ((value: { focused: boolean; widget: boolean }) => void) | null = null
function Harness() {
  const [view, setView] = React.useState({ focused: true, widget: false }); update = setView
  return view.widget ? <Widget services={services} theme={DARK_THEME} width={110} height={36} slot="corner" /> : <View {...props()} focused={view.focused} />
}
const setup = await testRender(<Harness />, { width: 110, height: 36 })
async function waitFor(label: string, predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); await setup.flush() }); if (predicate()) return }
  throw new Error(`${label}\n${setup.captureCharFrame()}`)
}
async function key(sequence: string, name = sequence) { await act(async () => { handler?.({ name, sequence, ctrl: false, shift: false }) }) }
try {
  await waitFor('configured check renders', () => setup.captureCharFrame().includes('Focused failure'))
  assert.equal((await nativeProof.read(cwd)).runs.length, 0)
  await key(' ', 'space'); await key('r')
  await waitFor('receipt renders', () => setup.captureCharFrame().includes('failed · current'))
  await waitFor('output renders', () => setup.captureCharFrame().includes('line-11'))
  assert(!setup.captureCharFrame().includes('line-19'))
  await key('a'); await waitFor('expanded output', () => setup.captureCharFrame().includes('line-19'))
  await key('f'); assert(draft.startsWith('existing draft\nFix this verification failure'))
  await writeFile(path.join(cwd, 'source.txt'), 'edited'); await key('g')
  await waitFor('stale receipt', () => setup.captureCharFrame().includes('failed · stale'))
  await key('s'); await waitFor('script picker', () => setup.captureCharFrame().includes('Choose scripts'))
  await key(' ', 'space'); await key('', 'return')
  await waitFor('script saved', () => setup.captureCharFrame().includes('[ ] extra'))
  assert.equal((await nativeProof.read(cwd)).runs.length, 1, 'configuration must not launch checks')
  focused = false; await act(async () => { (update as NonNullable<typeof update>)({ focused: false, widget: false }) })
  assert.equal((handler as TuiPluginKeyHandler | null)?.({ name: 'r', sequence: 'r', ctrl: false, shift: false }), false)
  assert.equal((await nativeProof.read(cwd)).runs.length, 1)
  await act(async () => { (update as NonNullable<typeof update>)({ focused: false, widget: true }) })
  await waitFor('status widget', () => setup.captureCharFrame().includes('Proof · failed'))
  console.log('Proof OpenTUI: PASS (real native worker, manual run, receipts, expansion, draft preservation, freshness, focus gating, widget)')
} finally { await act(async () => setup.renderer.destroy()); await rm(temp, { recursive: true, force: true }) }
process.exit(0)

/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/instructions-manager/tui'
import { createInstructionsManager } from '../../lib/instructions-manager/service'
import { createPluginStateStore, useScopedPluginState } from '../../lib/plugins/scopedState'
import type { TuiPluginKeyHandler, TuiPluginViewProps } from './shell/pluginTypes'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'instructions-tui-'))), cwd = path.join(temp, 'repo'), home = path.join(temp, 'home')
await mkdir(path.join(cwd, '.git'), { recursive: true }); await mkdir(home)
await writeFile(path.join(cwd, 'AGENTS.md'), '# Terminal guidance\n\nKeep accounts explicit.\n')
await writeFile(path.join(cwd, 'CLAUDE.md'), '# Previous Claude instructions\n')
const service = createInstructionsManager(async () => ({ home, environment: {}, instances: [], dataDir: path.join(temp, 'manager') }))
const store = createPluginStateStore(), View = module.views['instructions-manager']!
const useFixtureState: TuiPluginViewProps['useState'] = (name, initial) => useScopedPluginState(store, 'instructions-manager', 'fixture', name, initial)
let handler: TuiPluginKeyHandler | null = null, update: ((value: { focused: boolean; width: number; height: number }) => void) | undefined
function Harness() {
  const [state, setState] = React.useState({ focused: true, width: 130, height: 38 }); update = setState
  return <View pluginId="instructions-manager" surfaceId="instructions-manager" instanceId="fixture" placement="panel" target={{ cwd, sessionKey: null }} services={{ 'instructions-manager': service, repository: { cwd, sessionId: null } }} theme={DARK_THEME} accent={DARK_THEME.cyan} syntaxStyle={null} {...state} zIndex={50} useState={useFixtureState} onDispose={() => () => {}} registerKeys={value => { handler = value }} setCapture={() => {}} runCommand={() => false} close={() => {}} />
}
const setup = await testRender(<Harness />, { width: 130, height: 38 })
async function waitFor(label: string, test: () => boolean | Promise<boolean>) { for (let i = 0; i < 100; i++) { let ok = false; await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush(); ok = await test() }); if (ok) return } throw new Error(`${label}\n${setup.captureCharFrame()}`) }
async function key(name: string, ctrl = false) { await act(async () => { handler?.({ name, sequence: name, ctrl, shift: false }); await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush() }) }
async function click(label: string) { const rows = setup.captureCharFrame().split('\n'), y = rows.findIndex(row => row.includes(label)); assert(y >= 0, `Missing ${label}\n${rows.join('\n')}`); await act(async () => { await setup.mockMouse.click(rows[y].indexOf(label) + 1, y); await setup.flush() }) }
try {
  await waitFor('rich reader', () => setup.captureCharFrame().includes('Terminal guidance'))
  await key('v'); await waitFor('raw reader', () => setup.captureCharFrame().includes('# Terminal guidance'))
  await key('?'); await waitFor('help layer', () => setup.captureCharFrame().includes('Edit and copy'))
  const selected = store.get('instructions-manager', 'fixture', 'file', '')
  await key('j'); await key('e'); await key('escape'); assert.equal(store.get('instructions-manager', 'fixture', 'file', ''), selected)
  await key('e'); await waitFor('editor', () => setup.captureCharFrame().includes('Ctrl+S preview save'))
  await act(async () => { await setup.mockInput.typeText('Additional guidance. '); await setup.flush() })
  await key('s', true); await waitFor('save preview', () => setup.captureCharFrame().includes('[preview]') && setup.captureCharFrame().includes('Additional guidance'))
  await key('a'); assert(!(await readFile(path.join(cwd, 'AGENTS.md'), 'utf8')).includes('Additional guidance'))
  await key('space'); await click('Apply reviewed change')
  await waitFor('saved', async () => (await readFile(path.join(cwd, 'AGENTS.md'), 'utf8')).includes('Additional guidance'))
  await waitFor('backup history', () => setup.captureCharFrame().includes('Backup:'))
  await click('copy'); await key('j'); await key('j')
  assert(String(store.get('instructions-manager', 'fixture', 'destination', '')).endsWith('CLAUDE.md'))
  await key('p'); await waitFor('copy preview', () => setup.captureCharFrame().includes('replace · copy'))
  await key('space'); await key('a'); await waitFor('copied', async () => (await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8')).includes('Additional guidance'))
  assert.equal(await readFile(path.join(cwd, 'AGENTS.md'), 'utf8'), await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8'))
  await act(async () => update?.({ focused: false, width: 130, height: 38 }))
  assert.equal((handler as TuiPluginKeyHandler | null)?.({ name: 'e', sequence: 'e', ctrl: false, shift: false }), false)
  await act(async () => { setup.resize(60, 23); update?.({ focused: true, width: 60, height: 23 }) })
  await key('escape'); await waitFor('narrow files', () => setup.captureCharFrame().includes('Files · / search'))
  await key('return'); await waitFor('narrow details', () => setup.captureCharFrame().includes('[history]'))
  console.log('Instructions Manager OpenTUI: PASS (rich/raw reader, modal help, typed editing, save preview/replacement gate, filesystem backups/copy, mouse actions, focus gating, narrow navigation)')
} finally { await act(async () => setup.renderer.destroy()); await rm(temp, { recursive: true, force: true }) }
process.exit(0)

/** @jsxImportSource @opentui/react */
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { useKeyboard } from '@opentui/react'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { modViewSurfaces } from '../../plugins/mod-views/tui'
import { installTuiLocalPlugins } from './shell/localPlugins'
import { localPluginDiscovery } from '../../lib/plugins/localPlugins'
import { getThemePalette } from '../theme'
import { testRender, act } from './testRender'
import type { TuiPluginViewProps, TuiPluginCapture } from './shell/pluginTypes'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-portable-tui-'))
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'plugins')
const dir = path.join(process.env.AGENT_VIEWER_PLUGINS_DIR, 'portable'); mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'portable', title: 'Portable', config: { greeting: { type: 'string', title: 'Greeting', default: 'Hello' }, enabled: { type: 'boolean', title: 'Enabled', default: false }, retries: { type: 'number', title: 'Retries', default: 2, min: 0, max: 5 } }, views: [{ id: 'board', title: 'Board' }] }))
// The import marker proves settings do not load executable mod code.
const marker = path.join(temp, 'imported')
writeFileSync(path.join(dir, 'server.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'yes'); export const views={board:()=>({title:'Portable board',blocks:[{type:'progress',label:'Build',value:1,max:2},{type:'table',columns:['Job','Status'],rows:[['build','running']]},{type:'code',text:'npm run build'}]})}`)
installTuiLocalPlugins()
const manifest = localPluginDiscovery().plugins[0]!.manifest
const surfaces = modViewSurfaces(manifest).views
const Config = surfaces['portable.mod-config']!, Board = surfaces['portable.board']!
let openBoard: (() => void) | undefined
let keys: Parameters<TuiPluginViewProps['registerKeys']>[0], capture: TuiPluginCapture = false
function Fixture() {
  const [board, setBoard] = useState(false)
  openBoard = () => setBoard(true)
  useKeyboard(key => { if (keys?.(key)) key.preventDefault() })
  const props = { pluginId: 'portable', surfaceId: 'portable.mod-config', instanceId: 'fixture', placement: 'window', target: { sessionKey: null, cwd: null }, services: {}, syntaxStyle: null, zIndex: 1, runCommand: () => false, theme: getThemePalette('dark'), accent: '#00ffff', width: 100, height: 30, focused: true, useState: <T,>(_name: string, initial: T) => useState(initial), onDispose: () => () => {}, close() {}, registerKeys: handler => { keys = handler }, setCapture: value => { capture = value } } as TuiPluginViewProps
  return board ? <Board {...props} /> : <Config {...props} />
}
const setup = await testRender(<Fixture />, { width: 100, height: 30, kittyKeyboard: true })
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await setup.flush() }) }
const waitFor = async (predicate: () => boolean) => { for (let i = 0; i < 40 && !predicate(); i++) await settle(); assert(predicate(), setup.captureCharFrame()) }
const key = async (name: string) => { await act(async () => { if (name === 'return') setup.mockInput.pressEnter(); else if (name === 'escape') setup.mockInput.pressEscape(); else if (name === 'down' || name === 'right') setup.mockInput.pressArrow(name); else setup.mockInput.pressKey(name) }); await settle() }
const configFile = path.join(temp, 'mod-settings', 'portable.json')
try {
  await waitFor(() => setup.captureCharFrame().includes('Greeting'))
  assert(!existsSync(marker), 'settings must not import mod code')
  await key('return'); assert.equal(capture, 'input')
  await act(async () => { await setup.mockInput.typeText('qrjk') }); await settle()
  assert(setup.captureCharFrame().includes('qrjk'), 'navigation letters must remain input text')
  await key('escape'); assert.equal(capture, false)
  await key('return')
  await act(async () => { for (let i = 0; i < 5; i++) setup.mockInput.pressBackspace(); await setup.mockInput.typeText('Terminal') }); await settle()
  await key('return')
  await waitFor(() => setup.captureCharFrame().includes('Greeting saved'))
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).greeting, 'Terminal')
  await key('down'); await key('right'); await key('return')
  await waitFor(() => setup.captureCharFrame().includes('Enabled saved'))
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).enabled, true)
  await key('down'); await key('return')
  await act(async () => { setup.mockInput.pressBackspace(); await setup.mockInput.typeText('99') }); await settle()
  await key('return')
  await waitFor(() => setup.captureCharFrame().includes('Invalid config value'))
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).retries, undefined)
  await act(async () => { openBoard?.() })
  await waitFor(() => setup.captureCharFrame().includes('npm run build'))
  assert.match(setup.captureCharFrame(), /50%/)
  assert.match(setup.captureCharFrame(), /running/)
  assert(existsSync(marker))
  console.log('OpenTUI portable mods: PASS (real input events, capture, q/r/j/k typing, cancel, config save, select apply, invalid-value preservation, table/progress/code; settings avoid server import)')
} finally { act(() => setup.renderer.destroy()); rmSync(temp, { recursive: true, force: true }) }
process.exit(0)

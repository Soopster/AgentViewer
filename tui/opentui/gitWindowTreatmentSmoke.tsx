/** @jsxImportSource @opentui/react */
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import type { BoxRenderable, InputRenderable, TextareaRenderable } from '@opentui/core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../lib/git/command'
import { WindowButton } from './WindowButton'
import { PluginSurfaceHost } from './shell/PluginSurfaceHost'
import { getPluginSurface } from '../../lib/plugins/catalog'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'

const cwd = await mkdtemp(join(tmpdir(), 'git-window-treatment-'))
let focusWindow: (focused: boolean) => void = () => {}
let resize: (size: { width: number; height: number }) => void = () => {}
let coverWindow: (cover: boolean) => void = () => {}
let detach = 0
let controls = 0
function Harness({ overlay = false }: { overlay?: boolean }) {
  const [focused, setFocused] = useState(true), [size, setSize] = useState({ width: 120, height: 32 }), [cover, setCover] = useState(false)
  focusWindow = setFocused; resize = setSize; coverWindow = setCover
  const surface = <PluginSurfaceHost surfaceId="diff" placement={overlay ? 'overlay' : 'window'} cwd={cwd} theme={DARK_THEME} width={overlay ? 160 : size.width} height={overlay ? 50 : size.height} focused={focused} onClose={() => {}} onDetach={() => { detach++ }} onKeyHandlerReady={() => {}} />
  return <box width={160} height={50} flexDirection="column">
    <box height={4} flexShrink={0}><text>App title and tabs</text></box>
    {overlay ? surface : <box id="shared-window" position="absolute" top={5} left={8} width={size.width + 2} height={size.height + 2} border borderColor={DARK_THEME.border2} title=" Git window " zIndex={40}>
      {surface}
    </box>}
    {!overlay ? <box position="absolute" top={5} left={100} width={16} height={1} zIndex={46}><WindowButton id="shared-window-control" label="WINDOW CONTROLS" theme={DARK_THEME} onPress={() => { controls++ }} /></box> : null}
    {cover ? <box position="absolute" left={10} top={8} width={110} height={8} zIndex={45} backgroundColor={DARK_THEME.surface3}><text>OTHER WINDOW ABOVE GIT</text></box> : null}
    <box position="absolute" bottom={0} left={0} width={160} height={3}><text>COMPOSER DOCK</text></box>
  </box>
}
try {
  await git(cwd, ['init', '-q']); await writeFile(join(cwd, 'sample.txt'), 'sample\n')
  const surface = getPluginSurface('diff')
  assert.deepEqual(surface.placements, ['overlay', 'window', 'panel']); assert.equal(surface.keys, 'window'); assert.equal(surface.fullScreen, true)
  for (const overlay of [true, false]) {
    const setup = await testRender(<Harness overlay={overlay} />, { width: 160, height: 50 })
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); await setup.flush() }); await setup.flush() }
    const node = (id: string) => setup.renderer.root.findDescendantById(id)
    const wait = async (id: string) => { for (let i = 0; i < 40 && !node(id); i++) await settle(); assert(node(id), `${id} missing:\n${setup.captureCharFrame()}`); return node(id)! }
    const click = async (id: string) => { const target = await wait(id); await act(async () => { await setup.mockMouse.click(target.x, target.y) }); await settle() }
    try {
      const frame = await wait('git-browser-frame') as BoxRenderable
      if (overlay) {
        const button = await wait('popover-detach')
        assert(setup.captureCharFrame().includes('⧉ window'), 'modal detach button is painted on its title border')
        assert.equal(button.y, frame.y, 'detach button sits on modal title border')
        await click('popover-detach'); assert.equal(detach, 1, 'shared placement callback receives detach click')
      } else {
        assert.equal(frame.x, 9); assert.equal(frame.y, 6)
        assert.equal(frame.width, 120); assert.equal(frame.height, 32)
        assert.equal(frame.zIndex, 0, 'docked content inherits window stacking')
        assert.equal(Boolean(frame.border), false, 'window owns the only outer frame')
        assert(!node('popover-detach'), 'docked view does not duplicate the window placement control')
        assert(setup.captureCharFrame().includes('WINDOW CONTROLS'), `host window controls remain visible:\n${setup.captureCharFrame()}`)
        await click('shared-window-control'); assert.equal(controls, 1, 'shared window controls remain clickable')
        await act(async () => coverWindow(true)); await settle()
        assert(setup.captureCharFrame().includes('OTHER WINDOW ABOVE GIT'), 'higher windows cover Git content normally')
        await act(async () => coverWindow(false)); await settle()
        await click('git-sidebar-filter')
        assert((node('git-sidebar-filter-input') as InputRenderable).focused, 'focused window owns its active filter')
        await act(async () => focusWindow(false)); await settle()
        assert(!(node('git-sidebar-filter-input') as InputRenderable).focused, 'background window releases native input focus')
        await act(async () => focusWindow(true)); await settle()
        assert((node('git-sidebar-filter-input') as InputRenderable).focused, 'refocusing restores the active filter')
        // Clicking Commit dismisses the sidebar editor and opens the native commit editor.
        const lines = setup.captureCharFrame().split('\n'), tabRow = lines.findIndex(line => line.includes('Commit') && line.includes('File Tree'))
        await act(async () => { await setup.mockMouse.click(lines[tabRow]!.indexOf('Commit') + 1, tabRow) }); await settle()
        const editor = await wait('git-workspace-message') as TextareaRenderable
        assert(editor.focused)
        await act(async () => focusWindow(false)); await settle(); assert(!editor.focused, 'background commit composer cannot steal focus')
        await act(async () => focusWindow(true)); await settle(); assert(editor.focused)
        for (const size of [{ width: 70, height: 18 }, { width: 12, height: 6 }, { width: 120, height: 32 }]) {
          await act(async () => resize(size)); await settle()
          const current = await wait('git-browser-frame')
          assert.equal(current.width, size.width); assert.equal(current.height, size.height)
          assert(current.x + current.width <= 160 && current.y + current.height < 47, 'resized view stays inside window area above composer')
        }
        assert(setup.captureCharFrame().includes('COMPOSER DOCK'), 'window operations retain the composer dock')
      }
    } finally { act(() => setup.renderer.destroy()) }
  }
  console.log('Git window treatment passed: real plugin overlay/window host, detach, inherited chrome/stacking, focus transfer, resize bounds and composer retention.')
} finally { await rm(cwd, { recursive: true, force: true }) }

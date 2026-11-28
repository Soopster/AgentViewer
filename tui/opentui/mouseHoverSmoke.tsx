/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { parseColor } from '@opentui/core'
import { useState } from 'react'
import { SidebarSessionRow } from './app/SidebarTitlePreview'
import { useMouseHover } from './mouseHover'
import { act, testRender } from './testRender'

const surface = '#202020'
const cursor = '#404040'
const ink = '#eeeeee'
const overlayFill = '#266060'
let clicked = ''
let toggleOverlay: () => void = () => {}

function Fixture() {
  useMouseHover(ink)
  const [overlay, setOverlay] = useState(false)
  const [custom, setCustom] = useState(false)
  toggleOverlay = () => setOverlay(show => !show)
  return <box width={40} height={12} backgroundColor={surface}>
    <SidebarSessionRow id="sidebar:alpha" preview={{ key: 'alpha', title: 'Alpha', width: 30 }} selected
      height={2} width={30} backgroundColor={cursor} onMouseDown={() => { clicked = 'alpha' }}>
      <text fg={ink} selectable={false}>▎ Alpha</text>
      <text fg={ink} selectable={false}>  Metadata</text>
      <box position="absolute" right={0} top={0} width={4} height={1}
        onMouseDown={event => { event.stopPropagation(); clicked = 'pin' }}>
        <text fg={ink}> Pin </text>
      </box>
    </SidebarSessionRow>
    <box width={30} height={1} onMouseUp={() => { clicked = 'bravo' }}><text fg={ink}>Bravo</text></box>
    <box width={30} height={1}><text fg={ink}>Plain content</text></box>
    <box width={30} height={1} backgroundColor={custom ? overlayFill : surface}
      onMouseOver={() => setCustom(true)} onMouseOut={() => setCustom(false)} onMouseDown={() => { clicked = 'custom' }}>
      <text fg={ink}>Custom</text>
    </box>
    <select width={30} height={3} options={[{ name: 'First', description: '' }, { name: 'Second', description: '' }]}
      selectedIndex={0} backgroundColor={surface} selectedBackgroundColor={cursor} showDescription={false} />
    <input width={20} placeholder="Search" backgroundColor={surface} />
    <box height={2} width={30} overflow="hidden">
      <box width={30} height={1}><text fg={ink}>Viewport heading</text></box>
      <box id="sidebar:clipped" width={30} height={2} flexShrink={0} backgroundColor={surface}
        onMouseDown={() => { clicked = 'clipped' }}><text fg={ink}>Clipped row</text></box>
    </box>
    {overlay ? <box position="absolute" zIndex={20} top={0} left={8} width={15} height={3} backgroundColor={overlayFill}>
      <text>Overlay</text>
    </box> : null}
  </box>
}

const setup = await testRender(<Fixture />, { width: 40, height: 12 })
const at = (x: number, y: number) => {
  let column = 0
  for (const span of setup.captureSpans().lines[y].spans) {
    column += span.width
    if (x < column) return span
  }
  throw new Error(`Missing cell ${x},${y}`)
}
const move = async (x: number, y: number) => {
  await act(async () => { await setup.mockMouse.moveTo(x, y) })
  await setup.flush()
}
try {
  await setup.flush()
  await move(4, 0)
  assert.notDeepEqual(at(4, 0).bg, parseColor(cursor), 'hover tints the session title')
  assert.deepEqual(at(4, 0).fg, parseColor(ink), 'hover preserves foreground')
  assert.deepEqual(at(4, 1).bg, at(4, 0).bg, 'hover includes the metadata row')
  assert.equal(clicked, '', 'hover does not activate a session')
  await act(async () => toggleOverlay())
  await setup.flush()
  assert.deepEqual(at(10, 0).bg, parseColor(overlayFill), 'hover is clipped out of a covering overlay')
  await act(async () => toggleOverlay())
  await move(27, 0)
  assert.deepEqual(at(4, 0).bg, parseColor(cursor), 'nested actions take over from the parent hover')
  assert.notDeepEqual(at(27, 0).bg, parseColor(cursor), 'the nested action is highlighted')
  await act(async () => { await setup.mockMouse.click(27, 0) })
  assert.equal(clicked, 'pin')
  await move(2, 2)
  assert.notDeepEqual(at(2, 2).bg, parseColor(surface), 'release-only actions get hover feedback')
  await move(2, 3)
  assert.deepEqual(at(2, 2).bg, parseColor(surface))
  assert.deepEqual(at(2, 3).bg, parseColor(surface), 'static content does not get action feedback')
  await move(2, 4)
  assert.deepEqual(at(2, 4).bg, parseColor(overlayFill), 'existing hover paint takes precedence')
  await move(4, 6)
  assert.deepEqual(at(4, 5).bg, parseColor(cursor), 'hover preserves the keyboard selection')
  assert.notDeepEqual(at(4, 6).bg, parseColor(surface), 'only the hovered picker option is tinted')
  assert.deepEqual(at(4, 7).bg, parseColor(surface), 'unused picker rows do not highlight')
  await move(4, 8)
  assert.notDeepEqual(at(4, 8).bg, parseColor(surface), 'inputs have hover feedback')
  await move(4, 9)
  assert.deepEqual(at(4, 8).bg, parseColor(surface), 'leaving clears the hover')
  await move(4, 10)
  assert.notDeepEqual(at(4, 10).bg, parseColor(surface), 'the visible part of a clipped row hovers')
  assert.deepEqual(at(4, 11).bg, parseColor(surface), 'hover stays inside the viewport')
} finally {
  await act(async () => setup.renderer.destroy())
}
console.log('TUI hover passed: session rows, nested actions, overlays, existing hover, native select and input')
process.exit(0)

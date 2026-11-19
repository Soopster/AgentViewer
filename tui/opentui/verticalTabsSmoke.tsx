/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import { LIGHT_THEME } from '../theme'
import { VerticalTabs, verticalTabRailWidth } from './VerticalTabs'
import { tabStripName } from './tabStrip'
import { testRender, act } from './testRender'

assert.equal(verticalTabRailWidth(70, true), 0)
assert.equal(verticalTabRailWidth(120, false), 0)
assert.equal(verticalTabRailWidth(120, true), 30)
const closed: number[] = []
let horizontal = false
const running = new Set(['tab:19'])
function Fixture() {
  const [active, setActive] = useState(19)
  const [options, setOptions] = useState(() => Array.from({ length: 20 }, (_, index) => ({
    name: tabStripName(`Session ${index}`, 32), value: `tab:${index}`, description: '',
  })))
  return <VerticalTabs options={options} activeIndex={active} running={running} width={28} height={8} theme={LIGHT_THEME}
    onHorizontal={() => { horizontal = true }}
    onClose={index => { closed.push(index); setOptions(values => values.filter((_, at) => at !== index)); setActive(Math.max(index - 1, 0)) }}
    onPress={(index, event) => { if (event.button === 0) setActive(index) }}
    onDrag={() => {}} onRelease={() => {}} />
}
const setup = await testRender(<Fixture />, { width: 30, height: 10 })
const rect = (id: string) => setup.renderer.root.findDescendantById(id) as BoxRenderable
try {
  await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 30)); await setup.flush() })
  // The selected item at the end of a long list is automatically revealed.
  for (let attempt = 0; attempt < 30 && !setup.captureCharFrame().includes('Session 19'); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); await setup.flush() })
  }
  assert.ok(setup.captureCharFrame().includes('Session 19'), 'active tab scrolls into view')
  const close = rect('vertical-tab-close:19')
  assert.ok(close.y >= 1 && close.y < 8, 'close target is inside the viewport')
  await act(async () => { await setup.mockMouse.click(close.x + 1, close.y) })
  assert.deepEqual(closed, [19], 'close button targets the correct tab')
  assert.ok(!setup.captureCharFrame().includes('Session 19'), 'closed tab disappears')
  assert.ok(setup.captureCharFrame().includes('Session 18'), 'next selected tab stays visible')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); await setup.flush() })
  await act(async () => {
    const list = setup.renderer.root.findDescendantById('vertical-tabs-scroll') as ScrollBoxRenderable
    list.scrollTo(0)
    await new Promise(resolve => setTimeout(resolve, 180))
  })
  assert.ok(setup.captureCharFrame().includes('Session 0'), 'animation does not pull manual scrolling back to the active tab')
  const button = rect('vertical-tabs-horizontal')
  await act(async () => { await setup.mockMouse.click(button.x + 1, button.y) })
  assert.ok(horizontal, 'orientation button works')
  console.log('Vertical tabs passed: overflow scrolling, active visibility, close targets, orientation control, narrow fallback')
} finally {
  await act(async () => setup.renderer.destroy())
}
process.exit(0)

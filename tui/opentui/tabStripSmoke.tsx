/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { parseColor, type BoxRenderable, type TabSelectRenderable } from '@opentui/core'
import { SessionTabConnection, tabConnectionGeometry } from './SessionTabConnection'
import { act, testRender } from './testRender'
import { tabStripActivity, tabStripName, tabStripWidth } from './tabStrip'

for (const paneWidth of [100, 160, 170, 200]) {
  const stripWidth = tabStripWidth(paneWidth)
  const tabWidth = Math.max(10, Math.min(Math.floor(stripWidth / 4), 40))
  assert.ok(tabConnectionGeometry(
    { x: 1, y: 0, width: stripWidth, height: 1 },
    { x: 0, y: 1, width: paneWidth, height: 30 },
    3, 0, tabWidth,
  ), `last tab connects without covering controls at pane width ${paneWidth}`)
}

for (const count of [4, 7]) for (const tabWidth of [40, 24, 10]) {
  const width = tabWidth * 4 + 4
  const labels = ['Assess TUI and rendering changes', 'Hi', 'Improve tab bar rendering', 'Feature plugin host migration']
  const options = Array.from({ length: count }, (_, i) => ({
    name: i === count - 1 ? tabStripActivity(tabStripName(labels[i % labels.length], tabWidth), tabWidth, '●') : tabStripName(labels[i % labels.length], tabWidth),
    description: '',
  }))
  let tabs: TabSelectRenderable | null = null
  const setup = await testRender(<box flexDirection="column">
    <box height={1} paddingX={1} overflow="hidden">
      <tab-select ref={value => { tabs = value }} options={options} width={width - 2} tabWidth={tabWidth} showDescription={false} showUnderline={false} />
    </box>
    <text>Transcript border</text>
  </box>, { width, height: 6 })
  try {
    await act(async () => { tabs!.setSelectedIndex(count - 1) })
    await setup.flush()
    const rows = setup.captureCharFrame().split('\n')
    assert.equal(rows[0][1 + 3 * tabWidth + tabWidth - 2], '×', `last tab close button remains at its hit target at width ${width}`)
    assert.equal((rows[0].match(/×/g) ?? []).length, 4, 'every tab retains its close button')
    assert.ok(rows[1].includes('Transcript border'), 'tab content stays on its own row')
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}
for (const selected of [0, 1]) {
  const tabs = createRef<TabSelectRenderable>()
  const frame = createRef<BoxRenderable>()
  const options = ['Alpha', 'Bravo'].map((label, index) => ({ name: tabStripName(label, 24), value: `tab:${index}`, description: '' }))
  const setup = await testRender(<box flexDirection="column" width={100}>
    <box height={2} paddingTop={1} paddingX={1} backgroundColor="#101010">
      <tab-select ref={tabs} options={options} width={76} height={1} tabWidth={24}
        backgroundColor="#101010" focusedBackgroundColor="#101010" textColor="#aaaaaa"
        selectedBackgroundColor="#202020" selectedTextColor="#00aaff"
        showDescription={false} showUnderline={false} />
    </box>
    <box ref={frame} width={100} height={4} border borderStyle="rounded" borderColor="#00aaff" backgroundColor="#202020" />
    <SessionTabConnection tabs={tabs} readWindow={() => frame.current} ownerKey={`tab:${selected}`} enabled
      foreground="#00aaff" background="#202020" inactiveForeground="#555555" inactiveBackground="#101010" />
  </box>, { width: 100, height: 6 })
  try {
    await act(async () => { tabs.current!.setSelectedIndex(selected); tabs.current!.focus() })
    await setup.flush()
    const rows = setup.captureCharFrame().split('\n')
    const spans = setup.captureSpans()
    const cell = (x: number, y: number) => {
      let column = 0
      for (const span of spans.lines[y].spans) {
        if (x < column + span.width) return span
        column += span.width
      }
      throw new Error(`Missing cell ${x},${y}`)
    }
    for (const index of [0, 1]) {
      const left = 1 + index * 24
      assert.equal(rows[0].slice(left, left + 24), `╭${'─'.repeat(22)}╮`)
      assert.equal(rows[1][left], '│')
      assert.equal(rows[1][left + 23], '│')
      assert.equal(rows[2][left], index === selected ? '╯' : '─', 'only the active tab opens into the window')
      assert.deepEqual(cell(left, 0).fg, parseColor(index === selected ? '#00aaff' : '#555555'), 'inactive outlines stay muted')
    }
    assert.deepEqual(cell(60, 1).bg, parseColor('#101010'), 'focused tabs leave empty strip space at the base background')
    assert.deepEqual(cell(2 + (1 - selected) * 24, 1).bg, parseColor('#101010'), 'inactive labels use the strip background')
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}
console.log('Tab strip passed: inactive outlines and colors, active window join, close targets, scrolling and row bounds')
process.exit(0)

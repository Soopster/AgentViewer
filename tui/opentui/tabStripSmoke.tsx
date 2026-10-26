/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import type { TabSelectRenderable } from '@opentui/core'
import { tabConnectionGeometry } from './SessionTabConnection'
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
console.log('Connected tab strip preserves close target, scrolling and row bounds at wide, medium, and narrow widths')
process.exit(0)

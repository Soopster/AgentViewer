/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { parseColor, type BoxRenderable, type TabSelectRenderable } from '@opentui/core'
import { SessionTabConnection, noteTabStripHover, registerTabPaintOccluder, tabConnectionGeometry } from './SessionTabConnection'
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
    // The selected (last) tab is the closable one, and carries the activity cell.
    name: i === count - 1 ? tabStripActivity(tabStripName(labels[i % labels.length], tabWidth), tabWidth, '●') : tabStripName(labels[i % labels.length], tabWidth, '', false),
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
    assert.equal((rows[0].match(/×/g) ?? []).length, 1, 'only the selected tab draws a close button')
    assert.ok(!tabStripName('A long inactive tab title', tabWidth, '', false).includes('×'), 'inactive names have no ×')
    assert.equal(tabStripName('Hi', tabWidth, '', false).length, tabWidth - 2, 'inactive names fill the label width')
    assert.ok(rows[1].includes('Transcript border'), 'tab content stays on its own row')
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}
for (const selected of [0, 1, 2]) {
  const tabs = createRef<TabSelectRenderable>()
  const frame = createRef<BoxRenderable>()
  const options = ['Alpha', 'Bravo', 'Charlie'].map((label, index) => ({ name: tabStripName(label, 24, '', index === selected), value: `tab:${index}`, description: '' }))
  const setup = await testRender(<box flexDirection="column" width={100}>
    <box height={2} paddingTop={1} paddingRight={1} backgroundColor="#101010">
      <tab-select ref={tabs} options={options} width={76} height={1} tabWidth={24}
        backgroundColor="#101010" focusedBackgroundColor="#101010" textColor="#aaaaaa"
        selectedBackgroundColor="#202020" selectedTextColor="#00aaff"
        showDescription={false} showUnderline={false}
        onMouseMove={(event) => noteTabStripHover(tabs.current, event.x)} onMouseOut={() => noteTabStripHover(tabs.current, null)} />
    </box>
    <box ref={frame} width={100} height={4} border borderStyle="rounded" borderColor="#00aaff" backgroundColor="#202020" />
    <SessionTabConnection tabs={tabs} readWindow={() => frame.current} ownerKey={`tab:${selected}`} enabled
      foreground="#00aaff" background="#202020" inactiveForeground="#555555" inactiveBackground="#101010"
      hoverForeground="#eeeeee" hoverBackground="#181818" />
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
    for (const index of [0, 1, 2]) {
      const left = index * 24, active = index === selected
      // Chrome's strip: only the selected tab is raised and outlined.
      assert.equal(rows[0].slice(left, left + 24), active ? `╭${'─'.repeat(22)}╮` : ' '.repeat(24), 'only the active tab has a cap')
      assert.equal(rows[1].slice(left, left + 24).includes('×'), active, 'only the active tab is closable')
      if (active) {
        assert.equal(rows[1][left], '│')
        assert.equal(rows[1][left + 23], '│')
        // Tab 0 is flush with the frame: its side meets the corner, never a ╭╯ hook.
        assert.equal(rows[2][left], left === 0 ? '│' : '╯', 'the active tab opens into the window')
        assert.equal(rows[2][left + 23], '╰')
        assert.deepEqual(cell(left, 0).fg, parseColor('#00aaff'))
      } else {
        assert.equal(rows[2].slice(left + 1, left + 23), '─'.repeat(22), 'inactive tabs sit on a plain border')
        assert.notEqual(rows[1][left], '│', 'an inactive tab has no left side')
        // A separator between two inactive tabs; none beside the active one or after the last.
        const separated = index < 2 && index + 1 !== selected
        assert.equal(rows[1][left + 23], separated ? '│' : ' ', `separator after tab ${index}`)
        if (separated) assert.deepEqual(cell(left + 23, 1).fg, parseColor('#555555'), 'separators are muted')
      }
    }
    assert.ok(!rows[2].includes('╭╯'), 'no doubled corner at the frame edge')
    if (selected === 0) {
      // Hovering an inactive tab lifts both strip rows a shade and drops the separator beside it.
      await act(async () => { await setup.mockMouse.moveTo(50, 1) })
      await setup.flush()
      const hoverRows = setup.captureCharFrame().split('\n')
      const hoverSpans = setup.captureSpans()
      const bgAt = (x: number, y: number) => {
        let column = 0
        for (const span of hoverSpans.lines[y].spans) { if (x < column + span.width) return span.bg; column += span.width }
        throw new Error(`Missing cell ${x},${y}`)
      }
      for (const [x, y] of [[49, 1], [50, 1], [70, 1]]) assert.deepEqual(bgAt(x, y), parseColor('#181818'), `hovered tab cell ${x},${y}`)
      assert.equal(hoverRows[1][48] + hoverRows[1][71], '▐▌', 'the pill has rounded ends')
      assert.deepEqual(bgAt(48, 0), parseColor('#101010'), 'the pill keeps to the label row')
      assert.ok(hoverRows[1].slice(48, 72).includes('Charlie'), 'the hovered tab keeps its label')
      assert.equal(hoverRows[1][47], ' ', 'no separator beside the hovered tab')
      assert.deepEqual(bgAt(30, 1), parseColor('#101010'), 'other inactive tabs stay flat')
      await act(async () => { await setup.mockMouse.moveTo(74, 1) })
      await setup.flush()
      assert.equal(setup.captureCharFrame().split('\n')[1][47], '│', 'leaving the tabs restores the separator')
      await act(async () => { await setup.mockMouse.moveTo(2, 1) })
      await setup.flush()
      assert.equal(setup.captureCharFrame().split('\n')[0].slice(0, 24), `╭${'─'.repeat(22)}╮`, 'hovering the active tab changes nothing')
    }
    if (selected === 1) {
      // A panel floating over the strip (the View Studio) keeps its cells: the
      // outline pass runs after the frame and would otherwise draw through it.
      const unregister = registerTabPaintOccluder(() => ({ x: 30, y: 0, width: 40, height: 4 }))
      await act(async () => { tabs.current!.requestRender() })
      await setup.flush()
      const covered = setup.captureCharFrame().split('\n')
      assert.equal(covered[0].slice(30, 47), ' '.repeat(17), 'the cap is not drawn over the panel')
      assert.equal(covered[2][24], '╯', 'the outline still draws beside the panel')
      unregister()
    }
    assert.deepEqual(cell(74, 1).bg, parseColor('#101010'), 'focused tabs leave empty strip space at the base background')
    assert.deepEqual(cell(1 + ((selected + 1) % 3) * 24, 1).bg, parseColor('#101010'), 'inactive labels use the strip background')
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}
console.log('Tab strip passed: Chrome-style raised active tab, inactive separators, hover lift, flush-left join, active-only close, scrolling and row bounds')
process.exit(0)

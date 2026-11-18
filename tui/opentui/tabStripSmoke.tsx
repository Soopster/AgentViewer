/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { parseColor, type BoxRenderable, type TabSelectRenderable } from '@opentui/core'
import { SessionTabConnection, noteTabStripHover, registerTabPaintOccluder, tabConnectionGeometry } from './SessionTabConnection'
import { act, testRender } from './testRender'
import { fitTextMiddle, tabStripActivity, tabStripName, tabStripWidth } from './tabStrip'

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
      for (const [x, y] of [[48, 1], [49, 1], [50, 1], [70, 1], [71, 1]]) assert.deepEqual(bgAt(x, y), parseColor('#181818'), `hovered tab cell ${x},${y}`)
      assert.ok(!hoverRows[1].includes('▐') && !hoverRows[1].includes('▌'), 'the tint is flat, with no half-block caps')
      assert.deepEqual(bgAt(48, 0), parseColor('#101010'), 'the tint keeps to the label row')
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
// The view's tab styles, on the middle tab.
for (const tabStyle of ['underline', 'pills', 'boxed', 'minimal', 'windows'] as const) {
  const tabs = createRef<TabSelectRenderable>()
  const frame = createRef<BoxRenderable>()
  const options = ['Alpha', 'Bravo', 'Charlie'].map((label, index) => ({ name: tabStripName(label, 24, '', index === 1), value: `tab:${index}`, description: '' }))
  const setup = await testRender(<box flexDirection="column" width={100}>
    <box height={2} paddingTop={1} paddingRight={1} backgroundColor="#101010">
      <tab-select ref={tabs} options={options} width={76} height={1} tabWidth={24}
        backgroundColor="#101010" focusedBackgroundColor="#101010" textColor="#aaaaaa"
        selectedBackgroundColor="#101010" selectedTextColor="#00aaff" showDescription={false} showUnderline={false} />
    </box>
    <box ref={frame} width={100} height={4} border borderStyle="rounded" borderColor="#00aaff" backgroundColor="#202020" />
    <SessionTabConnection tabs={tabs} readWindow={() => frame.current} ownerKey="tab:1" enabled
      foreground="#00aaff" background="#202020" inactiveForeground="#555555" inactiveBackground="#101010"
      hoverForeground="#eeeeee" hoverBackground="#181818" pillForeground="#ffffff" pillBackground="#225577"
      windowsBackground="#334455" windowsInactiveBackground="#151515" inactiveLabel="#aaaaaa" tabStyle={tabStyle} separators />
  </box>, { width: 100, height: 6 })
  try {
    await act(async () => { tabs.current!.setSelectedIndex(1); tabs.current!.focus() })
    await setup.flush()
    const rows = setup.captureCharFrame().split('\n')
    const spans = setup.captureSpans()
    const bgAt = (x: number, y: number) => { let column = 0; for (const span of spans.lines[y].spans) { if (x < column + span.width) return span.bg; column += span.width } return null }
    if (tabStyle === 'underline') {
      assert.equal(rows[0].trim(), '', 'underline raises no tab')
      assert.equal(rows[2].slice(24, 48), '━'.repeat(24), 'underline rules the border under the active tab')
    } else if (tabStyle === 'pills') {
      assert.equal(rows[1][24] + rows[1][47], '▐▌', 'the active pill has rounded ends')
      assert.deepEqual(bgAt(30, 1), parseColor('#225577'), 'the pill is filled')
      assert.equal(rows[0].trim(), '', 'pills raise no tab')
    } else if (tabStyle === 'boxed') {
      assert.equal(rows[0].slice(0, 24), `╭${'─'.repeat(22)}╮`, 'an inactive tab is outlined too')
      assert.equal(rows[0].slice(24, 48), `╭${'─'.repeat(22)}╮`, 'the active tab is outlined')
      assert.equal(rows[2][23], '┴', 'an inactive tab stands on the border')
    } else if (tabStyle === 'windows') {
      // Windows Terminal: the active tab is the window's colour, one row, no outline, opening into the window.
      assert.equal(rows[0].slice(24, 48), `╭${'─'.repeat(22)}╮`, 'an accent edge tops the active tab')
      assert.deepEqual(spans.lines[0].spans.find((span) => span.text.includes('─'))?.fg, parseColor('#00aaff'), 'in the accent')
      assert.equal(rows[1][24] + rows[1][47], '││', 'the edge turns down into the sides')
      assert.deepEqual(bgAt(25, 1), parseColor('#334455'), 'the active tab is filled')
      assert.deepEqual(bgAt(24, 1), parseColor('#334455'), 'its sides on the fill')
      assert.ok(rows[1].includes('Bravo'), 'the filled tab keeps its label')
      assert.equal(rows[2].slice(24, 48), `╯${' '.repeat(22)}╰`, 'the border turns down inside the tab\'s own columns, under the edge\'s ends')
      assert.equal(rows[2][23] + rows[2][48], '──', 'nothing turns outside the tab')
      assert.deepEqual(bgAt(2, 1), parseColor('#151515'), 'an inactive tab is a faint block')
      assert.deepEqual(bgAt(22, 1), parseColor('#151515'))
      assert.deepEqual(bgAt(23, 1), parseColor('#101010'), 'its last cell is a strip-coloured gap')
      assert.ok(rows[1].includes('Alpha') && rows[1].includes('Charlie'), 'inactive labels survive the fill')
      const fgAt = (x: number, y: number) => { let column = 0; for (const span of spans.lines[y].spans) { if (x < column + span.width) return span.fg; column += span.width } return null }
      assert.deepEqual(fgAt(1, 1), parseColor('#aaaaaa'), 'inactive labels keep the strip\'s text colour, not the border\'s')
      assert.equal(rows[0].slice(0, 24).trim() + rows[0].slice(48).trim(), '', 'only the active tab is outlined')
      assert.equal(rows[1][23] + rows[1][48], '  ', 'no separators')
    } else {
      assert.equal(rows[0].trim(), '', 'minimal draws no outline')
      assert.ok(!rows[2].slice(24, 48).includes('━') && !rows[1].includes('▐'), 'minimal draws no marks')
    }
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}
// Hover styles and provider initials, hovering the last tab with the first selected.
for (const hover of ['raise', 'underline', 'pill', 'text', 'accent', 'none'] as const) {
  const tabs = createRef<TabSelectRenderable>()
  const frame = createRef<BoxRenderable>()
  const options = ['C Alpha', 'X Bravo', 'O Charlie'].map((label, index) => ({ name: tabStripName(label, 24, '', index === 0), value: `tab:${index}`, description: '' }))
  const setup = await testRender(<box flexDirection="column" width={100}>
    <box height={2} paddingTop={1} paddingRight={1} backgroundColor="#101010">
      <tab-select ref={tabs} options={options} width={76} height={1} tabWidth={24}
        backgroundColor="#101010" focusedBackgroundColor="#101010" textColor="#aaaaaa"
        selectedBackgroundColor="#202020" selectedTextColor="#00aaff" showDescription={false} showUnderline={false}
        onMouseMove={(event) => noteTabStripHover(tabs.current, event.x)} />
    </box>
    <box ref={frame} width={100} height={4} border borderStyle="rounded" borderColor="#00aaff" backgroundColor="#202020" />
    <SessionTabConnection tabs={tabs} readWindow={() => frame.current} ownerKey="tab:0" enabled
      foreground="#00aaff" background="#202020" inactiveForeground="#555555" inactiveBackground="#101010"
      hoverForeground="#eeeeee" hoverBackground="#181818" hover={hover}
      initialColors={new Map([['tab:1', '#ff8800'], ['tab:2', '#00ff88']])} />
  </box>, { width: 100, height: 6 })
  try {
    await act(async () => { tabs.current!.setSelectedIndex(0); tabs.current!.focus() })
    await act(async () => { await setup.mockMouse.moveTo(50, 1) })
    await setup.flush()
    const rows = setup.captureCharFrame().split('\n')
    const spans = setup.captureSpans()
    const at = (x: number, y: number) => { let column = 0; for (const span of spans.lines[y].spans) { if (x < column + span.width) return span; column += span.width } throw new Error(`Missing cell ${x},${y}`) }
    if (hover === 'raise') {
      assert.equal(rows[0].slice(48, 72), `╭${'─'.repeat(22)}╮`, 'raise outlines the hovered tab')
      assert.deepEqual(at(48, 0).fg, parseColor('#555555'), 'in the muted colour')
      assert.equal(rows[2].slice(49, 71), '─'.repeat(22), 'a raised hover does not open into the window')
    } else if (hover === 'underline') {
      assert.equal(rows[2].slice(48, 72), '━'.repeat(24), 'underline rules the border under the hovered tab')
      assert.equal(rows[0].slice(48, 72).trim(), '', 'and raises nothing')
    } else if (hover === 'pill') {
      assert.equal(rows[1][48] + rows[1][71], '▐▌', 'the pill has rounded ends')
      assert.deepEqual(at(48, 1).bg, parseColor('#101010'), 'its caps sit on the strip colour')
      assert.deepEqual(at(50, 1).bg, parseColor('#181818'))
    } else if (hover === 'text' || hover === 'accent') {
      assert.deepEqual(at(50, 1).bg, parseColor('#101010'), 'a label hover adds no fill')
      assert.deepEqual(at(52, 1).fg, parseColor(hover === 'accent' ? '#00aaff' : '#eeeeee'), 'the label changes colour')
    } else {
      assert.deepEqual(at(50, 1).bg, parseColor('#101010'), 'no hover mark at all')
      assert.equal(rows[0].slice(48, 72).trim(), '')
    }
    // Initials: inactive tabs' provider letter in its colour; the active label keeps its own.
    assert.equal(rows[1][25] + rows[1][49], 'XO')
    assert.deepEqual(at(25, 1).fg, parseColor('#ff8800'), 'an inactive tab\'s initial is in its provider colour')
    assert.deepEqual(at(49, 1).fg, parseColor('#00ff88'), 'the hovered tab\'s initial too')
    assert.deepEqual(at(2, 1).fg, parseColor('#00aaff'), 'the active tab is drawn in the accent, not its initial')
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}
// Middle truncation keeps a title's last words.
assert.equal(fitTextMiddle('agentViewer · Add agent viewer plugin skill', 21), 'agentViewe…ugin skill')
assert.equal(tabStripName('agentViewer · Add agent viewer plugin skill', 25, '', true, 'middle'), 'agentViewe…ugin skill ×')
assert.equal(fitTextMiddle('short', 8), 'short   ')
console.log('Tab strip passed: Chrome-style raised active tab, underline/pills/boxed/minimal/windows styles, tint/pill/raise/underline/text/accent/none hover, provider initials, middle truncation, inactive separators, hover lift, flush-left join, active-only close, scrolling and row bounds')
process.exit(0)

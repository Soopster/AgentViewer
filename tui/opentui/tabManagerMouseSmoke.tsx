/** @jsxImportSource @opentui/react */
// The Tabs panel (⌃K m, the strip's ▾) driven by the mouse alone: hover moves
// the cursor, a click opens, a drag reorders, the row's buttons pin and close,
// the wheel scrolls and the footer's buttons toggle the pinned row and close.
import assert from 'node:assert/strict'
import { useState } from 'react'
import { act, testRender } from './testRender'
import { TabManagerPopover } from '../../plugins/tab-manager/tui/TabManagerPopover'
import { sessionIdentityKey } from './sessionIdentity'
import { DARK_THEME as DARK } from '../theme'
import type { Session } from '../../lib/types'

const session = (id: string): Session => ({ id, sessionId: id, provider: 'claude', title: `Tab ${id}`, summary: `Tab ${id}`, lastModified: 0 } as unknown as Session)
const opened: string[] = []
let closedPanel = 0
let state = { order: ['a', 'b', 'c', 'd'], pinned: new Set<string>(), row: false }

function Harness() {
  const [, setTick] = useState(0)
  const bump = () => setTick((n) => n + 1)
  const sessions = state.order.map(session)
  const keyOf = (s: Session) => sessionIdentityKey(s)
  return (
    <TabManagerPopover theme={DARK} width={100} height={30} onKeyHandlerReady={() => {}}
      onSelect={(s) => opened.push(s.id)} onClose={() => { closedPanel += 1 }}
      tabs={{
        sessions, pinned: new Set([...state.pinned].map((id) => keyOf(session(id)))), selectedKey: keyOf(sessions[0]!), row: state.row,
        toggleRow: () => { state.row = !state.row; bump(); return state.row },
        togglePin: (s) => { state.pinned.has(s.id) ? state.pinned.delete(s.id) : state.pinned.add(s.id); bump(); return state.pinned.has(s.id) },
        move: (s, delta) => {
          const from = state.order.indexOf(s.id), to = from + delta
          if (to < 0 || to >= state.order.length) return
          const next = [...state.order]; [next[from], next[to]] = [next[to]!, next[from]!]
          state.order = next; bump()
        },
        close: (s) => { state.order = state.order.filter((id) => id !== s.id); bump() },
      }} />
  )
}

const setup = await testRender(<Harness />, { width: 100, height: 30 })
const rows = () => setup.captureCharFrame().split('\n')
const rowOf = (text: string) => rows().findIndex((line) => line.includes(text))
const colOf = (text: string) => rows()[rowOf(text)]!.indexOf(text)
const mouse = async (run: () => Promise<void>) => { await act(run); await setup.flush() }
const order = () => ['a', 'b', 'c', 'd'].filter((id) => rowOf(`Tab ${id}`) >= 0).sort((x, y) => rowOf(`Tab ${x}`) - rowOf(`Tab ${y}`))
try {
  await setup.flush()
  // Hover puts the row actions on the row under the pointer.
  await mouse(() => setup.mockMouse.moveTo(colOf('Tab c') + 1, rowOf('Tab c')))
  assert.ok(rows()[rowOf('Tab c')]!.includes('×'), 'hover shows the row actions')
  assert.ok(!rows()[rowOf('Tab a')]!.includes('×'), 'only the hovered row has actions')

  await mouse(() => setup.mockMouse.click(colOf('Tab c') + 1, rowOf('Tab c')))
  assert.deepEqual(opened, ['c'], 'a click opens the tab')

  // Drag d up onto a's row: it moves one step per row crossed.
  const fromY = rowOf('Tab d'), toY = rowOf('Tab a'), x = colOf('Tab d') + 1
  await mouse(async () => {
    await setup.mockMouse.pressDown(x, fromY)
    for (let y = fromY - 1; y >= toY; y--) { await setup.mockMouse.moveTo(x, y, { button: 0 } as never); await setup.flush() }
    await setup.mockMouse.release(x, toY)
  })
  assert.deepEqual(order(), ['d', 'a', 'b', 'c'], `a drag reorders: ${order()}`)
  assert.deepEqual(opened, ['c'], 'a drag does not open')

  // The hovered row's buttons.
  await mouse(() => setup.mockMouse.moveTo(colOf('Tab b') + 1, rowOf('Tab b')))
  await mouse(() => setup.mockMouse.click(colOf(' pin ') + 1, rowOf('Tab b')))
  assert.ok(state.pinned.has('b'), 'the pin button pins')
  await mouse(() => setup.mockMouse.click(colOf(' × ') + 1, rowOf('Tab b')))
  assert.deepEqual(order(), ['d', 'a', 'c'], 'the × closes')
  await mouse(() => setup.mockMouse.click(colOf('Tab a') + 1, rowOf('Tab a'), 1 as never))
  assert.deepEqual(order(), ['d', 'c'], 'a middle-click closes')

  // The header says the same words; the button is the footer's.
  const footer = rows().findLastIndex((line) => line.includes('pinned row off'))
  await mouse(() => setup.mockMouse.click(rows()[footer]!.indexOf('pinned row off') + 1, footer))
  assert.ok(state.row, 'the footer toggles the pinned row')
  await mouse(() => setup.mockMouse.click(colOf('esc') + 1, rowOf('esc')))
  assert.equal(closedPanel, 1, 'the footer closes the panel')
} finally {
  await act(async () => setup.renderer.destroy())
}
console.log('Tab manager mouse smoke passed: hover, click, drag reorder, pin, ×, middle-click, footer buttons')
process.exit(0)

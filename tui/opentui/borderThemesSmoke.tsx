/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { useState } from 'react'
import { testRender, act } from './testRender'
import { setBorderTheme } from './borderThemes'
import { VIEW_BORDER_THEMES, VIEW_SPEC_FIELDS, type ViewBorderTheme } from '../viewSpec'

// The top-left corner and the top edge each theme draws on a box that asked for `single`.
const EXPECTED: Record<ViewBorderTheme, string> = {
  square: '┌─', rounded: '╭─', heavy: '┏━', double: '╔═', mixed: '╒═',
  dashed: '┌┄', 'heavy-dashed': '┏┅', dotted: '╭┈', ascii: '+-',
}
assert.deepEqual(Object.keys(EXPECTED).sort(), [...VIEW_BORDER_THEMES].sort(), 'every theme is checked')

let showLate: (show: boolean) => void = () => {}
function Boxes() {
  const [late, setLate] = useState(false)
  showLate = setLate
  return (
    <box flexDirection="column">
      <box width={6} height={3} border borderStyle="single"><text>a</text></box>
      <box width={6} height={3} border borderStyle="heavy"><text>b</text></box>
      {late ? <box width={6} height={3} border borderStyle="single"><text>c</text></box> : null}
    </box>
  )
}

const ctx = await testRender(<Boxes />, { width: 20, height: 10 })
const rows = async () => { await ctx.flush(); return ctx.captureCharFrame().split('\n') }

for (const theme of VIEW_BORDER_THEMES) {
  await act(async () => { setBorderTheme(theme, ctx.renderer.root) })
  const frame = await rows()
  assert.equal(frame[0]!.slice(0, 2), EXPECTED[theme], `${theme}: mounted single box\n${frame.join('\n')}`)
  assert.equal(frame[3]!.slice(0, 2), '┏━', `${theme}: a heavy border keeps its glyphs`)
  assert.equal(frame[1]![5], EXPECTED[theme] === '+-' ? '|' : frame[1]![5], `${theme}: right edge`)
}

// A box created while a custom theme is on draws it from its first frame.
await act(async () => { setBorderTheme('dashed', ctx.renderer.root) })
await act(async () => { showLate(true) })
assert.equal((await rows())[6]!.slice(0, 2), EXPECTED.dashed, 'a box mounted under a custom theme')

// Back to square restores exactly, from a custom theme as well as a native one.
await act(async () => { setBorderTheme('square', ctx.renderer.root) })
const back = await rows()
assert.equal(back[0]!.slice(0, 2), '┌─')
assert.equal(back[6]!.slice(0, 2), '┌─')
assert.equal(back[1]![0], '│', 'custom vertical glyphs are dropped')

// The View Studio offers every theme, plus none.
const offered = VIEW_SPEC_FIELDS.find(field => field.key === 'borderTheme')!.options.map(option => option.value)
assert.deepEqual(offered, ['none', ...VIEW_BORDER_THEMES])

console.log('borderThemesSmoke ok')
process.exit(0)

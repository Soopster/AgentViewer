/** @jsxImportSource @opentui/react */
import { testRender, act } from './testRender'
import { setRoundedBorders } from './roundedBorders'

function Boxes() {
  return (
    <box flexDirection="column">
      <box width={6} height={3} border borderStyle="single"><text>a</text></box>
      <box width={6} height={3} border borderStyle="heavy"><text>b</text></box>
    </box>
  )
}

const ctx = await testRender(<Boxes />, { width: 20, height: 8 })
await ctx.flush()
const before = ctx.captureCharFrame()
if (!before.includes('┌') || before.includes('╭')) throw new Error('expected square corners at start\n' + before)

await act(async () => { setRoundedBorders(true, ctx.renderer.root) })
await ctx.flush()
const rounded = ctx.captureCharFrame()
if (!rounded.includes('╭') || !rounded.includes('╯')) throw new Error('mounted single box did not turn rounded\n' + rounded)
if (!rounded.includes('┏')) throw new Error('heavy border must stay heavy\n' + rounded)

await act(async () => { setRoundedBorders(false, ctx.renderer.root) })
await ctx.flush()
const back = ctx.captureCharFrame()
if (back.includes('╭') || !back.includes('┌')) throw new Error('did not restore single\n' + back)

console.log('roundedBordersSmoke ok')
process.exit(0)

/** @jsxImportSource @opentui/react */
// The Focus view and widget: presets start a block, held items are listed newest
// first, Enter opens a held item's session, e ends the block into its digest,
// and the corner widget shows only while a block runs.
import React from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module, widgets } from '../../plugins/focus-mode/tui'
import type { FocusState } from '../../lib/plugins/focusMode'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let stored: FocusState = { active: null, held: [], last: null }
const calls: string[] = []
const service = {
  read: async () => stored,
  start: async (minutes: number) => { calls.push(`start:${minutes}`); stored = { ...stored, active: { startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000 } }; return stored },
  end: async () => { calls.push('end'); stored = { active: null, held: [], last: { ...stored.active!, endedAt: Date.now(), held: stored.held } }; return stored },
  hold: async () => {},
  clearDigest: async () => { calls.push('clear'); stored = { ...stored, last: null }; return stored },
}
const opened: string[] = []
const services = { 'focus-mode': service, 'session-navigation': { open: (ref: { sessionId: string }) => { opened.push(ref.sessionId) } } }
let keys: (key: any) => boolean | void = () => false
let closed = 0
const View = module.views['focus-mode'] as any
const Widget = widgets.widgets.status as any
const size = { width: 100, height: 24 }
const t = await testRender(<box flexDirection="column">
  <Widget services={services} theme={DARK_THEME} width={40} />
  <View services={services} theme={DARK_THEME} width={size.width} height={size.height - 1} placement="window" zIndex={1} focused
    registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} setCapture={() => {}} useState={React.useState} />
</box>, size)
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 60)) })
const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false }); await new Promise(r => setTimeout(r, 60)) }); await t.flush?.() }
const frame = async () => { await settle(); await t.renderOnce(); return t.captureCharFrame() }

let screen = await frame()
assert(screen.includes('Not focusing') && screen.includes('Start a block with 1, 2 or 3'), 'idle: says how to start')
assert(!screen.includes('◐ focus '), 'the widget is hidden while not focusing')

await press('2', '2')
screen = await frame()
assert(calls.includes('start:45'), '2 starts a 45-minute block')
assert(screen.includes('Focusing · 45m left'), 'the heading counts down')
assert(screen.includes('◐ focus 45m · 0 held'), 'the widget shows the block')

stored = { ...stored, held: [
  { id: 'h1', at: Date.now() - 60_000, channel: 'toast', title: 'Turn finished in api', target: { provider: 'claude', sessionId: 'sess-api' } },
  { id: 'h2', at: Date.now(), channel: 'desktop', title: 'Teammate result', detail: 'tests pass' },
] }
await press('g') // not bound: nothing happens
await act(async () => { await (await import('../../plugins/focus-mode/store')).focusController(service as any).refresh() })
screen = await frame()
assert(screen.indexOf('Teammate result') < screen.indexOf('Turn finished in api'), 'held items are listed newest first')
assert(screen.includes('2 held'), 'the heading counts what is held')
await press('j')
await press('return')
assert(opened.includes('sess-api') && closed === 1, 'Enter opens the held item\'s session')

await press('e')
screen = await frame()
assert(calls.includes('end') && screen.includes('HELD LAST BLOCK') && screen.includes('Turn finished in api'), 'e ends the block into its digest')
assert(!screen.includes('◐ focus '), 'the widget hides once the block ends')
await press('c')
screen = await frame()
assert(calls.includes('clear') && screen.includes('Not focusing'), 'c clears the digest')
t.renderer.destroy?.()
console.log('focusModeSmoke ok')
process.exit(0)

/** @jsxImportSource @opentui/react */
// The Schedules view: rows with countdown and last outcome, run-now / pause / two-press delete,
// and a service failure shown rather than swallowed.
import React from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/schedules/tui'
import type { ScheduleListing } from '../../lib/schedules/service'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = Date.now()
let rows: ScheduleListing[] = [
  { id: 'a', name: 'Morning digest', trigger: { kind: 'cron', expression: '0 9 * * 1-5' }, action: { kind: 'new-session', provider: 'claude', cwd: '/x' }, prompt: 'p', overlap: 'skip', catchUp: 'once', enabled: true, createdAt: now, nextRunAt: now + 20 * 60_000, recentRuns: [{ scheduleId: 'a', startedAt: now, endedAt: now, outcome: 'ok' }] },
  { id: 'b', name: 'Build check', trigger: { kind: 'every', amount: 1, unit: 'h' }, action: { kind: 'prompt-session', sessionId: 'abcdef123456', provider: 'codex' }, prompt: 'p', overlap: 'skip', catchUp: 'once', enabled: true, createdAt: now, nextRunAt: now + 3 * 3_600_000, recentRuns: [{ scheduleId: 'b', startedAt: now, endedAt: now, outcome: 'failed', error: 'HTTP 500' }] },
]
const calls: string[] = []
const notices: string[] = []
const services = {
  schedules: {
    list: async () => rows,
    setEnabled: async (id: string, enabled: boolean) => { calls.push(`enabled:${id}:${enabled}`); rows = rows.map(r => r.id === id ? { ...r, enabled } : r) },
    runNow: async (id: string) => { calls.push(`run:${id}`) },
    remove: async (id: string) => { calls.push(`remove:${id}`); rows = rows.filter(r => r.id !== id) },
    create: async () => {},
  },
  notices: { show: (_k: string, text: string) => { notices.push(text) } },
}
let keys: (key: any) => boolean | void = () => false
let closed = 0
const closedCount = (): number => closed
const View = module.views.schedules as any
const size = { width: 110, height: 26 }
const t = await testRender(
  <View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} />,
  size,
)
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 60)) })
const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false }); await new Promise(r => setTimeout(r, 40)) }); await t.flush?.() }
const frame = async () => { await settle(); await t.renderOnce(); return t.captureCharFrame() }

let screen = await frame()
assert(screen.includes('2 total'), 'the header counts schedules')
assert(screen.includes('Morning digest') && screen.includes('in 20m'), 'a row shows its name and countdown')
assert(screen.includes('every hour') && screen.includes('HTTP 500'), 'a failed run shows its error beside the trigger')
assert(screen.includes('✓') && screen.includes('✗'), 'each row carries its last outcome glyph')

await press('r', 'r')
assert(calls.includes('run:a'), 'r runs the selected schedule now')
await press('p', 'p')
screen = await frame()
assert(calls.includes('enabled:a:false') && screen.includes('paused'), 'p pauses and the row says so')

// Delete takes two presses; another key disarms it.
await press('x', 'x')
screen = await frame()
assert(screen.includes('Delete "Morning digest"? x again deletes'), 'the first x arms and says what it will delete')
assert(!calls.some(c => c.startsWith('remove')), 'one x deletes nothing')
await press('j')
await press('x', 'x')
screen = await frame()
assert(screen.includes('Delete "Build check"?'), 'moving re-arms against the new row, never the old one')
await press('escape')
assert(closedCount() === 0 && !calls.some(c => c.startsWith('remove')), 'Escape disarms before it closes')
await press('x', 'x')
await press('x', 'x')
screen = await frame()
assert(calls.includes('remove:b') && !screen.includes('Build check'), 'the second x deletes and the row goes')
await press('escape')
assert(closedCount() === 1, 'Escape closes when nothing is armed')
t.renderer.destroy?.()
console.log('schedulesViewSmoke ok')
process.exit(0)

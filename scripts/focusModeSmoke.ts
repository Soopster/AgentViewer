// Focus Mode: what the gate holds and what it never holds, through the real
// notification center and the application host's wrappers; held items reaching
// the store; a block running out and its digest announced once (never replayed
// at launch); and the file store's settle, extend and restart behaviour.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const scratch = mkdtempSync(path.join(tmpdir(), 'focus-smoke-'))
process.env.AGENT_VIEWER_FOCUS_FILE = path.join(scratch, 'focus.json')

const { parseFocusDuration, focusActive, formatFocusRemaining } = await import('../lib/plugins/focusMode')
const { createNotificationCenter } = await import('../lib/plugins/notifications')
const { holdDelivery } = await import('../lib/plugins/deliveryGate')
const { nativeFocus } = await import('../lib/focus/service')
const { createFocusController } = await import('../plugins/focus-mode/store')

// --- durations ---
assert.equal(parseFocusDuration(''), 45)
assert.equal(parseFocusDuration('25'), 25)
assert.equal(parseFocusDuration('45m'), 45)
assert.equal(parseFocusDuration('1h'), 60)
assert.equal(parseFocusDuration('1h30m'), 90)
assert.equal(parseFocusDuration('90 min'), 90)
assert.equal(parseFocusDuration('soon'), null)
assert.equal(parseFocusDuration('0'), null)
assert.equal(parseFocusDuration('99h'), null)
assert.equal(formatFocusRemaining({ startedAt: 0, endsAt: 90 * 60_000 }, 0), '1h30m')

// --- the file store ---
let state = await nativeFocus.read()
assert.equal(state.active, null)
state = await nativeFocus.start(30)
assert.ok(focusActive(state), 'a started block is active')
assert.equal(statSync(process.env.AGENT_VIEWER_FOCUS_FILE!).mode & 0o777, 0o600, 'the state file is private')
await nativeFocus.hold([{ id: 'a', at: Date.now(), channel: 'toast', title: 'Turn finished' }])
await nativeFocus.hold([{ id: 'a', at: Date.now(), channel: 'toast', title: 'Turn finished' }])
state = await nativeFocus.read()
assert.equal(state.held.length, 1, 'holding the same item twice keeps one')
const startedAt = state.active!.startedAt
state = await nativeFocus.start(60)
assert.equal(state.active!.startedAt, startedAt, 'restarting a running block extends it')
assert.equal(state.held.length, 1, 'and keeps what it held')
state = await nativeFocus.end()
assert.equal(state.active, null)
assert.equal(state.last?.held.length, 1, 'ending moves what was held into the digest')
await nativeFocus.hold([{ id: 'b', at: Date.now(), channel: 'toast', title: 'late' }])
assert.equal((await nativeFocus.read()).held.length, 0, 'nothing is held outside a block')
state = await nativeFocus.clearDigest()
assert.equal(state.last, null)

// --- the controller, the gate and the notification center, on a fake clock ---
let now = 1_000_000
let stored = { active: null as null | { startedAt: number; endsAt: number }, held: [] as any[], last: null as any }
const settle = () => { if (stored.active && now >= stored.active.endsAt) stored = { active: null, held: [], last: { ...stored.active, endedAt: stored.active.endsAt, held: stored.held } } }
const service = {
  read: async () => { settle(); return structuredClone(stored) },
  start: async (minutes: number) => { settle(); stored = { ...stored, active: { startedAt: now, endsAt: now + minutes * 60_000 }, held: stored.active ? stored.held : [] }; return structuredClone(stored) },
  end: async () => { stored = stored.active ? { active: null, held: [], last: { ...stored.active, endedAt: now, held: stored.held } } : stored; return structuredClone(stored) },
  hold: async (items: any[]) => { if (stored.active) stored.held.push(...items) },
  clearDigest: async () => { stored.last = null; return structuredClone(stored) },
}
// A block that ended before launch is the baseline: it is not announced.
stored.last = { startedAt: 1, endsAt: 2, endedAt: 2, held: [{ id: 'old', at: 1, channel: 'toast', title: 'old' }] }
const digests: string[] = []
const controller = createFocusController(service, { now: () => now, pollMs: 60_000 })
const release = controller.activate(title => digests.push(title))
await controller.refresh()
assert.deepEqual(digests, [], 'a digest from before launch is never replayed')

const center = createNotificationCenter(() => now)
const shown = () => center.getSnapshot().map(item => item.title)
center.service.show('success', 'Before the block')
assert.deepEqual(shown(), ['Before the block'], 'with no block everything is delivered')

await controller.start(30)
center.service.show('success', 'Turn finished in api')
center.service.show('info', 'Teammate result')
center.service.show('warning', 'Approval needed')
center.service.show('error', 'Turn failed')
center.service.show('info', 'Session needs your answer', { urgent: true })
assert.deepEqual(shown().sort(), ['Approval needed', 'Before the block', 'Session needs your answer', 'Turn failed'].sort(), 'warnings, errors and urgent notices come through; the rest is held')
assert.equal(holdDelivery({ channel: 'desktop', urgent: true, title: 'needs input' }), false, 'an urgent desktop alert is never held')
assert.equal(holdDelivery({ channel: 'desktop', urgent: false, title: 'finished' }), true, 'a finished-turn desktop alert is held')
await controller.flush()
assert.deepEqual(stored.held.map(item => item.title), ['Turn finished in api', 'Teammate result', 'finished'], 'held items reach the store in order')
assert.equal(controller.getSnapshot().pendingCount, 0)

// The block runs out: the next tick settles it and the digest is announced once.
now += 31 * 60_000
assert.equal(holdDelivery({ channel: 'toast', urgent: false, title: 'after' }), false, 'a block past its end holds nothing, even before it is settled')
controller.tick()
await new Promise(resolve => setTimeout(resolve, 20))
assert.deepEqual(digests, ['Focus block over · 3 held while you worked'])
await controller.refresh()
assert.equal(digests.length, 1, 'the same block end is announced once')
assert.equal(controller.getSnapshot().state?.last?.held.length, 3)

// Turning the plugin off removes the gate.
await controller.start(30)
release()
assert.equal(holdDelivery({ channel: 'toast', urgent: false, title: 'x' }), false, 'a released gate holds nothing')

// --- the application host's wrappers pass the gate too (what session alerts and teammates use) ---
const { createPluginApplicationHost } = await import('../lib/plugins/applicationHost')
const { PLUGIN_API_VERSION } = await import('../lib/plugins/types')
const { setDeliveryGate } = await import('../lib/plugins/deliveryGate')
const delivered: string[] = []
const gated: string[] = []
const releaseFixtureGate = setDeliveryGate(item => { gated.push(item.title); return true })
const fixture = { apiVersion: PLUGIN_API_VERSION, id: 'gate-fixture', title: 'f', description: 'f', renderers: ['tui'], stateVersion: 1, surfaces: [], commands: [], application: { events: ['sessionActivity'], services: ['notifications'] } } as any
const host = createPluginApplicationHost('tui', [fixture], { 'gate-fixture': async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: 'gate-fixture', activate: ({ services }) => ({ onSessionActivity: () => {
  services.notifications!.notice('finished turn')
  services.notifications!.notice('needs your answer', { urgent: true })
  services.notifications!.desktop('finished', 'body')
  services.notifications!.desktop('approval', 'body', { urgent: true })
} }) }) }, { notifications: { show: () => '', dismiss: () => {}, notice: text => delivered.push(`notice:${text}`), desktop: title => delivered.push(`desktop:${title}`) } })
await host.publish({ activity: new Map(), sessions: [], selectedKey: null, focused: true, now: Date.now() } as any)
assert.deepEqual(delivered, ['notice:needs your answer', 'desktop:approval'], 'urgent application notices pass; the rest is offered to the gate')
assert.deepEqual(gated, ['finished turn', 'finished'], 'only non-urgent items reach the gate')
host.dispose()
releaseFixtureGate()

rmSync(scratch, { recursive: true, force: true })
console.log('focus mode smoke passed')
process.exit(0)

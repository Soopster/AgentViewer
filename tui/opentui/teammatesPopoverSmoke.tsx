/** @jsxImportSource @opentui/react */
// Interactive Coordinator panel: enabling a conversation's team, the roster it
// then shows, the continuation toggle, and the unconfirmed-request gate.
//
// Hermetic — the coordination DB resolves from process.cwd(), so chdir BEFORE
// importing anything that opens it. Full-mount smokes use console.error +
// process.exit(1) rather than throwing: the app's own timers keep the process
// alive past an uncaught throw.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const smokeRoot = mkdtempSync(path.join(tmpdir(), 'agent-viewer-teammates-smoke-'))
process.chdir(smokeRoot)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'fixture'])

const { TeammatesPopover } = await import('./TeammatesPopover')
const store = await import('./interactiveCoordinatorStore')
const coordination = await import('../../lib/agentCoordination')
const { LIGHT_THEME } = await import('../theme')
const { MODAL_SCRIM_Z_INDEX } = await import('./layers')

const SESSION_ID = 'teammates-smoke-chat'
const PROVIDER = 'codex' as const

let keyHandler: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
const opened: string[] = []
const notices: string[] = []

const setup = await testRender(
  <TeammatesPopover
    theme={LIGHT_THEME}
    width={110}
    height={34}
    onOpenSession={(agent) => { opened.push(agent.name) }}
    onNotice={(_tone, text) => { notices.push(text) }}
    onKeyHandlerReady={(handler) => { keyHandler = handler }}
  />,
  { width: 110, height: 34, kittyKeyboard: true },
)
const { captureCharFrame } = setup

const settle = async (ms: number) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 16))
    })
  }
}
const press = async (name: string, sequence = name) => {
  await act(async () => { keyHandler?.({ name, ctrl: false, shift: false, sequence }) })
  await settle(120)
}
const type = async (text: string) => {
  for (const char of text) {
    await act(async () => { keyHandler?.({ name: char, ctrl: false, shift: false, sequence: char }) })
  }
  await settle(60)
}
const fail = (message: string): never => {
  console.error(`${message}\n${captureCharFrame()}`)
  process.exit(1)
}
const waitFor = async (label: string, predicate: () => boolean) => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (predicate()) return
    await settle(100)
  }
  fail(`timed out waiting for ${label}`)
}

act(() => {
  store.openInteractiveCoordinator({
    sessionId: SESSION_ID, provider: PROVIDER, cwd: smokeRoot, title: 'Smoke chat',
  })
})
await settle(600)

// ── off by default ─────────────────────────────────────────────────────────
// A conversation is not a Coordinator lead until someone says so; the panel
// must offer that rather than assume it.
if (!captureCharFrame().includes('Coordination is off')) {
  fail('a conversation with no run should report coordination off')
}

if (process.env.DUMP_FRAME === '1') console.log(captureCharFrame())

// ── the panel sits above the root's modal scrim ────────────────────────────
// The root paints a 35% black scrim over everything while a modal is up. A
// panel left below it is painted THROUGH that scrim — it still renders, so the
// char frame is identical and only the colours are wrong, which is exactly how
// this shipped once. Assert the order rather than the pixels.
const panelBox = setup.renderer.root.findDescendantById('teammates-popover')
if (!panelBox) fail('the panel did not mount with its own id')
if ((panelBox?.zIndex ?? 0) <= MODAL_SCRIM_Z_INDEX) {
  fail(`the panel renders at z-index ${panelBox?.zIndex}, at or below the modal scrim's ${MODAL_SCRIM_Z_INDEX}`)
}

// ── e enables ──────────────────────────────────────────────────────────────
await press('e')
await waitFor('the coordinator to come on', () => store.getInteractiveCoordinatorState().data?.interactive.enabled === true)
if (!captureCharFrame().includes('Coordinator on')) fail('enabling did not repaint the header')
const runId = store.getInteractiveCoordinatorState().data?.snapshot?.run.id
if (!runId) fail('enabling did not bind this conversation to a run')
// Enabling gives the chat a team; it does not invent work for it.
if ((store.getInteractiveCoordinatorState().data?.snapshot?.tasks.length ?? -1) !== 0) {
  fail('enabling must not create a task')
}

// ── the roster shows what each teammate is actually doing ──────────────────
await coordination.joinExternalProtocolRun({
  runId: runId!, provider: 'claude', cwd: smokeRoot, participantName: 'nova',
})
await waitFor('nova to appear in the roster', () => captureCharFrame().includes('nova'))
let frame = captureCharFrame()
if (!frame.includes('TEAMMATES')) fail('the roster heading is missing')
// `coordinatorAgentActivity` is what the web panel shows too — a bare protocol
// status ("idle") does not tell the user whether anything is waiting on them.
if (!frame.includes('Available')) fail('the roster shows a protocol status instead of an activity')

if (process.env.DUMP_FRAME === '1') console.log(captureCharFrame())

// ── ⏎ opens the selected teammate's transcript ─────────────────────────────
await press('return')
if (opened[0] !== 'nova') fail(`⏎ did not open the selected teammate, opened: ${opened.join(', ') || '(none)'}`)
// Opening a teammate closes the panel — the reader is where the answer is.
if (store.getInteractiveCoordinatorState().open) {
  fail('opening a teammate left the panel up over the transcript it wanted read')
}
act(() => {
  store.openInteractiveCoordinator({
    sessionId: SESSION_ID, provider: PROVIDER, cwd: smokeRoot, title: 'Smoke chat',
  })
})
// Reopening the same conversation keeps its last read, so the roster is on
// screen again without a round trip.
if (!captureCharFrame().includes('nova')) fail('reopening the same conversation flashed an empty roster')
await settle(200)

// ── c toggles automatic continuation ───────────────────────────────────────
if (store.getInteractiveCoordinatorState().data?.interactive.autoContinue !== false) {
  fail('automatic continuation must start off')
}
await press('c')
await waitFor('continuation to turn on', () => store.getInteractiveCoordinatorState().data?.interactive.autoContinue === true)
if (!captureCharFrame().includes('[x] Continue when teammates respond')) {
  fail('the continuation checkbox did not follow the setting')
}

// ── the footer never truncates away its own escape hatch ───────────────────
// It drops whole entries from the middle rather than cutting the line, because
// the last one is how to leave. Same rule the ⌃B/⌃K chord hint follows.
const footerLine = captureCharFrame().split('\n').findLast((line) => line.includes('esc close'))
if (!footerLine) fail('the footer lost "esc close" while listing the other keys')
if (footerLine?.includes('…')) fail('the footer cut a hint mid-word instead of dropping whole entries')

// ── d and m compose against the panel's own draft ──────────────────────────
// The panel owns every keystroke while it is up, so the draft is built from key
// events rather than a focused <input>; nothing is sent until ⏎.
await press('d')
await type('look at the parser')
if (!captureCharFrame().includes('look at the parser')) fail('the delegate draft did not echo what was typed')
if (!captureCharFrame().includes('Ask an available teammate')) fail('the delegate draft did not name its target')
await press('escape')
if (captureCharFrame().includes('look at the parser')) fail('escape did not discard the draft')
if ((store.getInteractiveCoordinatorState().data?.snapshot?.tasks.length ?? -1) !== 0) {
  fail('cancelling a draft still created a task')
}
await press('m')
if (!captureCharFrame().includes('Message nova')) fail('m did not compose to the selected teammate')
await press('escape')

// ── an unconfirmed request gates the panel ─────────────────────────────────
// The idempotency key makes a REPLAY safe; it cannot make a second, different
// mutation safe while the first's outcome is unknown. So a failed request has
// to lock the panel until the user retries or discards it — the web panel's
// `locked` rule, which is easy to lose in a port.
const before = store.getInteractiveCoordinatorState().data
const refused = await store.runInteractiveCoordinatorAction({
  action: 'resume-agent', to: 'nobody', detail: 'resume a teammate that needs nothing',
})
if (refused) fail('resuming a teammate that needs no recovery should not report success')
const pending = store.getInteractiveCoordinatorState().pending
if (!pending) fail('a failed request must be kept for retry, not dropped')
if (!store.getInteractiveCoordinatorState().error) fail('a failed request must explain itself')
await settle(120)
if (!captureCharFrame().includes('unconfirmed')) fail('the panel did not surface the unconfirmed request')

// A second, different action must not start while that one is unresolved.
await press('c')
if (store.getInteractiveCoordinatorState().data?.interactive.autoContinue
    !== before?.interactive.autoContinue) {
  fail('a keystroke started a new mutation while an earlier one was unconfirmed')
}
// A retry replays the SAME request id, so the server reconciles rather than
// repeating it.
const retried = store.getInteractiveCoordinatorState().pending
if (retried?.requestId !== pending?.requestId) fail('the pending request id changed before it was retried')
await press('e')
if (store.getInteractiveCoordinatorState().pending !== null) fail('discarding did not clear the unconfirmed request')

// ── x confirms before stopping teammate work ───────────────────────────────
await press('x')
if (!captureCharFrame().includes('Turn off coordination?')) fail('x turned coordination off without confirming')
await press('escape')
if (store.getInteractiveCoordinatorState().data?.interactive.enabled !== true) {
  fail('cancelling the confirm still turned coordination off')
}
await press('x')
await press('y')
await waitFor('coordination to turn off', () => store.getInteractiveCoordinatorState().data?.interactive.enabled === false)
frame = captureCharFrame()
if (!frame.includes('Coordination is off') && !frame.includes('Run ended')) {
  fail('turning coordination off did not repaint the header')
}

console.log('Teammates popover smoke passed (enable, roster activity, inspect, drafts, continuation, unconfirmed gate, turn off)')
process.exit(0)

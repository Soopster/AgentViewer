/** @jsxImportSource @opentui/react */
// Interactive Coordinator panel: enabling a conversation's team, the roster it
// then shows, the continuation toggle, and the unconfirmed-request gate.
//
// Hermetic — the coordination DB resolves from process.cwd(), so chdir BEFORE
// importing anything that opens it. Full-mount smokes use console.error +
// process.exit(1) rather than throwing: the app's own timers keep the process
// alive past an uncaught throw.
import { createHash } from 'node:crypto'
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
const { TeammatesAttention } = await import('./TeammatesAttention')
const store = await import('./interactiveCoordinatorStore')
const coordination = await import('../../lib/agentCoordination')
const { LIGHT_THEME } = await import('../theme')
const { MODAL_SCRIM_Z_INDEX } = await import('./layers')

const SESSION_ID = 'teammates-smoke-chat'
const PROVIDER = 'codex' as const
await coordination.createExternalProtocolRun({ runId: `chat-${createHash('sha256').update(`${PROVIDER}:${SESSION_ID}`).digest('hex').slice(0, 40)}`, prompt: 'Interactive fixture', provider: PROVIDER, baseCwd: smokeRoot, participantName: 'lead', requirePlanApproval: true })

let keyHandler: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
const opened: string[] = []
const notices: string[] = []

const setup = await testRender(
  <>
  <TeammatesAttention theme={LIGHT_THEME} width={110} />
  <TeammatesPopover
    theme={LIGHT_THEME}
    width={110}
    height={34}
    onOpenSession={(agent) => { opened.push(agent.name) }}
    onNotice={(_tone, text) => { notices.push(text) }}
    onKeyHandlerReady={(handler) => { keyHandler = handler }}
  /></>,
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

// The emptiest state is where a content-fit height can go too far: the
// scrollbox has its own minimum, and below it the footer draws outside the
// border — visible only in a frame, never in a type.
{
  const rows = captureCharFrame().split('\n')
  const top = rows.findIndex(line => line.includes('─ Teammates ─'))
  const bottom = rows.findIndex((line, index) => index > top && line.includes('└'))
  const footer = rows.findIndex((line, index) => index > top && line.includes('esc close'))
  if (top < 0 || bottom < 0) fail('the Teammates panel is not on screen')
  if (footer < 0 || footer > bottom) fail(`the footer drew outside the panel border:\n${captureCharFrame()}`)
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
const nova = await coordination.joinExternalProtocolRun({
  runId: runId!, provider: 'claude', cwd: smokeRoot, participantName: 'nova',
})
await waitFor('nova to appear in the roster', () => captureCharFrame().includes('nova'))
let frame = captureCharFrame()
if (!frame.includes('TEAMMATES')) fail('the roster heading is missing')
// `coordinatorAgentActivity` is what the web panel shows too — a bare protocol
// status ("idle") does not tell the user whether anything is waiting on them.
if (!frame.includes('Available')) fail('the roster shows a protocol status instead of an activity')
// Herdr keeps an agent "working" while background work will bring it back; the
// TUI read assembles that from the runtime's waiting registry.
const runtime = await import('../../lib/sessionRuntime')
const novaSessionId = store.getInteractiveCoordinatorState().data!.snapshot!.agents.find(agent => agent.name === 'nova')!.sessionId
runtime.setWaitingSession({ sessionId: novaSessionId, provider: 'claude',
  backgroundTasks: [{ id: 'bg', type: 'subagent', status: 'running', description: 'search' }], sessionCrons: [] })
await waitFor('background work in the roster', () => captureCharFrame().includes('Working in background · 1 background task'))
runtime.clearWaitingSession(novaSessionId)
await waitFor('nova available again', () => captureCharFrame().includes('Available'))

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

// ── l cycles where teammate alerts go (herdr's ui.toast.delivery) ───────────
await press('l')
if (store.getInteractiveCoordinatorNotifications() !== 'in-app') fail('l did not move teammate alerts to in-app')
await settle(60)
if (!captureCharFrame().includes('alerts in-app')) fail('the panel does not show a non-default alert delivery')
await press('l'); await press('l')
if (store.getInteractiveCoordinatorNotifications() !== 'desktop') fail('l did not cycle back to desktop')

// ── c toggles automatic continuation ───────────────────────────────────────
if (store.getInteractiveCoordinatorState().data?.interactive.autoContinue !== false) {
  fail('automatic continuation must start off')
}
await press('c')
await waitFor('continuation to turn on', () => store.getInteractiveCoordinatorState().data?.interactive.autoContinue === true)
if (!captureCharFrame().includes('[x] Continue when teammates respond')) {
  fail('the continuation checkbox did not follow the setting')
}

// ── w toggles worktrees for teammates started afterwards ───────────────────
const runWorktrees = () => store.getInteractiveCoordinatorState().data?.snapshot?.run.useWorktrees
if (runWorktrees() === false) fail('chat teams must default to worktrees')
await press('w')
await waitFor('worktrees to turn off', () => runWorktrees() === false)
if (!captureCharFrame().includes('[ ] Give new teammates their own worktree')) {
  fail('the worktree checkbox did not follow the setting')
}
if ((await coordination.readSessionCoordinator(SESSION_ID, PROVIDER))?.run.useWorktrees !== false) {
  fail('the worktree setting was not persisted to the run')
}
if (store.getInteractiveCoordinatorState().data?.interactive.autoContinue !== true) {
  fail('changing worktrees reset automatic continuation')
}
await press('w')
await waitFor('worktrees to turn back on', () => runWorktrees() === true)

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
await type('😀')
await press('backspace')
await press('paste', 'Review café\r\nand report findings')
await press('return')
await waitFor('pasted message delivery', () => Boolean(store.getInteractiveCoordinatorState().data?.snapshot?.messages.some(message => message.body === 'Review café\nand report findings')))
if (store.getInteractiveCoordinatorState().pending) fail('paste submission was not confirmed')

// Shared attention is actionable from the interactive panel, not just a task count.
await press('c') // Leave provider continuation off during human-gated fixture work.
const leadIdentity = await coordination.sessionCoordinatorIdentity(SESSION_ID, PROVIDER)
const planned = await coordination.createExternalProtocolTask(leadIdentity, { assignTo: nova.participant.agentId, title: 'Inspect parser', detail: 'Read parser only' })
await coordination.submitExternalProtocolPlan(nova.participant, { taskId: planned.task!.id, summary: 'Read-only plan', detail: 'Inspect parser.ts without editing files' })
await waitFor('plan attention', () => captureCharFrame().includes('approve plan'))
if (store.getInteractiveCoordinatorState().data?.snapshot?.messages.some(message => message.body.includes('plan is ready for approval') && message.kind !== 'status')) fail('human plan request must not wake the lead')
if (!captureCharFrame().includes('Inspect parser.ts without editing files')) fail('attention lost the actual submitted plan')
await press('v')
await waitFor('plan rejection', () => Boolean(store.getInteractiveCoordinatorState().data?.snapshot?.events.some(event => event.type === 'plan.rejected')))
await coordination.submitExternalProtocolPlan(nova.participant, { taskId: planned.task!.id, summary: 'Revised plan', detail: 'Inspect parser.ts and its tests' })
await waitFor('revised plan', () => captureCharFrame().includes('Inspect parser.ts and its tests'))
await press('a')
await waitFor('plan approval', () => Boolean(store.getInteractiveCoordinatorState().data?.snapshot?.events.some(event => event.type === 'plan.approved')))
await coordination.sendExternalProtocolMessage(nova.participant, { to: 'lead', body: 'Which parser should I inspect?', replyRequired: true })
await waitFor('reply attention', () => captureCharFrame().includes('Which parser should I inspect?'))
await press('escape')
if (!store.getInteractiveCoordinatorAttention().includes('need attention')) fail('attention disappeared when the panel closed')
await waitFor('background attention badge', () => captureCharFrame().includes('need attention'))
await act(async () => store.openInteractiveCoordinatorAttention())
await settle(120)
await press('b')
await press('paste', 'Use the TypeScript parser')
await press('return')
await waitFor('resolved reply', () => Boolean(store.getInteractiveCoordinatorState().data?.snapshot?.messages.some(message => message.body === 'Which parser should I inspect?' && message.resolvedAt)))
await coordination.completeExternalProtocolTask(nova.participant, { taskId: planned.task!.id, summary: 'Need parser choice', needsDecision: [{ id: 'parser-choice', question: 'Use strict parser mode?', options: ['Strict', 'Compatible'], impactIfWrong: 'Changes accepted syntax', status: 'open' }] })
await waitFor('decision in ledger', () => Boolean(store.getInteractiveCoordinatorState().data?.snapshot?.tasks.find(task => task.id === planned.task!.id)?.receipt?.needsDecision.some(decision => decision.id === 'parser-choice')))
// The blocker and its decision are separate attention items; navigate to the decision.
for (let i = 0; i < 5 && !captureCharFrame().includes('Use strict parser mode?'); i++) await press(']')
if (!captureCharFrame().includes('Use strict parser mode?')) fail('decision is not navigable in attention')
await press('b')
await press('paste', 'Use strict mode')
await press('return')
await waitFor('decision answered', () => Boolean(store.getInteractiveCoordinatorState().data?.snapshot?.tasks.find(task => task.id === planned.task!.id)?.receipt?.needsDecision.some(decision => decision.id === 'parser-choice' && decision.status === 'answered' && decision.answer === 'Use strict mode')))
await coordination.appendProtocolEvent({ version: '1.0', runId: runId!, agentId: nova.participant.agentId, taskId: planned.task!.id, type: 'task.failed', summary: 'Parser fixture result: missing grammar' })
await waitFor('result summary', () => captureCharFrame().includes('Parser fixture result: missing grammar'))
// The attention card already carries the sentence; the roster quoting it too
// put the same fact on screen twice, which reads as two things happening.
{
  const occurrences = captureCharFrame().split('Parser fixture result: missing grammar').length - 1
  if (occurrences !== 1) fail(`the result is on screen ${occurrences} times:\n${captureCharFrame()}`)
}
await press('s')
if (captureCharFrame().includes('ATTENTION')) fail('reviewed result stayed in attention')

// ── the panel is as tall as its content, not a fixed block ─────────────────
// A fixed 32 rows left a small team in a panel two thirds empty. The floor is
// the scrollbox's own minimum plus chrome; below it the footer draws outside
// the border, which is why this asserts both bounds.
{
  const frameRows = captureCharFrame().split('\n')
  const top = frameRows.findIndex(line => line.includes('─ Teammates ─'))
  const bottom = frameRows.findIndex((line, index) => index > top && line.includes('└'))
  const panelHeight = bottom - top + 1
  if (top < 0 || bottom < 0) fail('the Teammates panel is not on screen')
  if (panelHeight > 20) fail(`the panel is padded well past its content: ${panelHeight} rows`)
  if (panelHeight < 12) fail(`the panel is below the height its scrollbox needs: ${panelHeight} rows`)
  const footerRow = frameRows.findIndex((line, index) => index > top && line.includes('esc close'))
  if (footerRow < 0 || footerRow > bottom) fail('the footer drew outside the panel border')
}

// ── the roster quotes the teammate's own last report ───────────────────────
await coordination.reportExternalProtocolProgress(nova.participant, { status: 'heartbeat', summary: 'Reading parser.ts and its tests' })
await waitFor("nova's own words in the roster", () => captureCharFrame().includes('Reading parser.ts and its tests'))

// ── i interrupts only a teammate that is actually running ──────────────────
await press('i')
if (!notices.some(text => text.includes('has no turn running'))) fail(`i on an idle teammate must say so rather than sending a request: ${notices.join(' | ')}`)
if (store.getInteractiveCoordinatorState().pending) fail('an idle teammate interrupt must not reach the server')

// ── the roster reorders by attention, and selection follows the teammate ────
// Herdr's agent panel sorts by priority. A positional selection would silently
// retarget `m` to whoever moved into that row, so selection is by id.
const orion = await coordination.joinExternalProtocolRun({ runId: runId!, provider: 'claude', cwd: smokeRoot, participantName: 'orion' })
await waitFor('orion to appear in the roster', () => captureCharFrame().includes('orion'))
const rosterOrder = () => store.getInteractiveCoordinatorState().data!.snapshot!.agents.filter(agent => agent.role === 'teammate').map(agent => agent.name)
const rowOf = (name: string) => captureCharFrame().split('\n').findIndex(line => new RegExp(`\\b${name}\\b`).test(line) && !line.includes('Message'))
if (!(rowOf('nova') < rowOf('orion'))) fail(`expected nova above orion before orion asks anything (${rosterOrder().join(', ')})`)
await press('j')
await coordination.sendExternalProtocolMessage(orion.participant, { to: 'lead', body: 'Need a decision from you', replyRequired: true })
await waitFor('orion to rise above nova', () => rowOf('orion') >= 0 && rowOf('orion') < rowOf('nova'))
await press('m')
if (!captureCharFrame().includes('Message orion')) fail('reordering the roster retargeted the selected teammate')
await press('escape')

// ── reading a teammate's transcript reviews its results ────────────────────
const orionTask = await coordination.createExternalProtocolTask(leadIdentity, { assignTo: orion.participant.agentId, title: 'Orion lane', detail: 'Fixture result' })
await coordination.appendProtocolEvent({ version: '1.0', runId: runId!, agentId: orion.participant.agentId, taskId: orionTask.task!.id, type: 'task.failed', summary: 'Orion fixture result' })
await waitFor('orion result in attention', () => captureCharFrame().includes('Orion fixture result'))
const orionResults = () => {
  const snap = store.getInteractiveCoordinatorState().data!.snapshot!
  const task = snap.tasks.find(entry => entry.id === orionTask.task!.id)!
  return `result:${task.id}:${task.updatedAt}`
}
const openedBefore = opened.length
await press('return')
if (opened[openedBefore] !== 'orion') fail(`⏎ opened ${opened[openedBefore] ?? '(none)'} instead of the selected teammate`)
if (!store.getInteractiveCoordinatorState().reviewed.includes(orionResults())) fail('opening a teammate transcript did not review its result')
act(() => { store.openInteractiveCoordinator({ sessionId: SESSION_ID, provider: PROVIDER, cwd: smokeRoot, title: 'Smoke chat' }) })
await settle(200)

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
const inspectedWhilePending = opened.length
await press('return')
if (opened.length !== inspectedWhilePending + 1) fail('an unconfirmed request prevented transcript inspection')
if (store.getInteractiveCoordinatorState().open) fail('inspection did not return to the transcript')
await act(async () => store.openInteractiveCoordinator({ sessionId: SESSION_ID, provider: PROVIDER, cwd: smokeRoot, title: 'Smoke chat' }))
await settle(120)
if (store.getInteractiveCoordinatorState().pending?.requestId !== pending?.requestId) fail('closing and reopening discarded the unconfirmed request')
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

const inspectedBefore = opened.length
await press('return')
if (opened.length !== inspectedBefore + 1) fail('ended-run teammate history cannot be inspected')
await act(async () => store.openInteractiveCoordinator({ sessionId: SESSION_ID, provider: PROVIDER, cwd: smokeRoot, title: 'Smoke chat' }))
await settle(120)
await press('e')
await waitFor('fresh team in same chat', () => Boolean(store.getInteractiveCoordinatorState().data?.interactive.enabled && store.getInteractiveCoordinatorState().data?.snapshot?.run.id !== runId))
if (store.getInteractiveCoordinatorState().data?.snapshot?.tasks.length) fail('new team inherited old tasks')
await coordination.stopProtocolRun(store.getInteractiveCoordinatorState().data!.snapshot!.run.id)

console.log('Teammates popover smoke passed (enable, roster activity, background work, teammate notes, content-fit height, alert delivery, interrupt gating, inspect, priority order with id selection, review on open, drafts, continuation, worktrees, unconfirmed gate, turn off)')
process.exit(0)

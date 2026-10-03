/** @jsxImportSource @opentui/react */
// Coordinator sidebar tab smoke: seeds a real Coordinator run (lead + a
// teammate) directly through the external-protocol API — no live provider
// CLI needed — then mounts the full OpenTUI app and drives the `a` toggle,
// verifying the tab shows roles/relationships and row navigation works.
// Full-App-mounted smokes use console.error + process.exit(1) instead of
// throwing (matching coordSmoke.tsx) — the app's own live timers (session
// polls, heartbeats) keep the process alive past an uncaught throw.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { execFileSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-sidebar-smoke-')))
// Completing a task reads the checkout's baseline, so the run needs a repo.
for (const args of [['init', '-q'], ['-c', 'user.email=smoke@example.com', '-c', 'user.name=smoke', 'commit', '-q', '--allow-empty', '-m', 'init']]) {
  execFileSync('git', args)
}

const coordination = await import('../../lib/agentCoordination')
const leadResult = await coordination.createExternalProtocolRun({
  prompt: 'Coordinator sidebar smoke run',
  provider: 'codex',
  baseCwd: process.cwd(),
  participantName: 'Sidebar Lead',
  maxAgents: 3,
})
const nova = (await coordination.joinExternalProtocolRun({
  runId: leadResult.participant.runId,
  provider: 'claude',
  cwd: process.cwd(),
  participantName: 'Sidebar Nova',
})).participant

const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const { captureCharFrame } = setup

await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 2500))
})

act(() => { setup.mockInput.pressKey('a') })
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 250))
})
let frame = captureCharFrame()
if (!frame.includes('COORDINATOR')) {
  console.error(`'a' did not switch the sidebar to the Coordinator tab:\n${frame}`)
  process.exit(1)
}
if (!frame.includes('◆')) {
  console.error(`Coordinator tab did not render the lead glyph:\n${frame}`)
  process.exit(1)
}
if (!frame.includes('Sidebar Lead') || !frame.includes('Sidebar Nova')) {
  console.error(`Coordinator tab did not list both roster agents:\n${frame}`)
  process.exit(1)
}

// A local ledger mutation must refresh the visible sidebar from the change
// signal, without waiting for the 30s reconciliation poll.
let orion!: Awaited<ReturnType<typeof coordination.joinExternalProtocolRun>>['participant']
await act(async () => {
  orion = (await coordination.joinExternalProtocolRun({
    runId: leadResult.participant.runId,
    provider: 'pi',
    cwd: process.cwd(),
    participantName: 'Sidebar Orion',
  })).participant
  await new Promise((resolve) => setTimeout(resolve, 100))
})
const pushDeadline = Date.now() + 1_000
while (Date.now() < pushDeadline && !captureCharFrame().includes('Sidebar Orion')) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}
frame = captureCharFrame()
if (!frame.includes('Sidebar Orion')) {
  console.error(`Coordinator sidebar did not react to the pushed run change:\n${frame}`)
  process.exit(1)
}

// j moves the selection off the lead row and onto the teammate row.
act(() => { setup.mockInput.pressKey('j') })
await act(async () => { await setup.flush() })
frame = captureCharFrame()
if (!frame.includes('▎├─ Sidebar Nova')) {
  console.error(`j did not move the Coordinator selection onto the teammate row:\n${frame}`)
  process.exit(1)
}

// Herdr's Goto-picker states: Nova asks the lead a question (blocked on the
// user) and Orion finishes a task nobody has reviewed (done, not idle).
await act(async () => {
  await coordination.sendExternalProtocolMessage(nova, { to: 'lead', body: 'Strict or compatible parser?', replyRequired: true })
  const task = await coordination.createExternalProtocolTask(leadResult.participant, { assignTo: orion.agentId, title: 'Orion survey', detail: 'Report' })
  const taskId = task.task!.id
  await coordination.claimExternalProtocolTask(orion, taskId).catch(() => {})
  await coordination.completeExternalProtocolTask(orion, { taskId, summary: 'Survey done' })
})
async function settle(until: (frame: string) => boolean, what: string) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && !until(captureCharFrame())) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
  const current = captureCharFrame()
  if (!until(current)) {
    console.error(`${what}:\n${current}`)
    process.exit(1)
  }
  return current
}
frame = await settle((f) => f.includes('! needs you') && f.includes('✓ result to review'),
  'the rail did not mark a teammate waiting on the lead and one with an unreviewed result')
if (!frame.includes('COORDINATOR 3') || !frame.includes('!1 ✓1')) {
  console.error(`the rail header did not count blocked and unreviewed agents:\n${frame}`)
  process.exit(1)
}

// f cycles all → blocked → working → done → idle → all. Filtering to
// blocked keeps Nova (still selected) and drops Orion.
act(() => { setup.mockInput.pressKey('f') })
frame = await settle((f) => f.includes('BLOCKED 1/3'), 'f did not switch the rail to the blocked filter')
if (!frame.includes('Sidebar Nova') || frame.includes('Sidebar Orion')) {
  console.error(`the blocked filter did not list exactly the blocked teammate:\n${frame}`)
  process.exit(1)
}
// Blocked counts stay in the header under any filter.
act(() => { setup.mockInput.pressKey('f') })
frame = await settle((f) => f.includes('WORKING 0/3'), 'f did not advance to the working filter')
if (!frame.includes('!1')) {
  console.error(`a filter hid the count of agents waiting on the user:\n${frame}`)
  process.exit(1)
}
// Done: Nova's row is filtered out, so the selection must follow to Orion —
// Enter must never open a row the list no longer shows.
act(() => { setup.mockInput.pressKey('f') })
frame = await settle((f) => f.includes('DONE 1/3'), 'f did not advance to the done filter')
if (!frame.includes('▎└─ Sidebar Orion') || frame.includes('Sidebar Nova')) {
  console.error(`the done filter did not list and select the teammate with a result:\n${frame}`)
  process.exit(1)
}
act(() => { setup.mockInput.pressKey('f') })
await settle((f) => f.includes('IDLE 1/3'), 'f did not advance to the idle filter')
act(() => { setup.mockInput.pressKey('f') })
frame = await settle((f) => f.includes('COORDINATOR 3'), 'f did not wrap back to all')
if (!frame.includes('Sidebar Nova') || !frame.includes('Sidebar Orion')) {
  console.error(`the all filter did not list every agent again:\n${frame}`)
  process.exit(1)
}

act(() => { setup.mockInput.pressKey('a') })
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
frame = captureCharFrame()
if (!frame.includes('SESSIONS')) {
  console.error(`'a' did not switch back to the Sessions tab:\n${frame}`)
  process.exit(1)
}

console.log('Coordinator sidebar tab smoke passed')
process.exit(0)

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
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-sidebar-smoke-')))

const coordination = await import('../../lib/agentCoordination')
const leadResult = await coordination.createExternalProtocolRun({
  prompt: 'Coordinator sidebar smoke run',
  provider: 'codex',
  baseCwd: process.cwd(),
  participantName: 'Sidebar Lead',
  maxAgents: 3,
})
await coordination.joinExternalProtocolRun({
  runId: leadResult.participant.runId,
  provider: 'claude',
  cwd: process.cwd(),
  participantName: 'Sidebar Nova',
})

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
await act(async () => {
  await coordination.joinExternalProtocolRun({
    runId: leadResult.participant.runId,
    provider: 'pi',
    cwd: process.cwd(),
    participantName: 'Sidebar Orion',
  })
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

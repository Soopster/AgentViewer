/** @jsxImportSource @opentui/react */
// The coordinator rail must update WITHOUT re-rendering the root.
//
// This is the whole point of moving it behind a slot: while the rail lived in
// `App.tsx`, its three `useState`s meant every coordinator refresh re-rendered
// the entire app — the mounted transcript included — to repaint a list in the
// left rail. The frame looks identical either way, which is why this could
// regress silently — so the assertion reads `readRootRenderCount()` rather than
// the screen. A Profiler cannot stand in for it: a commit caused by the
// memoized rail alone still fires a Profiler wrapping the root.
//
// Full-App-mounted smokes use console.error + process.exit(1) rather than
// throwing: the app's own timers keep the process alive past an uncaught throw.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-slot-smoke-')))

const coordination = await import('../../lib/agentCoordination')
const leadResult = await coordination.createExternalProtocolRun({
  prompt: 'Coordinator slot smoke run',
  provider: 'codex',
  baseCwd: process.cwd(),
  participantName: 'Slot Lead',
  maxAgents: 3,
})
await coordination.joinExternalProtocolRun({
  runId: leadResult.participant.runId,
  provider: 'claude',
  cwd: process.cwd(),
  participantName: 'Slot Nova',
})

const store = await import('./coordinatorStore')
const { slotContributionIds } = await import('./slots')
const { default: OpenTuiApp, readRootRenderCount } = await import('./App')

if (!slotContributionIds('sidebar_content').includes('coordinator-rail')) {
  console.error(`the coordinator rail did not register into the sidebar_content slot: ${
    slotContributionIds('sidebar_content').join(', ') || '(none)'}`)
  process.exit(1)
}

const setup = await testRender(
  <OpenTuiApp />,
  { width: 120, height: 40, kittyKeyboard: true },
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

await settle(2500)
act(() => { setup.mockInput.pressKey('a') })
await settle(400)

let frame = captureCharFrame()
if (!frame.includes('COORDINATOR') || !frame.includes('Slot Nova')) {
  console.error(`'a' did not open the coordinator rail through the slot:\n${frame}`)
  process.exit(1)
}

const agentKeys = store.getCoordinatorState().agentEntries.map((entry) => entry.key)
if (agentKeys.length < 2) {
  console.error(`expected the seeded run to contribute at least two agents, got ${agentKeys.length}`)
  process.exit(1)
}

// Let the app go quiet first: its own session/activity polls commit the root on
// their own schedule, and counting those as slot-driven renders would make this
// assertion meaningless.
await settle(1200)
const before = readRootRenderCount()
await act(async () => {
  store.setCoordinatorSelectedKey(agentKeys[1]!)
  await setup.flush()
})
await act(async () => { await setup.flush() })
const rootRendersFromSelection = readRootRenderCount() - before

frame = captureCharFrame()
if (!frame.includes('▎')) {
  console.error(`selecting a coordinator agent did not paint the selection marker:\n${frame}`)
  process.exit(1)
}
if (rootRendersFromSelection !== 0) {
  console.error(
    `a coordinator store update re-rendered the root ${rootRendersFromSelection} time(s); `
    + 'the rail must re-render alone (did its state move back into App.tsx, or did the root '
    + 'start subscribing to more than the header counts?)',
  )
  process.exit(1)
}

console.log('Coordinator slot isolation smoke passed')
process.exit(0)

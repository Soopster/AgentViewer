/** @jsxImportSource @opentui/react */
// Integration smoke for the running-registry surfaces: injects a fake running
// turn into the REAL in-process registry and asserts the mounted app reacts —
// running, Stop-hook waiting, and explicit attention states all reach the fleet
// strip. This exercises the reattach/attention/fleet plumbing end to end
// without spending a provider turn.
//
// Runs against a temp data dir (state files resolve from process.cwd()) so the
// user's persisted TUI preferences — e.g. focusMode, which hides the strip —
// can't skew the assertions. App must therefore be imported AFTER chdir.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { setRunningSession, clearRunningSession, clearWaitingSession, setWaitingSession } from '../../lib/sessionRuntime'
import { postViewerAttention } from '../../lib/viewerAttention'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-fleet-smoke-')))
// Coordinator workers and attached TUI shells inherit this variable. The
// smoke injects the in-process registry deliberately, so a remote attachment
// would make it observe the daemon's unrelated registry instead.
delete process.env.AGENT_VIEWER_ATTACH
const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 160, height: 42, kittyKeyboard: true })
const { captureCharFrame, captureSpans } = setup

const settle = async (ms: number) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
    await setup.flush()
  })
}

await settle(2000)

const fail = (message: string): never => {
  console.error(message)
  act(() => { setup.renderer.destroy() })
  process.exit(1)
}

const waitForFrame = async (
  description: string,
  predicate: (frame: string) => boolean,
  timeoutMs = 7000,
) => {
  const deadline = Date.now() + timeoutMs
  let frame = captureCharFrame()
  while (!predicate(frame) && Date.now() < deadline) {
    await settle(250)
    frame = captureCharFrame()
  }
  if (!predicate(frame)) {
    fail(`${description}:\n${frame}`)
  }
  return frame
}

const fleetLine = (frame: string) => frame.split('\n').find((line) => line.includes('FLEET')) ?? ''
const fleetNumberColor = (number: number): string | null => {
  const line = captureSpans().lines.find((candidate) => candidate.spans.some((span) => span.text.includes('FLEET')))
  return line?.spans.find((span) => span.text === `${number} `)?.fg.toString() ?? null
}

// A running turn on a session the user is NOT viewing.
act(() => {
  setRunningSession('fleet-smoke-session', {
    provider: 'claude',
    interrupt: async () => {},
  })
})

// Registry poll cadence is 1.5s. Poll the rendered frame instead of relying on
// one fixed delay so a loaded CI worker cannot turn this into a timing test.
let frame = await waitForFrame(
  'Fleet strip did not appear for an injected running session',
  (candidate) => fleetLine(candidate).includes('1 ●'),
)

// The global fleet toggle must hide the row without discarding its entries,
// then restore the same running cell when toggled back on.
act(() => { setup.mockInput.pressKey('a', { shift: true }) })
await settle(100)
if (captureCharFrame().includes('FLEET')) {
  fail(`Shift+A did not hide the fleet strip:\n${captureCharFrame()}`)
}
act(() => { setup.mockInput.pressKey('a', { shift: true }) })
frame = await waitForFrame(
  'Shift+A did not restore the fleet strip',
  (candidate) => fleetLine(candidate).includes('1 ●'),
)

// Focus mode owns the entire reader height, including the fleet row. Leaving
// focus mode must restore the row and its live state rather than resetting it.
act(() => { setup.mockInput.pressKey('z') })
await settle(100)
if (captureCharFrame().includes('FLEET')) {
  fail(`Focus mode did not hide the fleet strip:\n${captureCharFrame()}`)
}
act(() => { setup.mockInput.pressKey('z') })
frame = await waitForFrame(
  'Leaving focus mode did not restore the fleet strip',
  (candidate) => fleetLine(candidate).includes('1 ●'),
)

// Overflow is paged rather than silently truncated. Exercise both accepted
// key shapes, wrap-around, page-local digit selection, and the page clamp when
// the registry shrinks back below the paging threshold.
const overflowSessionIds = Array.from({ length: 10 }, (_, index) => `p${String(index + 1).padStart(2, '0')}`)
act(() => {
  for (const sessionId of overflowSessionIds) {
    setRunningSession(sessionId, { provider: 'claude', interrupt: async () => {} })
  }
})
frame = await waitForFrame(
  'Fleet overflow did not render the first page contract',
  (candidate) => {
    const line = fleetLine(candidate)
    return line.includes('FLEET 1/2') && line.includes('{ } pages') && line.includes('9 ●')
  },
)

// Shift+[ wraps backward from page one to page two.
act(() => { setup.mockInput.pressKey('[', { shift: true }) })
frame = await waitForFrame(
  'Shift+[ did not wrap to the final fleet page',
  (candidate) => {
    const line = fleetLine(candidate)
    return line.includes('FLEET 2/2') && line.includes('1 ● p09') && line.includes('2 ● p10')
  },
)

// Digits select the visible page, not the absolute first nine entries. The
// selected cell's number changes from the dim color to the provider accent.
const unselectedPageTwoColor = fleetNumberColor(1)
act(() => { setup.mockInput.pressKey('1') })
await settle(150)
const selectedPageTwoColor = fleetNumberColor(1)
if (!unselectedPageTwoColor || !selectedPageTwoColor || unselectedPageTwoColor === selectedPageTwoColor) {
  fail(`Fleet page-local digit selection did not highlight entry 10:\n${captureCharFrame()}`)
}

// A literal } is the legacy/raw-terminal form of Shift+] and wraps forward.
act(() => { setup.mockInput.pressKey('}') })
frame = await waitForFrame(
  'Literal } did not wrap to the first fleet page',
  (candidate) => fleetLine(candidate).includes('FLEET 1/2'),
)

act(() => {
  for (const sessionId of overflowSessionIds) clearRunningSession(sessionId)
})
frame = await waitForFrame(
  'Fleet page did not clamp after the registry shrank below ten entries',
  (candidate) => {
    const line = fleetLine(candidate)
    return line.includes('FLEET  ') && line.includes('1 ●') && !line.includes('FLEET 1/') && !line.includes('{ } pages')
  },
)

// A Stop receipt says the foreground turn paused with background work. The
// disappearance must become a waiting cell, not an inferred completion.
act(() => {
  setWaitingSession({
    sessionId: 'fleet-smoke-session',
    provider: 'claude',
    backgroundTasks: [{ id: 'task-1', type: 'local', status: 'running', description: 'indexing' }],
    sessionCrons: [],
  })
  clearRunningSession('fleet-smoke-session')
})
frame = await waitForFrame(
  'Fleet strip should keep a waiting cell after a background-work Stop receipt',
  (candidate) => fleetLine(candidate).includes('1 ◌'),
)
const waitingFleetLine = fleetLine(frame)
if (waitingFleetLine.includes('✓')) {
  fail('Background-work Stop receipt was incorrectly inferred as turn-done')
}

// Explicit MCP attention is higher priority than passive background work: the
// needs-input cell must sort first while the waiting cell remains visible.
act(() => {
  postViewerAttention({ sessionId: 'fleet-smoke-attention', provider: 'claude', title: 'Review the generated plan' })
})
frame = await waitForFrame(
  'Fleet strip did not prioritize explicit viewer attention over background work',
  (candidate) => {
    const line = fleetLine(candidate)
    return line.includes('1 ⚠') && line.includes('2 ◌') && line.indexOf('1 ⚠') < line.indexOf('2 ◌')
  },
)
if (frame.split('\n').filter((line) => line.includes('FLEET')).length !== 1) {
  fail(`Fleet strip consumed more than its one-row layout budget:\n${frame}`)
}

clearRunningSession('fleet-smoke-session')
clearWaitingSession('fleet-smoke-session')
act(() => { setup.renderer.destroy() })
console.log('Fleet/attention registry smoke passed')
process.exit(0)

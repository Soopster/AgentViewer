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
const { default: OpenTuiApp } = await import('./App')

const { captureCharFrame } = await testRender(<OpenTuiApp />, { width: 140, height: 42 })

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

await settle(2000)

// A running turn on a session the user is NOT viewing.
setRunningSession('fleet-smoke-session', {
  provider: 'claude',
  interrupt: async () => {},
})

// Registry poll cadence is 1.5s — give it two ticks.
await settle(3500)
let frame = captureCharFrame()
if (!frame.includes('FLEET')) {
  throw new Error('Fleet strip did not appear for an injected running session')
}

// A Stop receipt says the foreground turn paused with background work. The
// disappearance must become a waiting cell, not an inferred completion.
setWaitingSession({
  sessionId: 'fleet-smoke-session',
  provider: 'claude',
  backgroundTasks: [{ id: 'task-1', type: 'local', status: 'running', description: 'indexing' }],
  sessionCrons: [],
})
clearRunningSession('fleet-smoke-session')
await settle(3500)
frame = captureCharFrame()
if (!frame.includes('FLEET')) {
  throw new Error('Fleet strip should keep a waiting cell after a background-work Stop receipt')
}
if (!frame.includes('◌')) {
  throw new Error('Fleet strip missing the background-work waiting glyph')
}
const waitingFleetLine = frame.split('\n').find((line) => line.includes('FLEET')) ?? ''
if (waitingFleetLine.includes('✓')) {
  throw new Error('Background-work Stop receipt was incorrectly inferred as turn-done')
}

// Explicit in-process MCP attention requests surface as needs-input cells.
clearWaitingSession('fleet-smoke-session')
postViewerAttention({ sessionId: 'fleet-smoke-attention', provider: 'claude', title: 'Review the generated plan' })
await settle(3500)
frame = captureCharFrame()
if (!frame.includes('⚠')) {
  throw new Error('Fleet strip missing explicit viewer-attention request')
}

console.log('Fleet/attention registry smoke passed')
process.exit(0)

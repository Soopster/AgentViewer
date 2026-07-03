/** @jsxImportSource @opentui/react */
// Integration smoke for the running-registry surfaces: injects a fake running
// turn into the REAL in-process registry and asserts the mounted app reacts —
// fleet strip appears, and clearing the turn leaves a completion cell. This
// exercises the reattach/attention/fleet plumbing end to end without spending
// a provider turn.
//
// Runs against a temp data dir (state files resolve from process.cwd()) so the
// user's persisted TUI preferences — e.g. focusMode, which hides the strip —
// can't skew the assertions. App must therefore be imported AFTER chdir.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { setRunningSession, clearRunningSession } from '../../lib/sessionRuntime'

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

// Turn ends in the background → the strip keeps a ✓ completion cell (recorded
// through the attention turn-done path).
clearRunningSession('fleet-smoke-session')
await settle(3500)
frame = captureCharFrame()
if (!frame.includes('FLEET')) {
  throw new Error('Fleet strip should keep a completion cell after the turn ends')
}
if (!frame.includes('✓')) {
  throw new Error('Fleet strip missing the turn-done glyph after clearing the running session')
}

console.log('Fleet/attention registry smoke passed')
process.exit(0)

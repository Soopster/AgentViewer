/** @jsxImportSource @opentui/react */
// Full-app smoke: mounts the real OpenTUI root under the test renderer, lets
// the boot effects settle (theme/provider/session load, running-registry
// poll), and asserts a frame actually rendered. Catches runtime wiring errors
// that the component-level smokes and tsc can't — it exercises the same code
// path `npm run tui` boots, minus the terminal.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Hermetic: state files resolve from process.cwd(), so run against a temp
// data dir rather than the user's real preferences. Import App AFTER chdir.
process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-app-smoke-')))
const { default: OpenTuiApp } = await import('./App')

const { captureCharFrame } = await testRender(<OpenTuiApp />, { width: 120, height: 40 })

await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 2500))
})

const frame = captureCharFrame()
if (!frame || frame.trim().length === 0) {
  throw new Error('Full app rendered an empty frame')
}
if (!frame.includes('COMPOSER')) {
  throw new Error('Full app frame missing the composer dock')
}

console.log('Full App smoke render passed')
// Boot effects leave live timers (session polls, registry reconcile) — exit
// explicitly instead of waiting for them.
process.exit(0)

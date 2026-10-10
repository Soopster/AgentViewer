/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-view-repro-')))
const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40 })

await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)) })

setup.mockInput.pressKey('v')
await act(async () => { await setup.flush() })

let prev = setup.captureCharFrame() ?? ''
for (let i = 0; i < 3; i++) {
  setup.mockInput.pressArrow('down')
  await act(async () => { await setup.flush() })
  const cur = setup.captureCharFrame() ?? ''
  console.log(`down #${i + 1} changed?`, cur !== prev)
  console.log('menu still visible?', cur.includes('TRANSCRIPT VIEW'))
  prev = cur
}

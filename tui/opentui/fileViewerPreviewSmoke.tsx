/** @jsxImportSource @opentui/react */
import React, { act, useEffect, useState } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyntaxStyle } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { FileViewerPopover, type FileViewerKeyEvent } from './FileViewerPopover'

const workspace = await mkdtemp(join(tmpdir(), 'file-viewer-preview-'))
const syntaxStyle = SyntaxStyle.fromStyles({})
let handleKey: (key: FileViewerKeyEvent) => void = () => {}
function Harness() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 20)
    return () => clearInterval(timer)
  }, [])
  return <box><text>{tick}</text><FileViewerPopover
    cwd={workspace} theme={DARK_THEME} width={120} height={30}
    syntaxStyle={syntaxStyle} velocityScrollEnabled={false}
    onClose={() => {}} onToggleVelocityScroll={() => {}}
    onKeyHandlerReady={(handler) => { handleKey = handler }}
  /></box>
}

await writeFile(join(workspace, 'a.txt'), 'FIRST_FILE_CONTENTS')
await writeFile(join(workspace, 'b.txt'), 'SECOND_FILE_CONTENTS')
const setup = await testRender(<Harness />, { width: 120, height: 30 })
async function expectContents(contents: string) {
  const deadline = performance.now() + 3000
  while (performance.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await setup.flush()
    })
    if (setup.captureCharFrame().includes(contents)) return
  }
  throw new Error(`Missing ${contents}:\n${setup.captureCharFrame()}`)
}
try {
  await expectContents('FIRST_FILE_CONTENTS')
  act(() => handleKey({ name: 'down', sequence: '', ctrl: false, shift: false }))
  await expectContents('SECOND_FILE_CONTENTS')
  act(() => handleKey({ name: 'e', sequence: 'e', ctrl: false, shift: false }))
  await expectContents('SECOND_FILE_CONTENTS')
  console.log('fileViewerPreviewSmoke OK — local contents, selection, expansion during parent updates')
} finally {
  act(() => setup.renderer.destroy())
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}

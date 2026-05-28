/** @jsxImportSource @opentui/react */
import React, { act, useState } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { usePaste } from '@opentui/react'

function assertFrameIncludes(frame: string, text: string): void {
  if (!frame.includes(text)) {
    throw new Error(`Expected OpenTUI frame to include "${text}"`)
  }
}

type PasteCapableRenderer = {
  keyInput?: {
    listenerCount?(event: string): number
    processPaste(bytes: Uint8Array): void
  }
}

function SmokeApp() {
  const [pasted, setPasted] = useState('waiting')

  usePaste((event) => {
    event.preventDefault()
    setPasted(new TextDecoder().decode(event.bytes))
  })

  return (
    <box flexDirection="column" width={48} height={6} paddingX={1}>
      <text selectable>Agent Viewer TUI smoke</text>
      <text selectable>{`Paste: ${pasted}`}</text>
    </box>
  )
}

const setup = await testRender(<SmokeApp />, { width: 48, height: 6 })

try {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assertFrameIncludes(setup.captureCharFrame(), 'Agent Viewer TUI smoke')

  const keyInput = (setup.renderer as PasteCapableRenderer).keyInput
  if (!keyInput) throw new Error('OpenTUI test renderer did not expose paste input')
  const pasteListenerCount = keyInput.listenerCount?.('paste') ?? null

  await act(async () => {
    keyInput.processPaste(new TextEncoder().encode('from smoke'))
  })
  await setup.flush()
  const pastedFrame = setup.captureCharFrame()
  if (!pastedFrame.includes('Paste: from smoke')) {
    throw new Error(`Expected paste hook frame update; paste listeners: ${pasteListenerCount ?? 'unknown'}\n${pastedFrame}`)
  }

  console.log('OpenTUI smoke render passed')
} finally {
  act(() => {
    setup.renderer.destroy()
  })
}

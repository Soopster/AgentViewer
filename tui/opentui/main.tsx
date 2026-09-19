/** @jsxImportSource @opentui/react */
import React from 'react'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import OpenTuiApp from './App'
import { startRawHeapSampler, reportWorkerHeap } from './workerHeapProbe'
import { installProcessWarningRouting } from '../../lib/processWarnings'

// A runtime warning prints straight onto the alternate screen; send it to
// OpenTUI's captured console instead.
installProcessWarningRouting((text) => console.warn(text))

// Mouse capture is what makes clicks, the wheel and in-app selection work, and
// it is also what takes the terminal's own selection away — which is the one
// people rely on inside tmux and over SSH. Opting out keeps everything else.
const mouseDisabled = process.env.AGENT_VIEWER_DISABLE_MOUSE === '1'

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  screenMode: 'alternate-screen',
  useMouse: !mouseDisabled,
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
    allKeysAsEscapes: true,
  },
  onDestroy: () => {
    process.exit(0)
  },
})

// The native renderer sends only the cells that changed since the last frame.
// Some hosts (Windows Terminal and other ConPTY terminals) coalesce those
// positioned writes wrongly and leave fragments behind until a resize. This
// asks for a whole-screen repaint every frame instead — more bytes, no residue.
// The flag is the renderer's own resize/resume repaint request; OpenTUI 0.5.11
// has no public switch for it, so it is feature-detected and reported if gone.
if (process.env.AGENT_VIEWER_FULL_REPAINT === '1') {
  const repaintable = renderer as unknown as { forceFullRepaintRequested?: boolean }
  if (typeof repaintable.forceFullRepaintRequested === 'boolean') {
    renderer.setFrameCallback(async () => {
      repaintable.forceFullRepaintRequested = true
    })
  } else {
    console.warn('AGENT_VIEWER_FULL_REPAINT is not supported by this OpenTUI version')
  }
}

createRoot(renderer).render(<OpenTuiApp />)

// Boot footprint of the main isolate (AGENT_VIEWER_TUI_MEM=1 only).
setTimeout(() => reportWorkerHeap('main', true), 4000)
startRawHeapSampler('main')

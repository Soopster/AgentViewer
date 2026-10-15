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
  // Keep the TUI pinned to the terminal's bottom edge while OpenTUI routes
  // explicit assistant output into normal terminal scrollback above it.
  screenMode: 'split-footer',
  footerHeight: process.stdout.rows || 24,
  externalOutputMode: 'capture-stdout',
  useMouse: !mouseDisabled,
  // OpenTUI paces on-demand frames by maxFps (default 60): a scroll that asks
  // for a frame 4ms after the last one waits out the rest of 16.7ms. Frames
  // are still only drawn when something asks for one, so idle cost is unchanged.
  maxFps: 120,
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
    allKeysAsEscapes: true,
  },
  onDestroy: () => {
    process.exit(0)
  },
})

// Keep the split-footer render area full-height after terminal resizes.
renderer.on('resize', () => {
  renderer.footerHeight = renderer.terminalHeight
})

// The native renderer sends only the cells that changed since the last frame.
// Some hosts (Windows Terminal and other ConPTY terminals) coalesce those
// positioned writes wrongly and leave fragments behind until a resize. This
// asks for a whole-screen repaint every frame instead — more bytes, no residue.
// The flag is the renderer's own resize/resume repaint request; OpenTUI
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

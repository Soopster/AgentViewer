/** @jsxImportSource @opentui/react */
import React from 'react'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import OpenTuiApp from './App'
import { TUI_RENDER_POLICY } from './renderPolicy'
import { startRawHeapSampler, reportWorkerHeap } from './workerHeapProbe'
import { installProcessWarningRouting } from '../../lib/processWarnings'
import { installUserKeys, readUserKeyConfig, resolveChords } from './userKeys'
import { COMMANDS } from './app/commands'

// A runtime warning prints straight onto the alternate screen; send it to
// OpenTUI's captured console instead.
installProcessWarningRouting((text) => console.warn(text))

// Mouse capture is what makes clicks, the wheel and in-app selection work, and
// it is also what takes the terminal's own selection away — which is the one
// people rely on inside tmux and over SSH. Opting out keeps everything else.
const mouseDisabled = process.env.AGENT_VIEWER_DISABLE_MOUSE === '1'

// The user's own ⌃K chords (keys.json), installed before the first render.
installUserKeys(resolveChords(readUserKeyConfig(), new Map(COMMANDS.map((command) => [command.id, command.label]))))

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  screenMode: 'alternate-screen',
  useMouse: !mouseDisabled,
  // Bound terminal output on Windows while preserving fast-host navigation.
  maxFps: TUI_RENDER_POLICY.maxFps,
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

// The terminals this TUI holds can be driven from a shell: `agent-viewer terminal …`.
// A socket that cannot be made is not worth a failed launch.
if (process.env.AGENT_VIEWER_TERMINAL_CONTROL !== '0') {
  void import('./terminalControl').then(({ startTerminalControl }) => startTerminalControl()).catch(() => {})
}

createRoot(renderer).render(<OpenTuiApp />)

// Boot footprint of the main isolate (AGENT_VIEWER_TUI_MEM=1 only).
setTimeout(() => reportWorkerHeap('main', true), 4000)
startRawHeapSampler('main')

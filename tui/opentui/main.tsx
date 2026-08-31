/** @jsxImportSource @opentui/react */
import React from 'react'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import OpenTuiApp from './App'
import { startRawHeapSampler, reportWorkerHeap } from './workerHeapProbe'

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  screenMode: 'alternate-screen',
  useMouse: true,
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
    allKeysAsEscapes: true,
  },
  onDestroy: () => {
    process.exit(0)
  },
})

createRoot(renderer).render(<OpenTuiApp />)

// Boot footprint of the main isolate (AGENT_VIEWER_TUI_MEM=1 only).
setTimeout(() => reportWorkerHeap('main', true), 4000)
startRawHeapSampler('main')

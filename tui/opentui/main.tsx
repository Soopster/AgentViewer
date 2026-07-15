/** @jsxImportSource @opentui/react */
import React from 'react'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import OpenTuiApp from './App'

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

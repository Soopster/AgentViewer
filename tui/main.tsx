import React from 'react'
import { render } from 'ink'
import App from './App'

const ENTER_ALT_SCREEN = '\u001B[?1049h\u001B[2J\u001B[H'
const EXIT_ALT_SCREEN = '\u001B[?1049l'

let restored = false

function restoreTerminal() {
  if (restored) return
  restored = true
  process.stdout.write(EXIT_ALT_SCREEN)
}

process.stdout.write(ENTER_ALT_SCREEN)

process.on('exit', restoreTerminal)
process.on('SIGINT', () => {
  restoreTerminal()
  process.exit(0)
})
process.on('SIGTERM', () => {
  restoreTerminal()
  process.exit(0)
})

const app = render(<App />)
app.waitUntilExit().finally(() => {
  restoreTerminal()
})

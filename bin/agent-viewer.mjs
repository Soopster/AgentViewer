#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const command = args[0]

function parseArgs(rawArgs) {
  const forwarded = []
  let port
  let legacy = false

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]

    if (arg === '--legacy' || arg === '-l') {
      legacy = true
      continue
    }

    if (arg === '--port' || arg === '-p') {
      const next = rawArgs[i + 1]
      if (next && !next.startsWith('-')) {
        port = next
        i += 1
        continue
      }
    }

    if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length)
      continue
    }

    if (arg.startsWith('-p=')) {
      port = arg.slice('-p='.length)
      continue
    }

    forwarded.push(arg)
  }

  return { forwarded, port, legacy }
}

function printUsage() {
  console.log(`Usage: npx agent-viewer [web] [options]

Modes:
  (default)  Launch the OpenTUI terminal app via Bun
  web        Launch the Next.js web app

Options:
  -l, --legacy         Launch the legacy Ink terminal app
  -p, --port <port>  Use a custom port in web mode
`)
}

function forwardSignals(child) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal)
    })
  }
}

function trackExit(child) {
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0)
  })
}

function failMissingBun() {
  console.error('OpenTUI requires Bun on PATH. Install Bun, then rerun `npx agent-viewer`.')
  process.exitCode = 1
}

if (command === '-h' || command === '--help' || command === 'help') {
  printUsage()
  process.exitCode = 0
} else if (command === 'web') {
  const { forwarded, port, legacy } = parseArgs(args.slice(1))
  if (legacy) {
    const entrypoint = fileURLToPath(new URL('../tui/main.tsx', import.meta.url))
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...forwarded], {
      stdio: 'inherit',
    })

    child.on('error', (error) => {
      throw error
    })

    forwardSignals(child)
    trackExit(child)
  } else {
    const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url))
    const nextArgs = ['dev', '--hostname', '127.0.0.1']
    if (port) {
      nextArgs.push('--port', port)
    }
    nextArgs.push(...forwarded)

    const child = spawn(process.execPath, [nextBin, ...nextArgs], {
      stdio: 'inherit',
    })

    child.on('error', (error) => {
      throw error
    })

    forwardSignals(child)
    trackExit(child)
  }
} else if (args.includes('--legacy') || args.includes('-l')) {
  const { forwarded } = parseArgs(args)
  const entrypoint = fileURLToPath(new URL('../tui/main.tsx', import.meta.url))
  const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...forwarded], {
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    throw error
  })

  forwardSignals(child)
  trackExit(child)
} else {
  const { forwarded } = parseArgs(args)
  const entrypoint = fileURLToPath(new URL('../tui/opentui/main.tsx', import.meta.url))
  const child = spawn('bun', ['run', entrypoint, ...forwarded], {
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      failMissingBun()
      return
    }

    throw error
  })

  forwardSignals(child)
  trackExit(child)
}

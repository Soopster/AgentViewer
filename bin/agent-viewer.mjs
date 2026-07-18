#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const command = args[0]

function parseArgs(rawArgs) {
  const forwarded = []
  let port
  let legacy = false
  let attach

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

    if (arg === '--attach' || arg === '-a') {
      const next = rawArgs[i + 1]
      if (next && !next.startsWith('-')) {
        attach = next
        i += 1
        continue
      }
    }

    if (arg.startsWith('--attach=')) {
      attach = arg.slice('--attach='.length)
      continue
    }

    forwarded.push(arg)
  }

  return { forwarded, port, legacy, attach }
}

function normalizeAttachUrl(attach) {
  if (!attach) return undefined
  // Bare host:port or port-only shorthands are common; default the scheme.
  if (/^\d+$/.test(attach)) return `http://127.0.0.1:${attach}`
  if (!/^https?:\/\//.test(attach)) return `http://${attach}`
  return attach
}

function printUsage() {
  console.log(`Usage: npx agent-viewer [web] [options]

Modes:
  (default)  Launch the OpenTUI terminal app via Bun
  web        Launch the Next.js web app
  mcp        Run the Claude/Codex stdio MCP bridge

Options:
  -l, --legacy         Launch the legacy Ink terminal app
  -p, --port <port>    Use a custom port in web mode
  -a, --attach <url>   Connect the TUI or MCP bridge to an \`agent-viewer web\` daemon
                       (e.g. --attach 3000 or --attach http://127.0.0.1:3000).
                       Turns run in the daemon and survive TUI restarts.

CLI MCP:
  claude mcp add agent-viewer -- npx -y agent-viewer mcp --attach 3000
  codex mcp add agent-viewer --env AGENT_VIEWER_ATTACH=http://127.0.0.1:3000 -- npx -y agent-viewer mcp
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

function getCaseInsensitiveEnvValue(name) {
  const target = name.toLowerCase()
  for (const key of Object.keys(process.env)) {
    if (key.toLowerCase() === target) {
      const value = process.env[key]
      if (value) return value
    }
  }
  return undefined
}

function getPathEntries() {
  const rawPaths = []
  const seen = new Set()

  for (const key of Object.keys(process.env)) {
    if (key.toLowerCase() === 'path') {
      const value = process.env[key]
      if (value) {
        for (const entry of value.split(path.delimiter)) {
          if (entry && !seen.has(entry)) {
            seen.add(entry)
            rawPaths.push(entry)
          }
        }
      }
    }
  }

  return rawPaths
}

function candidateExecutables(name) {
  if (process.platform !== 'win32') return [name]

  const pathext = (getCaseInsensitiveEnvValue('PATHEXT') ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean)

  const candidates = [name]
  for (const ext of pathext) {
    candidates.push(`${name}${ext.toLowerCase()}`)
    candidates.push(`${name}${ext.toUpperCase()}`)
  }

  return candidates
}

function resolveExecutable(name, extraCandidates = []) {
  const directPath = getCaseInsensitiveEnvValue(`${name.toUpperCase()}_PATH`)
  if (directPath) {
    try {
      accessSync(directPath, fsConstants.F_OK)
      if (statSync(directPath).isFile()) {
        return directPath
      }
    } catch {
      // Fall through to PATH lookup.
    }
  }

  const searchPaths = getPathEntries()
  const candidates = [...candidateExecutables(name), ...extraCandidates]

  for (const basePath of searchPaths) {
    for (const candidate of candidates) {
      const resolvedPath = path.isAbsolute(candidate) ? candidate : path.join(basePath, candidate)
      try {
        accessSync(resolvedPath, fsConstants.F_OK)
        if (statSync(resolvedPath).isFile()) {
          return resolvedPath
        }
      } catch {
        // Keep searching.
      }
    }
  }

  return undefined
}

function resolveBunLauncher() {
  if (process.platform !== 'win32') {
    return { command: resolveExecutable('bun') ?? 'bun', args: [] }
  }

  const bunExecutable = resolveExecutable('bun')
  if (bunExecutable) {
    return { command: bunExecutable, args: [] }
  }

  const bunScript = resolveExecutable('bun', ['bun.ps1'])
  if (bunScript && bunScript.toLowerCase().endsWith('.ps1')) {
    const shell = resolveExecutable('pwsh', ['pwsh.exe']) ?? resolveExecutable('powershell', ['powershell.exe'])
    if (shell) {
      return {
        command: shell,
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bunScript],
      }
    }
  }

  return { command: undefined, args: [] }
}

function failMissingBun() {
  console.error('OpenTUI requires Bun on PATH. Install Bun, then rerun `npx agent-viewer`.')
  if (process.platform === 'win32') {
    console.error('If Bun is already installed, make sure the terminal session inherited the updated PATH and that either `bun.exe` or a PowerShell shim like `bun.ps1` is reachable.')
  }
  process.exitCode = 1
}

if (command === '-h' || command === '--help' || command === 'help') {
  printUsage()
  process.exitCode = 0
} else if (command === 'mcp') {
  const { attach } = parseArgs(args.slice(1))
  const entrypoint = fileURLToPath(new URL('./agent-viewer-mcp.mjs', import.meta.url))
  const attachUrl = normalizeAttachUrl(attach)
  const child = spawn(process.execPath, [entrypoint], {
    stdio: 'inherit',
    env: attachUrl ? { ...process.env, AGENT_VIEWER_ATTACH: attachUrl } : process.env,
  })

  child.on('error', (error) => {
    throw error
  })

  forwardSignals(child)
  trackExit(child)
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
  const { forwarded, attach } = parseArgs(args)
  const entrypoint = fileURLToPath(new URL('../tui/opentui/main.tsx', import.meta.url))
  const bunLauncher = resolveBunLauncher()
  if (!bunLauncher.command) {
    failMissingBun()
  } else {
    const attachUrl = normalizeAttachUrl(attach)
    const child = spawn(bunLauncher.command, [...bunLauncher.args, 'run', entrypoint, ...forwarded], {
      stdio: 'inherit',
      env: attachUrl ? { ...process.env, AGENT_VIEWER_ATTACH: attachUrl } : process.env,
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
}

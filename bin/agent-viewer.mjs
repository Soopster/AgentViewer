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
  let identity
  let ahpPort
  let noAhp = false
  let production = false

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]

    if (arg === '--legacy' || arg === '-l') {
      legacy = true
      continue
    }

    if (arg === '--no-ahp') {
      noAhp = true
      continue
    }

    if (arg === '--production') {
      production = true
      continue
    }

    if (arg === '--ahp-port') {
      const next = rawArgs[i + 1]
      if (next && !next.startsWith('-')) {
        ahpPort = next
        i += 1
        continue
      }
    }

    if (arg.startsWith('--ahp-port=')) {
      ahpPort = arg.slice('--ahp-port='.length)
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

    if (arg === '--identity') {
      const next = rawArgs[i + 1]
      if (next && !next.startsWith('-')) {
        identity = next
        i += 1
        continue
      }
    }

    if (arg.startsWith('--identity=')) {
      identity = arg.slice('--identity='.length)
      continue
    }

    forwarded.push(arg)
  }

  return { forwarded, port, legacy, attach, identity, ahpPort, noAhp, production }
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
  ahp        Run the AHP 0.7/0.6 JSON-RPC host over stdio, TCP, or WebSocket
  coord worker  Run an autonomous bounded Codex/Claude Coordinator worker
  coord doctor  Diagnose daemon, CLI, identity, protocol, and worker health
  coord workers List persistent Coordinator worker registrations
  coord restart Restart a registered worker by name, id, or identity file
  coord logs    Read or follow a registered worker log

Options:
  -l, --legacy         Launch the legacy Ink terminal app
  -p, --port <port>    Use a custom port in web mode
  --ahp-port <port>    AHP WebSocket port in web mode (default: web port + 1)
  --no-ahp             Disable the default AHP Coordinator sidecar
  --production         Run a built Next.js app with \`next start\`
  -a, --attach <url>   Connect the TUI or MCP bridge to an \`agent-viewer web\` daemon
                       (e.g. --attach 3000 or --attach http://127.0.0.1:3000).
                       Turns run in the daemon and survive TUI restarts.

CLI MCP:
  claude mcp add agent-viewer -- npx -y agent-viewer mcp --attach 3000
  codex mcp add agent-viewer --env AGENT_VIEWER_ATTACH=http://127.0.0.1:3000 -- npx -y agent-viewer mcp

AHP host:
  agent-viewer ahp
  agent-viewer ahp --listen 127.0.0.1:8765
  agent-viewer ahp --ws 127.0.0.1:8765

Autonomous Coordinator:
  agent-viewer coord worker --start "goal" --name lead --provider codex --attach 3000
  agent-viewer coord worker --join <run-id> --name claude-1 --provider claude --attach 3000
  agent-viewer coord doctor --json --attach 3000
  agent-viewer coord workers --json
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

function superviseChildren(children) {
  let stopping = false
  const stop = (signal = 'SIGTERM') => {
    if (stopping) return
    stopping = true
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stop(signal))
  }
  for (const child of children) {
    child.on('exit', (code, signal) => {
      process.exitCode ??= code ?? (signal ? 1 : 0)
      stop()
    })
  }
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
  const { attach, identity } = parseArgs(args.slice(1))
  const entrypoint = fileURLToPath(new URL('./agent-viewer-mcp.mjs', import.meta.url))
  const attachUrl = normalizeAttachUrl(attach)
  const child = spawn(process.execPath, [entrypoint], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(attachUrl ? { AGENT_VIEWER_ATTACH: attachUrl } : {}),
      ...(identity ? { AGENT_VIEWER_COORD_IDENTITY_FILE: path.resolve(identity) } : {}),
    },
  })

  child.on('error', (error) => {
    throw error
  })

  forwardSignals(child)
  trackExit(child)
} else if (command === 'ahp') {
  const entrypoint = fileURLToPath(new URL('./agent-viewer-ahp.ts', import.meta.url))
  const bunLauncher = resolveBunLauncher()
  if (!bunLauncher.command) {
    failMissingBun()
  } else {
    const child = spawn(bunLauncher.command, [...bunLauncher.args, 'run', entrypoint, ...args.slice(1)], {
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
} else if (command === 'coord' && args[1] === 'worker') {
  const entrypoint = fileURLToPath(new URL('./agent-viewer-coord-worker.mjs', import.meta.url))
  const child = spawn(process.execPath, [entrypoint, ...args.slice(2)], { stdio: 'inherit' })
  child.on('error', (error) => { throw error })
  forwardSignals(child)
  trackExit(child)
} else if (command === 'coord' && ['doctor', 'workers', 'restart', 'logs'].includes(args[1])) {
  const entrypoint = fileURLToPath(new URL('./agent-viewer-coord-admin.mjs', import.meta.url))
  const child = spawn(process.execPath, [entrypoint, ...args.slice(1)], { stdio: 'inherit' })
  child.on('error', (error) => { throw error })
  forwardSignals(child)
  trackExit(child)
} else if (command === 'web') {
  const { forwarded, port, legacy, ahpPort, noAhp, production } = parseArgs(args.slice(1))
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
    const nextArgs = [production ? 'start' : 'dev', '--hostname', '127.0.0.1']
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

    if (noAhp || process.env.AGENT_VIEWER_COORD_TRANSPORT?.trim().toLowerCase() === 'http') {
      forwardSignals(child)
      trackExit(child)
    } else {
      const bunLauncher = resolveBunLauncher()
      if (!bunLauncher.command) {
        child.kill('SIGTERM')
        failMissingBun()
      } else {
        const webPort = Number(port || process.env.PORT || 3000)
        const resolvedAhpPort = Number(ahpPort || process.env.AGENT_VIEWER_AHP_PORT || webPort + 1)
        if (!Number.isSafeInteger(resolvedAhpPort) || resolvedAhpPort < 1 || resolvedAhpPort > 65535) {
          child.kill('SIGTERM')
          throw new Error(`Invalid AHP port: ${ahpPort || process.env.AGENT_VIEWER_AHP_PORT}`)
        }
        const ahpEntrypoint = fileURLToPath(new URL('./agent-viewer-ahp.ts', import.meta.url))
        const ahp = spawn(
          bunLauncher.command,
          [...bunLauncher.args, 'run', ahpEntrypoint, '--ws', `127.0.0.1:${resolvedAhpPort}`],
          { stdio: 'inherit' },
        )
        ahp.on('error', (error) => {
          child.kill('SIGTERM')
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            failMissingBun()
            return
          }
          throw error
        })
        superviseChildren([child, ahp])
      }
    }
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

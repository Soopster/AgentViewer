#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs'
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
  let host
  let scope

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

    if (arg === '--host') {
      const next = rawArgs[i + 1]
      if (next && !next.startsWith('-')) {
        host = next
        i += 1
        continue
      }
    }

    if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length)
      continue
    }

    if (arg === '--scope') {
      const next = rawArgs[i + 1]
      if (next && !next.startsWith('-')) {
        scope = next
        i += 1
        continue
      }
    }

    if (arg.startsWith('--scope=')) {
      scope = arg.slice('--scope='.length)
      continue
    }

    forwarded.push(arg)
  }

  return { forwarded, port, legacy, attach, identity, ahpPort, noAhp, production, host, scope }
}

// The bind address is fixed for the process's lifetime (you can't rebind a
// listening socket), so this reads the same state file lib/remoteAuth.ts's
// enableRemoteAccess()/disableRemoteAccess() writes, once, at startup —
// toggling remote access in the running app's UI updates the *auth* check
// immediately, but only takes effect on the network bind after a restart.
function resolveWebHostname(override) {
  // An explicit --host is the whole point of the flag: the bind address should
  // be a stated choice, not a side effect of whether remote auth happens to be
  // toggled on. Without it, fall back to the historical inference below.
  if (override) return override
  try {
    const stateFile = fileURLToPath(new URL('../.agent-viewer-data/remote-access.json', import.meta.url))
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (state?.enabled === true) return '0.0.0.0'
  } catch {
    // No state file yet, or unreadable — default to the safe loopback-only bind.
  }
  return '127.0.0.1'
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
  pair       Mint a pairing code for a phone against a running web daemon
  mcp        Run the Claude/Codex stdio MCP bridge
  ahp        Run the published AHP JSON-RPC host over stdio, TCP, or WebSocket
  acp        Run an ACP (agentclientprotocol.com) Agent over stdio
  coord worker  Run an autonomous bounded multi-provider Coordinator worker
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
  --host <address>     Bind address in web mode (default: 127.0.0.1, or 0.0.0.0
                       when remote access is already enabled)
  --scope <scope>      Pairing scope for \`pair\`: full (default) or read-only
  -a, --attach <url>   Connect the TUI or MCP bridge to an \`agent-viewer web\` daemon
                       (e.g. --attach 3000 or --attach http://127.0.0.1:3000).
                       Turns run in the daemon and survive TUI restarts.

Pairing a phone:
  agent-viewer pair                       # against a daemon on port 3000
  agent-viewer pair --attach 4000 --scope read-only

CLI MCP:
  claude mcp add agent-viewer -- npx -y agent-viewer mcp --attach 3000
  codex mcp add agent-viewer --env AGENT_VIEWER_ATTACH=http://127.0.0.1:3000 -- npx -y agent-viewer mcp

AHP host:
  agent-viewer ahp
  agent-viewer ahp --listen 127.0.0.1:8765
  agent-viewer ahp --ws 127.0.0.1:8765

ACP agent (for Zed and other ACP clients — one process per provider):
  agent-viewer acp
  agent-viewer acp --provider codex

Autonomous Coordinator:
  agent-viewer coord worker --start "goal" --playbook <name> --name lead --provider codex --max-agents 4 --attach 3000
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


// `agent-viewer pair` — the headless path to adding a device. A daemon started
// with `agent-viewer web` has no window to open the settings popover in, so
// this mints a pairing code over its own HTTP API and prints the URL plus a
// scannable QR right in the terminal.
async function runPairCommand(rawArgs) {
  const { attach, scope, port } = parseArgs(rawArgs)
  const base = normalizeAttachUrl(attach || port || process.env.AGENT_VIEWER_ATTACH || '3000')
  const requestedScope = scope === 'read-only' || scope === 'full' ? scope : 'full'

  let state
  try {
    const response = await fetch(new URL('/api/remote-access', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pair', scope: requestedScope }),
    })
    if (!response.ok) {
      console.error(`Pairing failed: ${response.status} ${response.statusText}`)
      console.error(`Is an \`agent-viewer web\` daemon running at ${base}?`)
      process.exitCode = 1
      return
    }
    state = await response.json()
  } catch (error) {
    console.error(`Could not reach Agent Viewer at ${base}: ${error?.message ?? error}`)
    console.error('Start one with `agent-viewer web`, or point at it with --attach <url|port>.')
    process.exitCode = 1
    return
  }

  if (!state?.pairing?.token) {
    console.error('The daemon did not return a pairing code.')
    process.exitCode = 1
    return
  }

  const endpoints = Array.isArray(state.endpoints) ? state.endpoints : []
  const chosen = endpoints.find((entry) => entry.id === state.defaultId) ?? endpoints[0]
  if (!chosen) {
    console.error('No reachable network address — connect this machine to a network and retry.')
    process.exitCode = 1
    return
  }

  const origin = chosen.https ? `https://${chosen.host}` : `http://${chosen.host}:${state.port}`
  // The code rides in the fragment so it never reaches the server; see
  // app/pair/page.tsx.
  const url = `${origin}/pair#token=${encodeURIComponent(state.pairing.token)}`
  const expiresIn = Math.max(0, Math.round((Date.parse(state.pairing.expiresAt) - Date.now()) / 1000))

  try {
    const { default: qrcode } = await import('qrcode')
    console.log(await qrcode.toString(url, { type: 'terminal', small: true }))
  } catch {
    // No qrcode module (a pruned install) — the URL alone is still usable.
  }

  console.log(url)
  console.log('')
  console.log(`Scope:   ${state.pairing.scope}`)
  console.log(`Expires: in ${Math.floor(expiresIn / 60)}m ${expiresIn % 60}s, single use`)
  if (endpoints.length > 1) {
    console.log('')
    console.log('Other addresses this machine answers on:')
    for (const entry of endpoints) {
      if (entry.id === chosen.id) continue
      const other = entry.https ? `https://${entry.host}` : `http://${entry.host}:${state.port}`
      console.log(`  ${other}  (${entry.label})`)
    }
  }
}

if (command === '-h' || command === '--help' || command === 'help') {
  printUsage()
  process.exitCode = 0
} else if (command === 'pair') {
  await runPairCommand(args.slice(1))
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
} else if (command === 'acp') {
  const entrypoint = fileURLToPath(new URL('./agent-viewer-acp.ts', import.meta.url))
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
} else if (command === 'coord') {
  const sub = args[1]
  if (sub && sub !== '-h' && sub !== '--help') {
    console.error(`Unknown coord subcommand: ${sub}`)
    process.exitCode = 1
  } else {
    process.exitCode = 0
  }
  console.log(`Usage:
  agent-viewer coord worker  Run an autonomous bounded multi-provider Coordinator worker
  agent-viewer coord doctor  Diagnose daemon, CLI, identity, protocol, and worker health
  agent-viewer coord workers List persistent Coordinator worker registrations
  agent-viewer coord restart Restart a registered worker by name, id, or identity file
  agent-viewer coord logs    Read or follow a registered worker log

Run \`agent-viewer coord <subcommand> --help\` for subcommand-specific options.`)
} else if (command === 'web') {
  const { forwarded, port, legacy, ahpPort, noAhp, production, host } = parseArgs(args.slice(1))
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
    // A packaged app (e.g. the Tauri desktop shell) ships `next build`'s
    // pruned `output: 'standalone'` tree instead of a full node_modules/next
    // install — run its self-contained server.js directly rather than
    // through the `next` CLI, which standalone builds don't include.
    const standaloneServer = fileURLToPath(new URL('../.next/standalone/server.js', import.meta.url))
    const webPort = String(port || process.env.PORT || 3000)
    const hostname = resolveWebHostname(host)
    let child

    if (production && existsSync(standaloneServer)) {
      child = spawn(process.execPath, [standaloneServer, ...forwarded], {
        stdio: 'inherit',
        env: { ...process.env, PORT: webPort, HOSTNAME: hostname },
      })
    } else {
      const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url))
      const nextArgs = [production ? 'start' : 'dev', '--hostname', hostname, '--port', webPort, ...forwarded]
      child = spawn(process.execPath, [nextBin, ...nextArgs], {
        stdio: 'inherit',
      })
    }

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
        const resolvedAhpPort = Number(ahpPort || process.env.AGENT_VIEWER_AHP_PORT || Number(webPort) + 1)
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

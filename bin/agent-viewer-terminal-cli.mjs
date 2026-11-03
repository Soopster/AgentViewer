#!/usr/bin/env node

// `agent-viewer terminal <verb>` — the terminals a running TUI holds, from a shell.
//
// herdr's `pane list|read|send-text|send-keys|run|wait` for this app. It talks to
// the TUI's own control socket (tui/opentui/terminalControl.ts), not the web
// daemon: the shells live in the TUI process. JSON on stdout; a failure is JSON on
// stderr with exit 1, a usage error exits 2, a `wait` that timed out exits 3.

import { readdirSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export const TERMINAL_CLI_VERBS = ['list', 'read', 'send', 'keys', 'run', 'wait']
const EXIT_TIMEOUT = 3
const POLL_MS = 500
const WAIT_UNTIL = ['working', 'blocked', 'idle', 'exited']

class UsageError extends Error {}

const USAGE = `Usage: agent-viewer terminal <verb> [options]

  list                               Every shell and process the TUI holds, with an agent's state
  read <id> [--lines n] [--scrollback]
                                     The screen (or the last n lines); --scrollback includes history
  send <id> <text> [--enter]         Type text; --enter presses Enter after it
  keys <id> <key>...                 Press keys: Enter Esc Tab Space BSpace Up Down Left Right
                                     Home End PageUp PageDown F1-F12, a character, C-c M-b S-Tab
  run <id> -- <command> [args...]    Run a command line in a shell (args are quoted for you)
  run <id> --command "<line>"        Run one shell line exactly as written
  wait <id> --until working|blocked|idle|exited [--timeout ms]
                                     Exit 0 when reached, 3 on timeout. working/blocked/idle read
                                     a coding agent running in the terminal; exited is the shell's

Options:
  --pid <pid>       Which TUI, when several are running (default: the only one)
  --compact         One-line JSON (default when stdout is not a terminal)

A TUI must be running (\`agent-viewer\`). Ids come from \`list\`.`

export function controlDir(env = process.env) {
  if (env.AGENT_VIEWER_CONTROL_DIR) return env.AGENT_VIEWER_CONTROL_DIR
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  return path.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `agent-viewer-${uid}`)
}

export function parseTerminalCliArgs(argv, booleans = new Set(['enter', 'scrollback', 'compact'])) {
  const positionals = []
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') { positionals.push(...argv.slice(index + 1)); break }
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const equals = arg.indexOf('=')
    const key = (equals > 0 ? arg.slice(2, equals) : arg.slice(2)).replace(/-/g, '_')
    if (equals > 0) { flags[key] = arg.slice(equals + 1); continue }
    const next = argv[index + 1]
    if (booleans.has(key) || next === undefined || next.startsWith('--')) { flags[key] = true; continue }
    flags[key] = next
    index += 1
  }
  return { positionals, flags }
}

function exchange(socketPath, request, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let buffer = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('The TUI did not answer in time.')) }, timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => { buffer += chunk })
    socket.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(buffer)) } catch { reject(new Error('The TUI sent an unreadable reply.')) } })
    socket.on('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

/** The live TUI sockets in the directory; a stale one (its process gone) is skipped. */
export function findControlSockets(dir) {
  let names = []
  try { names = readdirSync(dir) } catch { return [] }
  return names.flatMap((name) => {
    const match = /^terminal-(\d+)\.(sock|json)$/.exec(name)
    if (!match) return []
    try { process.kill(Number(match[1]), 0) } catch { return [] }
    // Windows: the file names a pipe; elsewhere the file is the socket.
    if (match[2] === 'json') {
      try { return [{ pid: Number(match[1]), socketPath: JSON.parse(readFileSync(path.join(dir, name), 'utf8')).pipe }] } catch { return [] }
    }
    return [{ pid: Number(match[1]), socketPath: path.join(dir, name) }]
  })
}

function pickSocket(dir, flags) {
  const sockets = findControlSockets(dir)
  if (sockets.length === 0) throw new Error('No running TUI to talk to. Start `agent-viewer`, and leave AGENT_VIEWER_TERMINAL_CONTROL unset.')
  if (flags.pid !== undefined) {
    const found = sockets.find((entry) => String(entry.pid) === String(flags.pid))
    if (!found) throw new Error(`No TUI with pid ${flags.pid}. Running: ${sockets.map((entry) => entry.pid).join(', ')}.`)
    return found.socketPath
  }
  if (sockets.length > 1) throw new Error(`Several TUIs are running (${sockets.map((entry) => entry.pid).join(', ')}); pick one with --pid.`)
  return sockets[0].socketPath
}

function need(positional, what) {
  if (!positional) throw new UsageError(`${what} is required.`)
  return positional
}

export async function runTerminalCli(argv, env = process.env) {
  const { positionals, flags } = parseTerminalCliArgs(argv)
  const [verb, ...rest] = positionals
  if (!verb || flags.help) { console.log(USAGE); return 0 }
  if (!TERMINAL_CLI_VERBS.includes(verb)) throw new UsageError(`Unknown terminal verb: ${verb}`)
  const socketPath = pickSocket(controlDir(env), flags)
  const ask = async (request) => {
    const reply = await exchange(socketPath, request)
    if (!reply.ok) throw new Error(reply.error)
    const { ok, ...rest } = reply
    return rest
  }
  let result
  let code = 0
  if (verb === 'list') result = await ask({ op: 'list' })
  else if (verb === 'read') {
    result = await ask({ op: 'read', id: need(rest[0], 'A terminal id'), scrollback: flags.scrollback === true, ...(flags.lines !== undefined ? { lines: Number(flags.lines) } : {}) })
  } else if (verb === 'send') {
    const text = rest.slice(1).join(' ')
    if (!text && !flags.enter) throw new UsageError('send needs the text to type.')
    result = await ask({ op: 'send', id: need(rest[0], 'A terminal id'), text, enter: flags.enter === true })
  } else if (verb === 'keys') {
    if (rest.length < 2) throw new UsageError('keys needs an id and at least one key.')
    result = await ask({ op: 'keys', id: rest[0], keys: rest.slice(1) })
  } else if (verb === 'run') {
    const id = need(rest[0], 'A terminal id')
    if (typeof flags.command === 'string') result = await ask({ op: 'run', id, command: flags.command })
    else if (rest.length > 1) result = await ask({ op: 'run', id, argv: rest.slice(1) })
    else throw new UsageError('run needs `-- <command> [args...]` or --command "<line>".')
  } else {
    const id = need(rest[0], 'A terminal id')
    const until = String(flags.until ?? '')
    if (!WAIT_UNTIL.includes(until)) throw new UsageError(`--until must be one of ${WAIT_UNTIL.join(', ')}.`)
    const timeoutMs = flags.timeout !== undefined ? Number(flags.timeout) : 0
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity
    for (;;) {
      const state = await ask({ op: 'state', id })
      const reached = until === 'exited' ? state.status !== 'running' && state.status !== 'stopping' : state.agentState === until
      if (reached) { result = { reached: true, ...state }; break }
      if (Date.now() >= deadline) { result = { reached: false, ...state }; code = EXIT_TIMEOUT; break }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }
  console.log(flags.compact || !process.stdout.isTTY ? JSON.stringify(result) : JSON.stringify(result, null, 2))
  return code
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTerminalCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error) => {
      const usage = error instanceof UsageError
      console.error(usage ? `${error.message}\n\n${USAGE}` : JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      process.exitCode = usage ? 2 : 1
    },
  )
}

// A local control socket on the running TUI, so a script — or another agent — can
// drive the terminals the TUI holds: list them, read their screens, type into
// them, press keys, run a command (herdr's `pane list|read|send-text|send-keys|run`).
//
// Shells and processes live in THIS process (`shellStore`, `processStore`), which
// the web daemon cannot see, so the daemon's routes cannot reach them; a socket on
// the TUI can. It is the user's only: the directory is 0700, the socket 0600, and a
// peer is the same user or it is not connected at all. One TUI, one socket
// (`terminal-<pid>.sock`); the CLI finds the live ones in the directory.
//
// A request is one JSON line, the reply one JSON line. The stores are loaded on the
// first request that needs them, so a TUI nobody scripts never pays for the PTY bridge.

import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { encodeTerminalKey, type TerminalKey } from '../../lib/terminalKeys'
import { shellQuoteArgv } from './userKeys'
import { shellDialectFor } from '../../lib/shellQuote'
import { encodeTerminalPrompt } from './terminalPrompt'

export type ControlRequest = {
  op: 'list' | 'read' | 'send' | 'keys' | 'run' | 'state'
  id?: string
  lines?: number
  scrollback?: boolean
  text?: string
  enter?: boolean
  keys?: string[]
  argv?: string[]
  command?: string
}
export type ControlReply = { ok: true; [key: string]: unknown } | { ok: false; error: string }

export function terminalControlDir(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENT_VIEWER_CONTROL_DIR) return env.AGENT_VIEWER_CONTROL_DIR
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  return path.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `agent-viewer-${uid}`)
}

const NAMED_KEYS: Record<string, string> = {
  enter: 'return', return: 'return', esc: 'escape', escape: 'escape', tab: 'tab', space: ' ', bspace: 'backspace', backspace: 'backspace',
  up: 'up', down: 'down', left: 'left', right: 'right', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown', pgup: 'pageup', pgdn: 'pagedown',
  delete: 'delete', del: 'delete', insert: 'insert',
}

/** `Enter`, `C-c`, `M-b`, `S-Tab`, `C-Left`, `F5`, or a single character → the key the encoder takes. */
export function parseKeySpec(spec: string): TerminalKey {
  let rest = spec
  const key: TerminalKey = { name: '', ctrl: false, shift: false, meta: false }
  for (;;) {
    const match = /^([CMS])-(.+)$/i.exec(rest)
    if (!match) break
    const flag = match[1].toUpperCase()
    if (flag === 'C') key.ctrl = true
    else if (flag === 'M') key.meta = true
    else key.shift = true
    rest = match[2]
  }
  const lower = rest.toLowerCase()
  if (/^f([1-9]|1[0-2])$/.test(lower)) key.name = lower
  else if (lower in NAMED_KEYS) key.name = NAMED_KEYS[lower]
  else if ([...rest].length === 1) { key.name = rest.toLowerCase(); if (!key.ctrl && !key.meta) key.sequence = rest }
  else throw new Error(`Unknown key "${spec}". Use Enter, Esc, Tab, Space, BSpace, arrows, Home, End, PageUp, PageDown, F1-F12, a character, or C-/M-/S- combinations.`)
  return key
}

/** The bytes a key list sends. A key the encoder cannot express is an error, not silence. */
export function encodeKeySpecs(specs: readonly string[], cursorKeysApp: boolean): string {
  return specs.map((spec) => {
    const parsed = parseKeySpec(spec)
    const bytes = parsed.name === 'return' ? '\r' : encodeTerminalKey(parsed, { cursorKeysApp })
    if (bytes === null) throw new Error(`"${spec}" has no terminal encoding`)
    return bytes
  }).join('')
}

async function handle(request: ControlRequest): Promise<ControlReply> {
  const shells = await import('./shellStore')
  const processes = await import('./processStore')
  const { readShellAgentState } = await import('../../plugins/terminal/tui/shellAgentState')
  const { readVisibleScreenText, readAllScreenText } = await import('../../plugins/terminal/tui/shellScreen')
  type Source = Parameters<typeof readVisibleScreenText>[0]

  const shellView = (shell: ReturnType<typeof shells.getShells>[number]) => {
    const agent = shell.status === 'running' ? readShellAgentState(shell) : null
    return { id: shell.id, kind: 'shell', name: shell.name, cwd: shell.cwd, status: shell.status, title: shell.title, cols: shell.cols, rows: shell.rows, exitCode: shell.exitCode, ...(agent ? { agent: agent.agent, agentState: agent.state } : {}) }
  }
  const findShell = (id: string | undefined) => shells.getShells().find((entry) => entry.id === id)
  const findProcess = (id: string | undefined) => processes.getProcesses().find((entry) => entry.id === id)

  if (request.op === 'list') {
    return {
      ok: true,
      terminals: [
        ...shells.getShells().map(shellView),
        ...processes.getProcesses().map((entry) => ({ id: entry.id, kind: 'process', name: entry.name, command: entry.command, cwd: entry.cwd, status: entry.status, exitCode: entry.exitCode })),
      ],
    }
  }
  if (!request.id) return { ok: false, error: 'id is required' }

  const process_ = findProcess(request.id)
  if (process_ && (request.op === 'read' || request.op === 'state')) {
    if (request.op === 'state') return { ok: true, id: process_.id, kind: 'process', status: process_.status, exitCode: process_.exitCode }
    const lines = process_.lines.slice(-(request.lines ?? 40))
    return { ok: true, id: process_.id, kind: 'process', lines }
  }
  const shell = findShell(request.id)
  if (!shell) return { ok: false, error: `No terminal "${request.id}". \`agent-viewer terminal list\` shows the open ones.` }
  if (request.op === 'state') return { ok: true, ...shellView(shell) }

  const term = shells.shellTerminal(shell.id)
  if (request.op === 'read') {
    if (!term) return { ok: false, error: `${shell.id} has no screen` }
    const all = request.scrollback ? readAllScreenText(term as unknown as Source) : readVisibleScreenText(term as unknown as Source)
    // Trailing blank rows are the unused part of the screen, not output.
    while (all.length > 0 && all[all.length - 1].trim() === '') all.pop()
    return { ok: true, id: shell.id, lines: request.lines ? all.slice(-request.lines) : all }
  }
  if (shell.status !== 'running') return { ok: false, error: `${shell.id} is ${shell.status}, not running` }
  if (request.op === 'send') {
    if (typeof request.text !== 'string') return { ok: false, error: 'text is required' }
    // A multi-line text is one paste when the program asked for brackets, so it does not run line by line.
    shells.writeShell(shell.id, encodeTerminalPrompt(request.text, term?.bracketedPaste() ?? false, Boolean(request.enter)))
    return { ok: true, id: shell.id, sent: request.text.length }
  }
  if (request.op === 'keys') {
    if (!Array.isArray(request.keys) || request.keys.length === 0) return { ok: false, error: 'keys is required' }
    const bytes = encodeKeySpecs(request.keys, term?.cursorKeysApp() ?? false)
    shells.writeShell(shell.id, bytes)
    return { ok: true, id: shell.id, sent: request.keys.length }
  }
  if (request.op === 'run') {
    const line = typeof request.command === 'string' ? request.command : Array.isArray(request.argv) && request.argv.length > 0 ? shellQuoteArgv(request.argv, shellDialectFor(shell.name)) : ''
    if (!line.trim()) return { ok: false, error: 'argv or command is required' }
    if (/[\r\n]/.test(line)) return { ok: false, error: 'a command is one line; use send for text' }
    shells.writeShell(shell.id, `${line}\r`)
    return { ok: true, id: shell.id, ran: line }
  }
  return { ok: false, error: `Unknown op "${String((request as { op?: unknown }).op)}"` }
}

export async function respondToControlRequest(line: string): Promise<ControlReply> {
  let request: ControlRequest
  try { request = JSON.parse(line) as ControlRequest } catch { return { ok: false, error: 'request is not valid JSON' } }
  try { return await handle(request) } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
}

const MAX_REQUEST_BYTES = 1_000_000

/**
 * Where a TUI listens. POSIX: a Unix socket in the 0700 directory. Windows has no Unix sockets
 * worth relying on, so it listens on a named pipe (private to the user by default) and leaves a
 * `terminal-<pid>.json` naming it, which is what the CLI finds.
 */
export function controlEndpoint(dir: string, pid: number, platform: NodeJS.Platform = process.platform): { listenPath: string; registryFile: string } {
  return platform === 'win32'
    ? { listenPath: `\\\\.\\pipe\\agent-viewer-terminal-${pid}`, registryFile: path.join(dir, `terminal-${pid}.json`) }
    : { listenPath: path.join(dir, `terminal-${pid}.sock`), registryFile: path.join(dir, `terminal-${pid}.sock`) }
}

export async function startTerminalControl(dir = terminalControlDir()): Promise<{ socketPath: string; close: () => void }> {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
  // A socket left by a TUI that died is dead weight; a live one answers and is left alone.
  for (const entry of readdirSync(dir)) {
    if (!/^terminal-\d+\.(sock|json)$/.test(entry)) continue
    const pid = Number(/\d+/.exec(entry)?.[0])
    try { process.kill(pid, 0) } catch { rmSync(path.join(dir, entry), { force: true }) }
  }
  const { listenPath: socketPath, registryFile } = controlEndpoint(dir, process.pid)
  const windows = process.platform === 'win32'
  if (!windows) rmSync(socketPath, { force: true })
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_REQUEST_BYTES) { socket.end(`${JSON.stringify({ ok: false, error: 'request too large' })}\n`); return }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      void respondToControlRequest(line).then((reply) => socket.end(`${JSON.stringify(reply)}\n`))
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  if (windows) writeFileSync(registryFile, JSON.stringify({ pid: process.pid, pipe: socketPath }), { mode: 0o600 })
  else chmodSync(socketPath, 0o600)
  const close = () => { server.close(); rmSync(registryFile, { force: true }) }
  process.once('exit', () => rmSync(registryFile, { force: true }))
  return { socketPath, close }
}

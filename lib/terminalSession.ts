// Embedded-terminal bridge for the web/desktop app. Creates a real PTY (via a
// small python3 shim — macOS/Linux ships python3 but no `node-pty` native
// module) running the OpenTUI app, and shuttles raw bytes between the PTY and
// SSE/HTTP routes:
//
//   session stream  (GET)  -> open/join session, stream output as SSE events
//   input           (POST) -> write raw keystrokes into the PTY
//   resize          (POST) -> ioctl TIOCSWINSZ on the PTY master
//   close           (DELETE)-> kill the session tree
//
// The TUI payload is either Bun running `tui/opentui/main.tsx` (dev, or the
// browser-only web app with Bun on PATH) or the standalone `agent-viewer-tui`
// binary shipped as a Tauri sidecar — passed in via `AGENT_VIEWER_TUI_BIN` by
// `lib.rs` in packaged desktop builds.

import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { hostedTerminalEnv } from './inheritedIdentityEnv.mjs'
import { PTY_SUPPORTED, resizePty, spawnPty } from './ptyBridge'

/** Lifecycle events streamed to SSE clients alongside terminal output. */
export type TerminalState =
  | { state: 'running' }
  | { state: 'exited'; code: number | null }
  | { state: 'error'; message: string }

export type Subscriber = {
  push: (chunk: Uint8Array) => void
  status: (event: TerminalState) => void
}

type Session = {
  id: string
  proc: ChildProcess | null
  spawnError: string | null
  exited: boolean
  exitCode: number | null
  buffer: Uint8Array[]
  bufferBytes: number
  subscribers: Set<Subscriber>
  killTimer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()
const MAX_BUFFER_BYTES = 256 * 1024
const DRAIN_TIMEOUT_MS = 60_000

/** Resolve the TUI payload: packaged sidecar binary, or Bun + entrypoint. */
function resolvePayload(): { exec: string; args: string[] } {
  const packagedBin = process.env.AGENT_VIEWER_TUI_BIN
  if (packagedBin && existsSync(packagedBin)) {
    return { exec: packagedBin, args: [] }
  }
  return {
    exec: 'bun',
    args: ['run', path.join(process.cwd(), 'tui', 'opentui', 'main.tsx')],
  }
}

function spawnSession(id: string, cols: number, rows: number): Session {
  const session: Session = {
    id,
    proc: null,
    spawnError: null,
    exited: false,
    exitCode: null,
    buffer: [],
    bufferBytes: 0,
    subscribers: new Set(),
    killTimer: null,
  }
  sessions.set(id, session)

  if (!PTY_SUPPORTED) {
    session.spawnError = 'The embedded terminal is not supported on Windows yet.'
    return session
  }

  const payload = resolvePayload()
  let proc: ChildProcess
  try {
    proc = spawnPty({ exec: payload.exec, args: payload.args, cols, rows, env: hostedTerminalEnv() })
  } catch (err) {
    session.spawnError = `Could not prep PTY bridge: ${String(err)}`
    return session
  }
  proc.on('error', (err: Error) => {
    const message = err && err.message ? err.message : String(err)
    session.spawnError = `Could not start the embedded terminal (${message}).`
    notifyStatus(session, { state: 'error', message: session.spawnError })
  })
  proc.stdout?.on('data', (chunk: Buffer) => {
    if (session.exited) return
    pushOutput(session, chunk)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    pushOutput(session, chunk)
  })
  proc.on('exit', (code) => {
    session.exited = true
    session.exitCode = code
    notifyStatus(session, { state: 'exited', code })
  })
  session.proc = proc
  return session
}

function pushOutput(session: Session, chunk: Uint8Array): void {
  session.buffer.push(chunk)
  session.bufferBytes += chunk.byteLength
  while (session.bufferBytes > MAX_BUFFER_BYTES && session.buffer.length > 1) {
    session.bufferBytes -= session.buffer.shift()!.byteLength
  }
  for (const sub of session.subscribers) {
    try {
      sub.push(chunk)
    } catch {
      // disconnected clients clean themselves up on unsubscribe
    }
  }
}

function notifyStatus(session: Session, event: TerminalState): void {
  for (const sub of session.subscribers) {
    try {
      sub.status(event)
    } catch {
      // ignore
    }
  }
}

/** Opens, or joins, a PTY session and returns the wire state for the request. */
export function openTerminalSession(
  id: string,
  cols: number,
  rows: number,
): TerminalState {
  const existing = sessions.get(id)
  if (existing) {
    if (existing.spawnError) return { state: 'error', message: existing.spawnError }
    if (existing.exited) return { state: 'exited', code: existing.exitCode }
    return { state: 'running' }
  }
  const session = spawnSession(id, cols, rows)
  if (session.spawnError) return { state: 'error', message: session.spawnError }
  return { state: 'running' }
}

/** Writes raw keystroke bytes into the PTY. Returns false if there's no live session. */
export function writeTerminalInput(id: string, data: Uint8Array): boolean {
  const session = sessions.get(id)
  if (!session?.proc || session.exited || session.spawnError) return false
  return session.proc.stdin?.write(data) ?? false
}

/** Updates the PTY geometry (drives TIOCSWINSZ + SIGWINCH in the shim). */
export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id)
  if (!session?.proc || session.exited) return false
  return resizePty(session.proc, cols, rows)
}

/** Subscribes one SSE client to a session; replays buffered output immediately. */
export function subscribeTerminal(
  id: string,
  sub: Subscriber,
): { replay: Uint8Array[]; state: TerminalState } {
  let session = sessions.get(id)
  if (!session) session = spawnSession(id, 80, 24)
  if (session.killTimer) {
    clearTimeout(session.killTimer)
    session.killTimer = null
  }
  session.subscribers.add(sub)
  const state: TerminalState = session.spawnError
    ? { state: 'error', message: session.spawnError }
    : session.exited
      ? { state: 'exited', code: session.exitCode }
      : { state: 'running' }
  return { replay: [...session.buffer], state }
}

/** Removes one SSE client; schedules teardown once the last client drains. */
export function unsubscribeTerminal(id: string, sub: Subscriber): void {
  const session = sessions.get(id)
  if (!session) return
  session.subscribers.delete(sub)
  if (session.subscribers.size > 0 || session.killTimer) return
  session.killTimer = setTimeout(() => {
    session.killTimer = null
    killTerminalSession(id)
  }, DRAIN_TIMEOUT_MS)
}

/** Terminates the PTY tree (python shim group + TUI session via master close). */
export function killTerminalSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.killTimer) {
    clearTimeout(session.killTimer)
    session.killTimer = null
  }
  const proc = session.proc
  const pid = proc?.pid
  if (pid != null) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }, 800).unref()
  }
  session.subscribers.clear()
  sessions.delete(id)
}

export const terminalEnabled = PTY_SUPPORTED
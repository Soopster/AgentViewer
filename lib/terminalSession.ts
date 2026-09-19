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

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Writable } from 'node:stream'

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
const TERM_ENABLED = process.platform !== 'win32'

/** The python3 PTY shim, materialized to the temp dir on first use so neither
 * dev nor packaged builds need to bundle extra resources. Selected forks:
 *   - stdin (fd 0) -> pty master  (keystrokes from the browser)
 *   - pty master   -> stdout      (terminal output back to the browser)
 *   - fd 3 control "R:<rows>:<cols>" lines -> TIOCSWINSZ + SIGWINCH
 *   - closing the control pipe / master EOF tears everything down (master
 *     close also delivers SIGHUP to the TUI's session on POSIX).
 */
const PTY_SHIM_PYTHON = String.raw`
#!/usr/bin/env python3
import fcntl, os, pty, select, signal, struct, sys, termios

def set_winsize(master, rows, cols):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

def reap(pid):
    try:
        os.waitpid(pid, 0)
    except OSError:
        pass
    return 0

def main():
    if len(sys.argv) < 4:
        sys.stderr.write('usage: pty.py <cols> <rows> <exec> [args...]\n')
        return 2
    cols = int(sys.argv[1]); rows = int(sys.argv[2])
    exe = sys.argv[3]; args = sys.argv[4:]
    cmdcol = max(cols, 2); cmdrow = max(rows, 2)

    pid, master = pty.fork()
    if pid == 0:
        os.environ.setdefault('TERM', 'xterm-256color')
        os.environ['COLORTERM'] = 'truecolor'
        try:
            # execvp searches PATH, so e.g. "bun" resolves in dev; absolute
            # sidecar paths (packaged) also work.
            os.execvp(exe, [exe] + args)
        except OSError as exc:
            sys.stderr.write('pty: failed to exec %s: %s\n' % (exe, exc))
            sys.exit(127)

    set_winsize(master, cmdrow, cmdcol)
    control = 3
    try:
        while True:
            rlist, _, _ = select.select([master, 0, control], [], [])
            for fd in rlist:
                if fd == master:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        data = b''
                    if not data:
                        return reap(pid)
                    try:
                        os.write(1, data)
                    except OSError:
                        return reap(pid)
                elif fd == 0:
                    try:
                        data = os.read(0, 65536)
                    except OSError:
                        continue
                    if not data:
                        continue
                    try:
                        os.write(master, data)
                    except OSError:
                        pass
                elif fd == control:
                    try:
                        raw = os.read(control, 256)
                    except OSError:
                        raw = b''
                    if not raw:
                        return reap(pid)
                    for line in raw.splitlines():
                        parts = line.split(b':')
                        if len(parts) == 3 and parts[0] == b'R':
                            try:
                                set_winsize(master, int(parts[1]), int(parts[2]))
                            except (ValueError, OSError):
                                pass
                            try:
                                os.killpg(pid, signal.SIGWINCH)
                            except OSError:
                                pass
    finally:
        try:
            os.close(master)
        except OSError:
            pass
    return 0

if __name__ == '__main__':
    sys.exit(main())
`

let shimReady: string | null = null

function ensureShim(): string {
  if (shimReady && existsSync(shimReady)) return shimReady
  const dir = path.join(tmpdir(), 'agent-viewer')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'pty-bridge.py')
  writeFileSync(file, PTY_SHIM_PYTHON, 'utf8')
  shimReady = file
  return file
}

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

function clamp2(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(2, Math.min(500, Math.round(value))) : fallback
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

  if (!TERM_ENABLED) {
    session.spawnError = 'The embedded terminal is not supported on Windows yet.'
    return session
  }

  const payload = resolvePayload()
  let shim: string
  try {
    shim = ensureShim()
  } catch (err) {
    session.spawnError = `Could not prep PTY bridge: ${String(err)}`
    return session
  }

  const spawnOptions = {
    detached: true,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LINES: String(clamp2(rows, 24)),
      COLUMNS: String(clamp2(cols, 80)),
    },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'] as const,
  } as SpawnOptions
  const proc = spawn('python3', [
    shim,
    String(clamp2(cols, 80)),
    String(clamp2(rows, 24)),
    payload.exec,
    ...payload.args,
  ], spawnOptions)
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
  const control = session.proc.stdio[3] as Writable | null
  if (!control) return false
  control.write(`R:${clamp2(rows, 24)}:${clamp2(cols, 80)}\n`)
  return true
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

export const terminalEnabled = TERM_ENABLED
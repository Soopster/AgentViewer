// A real PTY without a native module: a small python3 shim (`pty.fork`) that
// macOS and Linux both ship. Shared by the web's embedded terminal
// (`lib/terminalSession.ts`) and the TUI's interactive shell, so there is one
// PTY implementation to get right.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Writable } from 'node:stream'

export const PTY_SUPPORTED = process.platform !== 'win32'

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

export function clampPtySize(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(2, Math.min(500, Math.round(value))) : fallback
}

export type PtySpawnOptions = {
  exec: string
  args: string[]
  cols: number
  rows: number
  cwd?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Starts `exec` on a fresh PTY. stdin is the keyboard, stdout the terminal's
 * output, fd 3 the resize channel (`resizePty`). The shim leads its own process
 * group (`detached`), so `process.kill(-pid)` reaches everything on the PTY.
 * Throws when the shim cannot be written; a missing python3 arrives as the
 * child's 'error' event.
 */
export function spawnPty(options: PtySpawnOptions): ChildProcess {
  const shim = ensureShim()
  const cols = clampPtySize(options.cols, 80)
  const rows = clampPtySize(options.rows, 24)
  const spawnOptions = {
    detached: true,
    cwd: options.cwd,
    env: {
      ...(options.env ?? process.env),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LINES: String(rows),
      COLUMNS: String(cols),
    },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'] as const,
  } as SpawnOptions
  return spawn('python3', [shim, String(cols), String(rows), options.exec, ...options.args], spawnOptions)
}

/** Updates the PTY geometry (TIOCSWINSZ + SIGWINCH in the shim). */
export function resizePty(proc: ChildProcess, cols: number, rows: number): boolean {
  const control = proc.stdio[3] as Writable | null
  if (!control || control.destroyed) return false
  control.write(`R:${clampPtySize(rows, 24)}:${clampPtySize(cols, 80)}\n`)
  return true
}

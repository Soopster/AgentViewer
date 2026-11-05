// A real PTY. macOS and Linux use a small python3 shim (`pty.fork`) that both
// ship, so no native module is needed there. Windows has no `pty.fork`; it uses
// ConPTY through `@lydell/node-pty` (an optional dependency with prebuilt
// binaries), wrapped to look like the shim's child process so neither consumer
// has to know which it got. Shared by the web's embedded terminal
// (`lib/terminalSession.ts`) and the TUI's interactive shell, so there is one
// PTY implementation to get right.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { resolveWindowsExecutable } from './hostShell'

/** The slice of node-pty this file uses, so the ConPTY path is testable without Windows. */
export type ConPtyHandle = {
  pid: number
  onData(listener: (data: string) => void): unknown
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
export type ConPtyModule = {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd?: string; env: Record<string, string | undefined>; useConpty?: boolean }): ConPtyHandle
}

let conPtyLoader: () => ConPtyModule = () => {
  // Next externalizes this native package. A literal avoids generating a
  // filesystem-wide Webpack require context (including local symlinks).
  return createRequire(import.meta.url)('@lydell/node-pty') as ConPtyModule
}

/** Tests supply a fake; returns the previous loader so a test can restore it. */
export function setConPtyLoaderForTest(loader: () => ConPtyModule): () => ConPtyModule {
  const previous = conPtyLoader
  conPtyLoader = loader
  return previous
}

function conPtyInstalled(): boolean {
  try { createRequire(import.meta.url).resolve('@lydell/node-pty'); return true } catch { return false }
}

/** POSIX always has the shim; Windows has a PTY exactly when the ConPTY package installed. */
export const PTY_SUPPORTED = process.platform !== 'win32' || conPtyInstalled()

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
  env?: Record<string, string | undefined>
  /** Which backend; defaults to this machine's. A test sets it to drive the other one. */
  platform?: NodeJS.Platform
}

/**
 * Starts `exec` on a fresh PTY. stdin is the keyboard, stdout the terminal's
 * output, fd 3 the resize channel (`resizePty`). The shim leads its own process
 * group (`detached`), so `process.kill(-pid)` reaches everything on the PTY.
 * Throws when the shim cannot be written; a missing python3 arrives as the
 * child's 'error' event.
 */
/**
 * What a ConPTY child looks like to the code that drives a shim child: `stdin` is
 * the keyboard, `stdout` the output as Buffers, `pid`, `kill`, and `exit`/`close`
 * events. `stderr` is null — a pseudoconsole has one stream, so a consumer's
 * `stderr?.on(...)` is simply skipped.
 */
export class ConPtyProcess extends EventEmitter {
  readonly pid: number
  readonly stdout = new PassThrough()
  readonly stderr = null
  readonly stdin: Writable
  killed = false
  exitCode: number | null = null
  private ended = false

  constructor(private readonly handle: ConPtyHandle) {
    super()
    this.pid = handle.pid
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding, done) => {
        try { handle.write(typeof chunk === 'string' ? chunk : chunk.toString('utf8')); done() } catch (error) { done(error as Error) }
      },
    })
    handle.onData((data) => { this.stdout.write(Buffer.from(data, 'utf8')) })
    handle.onExit(({ exitCode, signal }) => {
      if (this.ended) return
      this.ended = true
      this.exitCode = exitCode
      this.stdout.end()
      this.emit('exit', exitCode, signal ? `SIG${signal}` : null)
      this.emit('close', exitCode, signal ? `SIG${signal}` : null)
    })
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.ended) return false
    this.killed = true
    // Windows has no signals; node-pty rejects one it does not know.
    try { this.handle.kill() } catch { return false }
    void signal
    return true
  }

  resizePty(cols: number, rows: number): boolean {
    if (this.ended) return false
    try { this.handle.resize(clampPtySize(cols, 80), clampPtySize(rows, 24)); return true } catch { return false }
  }
}

function spawnConPty(options: PtySpawnOptions, cols: number, rows: number): ChildProcess {
  const env: Record<string, string | undefined> = {
    ...(options.env ?? process.env),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
  const file = resolveWindowsExecutable(options.exec, env, existsSync)
  if (!file) throw new Error(`Could not find "${options.exec}" on PATH`)
  const handle = conPtyLoader().spawn(file, options.args, { name: 'xterm-256color', cols, rows, cwd: options.cwd, env, useConpty: true })
  return new ConPtyProcess(handle) as unknown as ChildProcess
}

export function spawnPty(options: PtySpawnOptions): ChildProcess {
  const cols = clampPtySize(options.cols, 80)
  const rows = clampPtySize(options.rows, 24)
  if ((options.platform ?? process.platform) === 'win32') return spawnConPty(options, cols, rows)
  const shim = ensureShim()
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
  } as unknown as SpawnOptions
  return spawn('python3', [shim, String(cols), String(rows), options.exec, ...options.args], spawnOptions)
}

/** Updates the PTY geometry (TIOCSWINSZ + SIGWINCH in the shim). */
export function resizePty(proc: ChildProcess, cols: number, rows: number): boolean {
  if (proc instanceof ConPtyProcess) return proc.resizePty(cols, rows)
  const control = proc.stdio[3] as Writable | null
  if (!control || control.destroyed) return false
  control.write(`R:${clampPtySize(rows, 24)}:${clampPtySize(cols, 80)}\n`)
  return true
}

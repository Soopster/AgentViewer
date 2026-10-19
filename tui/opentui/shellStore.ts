// Interactive shells: a login shell on a real PTY (`lib/ptyBridge.ts`), its
// output parsed by a headless terminal emulator (`@wterm/core`, the same core
// the web terminal draws), so the pane can paint the screen cell for cell —
// prompts, colours, `cd`, history, `vim` and `less` included.
//
// Like `processStore.ts` they live at module scope: hiding the panel keeps the
// shell, its working directory and whatever it is running. They die with the
// TUI. Subscribers are told at most every `NOTIFY_INTERVAL_MS`, which is short
// because typed characters must echo without a perceptible lag.

import type { ChildProcess } from 'node:child_process'
import { WasmBridge } from '@wterm/core'

import { hostedTerminalEnv } from '../../lib/inheritedIdentityEnv.mjs'
import { PTY_SUPPORTED, clampPtySize, resizePty, spawnPty } from '../../lib/ptyBridge'

export type ShellStatus = 'running' | 'exited' | 'failed'

export type ShellSession = {
  id: string
  name: string
  cwd: string
  status: ShellStatus
  exitCode: number | null
  error: string | null
  /** What the shell set with OSC 0/2, usually the running command or directory. */
  title: string | null
  cols: number
  rows: number
  /** Bumped on every screen change. */
  version: number
}

type Entry = { meta: ShellSession; proc: ChildProcess | null; term: WasmBridge }

const NOTIFY_INTERVAL_MS = 16
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let snapshot: readonly ShellSession[] = []
let notifyTimer: ReturnType<typeof setTimeout> | null = null
let counter = 0
let exitHookInstalled = false

function notifyNow(): void {
  if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = null }
  snapshot = [...entries.values()].map((entry) => ({ ...entry.meta }))
  for (const listener of listeners) listener()
}

function notifySoon(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(notifyNow, NOTIFY_INTERVAL_MS)
}

export function subscribeShells(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getShells(): readonly ShellSession[] {
  return snapshot
}

/** The emulator behind a shell, for reading its screen. */
export function shellTerminal(id: string): WasmBridge | null {
  return entries.get(id)?.term ?? null
}

function killGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  const pid = proc.pid
  if (!pid) return
  try { process.kill(-pid, signal) } catch { try { proc.kill(signal) } catch { /* gone */ } }
}

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const entry of entries.values()) if (entry.proc) killGroup(entry.proc, 'SIGHUP')
  })
}

function shellCommand(): { exec: string; args: string[]; name: string } {
  const exec = process.env.SHELL || '/bin/sh'
  const name = exec.split('/').pop() || 'sh'
  // A login shell reads the profile that sets PATH, as a new terminal tab does.
  return { exec, args: ['-l'], name }
}

export async function startShell(options: { cwd: string; cols: number; rows: number }): Promise<string> {
  counter += 1
  const id = `shell-${counter}`
  const cols = clampPtySize(options.cols, 80)
  const rows = clampPtySize(options.rows, 24)
  const term = await WasmBridge.load()
  term.init(cols, rows)
  const { exec, args, name } = shellCommand()
  const entry: Entry = {
    meta: { id, name, cwd: options.cwd, status: 'running', exitCode: null, error: null, title: null, cols, rows, version: 0 },
    proc: null,
    term,
  }
  entries.set(id, entry)
  if (!PTY_SUPPORTED) {
    entry.meta.status = 'failed'
    entry.meta.error = 'Interactive shells need a PTY, which this platform does not offer yet.'
    notifyNow()
    return id
  }
  installExitHook()
  let proc: ChildProcess
  try {
    proc = spawnPty({ exec, args, cols, rows, cwd: options.cwd, env: hostedTerminalEnv() })
  } catch (error) {
    entry.meta.status = 'failed'
    entry.meta.error = `Could not start a PTY: ${error instanceof Error ? error.message : String(error)}`
    notifyNow()
    return id
  }
  entry.proc = proc
  proc.stdout?.on('data', (chunk: Buffer) => {
    term.writeRaw(chunk)
    // Device queries (cursor position, attributes) are answered by the
    // emulator; a shell such as fish waits on them before drawing its prompt.
    const response = term.getResponse()
    if (response) proc.stdin?.write(response)
    entry.meta.title = term.getTitle()
    entry.meta.version += 1
    notifySoon()
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    // The shim's own failures (exec not found) arrive here, not on the PTY.
    term.writeRaw(chunk)
    entry.meta.version += 1
    notifySoon()
  })
  proc.once('error', (error) => {
    entry.meta.status = 'failed'
    entry.meta.error = /ENOENT/.test(error.message) ? 'Interactive shells need python3 on PATH (it provides the PTY).' : error.message
    entry.proc = null
    notifyNow()
  })
  proc.once('exit', (code) => {
    if (entry.meta.status === 'running') entry.meta.status = 'exited'
    entry.meta.exitCode = code
    entry.proc = null
    entry.meta.version += 1
    notifyNow()
  })
  notifyNow()
  return id
}

export function writeShell(id: string, data: string): void {
  const entry = entries.get(id)
  if (!entry?.proc || !data) return
  entry.proc.stdin?.write(data)
}

export function resizeShell(id: string, cols: number, rows: number): void {
  const entry = entries.get(id)
  if (!entry) return
  const nextCols = clampPtySize(cols, entry.meta.cols)
  const nextRows = clampPtySize(rows, entry.meta.rows)
  if (nextCols === entry.meta.cols && nextRows === entry.meta.rows) return
  entry.meta.cols = nextCols
  entry.meta.rows = nextRows
  entry.term.resize(nextCols, nextRows)
  if (entry.proc) resizePty(entry.proc, nextCols, nextRows)
  entry.meta.version += 1
  notifyNow()
}

/** Ends the shell (SIGHUP, as closing a terminal window does) and forgets it once it is gone. */
export function closeShell(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  if (entry.proc) {
    const proc = entry.proc
    killGroup(proc, 'SIGHUP')
    const timer = setTimeout(() => killGroup(proc, 'SIGKILL'), 2000)
    timer.unref?.()
  }
  entries.delete(id)
  notifyNow()
}

/** Test seam: end every shell and wait until each is gone. */
export async function resetShellsForTest(): Promise<void> {
  const running = [...entries.values()].flatMap((entry) => (entry.proc ? [entry.proc] : []))
  await Promise.all(running.map((proc) => new Promise<void>((done) => {
    proc.once('exit', () => done())
    killGroup(proc, 'SIGKILL')
  })))
  entries.clear()
  notifyNow()
}

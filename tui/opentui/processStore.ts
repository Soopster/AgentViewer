// Long-running processes the TUI hosts for the user — a dev server, a test
// watcher, `docker compose logs -f` — and the output each has written.
//
// They live here, at module scope, and not in the view that shows them:
// closing the surface panel or switching its tab must not kill a dev server.
// They do die with the TUI (each is its own process group, signalled on exit),
// because a server nobody can see or stop is worse than one that stopped.
//
// Output arrives far faster than it is worth repainting, so subscribers are
// told at most every `NOTIFY_INTERVAL_MS`. Only the process view subscribes;
// the root never does, so a chatty server cannot re-render the app.

import { spawn, type ChildProcess } from 'node:child_process'

export type ProcessStatus = 'idle' | 'running' | 'stopping' | 'exited' | 'failed'

export type ManagedProcess = {
  id: string
  name: string
  command: string
  cwd: string
  status: ProcessStatus
  exitCode: number | null
  signal: string | null
  pid: number | null
  startedAt: number | null
  endedAt: number | null
  /** Retained output, ANSI stripped, newest last. */
  lines: string[]
  /** Lines dropped from the front to keep `lines` bounded. */
  droppedLines: number
}

type Entry = ManagedProcess & {
  child: ChildProcess | null
  partial: { stdout: string; stderr: string }
  killTimer: ReturnType<typeof setTimeout> | null
  /** Bumped on every change, so a snapshot copies only what moved. */
  version: number
}

export const PROCESS_LINE_CAP = 5000
const NOTIFY_INTERVAL_MS = 100
const KILL_GRACE_MS = 3000
const MAX_LINE_CHARS = 4000

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let snapshot: readonly ManagedProcess[] = []
let notifyTimer: ReturnType<typeof setTimeout> | null = null
let counter = 0
let exitHookInstalled = false

// CSI and OSC sequences, and the stray control characters dev servers print.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

const views = new Map<string, { version: number; view: ManagedProcess }>()

// The retained lines are copied here, at most once per notification, rather
// than per chunk: a server writing a thousand chunks a second would otherwise
// copy five thousand lines a thousand times.
function view(entry: Entry): ManagedProcess {
  const cached = views.get(entry.id)
  if (cached && cached.version === entry.version) return cached.view
  const { child: _child, partial: _partial, killTimer: _timer, version: _version, ...rest } = entry
  const next = { ...rest, lines: entry.lines.slice() }
  views.set(entry.id, { version: entry.version, view: next })
  return next
}

function rebuildSnapshot(): void {
  for (const id of views.keys()) if (!entries.has(id)) views.delete(id)
  snapshot = [...entries.values()].map(view)
}

function notifySoon(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    rebuildSnapshot()
    for (const listener of listeners) listener()
  }, NOTIFY_INTERVAL_MS)
}

function notifyNow(): void {
  if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = null }
  rebuildSnapshot()
  for (const listener of listeners) listener()
}

export function subscribeProcesses(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getProcesses(): readonly ManagedProcess[] {
  return snapshot
}

function pushLines(entry: Entry, lines: string[]): void {
  for (const line of lines) entry.lines.push(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line)
  const over = entry.lines.length - PROCESS_LINE_CAP
  if (over > 0) {
    entry.lines.splice(0, over)
    entry.droppedLines += over
  }
  entry.version += 1
}

function onOutput(entry: Entry, stream: 'stdout' | 'stderr', chunk: string): void {
  const text = entry.partial[stream] + chunk.replace(/\r\n/g, '\n')
  const parts = text.split('\n')
  entry.partial[stream] = parts.pop() ?? ''
  // A carriage return redraws the line (progress bars): keep only what it ended as.
  pushLines(entry, parts.map((part) => stripAnsi(part.slice(part.lastIndexOf('\r') + 1))))
  notifySoon()
}

function flushPartial(entry: Entry): void {
  const rest = [entry.partial.stdout, entry.partial.stderr].filter(Boolean)
  entry.partial = { stdout: '', stderr: '' }
  if (rest.length > 0) pushLines(entry, rest.map((part) => stripAnsi(part.slice(part.lastIndexOf('\r') + 1))))
}

function signalGroup(entry: Entry, signal: NodeJS.Signals): void {
  const pid = entry.child?.pid
  if (!pid) return
  // The shell's whole group: `npm run dev` is three processes deep, and
  // signalling the shell alone leaves the server holding its port.
  try { process.kill(-pid, signal) } catch { try { entry.child?.kill(signal) } catch { /* gone */ } }
}

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const entry of entries.values()) if (entry.child) signalGroup(entry, 'SIGTERM')
  })
}

/** Adds a process without starting it (a suggestion, or one stopped by the user). */
export function addProcess(definition: { name: string; command: string; cwd: string }): string {
  const existing = [...entries.values()].find((entry) => entry.command === definition.command && entry.cwd === definition.cwd)
  if (existing) return existing.id
  counter += 1
  const id = `proc-${counter}`
  entries.set(id, {
    id,
    ...definition,
    status: 'idle',
    exitCode: null,
    signal: null,
    pid: null,
    startedAt: null,
    endedAt: null,
    lines: [],
    droppedLines: 0,
    child: null,
    partial: { stdout: '', stderr: '' },
    killTimer: null,
    version: 0,
  })
  notifyNow()
  return id
}

export function startProcess(id: string): void {
  const entry = entries.get(id)
  if (!entry || entry.child) return
  installExitHook()
  const shell = process.env.SHELL || '/bin/sh'
  let child: ChildProcess
  try {
    child = spawn(shell, ['-lc', entry.command], {
      cwd: entry.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Most tools print colour only to a terminal; those that force it anyway are stripped.
      env: { ...process.env, FORCE_COLOR: '0' },
    })
  } catch (error) {
    entry.status = 'failed'
    pushLines(entry, [`— could not start: ${error instanceof Error ? error.message : String(error)}`])
    notifyNow()
    return
  }
  entry.child = child
  entry.pid = child.pid ?? null
  entry.status = 'running'
  entry.exitCode = null
  entry.signal = null
  entry.startedAt = Date.now()
  entry.endedAt = null
  pushLines(entry, [`$ ${entry.command}`])
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => onOutput(entry, 'stdout', chunk))
  child.stderr?.on('data', (chunk: string) => onOutput(entry, 'stderr', chunk))
  child.once('error', (error) => {
    pushLines(entry, [`— ${error.message}`])
    entry.status = 'failed'
    notifyNow()
  })
  child.once('close', (code, signal) => {
    if (entry.child !== child) return
    flushPartial(entry)
    if (entry.killTimer) { clearTimeout(entry.killTimer); entry.killTimer = null }
    const stopped = entry.status === 'stopping'
    entry.child = null
    entry.pid = null
    entry.exitCode = code
    entry.signal = signal
    entry.endedAt = Date.now()
    entry.status = stopped || code === 0 ? 'exited' : 'failed'
    pushLines(entry, [`— ${stopped ? 'stopped' : signal ? `killed by ${signal}` : `exit ${code ?? 0}`}`])
    notifyNow()
  })
  notifyNow()
}

export function stopProcess(id: string): void {
  const entry = entries.get(id)
  if (!entry?.child || entry.status === 'stopping') return
  entry.status = 'stopping'
  entry.version += 1
  signalGroup(entry, 'SIGTERM')
  entry.killTimer = setTimeout(() => signalGroup(entry, 'SIGKILL'), KILL_GRACE_MS)
  notifyNow()
}

export function restartProcess(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  if (!entry.child) { startProcess(id); return }
  const child = entry.child
  stopProcess(id)
  child.once('close', () => startProcess(id))
}

export function clearProcessOutput(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  entry.lines = []
  entry.droppedLines = 0
  entry.version += 1
  notifyNow()
}

/** Removes a process that is not running. A running one must be stopped first. */
export function removeProcess(id: string): boolean {
  const entry = entries.get(id)
  if (!entry || entry.child) return false
  entries.delete(id)
  notifyNow()
  return true
}

/** Test seam: stop everything and forget it. */
export async function resetProcessesForTest(): Promise<void> {
  const running = [...entries.values()].filter((entry) => entry.child)
  await Promise.all(running.map((entry) => new Promise<void>((done) => {
    entry.child?.once('close', () => done())
    signalGroup(entry, 'SIGKILL')
  })))
  entries.clear()
  notifyNow()
}

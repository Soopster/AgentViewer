import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AhpErrorCodes,
  JsonRpcErrorCodes,
  type Snapshot,
  type TerminalClaim,
  type TerminalInfo,
  type URI,
} from '@microsoft/agent-host-protocol'

type Params = Record<string, unknown>
type Action = Record<string, unknown>
type Claim = TerminalClaim

type TerminalStateValue = {
  title: string
  cwd?: URI
  cols?: number
  rows?: number
  content: Array<{ type: 'unclassified'; value: string }>
  exitCode?: number
  claim: Claim
  supportsCommandDetection: false
  isPty: false
}

type TerminalRecord = {
  resource: URI
  state: TerminalStateValue
  child: ChildProcessWithoutNullStreams
}

type Emit = (channel: URI, action: Action) => void
type EmitCatalog = (terminals: TerminalInfo[]) => void

export class AhpTerminalError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message)
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveDimension(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) {
    throw new AhpTerminalError(JsonRpcErrorCodes.InvalidParams, `${field} must be an integer from 1 to 10000`)
  }
  return number
}

function parseClaim(value: unknown): Claim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AhpTerminalError(JsonRpcErrorCodes.InvalidParams, 'claim is required')
  }
  const claim = value as Record<string, unknown>
  if (claim.kind === 'client' && text(claim.clientId)) {
    return { kind: 'client', clientId: text(claim.clientId) } as Claim
  }
  if (claim.kind === 'session' && text(claim.session)) {
    return {
      kind: 'session',
      session: text(claim.session),
      ...(text(claim.turnId) ? { turnId: text(claim.turnId) } : {}),
      ...(text(claim.toolCallId) ? { toolCallId: text(claim.toolCallId) } : {}),
    } as Claim
  }
  throw new AhpTerminalError(JsonRpcErrorCodes.InvalidParams, 'claim must identify a client or session')
}

function shellCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.ComSpec || 'cmd.exe', args: [] }
  }
  return { command: '/bin/sh', args: [] }
}

function cwdFromUri(value: unknown): { path: string; uri: URI } {
  const uri = text(value) || pathToFileURL(process.cwd()).href
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') throw new Error('not file')
    return { path: fileURLToPath(parsed), uri: parsed.href }
  } catch {
    throw new AhpTerminalError(JsonRpcErrorCodes.InvalidParams, 'cwd must be a file URI')
  }
}

export class AhpTerminalManager {
  private readonly terminals = new Map<URI, TerminalRecord>()

  constructor(
    private readonly emit: Emit,
    private readonly emitCatalog: EmitCatalog,
  ) {}

  infos(): TerminalInfo[] {
    return [...this.terminals.values()].map(({ resource, state }) => ({
      resource,
      title: state.title,
      claim: state.claim,
      ...(state.exitCode === undefined ? {} : { exitCode: state.exitCode }),
    }))
  }

  has(channel: string): boolean {
    return this.terminals.has(channel)
  }

  snapshot(channel: string, fromSeq: number): Snapshot | null {
    const terminal = this.terminals.get(channel)
    return terminal
      ? { resource: channel, state: structuredClone(terminal.state), fromSeq } as Snapshot
      : null
  }

  create(params: Params, clientId: string, resolvedCwd?: string): null {
    const channel = text(params.channel)
    if (!channel || !/^ahp-terminal:\/[^?#]+$/.test(channel)) {
      throw new AhpTerminalError(JsonRpcErrorCodes.InvalidParams, 'channel must be an ahp-terminal: URI')
    }
    if (this.terminals.has(channel)) {
      throw new AhpTerminalError(AhpErrorCodes.AlreadyExists, 'Terminal already exists')
    }
    const claim = parseClaim(params.claim)
    if (claim.kind === 'client' && claim.clientId !== clientId) {
      throw new AhpTerminalError(JsonRpcErrorCodes.InvalidParams, 'claim.clientId must match initialize.clientId')
    }
    const cwd = cwdFromUri(params.cwd)
    const shell = shellCommand()
    const child = spawn(shell.command, shell.args, {
      cwd: resolvedCwd ?? cwd.path,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const state: TerminalStateValue = {
      title: text(params.name) || path.basename(shell.command),
      cwd: cwd.uri,
      ...(positiveDimension(params.cols, 'cols') ? { cols: positiveDimension(params.cols, 'cols') } : {}),
      ...(positiveDimension(params.rows, 'rows') ? { rows: positiveDimension(params.rows, 'rows') } : {}),
      content: [],
      claim,
      supportsCommandDetection: false,
      isPty: false,
    }
    const terminal: TerminalRecord = { resource: channel, state, child }
    this.terminals.set(channel, terminal)
    const onData = (chunk: Buffer | string) => {
      const data = chunk.toString()
      const tail = state.content.at(-1)
      if (tail) tail.value += data
      else state.content.push({ type: 'unclassified', value: data })
      this.emit(channel, { type: 'terminal/data', data })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      state.exitCode = code ?? undefined
      this.emit(channel, {
        type: 'terminal/exited',
        ...(code === null ? {} : { exitCode: code }),
      })
      this.emitCatalog(this.infos())
    })
    child.once('error', (error) => {
      const data = `${error.message}\n`
      state.content.push({ type: 'unclassified', value: data })
      this.emit(channel, { type: 'terminal/data', data })
    })
    this.emitCatalog(this.infos())
    return null
  }

  dispose(channel: string): null {
    const terminal = this.terminals.get(channel)
    if (!terminal) throw new AhpTerminalError(AhpErrorCodes.NotFound, 'Terminal not found')
    this.terminate(terminal)
    this.terminals.delete(channel)
    this.emitCatalog(this.infos())
    return null
  }

  dispatch(channel: string, action: Action, clientId: string): string | undefined {
    const terminal = this.terminals.get(channel)
    if (!terminal) return 'Terminal not found'
    const currentClaim = terminal.state.claim
    if (currentClaim.kind !== 'client' || currentClaim.clientId !== clientId) {
      return 'The dispatching client does not hold the terminal claim'
    }
    switch (action.type) {
      case 'terminal/input': {
        if (typeof action.data !== 'string') return 'terminal/input data must be a string'
        if (terminal.child.exitCode !== null) return 'Terminal process has exited'
        terminal.child.stdin.write(action.data)
        return undefined
      }
      case 'terminal/resized': {
        try {
          terminal.state.cols = positiveDimension(action.cols, 'cols')
          terminal.state.rows = positiveDimension(action.rows, 'rows')
          return undefined
        } catch (error) {
          return error instanceof Error ? error.message : 'Invalid terminal dimensions'
        }
      }
      case 'terminal/claimed': {
        try {
          terminal.state.claim = parseClaim(action.claim)
          this.emitCatalog(this.infos())
          return undefined
        } catch (error) {
          return error instanceof Error ? error.message : 'Invalid terminal claim'
        }
      }
      case 'terminal/titleChanged': {
        const title = text(action.title)
        if (!title) return 'Terminal title is required'
        terminal.state.title = title
        this.emitCatalog(this.infos())
        return undefined
      }
      case 'terminal/cleared':
        terminal.state.content = []
        return undefined
      default:
        return `Action ${text(action.type)} is not client-dispatchable on a terminal`
    }
  }

  close(): void {
    for (const terminal of this.terminals.values()) this.terminate(terminal)
    this.terminals.clear()
  }

  private terminate(terminal: TerminalRecord): void {
    terminal.child.stdin.end()
    terminal.child.stdout.destroy()
    terminal.child.stderr.destroy()
    terminal.child.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
  }
}

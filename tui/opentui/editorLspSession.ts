import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolveLspCommand } from './editorLspCommand'
import { LSP_SYNC_FULL, lspSyncKind, type LspSyncKind } from './editorLspSync'

// One language server per (workspace root, server command), shared by every
// open buffer it can answer for.
//
// The editor used to own a server per *buffer*: switching tabs killed the
// process and spawned a new one, which for gopls or rust-analyzer means the
// whole workspace is indexed again before the first completion — seconds of a
// dead editor per Tab, repeated. LSP is designed for the opposite: one server,
// many `textDocument/didOpen` documents. Sessions therefore outlive the buffers
// that opened them and are reaped only after `IDLE_DISPOSE_MS` with no
// documents at all, so flipping between two files is free and closing the last
// one still returns the memory.

export type LspServerCapabilities = {
  syncKind: LspSyncKind
  completionResolveProvider: boolean
  completionTriggerCharacters: ReadonlySet<string>
  signatureHelpTriggerCharacters: ReadonlySet<string>
  pullDiagnostics: boolean
  documentFormatting: boolean
  renameProvider: boolean
  prepareRename: boolean
}

export type LspDocumentHandlers = {
  onDiagnostics?: (params: unknown) => void
  onApplyEdit?: (edit: unknown) => Promise<boolean>
}

export type LspSessionExit = { message: string }

// Server-initiated "my answers have changed, ask again". `workspace/diagnostic/refresh`
// is the standard spelling; `workspace/projectInitializationComplete` is Roslyn's,
// sent once the project is loaded — before it, C# is analysed as a loose file and
// reports style hints but no compiler errors at all.
const DIAGNOSTIC_REFRESH_METHODS = new Set([
  'workspace/diagnostic/refresh',
  'workspace/projectInitializationComplete',
])

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  abortCleanup?: () => void
}

type SessionDocument = {
  version: number
  // The same file can be open in two panes. Both need diagnostics, and the
  // first one to close must not send a `didClose` out from under the other, so
  // the document is refcounted exactly like the session is.
  handlers: Set<LspDocumentHandlers>
}

const IDLE_DISPOSE_MS = Number(process.env.AGENT_VIEWER_LSP_IDLE_MS ?? 180_000)
const SHUTDOWN_GRACE_MS = 1_000

function abortError(method: string): Error {
  const error = new Error(`${method} cancelled`)
  error.name = 'AbortError'
  return error
}

function stringSet(value: unknown): ReadonlySet<string> {
  return new Set(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])
}

export class EditorLspSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private documents = new Map<string, SessionDocument>()
  private exitHandlers = new Set<(exit: LspSessionExit) => void>()
  private refreshHandlers = new Set<() => void>()
  private refCount = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private stderr = ''
  private disposed = false
  capabilities: LspServerCapabilities = {
    syncKind: LSP_SYNC_FULL,
    completionResolveProvider: false,
    completionTriggerCharacters: new Set(),
    signatureHelpTriggerCharacters: new Set(),
    pullDiagnostics: false,
    documentFormatting: false,
    renameProvider: false,
    prepareRename: false,
  }

  constructor(
    readonly key: string,
    readonly rootPath: string,
    readonly serverName: string,
  ) {}

  get alive(): boolean {
    return this.child != null && !this.disposed
  }

  get lastStderr(): string {
    return this.stderr.trim()
  }

  retain(): void {
    this.refCount += 1
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount > 0 || this.disposed) return
    if (IDLE_DISPOSE_MS <= 0) {
      this.dispose()
      return
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.refCount === 0) this.dispose()
    }, IDLE_DISPOSE_MS)
    this.idleTimer.unref?.()
  }

  /** Fires when the server says its diagnostics are now worth asking for again. */
  onDiagnosticsStale(handler: () => void): () => void {
    this.refreshHandlers.add(handler)
    return () => this.refreshHandlers.delete(handler)
  }

  onExit(handler: (exit: LspSessionExit) => void): () => void {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }

  openDocument(uri: string, languageId: string, text: string, handlers: LspDocumentHandlers): void {
    if (!this.child) return
    const existing = this.documents.get(uri)
    if (existing) {
      existing.handlers.add(handlers)
      return
    }
    this.documents.set(uri, { version: 1, handlers: new Set([handlers]) })
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    })
  }

  closeDocument(uri: string, handlers?: LspDocumentHandlers): void {
    const document = this.documents.get(uri)
    if (!document) return
    if (handlers) document.handlers.delete(handlers)
    if (handlers && document.handlers.size > 0) return
    this.documents.delete(uri)
    if (this.child) this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  /** The version stamped on the change, or null when the document is not open. */
  nextVersion(uri: string): number | null {
    const document = this.documents.get(uri)
    if (!document) return null
    document.version += 1
    return document.version
  }

  request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error(`${method} failed: language server is not running`))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(method))
        return
      }
      const timer = setTimeout(() => {
        const entry = this.pending.get(id)
        entry?.abortCleanup?.()
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      const onAbort = signal ? () => {
        const entry = this.pending.get(id)
        if (!entry) return
        clearTimeout(entry.timer)
        entry.abortCleanup?.()
        this.pending.delete(id)
        this.notify('$/cancelRequest', { id })
        reject(abortError(method))
      } : null
      const abortCleanup = onAbort && signal ? () => signal.removeEventListener('abort', onAbort) : undefined
      if (onAbort && signal) signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve, reject, timer, abortCleanup })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async spawn(command: string, args: readonly string[], windowsVerbatimArguments?: boolean): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      this.stderr = ''
      const child = spawn(command, [...args], {
        cwd: this.rootPath,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      }) as ChildProcessWithoutNullStreams
      let settled = false
      child.once('error', (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        this.child = child
        // A warm server must never be the reason the process stays alive: the
        // pool outlives the buffer that opened it, so an unref'd child lets the
        // TUI (and a smoke) exit on its own, and the exit hook kills it.
        child.unref()
        // The pipes hold the event loop open on their own, so unref'ing only
        // the child is not enough — verified: the LSP smokes hang without this.
        for (const stream of [child.stdout, child.stderr, child.stdin]) {
          (stream as unknown as { unref?: () => void }).unref?.()
        }
        child.stdout.on('data', (chunk: Buffer) => this.handleData(chunk))
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          this.stderr = `${this.stderr}${chunk}`.slice(-4_096)
        })
        child.stdin.on('error', (error: Error) => {
          if (this.disposed || this.child !== child) return
          this.stderr = `${this.stderr}\n${error.message}`.trim().slice(-4_096)
          this.handleExit()
        })
        child.on('exit', () => this.handleExit())
        resolvePromise()
      })
    })
  }

  applyHandshake(result: unknown): void {
    const serverCapabilities = result && typeof result === 'object'
      ? (result as { capabilities?: Record<string, unknown> }).capabilities
      : undefined
    const completionProvider = serverCapabilities?.completionProvider && typeof serverCapabilities.completionProvider === 'object'
      ? serverCapabilities.completionProvider as Record<string, unknown>
      : undefined
    const signatureProvider = serverCapabilities?.signatureHelpProvider && typeof serverCapabilities.signatureHelpProvider === 'object'
      ? serverCapabilities.signatureHelpProvider as Record<string, unknown>
      : undefined
    const renameProvider = serverCapabilities?.renameProvider
    this.capabilities = {
      syncKind: lspSyncKind(serverCapabilities?.textDocumentSync),
      completionResolveProvider: completionProvider?.resolveProvider === true,
      completionTriggerCharacters: stringSet(completionProvider?.triggerCharacters),
      signatureHelpTriggerCharacters: stringSet(signatureProvider?.triggerCharacters),
      pullDiagnostics: Boolean(serverCapabilities?.diagnosticProvider),
      documentFormatting: Boolean(serverCapabilities?.documentFormattingProvider),
      renameProvider: Boolean(renameProvider),
      prepareRename: Boolean(renameProvider && typeof renameProvider === 'object'
        && (renameProvider as Record<string, unknown>).prepareProvider === true),
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    releaseSessionKey(this.key, this)
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    const child = this.child
    this.child = null
    this.documents.clear()
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.abortCleanup?.()
      entry.reject(new Error('language server stopped'))
    }
    this.pending.clear()
    if (!child || child.killed) return
    // A polite shutdown lets gopls and rust-analyzer flush their caches; the
    // timer is the backstop for a server that ignores it.
    try {
      child.stdin.write(shutdownFrame(this.nextId++))
    } catch { /* the pipe is already gone */ }
    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, SHUTDOWN_GRACE_MS)
    timer.unref?.()
    child.once('exit', () => clearTimeout(timer))
    child.kill()
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + length)
      try { this.handleMessage(JSON.parse(body) as Record<string, unknown>) } catch { /* ignore malformed server output */ }
    }
  }

  private documentFor(uri: unknown): SessionDocument | undefined {
    if (typeof uri !== 'string') return undefined
    return this.documents.get(uri)
  }

  private handleMessage(message: Record<string, unknown>): void {
    const id = message.id as number | string | undefined
    const method = message.method as string | undefined
    if (id != null && method === 'workspace/applyEdit') {
      const params = message.params as { edit?: unknown } | undefined
      const handler = [...this.documents.values()]
        .flatMap((document) => [...document.handlers])
        .map((entry) => entry.onApplyEdit)
        .find(Boolean)
      void (handler ? handler(params?.edit) : Promise.resolve(false)).then((applied) => {
        this.send({ jsonrpc: '2.0', id, result: { applied } })
      }).catch((error: unknown) => {
        this.send({
          jsonrpc: '2.0',
          id,
          result: { applied: false, failureReason: error instanceof Error ? error.message : 'Unable to apply edit' },
        })
      })
      return
    }
    if (id != null && method === 'workspace/configuration') {
      const items = (message.params as { items?: unknown } | undefined)?.items
      this.send({ jsonrpc: '2.0', id, result: Array.isArray(items) ? items.map(() => null) : [] })
      return
    }
    if (id != null && method === 'workspace/workspaceFolders') {
      this.send({
        jsonrpc: '2.0',
        id,
        result: [{ uri: pathToFileURL(this.rootPath).href, name: this.rootPath.split(/[\\/]/).pop() || 'workspace' }],
      })
      return
    }
    if (method && DIAGNOSTIC_REFRESH_METHODS.has(method)) {
      // A request form still needs its reply, or the server waits forever.
      if (id != null) this.send({ jsonrpc: '2.0', id, result: null })
      for (const handler of [...this.refreshHandlers]) handler()
      return
    }
    if (id != null && (method === 'client/registerCapability'
      || method === 'client/unregisterCapability'
      || method === 'window/workDoneProgress/create')) {
      this.send({ jsonrpc: '2.0', id, result: null })
      return
    }
    if (id != null && method) {
      this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported client method: ${method}` } })
      return
    }
    if (typeof id === 'number') {
      const entry = this.pending.get(id)
      if (!entry) return
      clearTimeout(entry.timer)
      entry.abortCleanup?.()
      this.pending.delete(id)
      const error = message.error as { code?: number; message?: string } | undefined
      if (error) entry.reject(new Error(error.message || `LSP error ${error.code ?? ''}`.trim()))
      else entry.resolve(message.result)
      return
    }
    if (method === 'textDocument/publishDiagnostics') {
      const params = message.params as { uri?: unknown } | undefined
      // Diagnostics are addressed by uri, which is what makes one session
      // serving many buffers possible at all.
      const document = this.documentFor(params?.uri)
      if (document) for (const handlers of document.handlers) handlers.onDiagnostics?.(params)
    }
  }

  private send(message: unknown): void {
    if (!this.child) return
    const body = JSON.stringify(message)
    try {
      this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    } catch { /* the exit handler reports this */ }
  }

  private handleExit(): void {
    if (this.disposed || !this.child) return
    const exit: LspSessionExit = { message: this.lastStderr || 'language server exited' }
    const handlers = [...this.exitHandlers]
    this.dispose()
    for (const handler of handlers) handler(exit)
  }
}

function shutdownFrame(id: number): string {
  const shutdown = JSON.stringify({ jsonrpc: '2.0', id, method: 'shutdown' })
  const exit = JSON.stringify({ jsonrpc: '2.0', method: 'exit' })
  return `Content-Length: ${Buffer.byteLength(shutdown)}\r\n\r\n${shutdown}`
    + `Content-Length: ${Buffer.byteLength(exit)}\r\n\r\n${exit}`
}

type PooledEntry = { session: EditorLspSession; ready: Promise<EditorLspSession> }

const sessions = new Map<string, PooledEntry>()

function releaseSessionKey(key: string, session: EditorLspSession): void {
  if (sessions.get(key)?.session === session) sessions.delete(key)
}

export function lspSessionKey(rootPath: string, command: string, args: readonly string[]): string {
  return `${rootPath} ${command} ${args.join(' ')}`
}

export type AcquireLspSessionOptions = {
  rootPath: string
  command: string
  args: readonly string[]
  serverName: string
  initializeParams: (rootUri: string) => unknown
  initializeTimeoutMs: number
}

/**
 * The running session for this root and server, starting one if needed.
 * Concurrent callers await the same handshake rather than racing two
 * processes into the same workspace. The caller owns exactly one `retain`, and
 * must `release` it.
 */
export async function acquireLspSession(options: AcquireLspSessionOptions): Promise<EditorLspSession> {
  const key = lspSessionKey(options.rootPath, options.command, options.args)
  const existing = sessions.get(key)
  if (existing && existing.session.alive !== false) {
    // Retain before awaiting: a release racing the handshake must not reap the
    // session this caller is waiting on.
    existing.session.retain()
    try {
      return await existing.ready
    } catch (error) {
      existing.session.release()
      throw error
    }
  }
  const resolved = resolveLspCommand(options.command, options.args, { cwd: options.rootPath })
  if (!resolved) {
    const error = new Error(`ENOENT: ${options.command} is not installed`)
    error.name = 'LspCommandNotFound'
    throw error
  }
  hookProcessExit()
  const session = new EditorLspSession(key, options.rootPath, options.serverName)
  const ready = (async () => {
    await session.spawn(resolved.command, resolved.args, resolved.windowsVerbatimArguments)
    const rootUri = pathToFileURL(options.rootPath).href
    const result = await session.request('initialize', options.initializeParams(rootUri), options.initializeTimeoutMs)
    session.applyHandshake(result)
    session.notify('initialized', {})
    return session
  })()
  sessions.set(key, { session, ready })
  session.retain()
  try {
    return await ready
  } catch (error) {
    session.release()
    session.dispose()
    throw error
  }
}

/** Tears down every pooled session. Used by smokes and at editor teardown. */
export function disposeAllLspSessions(): void {
  for (const entry of [...sessions.values()]) entry.session.dispose()
  sessions.clear()
}

// A pooled server outlives the buffer that started it by design, which means
// nothing else would ever kill it: on exit the children would be orphaned and
// keep indexing a workspace nobody has open. `exit` fires for a normal end and
// for `process.exit`, and the signal handlers cover a terminal quit.
let exitHooked = false
function hookProcessExit(): void {
  if (exitHooked) return
  exitHooked = true
  process.once('exit', disposeAllLspSessions)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    // Only when something else already handles the signal: attaching the sole
    // listener would suppress the default termination and hang the process.
    if (process.listenerCount(signal) === 0) continue
    process.once(signal, disposeAllLspSessions)
  }
}

export function pooledLspSessionCount(): number {
  return sessions.size
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import {
  CodexJsonRpcResponse,
  type CodexClientMethod,
  type CodexJsonRpcRequest,
  type CodexNotification,
  type CodexRequestArgs,
  type CodexResponseFor,
  type CodexServerRequest,
} from './codexProtocol'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

type NotificationListener = (notification: CodexNotification) => void
type ServerRequestListener = (request: CodexServerRequest) => boolean
type DisconnectListener = () => void

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private listeners = new Set<NotificationListener>()
  private requestListeners = new Set<ServerRequestListener>()
  private disconnectListeners = new Set<DisconnectListener>()
  private stdoutBuffer = ''
  private initializePromise: Promise<void> | null = null
  private exitPromise: Promise<void> | null = null

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child

    const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {
      // The app-server emits CLI warnings on stderr. Ignore them unless the process exits.
    })
    child.on('exit', (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? 'null'}${signal ? `/${signal}` : ''})`)
      for (const [id, pending] of this.pending) {
        this.pending.delete(id)
        pending.reject(error)
      }
      this.child = null
      this.initializePromise = null
      this.exitPromise = null
      // Discard any partial line buffered from the dead process so it can't
      // corrupt the first frame parsed from the next respawned app-server.
      this.stdoutBuffer = ''
      // Notify subscribers (the harness, hence every active turn stream) that
      // the app-server died. Without this an in-flight turn's consume loop
      // would block forever waiting for events that can never arrive.
      for (const listener of this.disconnectListeners) {
        try { listener() } catch { /* a listener throwing must not strand the others */ }
      }
    })

    this.child = child
    this.exitPromise = once(child, 'exit').then(() => undefined).catch(() => undefined)
    return child
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n')
      if (newlineIndex === -1) break

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (!line) continue

      let message: CodexJsonRpcResponse
      try {
        message = JSON.parse(line) as CodexJsonRpcResponse
      } catch {
        continue
      }

      if (message.id !== undefined && message.id !== null) {
        // A message carrying BOTH an id and a method is a server→client request
        // (e.g. an exec/patch approval). The app-server blocks the turn until we
        // reply with `respond(id, result)`, so route it to request listeners
        // rather than dropping it as an unmatched response (which hangs the turn).
        if (message.method) {
          const request: CodexServerRequest = {
            id: message.id,
            method: message.method,
            params: (message.params ?? {}) as Record<string, unknown>,
          }
          if (request.method === 'currentTime/read') {
            this.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) })
            continue
          }
          let handled = false
          for (const listener of this.requestListeners) {
            try { handled = listener(request) || handled } catch { /* keep routing to other active turns */ }
          }
          if (!handled) {
            this.respondError(request.id, -32601, `Server request method is not supported: ${request.method}`)
          }
          continue
        }
        const pending = this.pending.get(String(message.id))
        if (!pending) continue
        this.pending.delete(String(message.id))
        if (message.error) {
          pending.reject(new Error(message.error.message || 'Codex app-server request failed'))
        } else {
          pending.resolve(message.result)
        }
        continue
      }

      if (message.method) {
        const notification = { method: message.method, params: (message.params ?? {}) as Record<string, unknown> } as CodexNotification
        for (const listener of this.listeners) listener(notification)
      }
    }
  }

  private async initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise

    this.initializePromise = (async () => {
      await this.request('initialize', {
        clientInfo: {
          name: 'agent-viewer',
          title: 'Agent Viewer',
          version: '0.1.0',
        },
        capabilities: null,
      }, true)
    })()

    return this.initializePromise
  }

  async request<M extends CodexClientMethod>(
    method: M,
    ...args: CodexRequestArgs<M>
  ): Promise<CodexResponseFor<M>> {
    const params = args[0]
    const skipInitialize = args[1] ?? false
    this.ensureProcess()
    if (!skipInitialize) {
      await this.initialize()
    }

    const child = this.ensureProcess()
    const id = String(this.nextId++)
    const payload: CodexJsonRpcRequest<M> = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise<CodexResponseFor<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // Fires when the app-server child process exits (crash or restart). Lets the
  // harness broadcast a synthetic disconnect so active turn streams unblock
  // instead of hanging on an event source that will never produce again.
  subscribeDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener)
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }

  // Subscribe to server→client requests (approvals, elicitations, user input).
  subscribeServerRequests(listener: ServerRequestListener): () => void {
    this.requestListeners.add(listener)
    return () => {
      this.requestListeners.delete(listener)
    }
  }

  // Reply to a server→client request. `id` must be echoed verbatim from the
  // request. This unblocks the turn waiting on the approval.
  respond(id: string | number, result: unknown): void {
    const child = this.ensureProcess()
    const payload = { jsonrpc: '2.0', id, result }
    child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', () => {
      // Best-effort: if the pipe is gone the turn has already ended.
    })
  }

  // Reply to a server→client request with a JSON-RPC error (used when we can't
  // satisfy a request type), which the app-server treats as a refusal/abort.
  respondError(id: string | number, code: number, message: string): void {
    const child = this.ensureProcess()
    const payload = { jsonrpc: '2.0', id, error: { code, message } }
    child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', () => {})
  }
}

declare global {
  // Keep the app-server child and its live JSON-RPC subscriptions stable across
  // Next.js development module reloads. A second client would spawn a competing
  // app-server while the first still owns in-flight turns and approvals.
  // eslint-disable-next-line no-var
  var __agentViewerCodexClient: CodexAppServerClient | undefined
}

export function getCodexClient(): CodexAppServerClient {
  return globalThis.__agentViewerCodexClient
    ?? (globalThis.__agentViewerCodexClient = new CodexAppServerClient())
}

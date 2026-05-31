import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { CodexJsonRpcResponse, type CodexJsonRpcRequest, type CodexNotification, type CodexServerRequest } from './codexProtocol'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

type NotificationListener = (notification: CodexNotification) => void
type ServerRequestListener = (request: CodexServerRequest) => void

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private listeners = new Set<NotificationListener>()
  private requestListeners = new Set<ServerRequestListener>()
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
          for (const listener of this.requestListeners) listener(request)
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
          version: '0.1.0',
        },
      }, true)
    })()

    return this.initializePromise
  }

  async request<T>(method: string, params?: unknown, skipInitialize = false): Promise<T> {
    this.ensureProcess()
    if (!skipInitialize) {
      await this.initialize()
    }

    const child = this.ensureProcess()
    const id = String(this.nextId++)
    const payload: CodexJsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise<T>((resolve, reject) => {
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

let client: CodexAppServerClient | null = null

export function getCodexClient(): CodexAppServerClient {
  client ??= new CodexAppServerClient()
  return client
}

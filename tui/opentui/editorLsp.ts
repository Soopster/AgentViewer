import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export type EditorPosition = { line: number; character: number }

export type EditorCompletion = {
  label: string
  detail?: string
  insertText: string
  kind?: number
  source: 'lsp'
}

export type EditorDiagnostic = {
  line: number
  character: number
  endLine: number
  endCharacter: number
  severity: 1 | 2 | 3 | 4
  message: string
  source?: string
}

export type EditorLspServerSpec = { command: string; args: string[]; name: string }

const SERVER_BY_FILETYPE: Readonly<Record<string, readonly EditorLspServerSpec[]>> = {
  bash: [{ command: 'bash-language-server', args: ['start'], name: 'bash-language-server' }],
  c: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  cpp: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  csharp: [{ command: 'omnisharp', args: ['--languageserver'], name: 'OmniSharp' }],
  css: [{ command: 'vscode-css-language-server', args: ['--stdio'], name: 'css-language-server' }],
  go: [{ command: 'gopls', args: [], name: 'gopls' }],
  html: [{ command: 'vscode-html-language-server', args: ['--stdio'], name: 'html-language-server' }],
  javascript: [{ command: 'typescript-language-server', args: ['--stdio'], name: 'typescript-language-server' }],
  javascriptreact: [{ command: 'typescript-language-server', args: ['--stdio'], name: 'typescript-language-server' }],
  json: [{ command: 'vscode-json-language-server', args: ['--stdio'], name: 'json-language-server' }],
  lua: [{ command: 'lua-language-server', args: [], name: 'lua-language-server' }],
  python: [
    { command: 'basedpyright-langserver', args: ['--stdio'], name: 'basedpyright' },
    { command: 'pyright-langserver', args: ['--stdio'], name: 'pyright' },
    { command: 'pylsp', args: [], name: 'pylsp' },
  ],
  ruby: [{ command: 'ruby-lsp', args: [], name: 'ruby-lsp' }],
  rust: [{ command: 'rust-analyzer', args: [], name: 'rust-analyzer' }],
  typescript: [{ command: 'typescript-language-server', args: ['--stdio'], name: 'typescript-language-server' }],
  typescriptreact: [{ command: 'typescript-language-server', args: ['--stdio'], name: 'typescript-language-server' }],
  vue: [{ command: 'vue-language-server', args: ['--stdio'], name: 'vue-language-server' }],
  yaml: [{ command: 'yaml-language-server', args: ['--stdio'], name: 'yaml-language-server' }],
}

type JsonRpcMessage = {
  id?: number
  method?: string
  result?: unknown
  error?: { code?: number; message?: string }
  params?: unknown
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type EditorLspStatus =
  | { state: 'starting'; name: string }
  | { state: 'ready'; name: string }
  | { state: 'unavailable'; name: string }
  | { state: 'error'; name: string; message: string }

export class EditorLspClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private version = 1
  private pending = new Map<number, PendingRequest>()
  private openedUri: string | null = null
  private stopped = false
  private serverIndex = 0
  private diagnosticsHandler: (diagnostics: EditorDiagnostic[]) => void = () => {}
  private statusHandler: (status: EditorLspStatus) => void = () => {}

  constructor(
    private readonly rootPath: string,
    private readonly filetype: string,
    private readonly filePath: string,
    private readonly serverSpecs?: readonly EditorLspServerSpec[],
  ) {}

  onDiagnostics(handler: (diagnostics: EditorDiagnostic[]) => void): void {
    this.diagnosticsHandler = handler
  }

  onStatus(handler: (status: EditorLspStatus) => void): void {
    this.statusHandler = handler
  }

  async start(text: string): Promise<boolean> {
    const specs = this.serverSpecs ?? SERVER_BY_FILETYPE[this.filetype] ?? []
    while (!this.stopped && this.serverIndex < specs.length) {
      const spec = specs[this.serverIndex++]!
      this.statusHandler({ state: 'starting', name: spec.name })
      try {
        await this.spawnServer(spec)
        const rootUri = pathToFileURL(this.rootPath).href
        await this.request('initialize', {
          processId: process.pid,
          clientInfo: { name: 'agent-viewer', version: '1' },
          rootUri,
          workspaceFolders: [{ uri: rootUri, name: this.rootPath.split(/[\\/]/).pop() || 'workspace' }],
          capabilities: {
            textDocument: {
              completion: {
                completionItem: {
                  snippetSupport: false,
                  documentationFormat: ['plaintext', 'markdown'],
                  insertReplaceSupport: false,
                },
                contextSupport: true,
              },
              publishDiagnostics: { relatedInformation: true },
              synchronization: { didSave: true, willSave: false },
            },
            workspace: { workspaceFolders: true },
          },
        }, 8_000)
        this.notify('initialized', {})
        this.openedUri = pathToFileURL(this.filePath).href
        this.notify('textDocument/didOpen', {
          textDocument: {
            uri: this.openedUri,
            languageId: this.filetype,
            version: this.version,
            text,
          },
        })
        this.statusHandler({ state: 'ready', name: spec.name })
        return true
      } catch (error) {
        this.disposeChild()
        if (this.serverIndex >= specs.length) {
          const message = error instanceof Error ? error.message : 'language server failed'
          const missing = /ENOENT|not found/i.test(message)
          this.statusHandler(missing
            ? { state: 'unavailable', name: spec.name }
            : { state: 'error', name: spec.name, message })
        }
      }
    }
    if (specs.length === 0) this.statusHandler({ state: 'unavailable', name: this.filetype || 'plain text' })
    return false
  }

  change(text: string): void {
    if (!this.openedUri || !this.child) return
    this.version += 1
    this.notify('textDocument/didChange', {
      textDocument: { uri: this.openedUri, version: this.version },
      contentChanges: [{ text }],
    })
  }

  saved(text: string): void {
    if (!this.openedUri || !this.child) return
    this.notify('textDocument/didSave', { textDocument: { uri: this.openedUri }, text })
  }

  async completion(position: EditorPosition): Promise<EditorCompletion[]> {
    if (!this.openedUri || !this.child) return []
    const raw = await this.request('textDocument/completion', {
      textDocument: { uri: this.openedUri },
      position,
      context: { triggerKind: 1 },
    }, 2_500).catch(() => null)
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)
        ? (raw as { items: unknown[] }).items
        : []
    const completions: EditorCompletion[] = []
    for (const entry of list.slice(0, 100)) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      if (typeof item.label !== 'string') continue
      const textEdit = item.textEdit && typeof item.textEdit === 'object' ? item.textEdit as Record<string, unknown> : null
      const insertText = typeof textEdit?.newText === 'string'
        ? textEdit.newText
        : typeof item.insertText === 'string' ? item.insertText : item.label
      completions.push({
        label: item.label,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        insertText,
        kind: typeof item.kind === 'number' ? item.kind : undefined,
        source: 'lsp',
      })
    }
    return completions
  }

  stop(): void {
    this.stopped = true
    if (this.openedUri && this.child) this.notify('textDocument/didClose', { textDocument: { uri: this.openedUri } })
    this.disposeChild()
  }

  private async spawnServer(spec: EditorLspServerSpec): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: this.rootPath,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      child.once('error', fail)
      child.once('spawn', () => {
        if (settled) return
        settled = true
        this.child = child
        child.stdout.on('data', (chunk: Buffer) => this.handleData(chunk))
        child.stderr.on('data', () => {})
        child.on('exit', () => this.handleExit(spec.name))
        resolve()
      })
    })
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
      try { this.handleMessage(JSON.parse(body) as JsonRpcMessage) } catch { /* ignore malformed server output */ }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || `LSP error ${message.error.code ?? ''}`.trim()))
      else pending.resolve(message.result)
      return
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as { diagnostics?: unknown[] } | undefined
      const diagnostics: EditorDiagnostic[] = []
      for (const raw of params?.diagnostics ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Record<string, unknown>
        const range = item.range as { start?: EditorPosition; end?: EditorPosition } | undefined
        if (!range?.start || !range.end || typeof item.message !== 'string') continue
        diagnostics.push({
          line: range.start.line,
          character: range.start.character,
          endLine: range.end.line,
          endCharacter: range.end.character,
          severity: item.severity === 1 || item.severity === 2 || item.severity === 3 || item.severity === 4 ? item.severity : 3,
          message: item.message,
          source: typeof item.source === 'string' ? item.source : undefined,
        })
      }
      this.diagnosticsHandler(diagnostics)
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private send(message: unknown): void {
    if (!this.child) return
    const body = JSON.stringify(message)
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  private handleExit(name: string): void {
    if (this.stopped) return
    this.statusHandler({ state: 'error', name, message: 'language server exited' })
    this.disposeChild()
  }

  private disposeChild(): void {
    const child = this.child
    this.child = null
    this.openedUri = null
    if (child && !child.killed) child.kill()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('language server stopped'))
    }
    this.pending.clear()
  }
}

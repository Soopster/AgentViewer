import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type EditorPosition = { line: number; character: number }

export type EditorTextEdit = {
  range: { start: EditorPosition; end: EditorPosition }
  newText: string
}

export type EditorCompletion = {
  label: string
  detail?: string
  documentation?: string
  insertText: string
  filterText?: string
  sortText?: string
  kind?: number
  preselect?: boolean
  textEdit?: EditorTextEdit
  additionalTextEdits?: EditorTextEdit[]
  rawItem?: Record<string, unknown>
  resolved?: boolean
  source: 'lsp'
}

export type EditorHover = {
  contents: string
  range?: { start: EditorPosition; end: EditorPosition }
}

export type EditorSignatureHelp = {
  label: string
  documentation?: string
  activeParameter?: number
  parameters: string[]
}

export type EditorLocation = {
  uri: string
  range: { start: EditorPosition; end: EditorPosition }
}

export type EditorWorkspaceEdit = {
  changes: Array<{ uri: string; edits: EditorTextEdit[] }>
}

export type EditorPrepareRename = {
  range: { start: EditorPosition; end: EditorPosition }
  placeholder?: string
}

export type EditorCodeAction = {
  title: string
  kind?: string
  preferred?: boolean
  edit?: EditorWorkspaceEdit
  command?: { command: string; arguments?: unknown[] }
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

const moduleRequire = createRequire(import.meta.url)

function typescriptLspCommand(): string {
  const packagedCommand = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  if (packagedCommand) return packagedCommand
  try {
    const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}/package.json`
    const packagePath = moduleRequire.resolve(platformPackage)
    return join(dirname(packagePath), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
  } catch {
    return 'tsc'
  }
}

const TYPESCRIPT_FILETYPES = new Set(['javascript', 'javascriptreact', 'typescript', 'typescriptreact'])

const SERVER_BY_FILETYPE: Readonly<Record<string, readonly EditorLspServerSpec[]>> = {
  bash: [{ command: 'bash-language-server', args: ['start'], name: 'bash-language-server' }],
  c: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  cpp: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  csharp: [{ command: 'omnisharp', args: ['--languageserver'], name: 'OmniSharp' }],
  css: [{ command: 'vscode-css-language-server', args: ['--stdio'], name: 'css-language-server' }],
  go: [{ command: 'gopls', args: [], name: 'gopls' }],
  html: [{ command: 'vscode-html-language-server', args: ['--stdio'], name: 'html-language-server' }],
  json: [{ command: 'vscode-json-language-server', args: ['--stdio'], name: 'json-language-server' }],
  lua: [{ command: 'lua-language-server', args: [], name: 'lua-language-server' }],
  python: [
    { command: 'basedpyright-langserver', args: ['--stdio'], name: 'basedpyright' },
    { command: 'pyright-langserver', args: ['--stdio'], name: 'pyright' },
    { command: 'pylsp', args: [], name: 'pylsp' },
  ],
  ruby: [{ command: 'ruby-lsp', args: [], name: 'ruby-lsp' }],
  rust: [{ command: 'rust-analyzer', args: [], name: 'rust-analyzer' }],
  vue: [{ command: 'vue-language-server', args: ['--stdio'], name: 'vue-language-server' }],
  yaml: [{ command: 'yaml-language-server', args: ['--stdio'], name: 'yaml-language-server' }],
}

export function getEditorLspServerSpecs(filetype: string): readonly EditorLspServerSpec[] {
  if (TYPESCRIPT_FILETYPES.has(filetype)) {
    return [{ command: typescriptLspCommand(), args: ['--lsp', '--stdio'], name: 'TypeScript 7' }]
  }
  return SERVER_BY_FILETYPE[filetype] ?? []
}

type JsonRpcMessage = {
  id?: number | string
  method?: string
  result?: unknown
  error?: { code?: number; message?: string }
  params?: unknown
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  abortCleanup?: () => void
}

function abortError(method: string): Error {
  const error = new Error(`${method} cancelled`)
  error.name = 'AbortError'
  return error
}

function markupText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.value === 'string') return record.value
  if (typeof record.language === 'string' && typeof record.value === 'string') return record.value
  return undefined
}

function hoverText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value.map(markupText).filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }
  return markupText(value)
}

function position(value: unknown): EditorPosition | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.line !== 'number' || typeof record.character !== 'number') return null
  return { line: record.line, character: record.character }
}

function textEdit(value: unknown): EditorTextEdit | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rangeValue = record.range ?? record.replace ?? record.insert ?? (record.start && record.end ? record : undefined)
  if (!rangeValue || typeof rangeValue !== 'object' || typeof record.newText !== 'string') return null
  const range = rangeValue as Record<string, unknown>
  const start = position(range.start)
  const end = position(range.end)
  if (!start || !end) return null
  return { range: { start, end }, newText: record.newText }
}

function location(value: unknown): EditorLocation | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const uri = typeof record.uri === 'string'
    ? record.uri
    : typeof record.targetUri === 'string' ? record.targetUri : null
  const rangeValue = record.targetSelectionRange ?? record.targetRange ?? record.range
  if (!uri || !rangeValue || typeof rangeValue !== 'object') return null
  const range = rangeValue as Record<string, unknown>
  const start = position(range.start)
  const end = position(range.end)
  return start && end ? { uri, range: { start, end } } : null
}

function locations(value: unknown): EditorLocation[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.flatMap((entry) => {
    const parsed = location(entry)
    return parsed ? [parsed] : []
  })
}

function editorRange(value: unknown): { start: EditorPosition; end: EditorPosition } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const start = position(record.start)
  const end = position(record.end)
  return start && end ? { start, end } : null
}

function workspaceEdit(value: unknown): EditorWorkspaceEdit | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const grouped = new Map<string, EditorTextEdit[]>()
  const add = (uri: unknown, values: unknown) => {
    if (typeof uri !== 'string' || !Array.isArray(values)) return
    const edits = values.flatMap((entry) => {
      const parsed = textEdit(entry)
      return parsed ? [parsed] : []
    })
    if (edits.length > 0) grouped.set(uri, [...(grouped.get(uri) ?? []), ...edits])
  }
  if (record.changes && typeof record.changes === 'object') {
    for (const [uri, edits] of Object.entries(record.changes as Record<string, unknown>)) add(uri, edits)
  }
  if (Array.isArray(record.documentChanges)) {
    for (const change of record.documentChanges) {
      if (!change || typeof change !== 'object') continue
      const item = change as Record<string, unknown>
      const document = item.textDocument as Record<string, unknown> | undefined
      add(document?.uri, item.edits)
    }
  }
  return { changes: [...grouped].map(([uri, edits]) => ({ uri, edits })) }
}

function codeAction(value: unknown): EditorCodeAction | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.title !== 'string') return null
  const rawCommand = typeof record.command === 'string'
    ? { command: record.command, arguments: Array.isArray(record.arguments) ? record.arguments : undefined }
    : record.command && typeof record.command === 'object'
      ? record.command as Record<string, unknown>
      : null
  return {
    title: record.title,
    kind: typeof record.kind === 'string' ? record.kind : undefined,
    preferred: record.isPreferred === true,
    edit: workspaceEdit(record.edit) ?? undefined,
    command: rawCommand && typeof rawCommand.command === 'string'
      ? { command: rawCommand.command, arguments: Array.isArray(rawCommand.arguments) ? rawCommand.arguments : undefined }
      : undefined,
  }
}

function editorDiagnostics(value: unknown): EditorDiagnostic[] {
  if (!Array.isArray(value)) return []
  const diagnostics: EditorDiagnostic[] = []
  for (const raw of value) {
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
  return diagnostics
}

type CompletionDefaults = { editRange?: unknown; data?: unknown }

function completionItem(value: unknown, defaults: CompletionDefaults = {}): EditorCompletion | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.label !== 'string') return null
  const rawItem = defaults.data !== undefined && item.data === undefined ? { ...item, data: defaults.data } : item
  const explicitEdit = textEdit(item.textEdit)
  const defaultEditRange = defaults.editRange && typeof defaults.editRange === 'object'
    ? defaults.editRange as Record<string, unknown>
    : null
  const defaultNewText = typeof item.textEditText === 'string'
    ? item.textEditText
    : typeof item.insertText === 'string' ? item.insertText : item.label
  const defaultEdit = explicitEdit ?? textEdit(defaultEditRange
    ? { ...defaultEditRange, newText: defaultNewText }
    : null)
  const insertText = defaultEdit?.newText ?? defaultNewText
  const additionalTextEdits = Array.isArray(item.additionalTextEdits)
    ? item.additionalTextEdits.flatMap((entry) => {
        const parsed = textEdit(entry)
        return parsed ? [parsed] : []
      })
    : undefined
  return {
    label: item.label,
    detail: typeof item.detail === 'string' ? item.detail : undefined,
    documentation: markupText(item.documentation),
    insertText,
    filterText: typeof item.filterText === 'string' ? item.filterText : undefined,
    sortText: typeof item.sortText === 'string' ? item.sortText : undefined,
    kind: typeof item.kind === 'number' ? item.kind : undefined,
    preselect: item.preselect === true,
    textEdit: defaultEdit ?? undefined,
    additionalTextEdits,
    rawItem,
    source: 'lsp',
  }
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
  private lastText: string | null = null
  private completionResolveProvider = false
  private completionTriggerCharacters = new Set<string>()
  private pullDiagnostics = false
  private diagnosticRequest = 0
  private serverStderr = ''
  private diagnosticsHandler: (diagnostics: EditorDiagnostic[]) => void = () => {}
  private statusHandler: (status: EditorLspStatus) => void = () => {}
  private workspaceEditHandler: (edit: EditorWorkspaceEdit) => Promise<boolean> = async () => false

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

  onWorkspaceEdit(handler: (edit: EditorWorkspaceEdit) => Promise<boolean>): void {
    this.workspaceEditHandler = handler
  }

  async start(text: string): Promise<boolean> {
    const specs = this.serverSpecs ?? getEditorLspServerSpecs(this.filetype)
    while (!this.stopped && this.serverIndex < specs.length) {
      const spec = specs[this.serverIndex++]!
      this.statusHandler({ state: 'starting', name: spec.name })
      try {
        await this.spawnServer(spec)
        const rootUri = pathToFileURL(this.rootPath).href
        const initializeResult = await this.request('initialize', {
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
                  insertReplaceSupport: true,
                  resolveSupport: {
                    properties: ['documentation', 'detail', 'additionalTextEdits'],
                  },
                },
                contextSupport: true,
              },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              definition: { linkSupport: true },
              implementation: { linkSupport: true },
              signatureHelp: {
                signatureInformation: {
                  documentationFormat: ['markdown', 'plaintext'],
                  parameterInformation: { labelOffsetSupport: true },
                  activeParameterSupport: true,
                },
                contextSupport: true,
              },
              publishDiagnostics: { relatedInformation: true },
              diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
              synchronization: { didSave: true, willSave: false },
            },
            workspace: {
              workspaceFolders: true,
              configuration: true,
              applyEdit: true,
              workspaceEdit: { documentChanges: true },
            },
          },
        }, 8_000)
        if (this.stopped) return false
        const serverCapabilities = initializeResult && typeof initializeResult === 'object'
          ? (initializeResult as { capabilities?: Record<string, unknown> }).capabilities
          : undefined
        const completionProvider = serverCapabilities?.completionProvider && typeof serverCapabilities.completionProvider === 'object'
          ? serverCapabilities.completionProvider as Record<string, unknown>
          : undefined
        this.completionResolveProvider = completionProvider?.resolveProvider === true
        this.completionTriggerCharacters = new Set(
          Array.isArray(completionProvider?.triggerCharacters)
            ? completionProvider.triggerCharacters.filter((value): value is string => typeof value === 'string')
            : [],
        )
        this.pullDiagnostics = Boolean(serverCapabilities?.diagnosticProvider)
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
        this.lastText = text
        this.statusHandler({ state: 'ready', name: spec.name })
        void this.refreshDiagnostics()
        return true
      } catch (error) {
        this.disposeChild()
        if (this.stopped) return false
        if (this.serverIndex >= specs.length) {
          const message = this.serverStderr.trim()
            || (error instanceof Error ? error.message : 'language server failed')
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
    if (text === this.lastText) return
    this.lastText = text
    this.version += 1
    this.notify('textDocument/didChange', {
      textDocument: { uri: this.openedUri, version: this.version },
      contentChanges: [{ text }],
    })
    void this.refreshDiagnostics()
  }

  saved(text: string): void {
    if (!this.openedUri || !this.child) return
    this.notify('textDocument/didSave', { textDocument: { uri: this.openedUri }, text })
    void this.refreshDiagnostics()
  }

  isCompletionTriggerCharacter(character: string | undefined): boolean {
    return Boolean(character && this.completionTriggerCharacters.has(character))
  }

  async completion(position: EditorPosition, triggerCharacter?: string, signal?: AbortSignal): Promise<EditorCompletion[]> {
    if (!this.openedUri || !this.child) return []
    const useTriggerCharacter = this.isCompletionTriggerCharacter(triggerCharacter)
    const raw = await this.request('textDocument/completion', {
      textDocument: { uri: this.openedUri },
      position,
      context: useTriggerCharacter
        ? { triggerKind: 2, triggerCharacter }
        : { triggerKind: 1 },
    }, 2_500, signal).catch(() => null)
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)
        ? (raw as { items: unknown[] }).items
        : []
    const defaults = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ((raw as { itemDefaults?: CompletionDefaults }).itemDefaults ?? {})
      : {}
    const completions: EditorCompletion[] = []
    for (const entry of list.slice(0, 100)) {
      const parsed = completionItem(entry, defaults)
      if (parsed) completions.push(parsed)
    }
    completions.sort((left, right) => {
      const leftKey = left.sortText ?? left.label
      const rightKey = right.sortText ?? right.label
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
    return completions
  }

  async resolveCompletion(completion: EditorCompletion, signal?: AbortSignal): Promise<EditorCompletion> {
    if (!this.openedUri || !this.child || !this.completionResolveProvider || completion.resolved || !completion.rawItem) {
      return completion.resolved ? completion : { ...completion, resolved: true }
    }
    const raw = await this.request('completionItem/resolve', completion.rawItem, 2_500, signal).catch(() => null)
    const resolved = completionItem(raw)
    if (!resolved) return { ...completion, resolved: true }
    const rawRecord = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
    const resolvedInsertion = Boolean(rawRecord && (
      typeof rawRecord.insertText === 'string'
      || typeof rawRecord.textEditText === 'string'
      || rawRecord.textEdit != null
    ))
    return {
      ...completion,
      ...resolved,
      insertText: resolvedInsertion ? resolved.insertText : completion.insertText,
      textEdit: resolved.textEdit ?? completion.textEdit,
      additionalTextEdits: resolved.additionalTextEdits ?? completion.additionalTextEdits,
      resolved: true,
    }
  }

  async hover(position: EditorPosition): Promise<EditorHover | null> {
    if (!this.openedUri || !this.child) return null
    const raw = await this.request('textDocument/hover', {
      textDocument: { uri: this.openedUri },
      position,
    }, 2_500).catch(() => null)
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    const contents = hoverText(item.contents)
    if (!contents) return null
    const range = item.range as { start?: EditorPosition; end?: EditorPosition } | undefined
    return {
      contents,
      range: range?.start && range.end ? { start: range.start, end: range.end } : undefined,
    }
  }

  async signatureHelp(position: EditorPosition, triggerCharacter?: string): Promise<EditorSignatureHelp | null> {
    if (!this.openedUri || !this.child) return null
    const raw = await this.request('textDocument/signatureHelp', {
      textDocument: { uri: this.openedUri },
      position,
      context: {
        triggerKind: triggerCharacter ? 2 : 1,
        triggerCharacter,
        isRetrigger: false,
      },
    }, 2_500).catch(() => null)
    if (!raw || typeof raw !== 'object') return null
    const response = raw as Record<string, unknown>
    const signatures = Array.isArray(response.signatures) ? response.signatures : []
    const activeSignature = typeof response.activeSignature === 'number' ? response.activeSignature : 0
    const rawSignature = signatures[activeSignature] ?? signatures[0]
    if (!rawSignature || typeof rawSignature !== 'object') return null
    const signature = rawSignature as Record<string, unknown>
    if (typeof signature.label !== 'string') return null
    const signatureLabel = signature.label
    const parameters = Array.isArray(signature.parameters)
      ? signature.parameters.flatMap((rawParameter) => {
          if (!rawParameter || typeof rawParameter !== 'object') return []
          const label = (rawParameter as Record<string, unknown>).label
          if (typeof label === 'string') return [label]
          if (Array.isArray(label) && label.length === 2 && label.every((part) => typeof part === 'number')) {
            return [signatureLabel.slice(label[0] as number, label[1] as number)]
          }
          return []
        })
      : []
    return {
      label: signatureLabel,
      documentation: markupText(signature.documentation),
      activeParameter: typeof response.activeParameter === 'number'
        ? response.activeParameter
        : typeof signature.activeParameter === 'number' ? signature.activeParameter : undefined,
      parameters,
    }
  }

  async definition(position: EditorPosition): Promise<EditorLocation[]> {
    return this.documentLocations('textDocument/definition', position)
  }

  async references(position: EditorPosition): Promise<EditorLocation[]> {
    return this.documentLocations('textDocument/references', position, { includeDeclaration: true })
  }

  async implementation(position: EditorPosition): Promise<EditorLocation[]> {
    return this.documentLocations('textDocument/implementation', position)
  }

  async prepareRename(position: EditorPosition): Promise<EditorPrepareRename | null> {
    if (!this.openedUri || !this.child) return null
    const raw = await this.request('textDocument/prepareRename', {
      textDocument: { uri: this.openedUri },
      position,
    }, 2_500).catch(() => null)
    const directRange = editorRange(raw)
    if (directRange) return { range: directRange }
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    const range = editorRange(record.range)
    return range ? { range, placeholder: typeof record.placeholder === 'string' ? record.placeholder : undefined } : null
  }

  async rename(position: EditorPosition, newName: string): Promise<EditorWorkspaceEdit | null> {
    if (!this.openedUri || !this.child) return null
    const raw = await this.request('textDocument/rename', {
      textDocument: { uri: this.openedUri },
      position,
      newName,
    }, 5_000).catch(() => null)
    return workspaceEdit(raw)
  }

  async formatting(options: { tabSize: number; insertSpaces: boolean } = { tabSize: 2, insertSpaces: true }): Promise<EditorWorkspaceEdit | null> {
    if (!this.openedUri || !this.child) return null
    const raw = await this.request('textDocument/formatting', {
      textDocument: { uri: this.openedUri },
      options,
    }, 5_000).catch(() => null)
    const edits = Array.isArray(raw) ? raw.flatMap((entry) => {
      const parsed = textEdit(entry)
      return parsed ? [parsed] : []
    }) : []
    return edits.length > 0 ? { changes: [{ uri: this.openedUri, edits }] } : null
  }

  async codeActions(
    range: { start: EditorPosition; end: EditorPosition },
    diagnostics: EditorDiagnostic[],
  ): Promise<EditorCodeAction[]> {
    if (!this.openedUri || !this.child) return []
    const raw = await this.request('textDocument/codeAction', {
      textDocument: { uri: this.openedUri },
      range,
      context: { diagnostics },
    }, 3_500).catch(() => null)
    return Array.isArray(raw) ? raw.flatMap((entry) => {
      const parsed = codeAction(entry)
      return parsed ? [parsed] : []
    }).sort((left, right) => Number(right.preferred) - Number(left.preferred)) : []
  }

  async executeCommand(command: { command: string; arguments?: unknown[] }): Promise<void> {
    if (!this.child) return
    await this.request('workspace/executeCommand', command, 5_000).catch(() => null)
  }

  stop(): void {
    this.stopped = true
    if (this.openedUri && this.child) this.notify('textDocument/didClose', { textDocument: { uri: this.openedUri } })
    this.disposeChild()
  }

  private async spawnServer(spec: EditorLspServerSpec): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.serverStderr = ''
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
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          this.serverStderr = `${this.serverStderr}${chunk}`.slice(-4_096)
        })
        child.stdin.on('error', (error) => {
          if (this.stopped || this.child !== child) return
          this.serverStderr = `${this.serverStderr}\n${error.message}`.trim().slice(-4_096)
          this.handleExit(spec.name)
        })
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
    if (message.id != null && message.method === 'workspace/applyEdit') {
      const params = message.params as { edit?: unknown } | undefined
      const edit = workspaceEdit(params?.edit)
      void (edit ? this.workspaceEditHandler(edit) : Promise.resolve(false)).then((applied) => {
        this.send({ jsonrpc: '2.0', id: message.id, result: { applied } })
      }).catch((error) => {
        this.send({ jsonrpc: '2.0', id: message.id, result: { applied: false, failureReason: error instanceof Error ? error.message : 'Unable to apply edit' } })
      })
      return
    }
    if (message.id != null && message.method === 'workspace/configuration') {
      const items = (message.params as { items?: unknown } | undefined)?.items
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        result: Array.isArray(items) ? items.map(() => null) : [],
      })
      return
    }
    if (message.id != null && message.method === 'workspace/workspaceFolders') {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        result: [{ uri: pathToFileURL(this.rootPath).href, name: this.rootPath.split(/[\\/]/).pop() || 'workspace' }],
      })
      return
    }
    if (message.id != null && (message.method === 'client/registerCapability'
      || message.method === 'client/unregisterCapability'
      || message.method === 'window/workDoneProgress/create')) {
      this.send({ jsonrpc: '2.0', id: message.id, result: null })
      return
    }
    if (message.id != null && message.method) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Unsupported client method: ${message.method}` },
      })
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      pending.abortCleanup?.()
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || `LSP error ${message.error.code ?? ''}`.trim()))
      else pending.resolve(message.result)
      return
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as { diagnostics?: unknown[] } | undefined
      this.diagnosticsHandler(editorDiagnostics(params?.diagnostics))
    }
  }

  private async refreshDiagnostics(): Promise<void> {
    if (!this.pullDiagnostics || !this.openedUri || !this.child) return
    const request = ++this.diagnosticRequest
    const raw = await this.request('textDocument/diagnostic', {
      textDocument: { uri: this.openedUri },
    }, 5_000).catch(() => null)
    if (request !== this.diagnosticRequest || this.stopped || !raw || typeof raw !== 'object') return
    this.diagnosticsHandler(editorDiagnostics((raw as { items?: unknown }).items))
  }

  private request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(method))
        return
      }
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        pending?.abortCleanup?.()
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      const onAbort = signal ? () => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        pending.abortCleanup?.()
        this.pending.delete(id)
        this.notify('$/cancelRequest', { id })
        reject(abortError(method))
      } : null
      const abortCleanup = onAbort && signal
        ? () => signal.removeEventListener('abort', onAbort)
        : undefined
      if (onAbort && signal) signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve, reject, timer, abortCleanup })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private async documentLocations(
    method: 'textDocument/definition' | 'textDocument/references' | 'textDocument/implementation',
    position: EditorPosition,
    context?: { includeDeclaration: boolean },
  ): Promise<EditorLocation[]> {
    if (!this.openedUri || !this.child) return []
    const raw = await this.request(method, {
      textDocument: { uri: this.openedUri },
      position,
      ...(context ? { context } : {}),
    }, 3_500).catch(() => null)
    return locations(raw)
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
    if (this.stopped || !this.child) return
    this.statusHandler({ state: 'error', name, message: this.serverStderr.trim() || 'language server exited' })
    this.disposeChild()
  }

  private disposeChild(): void {
    const child = this.child
    this.child = null
    this.openedUri = null
    this.lastText = null
    this.completionResolveProvider = false
    this.completionTriggerCharacters.clear()
    this.pullDiagnostics = false
    this.diagnosticRequest += 1
    if (child && !child.killed) child.kill()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.abortCleanup?.()
      pending.reject(new Error('language server stopped'))
    }
    this.pending.clear()
  }
}

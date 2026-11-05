import { pathToFileURL } from 'node:url'
import { LSP_SYNC_FULL, lspContentChanges } from './editorLspSync'
import { acquireLspSession, type EditorLspSession, type LspDocumentHandlers } from './editorLspSession'
import { editorLspStartupNotifications, getEditorLspServerSpecs, type EditorLspServerSpec } from './editorLspServers'

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
  insertTextFormat?: 1 | 2
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

/**
 * A symbol from `textDocument/documentSymbol` or `workspace/symbol`, flattened.
 * `depth` keeps the nesting a hierarchical server reports (a method inside a
 * class), which is what makes an outline readable rather than an alphabet soup
 * of names.
 */
export type EditorSymbol = {
  name: string
  kind: number
  detail?: string
  container?: string
  depth: number
  uri: string
  /** Where to put the caret: the symbol's name, not the top of its body. */
  range: { start: EditorPosition; end: EditorPosition }
  /**
   * The symbol's whole extent, which is what answers "which function is the
   * caret in". A flat `SymbolInformation` has only one range and it means this
   * one, so the two collapse together there.
   */
  enclosingRange: { start: EditorPosition; end: EditorPosition }
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

export type { EditorLspServerSpec } from './editorLspServers'
export { getEditorLspServerSpecs, resolveLspWorkspaceRoot, loadEditorLspConfig } from './editorLspServers'

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

// Servers answer documentSymbol with either shape and are free to pick: a
// hierarchical `DocumentSymbol[]`, or a flat `SymbolInformation[]` whose
// position lives under `location`. Both are folded into one flat, depth-tagged
// list so the caller never has to care which server it is talking to.
function editorSymbols(value: unknown, fallbackUri: string, depth = 0, container?: string): EditorSymbol[] {
  if (!Array.isArray(value)) return []
  const symbols: EditorSymbol[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.name !== 'string') continue
    const locationValue = item.location as Record<string, unknown> | undefined
    const fullRange = editorRange(item.range) ?? editorRange(locationValue?.range)
    const range = editorRange(item.selectionRange) ?? fullRange
    if (!range) continue
    const uri = typeof locationValue?.uri === 'string' ? locationValue.uri : fallbackUri
    symbols.push({
      name: item.name,
      kind: typeof item.kind === 'number' ? item.kind : 0,
      detail: typeof item.detail === 'string' ? item.detail : undefined,
      container: typeof item.containerName === 'string' ? item.containerName : container,
      depth,
      uri,
      range,
      enclosingRange: fullRange ?? range,
    })
    // A child's own container is its parent, whatever the server chose to send.
    symbols.push(...editorSymbols(item.children, uri, depth + 1, item.name))
  }
  return symbols
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

type CompletionDefaults = { editRange?: unknown; data?: unknown; insertTextFormat?: unknown }

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
  const rawInsertTextFormat = item.insertTextFormat ?? defaults.insertTextFormat
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
    insertTextFormat: rawInsertTextFormat === 2 ? 2 : rawInsertTextFormat === 1 ? 1 : undefined,
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
  | { state: 'loading'; name: string; detail?: string }
  | { state: 'unavailable'; name: string }
  | { state: 'error'; name: string; message: string }

const MAX_LSP_RESTARTS = Number(process.env.AGENT_VIEWER_LSP_MAX_RESTARTS ?? 3)
const LSP_RESTART_BASE_DELAY_MS = Number(process.env.AGENT_VIEWER_LSP_RESTART_DELAY_MS ?? 1_000)
function workspaceLabel(rootPath: string): string {
  return rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath
}

/** Sessions that have already had their server's startup notifications sent. */
const startedSessions = new WeakSet<EditorLspSession>()

const INITIALIZE_TIMEOUT_MS = Number(process.env.AGENT_VIEWER_LSP_INIT_TIMEOUT_MS ?? 20_000)

/**
 * What this editor tells a server it can do. Sent once per session rather than
 * once per buffer, so it describes the client, never a particular document.
 */
function initializeParams(rootUri: string, rootPath: string): unknown {
  return {
    processId: process.pid,
    clientInfo: { name: 'agent-viewer', version: '1' },
    rootUri,
    rootPath,
    workspaceFolders: [{ uri: rootUri, name: rootPath.split(/[\\/]/).pop() || 'workspace' }],
    capabilities: {
      general: { positionEncodings: ['utf-16'] },
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport: true,
            documentationFormat: ['plaintext', 'markdown'],
            insertReplaceSupport: true,
            labelDetailsSupport: true,
            resolveSupport: {
              properties: ['documentation', 'detail', 'additionalTextEdits'],
            },
          },
          completionList: { itemDefaults: ['editRange', 'insertTextFormat', 'data'] },
          contextSupport: true,
        },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        definition: { linkSupport: true },
        implementation: { linkSupport: true },
        references: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        rename: { prepareSupport: true },
        formatting: {},
        codeAction: {
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'],
            },
          },
          isPreferredSupport: true,
        },
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
        symbol: {},
        workspaceFolders: true,
        configuration: true,
        applyEdit: true,
        workspaceEdit: { documentChanges: true },
        didChangeConfiguration: { dynamicRegistration: false },
      },
      window: { workDoneProgress: true },
    },
  }
}

/**
 * One open buffer's view of a language server.
 *
 * The process itself belongs to `editorLspSession.ts` and is shared with every
 * other buffer in the same workspace that speaks to the same server, so
 * switching tabs no longer restarts (and re-indexes) anything.
 */
export class EditorLspClient {
  private session: EditorLspSession | null = null
  private releaseSession: (() => void) | null = null
  private openedUri: string | null = null
  private stopped = false
  private lastText: string | null = null
  private startupError = ''
  private restartAttempts = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private liveText = ''
  private documentHandlers: LspDocumentHandlers | null = null
  private diagnosticRequest = 0
  private diagnosticsHandler: (diagnostics: EditorDiagnostic[]) => void = () => {}
  private statusHandler: (status: EditorLspStatus) => void = () => {}
  private workspaceEditHandler: (edit: EditorWorkspaceEdit) => Promise<boolean> = async () => false

  constructor(
    private readonly rootPath: string,
    private readonly filetype: string,
    private readonly filePath: string,
    private readonly serverSpecs?: readonly EditorLspServerSpec[],
  ) {}

  /** Truthy while a live session backs this buffer; kept so guards read as before. */
  private get child(): EditorLspSession | null {
    return this.session && this.session.alive ? this.session : null
  }

  private get completionResolveProvider(): boolean {
    return this.session?.capabilities.completionResolveProvider ?? false
  }

  private get pullDiagnostics(): boolean {
    return this.session?.capabilities.pullDiagnostics ?? false
  }

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
    this.liveText = text
    const specs = this.serverSpecs ?? getEditorLspServerSpecs(this.filetype)
    let lastSpec: EditorLspServerSpec | null = null
    let missing = specs.length > 0
    for (const spec of specs) {
      if (this.stopped) return false
      lastSpec = spec
      this.statusHandler({ state: 'starting', name: spec.name })
      try {
        const session = await acquireLspSession({
          rootPath: this.rootPath,
          command: spec.command,
          args: spec.args,
          serverName: spec.name,
          initializeParams: (rootUri) => initializeParams(rootUri, this.rootPath),
          initializeTimeoutMs: INITIALIZE_TIMEOUT_MS,
        })
        if (this.stopped) {
          session.release()
          return false
        }
        this.session = session
        this.releaseSession = () => session.release()
        // Sent once per session, not per buffer: telling a server about the
        // same project twice is at best wasted work.
        if (!startedSessions.has(session)) {
          startedSessions.add(session)
          const startup = editorLspStartupNotifications(spec, this.rootPath, this.filePath)
          if (startup.length > 0) session.awaitWorkspaceLoad()
          for (const notification of startup) {
            session.notify(notification.method, notification.params)
          }
        }
        const uri = pathToFileURL(this.filePath).href
        this.openedUri = uri
        const unsubscribeRefresh = session.onDiagnosticsStale(() => {
          if (this.stopped || this.session !== session) return
          // The same signal says the workspace finished loading, which is the
          // moment the server's answers become worth anything.
          this.statusHandler({ state: 'ready', name: spec.name })
          void this.refreshDiagnostics()
        })
        const unsubscribeExit = session.onExit((exit) => {
          if (this.stopped || this.session !== session) return
          this.session = null
          this.releaseSession = null
          this.openedUri = null
          this.lastText = null
          this.statusHandler({ state: 'error', name: spec.name, message: exit.message })
          // A server that dies takes completions, diagnostics and navigation
          // with it, and the buffer gives no sign beyond a status word. Coming
          // back on its own is what an editor is expected to do; the attempt
          // cap is what stops a server that crashes on startup from respawning
          // forever.
          this.scheduleRestart(spec.name)
        })
        const releaseSession = this.releaseSession
        this.releaseSession = () => {
          unsubscribeExit()
          unsubscribeRefresh()
          releaseSession()
        }
        const documentHandlers = {
          onDiagnostics: (params: unknown) => {
            const diagnostics = (params as { diagnostics?: unknown } | undefined)?.diagnostics
            this.diagnosticsHandler(editorDiagnostics(diagnostics))
          },
          onApplyEdit: async (raw: unknown) => {
            const edit = workspaceEdit(raw)
            return edit ? this.workspaceEditHandler(edit) : false
          },
        }
        this.documentHandlers = documentHandlers
        session.openDocument(uri, this.filetype, text, documentHandlers)
        this.lastText = text
        this.restartAttempts = 0
        // `initialize` returning is not readiness. A server still loading a
        // solution answers every request with an empty result, and saying
        // "ready" there makes a two-minute load look like a broken editor.
        this.statusHandler(session.workspaceLoaded
          ? { state: 'ready', name: spec.name }
          : { state: 'loading', name: spec.name, detail: workspaceLabel(this.rootPath) })
        void this.refreshDiagnostics()
        return true
      } catch (error) {
        if (this.stopped) return false
        const notFound = error instanceof Error && error.name === 'LspCommandNotFound'
        const message = error instanceof Error ? error.message : 'language server failed'
        if (!notFound) missing = false
        this.startupError = message
      }
    }
    if (this.stopped) return false
    if (specs.length === 0 || !lastSpec) {
      this.statusHandler({ state: 'unavailable', name: this.filetype || 'plain text' })
      return false
    }
    this.statusHandler(missing || /ENOENT|not found/i.test(this.startupError)
      ? { state: 'unavailable', name: lastSpec.name }
      : { state: 'error', name: lastSpec.name, message: this.startupError })
    return false
  }

  change(text: string): void {
    // Kept even while no server is running: a restart has to reopen the
    // document as it is now, not as it was when the old one died.
    this.liveText = text
    const session = this.session
    if (!this.openedUri || !session || !session.alive) return
    if (text === this.lastText) return
    // The changes describe the transition from what the server currently
    // holds, so they must be computed before `lastText` moves. A server that
    // asked for no synchronisation gets none, and the version stays put — a
    // version that advances without a notification would make the next real
    // one look like it skipped an edit.
    const contentChanges = lspContentChanges(
      this.lastText ?? '',
      text,
      this.lastText == null ? LSP_SYNC_FULL : session.capabilities.syncKind,
    )
    this.lastText = text
    if (contentChanges.length === 0) return
    const version = session.nextVersion(this.openedUri)
    if (version == null) return
    session.notify('textDocument/didChange', {
      textDocument: { uri: this.openedUri, version },
      contentChanges,
    })
    void this.refreshDiagnostics()
  }

  saved(text: string): void {
    if (!this.openedUri || !this.child) return
    this.notify('textDocument/didSave', { textDocument: { uri: this.openedUri }, text })
    void this.refreshDiagnostics()
  }

  isCompletionTriggerCharacter(character: string | undefined): boolean {
    return Boolean(character && this.session?.capabilities.completionTriggerCharacters.has(character))
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
      insertTextFormat: resolved.insertTextFormat ?? completion.insertTextFormat,
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

  /** Every symbol in this buffer, in the order the server reports them. */
  async documentSymbols(signal?: AbortSignal): Promise<EditorSymbol[]> {
    if (!this.openedUri || !this.child) return []
    const raw = await this.request('textDocument/documentSymbol', {
      textDocument: { uri: this.openedUri },
    }, 5_000, signal).catch(() => null)
    return editorSymbols(raw, this.openedUri)
  }

  /**
   * Symbols matching `query` across the workspace. An empty query is not sent:
   * several servers answer it with every symbol they know, which is a
   * multi-second response nobody asked for.
   */
  async workspaceSymbols(query: string, signal?: AbortSignal): Promise<EditorSymbol[]> {
    if (!this.child || query.trim().length === 0) return []
    const raw = await this.request('workspace/symbol', { query }, 5_000, signal).catch(() => null)
    return editorSymbols(raw, this.openedUri ?? '')
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
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const session = this.session
    const uri = this.openedUri
    this.session = null
    this.openedUri = null
    this.lastText = null
    this.diagnosticRequest += 1
    // Closing the buffer closes its document; the process stays warm for the
    // next buffer of the same language and is reaped only once nothing holds it.
    if (session && uri) session.closeDocument(uri, this.documentHandlers ?? undefined)
    this.documentHandlers = null
    this.releaseSession?.()
    this.releaseSession = null
  }

  private scheduleRestart(name: string): void {
    if (this.stopped || this.restartTimer) return
    if (this.restartAttempts >= MAX_LSP_RESTARTS) return
    const attempt = ++this.restartAttempts
    const delay = LSP_RESTART_BASE_DELAY_MS * 2 ** (attempt - 1)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopped || this.session) return
      this.statusHandler({ state: 'starting', name })
      void this.start(this.liveText)
    }, delay)
    this.restartTimer.unref?.()
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
    const session = this.child
    if (!session) return Promise.reject(new Error(`${method} failed: language server is not running`))
    return session.request(method, params, timeoutMs, signal)
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
    this.child?.notify(method, params)
  }
}

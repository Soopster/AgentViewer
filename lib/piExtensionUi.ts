import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { PendingQuestionAnswers } from './permissions'

type PiUiDialogMethod = 'select' | 'confirm' | 'input' | 'editor'
export type PiUiRequest = {
  method: PiUiDialogMethod | 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text'
  title?: string
  message?: string
  placeholder?: string
  prefill?: string
  options?: string[]
  timeout?: number
  signal?: AbortSignal
  notifyType?: 'info' | 'warning' | 'error'
  value?: string
}
export type PiUiResult = string | boolean | undefined
export type PiUiHandler = (request: PiUiRequest) => Promise<PiUiResult>

type PendingPiUiRequest = {
  method: PiUiDialogMethod
  resolve: (result: PiUiResult) => void
  timer?: ReturnType<typeof setTimeout>
  requestPayload: Record<string, unknown>
}

declare global {
  // Pi sessions and their extension runners survive Next.js dev reloads in the
  // warm pool. Keep their dispatchers and pending dialog resolvers alongside
  // them so a reload cannot orphan an answerable prompt.
  // eslint-disable-next-line no-var
  var __agentViewerPiUiHandlers: Map<string, PiUiHandler> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiUiBoundSessions: WeakSet<object> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPendingPiUiRequests: Map<string, PendingPiUiRequest> | undefined
}

const piUiHandlers = globalThis.__agentViewerPiUiHandlers
  ?? (globalThis.__agentViewerPiUiHandlers = new Map<string, PiUiHandler>())
const piUiBoundSessions = globalThis.__agentViewerPiUiBoundSessions
  ?? (globalThis.__agentViewerPiUiBoundSessions = new WeakSet<object>())
const pendingPiUiRequests = globalThis.__agentViewerPendingPiUiRequests
  ?? (globalThis.__agentViewerPendingPiUiRequests = new Map<string, PendingPiUiRequest>())

function pendingPiUiKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}

function defaultPiUiResult(method: PiUiRequest['method']): PiUiResult {
  return method === 'confirm' ? false : undefined
}

function findPendingPiUiRequest(sessionId: string, requestId: string): PendingPiUiRequest | undefined {
  return pendingPiUiRequests.get(pendingPiUiKey(sessionId, requestId))
}

async function dispatchPiUi(sessionId: string, request: PiUiRequest): Promise<PiUiResult> {
  const handler = piUiHandlers.get(sessionId)
  return handler ? handler(request) : defaultPiUiResult(request.method)
}

export function installPiUiHandler(sessionId: string, handler: PiUiHandler): () => void {
  piUiHandlers.set(sessionId, handler)
  return () => {
    if (piUiHandlers.get(sessionId) === handler) piUiHandlers.delete(sessionId)
  }
}

export async function ensurePiExtensionUiBound(session: AgentSession, sessionId: string): Promise<void> {
  if (piUiBoundSessions.has(session)) return
  const fire = (request: PiUiRequest) => {
    void dispatchPiUi(sessionId, request).catch(() => {})
  }
  const uiContext = {
    select: (title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }) =>
      dispatchPiUi(sessionId, { method: 'select', title, options, timeout: opts?.timeout, signal: opts?.signal }) as Promise<string | undefined>,
    confirm: (title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }) =>
      dispatchPiUi(sessionId, { method: 'confirm', title, message, timeout: opts?.timeout, signal: opts?.signal }) as Promise<boolean>,
    input: (title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }) =>
      dispatchPiUi(sessionId, { method: 'input', title, placeholder, timeout: opts?.timeout, signal: opts?.signal }) as Promise<string | undefined>,
    editor: (title: string, prefill?: string) =>
      dispatchPiUi(sessionId, { method: 'editor', title, prefill }) as Promise<string | undefined>,
    notify: (message: string, notifyType?: 'info' | 'warning' | 'error') => fire({ method: 'notify', message, notifyType }),
    onTerminalInput: () => () => {},
    setStatus: (key: string, value: string | undefined) => fire({ method: 'setStatus', title: key, value }),
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: (key: string, content: unknown) => {
      if (content === undefined || Array.isArray(content)) fire({ method: 'setWidget', title: key })
    },
    setFooter: () => {},
    setHeader: () => {},
    setTitle: (title: string) => fire({ method: 'setTitle', title }),
    custom: async () => undefined,
    pasteToEditor: (text: string) => fire({ method: 'set_editor_text', value: text }),
    setEditorText: (text: string) => fire({ method: 'set_editor_text', value: text }),
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: {},
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching is owned by AgentViewer' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  } as unknown as NonNullable<Parameters<AgentSession['bindExtensions']>[0]['uiContext']>
  await session.bindExtensions({
    uiContext,
    mode: 'rpc',
    onError: (error) => console.error(`[pi-extension] ${error.extensionPath}: ${error.error}`),
  })
  piUiBoundSessions.add(session)
}

function piUiRequestedPayload(sessionId: string, requestId: string, request: PiUiRequest): Record<string, unknown> {
  return {
    type: 'pi_ui',
    event: {
      type: 'question.requested',
      data: {
        requestId,
        sessionId,
        method: request.method,
        title: request.title,
        message: request.message,
        placeholder: request.placeholder,
        prefill: request.prefill,
        options: request.options,
      },
    },
  }
}

function turnNoticeEvent(message: string): string {
  return `event: turn-notice\ndata: ${JSON.stringify({ message })}\n\n`
}

export function createPiUiBridge(
  sessionId: string,
  enqueue: (chunk: string) => void,
  activeIds: Set<string>,
): PiUiHandler {
  return async (request) => {
    if (request.method === 'notify') {
      if (request.message?.trim()) enqueue(turnNoticeEvent(request.message.trim()))
      return undefined
    }
    if (request.method !== 'select' && request.method !== 'confirm' && request.method !== 'input' && request.method !== 'editor') {
      return undefined
    }
    const method = request.method
    if (request.signal?.aborted) return defaultPiUiResult(method)
    const requestId = `pi-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const requestPayload = piUiRequestedPayload(sessionId, requestId, request)
    activeIds.add(requestId)
    enqueue(`data: ${JSON.stringify(requestPayload)}\n\n`)
    return new Promise<PiUiResult>((resolve) => {
      const key = pendingPiUiKey(sessionId, requestId)
      let settled = false
      const finish = (result: PiUiResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        request.signal?.removeEventListener('abort', onAbort)
        pendingPiUiRequests.delete(key)
        activeIds.delete(requestId)
        enqueue(`data: ${JSON.stringify({
          type: 'pi_ui',
          event: { type: 'question.completed', data: { requestId } },
        })}\n\n`)
        resolve(result)
      }
      const onAbort = () => finish(defaultPiUiResult(method))
      const timer = request.timeout && request.timeout > 0
        ? setTimeout(onAbort, request.timeout)
        : undefined
      if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
      request.signal?.addEventListener('abort', onAbort, { once: true })
      pendingPiUiRequests.set(key, {
        method,
        resolve: finish,
        timer,
        requestPayload,
      })
    })
  }
}

export function cancelPendingPiUiRequests(sessionId: string, ids: Set<string>): void {
  for (const id of Array.from(ids)) {
    const pending = pendingPiUiRequests.get(pendingPiUiKey(sessionId, id))
    if (!pending) continue
    pending.resolve(defaultPiUiResult(pending.method))
  }
}

export function respondPiUiPermission(
  sessionId: string,
  requestId: string,
  response: 'once' | 'always' | 'reject',
): void {
  const pending = findPendingPiUiRequest(sessionId, requestId)
  if (!pending) throw new Error('Question is no longer pending')
  if (pending.method !== 'confirm') {
    throw new Error('Only Pi confirmation prompts support permission responses')
  }
  pending.resolve(response !== 'reject')
}

export function respondPiUiQuestion(sessionId: string, requestId: string, answers: PendingQuestionAnswers): void {
  const pending = findPendingPiUiRequest(sessionId, requestId)
  if (!pending) throw new Error('Question is no longer pending')
  const first = answers.value?.[0] ?? Object.values(answers)[0]?.[0]
  if (first == null) throw new Error('answer is required')
  pending.resolve(pending.method === 'confirm' ? first === 'true' : first)
}

export function listPendingPiUiPayloads(sessionId: string): Record<string, unknown>[] {
  const prefix = `${sessionId}:`
  return Array.from(pendingPiUiRequests)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, pending]) => pending.requestPayload)
}

export function pendingPiUiRequestCount(): number {
  return pendingPiUiRequests.size
}

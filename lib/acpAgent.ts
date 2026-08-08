/**
 * ACP (Agent Client Protocol, agentclientprotocol.com) Agent-side adapter —
 * the ACP counterpart to lib/ahpHost.ts's AHP host. Where AHP exposes the
 * Coordinator's run/task/mailbox model to AHP clients, this exposes a single
 * ordinary agentViewer session (one of our 5 providers) to ACP clients like
 * Zed, mapped onto ACP's session/new -> session/prompt -> session/update
 * lifecycle.
 *
 * One process = one provider. ACP has no native multi-provider session
 * concept (its experimental `providers/*` methods are unstable and not part
 * of the spec), so — like a real `gemini-cli --acp` process only ever being
 * Gemini — an `agent-viewer acp --provider codex` process only ever serves
 * Codex sessions. Run one process per provider if you need more than one.
 *
 * Deliberately polling-based, not a tap on the raw per-provider SSE stream:
 * `streamViewSessionTurn`'s wire format is each provider's native SDK message
 * shape (see sessionBackend.ts), and turning that into renderer-ready content
 * is real, substantial, provider-coupled logic that already lives inline in
 * tui/opentui/App.tsx (claudeMapper/codexMapper calls). Reusing the
 * already-provider-agnostic pieces instead avoids duplicating that:
 * - listViewSessionMessageWindow + buildThreadedMessages (lib/threading.ts)
 *   for normalized message/tool-call content, the same pipeline the web UI
 *   and TUI render from.
 * - readViewSessionRunning + extractPendingPermissions (lib/permissions.ts)
 *   for pending tool-approval/question payloads, the same parser both UIs use.
 * - runViewSessionAction({action:'respondPermission'|'respondQuestion'}) to
 *   answer them, the same dispatcher the approval-card UIs call.
 *
 * The cost is coarser granularity than token-level streaming (new content
 * appears in ~700ms polling ticks, not word-by-word) — an acceptable v1
 * trade; ACP does not require token-level session/update granularity.
 *
 * AskUserQuestion permissions (lib/permissions.ts's `questions` field) don't
 * map onto ACP's flat single-choice `PermissionOption[]` model, so they go
 * through ACP's separate (experimental, `elicitation` capability-gated)
 * `elicitation/create` client method instead — one schema property per
 * question, keyed by index — with a graceful empty-answer fallback when the
 * connected client doesn't advertise `elicitation.form` support, or the call
 * fails, or the user declines/cancels (see resolvePermission).
 *
 * Known limitation: raw MCP-server elicitation (`permission.elicitation`,
 * distinct from our own AskUserQuestion tool) still gets the empty-answer
 * fallback unconditionally. Unlike AskUserQuestion's `respondQuestion`
 * action, there's no single uniform "reply to this raw elicitation" entry
 * point across all 5 providers to route an `elicitation/create` answer back
 * through — each provider's SDK resolves it differently, and unifying that
 * is a separate piece of work from this ACP mapping.
 */
import {
  agent,
  type AgentApp,
  type AgentContext,
  type ContentBlock as AcpContentBlock,
  type CreateElicitationResponse,
  type ElicitationPropertySchema,
  type PermissionOption,
  type RequestPermissionResponse,
  type StopReason,
  type ToolCallContent,
  type ToolKind,
} from '@agentclientprotocol/sdk'
import {
  createNewViewSession,
  interruptViewSession,
  listViewSessionMessageWindow,
  readViewSessionRunning,
  runViewSessionAction,
  streamViewSessionTurn,
  type SessionMessageWindow,
} from './sessionBackend'
import { buildThreadedMessages, type ToolThread } from './threading'
import { extractPendingPermissions, type PendingPermission, type PendingQuestion, type PendingQuestionAnswers } from './permissions'
import type { AgentProvider, ContentBlock as InternalContentBlock, SessionMessage } from './types'

const POLL_INTERVAL_MS = 700
// Effectively "the whole session" — sessions are bounded by real usage, and a
// hard cap here just protects against a truly pathological transcript.
const HISTORY_FETCH_LIMIT = 20_000

type AcpSessionState = {
  sessionId: string
  provider: AgentProvider
  cwd: string
  /** Next SessionMessage offset to fetch from listViewSessionMessageWindow. */
  offset: number
  /** `${messageUuid}:text` / `${messageUuid}:thinking` already streamed. */
  emittedBlocks: Set<string>
  /** toolUse.id -> last status sent, so a repeat poll only sends real deltas. */
  toolCallStatus: Map<string, string>
  answeredPermissionIds: Set<string>
  cancel?: AbortController
  /**
   * True until this session's first turn is sent. Some providers (Claude, Pi)
   * defer real session creation to the first streamViewSessionTurn call and
   * need `isPendingSession: true` on that call — otherwise they try to
   * `resume` a session id that was only ever minted client-side and never
   * actually created, and the turn fails with "No conversation found."
   */
  isPending: boolean
  /**
   * The id every sessionBackend call (listViewSessionMessageWindow,
   * streamViewSessionTurn, ...) actually addresses — starts equal to
   * `sessionId` but every provider's stream can "realize" a different real
   * session id mid-turn (sent as an `event: session` SSE frame; see
   * createClaudeStream's `messageSessionId` handling in sessionBackend.ts).
   * `sessionId` itself never changes once handed to the ACP client — it's
   * the stable key both sides use for session/update and future prompts.
   */
  providerSessionId: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Mirrors components/MessageItem.tsx's canonicalToolName — kept local and
// ACP-specific (a React component file is the wrong place to import from,
// and ACP's ToolKind enum doesn't line up 1:1 with our tool-color grouping).
function toolKindOf(name: string): ToolKind {
  const n = name.trim().toLowerCase().replace(/[-\s]/g, '_')
  if (['bash', 'shell', 'local_shell', 'powershell', 'run_in_terminal', 'command', 'command_execution'].includes(n)) return 'execute'
  if (['read', 'read_file', 'open_file', 'view_file', 'cat', 'ls', 'list_dir', 'fs_read'].includes(n)) return 'read'
  if ([
    'grep', 'grep_search', 'search', 'semantic_search', 'find', 'find_text', 'rg',
    'glob', 'find_files', 'file_search', 'websearch', 'web_search', 'toolsearch', 'tool_search',
  ].includes(n)) return 'search'
  if (['webfetch', 'web_fetch'].includes(n)) return 'fetch'
  if ([
    'edit', 'str_replace_editor', 'replace_string_in_file', 'insert_edit_into_file', 'update_file',
    'multi_edit', 'multiedit', 'write', 'write_file', 'create_file',
    'notebook_edit', 'notebookedit', 'todowrite', 'todo_write', 'todo',
  ].includes(n)) return 'edit'
  if (['agent', 'task', 'subtask', 'task_create', 'taskcreate'].includes(n)) return 'think'
  return 'other'
}

function textContentOf(content: string | InternalContentBlock[] | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function toolCallTitleFor(thread: ToolThread): string {
  const input = thread.toolUse.input as Record<string, unknown>
  const command = typeof input.command === 'string' ? input.command : undefined
  const filePath = typeof input.file_path === 'string' ? input.file_path : undefined
  return command ?? filePath ?? thread.toolUse.name
}

function toolCallLocationsFor(thread: ToolThread): Array<{ path: string }> | undefined {
  const input = thread.toolUse.input as Record<string, unknown>
  const filePath = typeof input.file_path === 'string' ? input.file_path : undefined
  return filePath ? [{ path: filePath }] : undefined
}

function toolCallContentFor(thread: ToolThread): ToolCallContent[] {
  const input = thread.toolUse.input as Record<string, unknown>
  const content: ToolCallContent[] = []
  const filePath = typeof input.file_path === 'string' ? input.file_path : undefined
  if (filePath && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    content.push({ type: 'diff', path: filePath, oldText: input.old_string, newText: input.new_string })
  } else if (filePath && typeof input.content === 'string' && thread.toolUse.name.toLowerCase().includes('write')) {
    content.push({ type: 'diff', path: filePath, oldText: null, newText: input.content })
  }
  if (thread.result) {
    const text = textContentOf(thread.result.content)
    if (text) content.push({ type: 'content', content: { type: 'text', text } })
  }
  return content
}

function toolCallStatusFor(thread: ToolThread): 'pending' | 'in_progress' | 'completed' | 'failed' {
  if (!thread.result) return 'in_progress'
  return thread.result.is_error ? 'failed' : 'completed'
}

/** Diff newly-threaded blocks against what this session has already streamed, emitting session/update for each new one. */
async function pollAndEmit(state: AcpSessionState, client: AgentContext, allMessages: SessionMessage[]): Promise<void> {
  const threaded = buildThreadedMessages(allMessages)
  for (const msg of threaded) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.blocks) {
      if (block.type === 'text') {
        const key = `${msg.uuid}:text`
        if (state.emittedBlocks.has(key)) continue
        state.emittedBlocks.add(key)
        if (!block.text.trim()) continue
        await client.notify('session/update', {
          sessionId: state.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: block.text }, messageId: msg.uuid },
        })
      } else if (block.type === 'thinking') {
        const key = `${msg.uuid}:thinking`
        if (state.emittedBlocks.has(key)) continue
        state.emittedBlocks.add(key)
        if (!block.thinking.trim()) continue
        await client.notify('session/update', {
          sessionId: state.sessionId,
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: block.thinking }, messageId: msg.uuid },
        })
      } else if (block.type === 'tool_thread') {
        const id = block.toolUse.id
        const status = toolCallStatusFor(block)
        const prevStatus = state.toolCallStatus.get(id)
        if (!prevStatus) {
          state.toolCallStatus.set(id, status)
          await client.notify('session/update', {
            sessionId: state.sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: id,
              title: toolCallTitleFor(block),
              kind: toolKindOf(block.toolUse.name),
              status,
              content: toolCallContentFor(block),
              locations: toolCallLocationsFor(block),
              rawInput: block.toolUse.input,
            },
          })
        } else if (prevStatus !== status) {
          state.toolCallStatus.set(id, status)
          await client.notify('session/update', {
            sessionId: state.sessionId,
            update: { sessionUpdate: 'tool_call_update', toolCallId: id, status, content: toolCallContentFor(block) },
          })
        }
      }
    }
  }
}

/** One ACP elicitation schema property per question, keyed by index (matches the `answers[String(index)]` lookup respondQuestion's provider branches all try first). */
function questionPropertySchema(question: PendingQuestion): ElicitationPropertySchema {
  const values = question.options.map((option) => option.value ?? option.label)
  const titled = question.options.some((option) => option.value && option.value !== option.label)
  const title = question.header ?? question.question
  const description = question.header ? question.question : undefined
  if (question.multiSelect) {
    return {
      type: 'array',
      title,
      description,
      items: titled
        ? { type: 'string', anyOf: question.options.map((o) => ({ const: o.value ?? o.label, title: o.label, description: o.description })) }
        : { type: 'string', enum: values },
    }
  }
  if (values.length) {
    return titled
      ? { type: 'string', title, description, oneOf: question.options.map((o) => ({ const: o.value ?? o.label, title: o.label, description: o.description })) }
      : { type: 'string', title, description, enum: values }
  }
  return { type: 'string', title, description }
}

function questionsToElicitationSchema(questions: PendingQuestion[]) {
  const properties: Record<string, ElicitationPropertySchema> = {}
  const required: string[] = []
  questions.forEach((question, index) => {
    const key = String(index)
    properties[key] = questionPropertySchema(question)
    if (question.required !== false) required.push(key)
  })
  return { type: 'object' as const, properties, required }
}

function elicitationContentToAnswers(questions: PendingQuestion[], content: Record<string, unknown>): PendingQuestionAnswers {
  const answers: PendingQuestionAnswers = {}
  questions.forEach((_question, index) => {
    const key = String(index)
    const raw = content[key]
    if (raw === undefined || raw === null) return
    answers[key] = Array.isArray(raw) ? raw.map(String) : [String(raw)]
  })
  return answers
}

async function declineQuestion(state: AcpSessionState, permission: PendingPermission): Promise<void> {
  await runViewSessionAction({
    sessionId: state.providerSessionId,
    provider: state.provider,
    body: { action: 'respondQuestion', permissionId: permission.id, answers: {} },
  }).catch(() => {})
}

/**
 * AskUserQuestion goes through ACP's elicitation/create when the client
 * supports it (see the module doc comment); raw MCP elicitation and any
 * elicitation/create failure/decline/cancel get an empty-answer response
 * rather than hanging forever. Everything else maps onto ACP's
 * session/request_permission with allow-once/allow-always/reject.
 */
async function resolvePermission(
  state: AcpSessionState,
  client: AgentContext,
  permission: PendingPermission,
  supportsFormElicitation: boolean,
): Promise<void> {
  if (permission.questions?.length) {
    const questions = permission.questions
    if (supportsFormElicitation) {
      try {
        const response: CreateElicitationResponse = await client.request('elicitation/create', {
          mode: 'form',
          sessionId: state.sessionId,
          message: questions.map((q) => q.question).join('\n'),
          requestedSchema: questionsToElicitationSchema(questions),
        })
        if (response.action === 'accept') {
          await runViewSessionAction({
            sessionId: state.providerSessionId,
            provider: state.provider,
            body: {
              action: 'respondQuestion',
              permissionId: permission.id,
              answers: elicitationContentToAnswers(questions, (response.content ?? {}) as Record<string, unknown>),
            },
          }).catch(() => {})
          return
        }
        // decline/cancel/unrecognized action — fall through to the decline below.
      } catch {
        // elicitation/create isn't actually implemented despite the capability,
        // or the request itself failed — fall through to the decline below.
      }
    }
    await declineQuestion(state, permission)
    return
  }
  if (permission.elicitation) {
    await declineQuestion(state, permission)
    return
  }
  const options: PermissionOption[] = [
    { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
    ...(permission.canApproveAlways ? [{ optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' as const }] : []),
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ]
  const detail = [permission.reason, permission.command, permission.diff].filter(Boolean).join('\n\n')
  let outcome: RequestPermissionResponse['outcome']
  try {
    const response = await client.request('session/request_permission', {
      sessionId: state.sessionId,
      toolCall: {
        toolCallId: `permission:${permission.id}`,
        title: permission.toolName ?? permission.title,
        ...(detail ? { content: [{ type: 'content' as const, content: { type: 'text' as const, text: detail } }] } : {}),
      },
      options,
    })
    outcome = response.outcome
  } catch {
    outcome = { outcome: 'cancelled' }
  }
  const behavior: 'once' | 'always' | 'reject' = outcome.outcome === 'cancelled'
    ? 'reject'
    : outcome.optionId === 'allow-always' ? 'always' : outcome.optionId === 'allow-once' ? 'once' : 'reject'
  await runViewSessionAction({
    sessionId: state.providerSessionId,
    provider: state.provider,
    body: { action: 'respondPermission', permissionId: permission.id, response: behavior },
  }).catch(() => {})
}

async function checkPendingPermissions(state: AcpSessionState, client: AgentContext, supportsFormElicitation: boolean): Promise<void> {
  const running = readViewSessionRunning(state.providerSessionId)
  const pending = extractPendingPermissions(running.pendingPermissions, { sessionId: state.sessionId, provider: state.provider })
  for (const permission of pending) {
    if (state.answeredPermissionIds.has(permission.id)) continue
    state.answeredPermissionIds.add(permission.id)
    void resolvePermission(state, client, permission, supportsFormElicitation)
  }
}

function promptTextOf(blocks: AcpContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'resource_link') return `[resource: ${block.uri}]`
      if (block.type === 'resource') {
        const resource = block.resource
        return 'text' in resource && typeof resource.text === 'string' ? resource.text : `[resource: ${resource.uri}]`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function fetchAllMessages(sessionId: string, provider: AgentProvider): Promise<SessionMessage[]> {
  const window: SessionMessageWindow = await listViewSessionMessageWindow(sessionId, { offset: 0, limit: HISTORY_FETCH_LIMIT }, provider)
  return window.messages
}

/** Builds the ACP Agent app for one provider. Call `.connect(stream)` to serve a transport. */
export function createAcpAgentApp(provider: AgentProvider): AgentApp {
  const sessions = new Map<string, AcpSessionState>()
  // Set during initialize() from the client's declared capabilities — an
  // elicitation/create call to a client that never advertised support would
  // just throw (caught in resolvePermission), but checking first avoids
  // paying that round-trip on every AskUserQuestion for such a client.
  let supportsFormElicitation = false

  return agent({ name: 'agent-viewer' })
    .onRequest('initialize', async (ctx) => {
      supportsFormElicitation = Boolean(ctx.params.clientCapabilities?.elicitation?.form)
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          // Baseline only (text + resource_link) — see the module doc comment
          // for why image/audio/embeddedContext aren't wired up in v1.
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
        },
        authMethods: [],
        agentInfo: { name: 'agent-viewer', title: `Agent Viewer (${provider})`, version: '0.1.0' },
      }
    })
    .onRequest('authenticate', async () => ({}))
    .onRequest('session/new', async (ctx) => {
      const created = await createNewViewSession({ provider, cwd: ctx.params.cwd })
      sessions.set(created.sessionId, {
        sessionId: created.sessionId,
        provider: created.provider,
        cwd: created.cwd,
        offset: 0,
        emittedBlocks: new Set(),
        toolCallStatus: new Map(),
        answeredPermissionIds: new Set(),
        isPending: created.isPending,
        providerSessionId: created.sessionId,
      })
      return { sessionId: created.sessionId }
    })
    .onRequest('session/load', async (ctx) => {
      const sessionId = ctx.params.sessionId
      const messages = await fetchAllMessages(sessionId, provider)
      const state: AcpSessionState = {
        sessionId,
        provider,
        cwd: ctx.params.cwd,
        offset: messages.length,
        emittedBlocks: new Set(),
        toolCallStatus: new Map(),
        answeredPermissionIds: new Set(),
        // A loaded session already exists (that's what session/load means).
        isPending: false,
        providerSessionId: sessionId,
      }
      sessions.set(sessionId, state)
      // Per spec, loadSession replays the whole conversation as session/update
      // notifications before returning.
      await pollAndEmit(state, ctx.client, messages)
    })
    .onRequest('session/prompt', async (ctx) => {
      const state = sessions.get(ctx.params.sessionId)
      if (!state) throw new Error(`Unknown ACP session: ${ctx.params.sessionId}`)
      const message = promptTextOf(ctx.params.prompt)
      if (!message.trim()) return { stopReason: 'end_turn' as StopReason }

      const abort = new AbortController()
      state.cancel = abort

      let allMessages = await fetchAllMessages(state.providerSessionId, state.provider)
      state.offset = allMessages.length

      const response = await streamViewSessionTurn({
        sessionId: state.providerSessionId,
        signal: abort.signal,
        provider: state.provider,
        body: { message, cwd: state.cwd, isPendingSession: state.isPending || undefined },
      })
      state.isPending = false
      if (!response.ok) {
        state.cancel = undefined
        throw new Error(`Failed to start turn: HTTP ${response.status} ${response.statusText}`)
      }

      let turnEnded = false
      const drain = (async () => {
        const reader = response.body?.getReader()
        if (!reader) return
        const decoder = new TextDecoder()
        let buffer = ''
        let pendingEventName: string | null = null
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              // A pending session's real id isn't known until the provider's
              // first message names it — see AcpSessionState.providerSessionId.
              if (line.startsWith('event: ')) {
                pendingEventName = line.slice('event: '.length).trim()
              } else if (line.startsWith('data: ') && pendingEventName === 'session') {
                pendingEventName = null
                try {
                  const payload = JSON.parse(line.slice('data: '.length)) as { sessionId?: unknown }
                  if (typeof payload.sessionId === 'string' && payload.sessionId && payload.sessionId !== state.providerSessionId) {
                    state.providerSessionId = payload.sessionId
                    state.offset = 0
                    allMessages = []
                  }
                } catch {
                  // malformed frame — ignore
                }
              } else if (line.trim() === '') {
                pendingEventName = null
              }
            }
          }
        } catch {
          // Aborted or the underlying connection died mid-stream — the
          // polling loop below has already surfaced everything persisted.
        } finally {
          turnEnded = true
        }
      })()

      const poll = (async () => {
        while (!turnEnded) {
          await sleep(POLL_INTERVAL_MS)
          // The realized-id swap above can land between this fetch's start and
          // end; discard a window fetched under an id we've since moved past
          // rather than risk appending it to the wrong (reset) allMessages.
          const fetchedForId = state.providerSessionId
          const window = await listViewSessionMessageWindow(fetchedForId, { offset: state.offset, limit: 500 }, state.provider).catch(() => null)
          if (window?.messages.length && fetchedForId === state.providerSessionId) {
            allMessages = allMessages.concat(window.messages)
            state.offset = allMessages.length
          }
          await pollAndEmit(state, ctx.client, allMessages).catch(() => {})
          await checkPendingPermissions(state, ctx.client, supportsFormElicitation).catch(() => {})
        }
      })()

      await Promise.all([drain, poll])

      // The drain loop can observe stream completion a tick before the last
      // messages are actually persisted — one more catch-up read.
      const finalWindow = await listViewSessionMessageWindow(state.providerSessionId, { offset: state.offset, limit: 500 }, state.provider).catch(() => null)
      if (finalWindow?.messages.length) {
        allMessages = allMessages.concat(finalWindow.messages)
        state.offset = allMessages.length
      }
      await pollAndEmit(state, ctx.client, allMessages).catch(() => {})

      const cancelled = abort.signal.aborted
      state.cancel = undefined
      return { stopReason: (cancelled ? 'cancelled' : 'end_turn') as StopReason }
    })
    .onNotification('session/cancel', async (ctx) => {
      const state = sessions.get(ctx.params.sessionId)
      if (!state) return
      await interruptViewSession(state.providerSessionId, undefined, true).catch(() => {})
      state.cancel?.abort()
    })
}

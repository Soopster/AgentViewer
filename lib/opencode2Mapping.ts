// Shape translation from OpenCode 2's API to the OpenCode 1 vocabulary the rest
// of this app speaks (lib/opencodeMapper.ts, lib/threading.ts, the web and TUI
// renderers, lib/permissions.ts, and the SSE pumps all key on v1 event and part
// shapes). Nothing here talks to a server: lib/opencode2Client.ts does the
// requests and lib/opencode2Events.ts the live stream, and both translate
// through this file so a history read and a streamed frame describe the same
// part with the same id.
//
// The two models differ in one structural way that drives everything below: v1
// stores a message as `{ info, parts[] }` with each part carrying its own id, while
// v2 stores an assistant message with an inline `content[]` of text/reasoning/
// tool blocks that have no ids of their own. Part ids are therefore *derived*,
// and the derivation must agree between the two paths or a streaming card and
// the persisted one it settles into render as two different cards.

import type {
  AssistantMessage as OpenCodeAssistantMessage,
  Message as OpenCodeMessage,
  Part as OpenCodePart,
  Session as OpenCodeSession,
  ToolPart as OpenCodeToolPart,
  ToolState as OpenCodeToolState,
  Todo as OpenCodeTodo,
  UserMessage as OpenCodeUserMessage,
} from '@opencode-ai/sdk'
import type { QuestionInfo, QuestionRequest } from '@opencode-ai/sdk/v2'

// The v2 payload types, narrowed to what this file reads. Importing them from
// @opencode/client would pull its generated union (8k lines of indexed-access
// types) into every consumer for no added safety: these are the fields the
// server actually sends, and each one is checked before use.
export type V2ModelRef = { id: string; providerID: string; variant?: string }
export type V2TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}
export type V2StructuredError = { type: string; message: string; status?: number }
export type V2ToolContent =
  | { type: 'text'; text: string }
  | { type: 'file'; uri: string; mime: string; name?: string | null }

export type V2SessionInfo = {
  id: string
  parentID?: string
  projectID: string
  agent?: string
  model?: V2ModelRef
  cost: number
  tokens: V2TokenUsage
  time: { created: number; updated: number; idle?: number }
  title?: string
  revert?: { messageID: string; partID?: string; snapshot?: string }
  location: { directory: string }
}

export type V2ToolState =
  | { status: 'streaming'; input: string }
  | { status: 'running'; input: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { status: 'completed'; input: Record<string, unknown>; content: V2ToolContent[]; metadata?: Record<string, unknown> }
  | { status: 'error'; input: Record<string, unknown>; error: V2StructuredError; content?: V2ToolContent[]; metadata?: Record<string, unknown> }

export type V2AssistantContent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; time?: { created: number; completed?: number } }
  | {
    type: 'tool'
    id: string
    name: string
    state: V2ToolState
    time: { created: number; ran?: number; completed?: number }
  }

export type V2Message = {
  id: string
  type: string
  time: { created: number; streamed?: number; completed?: number }
  metadata?: Record<string, unknown>
  // user
  text?: string
  files?: Array<{ data?: string; mime?: string; source?: { type: string; uri?: string }; name?: string }>
  agents?: Array<{ name: string }>
  // assistant
  agent?: string
  model?: V2ModelRef
  content?: V2AssistantContent[]
  cost?: number
  tokens?: V2TokenUsage
  finish?: string
  error?: V2StructuredError
  // shell
  command?: string
  output?: { output: string; truncated?: boolean }
  status?: string
  exit?: number | string
  // compaction
  summary?: string
  // idle
  outcome?: string
  // model-switched / agent-switched
  previous?: string | V2ModelRef
}

export type V2PermissionRequest = {
  id: string
  sessionID: string
  action: string
  resources?: string[]
  save?: string[]
  metadata?: Record<string, unknown>
  source?: { type: 'tool'; messageID: string; id: string }
  message?: string
}

export type V2FormOption = { value: string; label: string; description?: string }
export type V2FormField = {
  key: string
  title?: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  options?: V2FormOption[]
  custom?: boolean
  default?: unknown
}
export type V2FormInfo = {
  id: string
  sessionID: string
  title: string
  fields: V2FormField[]
  metadata?: Record<string, unknown>
}

export type OpenCodeMessageBundle = { info: OpenCodeMessage; parts: OpenCodePart[] }

/** OpenCode 2 has no `version` on a session; this stands in for it wherever the
 *  v1 shape requires one, and marks a record as having come through here. */
export const OPENCODE_2_VERSION = '2'

export function toV1Session(session: V2SessionInfo): OpenCodeSession {
  return {
    id: session.id,
    projectID: session.projectID,
    directory: session.location?.directory ?? '',
    ...(session.parentID ? { parentID: session.parentID } : {}),
    title: session.title ?? '',
    version: OPENCODE_2_VERSION,
    time: { created: session.time.created, updated: session.time.updated },
    ...(session.revert ? { revert: session.revert } : {}),
  }
}

// OpenCode 2 renamed several tools and moved their arguments. The renderers
// (components/MessageItem.tsx, tui/format.ts) select a card by tool name and
// read v1 argument names out of the input, so an unmapped `shell` renders as a
// generic tool card with a JSON blob where the command should be. Only the
// renamed ones are listed: everything else (grep, glob, list, task, todowrite,
// webfetch, websearch, skill, and every MCP tool) kept its v1 name, which is
// also why v1 sessions migrated into a v2 server still carry `bash`/`filePath`.
const V2_TOOL_NAMES: Record<string, string> = {
  shell: 'bash',
  subagent: 'task',
}

// Tools whose file argument v2 renamed `path`. `glob`/`grep`/`list` also take a
// `path`, but it means a search root there and v1 spells it `path` too, so
// rewriting theirs would break the card rather than fix it.
const V2_FILE_PATH_TOOLS = new Set(['read', 'write', 'edit'])

export function normalizeOpenCode2ToolName(name: string): string {
  return V2_TOOL_NAMES[name] ?? name
}

export function normalizeOpenCode2ToolInput(name: string, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const record = { ...input as Record<string, unknown> }
  if (V2_FILE_PATH_TOOLS.has(name) && typeof record.path === 'string' && record.filePath === undefined) {
    record.filePath = record.path
    delete record.path
  }
  if (name === 'subagent') {
    if (typeof record.agent === 'string' && record.subagent_type === undefined) {
      record.subagent_type = record.agent
      delete record.agent
    }
  }
  return record
}

/** A tool result in v2 is a list of content blocks; v1 is a single string. File
 *  blocks keep their uri so a card can still name what was produced. */
export function toolContentToOutput(content: V2ToolContent[] | undefined): string {
  if (!content || content.length === 0) return ''
  return content
    .map((entry) => entry.type === 'text' ? entry.text : `[file] ${entry.name ?? entry.uri}`)
    .join('\n')
}

export function toV1ToolState(
  state: V2ToolState,
  time: { created: number; ran?: number; completed?: number },
): OpenCodeToolState {
  const start = time.ran ?? time.created
  switch (state.status) {
    case 'streaming':
      return { status: 'pending', input: {}, raw: state.input }
    case 'running':
      return {
        status: 'running',
        input: state.input ?? {},
        ...(state.metadata ? { metadata: state.metadata } : {}),
        time: { start },
      }
    case 'completed':
      return {
        status: 'completed',
        input: state.input ?? {},
        output: toolContentToOutput(state.content),
        title: '',
        metadata: state.metadata ?? {},
        time: { start, end: time.completed ?? start },
      }
    case 'error':
      return {
        status: 'error',
        input: state.input ?? {},
        error: state.error?.message ?? 'Tool call failed',
        ...(state.metadata ? { metadata: state.metadata } : {}),
        time: { start, end: time.completed ?? start },
      }
  }
}

// Part ids are derived, not stored (see the header). Text and reasoning blocks
// are identified by their v2 `ordinal`, which the live events carry and a
// history read recovers by counting blocks of that type in order; a tool block
// is identified by its call id, which both paths have outright.
export function textPartId(messageId: string, ordinal: number): string {
  return `${messageId}:text:${ordinal}`
}

export function reasoningPartId(messageId: string, ordinal: number): string {
  return `${messageId}:reasoning:${ordinal}`
}

export function toolPartId(messageId: string, callId: string): string {
  return `${messageId}:tool:${callId}`
}

export function toV1ToolPart(params: {
  sessionId: string
  messageId: string
  callId: string
  name: string
  state: V2ToolState
  time: { created: number; ran?: number; completed?: number }
}): OpenCodeToolPart {
  const tool = normalizeOpenCode2ToolName(params.name)
  const state = toV1ToolState(params.state, params.time)
  const normalizedInput = normalizeOpenCode2ToolInput(params.name, (state as { input?: unknown }).input)
  return {
    id: toolPartId(params.messageId, params.callId),
    sessionID: params.sessionId,
    messageID: params.messageId,
    type: 'tool',
    callID: params.callId,
    tool,
    state: { ...state, input: normalizedInput } as OpenCodeToolState,
  }
}

export function toV1AssistantInfo(params: {
  sessionId: string
  messageId: string
  agent: string
  model: V2ModelRef | undefined
  created: number
  completed?: number
  cost?: number
  tokens?: V2TokenUsage
  finish?: string
  error?: V2StructuredError
  cwd?: string
}): OpenCodeAssistantMessage {
  return {
    id: params.messageId,
    sessionID: params.sessionId,
    role: 'assistant',
    time: { created: params.created, ...(params.completed ? { completed: params.completed } : {}) },
    parentID: '',
    modelID: params.model?.id ?? '',
    providerID: params.model?.providerID ?? '',
    mode: params.agent || 'build',
    path: { cwd: params.cwd ?? '', root: params.cwd ?? '' },
    cost: params.cost ?? 0,
    tokens: params.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(params.finish ? { finish: params.finish } : {}),
    ...(params.error ? { error: toV1MessageError(params.error) } : {}),
  }
}

export function toV1MessageError(error: V2StructuredError): OpenCodeAssistantMessage['error'] {
  return { name: 'UnknownError', data: { message: `${error.type}: ${error.message}` } }
}

function toV1UserInfo(params: {
  sessionId: string
  messageId: string
  created: number
  agent: string
  model: V2ModelRef | undefined
}): OpenCodeUserMessage {
  return {
    id: params.messageId,
    sessionID: params.sessionId,
    role: 'user',
    time: { created: params.created },
    agent: params.agent,
    model: { providerID: params.model?.providerID ?? '', modelID: params.model?.id ?? '' },
  }
}

/**
 * Turn a v2 message list (oldest first) into v1 `{ info, parts }` bundles.
 *
 * Message kinds with no conversational content of their own — `idle`,
 * `agent-switched`, `model-switched`, `location-switched` — produce no bundle,
 * but they are what records which agent and model the *next* user message ran
 * under. v1 stamps both on every user message and `currentOpenCodeModelValue`
 * reads them back off the transcript's tail, so they are tracked here rather
 * than dropped. `system` and `skill` messages are prompt material the server
 * injects, never turns anyone took; v1 had no equivalent and showing them would
 * put the system prompt in the transcript as if the user had typed it.
 */
export function toV1MessageBundles(
  messages: V2Message[],
  context: { sessionId: string; agent?: string; model?: V2ModelRef; cwd?: string },
): OpenCodeMessageBundle[] {
  const bundles: OpenCodeMessageBundle[] = []
  let agent = context.agent ?? 'build'
  let model = context.model

  for (const message of messages) {
    switch (message.type) {
      case 'agent-switched':
        if (typeof message.agent === 'string' && message.agent) agent = message.agent
        break
      case 'model-switched':
        if (message.model) model = message.model
        break
      case 'user': {
        const parts: OpenCodePart[] = []
        if (typeof message.text === 'string' && message.text) {
          parts.push({
            id: textPartId(message.id, 0),
            sessionID: context.sessionId,
            messageID: message.id,
            type: 'text',
            text: message.text,
          })
        }
        for (const [index, file] of (message.files ?? []).entries()) {
          parts.push({
            id: `${message.id}:file:${index}`,
            sessionID: context.sessionId,
            messageID: message.id,
            type: 'file',
            mime: file.mime ?? 'application/octet-stream',
            ...(file.name ? { filename: file.name } : {}),
            url: file.source?.uri ?? (file.data ? `data:${file.mime ?? 'application/octet-stream'};base64,${file.data}` : ''),
          })
        }
        for (const [index, entry] of (message.agents ?? []).entries()) {
          parts.push({
            id: `${message.id}:agent:${index}`,
            sessionID: context.sessionId,
            messageID: message.id,
            type: 'agent',
            name: entry.name,
          })
        }
        bundles.push({
          info: toV1UserInfo({ sessionId: context.sessionId, messageId: message.id, created: message.time.created, agent, model }),
          parts,
        })
        break
      }
      case 'synthetic': {
        // Server-injected context (a background shell reporting back, most
        // often). v1 carried these as synthetic text parts on a user message,
        // and the renderers dim them on that flag.
        bundles.push({
          info: toV1UserInfo({ sessionId: context.sessionId, messageId: message.id, created: message.time.created, agent, model }),
          parts: [{
            id: textPartId(message.id, 0),
            sessionID: context.sessionId,
            messageID: message.id,
            type: 'text',
            text: message.text ?? '',
            synthetic: true,
          }],
        })
        break
      }
      case 'shell': {
        // `!command` — v1 recorded it as an assistant turn holding one bash
        // tool call, which is what the bash card renders.
        const completed = message.time.completed ?? message.time.created
        const output = message.output?.output ?? ''
        bundles.push({
          info: toV1AssistantInfo({
            sessionId: context.sessionId,
            messageId: message.id,
            agent,
            model,
            created: message.time.created,
            completed,
            cwd: context.cwd,
          }),
          parts: [toV1ToolPart({
            sessionId: context.sessionId,
            messageId: message.id,
            callId: message.id,
            name: 'shell',
            state: message.status === 'running'
              ? { status: 'running', input: { command: message.command ?? '' } }
              : { status: 'completed', input: { command: message.command ?? '' }, content: [{ type: 'text', text: output }] },
            time: { created: message.time.created, completed },
          })],
        })
        break
      }
      case 'compaction': {
        const parts: OpenCodePart[] = [{
          id: `${message.id}:compaction`,
          sessionID: context.sessionId,
          messageID: message.id,
          type: 'compaction',
          auto: true,
        }]
        bundles.push({
          info: toV1UserInfo({ sessionId: context.sessionId, messageId: message.id, created: message.time.created, agent, model }),
          parts,
        })
        break
      }
      case 'assistant': {
        const parts: OpenCodePart[] = []
        let textOrdinal = 0
        let reasoningOrdinal = 0
        for (const block of message.content ?? []) {
          if (block.type === 'text') {
            parts.push({
              id: textPartId(message.id, textOrdinal),
              sessionID: context.sessionId,
              messageID: message.id,
              type: 'text',
              text: block.text,
            })
            textOrdinal += 1
            continue
          }
          if (block.type === 'reasoning') {
            parts.push({
              id: reasoningPartId(message.id, reasoningOrdinal),
              sessionID: context.sessionId,
              messageID: message.id,
              type: 'reasoning',
              text: block.text,
              time: { start: block.time?.created ?? message.time.created, ...(block.time?.completed ? { end: block.time.completed } : {}) },
            })
            reasoningOrdinal += 1
            continue
          }
          if (block.type === 'tool') {
            parts.push(toV1ToolPart({
              sessionId: context.sessionId,
              messageId: message.id,
              callId: block.id,
              name: block.name,
              state: block.state,
              time: block.time,
            }))
          }
        }
        if (message.agent) agent = message.agent
        if (message.model) model = message.model
        bundles.push({
          info: toV1AssistantInfo({
            sessionId: context.sessionId,
            messageId: message.id,
            agent: message.agent ?? agent,
            model: message.model ?? model,
            created: message.time.created,
            completed: message.time.completed,
            cost: message.cost,
            tokens: message.tokens,
            finish: message.finish,
            error: message.error,
            cwd: context.cwd,
          }),
          parts,
        })
        break
      }
      default:
        break
    }
  }

  return bundles
}

/** The most recent `todowrite` call in a transcript is the session's todo list.
 *  v2 has no todo endpoint — the tool is the only record. */
export function todosFromBundles(bundles: OpenCodeMessageBundle[]): OpenCodeTodo[] {
  for (let i = bundles.length - 1; i >= 0; i -= 1) {
    const parts = bundles[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]
      if (part?.type !== 'tool' || part.tool !== 'todowrite') continue
      const todos = (part.state as { input?: { todos?: unknown } }).input?.todos
      if (Array.isArray(todos)) return todos as OpenCodeTodo[]
    }
  }
  return []
}

/** v2's permission request, in the shape `normalizeOpenCodeHarnessEvent` reads
 *  (lib/opencodeHarness.ts) — the same one OpenCode 1.18 servers send. */
export function toV1PermissionAsked(request: V2PermissionRequest): Record<string, unknown> {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources ?? [],
    metadata: request.metadata ?? {},
    always: request.save ?? [],
    ...(request.source ? { tool: { messageID: request.source.messageID, callID: request.source.id } } : {}),
  }
}

// A v2 form is a superset of a v1 question: arbitrary typed fields rather than
// a list of multiple-choice questions. Only fields that *can* be answered as a
// choice become question options; a free-text field becomes a question with no
// options, which the pickers already render as a text answer.
function fieldOptions(field: V2FormField): QuestionInfo['options'] {
  if (field.type === 'boolean') {
    return [
      { label: 'Yes', description: '' },
      { label: 'No', description: '' },
    ]
  }
  return (field.options ?? []).map((option) => ({
    label: option.label,
    description: option.description ?? '',
  }))
}

export function toV1Question(form: V2FormInfo): QuestionRequest {
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions: form.fields.map((field) => ({
      question: field.description || field.title || field.key,
      header: (field.title || field.key).slice(0, 30),
      options: fieldOptions(field),
      ...(field.type === 'multiselect' ? { multiple: true } : {}),
      ...(field.custom || fieldOptions(field).length === 0 ? { custom: true } : {}),
    })),
    ...(form.metadata && typeof form.metadata.messageID === 'string' && typeof form.metadata.callID === 'string'
      ? { tool: { messageID: form.metadata.messageID, callID: form.metadata.callID } }
      : {}),
  }
}

/**
 * The answers side of the same translation. The UI answers a question by index
 * with a list of chosen labels; a form is answered by field key with a typed
 * value, so the label has to be turned back into the option's `value` — for a
 * select, the label is what the user saw and the value is what the server
 * stores, and they are usually not the same string.
 */
export function toV2FormAnswer(form: V2FormInfo, answers: string[][]): Record<string, unknown> {
  const answer: Record<string, unknown> = {}
  for (const [index, field] of form.fields.entries()) {
    const chosen = answers[index] ?? []
    const valueFor = (label: string): string => {
      const option = (field.options ?? []).find((entry) => entry.label === label || entry.value === label)
      return option?.value ?? label
    }
    switch (field.type) {
      case 'multiselect':
        answer[field.key] = chosen.map(valueFor)
        break
      case 'boolean':
        answer[field.key] = chosen[0] === undefined ? false : /^(yes|true|1)$/i.test(chosen[0])
        break
      case 'number':
      case 'integer': {
        const parsed = Number(chosen[0])
        answer[field.key] = Number.isFinite(parsed) ? parsed : 0
        break
      }
      default:
        answer[field.key] = chosen[0] === undefined ? '' : valueFor(chosen[0])
        break
    }
  }
  return answer
}

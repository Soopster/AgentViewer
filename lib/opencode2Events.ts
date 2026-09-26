// Translates OpenCode 2's event stream into the OpenCode 1 events every
// consumer in this app already understands: the harness's snapshots
// (lib/opencodeHarness.ts), the send stream's frames (lib/sessionBackend.ts →
// components/MessageView.tsx and tui/opentui/App.tsx), and the window pump's
// refetch triggers (app/api/sessions/[sessionId]/messages/events/route.ts).
//
// The two streams differ in where the current state lives. v1 emits the *whole*
// part on every change (`message.part.updated` is cumulative, which is why the
// harness can coalesce it by part id); v2 emits lifecycle edges plus deltas and
// leaves assembly to the client. So this translator is stateful: it holds the
// in-flight assistant message per session and emits both the v1 delta frame
// (what the live text renders from) and a cumulative part frame (what a
// reconnecting or late-joining surface re-renders from).
//
// One v2 event can produce several v1 events, and order matters — a delta for a
// part nobody has seen renders nothing — so every handler returns them in the
// order a v1 server would have sent them.

import {
  reasoningPartId,
  textPartId,
  toV1AssistantInfo,
  toV1MessageError,
  toV1PermissionAsked,
  toV1Question,
  toV1Session,
  toV1ToolPart,
  type V2FormInfo,
  type V2ModelRef,
  type V2PermissionRequest,
  type V2SessionInfo,
  type V2StructuredError,
  type V2ToolContent,
  type V2ToolState,
  type V2TokenUsage,
} from './opencode2Mapping'
import type { Event as OpenCodeEvent, Todo as OpenCodeTodo } from '@opencode-ai/sdk'

export type V2Event = { type: string; created?: number; location?: { directory?: string }; data?: Record<string, unknown> }

/** A translated event plus the directory it belongs to, which is what the
 *  harness's global-stream envelope carries. */
export type TranslatedEvent = { directory: string; payload: OpenCodeEvent }

type ToolProgress = {
  name: string
  input: Record<string, unknown>
  metadata?: Record<string, unknown>
  created: number
  ran?: number
}

type MessageState = {
  sessionId: string
  agent: string
  model: V2ModelRef | undefined
  created: number
  tools: Map<string, ToolProgress>
}

// The in-flight state is per assistant message and is dropped when its step
// ends, so this only grows while turns are running. The cap is a backstop for a
// server that never sends an end edge (a crash mid-turn), not an expected path.
const MAX_TRACKED_MESSAGES = 256

export class OpenCode2EventTranslator {
  private messages = new Map<string, MessageState>()
  private directories = new Map<string, string>()

  /** Remember which directory a session belongs to. Most v2 events carry a
   *  `location`, but the execution and step edges do not, and the harness
   *  drops an event whose directory does not match the subscriber's. */
  private rememberDirectory(sessionId: string | undefined, directory: string | undefined): string {
    if (!sessionId) return directory ?? ''
    if (directory) {
      this.directories.set(sessionId, directory)
      return directory
    }
    return this.directories.get(sessionId) ?? ''
  }

  private track(messageId: string, state: MessageState): MessageState {
    this.messages.delete(messageId)
    this.messages.set(messageId, state)
    while (this.messages.size > MAX_TRACKED_MESSAGES) {
      const oldest = this.messages.keys().next().value
      if (oldest === undefined) break
      this.messages.delete(oldest)
    }
    return state
  }

  translate(event: V2Event): TranslatedEvent[] {
    const data = (event.data ?? {}) as Record<string, unknown>
    const sessionId = typeof data.sessionID === 'string' ? data.sessionID : undefined
    const directory = this.rememberDirectory(sessionId, event.location?.directory)
    const at = event.created ?? Date.now()
    const emit = (payloads: OpenCodeEvent[]): TranslatedEvent[] =>
      payloads.map((payload) => ({ directory, payload }))

    switch (event.type) {
      case 'session.created': {
        const info = sessionInfoFromCreated(data)
        return info ? emit([{ type: 'session.created', properties: { info } } as OpenCodeEvent]) : []
      }
      case 'session.renamed': {
        if (!sessionId) return []
        return emit([{
          type: 'session.updated',
          properties: { info: { id: sessionId, title: String(data.title ?? '') } },
        } as unknown as OpenCodeEvent])
      }
      case 'session.deleted': {
        if (!sessionId) return []
        return emit([{ type: 'session.deleted', properties: { info: { id: sessionId } } } as unknown as OpenCodeEvent])
      }

      // A turn's lifecycle. v1 said "busy" and then "idle"; v2 says the
      // execution started and then how it ended, and the consumers need both
      // the status (for the busy indicator) and the idle edge (which is what
      // ends a send stream).
      case 'session.execution.started':
        return sessionId ? emit([statusEvent(sessionId, { type: 'busy' })]) : []
      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
        return sessionId ? emit([statusEvent(sessionId, { type: 'idle' }), idleEvent(sessionId)]) : []
      case 'session.execution.failed': {
        if (!sessionId) return []
        const error = data.error as V2StructuredError | undefined
        // The error frame must precede idle: the send stream stops reading at
        // whichever arrives first, and stopping on idle would drop the reason.
        return emit([
          {
            type: 'session.error',
            properties: { sessionID: sessionId, error: toV1MessageError(error ?? { type: 'UnknownError', message: 'OpenCode turn failed' }) },
          } as unknown as OpenCodeEvent,
          statusEvent(sessionId, { type: 'idle' }),
          idleEvent(sessionId),
        ])
      }
      case 'session.status':
        return sessionId && data.status
          ? emit([statusEvent(sessionId, data.status as Record<string, unknown>)])
          : []
      case 'session.idle':
        return sessionId ? emit([idleEvent(sessionId)]) : []
      case 'session.retry.scheduled': {
        if (!sessionId) return []
        const error = data.error as V2StructuredError | undefined
        return emit([statusEvent(sessionId, {
          type: 'retry',
          attempt: Number(data.attempt ?? 1),
          message: error?.message ?? 'Retrying',
          next: Number(data.at ?? at),
        })])
      }

      // A user turn becomes visible to everyone else when the server delivers
      // it. The surfaces re-read the transcript on a message edge, so the info
      // stub only has to identify the message.
      case 'session.inbox.delivered': {
        if (!sessionId || typeof data.inboxID !== 'string') return []
        return emit([{
          type: 'message.updated',
          properties: {
            info: {
              id: data.inboxID,
              sessionID: sessionId,
              role: 'user',
              time: { created: at },
              agent: '',
              model: { providerID: '', modelID: '' },
            },
          },
        } as unknown as OpenCodeEvent])
      }

      case 'session.step.started': {
        const messageId = stringField(data, 'assistantMessageID')
        if (!sessionId || !messageId) return []
        const state = this.track(messageId, {
          sessionId,
          agent: stringField(data, 'agent') ?? 'build',
          model: data.model as V2ModelRef | undefined,
          created: Number(data.started ?? at),
          tools: new Map(),
        })
        return emit([{
          type: 'message.updated',
          properties: {
            info: toV1AssistantInfo({
              sessionId,
              messageId,
              agent: state.agent,
              model: state.model,
              created: state.created,
            }),
          },
        } as OpenCodeEvent])
      }
      case 'session.step.ended':
      case 'session.step.failed': {
        const messageId = stringField(data, 'assistantMessageID')
        if (!sessionId || !messageId) return []
        const state = this.messages.get(messageId)
        const failed = event.type === 'session.step.failed'
        const info = toV1AssistantInfo({
          sessionId,
          messageId,
          agent: state?.agent ?? 'build',
          model: state?.model,
          created: state?.created ?? at,
          completed: at,
          cost: typeof data.cost === 'number' ? data.cost : undefined,
          tokens: data.tokens as V2TokenUsage | undefined,
          finish: stringField(data, 'finish'),
          error: failed ? data.error as V2StructuredError | undefined : undefined,
        })
        this.messages.delete(messageId)
        return emit([{ type: 'message.updated', properties: { info } } as OpenCodeEvent])
      }

      case 'session.text.started':
      case 'session.reasoning.started': {
        const messageId = stringField(data, 'assistantMessageID')
        if (!sessionId || !messageId) return []
        const reasoning = event.type === 'session.reasoning.started'
        return emit([partEvent(textLikePart(sessionId, messageId, ordinal(data), '', reasoning, at))])
      }
      case 'session.text.delta':
      case 'session.reasoning.delta': {
        const messageId = stringField(data, 'assistantMessageID')
        const delta = stringField(data, 'delta')
        if (!sessionId || !messageId || delta === undefined) return []
        const reasoning = event.type === 'session.reasoning.delta'
        // `message.part.delta` is the frame the live renderers append from; its
        // `field` is what separates the answer from the thinking channel.
        return emit([{
          type: 'message.part.delta',
          properties: {
            sessionID: sessionId,
            messageID: messageId,
            partID: reasoning ? reasoningPartId(messageId, ordinal(data)) : textPartId(messageId, ordinal(data)),
            field: reasoning ? 'reasoning' : 'text',
            delta,
          },
        } as unknown as OpenCodeEvent])
      }
      case 'session.text.ended':
      case 'session.reasoning.ended': {
        const messageId = stringField(data, 'assistantMessageID')
        if (!sessionId || !messageId) return []
        const reasoning = event.type === 'session.reasoning.ended'
        return emit([partEvent(textLikePart(sessionId, messageId, ordinal(data), stringField(data, 'text') ?? '', reasoning, at))])
      }

      case 'session.tool.input.started': {
        const messageId = stringField(data, 'assistantMessageID')
        const callId = stringField(data, 'id')
        const name = stringField(data, 'name')
        if (!sessionId || !messageId || !callId || !name) return []
        const state = this.messages.get(messageId)
        state?.tools.set(callId, { name, input: {}, created: at })
        return emit([partEvent(toV1ToolPart({
          sessionId, messageId, callId, name,
          state: { status: 'streaming', input: '' },
          time: { created: at },
        }))])
      }
      case 'session.tool.called': {
        const messageId = stringField(data, 'assistantMessageID')
        const callId = stringField(data, 'id')
        if (!sessionId || !messageId || !callId) return []
        const tracked = this.messages.get(messageId)?.tools.get(callId)
        const name = tracked?.name ?? stringField(data, 'name') ?? 'unknown'
        const input = (data.input ?? {}) as Record<string, unknown>
        if (tracked) {
          tracked.input = input
          tracked.ran = at
        }
        const events: OpenCodeEvent[] = [partEvent(toV1ToolPart({
          sessionId, messageId, callId, name,
          state: { status: 'running', input },
          time: { created: tracked?.created ?? at, ran: at },
        }))]
        // v2 has no todo endpoint or event — the tool call is the only record,
        // so the todo panels are fed from it as it happens.
        const todos = todoList(name, input)
        if (todos) events.push({ type: 'todo.updated', properties: { sessionID: sessionId, todos } } as OpenCodeEvent)
        return emit(events)
      }
      case 'session.tool.progress': {
        const messageId = stringField(data, 'assistantMessageID')
        const callId = stringField(data, 'id')
        if (!sessionId || !messageId || !callId) return []
        const tracked = this.messages.get(messageId)?.tools.get(callId)
        if (tracked) tracked.metadata = { ...tracked.metadata, ...(data.metadata as Record<string, unknown> | undefined) }
        return emit([partEvent(toV1ToolPart({
          sessionId, messageId, callId,
          name: tracked?.name ?? 'unknown',
          state: { status: 'running', input: tracked?.input ?? {}, metadata: tracked?.metadata },
          time: { created: tracked?.created ?? at, ran: tracked?.ran ?? at },
        }))])
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const messageId = stringField(data, 'assistantMessageID')
        const callId = stringField(data, 'id')
        if (!sessionId || !messageId || !callId) return []
        const tracked = this.messages.get(messageId)?.tools.get(callId)
        const name = tracked?.name ?? 'unknown'
        const input = tracked?.input ?? {}
        const metadata = { ...tracked?.metadata, ...(data.metadata as Record<string, unknown> | undefined) }
        const content = data.content as V2ToolContent[] | undefined
        const state: V2ToolState = event.type === 'session.tool.success'
          ? { status: 'completed', input, content: content ?? [], metadata }
          : { status: 'error', input, error: (data.error as V2StructuredError | undefined) ?? { type: 'UnknownError', message: 'Tool call failed' }, content, metadata }
        this.messages.get(messageId)?.tools.delete(callId)
        return emit([partEvent(toV1ToolPart({
          sessionId, messageId, callId, name, state,
          time: { created: tracked?.created ?? at, ran: tracked?.ran ?? at, completed: at },
        }))])
      }

      case 'session.compaction.ended':
        return sessionId ? emit([{ type: 'session.compacted', properties: { sessionID: sessionId } } as OpenCodeEvent]) : []

      case 'permission.asked': {
        const request = data as unknown as V2PermissionRequest
        if (!request.id || !request.sessionID) return []
        return emit([{ type: 'permission.asked', properties: toV1PermissionAsked(request) } as unknown as OpenCodeEvent])
      }
      case 'permission.replied': {
        if (!sessionId || typeof data.requestID !== 'string') return []
        return emit([{
          type: 'permission.replied',
          properties: { sessionID: sessionId, requestID: data.requestID, reply: String(data.reply ?? '') },
        } as unknown as OpenCodeEvent])
      }

      case 'form.created': {
        const form = data.form as V2FormInfo | undefined
        if (!form?.id) return []
        return [{
          directory: this.rememberDirectory(form.sessionID, event.location?.directory),
          payload: { type: 'question.asked', properties: toV1Question(form) } as unknown as OpenCodeEvent,
        }]
      }
      case 'form.replied':
      case 'form.cancelled': {
        const formSessionId = stringField(data, 'sessionID')
        const id = stringField(data, 'id')
        if (!formSessionId || !id) return []
        return [{
          directory: this.rememberDirectory(formSessionId, event.location?.directory),
          payload: {
            type: event.type === 'form.replied' ? 'question.replied' : 'question.rejected',
            properties: { sessionID: formSessionId, requestID: id },
          } as unknown as OpenCodeEvent,
        }]
      }

      // Project-level configuration changed; v1's own names for these are what
      // invalidates the harness's diagnostics cache.
      case 'agent.updated':
      case 'command.updated':
      case 'config.updated':
      case 'mcp.status.changed':
      case 'plugin.updated':
      case 'provider.updated':
        return emit([{ type: 'installation.updated', properties: {} } as unknown as OpenCodeEvent])

      default:
        return []
    }
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

function ordinal(data: Record<string, unknown>): number {
  return typeof data.ordinal === 'number' ? data.ordinal : 0
}

function statusEvent(sessionId: string, status: Record<string, unknown>): OpenCodeEvent {
  return { type: 'session.status', properties: { sessionID: sessionId, status } } as unknown as OpenCodeEvent
}

function idleEvent(sessionId: string): OpenCodeEvent {
  return { type: 'session.idle', properties: { sessionID: sessionId } } as OpenCodeEvent
}

function partEvent(part: unknown): OpenCodeEvent {
  return { type: 'message.part.updated', properties: { part } } as OpenCodeEvent
}

function textLikePart(
  sessionId: string,
  messageId: string,
  index: number,
  text: string,
  reasoning: boolean,
  at: number,
) {
  return reasoning
    ? {
      id: reasoningPartId(messageId, index),
      sessionID: sessionId,
      messageID: messageId,
      type: 'reasoning' as const,
      text,
      time: { start: at },
    }
    : {
      id: textPartId(messageId, index),
      sessionID: sessionId,
      messageID: messageId,
      type: 'text' as const,
      text,
    }
}

function todoList(name: string, input: Record<string, unknown>): OpenCodeTodo[] | null {
  if (name !== 'todowrite') return null
  return Array.isArray(input.todos) ? input.todos as OpenCodeTodo[] : null
}

function sessionInfoFromCreated(data: Record<string, unknown>) {
  const sessionId = stringField(data, 'sessionID')
  if (!sessionId) return null
  const location = data.location as { directory?: string } | undefined
  const created = Date.now()
  return toV1Session({
    id: sessionId,
    projectID: stringField(data, 'projectID') ?? '',
    ...(stringField(data, 'parentID') ? { parentID: stringField(data, 'parentID') } : {}),
    title: stringField(data, 'title') ?? '',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, updated: created },
    location: { directory: location?.directory ?? '' },
  } as V2SessionInfo)
}

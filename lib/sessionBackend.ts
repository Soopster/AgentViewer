import { NextRequest, NextResponse } from 'next/server'
import {
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  tagSession,
} from '@anthropic-ai/claude-agent-sdk'
import { clearRunningSession, getRunningSession, setRunningSession } from './sessionRuntime'
import { getProviderCapabilities } from './provider'
import { getConfiguredProvider } from './providerState'
import type {
  AgentProvider,
  ContextUsage,
  Session,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
} from './types'
import { createSessionControlQuery } from './sdkControlQuery'
import { getCodexClient } from './codexClient'
import type {
  CodexAppsListResponse,
  CodexExperimentalFeatureListResponse,
  CodexModelListResponse,
  CodexMcpServerListResponse,
  CodexNotification,
  CodexThreadForkResponse,
  CodexThreadListResponse,
  CodexThreadReadResponse,
  CodexThreadResumeResponse,
  CodexThreadRollbackResponse,
  CodexThreadTokenUsage,
  CodexTurnStartResponse,
} from './codexProtocol'
import {
  mapCodexDiagnosticsToSections,
  mapCodexModelsToSessionModels,
  mapCodexThreadToMessages,
  mapCodexThreadToSession,
  mapCodexThreadToSessionInfo,
  mapCodexTokenUsageToContextUsage,
} from './codexMapper'
import { getCodexStoredTag, getCodexStoredTagsForSessions, setCodexStoredTag } from './codexTags'
import { getOpenCodeClient } from './opencodeClient'
import {
  currentOpenCodeModelValue,
  decodeOpenCodeModelValue,
  firstOpenCodePrompt,
  mapOpenCodeContextUsage,
  mapOpenCodeDiagnosticsToSections,
  mapOpenCodeMessagesToSessionMessages,
  mapOpenCodeModelsToSessionModels,
  mapOpenCodeSessionToInfo,
  mapOpenCodeSessionToSession,
  summarizeOpenCodeDiffs,
} from './opencodeMapper'
import { getOpenCodeStoredTag, getOpenCodeStoredTagsForSessions, setOpenCodeStoredTag } from './opencodeTags'
import type {
  Agent as OpenCodeAgent,
  Command as OpenCodeCommand,
  ConfigProvidersResponse as OpenCodeConfigProvidersResponse,
  Event as OpenCodeEvent,
  FileDiff as OpenCodeFileDiff,
  FormatterStatus as OpenCodeFormatterStatus,
  LspStatus as OpenCodeLspStatus,
  McpStatus as OpenCodeMcpStatus,
  Message as OpenCodeMessage,
  Part as OpenCodePart,
  Session as OpenCodeSession,
} from '@opencode-ai/sdk'

export const maxDuration = 300

const OPENCODE_OPTIONS = {
  responseStyle: 'data' as const,
  throwOnError: true as const,
}

function openCodeData<T>(response: T | { data: T }): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data
  }
  return response as T
}

type ListParams = {
  limit: number
  offset: number
  dir?: string
  includeWorktrees?: boolean
  provider?: AgentProvider | 'all'
}

type MessageListParams = {
  limit: number
  offset: number
}

type SendMessageParams = {
  sessionId: string
  request: NextRequest
  body: Record<string, unknown>
  provider?: AgentProvider
}

type ForkParams = {
  sessionId: string
  body: Record<string, unknown>
  provider?: AgentProvider
}

type RewindParams = {
  sessionId: string
  body: Record<string, unknown>
  provider?: AgentProvider
}

function codexContextUsageToEventData(contextUsage: ContextUsage): string {
  return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`
}

function openCodeEventSessionId(event: OpenCodeEvent): string | undefined {
  switch (event.type) {
    case 'message.updated':
      return event.properties.info.sessionID
    case 'message.removed':
      return event.properties.sessionID
    case 'message.part.updated':
      return event.properties.part.sessionID
    case 'message.part.removed':
      return event.properties.sessionID
    case 'permission.updated':
      return event.properties.sessionID
    case 'permission.replied':
      return event.properties.sessionID
    case 'session.status':
      return event.properties.sessionID
    case 'session.idle':
      return event.properties.sessionID
    case 'session.compacted':
      return event.properties.sessionID
    case 'todo.updated':
      return event.properties.sessionID
    case 'command.executed':
      return event.properties.sessionID
    case 'session.created':
      return event.properties.info.id
    case 'session.updated':
      return event.properties.info.id
    case 'session.deleted':
      return event.properties.info.id
    case 'session.diff':
      return event.properties.sessionID
    case 'session.error':
      return event.properties.sessionID
    default:
      return undefined
  }
}

function formatOpenCodeEvent(event: OpenCodeEvent): string {
  return JSON.stringify({ type: 'opencode_event', event })
}

async function listCodexSessions({ limit, offset, dir }: ListParams): Promise<Session[]> {
  const client = getCodexClient()
  const response = await client.request<CodexThreadListResponse>('thread/list', {
    limit: limit + offset,
    cwd: dir || undefined,
  })
  const page = response.data.slice(offset, offset + limit)
  const tags = await getCodexStoredTagsForSessions(page.map((thread) => thread.id))
  return page.map((thread) => mapCodexThreadToSession(thread, tags[thread.id] ?? null))
}

async function listClaudeSessions({ limit, offset, dir, includeWorktrees }: ListParams): Promise<Session[]> {
  const sessions = await listSessions({
    limit,
    offset,
    dir,
    includeWorktrees: dir ? includeWorktrees : undefined,
  })
  return sessions.map((session) => ({
    ...session,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }))
}

async function resolveProvider(provider?: AgentProvider): Promise<AgentProvider> {
  const resolved = provider ?? await getConfiguredProvider()
  if (resolved === 'all') {
    throw new Error('provider is required when all providers are active')
  }
  return resolved
}

async function readCodexThread(sessionId: string, includeTurns: boolean) {
  const client = getCodexClient()
  const response = await client.request<CodexThreadReadResponse>('thread/read', {
    threadId: sessionId,
    includeTurns,
  })
  return response.thread
}

async function resumeCodexThread(sessionId: string): Promise<CodexThreadResumeResponse> {
  const client = getCodexClient()
  return client.request<CodexThreadResumeResponse>('thread/resume', {
    threadId: sessionId,
    persistExtendedHistory: true,
  })
}

async function listOpenCodeSessions({ dir }: ListParams): Promise<Session[]> {
  const client = await getOpenCodeClient()
  const response = await client.session.list({
    ...OPENCODE_OPTIONS,
    query: dir ? { directory: dir } : undefined,
  })
  const sessions = openCodeData<OpenCodeSession[]>(response)
  const tags = await getOpenCodeStoredTagsForSessions(sessions.map((session) => session.id))
  return sessions.map((session) => mapOpenCodeSessionToSession(session, tags[session.id] ?? null))
}

async function getOpenCodeSession(sessionId: string): Promise<OpenCodeSession> {
  const client = await getOpenCodeClient()
  const response = await client.session.get({
    ...OPENCODE_OPTIONS,
    path: { id: sessionId },
  })
  return openCodeData<OpenCodeSession>(response)
}

async function getOpenCodeSessionMessages(sessionId: string): Promise<Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>> {
  const client = await getOpenCodeClient()
  const response = await client.session.messages({
    ...OPENCODE_OPTIONS,
    path: { id: sessionId },
    query: { limit: 2000 },
  })
  return openCodeData<Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>>(response)
}

function openCodeDirectoryQuery(session: OpenCodeSession): { directory?: string } | undefined {
  return session.directory ? { directory: session.directory } : undefined
}

export async function listViewSessions(params: ListParams): Promise<Session[]> {
  const provider = params.provider ?? await getConfiguredProvider()
  if (provider === 'all') {
    const combinedLimit = Math.max(params.limit + params.offset, 500)
    const [claude, codex, opencode] = await Promise.all([
      listClaudeSessions({ ...params, provider: 'claude', limit: combinedLimit, offset: 0 }),
      listCodexSessions({ ...params, provider: 'codex', limit: combinedLimit, offset: 0 }),
      listOpenCodeSessions({ ...params, provider: 'opencode', limit: combinedLimit, offset: 0 }),
    ])
    return [...claude, ...codex, ...opencode]
      .sort((a, b) => {
        const aTime = Number(a.lastModified ?? a.createdAt ?? 0)
        const bTime = Number(b.lastModified ?? b.createdAt ?? 0)
        return bTime - aTime
      })
      .slice(params.offset, params.offset + params.limit)
  }
  if (provider === 'codex') {
    return listCodexSessions(params)
  }
  if (provider === 'opencode') {
    const sessions = await listOpenCodeSessions(params)
    return sessions.slice(params.offset, params.offset + params.limit)
  }
  return listClaudeSessions(params)
}

export async function readViewSessionInfo(sessionId: string, providerOverride?: AgentProvider): Promise<SessionInfo | null> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const [thread, resume, tag] = await Promise.all([
      readCodexThread(sessionId, false),
      resumeCodexThread(sessionId),
      getCodexStoredTag(sessionId),
    ])
    return mapCodexThreadToSessionInfo(thread, tag, resume.model)
  }
  if (provider === 'opencode') {
    const [session, messages, tag] = await Promise.all([
      getOpenCodeSession(sessionId),
      getOpenCodeSessionMessages(sessionId),
      getOpenCodeStoredTag(sessionId),
    ])
    return mapOpenCodeSessionToInfo(
      session,
      tag,
      firstOpenCodePrompt(messages),
      currentOpenCodeModelValue(messages.at(-1)?.info) ?? undefined,
    )
  }

  const info = await getSessionInfo(sessionId)
  if (!info) return null
  return {
    ...info,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }
}

export async function patchViewSession(sessionId: string, body: Record<string, unknown>, providerOverride?: AgentProvider): Promise<void> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    if ('title' in body) {
      await client.request('thread/name/set', {
        threadId: sessionId,
        name: body.title ?? null,
      })
      return
    }
    if ('tag' in body) {
      await setCodexStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    if ('title' in body) {
      await client.session.update({
        ...OPENCODE_OPTIONS,
        path: { id: sessionId },
        body: { title: typeof body.title === 'string' ? body.title : undefined },
      })
      return
    }
    if ('tag' in body) {
      await setOpenCodeStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }

  if ('title' in body) {
    await renameSession(sessionId, body.title as string)
    return
  }
  if ('tag' in body) {
    await tagSession(sessionId, (body.tag as string | null | undefined) ?? null)
    return
  }
  throw new Error('title or tag required')
}

export async function listViewSessionMessages(sessionId: string, params: MessageListParams, providerOverride?: AgentProvider): Promise<SessionMessage[]> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const thread = await readCodexThread(sessionId, true)
    const messages = mapCodexThreadToMessages(thread)
    return messages.slice(params.offset, params.offset + params.limit)
  }
  if (provider === 'opencode') {
    const messages = await getOpenCodeSessionMessages(sessionId)
    return mapOpenCodeMessagesToSessionMessages(messages).slice(params.offset, params.offset + params.limit)
  }

  const messages = await getSessionMessages(sessionId, params)
  return (messages as SessionMessage[]).map((message) => ({
    ...message,
    provider: 'claude',
  }))
}

function createClaudeStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Response {
  const userMessage = String(body.message ?? '')
  const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-4-6'
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const forkSessionOnSend = Boolean(body.forkSession)

  const encoder = new TextEncoder()
  const abortController = new AbortController()
  request.signal.addEventListener('abort', () => abortController.abort())

  const stream = new ReadableStream({
    async start(controller) {
      const q = query({
        prompt: userMessage,
        options: {
          resume: sessionId,
          model,
          abortController,
          enableFileCheckpointing: true,
          resumeSessionAt,
          forkSession: forkSessionOnSend,
        },
      })

      setRunningSession(sessionId, {
        provider: 'claude',
        interrupt: () => q.interrupt(),
      })

      let emittedSessionEvent = false

      try {
        try {
          const usage = await q.getContextUsage()
          controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
        } catch {}

        for await (const msg of q) {
          if (!emittedSessionEvent && msg.session_id) {
            emittedSessionEvent = true
            controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: msg.session_id })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        clearRunningSession(sessionId)
        q.close()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

function formatCodexNotification(notification: CodexNotification): string | null {
  switch (notification.method) {
    case 'item/agentMessage/delta':
      return JSON.stringify({ type: 'codex_agent_message_delta', ...notification.params })
    case 'item/started':
      return JSON.stringify({ type: 'codex_item_started', ...notification.params })
    case 'item/completed':
      return JSON.stringify({ type: 'codex_item_completed', ...notification.params })
    default:
      return null
  }
}

async function createCodexStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const model = typeof body.model === 'string' ? body.model : null
  const client = getCodexClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let targetTurnId: string | null = null
      const bufferedNotifications: CodexNotification[] = []
      let currentModel = model ?? 'codex'

      const flushNotification = (notification: CodexNotification) => {
        const payload = formatCodexNotification(notification)
        if (!payload) return
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      }

      const unsubscribe = client.subscribe((notification) => {
        const params = notification.params as { threadId?: string; turnId?: string }
        if (params.threadId !== sessionId) return

        if (notification.method === 'thread/tokenUsage/updated') {
          if (!targetTurnId || params.turnId !== targetTurnId) return
          const usage = mapCodexTokenUsageToContextUsage(
            (notification.params as { tokenUsage: CodexThreadTokenUsage }).tokenUsage,
            currentModel,
          )
          controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
          return
        }

        if (!targetTurnId) {
          bufferedNotifications.push(notification)
          return
        }

        if (params.turnId !== targetTurnId) return

        if (notification.method === 'turn/completed') {
          controller.close()
          clearRunningSession(sessionId)
          unsubscribe()
          return
        }

        flushNotification(notification)
      })

      request.signal.addEventListener('abort', () => {
        const running = getRunningSession(sessionId)
        if (running?.provider === 'codex') {
          void running.interrupt().catch(() => {})
        }
      })

      try {
        const resume = await resumeCodexThread(sessionId)
        currentModel = model ?? resume.model
        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`))

        const started = await client.request<CodexTurnStartResponse>('turn/start', {
          threadId: sessionId,
          model,
          input: [{ type: 'text', text: userMessage, text_elements: [] }],
        })

        targetTurnId = started.turn.id

        setRunningSession(sessionId, {
          provider: 'codex',
          interrupt: () => client.request('turn/interrupt', { threadId: sessionId, turnId: targetTurnId }),
        })

        for (const notification of bufferedNotifications) {
          const params = notification.params as { turnId?: string }
          if (params.turnId !== targetTurnId) continue
          if (notification.method === 'thread/tokenUsage/updated') {
            const usage = mapCodexTokenUsageToContextUsage(
              (notification.params as { tokenUsage: CodexThreadTokenUsage }).tokenUsage,
              currentModel,
            )
            controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
            continue
          }
          flushNotification(notification)
        }
      } catch (err) {
        unsubscribe()
        clearRunningSession(sessionId)
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function createOpenCodeStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const selectedModel = decodeOpenCodeModelValue(typeof body.model === 'string' ? body.model : null)
  const resumeSessionAt = typeof body.resumeSessionAt === 'string' ? body.resumeSessionAt : undefined
  const client = await getOpenCodeClient()
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  request.signal.addEventListener('abort', () => {
    abortController.abort()
    const running = getRunningSession(sessionId)
    if (running?.provider === 'opencode') {
      void running.interrupt().catch(() => {})
    }
  })

  const stream = new ReadableStream({
    async start(controller) {
      let targetSessionId = sessionId
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      try {
        const events = await client.event.subscribe({
          ...OPENCODE_OPTIONS,
          signal: abortController.signal,
        })

        if (resumeSessionAt) {
          const forkedResponse = await client.session.fork({
            ...OPENCODE_OPTIONS,
            path: { id: sessionId },
            body: { messageID: resumeSessionAt },
          })
          targetSessionId = openCodeData<OpenCodeSession>(forkedResponse).id
        }

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`))

        setRunningSession(sessionId, {
          provider: 'opencode',
          interrupt: () => client.session.abort({
            ...OPENCODE_OPTIONS,
            path: { id: targetSessionId },
          }),
        })
        if (targetSessionId !== sessionId) {
          setRunningSession(targetSessionId, {
            provider: 'opencode',
            interrupt: () => client.session.abort({
              ...OPENCODE_OPTIONS,
              path: { id: targetSessionId },
            }),
          })
        }

        await client.session.promptAsync({
          ...OPENCODE_OPTIONS,
          path: { id: targetSessionId },
          body: {
            model: selectedModel ?? undefined,
            parts: [{ type: 'text', text: userMessage }],
          },
        })

        for await (const event of events.stream as AsyncGenerator<OpenCodeEvent>) {
          const eventSessionId = openCodeEventSessionId(event)
          if (eventSessionId && eventSessionId !== targetSessionId) continue

          if (event.type === 'message.updated' && event.properties.info.role === 'assistant') {
            const usage = mapOpenCodeContextUsage(event.properties.info)
            if (usage) {
              controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
            }
          }

          if (event.type === 'session.error') {
            const message = event.properties.error?.data && 'message' in event.properties.error.data
              ? String(event.properties.error.data.message)
              : 'Unknown OpenCode session error'
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
            break
          }

          controller.enqueue(encoder.encode(`data: ${formatOpenCodeEvent(event)}\n\n`))

          if (event.type === 'session.idle' && event.properties.sessionID === targetSessionId) {
            break
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        clearRunningSession(sessionId)
        if (targetSessionId !== sessionId) {
          clearRunningSession(targetSessionId)
        }
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function streamViewSessionTurn(params: SendMessageParams): Promise<Response> {
  const userMessage = String(params.body.message ?? '').trim()
  if (!userMessage) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const provider = await resolveProvider(params.provider)
  if (provider === 'codex') {
    return createCodexStream(params.sessionId, params.request, params.body)
  }
  if (provider === 'opencode') {
    return createOpenCodeStream(params.sessionId, params.request, params.body)
  }

  return createClaudeStream(params.sessionId, params.request, params.body)
}

export async function forkViewSession({ sessionId, body, provider }: ForkParams): Promise<{ sessionId: string }> {
  const resolvedProvider = await resolveProvider(provider)
  if (resolvedProvider === 'codex') {
    const client = getCodexClient()
    const response = await client.request<CodexThreadForkResponse>('thread/fork', {
      threadId: sessionId,
      persistExtendedHistory: true,
    })
    if (typeof body.title === 'string' && body.title.trim()) {
      await client.request('thread/name/set', {
        threadId: response.thread.id,
        name: body.title.trim(),
      })
    }
    return { sessionId: response.thread.id }
  }
  if (resolvedProvider === 'opencode') {
    const client = await getOpenCodeClient()
    const forkedResponse = await client.session.fork({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      body: {
        messageID: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
      },
    })
    const forked = openCodeData<OpenCodeSession>(forkedResponse)
    if (typeof body.title === 'string' && body.title.trim()) {
      await client.session.update({
        ...OPENCODE_OPTIONS,
        path: { id: forked.id },
        body: { title: body.title.trim() },
      })
    }
    return { sessionId: forked.id }
  }

  const result = await forkSession(sessionId, {
    title: typeof body.title === 'string' ? body.title : undefined,
    upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
  })
  return { sessionId: result.sessionId }
}

export async function interruptViewSession(sessionId: string): Promise<void> {
  const running = getRunningSession(sessionId)
  if (!running) {
    throw new Error('No running session for this session')
  }
  await running.interrupt()
}

export async function readViewSessionModels(sessionId: string, providerOverride?: AgentProvider): Promise<{ models: SessionModelInfo[]; currentModel: string | null }> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    const [modelsResponse, resume] = await Promise.all([
      client.request<CodexModelListResponse>('model/list', {}),
      resumeCodexThread(sessionId),
    ])
    return {
      models: mapCodexModelsToSessionModels(modelsResponse.data),
      currentModel: resume.model,
    }
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const [configResponse, messages] = await Promise.all([
      client.config.providers({
        ...OPENCODE_OPTIONS,
        query: openCodeDirectoryQuery(session),
      }),
      getOpenCodeSessionMessages(sessionId),
    ])
    return {
      models: mapOpenCodeModelsToSessionModels(openCodeData<OpenCodeConfigProvidersResponse>(configResponse)),
      currentModel: currentOpenCodeModelValue(messages.at(-1)?.info),
    }
  }

  const q = createSessionControlQuery(sessionId)
  try {
    await q.initializationResult()
    const [models, contextUsage] = await Promise.all([
      q.supportedModels(),
      q.getContextUsage().catch(() => null),
    ])
    return {
      models,
      currentModel: contextUsage?.model ?? null,
    }
  } finally {
    q.close()
  }
}

export async function readViewSessionDiagnostics(sessionId: string, providerOverride?: AgentProvider): Promise<{ sections: SessionDiagnosticSection[]; currentModel: string | null }> {
  const provider = await resolveProvider(providerOverride)
  if (provider === 'codex') {
    const client = getCodexClient()
    const [thread, resume, mcpServers, features, skills, apps] = await Promise.all([
      readCodexThread(sessionId, false),
      resumeCodexThread(sessionId),
      client.request<CodexMcpServerListResponse>('mcpServerStatus/list', {}),
      client.request<CodexExperimentalFeatureListResponse>('experimentalFeature/list', {}),
      client.request<{ data: Array<{ cwd: string; skills: Array<{ name?: string; description?: string }>; errors?: string[] }> }>('skills/list', {}),
      client.request<CodexAppsListResponse>('app/list', {}),
    ])

    return {
      sections: mapCodexDiagnosticsToSections({
        thread,
        currentModel: resume.model,
        mcpServers: mcpServers.data,
        features: features.data,
        skills: skills.data,
        apps: apps.data,
      }),
      currentModel: resume.model,
    }
  }
  if (provider === 'opencode') {
    const client = await getOpenCodeClient()
    const session = await getOpenCodeSession(sessionId)
    const query = openCodeDirectoryQuery(session)
    const [providers, commands, agents, lsp, formatters, mcp, messages] = await Promise.all([
      client.config.providers({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.command.list({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.app.agents({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.lsp.status({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.formatter.status({
        ...OPENCODE_OPTIONS,
        query,
      }),
      client.mcp.status({
        ...OPENCODE_OPTIONS,
        query,
      }),
      getOpenCodeSessionMessages(sessionId),
    ])

    return {
      currentModel: currentOpenCodeModelValue(messages.at(-1)?.info),
      sections: mapOpenCodeDiagnosticsToSections({
        providers: openCodeData<OpenCodeConfigProvidersResponse>(providers),
        commands: openCodeData<OpenCodeCommand[]>(commands),
        agents: openCodeData<OpenCodeAgent[]>(agents),
        lsp: openCodeData<OpenCodeLspStatus[]>(lsp),
        formatters: openCodeData<OpenCodeFormatterStatus[]>(formatters),
        mcp: openCodeData<Record<string, OpenCodeMcpStatus>>(mcp),
      }),
    }
  }

  const q = createSessionControlQuery(sessionId)
  try {
    await q.initializationResult()
    const [commands, agents, mcpServers, contextUsage] = await Promise.all([
      q.supportedCommands(),
      q.supportedAgents(),
      q.mcpServerStatus(),
      q.getContextUsage().catch(() => null),
    ])
    return {
      currentModel: contextUsage?.model ?? null,
      sections: [
        { id: 'commands', title: 'COMMANDS', items: commands.length > 0 ? commands.slice(0, 20).map((command) => command.name) : ['None'] },
        { id: 'agents', title: 'AGENTS', items: agents.length > 0 ? agents.slice(0, 20).map((agent) => agent.name) : ['None'] },
        {
          id: 'mcp',
          title: 'MCP',
          items: mcpServers.length > 0
            ? mcpServers.map((server) => `${server.name} · ${server.status}`)
            : ['None'],
        },
      ],
    }
  } finally {
    q.close()
  }
}

export async function rewindOrRollbackViewSession({ sessionId, body, provider }: RewindParams): Promise<Record<string, unknown>> {
  const resolvedProvider = await resolveProvider(provider)
  if (resolvedProvider === 'codex') {
    const numTurns = Number(body.numTurns ?? 1)
    if (!Number.isFinite(numTurns) || numTurns < 1) {
      throw new Error('numTurns is required')
    }

    const thread = await readCodexThread(sessionId, true)
    const removedTurns = thread.turns.slice(-numTurns).map((turn) => {
      const firstUserItem = turn.items.find((item) => item.type === 'userMessage')
      const preview = firstUserItem && firstUserItem.type === 'userMessage'
        ? firstUserItem.content
            .map((entry) => entry.type === 'text' ? entry.text : '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        : turn.items[0]?.type ?? turn.id
      return {
        turnId: turn.id,
        preview: preview || turn.id,
      }
    })

    if (body.dryRun) {
      return {
        mode: 'rollback',
        canRollback: true,
        turnsRemoved: removedTurns,
      }
    }

    const client = getCodexClient()
    const result = await client.request<CodexThreadRollbackResponse>('thread/rollback', {
      threadId: sessionId,
      numTurns,
    })

    return {
      mode: 'rollback',
      canRollback: true,
      turnsRemoved: removedTurns,
      remainingTurns: result.thread.turns.length,
    }
  }
  if (resolvedProvider === 'opencode') {
    const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined
    if (!userMessageId) {
      throw new Error('userMessageId is required')
    }

    const client = await getOpenCodeClient()
    const diffResponse = await client.session.diff({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      query: { messageID: userMessageId },
    })
    const filesChanged = summarizeOpenCodeDiffs(openCodeData<OpenCodeFileDiff[]>(diffResponse))

    if (body.dryRun) {
      return {
        mode: 'rewind',
        canRewind: true,
        filesChanged,
      }
    }

    await client.session.revert({
      ...OPENCODE_OPTIONS,
      path: { id: sessionId },
      body: { messageID: userMessageId },
    })

    return {
      mode: 'rewind',
      canRewind: true,
      filesChanged,
    }
  }

  const userMessageId = typeof body.userMessageId === 'string' ? body.userMessageId : undefined
  const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-4-6'
  if (!userMessageId) {
    throw new Error('userMessageId is required')
  }

  const q = createSessionControlQuery(sessionId, model)
  try {
    await q.initializationResult()
    return await q.rewindFiles(userMessageId, { dryRun: Boolean(body.dryRun) })
  } finally {
    q.close()
  }
}

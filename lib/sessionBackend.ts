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
import type {
  GetAuthStatusResponse as CopilotGetAuthStatusResponse,
  GetStatusResponse as CopilotGetStatusResponse,
  ModelInfo as CopilotModelInfo,
  SessionEvent as CopilotSessionEvent,
  SessionMetadata as CopilotSessionMetadata,
} from '@github/copilot-sdk'
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
import { getCopilotClient, resumeCopilotSession } from './copilotClient'
import {
  deriveCopilotState,
  mapCopilotDiagnosticsToSections,
  mapCopilotEventsToSessionMessages,
  mapCopilotModelsToSessionModels,
  mapCopilotSessionToInfo,
  mapCopilotSessionToSession,
  mapCopilotUsageToContextUsage,
} from './copilotMapper'
import {
  getCopilotStoredMetadata,
  getCopilotStoredMetadataForSessions,
  setCopilotStoredTag,
  setCopilotStoredTitle,
} from './copilotMetadata'
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
import { normalizeProjectPath, sameProjectPath } from './projectPaths'
import {
  forkPiSession,
  getPiSessionMessages,
  listPiSessions,
  openPiAgentSession,
  openPiSessionManager,
  refreshPiSessionCache,
} from './piClient'
import {
  mapPiDiagnosticsToSections,
  mapPiMessagesToSessionMessages,
  mapPiModelsToSessionModels,
  mapPiSessionToInfo,
  mapPiSessionToSession,
} from './piMapper'
import {
  getPiStoredMetadata,
  getPiStoredMetadataForSessions,
  setPiStoredTag,
  setPiStoredTitle,
} from './piMetadata'
import { normalizeClaudeHistoryMessages } from './claudeMapper'

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

type ProjectMessageBatchParams = {
  dir: string
  includeWorktrees: boolean
  provider?: AgentProvider | 'all'
  offsets: Record<string, number>
  initialLimit: number
  incrementalLimit: number
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
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type === 'message.part.delta') {
    const properties = eventRecord.properties
    if (properties && typeof properties === 'object') {
      const sessionID = (properties as Record<string, unknown>).sessionID
      return typeof sessionID === 'string' ? sessionID : undefined
    }
  }

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

function formatCopilotEvent(event: CopilotSessionEvent): string {
  return JSON.stringify({ type: 'copilot_event', event })
}

async function findCopilotSessionMetadata(sessionId: string): Promise<CopilotSessionMetadata | null> {
  const client = await getCopilotClient()
  const sessions = await client.listSessions()
  return sessions.find((session) => session.sessionId === sessionId) ?? null
}

async function readCopilotSessionEvents(sessionId: string): Promise<CopilotSessionEvent[]> {
  const session = await resumeCopilotSession(sessionId)
  try {
    return await session.getMessages()
  } finally {
    await session.disconnect().catch(() => {})
  }
}

async function listCopilotSessions({ limit, offset, dir, includeWorktrees }: ListParams): Promise<Session[]> {
  const client = await getCopilotClient()
  const response = dir && !includeWorktrees
    ? await client.listSessions({ cwd: dir })
    : await client.listSessions()

  const filtered = dir
    ? response.filter((session) => {
        const cwd = session.context?.cwd
        if (!cwd) return false
        return includeWorktrees ? sameProjectPath(dir, cwd) : normalizeProjectPath(cwd) === normalizeProjectPath(dir)
      })
    : response

  const sorted = [...filtered].sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
  const page = sorted.slice(offset, offset + limit)
  const stored = await getCopilotStoredMetadataForSessions(page.map((session) => session.sessionId))
  return page.map((session) => mapCopilotSessionToSession(session, stored[session.sessionId] ?? { title: null, tag: null }))
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

async function listPiSessionsForView({ limit, offset, dir }: ListParams): Promise<Session[]> {
  const sessions = await listPiSessions(dir || undefined)
  const sorted = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime())
  const page = sorted.slice(offset, offset + limit)
  const stored = await getPiStoredMetadataForSessions(page.map((s) => s.id))
  return page.map((s) => mapPiSessionToSession(s, stored[s.id] ?? { title: null, tag: null }))
}

export async function listViewSessions(params: ListParams): Promise<Session[]> {
  const provider = params.provider ?? await getConfiguredProvider()
  if (provider === 'all') {
    const combinedLimit = Math.max(params.limit + params.offset, 500)
    const [claude, codex, opencode, copilot, pi] = await Promise.all([
      listClaudeSessions({ ...params, provider: 'claude', limit: combinedLimit, offset: 0 }),
      listCodexSessions({ ...params, provider: 'codex', limit: combinedLimit, offset: 0 }),
      listOpenCodeSessions({ ...params, provider: 'opencode', limit: combinedLimit, offset: 0 }),
      listCopilotSessions({ ...params, provider: 'copilot', limit: combinedLimit, offset: 0 }),
      listPiSessionsForView({ ...params, provider: 'pi', limit: combinedLimit, offset: 0 }),
    ])
    return [...claude, ...codex, ...opencode, ...copilot, ...pi]
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
  if (provider === 'copilot') {
    return listCopilotSessions(params)
  }
  if (provider === 'pi') {
    return listPiSessionsForView(params)
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
  if (provider === 'copilot') {
    const [metadata, stored, session] = await Promise.all([
      findCopilotSessionMetadata(sessionId),
      getCopilotStoredMetadata(sessionId),
      resumeCopilotSession(sessionId),
    ])

    try {
      const [events, currentModel] = await Promise.all([
        session.getMessages(),
        session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      ])

      return mapCopilotSessionToInfo(sessionId, events, stored, metadata, currentModel.modelId)
    } finally {
      await session.disconnect().catch(() => {})
    }
  }
  if (provider === 'pi') {
    const [sessions, stored] = await Promise.all([
      listPiSessions(),
      getPiStoredMetadata(sessionId),
    ])
    const info = sessions.find((s) => s.id === sessionId)
    if (!info) return null
    const messages = getPiSessionMessages(sessionId)
    return mapPiSessionToInfo(info, stored, messages)
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
  if (provider === 'copilot') {
    if ('title' in body) {
      await setCopilotStoredTitle(sessionId, typeof body.title === 'string' ? body.title : null)
      return
    }
    if ('tag' in body) {
      await setCopilotStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }
  if (provider === 'pi') {
    if ('title' in body) {
      await setPiStoredTitle(sessionId, typeof body.title === 'string' ? body.title : null)
      return
    }
    if ('tag' in body) {
      await setPiStoredTag(sessionId, typeof body.tag === 'string' ? body.tag : null)
      return
    }
    throw new Error('title or tag required')
  }

  if ('title' in body) {
    if (typeof body.title !== 'string') throw new Error('title must be a string')
    await renameSession(sessionId, body.title)
    return
  }
  if ('tag' in body) {
    const tag = body.tag === null || body.tag === undefined ? null
      : typeof body.tag === 'string' ? body.tag
      : (() => { throw new Error('tag must be a string or null') })()
    await tagSession(sessionId, tag)
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
  if (provider === 'copilot') {
    const events = await readCopilotSessionEvents(sessionId)
    return mapCopilotEventsToSessionMessages(sessionId, events).slice(params.offset, params.offset + params.limit)
  }
  if (provider === 'pi') {
    const messages = getPiSessionMessages(sessionId)
    return mapPiMessagesToSessionMessages(sessionId, messages).slice(params.offset, params.offset + params.limit)
  }

  const messages = await getSessionMessages(sessionId, {
    ...params,
    includeSystemMessages: true,
  })
  return normalizeClaudeHistoryMessages(messages as unknown[])
}

export async function listProjectSessionMessageBatches(params: ProjectMessageBatchParams): Promise<{
  sessions: Session[]
  batches: Array<{
    key: string
    sessionId: string
    provider?: AgentProvider
    offset: number
    messages: SessionMessage[]
  }>
}> {
  const sessions = await listViewSessions({
    limit: 500,
    offset: 0,
    dir: params.dir,
    includeWorktrees: params.includeWorktrees,
    provider: params.provider,
  })

  const batches = await Promise.all(
    sessions.map(async (session) => {
      const key = `${session.provider ?? 'claude'}:${session.sessionId}`
      const offset = Math.max(0, params.offsets[key] ?? 0)
      const limit = offset === 0 ? params.initialLimit : params.incrementalLimit
      const messages = limit > 0
        ? await listViewSessionMessages(session.sessionId, { offset, limit }, session.provider)
        : []

      return {
        key,
        sessionId: session.sessionId,
        provider: session.provider,
        offset,
        messages,
      }
    }),
  )

  return { sessions, batches }
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
          includePartialMessages: true,
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

async function readClaudeSupportedModels(): Promise<SessionModelInfo[]> {
  const q = query({
    prompt: 'ping',
    options: {
      model: 'claude-sonnet-4-6',
      persistSession: false,
      maxTurns: 1,
      enableFileCheckpointing: true,
    },
  })

  try {
    const initialization = await q.initializationResult()
    const supportedModels = await q.supportedModels().catch(() => [] as SessionModelInfo[])
    return supportedModels.length > 0
      ? supportedModels
      : (initialization.models ?? [])
  } finally {
    q.close()
  }
}

function formatCodexNotification(notification: CodexNotification): string | null {
  switch (notification.method) {
    case 'item/agentMessage/delta':
      return JSON.stringify({ type: 'codex_agent_message_delta', ...notification.params })
    case 'item/plan/delta':
      return JSON.stringify({ type: 'codex_plan_delta', ...notification.params })
    case 'item/reasoning/summaryTextDelta':
      return JSON.stringify({ type: 'codex_reasoning_summary_delta', ...notification.params })
    case 'item/reasoning/textDelta':
      return JSON.stringify({ type: 'codex_reasoning_delta', ...notification.params })
    case 'thread/realtime/transcriptUpdated':
      return JSON.stringify({ type: 'codex_realtime_transcript', ...notification.params })
    case 'thread/realtime/itemAdded':
      return JSON.stringify({ type: 'codex_realtime_item_added', ...notification.params })
    case 'item/started':
      return JSON.stringify({ type: 'codex_item_started', ...notification.params })
    case 'item/completed':
      return JSON.stringify({ type: 'codex_item_completed', ...notification.params })
    default:
      return null
  }
}

function getCodexNotificationTurnId(notification: CodexNotification): string | null {
  const params = notification.params as { turnId?: unknown; turn?: { id?: unknown } | null }
  if (typeof params.turnId === 'string' && params.turnId) return params.turnId
  if (typeof params.turn?.id === 'string' && params.turn.id) return params.turn.id
  return null
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
      let closed = false
      let completionSeen = false
      let completionCloseTimer: ReturnType<typeof setTimeout> | null = null

      const closeStream = (unsubscribe: () => void) => {
        if (closed) return
        closed = true
        if (completionCloseTimer) {
          clearTimeout(completionCloseTimer)
          completionCloseTimer = null
        }
        controller.close()
        clearRunningSession(sessionId)
        unsubscribe()
      }

      const scheduleCompletionClose = (unsubscribe: () => void) => {
        if (closed) return
        completionSeen = true
        if (completionCloseTimer) clearTimeout(completionCloseTimer)
        completionCloseTimer = setTimeout(() => closeStream(unsubscribe), 400)
      }

      const flushNotification = (notification: CodexNotification) => {
        const payload = formatCodexNotification(notification)
        if (!payload) return
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      }

      const unsubscribe = client.subscribe((notification) => {
        const params = notification.params as { threadId?: string; turnId?: string }
        if (params.threadId !== sessionId) return
        const notificationTurnId = getCodexNotificationTurnId(notification)

        if (notification.method === 'thread/tokenUsage/updated') {
          if (!targetTurnId || notificationTurnId !== targetTurnId) return
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

        if (notificationTurnId && notificationTurnId !== targetTurnId) return

        if (notification.method === 'turn/completed') {
          scheduleCompletionClose(unsubscribe)
          return
        }

        if (completionSeen) scheduleCompletionClose(unsubscribe)
        flushNotification(notification)
      })

      request.signal.addEventListener('abort', () => {
        const running = getRunningSession(sessionId)
        if (running?.provider === 'codex') {
          void running.interrupt().catch(() => {})
        }
      })

      try {
        const resume = await resumeCodexThread(sessionId).catch(() => null)
        currentModel = model ?? resume?.model ?? currentModel
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

        let bufferedTurnCompleted = false
        for (const notification of bufferedNotifications) {
          const bufferedTurnId = getCodexNotificationTurnId(notification)
          if (bufferedTurnId && bufferedTurnId !== targetTurnId) continue
          if (notification.method === 'turn/completed') {
            bufferedTurnCompleted = true
            continue
          }
          if (notification.method === 'thread/tokenUsage/updated') {
            const usage = mapCodexTokenUsageToContextUsage(
              (notification.params as { tokenUsage: CodexThreadTokenUsage }).tokenUsage,
              currentModel,
            )
            controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
            continue
          }
          if (completionSeen) scheduleCompletionClose(unsubscribe)
          flushNotification(notification)
        }

        if (bufferedTurnCompleted) {
          scheduleCompletionClose(unsubscribe)
        }
      } catch (err) {
        unsubscribe()
        clearRunningSession(sessionId)
        closed = true
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
      let consumeEvents: Promise<void> | null = null
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

        consumeEvents = (async () => {
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
        })()

        await client.session.promptAsync({
          ...OPENCODE_OPTIONS,
          path: { id: targetSessionId },
          body: {
            model: selectedModel ?? undefined,
            parts: [{ type: 'text', text: userMessage }],
          },
        })

        await consumeEvents
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        abortController.abort()
        await consumeEvents?.catch(() => {})
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

async function createCopilotStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const selectedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null
  const client = await getCopilotClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let session: Awaited<ReturnType<typeof resumeCopilotSession>> | null = null
      let closed = false
      let emittedError = false

      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      try {
        const models = await client.listModels().catch(() => [] as CopilotModelInfo[])
        const modelsById = new Map(models.map((model) => [model.id, model]))

        const handleEvent = (event: CopilotSessionEvent) => {
          if (event.type === 'assistant.usage') {
            const usage = mapCopilotUsageToContextUsage(event, modelsById)
            controller.enqueue(encoder.encode(codexContextUsageToEventData(usage)))
          }

          if (event.type === 'session.error') {
            emittedError = true
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: event.data.message })}\n\n`))
          }

          controller.enqueue(encoder.encode(`data: ${formatCopilotEvent(event)}\n\n`))
        }

        session = await resumeCopilotSession(sessionId, {
          disableResume: false,
          streaming: true,
          onEvent: handleEvent,
        })

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`))

        setRunningSession(sessionId, {
          provider: 'copilot',
          interrupt: () => session?.abort() ?? Promise.resolve(),
        })

        request.signal.addEventListener('abort', () => {
          const running = getRunningSession(sessionId)
          if (running?.provider === 'copilot') {
            void running.interrupt().catch(() => {})
          }
        })

        if (selectedModel) {
          const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }))
          if (current.modelId !== selectedModel) {
            await session.setModel(selectedModel)
          }
        }

        await session.sendAndWait({ prompt: userMessage }, 300_000)
      } catch (err) {
        if (!emittedError) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        }
      } finally {
        clearRunningSession(sessionId)
        await session?.disconnect().catch(() => {})
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

async function createPiStream(sessionId: string, request: NextRequest, body: Record<string, unknown>): Promise<Response> {
  const userMessage = String(body.message ?? '').trim()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      try {
        const agentSession = await openPiAgentSession(sessionId)
        const targetSessionId = agentSession.sessionId

        controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId: targetSessionId })}\n\n`))

        setRunningSession(sessionId, {
          provider: 'pi',
          interrupt: () => agentSession.abort(),
        })

        request.signal.addEventListener('abort', () => {
          const running = getRunningSession(sessionId)
          if (running?.provider === 'pi') {
            void running.interrupt().catch(() => {})
          }
        })

        const unsubscribe = agentSession.agent.subscribe((event) => {
          const payload = JSON.stringify({ type: 'pi_event', event })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))

          if (event.type === 'agent_end') {
            clearRunningSession(sessionId)
            unsubscribe()
            close()
          }
        })

        await agentSession.prompt(userMessage)
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' })}\n\n`))
        clearRunningSession(sessionId)
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
  if (provider === 'copilot') {
    return createCopilotStream(params.sessionId, params.request, params.body)
  }
  if (provider === 'pi') {
    return createPiStream(params.sessionId, params.request, params.body)
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
  if (resolvedProvider === 'copilot') {
    void sessionId
    void body
    throw new Error('Fork is not supported for GitHub Copilot sessions')
  }
  if (resolvedProvider === 'pi') {
    const entryId = typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined
    if (!entryId) {
      throw new Error('upToMessageId is required for Pi fork')
    }
    const newId = forkPiSession(sessionId, entryId)
    if (!newId) {
      throw new Error('Failed to fork Pi session')
    }
    return { sessionId: newId }
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
    const modelsResponse = await client.request<CodexModelListResponse>('model/list', {})
    const resume = await resumeCodexThread(sessionId).catch(() => null)
    return {
      models: mapCodexModelsToSessionModels(modelsResponse.data),
      currentModel: resume?.model ?? null,
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
  if (provider === 'copilot') {
    const client = await getCopilotClient()
    const session = await resumeCopilotSession(sessionId)
    try {
      const [models, currentModel] = await Promise.all([
        client.listModels(),
        session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      ])
      return {
        models: mapCopilotModelsToSessionModels(models),
        currentModel: currentModel.modelId ?? null,
      }
    } finally {
      await session.disconnect().catch(() => {})
    }
  }
  if (provider === 'pi') {
    const messages = getPiSessionMessages(sessionId)
    let currentModel: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role: string; model?: string }
      if (msg.role === 'assistant' && msg.model) {
        currentModel = msg.model
        break
      }
    }
    return {
      models: mapPiModelsToSessionModels(currentModel),
      currentModel: currentModel ?? null,
    }
  }

  const models = await readClaudeSupportedModels().catch(() => [] as SessionModelInfo[])
  const q = createSessionControlQuery(sessionId)
  try {
    const contextUsage = await q.getContextUsage().catch(() => null)
    return {
      models,
      currentModel: contextUsage?.model ?? null,
    }
  } catch {
    return {
      models,
      currentModel: null,
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
  if (provider === 'copilot') {
    const client = await getCopilotClient()
    const [metadata, session, status, auth] = await Promise.all([
      findCopilotSessionMetadata(sessionId),
      resumeCopilotSession(sessionId),
      client.getStatus().catch(() => ({ version: 'unknown', protocolVersion: 0 }) as CopilotGetStatusResponse),
      client.getAuthStatus().catch(() => ({
        isAuthenticated: false,
        statusMessage: 'Authentication status unavailable',
      }) as CopilotGetAuthStatusResponse),
    ])

    try {
      const [events, currentModel, mode, tools, quota] = await Promise.all([
        session.getMessages(),
        session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
        session.rpc.mode.get().catch(() => ({ mode: undefined })),
        client.rpc.tools.list({ model: undefined }).catch(() => ({ tools: [] as Array<{ name: string; description?: string }> })),
        client.rpc.account.getQuota().catch(() => ({ quotaSnapshots: {} as Record<string, {
          entitlementRequests: number
          usedRequests: number
          remainingPercentage: number
          overage: number
          overageAllowedWithExhaustedQuota: boolean
          resetDate?: string
        }> })),
      ])

      const quotaItems = Object.entries(quota.quotaSnapshots).map(([name, snapshot]) => {
        const remaining = Math.round(snapshot.remainingPercentage * 100)
        const reset = snapshot.resetDate ? ` · resets ${snapshot.resetDate}` : ''
        return `${name} · ${snapshot.usedRequests}/${snapshot.entitlementRequests} used · ${remaining}% remaining${reset}`
      })

      return {
        currentModel: currentModel.modelId ?? deriveCopilotState(events, metadata).currentModel ?? null,
        sections: mapCopilotDiagnosticsToSections({
          sessionId,
          status,
          auth,
          currentModel: currentModel.modelId ?? null,
          mode: mode.mode ?? null,
          tools: tools.tools,
          quotaItems,
          metadata,
          events,
          workspacePath: session.workspacePath,
        }),
      }
    } finally {
      await session.disconnect().catch(() => {})
    }
  }
  if (provider === 'pi') {
    const messages = getPiSessionMessages(sessionId)
    let currentModel: string | undefined
    let thinkingLevel: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role: string; model?: string; thinking?: boolean }
      if (msg.role === 'assistant') {
        currentModel ??= msg.model
        if (thinkingLevel === undefined && msg.thinking !== undefined) {
          thinkingLevel = msg.thinking ? 'enabled' : 'off'
        }
        if (currentModel && thinkingLevel !== undefined) break
      }
    }

    const sm = openPiSessionManager(sessionId)
    const sessionFile = sm.getSessionFile()
    const cwd = sm.getCwd()

    return {
      currentModel: currentModel ?? null,
      sections: mapPiDiagnosticsToSections({
        sessionId,
        cwd,
        currentModel,
        thinkingLevel,
        toolNames: [],
        sessionFile,
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
  if (resolvedProvider === 'copilot') {
    void sessionId
    void body
    throw new Error('Rewind is not supported for GitHub Copilot sessions')
  }
  if (resolvedProvider === 'pi') {
    void sessionId
    void body
    throw new Error('Rewind is not supported for Pi sessions')
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

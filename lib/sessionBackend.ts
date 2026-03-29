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

export const maxDuration = 300

type ListParams = {
  limit: number
  offset: number
  dir?: string
  includeWorktrees?: boolean
}

type MessageListParams = {
  limit: number
  offset: number
}

type SendMessageParams = {
  sessionId: string
  request: NextRequest
  body: Record<string, unknown>
}

type ForkParams = {
  sessionId: string
  body: Record<string, unknown>
}

type RewindParams = {
  sessionId: string
  body: Record<string, unknown>
}

function codexContextUsageToEventData(contextUsage: ContextUsage): string {
  return `event: context-usage\ndata: ${JSON.stringify(contextUsage)}\n\n`
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

export async function listViewSessions(params: ListParams): Promise<Session[]> {
  const provider = await getConfiguredProvider()
  if (provider === 'codex') {
    return listCodexSessions(params)
  }

  const sessions = await listSessions({
    limit: params.limit,
    offset: params.offset,
    dir: params.dir,
    includeWorktrees: params.dir ? params.includeWorktrees : undefined,
  })
  return sessions.map((session) => ({
    ...session,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }))
}

export async function readViewSessionInfo(sessionId: string): Promise<SessionInfo | null> {
  const provider = await getConfiguredProvider()
  if (provider === 'codex') {
    const [thread, resume, tag] = await Promise.all([
      readCodexThread(sessionId, false),
      resumeCodexThread(sessionId),
      getCodexStoredTag(sessionId),
    ])
    return mapCodexThreadToSessionInfo(thread, tag, resume.model)
  }

  const info = await getSessionInfo(sessionId)
  if (!info) return null
  return {
    ...info,
    provider: 'claude',
    capabilities: getProviderCapabilities('claude'),
  }
}

export async function patchViewSession(sessionId: string, body: Record<string, unknown>): Promise<void> {
  const provider = await getConfiguredProvider()
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

export async function listViewSessionMessages(sessionId: string, params: MessageListParams): Promise<SessionMessage[]> {
  const provider = await getConfiguredProvider()
  if (provider === 'codex') {
    const thread = await readCodexThread(sessionId, true)
    const messages = mapCodexThreadToMessages(thread)
    return messages.slice(params.offset, params.offset + params.limit)
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

export async function streamViewSessionTurn(params: SendMessageParams): Promise<Response> {
  const userMessage = String(params.body.message ?? '').trim()
  if (!userMessage) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const provider = await getConfiguredProvider()
  if (provider === 'codex') {
    return createCodexStream(params.sessionId, params.request, params.body)
  }

  return createClaudeStream(params.sessionId, params.request, params.body)
}

export async function forkViewSession({ sessionId, body }: ForkParams): Promise<{ sessionId: string }> {
  const provider = await getConfiguredProvider()
  if (provider === 'codex') {
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

export async function readViewSessionModels(sessionId: string): Promise<{ models: SessionModelInfo[]; currentModel: string | null }> {
  const provider = await getConfiguredProvider()
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

export async function readViewSessionDiagnostics(sessionId: string): Promise<{ sections: SessionDiagnosticSection[]; currentModel: string | null }> {
  const provider = await getConfiguredProvider()
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

export async function rewindOrRollbackViewSession({ sessionId, body }: RewindParams): Promise<Record<string, unknown>> {
  const provider = await getConfiguredProvider()
  if (provider === 'codex') {
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

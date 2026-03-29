'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type {
  SessionMessage,
  Session,
  SendState,
  ContextUsage,
  SessionInfo,
  SessionModelInfo,
  SessionDiagnosticSection,
} from '@/lib/types'
import { buildThreadedMessages, type ThreadedMessage } from '@/lib/threading'
import { exportSessionToHtml, downloadHtml } from '@/lib/export'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import MessageItem from './MessageItem'
import CodeThemeToggle from './CodeThemeToggle'

type Props = {
  messages: SessionMessage[]
  loading: boolean
  session: Session | null
  projectView?: { key: string; sessionCount: number; providerMode: 'current' | 'all' }
  onFork?: (newSessionId: string) => void
}

type SseFrame = {
  event: string
  data: string
}

type LiveToolActivity = {
  key: string
  label: string
  detail?: string
  status: 'running' | 'done'
}

type RewindPreview = {
  userMessageId: string
  contentPreview: string
  filesChanged: string[]
}

type RollbackPreview = {
  numTurns: number
  turnsRemoved: Array<{ turnId: string; preview: string }>
}

function extractSseFrames(buffer: string): { frames: SseFrame[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: SseFrame[] = []
  let cursor = 0

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor)
    if (boundary === -1) break

    const rawFrame = normalized.slice(cursor, boundary)
    cursor = boundary + 2

    let event = 'message'
    const dataLines: string[] = []

    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join('\n') })
    }
  }

  return {
    frames,
    remaining: normalized.slice(cursor),
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('\n\n')
    .trim()
}

function extractStreamingAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'stream_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'content_block_delta') return null

    const delta = eventRecord.delta
    if (!delta || typeof delta !== 'object') return null
    const deltaRecord = delta as Record<string, unknown>
    return deltaRecord.type === 'text_delta' && typeof deltaRecord.text === 'string'
      ? deltaRecord.text
      : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return null

    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>

    return partRecord.type === 'text' && typeof propertiesRecord.delta === 'string'
      ? propertiesRecord.delta
      : null
  }

  if (record.type === 'assistant') {
    const message = record.message
    if (!message || typeof message !== 'object') return null
    const text = extractTextContent((message as Record<string, unknown>).content)
    return text || null
  }

  return null
}

function formatToolLabel(name: string): string {
  return name
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function codexItemToolLabel(item: Record<string, unknown>): { label: string; detail?: string } | null {
  const type = typeof item.type === 'string' ? item.type : ''
  switch (type) {
    case 'commandExecution':
      return { label: 'Bash', detail: typeof item.command === 'string' ? item.command : undefined }
    case 'fileChange':
      return { label: 'File Change' }
    case 'mcpToolCall':
      return {
        label: typeof item.tool === 'string' ? formatToolLabel(item.tool) : 'MCP',
        detail: typeof item.server === 'string' ? item.server : undefined,
      }
    case 'dynamicToolCall':
      return { label: typeof item.tool === 'string' ? formatToolLabel(item.tool) : 'Dynamic Tool' }
    case 'webSearch':
      return { label: 'Web Search', detail: typeof item.query === 'string' ? item.query : undefined }
    case 'collabAgentToolCall':
      return { label: 'Agent', detail: typeof item.tool === 'string' ? item.tool : undefined }
    default:
      return null
  }
}

function opencodeToolLabel(item: Record<string, unknown>): { label: string; detail?: string } | null {
  if (item.type !== 'tool' || typeof item.tool !== 'string') return null

  const state = item.state
  const detail = state && typeof state === 'object' && typeof (state as Record<string, unknown>).title === 'string'
    ? (state as Record<string, unknown>).title as string
    : undefined

  return {
    label: formatToolLabel(item.tool),
    detail,
  }
}

function extractLiveToolStart(payload: unknown): { index: number; key: string; label: string; detail?: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_item_started') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    const tool = codexItemToolLabel(itemRecord)
    const itemId = typeof itemRecord.id === 'string' ? itemRecord.id : null
    if (!tool || !itemId) return null
    return {
      index: 0,
      key: itemId,
      label: tool.label,
      detail: tool.detail,
    }
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return null

    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>
    const tool = opencodeToolLabel(partRecord)
    if (!tool) return null

    const state = partRecord.state
    if (!state || typeof state !== 'object') return null
    const status = typeof (state as Record<string, unknown>).status === 'string'
      ? ((state as Record<string, unknown>).status as string)
      : ''
    if (!['pending', 'running', 'completed', 'error'].includes(status)) return null

    return {
      index: -1,
      key: typeof partRecord.callID === 'string' ? partRecord.callID : String(partRecord.id ?? 'tool'),
      label: tool.label,
      detail: tool.detail,
    }
  }

  if (record.type !== 'stream_event') return null

  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'content_block_start' || typeof eventRecord.index !== 'number') return null

  const block = eventRecord.content_block
  if (!block || typeof block !== 'object') return null
  const blockRecord = block as Record<string, unknown>
  const blockType = typeof blockRecord.type === 'string' ? blockRecord.type : ''
  if (!['tool_use', 'server_tool_use', 'mcp_tool_use'].includes(blockType)) return null

  const name = typeof blockRecord.name === 'string' ? blockRecord.name : 'tool'
  const serverName = typeof blockRecord.server_name === 'string' ? blockRecord.server_name : null

  return {
    index: eventRecord.index,
    key: typeof blockRecord.id === 'string' ? blockRecord.id : `${blockType}-${eventRecord.index}`,
    label: formatToolLabel(name),
    detail: serverName ?? undefined,
  }
}

function extractLiveToolStopIndex(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    return typeof itemRecord.id === 'string' ? 0 : null
  }

  if (record.type !== 'stream_event') return null

  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>

  return eventRecord.type === 'content_block_stop' && typeof eventRecord.index === 'number'
    ? eventRecord.index
    : null
}

function extractCompletedToolKey(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    const tool = codexItemToolLabel(itemRecord)
    return tool && typeof itemRecord.id === 'string' ? itemRecord.id : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return null

    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>
    const tool = opencodeToolLabel(partRecord)
    if (!tool) return null

    const state = partRecord.state
    if (!state || typeof state !== 'object') return null
    const status = typeof (state as Record<string, unknown>).status === 'string'
      ? ((state as Record<string, unknown>).status as string)
      : ''

    return status === 'completed' || status === 'error'
      ? (typeof partRecord.callID === 'string' ? partRecord.callID : String(partRecord.id ?? 'tool'))
      : null
  }

  return null
}

function assistantDisplayName(provider: Session['provider'] | SessionInfo['provider'] | undefined): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'opencode') return 'OpenCode'
  return 'Claude'
}

function withProviderQuery(path: string, provider?: Session['provider']): string {
  if (!provider) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}provider=${provider}`
}

export default function MessageView({ messages, loading, session, projectView, onFork }: Props) {
  const [inputText, setInputText] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<SessionModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [rewindTargetId, setRewindTargetId] = useState('')
  const [rollbackTurns, setRollbackTurns] = useState(1)
  const [resumeFromMessageId, setResumeFromMessageId] = useState<string | null>(null)
  const [previewingRewind, setPreviewingRewind] = useState(false)
  const [applyingRewind, setApplyingRewind] = useState(false)
  const [rewindPreview, setRewindPreview] = useState<RewindPreview | null>(null)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [forking, setForking] = useState(false)
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticSections, setDiagnosticSections] = useState<SessionDiagnosticSection[]>([])
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionActionNotice, setSessionActionNotice] = useState<string | null>(null)
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(null)
  const [liveAssistantText, setLiveAssistantText] = useState('')
  const [liveToolActivities, setLiveToolActivities] = useState<LiveToolActivity[]>([])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useState(false)
  const [autoFollow, setAutoFollow] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingMessageBaselineRef = useRef<{ count: number; lastUuid: string | null; sessionId: string } | null>(null)
  const liveToolIndexesRef = useRef<Map<number, string>>(new Map())
  const sessionCapabilities = sessionInfo?.capabilities ?? session?.capabilities
  const assistantName = assistantDisplayName(sessionInfo?.provider ?? session?.provider)

  // Load session info (git branch, summary, etc.) when session changes
  useEffect(() => {
    if (!session) { setSessionInfo(null); return }
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}`, session.provider))
      .then(r => r.json())
      .then(data => { if (!data.error) setSessionInfo(data.info) })
      .catch(() => {})
  }, [session?.provider, session?.sessionId])

  useEffect(() => {
    if (!session) {
      setAvailableModels([])
      setSelectedModel('')
      return
    }

    fetch(withProviderQuery(`/api/sessions/${session.sessionId}/models`, session.provider))
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        setAvailableModels(data.models ?? [])
        setSelectedModel(data.currentModel ?? data.models?.[0]?.value ?? '')
      })
      .catch(() => {})
  }, [session?.provider, session?.sessionId])

  // Reset context usage when switching sessions
  useEffect(() => {
    setContextUsage(null)
    setSessionActionError(null)
    setSessionActionNotice(null)
    setResumeFromMessageId(null)
    setRewindPreview(null)
    setRollbackPreview(null)
    setShowDiagnostics(false)
    setDiagnosticSections([])
    setOptimisticUserText(null)
    setLiveAssistantText('')
    setLiveToolActivities([])
    setAwaitingPersistedTurn(false)
    setAutoFollow(true)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
  }, [session?.sessionId])

  useEffect(() => {
    if (!awaitingPersistedTurn || !session) return

    const baseline = pendingMessageBaselineRef.current
    if (!baseline || baseline.sessionId !== session.sessionId) return

    const currentLastUuid = messages.at(-1)?.uuid ?? null
    const persistedTurnArrived =
      messages.length > baseline.count
      || currentLastUuid !== baseline.lastUuid

    if (persistedTurnArrived) {
      setOptimisticUserText(null)
      setLiveAssistantText('')
      setLiveToolActivities([])
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
    }
  }, [awaitingPersistedTurn, messages, session])

  useEffect(() => {
    if (!rewindPreview || rewindPreview.userMessageId === rewindTargetId) return
    setRewindPreview(null)
  }, [rewindPreview, rewindTargetId])

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = timelineRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    if (!autoFollow) return
    const frame = window.requestAnimationFrame(() => scrollTimelineToBottom())
    return () => window.cancelAnimationFrame(frame)
  }, [
    autoFollow,
    loading,
    messages.length,
    optimisticUserText,
    liveAssistantText,
    liveToolActivities,
    awaitingPersistedTurn,
    scrollTimelineToBottom,
  ])

  const handleTimelineScroll = useCallback(() => {
    const node = timelineRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    setAutoFollow(distanceFromBottom < 72)
  }, [])

  const cancelSend = useCallback(() => {
    if (session) {
      fetch(`/api/sessions/${session.sessionId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider }),
      }).catch(() => {})
    }
    if (optimisticUserText) {
      setInputText((prev) => prev || optimisticUserText)
    }
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setSendState('idle')
    setSendError(null)
    setOptimisticUserText(null)
    setLiveAssistantText('')
    setLiveToolActivities([])
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    textareaRef.current?.focus()
  }, [optimisticUserText, session])

  const sendMessage = useCallback(async () => {
    if (!session || !inputText.trim() || sendState === 'sending') return

    const text = inputText.trim()
    setInputText('')
    setSendState('sending')
    setSendError(null)
    setOptimisticUserText(text)
    setLiveAssistantText('')
    setLiveToolActivities([])
    setAwaitingPersistedTurn(false)
    setAutoFollow(true)
    pendingMessageBaselineRef.current = {
      count: messages.length,
      lastUuid: messages.at(-1)?.uuid ?? null,
      sessionId: session.sessionId,
    }
    liveToolIndexesRef.current.clear()

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          model: selectedModel,
          resumeSessionAt: resumeFromMessageId ?? undefined,
          forkSession: Boolean(resumeFromMessageId),
          provider: session.provider,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const { frames, remaining } = extractSseFrames(sseBuffer)
        sseBuffer = remaining

        for (const frame of frames) {
          if (frame.event === 'context-usage') {
            try { setContextUsage(JSON.parse(frame.data)) } catch { /* ignore */ }
            continue
          }

          if (frame.event === 'session') {
            try {
              const parsed = JSON.parse(frame.data)
              if (resumeFromMessageId && parsed.sessionId && parsed.sessionId !== session.sessionId) {
                onFork?.(parsed.sessionId)
                setSessionActionNotice('Forked a continuation from the selected point.')
              }
            } catch { /* ignore */ }
            continue
          }

          if (frame.event === 'error') {
            try {
              const parsed = JSON.parse(frame.data)
              throw new Error(parsed.error ?? 'Unknown agent error')
            } catch (e) { throw e }
          }

          try {
            const parsed = JSON.parse(frame.data)
            const toolStart = extractLiveToolStart(parsed)
            if (toolStart) {
              if (parsed.type === 'stream_event') {
                liveToolIndexesRef.current.set(toolStart.index, toolStart.key)
              }
              setLiveToolActivities((prev) => {
                const existing = prev.filter((activity) => activity.key !== toolStart.key)
                return [...existing, { key: toolStart.key, label: toolStart.label, detail: toolStart.detail, status: 'running' }]
              })
            }

            const completedToolKey = extractCompletedToolKey(parsed)
            if (completedToolKey) {
              setLiveToolActivities((prev) => prev.map((activity) =>
                activity.key === completedToolKey
                  ? { ...activity, status: 'done' }
                  : activity
              ))
            }

            const toolStopIndex = extractLiveToolStopIndex(parsed)
            if (toolStopIndex != null && parsed.type !== 'codex_item_completed') {
              const activityKey = liveToolIndexesRef.current.get(toolStopIndex)
              if (activityKey) {
                setLiveToolActivities((prev) => prev.map((activity) =>
                  activity.key === activityKey
                    ? { ...activity, status: 'done' }
                    : activity
                ))
              }
            }

            const deltaText = extractStreamingAssistantText(parsed)
            if (deltaText) {
              setLiveAssistantText((prev) =>
                parsed.type === 'assistant'
                  ? deltaText
                  : `${prev}${deltaText}`
              )
            }
          } catch {
            /* ignore malformed stream payloads */
          }
        }
      }

      if (sseBuffer.trim()) {
        const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
        for (const frame of frames) {
          if (frame.event !== 'error') continue
          try {
            const parsed = JSON.parse(frame.data)
            throw new Error(parsed.error ?? 'Unknown agent error')
          } catch (e) { throw e }
        }
      }

      setSendState('idle')
      setAwaitingPersistedTurn(true)
      setResumeFromMessageId(null)
      textareaRef.current?.focus()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — already reset by cancelSend()
        return
      }
      setSendState('error')
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
      setInputText(text)
      setOptimisticUserText(null)
      setLiveAssistantText('')
      setLiveToolActivities([])
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
    } finally {
      abortControllerRef.current = null
    }
  }, [inputText, messages, onFork, resumeFromMessageId, selectedModel, sendState, session])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  const handleExport = useCallback(() => {
    if (!session) return
    const dirName  = session.customTitle ?? session.summary ?? getPrimarySessionTag(session.tag) ?? session.cwd?.split('/').pop() ?? session.sessionId
    const safeName = dirName.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase()
    const html = exportSessionToHtml(session, messages)
    downloadHtml(html, `${safeName}_${session.sessionId.slice(0, 8)}.html`)
  }, [session, messages])

  const handleFork = useCallback(async () => {
    if (!session || forking) return
    setForking(true)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onFork?.(data.sessionId)
    } catch (err) {
      console.error('Fork failed:', err)
    } finally {
      setForking(false)
    }
  }, [session, forking, onFork])

  const handleForkFromMessage = useCallback(async (messageId: string) => {
    if (!session || forkingMessageId || !sessionCapabilities?.messageFork) return
    setForkingMessageId(messageId)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upToMessageId: messageId, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      onFork?.(data.sessionId)
      setSessionActionNotice('Forked a new session from that point.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to fork from message')
    } finally {
      setForkingMessageId(null)
    }
  }, [forkingMessageId, onFork, session, sessionCapabilities?.messageFork])

  const toggleResumeFromMessage = useCallback((messageId: string) => {
    if (!sessionCapabilities?.resumeAtMessage) return
    setResumeFromMessageId((prev) => prev === messageId ? null : messageId)
    setSessionActionError(null)
    setSessionActionNotice(null)
  }, [sessionCapabilities?.resumeAtMessage])

  const toggleDiagnostics = useCallback(async () => {
    if (!session) return
    const nextOpen = !showDiagnostics
    setShowDiagnostics(nextOpen)
    if (!nextOpen || diagnosticSections.length > 0 || diagnosticsLoading) return

    setDiagnosticsLoading(true)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/diagnostics`, session.provider))
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDiagnosticSections(data.sections ?? [])
      if (data.currentModel && !selectedModel) setSelectedModel(data.currentModel)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to load diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  }, [diagnosticSections.length, diagnosticsLoading, selectedModel, session, showDiagnostics])

  const threaded = buildThreadedMessages(messages)
  const isProject = !!projectView
  const dirName  = projectView?.key ?? session?.cwd?.split('/').pop() ?? session?.sessionId ?? ''
  const activeToolCount = liveToolActivities.filter((activity) => activity.status === 'running').length
  const liveUserMessage: ThreadedMessage | null = !isProject && optimisticUserText
    ? {
        role: 'user',
        uuid: 'live-user',
        sessionId: session?.sessionId,
        provider: session?.provider,
        blocks: [{ type: 'text', text: optimisticUserText }],
      }
    : null
  const liveAssistantMessage: ThreadedMessage | null = !isProject && (sendState === 'sending' || awaitingPersistedTurn)
    ? {
        role: 'assistant',
        uuid: 'live-assistant',
        sessionId: session?.sessionId,
        provider: session?.provider,
        blocks: [{
          type: 'text',
          text: liveAssistantText.trim()
            || (activeToolCount > 0
              ? `Using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
              : sendState === 'sending'
              ? 'Working…'
              : 'Waiting for saved response…'),
        }],
      }
    : null
  const rewindCandidates = (sessionCapabilities?.fileRewind ? messages : [])
    .filter((msg) =>
      msg.type === 'user'
      && extractTextContent(msg.message.content).trim() !== ''
      && !extractTextContent(msg.message.content).trimStart().startsWith('<task-notification>')
    )
    .map((msg) => ({
      uuid: msg.uuid,
      content: extractTextContent(msg.message.content),
      timestamp: msg.timestamp,
    }))
  const selectedRewindTarget = rewindCandidates.find((candidate) => candidate.uuid === rewindTargetId) ?? null
  const rollbackCandidates = sessionCapabilities?.rollback
    ? (() => {
        const turns = new Map<string, { turnId: string; preview: string }>()
        for (const msg of messages) {
          if (!msg.turnId || turns.has(msg.turnId)) continue
          const preview = typeof msg.message.content === 'string'
            ? msg.message.content.replace(/\s+/g, ' ').trim().slice(0, 120)
            : msg.type === 'assistant'
            ? 'Assistant output'
            : 'Turn'
          turns.set(msg.turnId, { turnId: msg.turnId, preview: preview || msg.turnId })
        }
        return Array.from(turns.values())
      })()
    : []
  const hasLiveTimeline = threaded.length > 0 || !!liveUserMessage || !!liveAssistantMessage

  useEffect(() => {
    const fallbackId = rewindCandidates.at(-1)?.uuid ?? ''
    setRewindTargetId((prev) => rewindCandidates.some((candidate) => candidate.uuid === prev) ? prev : fallbackId)
  }, [messages, session?.sessionId])

  const handleRewind = useCallback(async () => {
    if (!session || !selectedRewindTarget || previewingRewind || applyingRewind) return

    setPreviewingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId: selectedRewindTarget.uuid, model: selectedModel, dryRun: true, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

      const filesChanged = Array.isArray(data.filesChanged)
        ? data.filesChanged.filter((file: unknown): file is string => typeof file === 'string')
        : []

      setRewindPreview({
        userMessageId: selectedRewindTarget.uuid,
        contentPreview: selectedRewindTarget.content.replace(/\s+/g, ' ').trim().slice(0, 160),
        filesChanged,
      })
      setSessionActionNotice(filesChanged.length > 0
        ? `Previewed ${filesChanged.length} file change${filesChanged.length === 1 ? '' : 's'}.`
        : 'No tracked file changes at that prompt.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
    } finally {
      setPreviewingRewind(false)
    }
  }, [applyingRewind, previewingRewind, selectedModel, selectedRewindTarget, session])

  const handleApplyRewind = useCallback(async () => {
    if (!session || !rewindPreview || applyingRewind) return

    setApplyingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId: rewindPreview.userMessageId, model: selectedModel, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

      const fileCount = Array.isArray(data.filesChanged) ? data.filesChanged.length : rewindPreview.filesChanged.length
      setRewindPreview(null)
      setSessionActionNotice(fileCount > 0 ? `Rewound ${fileCount} file${fileCount === 1 ? '' : 's'}.` : 'Rewind complete.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
    } finally {
      setApplyingRewind(false)
    }
  }, [applyingRewind, rewindPreview, selectedModel, session])

  const handleRollbackPreview = useCallback(async () => {
    if (!session || previewingRewind || applyingRewind || rollbackTurns < 1) return

    setPreviewingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numTurns: rollbackTurns, dryRun: true, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const turnsRemoved = Array.isArray(data.turnsRemoved)
        ? data.turnsRemoved.filter((turn: unknown): turn is { turnId: string; preview: string } =>
            Boolean(turn)
            && typeof turn === 'object'
            && typeof (turn as { turnId?: unknown }).turnId === 'string'
            && typeof (turn as { preview?: unknown }).preview === 'string'
          )
        : []
      setRollbackPreview({ numTurns: rollbackTurns, turnsRemoved })
      setSessionActionNotice(`Previewed rollback of ${rollbackTurns} turn${rollbackTurns === 1 ? '' : 's'}.`)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to preview rollback')
    } finally {
      setPreviewingRewind(false)
    }
  }, [applyingRewind, previewingRewind, rollbackTurns, session])

  const handleApplyRollback = useCallback(async () => {
    if (!session || !rollbackPreview || applyingRewind) return

    setApplyingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numTurns: rollbackPreview.numTurns, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRollbackPreview(null)
      setSessionActionNotice(`Rolled back ${rollbackPreview.numTurns} turn${rollbackPreview.numTurns === 1 ? '' : 's'}.`)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to roll back thread')
    } finally {
      setApplyingRewind(false)
    }
  }, [applyingRewind, rollbackPreview, session])

  if (!session && !projectView) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* Decorative orbital ring */}
        <div style={{ position: 'relative', width: 72, height: 72 }}>
          {/* Outer dashed orbit */}
          <div style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            border: '1px dashed var(--border)',
            animation: 'orbit-spin 18s linear infinite',
          }}>
            {/* Orbiting dot */}
            <div style={{
              position: 'absolute',
              top: -3, left: '50%',
              width: 5, height: 5,
              borderRadius: '50%',
              background: 'var(--violet)',
              transform: 'translateX(-50%)',
              boxShadow: '0 0 6px 2px var(--violet-glow)',
            }} />
          </div>
          {/* Inner circle */}
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            border: '1px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, var(--surface-2), var(--surface))',
            boxShadow: '0 0 40px 8px rgba(139,128,240,0.04) inset',
          }}>
            <div style={{
              width: 18, height: 18,
              borderRadius: '50%',
              background: 'var(--surface-3)',
              border: '1px solid var(--border-2)',
              boxShadow: '0 0 8px 2px rgba(139,128,240,0.06)',
            }} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
            marginBottom: 8,
          }}>
            No session selected
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.03em',
          }}>
            ← Choose a session from the sidebar
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* ── Top bar ──────────────────────────────────── */}
      <div
        style={{
          padding: '0 28px',
          height: 52,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'linear-gradient(to right, rgba(139,128,240,0.05) 0%, var(--surface) 40%)',
        }}
      >
        {/* Project / session name */}
        <span
          style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--text)',
            textTransform: 'uppercase',
          }}
        >
          {dirName}
        </span>

        {/* Project view badge */}
        {isProject && (
          <>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: 'var(--violet)',
                background: 'rgba(139,128,240,0.1)',
                border: '1px solid rgba(139,128,240,0.25)',
                borderRadius: 3,
                padding: '2px 7px',
                flexShrink: 0,
              }}
            >
              ALL SESSIONS
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: projectView.providerMode === 'all' ? 'var(--green)' : 'var(--text-3)',
                background: projectView.providerMode === 'all' ? 'rgba(45,212,160,0.1)' : 'var(--surface-2)',
                border: `1px solid ${projectView.providerMode === 'all' ? 'rgba(45,212,160,0.25)' : 'var(--border)'}`,
                borderRadius: 3,
                padding: '2px 7px',
                flexShrink: 0,
              }}
            >
              {projectView.providerMode === 'all' ? 'ALL PROVIDERS' : 'CURRENT PROVIDER'}
            </span>
          </>
        )}

        {/* Single-session path + git branch */}
        {!isProject && session?.cwd && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {session.cwd}
            {sessionInfo?.gitBranch && (
              <span style={{ color: 'var(--violet)', marginLeft: 8 }}>
                ⎇ {sessionInfo.gitBranch}
              </span>
            )}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Context usage bar */}
        {!isProject && contextUsage && (
          <div
            title={`${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(contextUsage.percentage)}%)`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: contextUsage.percentage > 80 ? 'var(--red, #f87171)' : 'var(--text-3)',
              letterSpacing: '0.03em',
            }}>
              {Math.round(contextUsage.percentage)}%
            </span>
            <div style={{
              width: 56,
              height: 4,
              borderRadius: 2,
              background: 'var(--border-2)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(contextUsage.percentage, 100)}%`,
                borderRadius: 2,
                backgroundColor: contextUsage.percentage > 80
                  ? 'var(--red, #f87171)'
                  : contextUsage.percentage > 60
                  ? 'var(--yellow, #fbbf24)'
                  : 'var(--violet)',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        )}

        {/* Code theme picker */}
        <CodeThemeToggle />

        {/* Stats */}
        {!loading && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              flexShrink: 0,
            }}
          >
            {isProject
              ? `${projectView!.sessionCount} sessions · ${threaded.length} turns`
              : `${threaded.length} turns · ${messages.length} events`}
          </span>
        )}

        {/* Fork button (single session only) */}
        {!isProject && (
          <button
            onClick={handleFork}
            disabled={forking}
            title="Fork this session into a new branch"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'rgba(139,128,240,0.07)',
              border: '1px solid rgba(139,128,240,0.18)',
              borderRadius: 5,
              cursor: forking ? 'not-allowed' : 'pointer',
              color: 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              opacity: forking ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!forking) {
                e.currentTarget.style.background    = 'rgba(139,128,240,0.14)'
                e.currentTarget.style.color         = 'var(--violet)'
                e.currentTarget.style.borderColor   = 'rgba(139,128,240,0.35)'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'rgba(139,128,240,0.07)'
              e.currentTarget.style.color         = 'var(--text-3)'
              e.currentTarget.style.borderColor   = 'rgba(139,128,240,0.18)'
            }}
          >
            {forking ? 'FORKING…' : 'FORK'}
          </button>
        )}

        {/* Export button (single session only) */}
        {!isProject && (
          <button
            onClick={handleExport}
            title="Export session to HTML"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'rgba(56,217,245,0.07)',
              border: '1px solid rgba(56,217,245,0.18)',
              borderRadius: 5,
              cursor: 'pointer',
              color: 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background    = 'rgba(56,217,245,0.13)'
              e.currentTarget.style.color         = 'var(--cyan)'
              e.currentTarget.style.borderColor   = 'rgba(56,217,245,0.35)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'rgba(56,217,245,0.07)'
              e.currentTarget.style.color         = 'var(--text-3)'
              e.currentTarget.style.borderColor   = 'rgba(56,217,245,0.18)'
            }}
          >
            EXPORT
          </button>
        )}

        {!isProject && (
          <button
            onClick={toggleDiagnostics}
            title="Show session diagnostics"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: showDiagnostics ? 'rgba(234,170,64,0.14)' : 'rgba(234,170,64,0.07)',
              border: '1px solid rgba(234,170,64,0.18)',
              borderRadius: 5,
              cursor: 'pointer',
              color: showDiagnostics ? 'var(--yellow, #fbbf24)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
            }}
          >
            DIAG
          </button>
        )}

        {/* Live pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(45, 212, 160, 0.08)',
            border: '1px solid rgba(45, 212, 160, 0.2)',
            borderRadius: 20,
            padding: '2px 8px 2px 6px',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--green)',
              display: 'inline-block',
              animation: 'live-pulse 2.5s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--green)',
              letterSpacing: '0.08em',
            }}
          >
            LIVE
          </span>
        </div>
      </div>

      {/* ── Timeline feed ────────────────────────────── */}
      <div
        ref={timelineRef}
        onScroll={handleTimelineScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '28px 32px 72px',
        }}
      >
        {showDiagnostics && !isProject && (
          <div
            style={{
              marginBottom: 18,
              padding: '14px 16px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-2)',
            }}
          >
            <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
              Session Diagnostics
            </div>
            {diagnosticsLoading ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                Loading diagnostics…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {diagnosticSections.map((section) => (
                  <div key={section.id}>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 6 }}>
                      {section.title}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {section.items.map((item, index) => (
                        <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)' }}>
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {loading && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-3)',
              letterSpacing: '0.04em',
            }}
          >
            Loading…
          </div>
        )}
        {!loading && !hasLiveTimeline && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No messages.</div>
        )}
        {!loading && hasLiveTimeline && (
          <div style={{ position: 'relative' }}>
            {/* Continuous timeline track */}
            <div
              className="timeline-line"
              style={{
                position: 'absolute',
                left: 9,
                top: 10,
                bottom: 0,
                width: 1,
                background: 'linear-gradient(to bottom, var(--border-2) 0%, var(--border) 60%, transparent 100%)',
                pointerEvents: 'none',
              }}
            />
            {threaded.map((msg, i) => (
              <div
                key={msg.uuid}
                style={{
                  animation: 'fade-up 0.28s ease both',
                  animationDelay: `${Math.min(i * 16, 320)}ms`,
                }}
              >
                {!isProject && (sessionCapabilities?.messageFork || (msg.role === 'assistant' && sessionCapabilities?.resumeAtMessage)) && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '0 0 8px 0' }}>
                    {sessionCapabilities?.messageFork && (
                      <button
                        onClick={() => handleForkFromMessage(msg.uuid)}
                        disabled={forkingMessageId === msg.uuid}
                        style={{
                          height: 22,
                          padding: '0 8px',
                          borderRadius: 4,
                          border: '1px solid rgba(139,128,240,0.18)',
                          background: 'rgba(139,128,240,0.07)',
                          color: 'var(--text-3)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          cursor: forkingMessageId === msg.uuid ? 'not-allowed' : 'pointer',
                          opacity: forkingMessageId === msg.uuid ? 0.5 : 1,
                        }}
                      >
                        {forkingMessageId === msg.uuid ? 'FORKING…' : 'FORK HERE'}
                      </button>
                    )}
                    {msg.role === 'assistant' && sessionCapabilities?.resumeAtMessage && (
                      <button
                        onClick={() => toggleResumeFromMessage(msg.uuid)}
                        style={{
                          height: 22,
                          padding: '0 8px',
                          borderRadius: 4,
                          border: `1px solid ${resumeFromMessageId === msg.uuid ? 'rgba(56,217,245,0.35)' : 'rgba(56,217,245,0.18)'}`,
                          background: resumeFromMessageId === msg.uuid ? 'rgba(56,217,245,0.14)' : 'rgba(56,217,245,0.07)',
                          color: resumeFromMessageId === msg.uuid ? 'var(--cyan)' : 'var(--text-3)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          cursor: 'pointer',
                        }}
                      >
                        {resumeFromMessageId === msg.uuid ? 'RESUME TARGET' : 'RESUME HERE'}
                      </button>
                    )}
                  </div>
                )}
                <MessageItem message={msg} showSession={isProject} />
              </div>
            ))}
            {liveUserMessage && (
              <div style={{ opacity: 0.9 }}>
                <MessageItem message={liveUserMessage} showSession={false} />
              </div>
            )}
            {liveAssistantMessage && (
              <div style={{ opacity: 0.92 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 8px 0' }}>
                  <span style={{
                    height: 20,
                    padding: '0 8px',
                    borderRadius: 999,
                    border: '1px solid rgba(45,212,160,0.22)',
                    background: 'rgba(45,212,160,0.08)',
                    color: 'var(--green)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}>
                    {awaitingPersistedTurn ? 'SYNCING TO LOG' : 'LIVE PREVIEW'}
                  </span>
                </div>
                {liveToolActivities.length > 0 && (
                  <div style={{ margin: '0 0 10px 38px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {liveToolActivities.map((activity) => (
                      <span
                        key={activity.key}
                        style={{
                          height: 22,
                          padding: '0 8px',
                          borderRadius: 999,
                          border: `1px solid ${activity.status === 'running' ? 'rgba(56,217,245,0.25)' : 'rgba(45,212,160,0.22)'}`,
                          background: activity.status === 'running' ? 'rgba(56,217,245,0.08)' : 'rgba(45,212,160,0.08)',
                          color: activity.status === 'running' ? 'var(--cyan)' : 'var(--green)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.05em',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                        title={activity.detail ?? activity.label}
                      >
                        <span>{activity.label}</span>
                        <span style={{ color: activity.status === 'running' ? 'var(--cyan)' : 'var(--green)' }}>
                          {activity.status === 'running' ? 'RUNNING' : 'DONE'}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                <MessageItem message={liveAssistantMessage} showSession={false} />
              </div>
            )}
          </div>
        )}
        {!autoFollow && hasLiveTimeline && (
          <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              onClick={() => {
                setAutoFollow(true)
                scrollTimelineToBottom('smooth')
              }}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 999,
                border: '1px solid rgba(56,217,245,0.24)',
                background: 'rgba(9,14,22,0.88)',
                color: 'var(--cyan)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.05em',
                cursor: 'pointer',
                boxShadow: '0 10px 30px rgba(0,0,0,0.24)',
              }}
            >
              JUMP TO LIVE
            </button>
          </div>
        )}
      </div>

      {/* ── Message input (single session only) ──────── */}
      {!isProject && <div
        style={{
          padding: '12px 20px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        {sendError && (
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--red, #f87171)',
            marginBottom: 8,
            letterSpacing: '0.03em',
          }}>
            {sendError}
          </div>
        )}
        {(sessionActionError || sessionActionNotice) && (
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: sessionActionError ? 'var(--red, #f87171)' : 'var(--green)',
            marginBottom: 8,
            letterSpacing: '0.03em',
          }}>
            {sessionActionError ?? sessionActionNotice}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              letterSpacing: '0.05em',
            }}>
              MODEL
            </span>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={{
                height: 28,
                minWidth: 180,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 5,
                color: 'var(--text)',
                padding: '0 8px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
              }}
            >
              {(availableModels.length > 0 ? availableModels : [{ value: selectedModel, displayName: selectedModel, description: '' }]).map((model) => (
                <option key={model.value} value={model.value}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          {sessionCapabilities?.fileRewind && rewindCandidates.length > 0 && (
            <>
              <select
                value={rewindTargetId}
                onChange={e => setRewindTargetId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  height: 28,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  color: 'var(--text)',
                  padding: '0 8px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                }}
              >
                {rewindCandidates.slice().reverse().map((candidate) => (
                  <option key={candidate.uuid} value={candidate.uuid}>
                    {candidate.content.replace(/\s+/g, ' ').trim().slice(0, 72) || candidate.uuid}
                  </option>
                ))}
              </select>
              <button
                onClick={handleRewind}
                disabled={previewingRewind || applyingRewind || !rewindTargetId}
                style={{
                  flexShrink: 0,
                  height: 28,
                  padding: '0 12px',
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.22)',
                  borderRadius: 5,
                  color: 'var(--yellow, #fbbf24)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: previewingRewind || applyingRewind || !rewindTargetId ? 'not-allowed' : 'pointer',
                  opacity: previewingRewind || applyingRewind || !rewindTargetId ? 0.5 : 1,
                }}
              >
                {previewingRewind ? 'PREVIEWING…' : 'PREVIEW REWIND'}
              </button>
            </>
          )}
          {sessionCapabilities?.rollback && rollbackCandidates.length > 0 && (
            <>
              <select
                value={rollbackTurns}
                onChange={e => setRollbackTurns(Number(e.target.value))}
                style={{
                  height: 28,
                  minWidth: 180,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  color: 'var(--text)',
                  padding: '0 8px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                }}
              >
                {Array.from({ length: Math.min(10, rollbackCandidates.length) }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    Roll back {value} turn{value === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <button
                onClick={handleRollbackPreview}
                disabled={previewingRewind || applyingRewind}
                style={{
                  flexShrink: 0,
                  height: 28,
                  padding: '0 12px',
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.22)',
                  borderRadius: 5,
                  color: 'var(--yellow, #fbbf24)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: previewingRewind || applyingRewind ? 'not-allowed' : 'pointer',
                  opacity: previewingRewind || applyingRewind ? 0.5 : 1,
                }}
              >
                {previewingRewind ? 'PREVIEWING…' : 'PREVIEW ROLLBACK'}
              </button>
            </>
          )}
        </div>
        {rewindPreview && (
          <div
            style={{
              marginBottom: 10,
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid rgba(251,191,36,0.22)',
              background: 'rgba(251,191,36,0.06)',
            }}
          >
            <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 12, fontWeight: 600, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.08em' }}>
              Rewind Preview
            </div>
            <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
              {rewindPreview.contentPreview || 'Selected prompt'}
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rewindPreview.filesChanged.length > 0 ? rewindPreview.filesChanged.map((file) => (
                <div
                  key={file}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: 'var(--text-2)',
                    padding: '5px 8px',
                    borderRadius: 5,
                    background: 'rgba(9,14,22,0.24)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {file}
                </div>
              )) : (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                  No tracked files would change.
                </div>
              )}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button
                onClick={handleApplyRewind}
                disabled={applyingRewind}
                style={{
                  height: 28,
                  padding: '0 12px',
                  background: 'rgba(251,191,36,0.12)',
                  border: '1px solid rgba(251,191,36,0.28)',
                  borderRadius: 5,
                  color: 'var(--yellow, #fbbf24)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: applyingRewind ? 'not-allowed' : 'pointer',
                  opacity: applyingRewind ? 0.5 : 1,
                }}
              >
                {applyingRewind ? 'APPLYING…' : 'APPLY REWIND'}
              </button>
              <button
                onClick={() => setRewindPreview(null)}
                style={{
                  height: 28,
                  padding: '0 12px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  color: 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
        {rollbackPreview && (
          <div
            style={{
              marginBottom: 10,
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid rgba(251,191,36,0.22)',
              background: 'rgba(251,191,36,0.06)',
            }}
          >
            <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 12, fontWeight: 600, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.08em' }}>
              Rollback Preview
            </div>
            <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
              This removes the last {rollbackPreview.numTurns} turn{rollbackPreview.numTurns === 1 ? '' : 's'} from the Codex thread history. It does not revert files in the workspace.
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rollbackPreview.turnsRemoved.map((turn) => (
                <div
                  key={turn.turnId}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: 'var(--text-2)',
                    padding: '5px 8px',
                    borderRadius: 5,
                    background: 'rgba(9,14,22,0.24)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {turn.preview || turn.turnId}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button
                onClick={handleApplyRollback}
                disabled={applyingRewind}
                style={{
                  height: 28,
                  padding: '0 12px',
                  background: 'rgba(251,191,36,0.12)',
                  border: '1px solid rgba(251,191,36,0.28)',
                  borderRadius: 5,
                  color: 'var(--yellow, #fbbf24)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: applyingRewind ? 'not-allowed' : 'pointer',
                  opacity: applyingRewind ? 0.5 : 1,
                }}
              >
                {applyingRewind ? 'APPLYING…' : 'APPLY ROLLBACK'}
              </button>
              <button
                onClick={() => setRollbackPreview(null)}
                style={{
                  height: 28,
                  padding: '0 12px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  color: 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
        {sessionCapabilities?.resumeAtMessage && resumeFromMessageId && (
          <div style={{
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--cyan)',
            letterSpacing: '0.03em',
          }}>
            <span>Next send will resume from the selected timeline point in a forked session.</span>
            <button
              onClick={() => setResumeFromMessageId(null)}
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 4,
                border: '1px solid rgba(56,217,245,0.22)',
                background: 'rgba(56,217,245,0.08)',
                color: 'var(--cyan)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.06em',
                cursor: 'pointer',
              }}
            >
              CLEAR
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => {
              setInputText(e.target.value)
              if (sendError) setSendError(null)
              // Auto-resize
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`
            }}
            onKeyDown={handleKeyDown}
            disabled={sendState === 'sending'}
            placeholder={activeToolCount > 0 ? `${assistantName} is using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…` : 'Send a message… (⌘↩ to send)'}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              background: 'var(--surface-2)',
              border: `1px solid ${sendState === 'error' ? 'rgba(248,113,113,0.4)' : 'var(--border-2)'}`,
              borderRadius: 6,
              padding: '8px 12px',
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.5,
              outline: 'none',
              overflow: 'hidden',
              opacity: sendState === 'sending' ? 0.5 : 1,
              transition: 'border-color 0.15s, opacity 0.15s',
            }}
          />
          {sendState === 'sending' ? (
            <button
              onClick={cancelSend}
              style={{
                flexShrink: 0,
                height: 36,
                padding: '0 14px',
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 6,
                color: 'var(--red, #f87171)',
                fontFamily: "'Oxanium', monospace",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                cursor: 'pointer',
                transition: 'background 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              CANCEL
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!inputText.trim()}
              style={{
                flexShrink: 0,
                height: 36,
                padding: '0 14px',
                background: 'rgba(139,128,240,0.18)',
                border: '1px solid rgba(139,128,240,0.3)',
                borderRadius: 6,
                color: 'var(--violet)',
                fontFamily: "'Oxanium', monospace",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                cursor: !inputText.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s, color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              SEND
            </button>
          )}
        </div>
      </div>}
    </div>
  )
}

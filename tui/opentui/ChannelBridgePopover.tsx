/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import {
  advanceChannelDeliveryState,
  channelPermissionToPending,
  readBridgeConfigFromEnv,
  respondToChannelPermission,
  subscribeToChannelEvents,
  type ChannelBridgeStatus,
  type ChannelDeliveryState,
  type ChannelEvent,
  type ChannelPermissionRequestEvent,
} from '../../lib/channelBridge'
import {
  createChannelBridgeMessageId,
  flushChannelBridgeOutbox,
  sendDurableChannelMessage,
} from '../../lib/channelBridgeOutbox'
import { channelBridgeFileOutboxStorage } from '../../lib/bridgeMessages'

type ChannelBridgeKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }

type LogEntry =
  | { kind: 'sent'; id: string; text: string; messageId: string; delivery: ChannelDeliveryState }
  | { kind: 'reply'; id: string; text: string }
  | { kind: 'permission'; id: string; request: ChannelPermissionRequestEvent; resolved?: 'allow' | 'deny' }

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  routeComposer: boolean
  targetSessionId: string
  onToggleRoute: () => void
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string) => void
  onKeyHandlerReady: (handler: (key: ChannelBridgeKeyEvent) => void) => void
}

let entrySeq = 0
function nextEntryId(prefix: string): string {
  entrySeq += 1
  return `${prefix}-${entrySeq}`
}

function isPrintable(key: ChannelBridgeKeyEvent): boolean {
  return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= ' '
}

function withCursor(value: string): string {
  return `${value}▏`
}

function statusLabel(status: ChannelBridgeStatus): string {
  switch (status) {
    case 'connected': return 'connected'
    case 'connecting': return 'connecting…'
    case 'error': return 'disconnected — retrying'
    default: return 'idle'
  }
}

function statusColor(status: ChannelBridgeStatus, theme: TuiThemePalette): string {
  switch (status) {
    case 'connected': return theme.green
    case 'error': return theme.red
    default: return theme.dim
  }
}

export function ChannelBridgePopover({
  theme,
  accentColor,
  width,
  height,
  routeComposer,
  targetSessionId,
  onToggleRoute,
  onClose,
  onNotice,
  onKeyHandlerReady,
}: Props) {
  const config = useMemo(readBridgeConfigFromEnv, [])
  const [status, setStatus] = useState<ChannelBridgeStatus>('idle')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const lastChatIdRef = useRef<string | undefined>(undefined)
  const deliveryStatusRef = useRef(new Map<string, ChannelDeliveryState>())

  useEffect(() => {
    const unsubscribe = subscribeToChannelEvents(
      config,
      (event: ChannelEvent) => {
        if (event.type === 'reply') {
          lastChatIdRef.current = event.chat_id
          setEntries((prev) => [...prev, { kind: 'reply', id: nextEntryId('reply'), text: event.text }])
        } else if (event.type === 'permission_request') {
          setEntries((prev) => [...prev, { kind: 'permission', id: nextEntryId('perm'), request: event }])
        } else {
          const delivery = event.status === 'processed' ? 'processed' : 'accepted'
          const advanced = advanceChannelDeliveryState(deliveryStatusRef.current.get(event.message_id), delivery)
          deliveryStatusRef.current.set(event.message_id, advanced)
          setEntries((prev) => prev.map((entry) => (
            entry.kind === 'sent' && entry.messageId === event.message_id
              ? { ...entry, delivery: advanceChannelDeliveryState(entry.delivery, advanced) }
              : entry
          )))
        }
      },
      (next) => {
        setStatus(next)
        if (next !== 'connected') return
        void flushChannelBridgeOutbox(channelBridgeFileOutboxStorage, config, targetSessionId, {
          onDelivered: ({ entry, response }) => {
            const delivery = response.status === 'processed' ? 'processed' : 'accepted'
            const advanced = advanceChannelDeliveryState(deliveryStatusRef.current.get(entry.messageId), delivery)
            deliveryStatusRef.current.set(entry.messageId, advanced)
            setEntries((prev) => prev.map((item) => (
              item.kind === 'sent' && item.messageId === entry.messageId
                ? { ...item, delivery: advanceChannelDeliveryState(item.delivery, advanced) }
                : item
            )))
          },
        }).then((result) => {
          if (result.error) onNotice('error', `Channel message remains queued: ${result.error.message}`)
        })
      },
    )
    return unsubscribe
  }, [config, onNotice, targetSessionId])

  useEffect(() => {
    scrollRef.current?.scrollTo(scrollRef.current?.scrollHeight ?? Number.MAX_SAFE_INTEGER)
  }, [entries])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const chatId = lastChatIdRef.current ?? createChannelBridgeMessageId()
      lastChatIdRef.current = chatId
      const result = await sendDurableChannelMessage(channelBridgeFileOutboxStorage, config, {
        targetSessionId,
        text,
        chatId,
      })
      lastChatIdRef.current = result.response?.chat_id ?? chatId
      const delivery = result.response?.status === 'processed' ? 'processed' : result.queued ? 'queued' : 'accepted'
      const advanced = advanceChannelDeliveryState(deliveryStatusRef.current.get(result.entry.messageId), delivery)
      deliveryStatusRef.current.set(result.entry.messageId, advanced)
      setEntries((prev) => [...prev, {
        kind: 'sent',
        id: nextEntryId('sent'),
        text,
        messageId: result.entry.messageId,
        delivery: advanced,
      }])
      setDraft('')
      if (result.queued) onNotice('info', 'Queued for the live CLI bridge to reconnect')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to reach the channel bridge')
    } finally {
      setSending(false)
    }
  }, [config, draft, onNotice, sending, targetSessionId])

  const answerLatestPermission = useCallback(
    async (behavior: 'allow' | 'deny') => {
      let target: Extract<LogEntry, { kind: 'permission' }> | null = null
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i]
        if (entry.kind === 'permission' && !entry.resolved) { target = entry; break }
      }
      if (!target) {
        onNotice('info', 'No pending permission request from the channel bridge')
        return
      }
      const request = target
      setEntries((prev) => prev.map((item) => (item.id === request.id ? { ...item, resolved: behavior } : item)))
      try {
        await respondToChannelPermission(config, request.request.request_id, behavior)
      } catch (err) {
        setEntries((prev) => prev.map((item) => (item.id === request.id ? { ...item, resolved: undefined } : item)))
        onNotice('error', err instanceof Error ? err.message : 'Failed to send the verdict')
      }
    },
    [config, entries, onNotice],
  )

  const handleKey = useCallback((key: ChannelBridgeKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.ctrl && (key.name === 'r' || key.sequence === '\x12')) { onToggleRoute(); return }
    if (key.name === 'return') { void send(); return }
    if (key.name === 'backspace' || key.name === 'delete') { setDraft((d) => d.slice(0, -1)); return }
    if (key.ctrl && (key.name === 'y' || key.sequence === '')) { void answerLatestPermission('allow'); return }
    if (key.ctrl && (key.name === 'n' || key.sequence === '')) { void answerLatestPermission('deny'); return }
    if (isPrintable(key)) { setDraft((d) => d + key.sequence); return }
  }, [answerLatestPermission, onClose, onToggleRoute, send])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 100)
  const popH = Math.min(height - 4, 36)
  const headerH = 3
  const footerH = 3
  const bodyH = Math.max(popH - headerH - footerH - 2, 8)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title=" Live CLI bridge "
      titleColor={accentColor}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box flexDirection="row" alignItems="center">
          <text fg={statusColor(status, theme)} wrapMode="none">{statusLabel(status)}</text>
          <text fg={theme.dim} wrapMode="none">{'  '}{config.baseUrl.replace(/^https?:\/\//, '')}</text>
          <box flexGrow={1} />
          <text fg={theme.dim} wrapMode="none">enter send · ^Y allow · ^N deny · esc close</text>
        </box>
        <box flexDirection="row" alignItems="center">
          <text fg={routeComposer ? accentColor : theme.dim} wrapMode="none">
            {routeComposer ? '● composer → bridge' : '○ composer → provider'}
          </text>
          <box flexGrow={1} />
          <text fg={theme.dim} wrapMode="none">^R toggle composer routing</text>
        </box>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - 2}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
          {entries.length === 0 ? (
            <text fg={theme.dim} wrapMode="word" width={innerW}>
              Messages you send here land live in a `claude` CLI session running alongside agentViewer
              (start it with `claude --dangerously-load-development-channels server:agentviewer` from
              `channels/`). Replies and permission prompts stream back here.
            </text>
          ) : (
            entries.map((entry) => {
              if (entry.kind === 'sent' || entry.kind === 'reply') {
                const isSent = entry.kind === 'sent'
                return (
                  <box key={entry.id} flexDirection="row">
                    <text fg={isSent ? accentColor : theme.muted} wrapMode="none">
                      {isSent ? 'you  ' : 'cli  '}
                    </text>
                    <text fg={theme.text} wrapMode="word" width={innerW - 5}>{entry.text}</text>
                    {isSent ? (
                      <text fg={theme.dim} wrapMode="none">
                        {entry.delivery === 'processed' ? '  processed' : entry.delivery === 'accepted' ? '  accepted' : '  queued'}
                      </text>
                    ) : null}
                  </box>
                )
              }

              const pending = channelPermissionToPending(entry.request)
              const detail = pending.command ?? pending.reason ?? ''
              const status2 = entry.resolved
              return (
                <box key={entry.id} flexDirection="column" border borderStyle="single" borderColor={status2 ? accentColor : theme.border2} paddingX={1}>
                  <box flexDirection="row" alignItems="center">
                    <text fg={accentColor} wrapMode="none">{pending.title}</text>
                    <text fg={theme.dim} wrapMode="none"> wants approval</text>
                  </box>
                  <text fg={theme.muted} wrapMode="word" width={innerW - 4}>{pending.detail}</text>
                  {detail ? <text fg={theme.dim} wrapMode="word" width={innerW - 4}>{detail}</text> : null}
                  <text fg={status2 ? (status2 === 'allow' ? theme.green : theme.red) : theme.amber} wrapMode="none">
                    {status2
                      ? `${status2 === 'allow' ? 'allowed' : 'denied'} — answered from agentViewer`
                      : `pending — ^Y allow · ^N deny  (request ${entry.request.request_id}, also answerable from the CLI terminal)`}
                  </text>
                </box>
              )
            })
          )}
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.dim} wrapMode="none">{'> '}</text>
        <text fg={theme.text} wrapMode="word" width={innerW - 2}>{withCursor(draft)}</text>
      </box>
    </box>
  )
}

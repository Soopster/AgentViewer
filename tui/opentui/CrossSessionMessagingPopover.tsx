/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useState } from 'react'
import type { TuiThemePalette } from '../theme'
import { getProviderAccent } from '../theme'
import type { Session } from '../../lib/types'
import type { AddressableSession } from '../../lib/crossSessionMessaging'
import { listTuiAddressableSessions, sendTuiCrossSessionMessage } from '../../lib/tui/service'

type MessagingKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  currentSession: Session | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: MessagingKeyEvent) => boolean) => void
}

export function CrossSessionMessagingPopover({
  currentSession,
  theme,
  width,
  height,
  onClose,
  onNotice,
  onKeyHandlerReady,
}: Props) {
  const [sessions, setSessions] = useState<AddressableSession[]>([])
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [focus, setFocus] = useState<'sessions' | 'composer'>('sessions')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const selectedIndex = sessions.length === 0 ? 0 : Math.min(index, sessions.length - 1)
  const selected = sessions[selectedIndex] ?? null

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await listTuiAddressableSessions(currentSession?.sessionId)
      setSessions(next)
      setIndex((value) => Math.min(value, Math.max(next.length - 1, 0)))
    } catch (error) {
      onNotice('error', error instanceof Error ? error.message : 'Failed to list sessions')
    } finally {
      setLoading(false)
    }
  }, [currentSession?.sessionId, onNotice])

  useEffect(() => { void reload() }, [reload])

  const submit = useCallback(async () => {
    const text = draft.trim()
    if (!selected || !text || sending) return
    setSending(true)
    try {
      const fromName = currentSession?.customTitle?.trim()
        || currentSession?.summary?.trim()
        || (currentSession ? `session-${currentSession.sessionId.slice(0, 6)}` : 'Agent Viewer TUI')
      const result = await sendTuiCrossSessionMessage({
        fromSessionId: currentSession?.sessionId,
        fromName,
        toName: selected.name,
        text,
      })
      if (!result.delivered) throw new Error(result.error || 'Message was not delivered')
      setDraft('')
      setFocus('sessions')
      onNotice('info', result.mode === 'steered'
        ? `Delivered to ${result.targetName ?? selected.name}`
        : `Started a turn for ${result.targetName ?? selected.name}`)
      void reload()
    } catch (error) {
      onNotice('error', error instanceof Error ? error.message : 'Cross-session messaging failed')
    } finally {
      setSending(false)
    }
  }, [currentSession, draft, onNotice, reload, selected, sending])

  const handleKey = useCallback((key: MessagingKeyEvent): boolean => {
    if (focus === 'composer') {
      if (key.name === 'escape') {
        setFocus('sessions')
        return true
      }
      if (key.name === 'tab') {
        setFocus('sessions')
        return true
      }
      if (key.name === 'return') {
        void submit()
        return true
      }
      return false
    }
    if (key.name === 'escape' || key.name === 'q' || (key.name === 'm' && key.shift) || key.sequence === 'M') {
      onClose()
      return true
    }
    if (key.name === 'j' || key.name === 'down') {
      setIndex((value) => Math.min(value + 1, Math.max(sessions.length - 1, 0)))
      return true
    }
    if (key.name === 'k' || key.name === 'up') {
      setIndex((value) => Math.max(value - 1, 0))
      return true
    }
    if (key.name === 'r') {
      void reload()
      return true
    }
    if ((key.name === 'return' || key.name === 'tab') && selected) {
      setFocus('composer')
      return true
    }
    return true
  }, [focus, onClose, reload, selected, sessions.length, submit])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 96)
  const popH = Math.min(height - 4, 30)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4
  const listH = Math.max(popH - 10, 8)

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
      title=" Cross-session messaging "
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      <box height={2} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.text} wrapMode="none">{sessions.length} reachable</text>
        <text fg={theme.dim} wrapMode="none">{'  ·  running turns receive live steering'}</text>
        <box flexGrow={1} />
        <text fg={loading ? theme.amber : theme.dim} wrapMode="none">{loading ? 'refreshing…' : 'all providers'}</text>
      </box>

      <scrollbox
        width={popW - 2}
        height={listH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} flexDirection="column">
          {sessions.length === 0 ? (
            <box paddingTop={1}>
              <text fg={theme.dim} wrapMode="word" width={innerW}>
                {loading ? 'Discovering running and recently active sessions…' : 'No other sessions are reachable right now.'}
              </text>
            </box>
          ) : sessions.map((session, sessionIndex) => {
            const active = sessionIndex === selectedIndex
            return (
              <box key={`${session.provider}:${session.sessionId}`} height={2} paddingX={1} flexDirection="column" backgroundColor={active ? theme.surface3 : theme.surface}>
                <box flexDirection="row">
                  <text fg={active ? theme.cyan : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
                  <text fg={active ? theme.text : theme.muted} wrapMode="none">
                    {(session.title || session.name).slice(0, Math.max(innerW - 28, 14))}
                  </text>
                  <box flexGrow={1} />
                  <text fg={getProviderAccent(session.provider)} wrapMode="none">{session.provider.toUpperCase()}</text>
                  <text fg={session.running ? theme.green : theme.dim} wrapMode="none">{session.running ? '  ● RUNNING' : '  RECENT'}</text>
                </box>
                <text fg={active ? theme.violet : theme.dim} wrapMode="none">{`    ${session.name}`.slice(0, innerW)}</text>
              </box>
            )
          })}
        </box>
      </scrollbox>

      <box height={4} paddingX={1} paddingTop={1} border={['top']} borderStyle="single" borderColor={focus === 'composer' ? theme.cyan : theme.border} flexDirection="column">
        <box flexDirection="row">
          <text fg={theme.dim} wrapMode="none">to  </text>
          <text fg={selected ? theme.violet : theme.dim} wrapMode="none">{selected?.name ?? 'select a session'}</text>
        </box>
        <box flexDirection="row" alignItems="center">
          <text fg={focus === 'composer' ? theme.cyan : theme.dim} wrapMode="none">{'message  '}</text>
          <box flexGrow={1} backgroundColor={theme.surface2}>
            <input
              focused={focus === 'composer'}
              value={draft}
              maxLength={20_000}
              placeholder="Type a direct handoff…"
              onInput={(value: string) => setDraft(value)}
              onSubmit={() => { void submit() }}
            />
          </box>
        </box>
      </box>

      <box height={2} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={sending ? theme.amber : theme.dim} wrapMode="none">
          {sending ? 'Sending…' : focus === 'composer' ? 'enter send · esc targets' : 'j/k move · enter compose · r refresh · esc close'}
        </text>
      </box>
    </box>
  )
}

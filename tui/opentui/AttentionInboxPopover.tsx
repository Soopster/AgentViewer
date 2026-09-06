/** @jsxImportSource @opentui/react */
// Cross-session attention inbox: everything blocked on a human, in one list —
// tool permissions / AskUserQuestion / plan approvals from any running turn,
// plus Stop-hook background-work pauses, explicit viewer attention requests,
// and turns that finished while the user was elsewhere. Single-key triage:
// answer permissions inline, jump to a session, dismiss notes/completions.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TuiThemePalette } from '../theme'
import { getProviderAccent } from '../theme'
import type { AgentProvider } from '../../lib/types'
import type { PendingPermission } from '../../lib/permissions'

export type AttentionItemKind = 'permission' | 'question' | 'plan' | 'waiting' | 'viewer-note' | 'turn-done'

export type AttentionItem = {
  key: string
  kind: AttentionItemKind
  sessionId: string
  provider: AgentProvider
  sessionKey: string
  sessionTitle: string
  title: string
  detail?: string
  attentionId?: string
  // Present for prompt kinds; carries the id the respond action resolves.
  permission?: PendingPermission
  // 0 for prompt kinds (arrival time is not tracked); epoch ms for turn-done.
  createdAt: number
}

type AttentionKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  items: AttentionItem[]
  theme: TuiThemePalette
  width: number
  height: number
  respondingId: string | null
  onRespond: (item: AttentionItem, response: 'once' | 'reject') => void
  onOpenSession: (item: AttentionItem) => void
  onDismiss: (item: AttentionItem) => void
  onClose: () => void
  onKeyHandlerReady: (handler: (key: AttentionKeyEvent) => void) => void
}

const KIND_GLYPH: Record<AttentionItemKind, string> = {
  permission: '●',
  question: '?',
  plan: '◆',
  waiting: '◌',
  'viewer-note': '!',
  'turn-done': '✓',
}

export function attentionItemNeedsInput(item: AttentionItem): boolean {
  return item.kind === 'permission' || item.kind === 'question' || item.kind === 'plan' || item.kind === 'viewer-note'
}

function kindColor(kind: AttentionItemKind, theme: TuiThemePalette): string {
  switch (kind) {
    case 'permission': return theme.amber
    case 'question': return theme.cyan
    case 'plan': return theme.violet
    case 'waiting': return theme.cyan
    case 'viewer-note': return theme.amber
    case 'turn-done': return theme.green
  }
}

function kindLabel(kind: AttentionItemKind): string {
  switch (kind) {
    case 'permission': return 'needs approval'
    case 'question': return 'has a question'
    case 'plan': return 'plan ready'
    case 'waiting': return 'background work pending'
    case 'viewer-note': return 'requested attention'
    case 'turn-done': return 'turn finished'
  }
}

function formatAge(createdAt: number, now: number): string {
  if (createdAt <= 0) return ''
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

export function AttentionInboxPopover({
  items,
  theme,
  width,
  height,
  respondingId,
  onRespond,
  onOpenSession,
  onDismiss,
  onClose,
  onKeyHandlerReady,
}: Props) {
  const [index, setIndex] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const clampedIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1)
  const selected = items[clampedIndex] ?? null

  // Keep ages fresh while open — coarse tick, the list itself re-renders on
  // registry-poll changes anyway.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  const needsInputCount = useMemo(
    () => items.filter(attentionItemNeedsInput).length,
    [items],
  )

  const handleKey = useCallback((key: AttentionKeyEvent) => {
    if (key.name === 'escape' || key.name === 'q' || key.sequence === '!') {
      onClose()
      return
    }
    if (items.length === 0) return
    if (key.name === 'j' || key.name === 'down') {
      setIndex((current) => Math.min(current + 1, items.length - 1))
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      setIndex((current) => Math.max(current - 1, 0))
      return
    }
    const item = items[Math.min(index, items.length - 1)]
    if (!item) return
    if (key.name === 'return') {
      onOpenSession(item)
      return
    }
    if (key.name === 'y' && item.kind === 'permission' && !respondingId) {
      onRespond(item, 'once')
      return
    }
    if (key.name === 'n' && item.kind === 'permission' && !respondingId) {
      onRespond(item, 'reject')
      return
    }
    if (key.name === 'x' && (item.kind === 'turn-done' || item.kind === 'viewer-note')) {
      onDismiss(item)
      return
    }
  }, [index, items, onClose, onDismiss, onOpenSession, onRespond, respondingId])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 92)
  const popH = Math.min(height - 4, 30)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4
  const headerH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - 2, 6)

  const footerHint = selected?.kind === 'permission'
    ? '⏎ open session · y allow · n deny · j/k move · esc close'
    : selected?.kind === 'turn-done' || selected?.kind === 'viewer-note'
    ? '⏎ open session · x dismiss · j/k move · esc close'
    : '⏎ open session · j/k move · esc close'

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
      title=" Attention inbox "
      titleColor={theme.amber}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={needsInputCount > 0 ? theme.amber : theme.dim} wrapMode="none">
          {needsInputCount > 0 ? `${needsInputCount} need${needsInputCount === 1 ? 's' : ''} input` : 'nothing needs input'}
        </text>
        <text fg={theme.dim} wrapMode="none">
          {`  ·  ${items.length - needsInputCount} waiting or finished`}
        </text>
        <box flexGrow={1} />
        <text fg={theme.dim} wrapMode="none">across all sessions</text>
      </box>

      <scrollbox
        width={popW - 2}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} flexDirection="column">
          {items.length === 0 ? (
            <box paddingTop={1}>
              <text fg={theme.dim} wrapMode="word" width={innerW}>
                All clear. Pending tool approvals, questions, plan reviews, and finished
                background turns from every session will land here.
              </text>
            </box>
          ) : (
            items.map((item, itemIndex) => {
              const isSelected = itemIndex === clampedIndex
              const accent = kindColor(item.kind, theme)
              const age = formatAge(item.createdAt, now)
              const responding = Boolean(item.permission && respondingId === item.permission.id)
              return (
                <box
                  key={item.key}
                  flexDirection="column"
                  paddingX={1}
                  backgroundColor={isSelected ? theme.surface3 : theme.surface}
                >
                  <box flexDirection="row" alignItems="center">
                    <text fg={isSelected ? accent : theme.dim} wrapMode="none">{isSelected ? '▸ ' : '  '}</text>
                    <text fg={accent} wrapMode="none">{`${KIND_GLYPH[item.kind]} `}</text>
                    <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">
                      {item.sessionTitle.slice(0, Math.max(innerW - 34, 12))}
                    </text>
                    <text fg={theme.dim} wrapMode="none">{`  ${kindLabel(item.kind)}`}</text>
                    <box flexGrow={1} />
                    <text fg={getProviderAccent(item.provider)} wrapMode="none">{String(item.provider).toUpperCase()}</text>
                    {age ? <text fg={theme.dim} wrapMode="none">{`  ${age}`}</text> : null}
                  </box>
                  {item.kind !== 'turn-done' ? (
                    <box flexDirection="row">
                      <text fg={theme.dim} wrapMode="none">{'      '}</text>
                      <text fg={responding ? theme.dim : theme.muted} wrapMode="none">
                        {(responding ? 'answering… ' : '') + `${item.title}${item.detail ? ` — ${item.detail}` : ''}`.slice(0, Math.max(innerW - 8, 12))}
                      </text>
                    </box>
                  ) : null}
                </box>
              )
            })
          )}
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.dim} wrapMode="none">{footerHint}</text>
      </box>
    </box>
  )
}

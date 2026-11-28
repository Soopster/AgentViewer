/** @jsxImportSource @opentui/react */
import React from 'react'
import { PR_ACTION_LABELS, resolvePrNextAction, summarizePrStatus } from '../../../lib/github/prWork'
import type { GithubPrDetail } from '../../../lib/github/types'
import type { Session } from '../../../lib/types'
import type { TuiThemePalette } from '../../theme'
import { usePrWatching } from '../prWatchStore'
import { useSessionPr } from '../sessionPrStore'
import { fitText } from '../textLayout'
import { PR_STATE_GLYPH } from './SessionRailDetail'

export type SessionPrIntent = 'open' | 'act' | 'watch'
type Handler = (session: Session, intent: SessionPrIntent, detail: GithubPrDetail | null) => void

let handler: Handler | null = null
/** The root's answer to a click. Registered rather than passed down: every window is memoized, and a new prop each render would re-render them all. */
export function registerSessionPrHandler(next: Handler): () => void {
  handler = next
  return () => { if (handler === next) handler = null }
}

/**
 * The linked pull request in a window's bottom border, where it costs no
 * transcript row: where it stands, and the next thing to do to it.
 */
export const SessionPrStrip = React.memo(function SessionPrStrip({ session, theme, width, windowId }: { session: Session; theme: TuiThemePalette; width: number; windowId: string }) {
  const pr = session.inbox?.linkedPr
  const cwd = pr?.cwd ?? (typeof session.cwd === 'string' ? session.cwd : '')
  const { detail, error } = useSessionPr(cwd, pr)
  const watching = usePrWatching(session)
  if (!pr || width < 24) return null
  const status = detail ? summarizePrStatus(detail) : null
  const next = detail ? resolvePrNextAction(detail) : null
  const color = !status ? theme.dim : status.tone === 'danger' ? theme.red : status.tone === 'warning' ? theme.amber : status.tone === 'success' ? theme.green : status.tone === 'merged' ? theme.violet : theme.cyan
  const action = next ? ` ▸ ${PR_ACTION_LABELS[next]} ` : ''
  const watch = watching ? ' ◉ watching ' : detail?.state === 'OPEN' && width >= 64 ? ' ○ watch ' : ''
  const room = width - action.length - watch.length
  const text = ` ${PR_STATE_GLYPH} #${pr.number}${status ? ` ${status.parts.join(' · ')}` : error ? ` ${error}` : ''} `
  return (
    <box position="absolute" bottom={-1} right={1} height={1} flexDirection="row" backgroundColor={theme.surface} zIndex={3}>
      <box id={`${windowId}-pr`} height={1} onMouseDown={event => { if (event.button !== 0) return; handler?.(session, 'open', detail) }}>
        <text fg={color} wrapMode="none" selectable={false}>{text.length > room ? `${fitText(text, Math.max(room - 1, 8)).trimEnd()} ` : text}</text>
      </box>
      {watch ? (
        <box id={`${windowId}-pr-watch`} height={1} onMouseDown={event => { if (event.button !== 0) return; handler?.(session, 'watch', detail) }}>
          <text fg={watching ? theme.cyan : theme.dim} wrapMode="none" selectable={false}>{watch}</text>
        </box>
      ) : null}
      {action ? (
        <box id={`${windowId}-pr-action`} height={1} onMouseDown={event => { if (event.button !== 0) return; handler?.(session, 'act', detail) }}>
          <text fg={theme.cyan} wrapMode="none" selectable={false}>{action}</text>
        </box>
      ) : null}
    </box>
  )
})

/** @jsxImportSource @opentui/react */
import React from 'react'
import type { TuiThemePalette } from '../theme'
import { formatSessionTitle } from '../format'
import type { Session } from '../../lib/types'
import { fitText } from './textLayout'
import { sessionIdentityKey } from './sessionIdentity'

export const PINNED_CHIP_MAX_WIDTH = 26

/** Chip widths for `count` pinned tabs sharing `width` cells (one cell between chips), or null when even
 * the narrowest chip will not fit — the row then shows what fits and a `+N` for the rest. */
export function pinnedChipLayout(count: number, width: number): { chipWidth: number; shown: number } {
  const minimum = 8
  const shown = Math.max(Math.min(count, Math.floor((width + 1) / (minimum + 1))), count > 0 ? 1 : 0)
  if (shown === 0) return { chipWidth: 0, shown: 0 }
  const reserve = shown < count ? 4 : 0
  const chipWidth = Math.max(Math.min(Math.floor((width - reserve + 1) / shown) - 1, PINNED_CHIP_MAX_WIDTH), minimum)
  return { chipWidth, shown }
}

type Props = {
  sessions: readonly Session[]
  selectedKey: string | null
  running: ReadonlySet<string>
  theme: TuiThemePalette
  width: number
  onSelect: (session: Session) => void
  onMenu: (session: Session, point: { x: number; y: number }) => void
  onPress: (session: Session, event: { x: number; y: number }, onClick: () => void) => void
  onMove: (event: { x: number; y: number }) => void
  onRelease: (event: { x: number; y: number }) => void
}

/** The dedicated row for pinned tabs: one chip each, `◆ title`, no close button — a pinned tab is closed by unpinning it. */
export const PinnedTabRow = React.memo(function PinnedTabRow({ sessions, selectedKey, running, theme, width, onSelect, onMenu, onPress, onMove, onRelease }: Props) {
  const { chipWidth, shown } = pinnedChipLayout(sessions.length, width)
  return (
    <box id="pinned-tab-row" flexDirection="row" height={1} flexShrink={0} paddingX={1} overflow="hidden" backgroundColor={theme.bg}>
      {sessions.slice(0, shown).map((session) => {
        const key = sessionIdentityKey(session)
        const selected = key === selectedKey
        return (
          <box
            key={key}
            id={`pinned-tab:${key}`}
            width={chipWidth}
            marginRight={1}
            backgroundColor={selected ? theme.surface : theme.bg}
            onMouseDown={(event) => {
              if (event.button === 2) { event.stopPropagation(); onMenu(session, event); return }
              if (event.button !== 0) return
              event.stopPropagation()
              onPress(session, event, () => onSelect(session))
            }}
            onMouseDrag={(event) => onMove(event)}
            onMouseUp={(event) => { if (event.button === 0) onRelease(event) }}
          >
            <text fg={selected ? theme.cyan : theme.muted} wrapMode="none" selectable={false}>
              {fitText(`◆ ${running.has(key) ? '● ' : ''}${formatSessionTitle(session)}`, chipWidth)}
            </text>
          </box>
        )
      })}
      {shown < sessions.length ? <text fg={theme.dim} wrapMode="none" selectable={false}>{`+${sessions.length - shown}`}</text> : null}
    </box>
  )
})

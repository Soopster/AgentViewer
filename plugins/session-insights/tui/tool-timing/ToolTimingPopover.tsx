/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../../tui/opentui/shell/sdk'
import { formatDurationMs, SLOW_TOOL_MS, type TuiTranscriptCard } from '../../../../tui/format'
import { durationBar, timedTurns } from './model'

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  cards: readonly TuiTranscriptCard[] | null
  loading: boolean
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
  docked?: boolean
}

const BAR_CELLS = 14

export function ToolTimingPopover({ theme, width, height, cards, loading, onClose, onDetach, onKeyHandlerReady, docked = false }: Props) {
  const turns = useMemo(() => (cards ? timedTurns(cards) : []), [cards])
  const rows = useMemo(() => turns.flatMap((turn) => [
    { key: `t:${turn.key}`, turn, call: null as null | { label: string; durationMs: number } },
    ...turn.calls.map((call, index) => ({ key: `c:${turn.key}:${index}`, turn, call })),
  ]), [turns])
  const [top, setTop] = useState(0)

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 110)
  const popH = docked ? height : Math.min(height - 4, 30)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = Math.max(popW - frame - 2, 24)
  const listRows = Math.max(popH - frame - 3, 3)
  const maxTop = Math.max(rows.length - listRows, 0)
  const clip = (text: string, limit = innerW) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'down' || key.sequence === 'j') setTop((value) => Math.min(value + 1, maxTop))
    else if (key.name === 'up' || key.sequence === 'k') setTop((value) => Math.max(value - 1, 0))
    else if (key.name === 'pagedown') setTop((value) => Math.min(value + listRows, maxTop))
    else if (key.name === 'pageup') setTop((value) => Math.max(value - listRows, 0))
    else if (key.sequence === 'g') setTop(0)
    else if (key.sequence === 'G') setTop(maxTop)
  }, [listRows, maxTop, onClose])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const slowest = turns.reduce((max, turn) => Math.max(max, turn.maxMs), 0)
  const summary = loading && !cards ? 'Reading transcript…'
    : rows.length === 0 ? 'No timed tool calls in this session'
    : `${turns.reduce((sum, turn) => sum + turn.calls.length, 0)} timed calls · slowest ${formatDurationMs(slowest)} · ${formatDurationMs(turns.reduce((sum, turn) => sum + turn.totalMs, 0))} total`

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, 50)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Tool timing '}
      titleAlignment="left"
      paddingX={1}
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <text fg={theme.muted} wrapMode="none">{clip(summary)}</text>
      <box flexDirection="column" height={listRows}>
        {rows.slice(top, top + listRows).map((row) => row.call ? (
          <text key={row.key} fg={row.call.durationMs >= SLOW_TOOL_MS ? theme.amber : theme.text} wrapMode="none">
            {clip(`  ${durationBar(row.call.durationMs, row.turn.maxMs, BAR_CELLS)} ${formatDurationMs(row.call.durationMs).padStart(6)}  ${row.call.label}`)}
          </text>
        ) : (
          <text key={row.key} fg={theme.cyan} wrapMode="none">
            {clip(`${row.turn.title}  ·  ${row.turn.calls.length} call${row.turn.calls.length === 1 ? '' : 's'}  ${formatDurationMs(row.turn.totalMs)}`)}
          </text>
        ))}
      </box>
      <box flexGrow={1} />
      <text fg={theme.dim} wrapMode="none">{clip('j/k scroll · g/G ends · amber = 30s or more · esc close')}</text>
    </box>
  )
}

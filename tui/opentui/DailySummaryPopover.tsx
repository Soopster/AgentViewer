/** @jsxImportSource @opentui/react */
// Daily summary: what every agent did today, yesterday or this week, grouped by
// repository — the prompts, files, commits and pull requests, and what is still
// waiting on the user. It renders the same markdown it copies, so what is on
// screen is exactly what lands in a standup or a chat.
import { PopoverDetachButton, popoverFrameCells, popoverRootProps } from './dockedPopover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import {
  DAILY_SUMMARY_RANGES,
  formatDailySummaryMarkdown,
  type DailySummary,
  type DailySummaryRange,
  type DailySummaryWaitingInput,
} from '../../lib/dailySummary'
import { readTuiDailySummary } from '../../lib/tui/service'
import { MODAL_CONTENT_Z_INDEX } from './layers'

type DailySummaryKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  /** What the attention inbox holds now; the summary files each under its session's repository. */
  waiting: DailySummaryWaitingInput[]
  initialRange?: DailySummaryRange
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: DailySummaryKeyEvent) => void) => void
  /** Fill the given box inside a window, with no frame of its own. */
  docked?: boolean
  /** Shows the `⧉ window` button: break the popover out into a window. */
  onDetach?: () => void
  onCopy: (text: string) => void
  onSendToComposer?: (text: string) => void
  /** Test seam: skip `gh`. */
  skipPullRequests?: boolean
}

const RANGE_KEYS: Record<string, DailySummaryRange> = { t: 'today', y: 'yesterday', w: 'week' }
const RANGE_LABELS: Record<DailySummaryRange, string> = { today: 'today', yesterday: 'yesterday', week: 'this week' }

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`
}

/** A markdown line's role, which is all the colouring needs. */
export function dailySummaryLineTone(line: string): 'title' | 'repo' | 'heading' | 'waiting' | 'prompt' | 'item' | 'note' | 'plain' {
  if (line.startsWith('# ')) return 'title'
  if (line.startsWith('## ')) return 'repo'
  if (line === '**Waiting on you**' || /^\*\*\d+ waiting on you\*\*$/.test(line)) return 'waiting'
  if (line.startsWith('**')) return 'heading'
  if (line.startsWith('  - ')) return 'prompt'
  if (line.startsWith('- ')) return 'item'
  if (line.startsWith('_') && line.endsWith('_')) return 'note'
  return 'plain'
}

export function DailySummaryPopover({
  theme,
  accentColor,
  width,
  height,
  waiting,
  initialRange = 'today',
  onClose,
  onNotice,
  onKeyHandlerReady,
  onCopy,
  onSendToComposer,
  skipPullRequests,
  docked = false,
  onDetach,
}: Props) {
  const [range, setRange] = useState<DailySummaryRange>(initialRange)
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  // The inbox changes while the summary is open; the read uses what it held at the ask.
  const waitingRef = useRef(waiting)
  waitingRef.current = waiting

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    readTuiDailySummary({ range, waiting: waitingRef.current, skipPullRequests })
      .then((next) => {
        if (cancelled) return
        setSummary(next)
        if (scrollRef.current) scrollRef.current.scrollTop = 0
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the summary') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range, reloadToken, skipPullRequests])

  const markdown = useMemo(() => (summary ? formatDailySummaryMarkdown(summary) : ''), [summary])
  const lines = useMemo(() => markdown.replace(/\n$/, '').split('\n'), [markdown])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 120)
  const popH = docked ? height : Math.min(height - 2, 46)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = popW - frame - 2
  const headerH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - frame, 4)

  const scrollBody = useCallback((delta: number) => {
    const box = scrollRef.current
    if (!box) return
    box.scrollTop = Math.max(0, Math.min(box.scrollTop + delta, Math.max(box.scrollHeight - bodyH, 0)))
  }, [bodyH])

  const handleKey = useCallback((key: DailySummaryKeyEvent) => {
    if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
    const direct = RANGE_KEYS[key.sequence]
    if (direct) { setRange(direct); return }
    if (key.name === 'tab' || key.name === 'right' || key.name === 'left') {
      const step = key.shift || key.name === 'left' ? -1 : 1
      setRange((current) => DAILY_SUMMARY_RANGES[(DAILY_SUMMARY_RANGES.indexOf(current) + step + DAILY_SUMMARY_RANGES.length) % DAILY_SUMMARY_RANGES.length]!)
      return
    }
    if (key.name === 'j' || key.name === 'down') { scrollBody(1); return }
    if (key.name === 'k' || key.name === 'up') { scrollBody(-1); return }
    if (key.name === 'pagedown' || key.name === 'space' || (key.ctrl && key.name === 'd')) { scrollBody(bodyH); return }
    if (key.name === 'pageup' || (key.ctrl && key.name === 'u')) { scrollBody(-bodyH); return }
    if (key.sequence === 'g' || key.name === 'home') { scrollBody(-Number.MAX_SAFE_INTEGER); return }
    if (key.sequence === 'G' || key.name === 'end') { scrollBody(Number.MAX_SAFE_INTEGER); return }
    if (key.sequence === 'r') { setReloadToken((token) => token + 1); return }
    if (!summary) return
    if (key.sequence === 'c') {
      onCopy(markdown)
      onNotice('info', `Copied the summary for ${RANGE_LABELS[range]}`, 3000)
      return
    }
    if (key.sequence === 'a' && onSendToComposer) {
      onSendToComposer(`Turn this record of my agents' work into a short status update: what got done, what is in progress, and what is blocked on me. Keep it factual and do not invent work that is not listed.\n\n${markdown}`)
      return
    }
  }, [bodyH, markdown, onClose, onCopy, onNotice, onSendToComposer, range, scrollBody, summary])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const toneColor = (tone: ReturnType<typeof dailySummaryLineTone>): string => {
    switch (tone) {
      case 'title': return accentColor
      case 'repo': return theme.cyan
      case 'waiting': return theme.amber
      case 'heading': return theme.muted
      case 'prompt': return theme.muted
      case 'item': return theme.text
      case 'note': return theme.dim
      default: return theme.dim
    }
  }

  const footer = `t/y/w or Tab range · j/k scroll · c copy markdown${onSendToComposer ? ' · a draft a status update' : ''} · r refresh · Esc close`

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      // borderStyle alone turns a border on, so a docked popover passes none.
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Daily summary '}
      titleColor={accentColor}
      titleAlignment="left"
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row">
        <text wrapMode="none">
          {DAILY_SUMMARY_RANGES.map((entry, index) => (
            <span key={entry} fg={entry === range ? accentColor : theme.dim}>
              {`${index > 0 ? '   ' : ''}${entry === range ? '● ' : '○ '}${RANGE_LABELS[entry]}`}
            </span>
          ))}
          <span fg={theme.dim}>{loading ? '   reading…' : ''}</span>
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - frame}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} flexDirection="column">
          {error ? (
            <text fg={theme.red} wrapMode="word" width={innerW}>{error}</text>
          ) : !summary ? (
            <text fg={theme.dim}>Reading sessions, commits and pull requests…</text>
          ) : (
            // One text for the whole document: a summary of a busy week runs to
            // hundreds of lines, and a renderable per line is what that would cost.
            <text wrapMode="none">
              {lines.map((line, index) => (
                <span key={index} fg={toneColor(dailySummaryLineTone(line))}>
                  {`${fit(line.replace(/^\*\*(.*)\*\*$/, '$1').replace(/^_(.*)_$/, '$1'), innerW) || ' '}${index < lines.length - 1 ? '\n' : ''}`}
                </span>
              ))}
            </text>
          )}
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.dim} wrapMode="none">{fit(footer, innerW)}</text>
      </box>
    </box>
  )
}

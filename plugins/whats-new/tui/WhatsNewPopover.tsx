/** @jsxImportSource @opentui/react */
// What's new: the highlights of the repository's history, revision by revision.
// It renders the same markdown it copies, so what is on screen is what lands in
// release notes or a chat.
import { MODAL_CONTENT_Z_INDEX, PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { formatWhatsNewMarkdown, whatsNewLineTone, type WhatsNew, type WhatsNewLineTone } from '../../../lib/whatsNew'

type KeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  read: (options?: { cwd?: string; limit?: number }, signal?: AbortSignal) => Promise<WhatsNew>
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: KeyEvent) => void) => void
  docked?: boolean
  onDetach?: () => void
  onCopy?: (text: string) => void
}

/** Revisions asked for first, and added on each `m`. */
const PAGE = 14

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`
}

export function WhatsNewPopover({ theme, accentColor, width, height, read, onClose, onNotice, onKeyHandlerReady, onCopy, docked = false, onDetach }: Props) {
  const [limit, setLimit] = useState(PAGE)
  const [summary, setSummary] = useState<WhatsNew | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    readRef.current({ limit }, controller.signal)
      .then((next) => { if (!cancelled) setSummary(next) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the history') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [limit, reloadToken])

  const markdown = useMemo(() => (summary ? formatWhatsNewMarkdown(summary) : ''), [summary])
  const lines = useMemo(() => markdown.replace(/\n$/, '').split('\n'), [markdown])
  const canLoadMore = Boolean(summary?.truncated) && summary!.revisions.length >= limit

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

  const handleKey = useCallback((key: KeyEvent) => {
    if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
    if (key.name === 'j' || key.name === 'down') { scrollBody(1); return }
    if (key.name === 'k' || key.name === 'up') { scrollBody(-1); return }
    if (key.name === 'pagedown' || key.name === 'space' || (key.ctrl && key.name === 'd')) { scrollBody(bodyH); return }
    if (key.name === 'pageup' || (key.ctrl && key.name === 'u')) { scrollBody(-bodyH); return }
    if (key.sequence === 'g' || key.name === 'home') { scrollBody(-Number.MAX_SAFE_INTEGER); return }
    if (key.sequence === 'G' || key.name === 'end') { scrollBody(Number.MAX_SAFE_INTEGER); return }
    if (key.sequence === 'r') { setReloadToken((token) => token + 1); return }
    if (key.sequence === 'm' && canLoadMore) { setLimit((current) => current + PAGE); return }
    if (key.sequence === 'c' && onCopy && markdown) {
      onCopy(markdown)
      onNotice('info', "Copied what's new as markdown", 3000)
    }
  }, [bodyH, canLoadMore, markdown, onClose, onCopy, onNotice, scrollBody])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const toneColor = (tone: WhatsNewLineTone): string => {
    switch (tone) {
      case 'title': return accentColor
      case 'revision': return theme.cyan
      case 'stats': return theme.muted
      case 'item': return theme.text
      case 'detail': return theme.muted
      default: return theme.dim
    }
  }

  const footer = `j/k scroll${canLoadMore ? ' · m older revisions' : ''}${onCopy ? ' · c copy markdown' : ''} · r refresh · Esc close`
  const header = summary
    ? `${summary.revisions.length} ${summary.grouping === 'release' ? 'releases' : 'days'} · ${summary.scanned} commits read${loading ? '   reading…' : ''}`
    : 'reading…'

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      // borderStyle alone turns a border on, so a docked popover passes none.
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : " What's new "}
      titleColor={accentColor}
      titleAlignment="left"
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row">
        <text fg={theme.dim} wrapMode="none">{fit(header, innerW)}</text>
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
            <text fg={theme.dim}>Reading the git history…</text>
          ) : (
            // One text for the whole document, as the daily summary does.
            <text wrapMode="none">
              {lines.map((line, index) => (
                <span key={index} fg={toneColor(whatsNewLineTone(line))}>
                  {`${fit(line.replace(/^#+ /, '').replace(/\*\*([^*]*)\*\*/g, '$1').replace(/^_(.*)_$/, '$1').replace(/^- _(.*)_$/, '  $1').replace(/^- /, '• '), innerW) || ' '}${index < lines.length - 1 ? '\n' : ''}`}
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

/** @jsxImportSource @opentui/react */
// What's new: the highlights of the repository's history, revision by revision,
// and the files each change touched. Revisions and their highlights are the list;
// the selected one is the detail, with the files it changed. Narrow panels show
// one pane at a time with a way back.
import { MODAL_CONTENT_Z_INDEX, PopoverDetachButton, ShortcutHelp, popoverFrameCells, popoverRootProps, type ShortcutHelpGroup, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { WhatsNew, WhatsNewKind } from '../../../lib/whatsNew'
import { formatWhatsNewMarkdown } from '../../../lib/whatsNew'
import { reconcileWhatsNewSelection, splitWhatsNewPath, whatsNewDetail, whatsNewRows } from '../../../lib/whatsNewView'

type KeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }
type Pane = 'list' | 'detail'

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  read: (options?: { cwd?: string; limit?: number }, signal?: AbortSignal) => Promise<WhatsNew>
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: KeyEvent) => boolean | void) => void
  docked?: boolean
  onDetach?: () => void
  onCopy?: (text: string) => void
}

const PAGE = 14
const ROW_HEIGHT = 2
/** Below this many inner columns the list and the detail take turns. */
const WIDE_MIN = 84
const HELP: ShortcutHelpGroup[] = [
  { title: 'Navigate', rows: [['j / k, ↑ / ↓', 'Move through revisions and highlights (or scroll the detail when it has focus)'], ['Tab / Shift+Tab', 'Move focus between the list and the detail'], ['Enter', 'Open the selected item (narrow panels show one pane at a time)'], ['Esc', 'Back to the list, then close'], ['g / G', 'First / last row']] },
  { title: 'Detail', rows: [['PgUp / PgDn, Space', 'Scroll the files changed'], ['c', 'Copy the selected item as markdown'], ['C', 'Copy every revision as markdown']] },
  { title: 'Collection', rows: [['m', 'Load older revisions'], ['r', 'Refresh the history']] },
]
const KIND_GLYPH: Record<WhatsNewKind, string> = { feature: '+', improvement: '↑', fix: '✓', chore: '·' }

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('list')
  const [help, setHelp] = useState(false)
  const listRef = useRef<ScrollBoxRenderable | null>(null)
  const detailRef = useRef<ScrollBoxRenderable | null>(null)
  const helpRef = useRef<ScrollBoxRenderable | null>(null)
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

  const rows = useMemo(() => (summary ? whatsNewRows(summary) : []), [summary])
  // A refresh keeps the selected row when it survives, so reading is not lost.
  const activeKey = reconcileWhatsNewSelection(rows, selectedKey)
  const detail = useMemo(() => (summary && activeKey ? whatsNewDetail(summary, activeKey) : null), [summary, activeKey])
  const canLoadMore = Boolean(summary?.truncated) && (summary?.revisions.length ?? 0) >= limit

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 132)
  const popH = docked ? height : Math.min(height - 2, 46)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = popW - frame - 2
  const bodyH = Math.max(popH - frame - 2, 4)
  const wide = innerW >= WIDE_MIN
  const listW = wide ? Math.min(Math.max(Math.floor(innerW * 0.4), 34), 54) : innerW
  const detailW = wide ? innerW - listW - 1 : innerW
  const showList = wide || pane === 'list'
  const showDetail = wide || pane === 'detail'

  const selectRow = useCallback((key: string) => {
    setSelectedKey(key)
    if (detailRef.current) detailRef.current.scrollTop = 0
  }, [])

  // Keyboard selection scrolls into view; rows are a fixed two lines tall.
  useEffect(() => {
    const box = listRef.current
    const index = rows.findIndex((row) => row.key === activeKey)
    if (!box || index < 0) return
    const top = index * ROW_HEIGHT
    const viewport = Math.max(bodyH - 1, ROW_HEIGHT)
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + ROW_HEIGHT > box.scrollTop + viewport) box.scrollTop = top + ROW_HEIGHT - viewport
  }, [activeKey, rows, bodyH])

  const scrollDetail = useCallback((delta: number) => {
    const box = detailRef.current
    if (!box) return
    box.scrollTop = Math.max(0, Math.min(box.scrollTop + delta, Math.max(box.scrollHeight - bodyH, 0)))
  }, [bodyH])

  const handleKey = useCallback((key: KeyEvent) => {
    if (help) {
      if (key.name === 'escape' || key.sequence === '?' || key.sequence === 'q') setHelp(false)
      else if (key.name === 'j' || key.name === 'down') helpRef.current?.scrollBy(1)
      else if (key.name === 'k' || key.name === 'up') helpRef.current?.scrollBy(-1)
      return true
    }
    if (key.sequence === '?') { setHelp(true); return true }
    if (key.name === 'escape' || key.sequence === 'q') {
      if (!wide && pane === 'detail') setPane('list')
      else onClose()
      return true
    }
    if (key.name === 'tab') { setPane((current) => (current === 'list' ? 'detail' : 'list')); return true }
    if (key.name === 'return') { setPane('detail'); return true }
    const move = (delta: number) => {
      const index = Math.max(rows.findIndex((row) => row.key === activeKey), 0)
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]
      if (next) selectRow(next.key)
    }
    const down = key.name === 'j' || key.name === 'down'
    const up = key.name === 'k' || key.name === 'up'
    if (down || up) {
      if (pane === 'detail') scrollDetail(down ? 1 : -1)
      else move(down ? 1 : -1)
      return true
    }
    if (key.name === 'pagedown' || key.name === 'space' || (key.ctrl && key.name === 'd')) { scrollDetail(bodyH); return true }
    if (key.name === 'pageup' || (key.ctrl && key.name === 'u')) { scrollDetail(-bodyH); return true }
    if (key.sequence === 'g' || key.name === 'home') { const first = rows[0]; if (first) selectRow(first.key); return true }
    if (key.sequence === 'G' || key.name === 'end') { const last = rows[rows.length - 1]; if (last) selectRow(last.key); return true }
    if (key.sequence === 'r') { setReloadToken((token) => token + 1); return true }
    if (key.sequence === 'm' && canLoadMore) { setLimit((current) => current + PAGE); return true }
    if (key.sequence === 'c' && onCopy && detail) { onCopy(detail.markdown); onNotice('info', 'Copied the selected change as markdown', 3000); return true }
    if (key.sequence === 'C' && onCopy && summary) { onCopy(formatWhatsNewMarkdown(summary)); onNotice('info', "Copied what's new as markdown", 3000); return true }
    return false
  }, [activeKey, bodyH, canLoadMore, detail, help, onClose, onCopy, onNotice, pane, rows, scrollDetail, selectRow, summary, wide])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const kindColor = (kind: WhatsNewKind | null): string => {
    switch (kind) {
      case 'feature': return accentColor
      case 'improvement': return theme.cyan
      case 'fix': return theme.amber
      default: return theme.dim
    }
  }

  const header = summary
    ? `${summary.revisions.length} ${summary.grouping === 'release' ? 'releases' : 'days'} · ${summary.scanned} commits read${summary.truncated ? ' · older history not shown' : ''}${loading ? ' · reading…' : ''}`
    : loading ? 'reading the git history…' : ''
  const footer = !wide && pane === 'detail'
    ? 'Esc back to the list · j/k scroll · c copy · ? help'
    : `j/k select · ${wide ? 'Tab pane' : 'Enter open'}${canLoadMore ? ' · m older' : ''} · c copy · r refresh · ? help · Esc close`

  const largest = detail ? Math.max(...detail.files.map((file) => file.added + file.removed), 1) : 1
  const numberWidth = detail ? String(largest).length + 1 : 0

  const listPane = (
    <box width={listW} height={bodyH} flexDirection="column" flexShrink={0} onMouseDown={() => setPane('list')}>
      <scrollbox ref={listRef} flexGrow={1} minHeight={0} scrollY scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}>
        {rows.map((row) => {
          const selected = row.key === activeKey
          const marker = selected ? '▌' : ' '
          const fg = selected && pane === 'list' ? theme.text : selected ? theme.text : row.type === 'revision' ? theme.cyan : theme.text
          return (
            <box key={row.key} height={ROW_HEIGHT} flexDirection="column" flexShrink={0} backgroundColor={selected ? theme.surface2 : undefined}
              onMouseDown={() => { selectRow(row.key); setPane(wide ? 'list' : 'detail') }}>
              <text fg={fg} wrapMode="none">
                <span fg={selected ? accentColor : theme.dim}>{marker}</span>
                {row.type === 'highlight' ? <span fg={kindColor(row.kind)}>{`  ${KIND_GLYPH[row.kind ?? 'chore']} `}</span> : <span fg={theme.dim}>{' '}</span>}
                {fit(row.label, listW - (row.type === 'highlight' ? 5 : 2))}
              </text>
              <text fg={theme.dim} wrapMode="none">{fit(`${row.type === 'highlight' ? '     ' : '  '}${row.meta}`, listW - 1)}</text>
            </box>
          )
        })}
      </scrollbox>
    </box>
  )

  const detailPane = (
    <box width={detailW} height={bodyH} flexDirection="column" flexShrink={0} onMouseDown={() => setPane('detail')}>
      {!detail ? (
        <text fg={theme.dim} wrapMode="word" width={detailW}>
          {error ? '' : loading ? 'Reading the git history…' : rows.length === 0 ? 'No commits to summarize in this repository.' : 'Select a revision or highlight to see the files it changed.'}
        </text>
      ) : (
        <>
          {/* Identity stays put while the files scroll beneath it. */}
          <box flexShrink={0} flexDirection="column">
            {!wide ? <box onMouseDown={() => setPane('list')}><text fg={theme.cyan}>← all revisions</text></box> : null}
            <text fg={kindColor(detail.kind)} wrapMode="word" width={detailW}>{detail.title}</text>
            <text fg={theme.muted} wrapMode="word" width={detailW}>{detail.subtitle}</text>
            {detail.note ? <text fg={theme.muted} wrapMode="word" width={detailW}>{detail.note}</text> : null}
            <text fg={theme.dim} wrapMode="none">
              {`Files changed · ${detail.files.length + detail.hiddenFiles}  `}
              <span fg={theme.green}>{`+${detail.added}`}</span>
              <span fg={theme.red}>{` −${detail.removed}`}</span>
            </text>
          </box>
          <scrollbox ref={detailRef} flexGrow={1} minHeight={0} scrollY scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}>
            {detail.files.length === 0 ? <text fg={theme.dim}>No files changed (lockfiles are not counted).</text> : (
              // One text for the whole list, as the daily summary does: a revision can touch hundreds of files.
              <text wrapMode="none">
                {detail.files.map((file, index) => {
                  const { dir, name } = splitWhatsNewPath(file.path)
                  const stat = `+${file.added}`.padStart(numberWidth + 1) + ` −${file.removed}`.padStart(numberWidth + 2)
                  const pathCells = Math.max(detailW - stat.length - 3, 12)
                  const shownName = fit(name, pathCells)
                  const shownDir = fit(dir, Math.max(pathCells - shownName.length, 0))
                  const gap = ' '.repeat(Math.max(pathCells - shownName.length - shownDir.length, 0))
                  return (
                    <span key={file.path}>
                      <span fg={theme.text}>{shownName}</span>
                      <span fg={theme.dim}>{`${shownDir ? ` ${shownDir}` : ''}${gap}  `}</span>
                      <span fg={theme.green}>{`+${file.added}`.padStart(numberWidth + 1)}</span>
                      <span fg={theme.red}>{` −${file.removed}`.padStart(numberWidth + 2)}</span>
                      {index < detail.files.length - 1 || detail.hiddenFiles > 0 ? '\n' : ''}
                    </span>
                  )
                })}
                {detail.hiddenFiles > 0 ? <span fg={theme.dim}>{`and ${detail.hiddenFiles} more file${detail.hiddenFiles === 1 ? '' : 's'}`}</span> : null}
              </text>
            )}
          </scrollbox>
        </>
      )}
    </box>
  )

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
      <box height={1} flexShrink={0} paddingX={1}>
        <text fg={error ? theme.red : theme.dim} wrapMode="none">{fit(error ?? header, innerW)}</text>
      </box>
      <box height={bodyH} flexShrink={0} paddingX={1} flexDirection="row">
        {showList ? listPane : null}
        {wide ? <box width={1} height={bodyH} flexShrink={0} border={['left']} borderStyle="single" borderColor={pane === 'detail' ? theme.border : theme.border2} /> : null}
        {showDetail ? detailPane : null}
      </box>
      <box height={1} flexShrink={0} paddingX={1}>
        <text fg={theme.dim} wrapMode="none">{fit(footer, innerW)}</text>
      </box>
      {help ? <ShortcutHelp title="What's new" groups={HELP} theme={theme} width={popW - frame} height={popH - frame} scrollRef={helpRef} onClose={() => setHelp(false)} /> : null}
    </box>
  )
}

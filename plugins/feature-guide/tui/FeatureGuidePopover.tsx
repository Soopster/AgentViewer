/** @jsxImportSource @opentui/react */
// What's new in Agent Viewer: recent features as the list, how to use the
// selected one as the detail. `/` searches, `f` narrows to an area, `o` runs the
// feature's own command. Narrow panels show one pane at a time with a way back.
import { MODAL_CONTENT_Z_INDEX, PopoverDetachButton, ShortcutHelp, popoverFrameCells, popoverRootProps, type ShortcutHelpGroup, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { FEATURE_AREAS, featureGuideMarkdown, featureGuideRows, featureMarkdown, featureNewAfter, filterFeatures, formatFeatureDate, sortedFeatures, type FeatureArea, type FeatureGuideEntry } from '../../../lib/featureGuide'
import { wrapCells } from '../../../lib/whatsNewView'

type KeyEvent = { name: string; ctrl: boolean; meta?: boolean; shift: boolean; sequence: string }
type Pane = 'list' | 'detail'

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: KeyEvent) => boolean | void) => void
  /** Runs a palette command; false when nothing claimed it. */
  onRunCommand?: (commandId: string) => boolean
  docked?: boolean
  onDetach?: () => void
  onCopy?: (text: string) => void
  /** Features added after this ISO date are marked new. Defaults to the week ending at the newest. */
  newAfter?: string | null
  entries?: readonly FeatureGuideEntry[]
}

const WIDE_MIN = 84
const HELP: ShortcutHelpGroup[] = [
  { title: 'Navigate', rows: [['j / k, ↑ / ↓', 'Move through features (or scroll the detail when it has focus)'], ['Tab', 'Move focus between the list and the detail'], ['Enter', 'Open the selected feature (narrow panels)'], ['g / G', 'First / last feature'], ['Esc', 'Clear the search, back to the list, then close']] },
  { title: 'Find', rows: [['/', 'Search titles, steps and notes'], ['f', 'Show one area at a time (Agents, Review, …)']] },
  { title: 'Use', rows: [['o', 'Try it: open the feature'], ['c', 'Copy the feature as markdown'], ['C', 'Copy the whole guide as markdown']] },
]

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`
}

export function FeatureGuidePopover({ theme, accentColor, width, height, onClose, onNotice, onKeyHandlerReady, onRunCommand, onCopy, docked = false, onDetach, newAfter, entries }: Props) {
  const all = useMemo(() => sortedFeatures(entries), [entries])
  const cutoff = newAfter === undefined ? featureNewAfter(all) : newAfter
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [area, setArea] = useState<FeatureArea | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('list')
  const [help, setHelp] = useState(false)
  const listRef = useRef<ScrollBoxRenderable | null>(null)
  const detailRef = useRef<ScrollBoxRenderable | null>(null)
  const helpRef = useRef<ScrollBoxRenderable | null>(null)

  const shown = useMemo(() => filterFeatures(all, query, area), [all, query, area])
  const rows = useMemo(() => featureGuideRows(shown, cutoff), [shown, cutoff])
  const featureRows = useMemo(() => rows.filter((row) => row.type === 'feature'), [rows])
  const activeKey = featureRows.some((row) => row.key === selectedKey) ? selectedKey : featureRows[0]?.key ?? null
  const active = featureRows.find((row) => row.key === activeKey)
  const entry = active && active.type === 'feature' ? active.entry : null

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.max(width - 4, 20)
  const popH = docked ? height : Math.max(height - 2, 10)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = popW - frame - 2
  const bodyH = Math.max(popH - frame - 2, 4)
  const wide = innerW >= WIDE_MIN
  const listW = wide ? Math.min(Math.max(Math.floor(innerW * 0.4), 34), 60) : innerW
  const detailW = wide ? innerW - listW - 1 : innerW
  const showList = wide || pane === 'list'
  const showDetail = wide || pane === 'detail'

  // A title wraps rather than truncating; a feature row is its title's lines plus an area line.
  const rowLayout = useMemo(() => {
    let top = 0
    return rows.map((row) => {
      const lines = row.type === 'date' ? [row.label] : wrapCells(row.entry.title, Math.max(listW - 6, 8))
      const layout = { key: row.key, top, lines, height: row.type === 'date' ? 1 : lines.length + 1 }
      top += layout.height
      return layout
    })
  }, [rows, listW])

  const selectRow = useCallback((key: string) => {
    setSelectedKey(key)
    if (detailRef.current) detailRef.current.scrollTop = 0
  }, [])

  useEffect(() => {
    const box = listRef.current
    const index = rows.findIndex((row) => row.key === activeKey)
    if (!box || index < 0) return
    // Keep the date heading above the first feature of a day in view.
    const layout = rowLayout[index]!
    const above = index > 0 && rows[index - 1]!.type === 'date' ? rowLayout[index - 1]! : layout
    const viewport = Math.max(bodyH - 1, layout.height)
    if (above.top < box.scrollTop) box.scrollTop = above.top
    else if (layout.top + layout.height > box.scrollTop + viewport) box.scrollTop = layout.top + layout.height - viewport
  }, [activeKey, rows, rowLayout, bodyH])

  const scrollDetail = useCallback((delta: number) => {
    const box = detailRef.current
    if (!box) return
    box.scrollTop = Math.max(0, Math.min(box.scrollTop + delta, Math.max(box.scrollHeight - bodyH, 0)))
  }, [bodyH])

  const tryIt = useCallback(() => {
    if (!entry?.command || !onRunCommand) return
    if (onRunCommand(entry.command)) onClose()
    else onNotice('info', entry.plugin ? `Turn on the ${entry.plugin} plugin (palette → Plugins) to use this.` : 'That command is not available here.', 4000)
  }, [entry, onClose, onNotice, onRunCommand])

  const handleKey = useCallback((key: KeyEvent) => {
    if (help) {
      if (key.name === 'escape' || key.sequence === '?' || key.sequence === 'q') setHelp(false)
      else if (key.name === 'j' || key.name === 'down') helpRef.current?.scrollBy(1)
      else if (key.name === 'k' || key.name === 'up') helpRef.current?.scrollBy(-1)
      return true
    }
    if (searching) {
      if (key.name === 'escape') { setSearching(false); setQuery(''); return true }
      if (key.name === 'return' || key.name === 'down' || key.name === 'tab') { setSearching(false); return true }
      if (key.name === 'backspace') { setQuery((current) => current.slice(0, -1)); return true }
      if (key.ctrl && key.name === 'u') { setQuery(''); return true }
      if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= ' ') { setQuery((current) => current + key.sequence); return true }
      return true
    }
    if (key.sequence === '?') { setHelp(true); return true }
    if (key.sequence === '/') { setSearching(true); setPane('list'); return true }
    if (key.name === 'escape' || key.sequence === 'q') {
      if (!wide && pane === 'detail') setPane('list')
      else if (query || area) { setQuery(''); setArea(null) }
      else onClose()
      return true
    }
    if (key.name === 'tab') { setPane((current) => (current === 'list' ? 'detail' : 'list')); return true }
    if (key.name === 'return') { setPane('detail'); return true }
    const move = (delta: number) => {
      const index = Math.max(featureRows.findIndex((row) => row.key === activeKey), 0)
      const next = featureRows[Math.max(0, Math.min(featureRows.length - 1, index + delta))]
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
    if (key.sequence === 'g' || key.name === 'home') { const first = featureRows[0]; if (first) selectRow(first.key); return true }
    if (key.sequence === 'G' || key.name === 'end') { const last = featureRows[featureRows.length - 1]; if (last) selectRow(last.key); return true }
    if (key.sequence === 'f') {
      setArea((current) => {
        const index = current ? FEATURE_AREAS.indexOf(current) : -1
        return index + 1 < FEATURE_AREAS.length ? FEATURE_AREAS[index + 1]! : null
      })
      return true
    }
    if (key.sequence === 'o') { tryIt(); return true }
    if (key.sequence === 'c' && onCopy && entry) { onCopy(featureMarkdown(entry)); onNotice('info', `Copied "${entry.title}" as markdown`, 3000); return true }
    if (key.sequence === 'C' && onCopy) { onCopy(featureGuideMarkdown(shown)); onNotice('info', "Copied what's new as markdown", 3000); return true }
    return false
  }, [activeKey, area, bodyH, entry, featureRows, help, onClose, onCopy, onNotice, pane, query, scrollDetail, searching, selectRow, shown, tryIt, wide])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const newCount = featureRows.filter((row) => row.type === 'feature' && row.isNew).length
  const header = searching || query
    ? `/${query}${searching ? '▏' : ''}  ·  ${shown.length} of ${all.length} features${area ? ` in ${area}` : ''}`
    : `${all.length} features${newCount ? ` · ${newCount} new this week` : ''}${area ? ` · showing ${area}` : ''}`
  const footer = searching
    ? 'type to search · Enter done · Esc clear'
    : !wide && pane === 'detail'
      ? `Esc back${entry?.command && onRunCommand ? ' · o try it' : ''} · j/k scroll · c copy · ? help`
      : `j/k select · / search · f area${entry?.command && onRunCommand ? ' · o try it' : ''} · c copy · ? help · Esc close`

  const listPane = (
    <box width={listW} height={bodyH} flexDirection="column" flexShrink={0} onMouseDown={() => setPane('list')}>
      {featureRows.length === 0 ? <text fg={theme.dim} wrapMode="word" width={listW}>No feature matches that search.</text> : null}
      <scrollbox ref={listRef} flexGrow={1} minHeight={0} scrollY scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}>
        {rows.map((row, index) => {
          const layout = rowLayout[index]!
          if (row.type === 'date') {
            return (
              <box key={row.key} height={1} flexShrink={0}>
                <text fg={theme.cyan} wrapMode="none">{fit(` ${row.label}`, listW - 1)}</text>
              </box>
            )
          }
          const selected = row.key === activeKey
          return (
            <box key={row.key} height={layout.height} flexDirection="column" flexShrink={0} backgroundColor={selected ? theme.surface2 : undefined}
              onMouseDown={() => { selectRow(row.key); setPane(wide ? 'list' : 'detail') }}>
              <text fg={theme.text} wrapMode="none">
                {layout.lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    <span fg={accentColor}>{selected ? '▌' : ' '}</span>
                    <span fg={row.isNew ? accentColor : theme.dim}>{lineIndex === 0 ? (row.isNew ? '  ✦ ' : '  · ') : '    '}</span>
                    {line}
                    {lineIndex < layout.lines.length - 1 ? '\n' : ''}
                  </span>
                ))}
              </text>
              <text fg={theme.dim} wrapMode="none">{fit(`      ${row.entry.area}${row.isNew ? ' · new' : ''}`, listW - 2)}</text>
            </box>
          )
        })}
      </scrollbox>
    </box>
  )

  const section = (title: string, lines: readonly string[], bullet: string) => lines.length === 0 ? null : (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      <text fg={theme.muted} wrapMode="none">{title}</text>
      {lines.map((line, index) => (
        <box key={index} flexDirection="row" flexShrink={0}>
          <text fg={accentColor} wrapMode="none" flexShrink={0}>{`${bullet} `}</text>
          <text fg={theme.text} wrapMode="word" width={Math.max(detailW - 3, 8)}>{line}</text>
        </box>
      ))}
    </box>
  )

  const detailPane = (
    <box width={detailW} height={bodyH} flexDirection="column" flexShrink={0} onMouseDown={() => setPane('detail')}>
      {!entry ? (
        <text fg={theme.dim} wrapMode="word" width={detailW}>Select a feature to see how to use it.</text>
      ) : (
        <>
          <box flexShrink={0} flexDirection="column">
            {!wide ? <box onMouseDown={() => setPane('list')}><text fg={theme.cyan}>← all features</text></box> : null}
            <text fg={accentColor} wrapMode="word" width={detailW}>{entry.title}</text>
            <text fg={theme.dim} wrapMode="none">{fit(`${entry.area} · ${formatFeatureDate(entry.added)}${entry.plugin ? ` · plugin: ${entry.plugin}` : ''}`, detailW)}</text>
          </box>
          <scrollbox ref={detailRef} flexGrow={1} minHeight={0} scrollY scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}>
            <box flexDirection="column" flexShrink={0} marginTop={1}>
              <text fg={theme.text} wrapMode="word" width={Math.max(detailW - 1, 8)}>{entry.summary}</text>
            </box>
            {entry.tui.length === 0
              ? <box flexShrink={0} marginTop={1}><text fg={theme.dim} wrapMode="word" width={Math.max(detailW - 1, 8)}>This one is on the Web app only.</text></box>
              : section('HOW TO USE IT HERE', entry.tui, '›')}
            {section('ON THE WEB', entry.web, '›')}
            {section('GOOD TO KNOW', entry.notes ?? [], '·')}
            {entry.command && onRunCommand
              ? <box flexShrink={0} marginTop={1} onMouseDown={tryIt}><text fg={theme.cyan} wrapMode="none">{'[ o  Try it ]'}</text></box>
              : null}
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
      title={docked ? undefined : " What's new in Agent Viewer "}
      titleColor={accentColor}
      titleAlignment="left"
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <box height={1} flexShrink={0} paddingX={1}>
        <text fg={searching ? theme.text : theme.dim} wrapMode="none">{fit(header, innerW)}</text>
      </box>
      <box height={bodyH} flexShrink={0} paddingX={1} flexDirection="row">
        {showList ? listPane : null}
        {wide ? <box width={1} height={bodyH} flexShrink={0} border={['left']} borderStyle="single" borderColor={pane === 'detail' ? theme.border : theme.border2} /> : null}
        {showDetail ? detailPane : null}
      </box>
      <box height={1} flexShrink={0} paddingX={1}>
        <text fg={theme.dim} wrapMode="none">{fit(footer, innerW)}</text>
      </box>
      {help ? <ShortcutHelp title="What's new in Agent Viewer" groups={HELP} theme={theme} width={popW - frame} height={popH - frame} scrollRef={helpRef} onClose={() => setHelp(false)} /> : null}
    </box>
  )
}


/** @jsxImportSource @opentui/react */
// The desk (⌃K b): a Bloomberg-Terminal-style workspace over every session.
//
// The screen is the terminal's: a red title bar with numbered actions and the
// clock, an amber command line that takes a function mnemonic and <GO>, a
// ticker tape, a launchpad of numbered panels (1, 2, 3, 4 or 6), and the
// keyboard's coloured keys along the bottom — red CANCEL, green GO and HELP,
// sector-key yellow for panel and layout. Everything is upper case, as on the
// terminal; type is the one font the terminal gives us, so the hierarchy is
// carried by case, weight and colour instead.
//
// Its colours are fixed, whatever the app's theme: that is the point of it.
// The app-wide `bloomberg-dark` / `bloomberg-light` themes (THEME <GO> picks the
// one on the side the app is already on) take them further.
//
// What renders here is cheap to re-render and isolated from the root: the clock
// and the tape own their timers, so neither ticks the root or the panels; the
// panels repaint on a 30s `now` and on their inputs.
import { popoverRootProps } from './dockedPopover'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TextAttributes } from '@opentui/core'
import type { ContextUsage, Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import { BLOOMBERG_THEME } from '../theme'
import {
  DEFAULT_PANEL_FUNCTIONS,
  DESK_FUNCTIONS,
  DESK_LAYOUTS,
  DESK_LAYOUT_LABEL,
  buildDeskChart,
  buildDeskTable,
  defaultDeskLayout,
  deskColumnWidths,
  deskFit,
  deskFunction,
  deskPanelCount,
  deskPanelRects,
  deskSessionKey,
  deskSessionTime,
  deskSuggestions,
  deskTapeEntries,
  deskTicker,
  loadedSessionTimes,
  parseDeskCommand,
  type DeskActivity,
  type DeskAlert,
  type DeskCell,
  type DeskFunctionId,
  type DeskLayoutId,
  type DeskRect,
  type DeskSuggestion,
  type DeskTable,
  type DeskTableInput,
  type DeskTone,
} from './deskModel'

export const DESK_COLORS = {
  bg: BLOOMBERG_THEME.bg,
  panel: '#000000',
  stripe: '#0b0b0b',
  chrome: '#1a1a1a',
  header: '#141414',
  amber: BLOOMBERG_THEME.violet,
  white: '#ffffff',
  text: BLOOMBERG_THEME.text,
  flat: '#bdbdbd',
  dim: '#6b6b6b',
  up: BLOOMBERG_THEME.green,
  down: BLOOMBERG_THEME.red,
  yellow: BLOOMBERG_THEME.amber,
  blue: BLOOMBERG_THEME.cyan,
  security: '#1c3f8f',
  redBar: '#a3161c',
  goGreen: '#00a651',
  cancelRed: '#d7191f',
  border: '#3a3a3a',
  focusBorder: BLOOMBERG_THEME.amber,
  key: '#d9822b',
} as const

const TONE_COLOR: Record<DeskTone, string> = {
  text: DESK_COLORS.text,
  label: DESK_COLORS.amber,
  up: DESK_COLORS.up,
  down: DESK_COLORS.down,
  flat: DESK_COLORS.flat,
  alert: DESK_COLORS.yellow,
  link: DESK_COLORS.blue,
  dim: DESK_COLORS.dim,
  key: DESK_COLORS.key,
}

const BOLD = TextAttributes.BOLD
const LOAD_DEBOUNCE_MS = 120
const TAPE_STEP_MS = 250
const NOW_TICK_MS = 30_000
const UPTICK_HOLD_MS = 120_000

type DeskKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string }

export type DeskViewProps = {
  sessions: Session[]
  activity: ReadonlyMap<string, DeskActivity>
  alerts: DeskAlert[]
  /** The loaded security: the root's selected session. */
  loaded: Session | null
  /** The loaded session's transcript, once read; null until it belongs to `loaded`. */
  loadedCards: TuiTranscriptCard[] | null
  loadedContext: ContextUsage | null
  loadedModel: string | null
  loadedMessageCount: number | null
  themeActive: boolean
  width: number
  height: number
  onLoadSession: (session: Session) => void
  onOpenSession: (session: Session) => void
  onOpenAlert: (alertKey: string) => void
  onApplyTheme: () => void
  onClose: () => void
  onKeyHandlerReady: (handler: (key: DeskKeyEvent) => void) => void
  /** Fill the given box inside a window instead of covering the screen. */
  docked?: boolean
}

type PanelState = { fn: DeskFunctionId; history: DeskFunctionId[]; cursor: number }

function initialPanels(): PanelState[] {
  return DEFAULT_PANEL_FUNCTIONS.map((fn) => ({ fn, history: [], cursor: 0 }))
}

// ── Pieces with their own clocks ─────────────────────────────────────────────

const DeskClock = memo(function DeskClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const time = now.toLocaleTimeString('en-GB', { hour12: false })
  const zone = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() ?? ''
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/,/g, '')
  return (
    <text wrapMode="none" bg={DESK_COLORS.redBar}>
      <span fg={DESK_COLORS.white} attributes={BOLD}>{time}</span>
      <span fg={DESK_COLORS.white}>{` ${zone}  ${date} `}</span>
    </text>
  )
})

type TapeEntry = ReturnType<typeof deskTapeEntries>[number]

const DeskTape = memo(function DeskTape({ entries, width, running }: { entries: TapeEntry[]; width: number; running: boolean }) {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setOffset((value) => value + 1), TAPE_STEP_MS)
    return () => clearInterval(timer)
  }, [running])
  // The tape is one long run of segments, read as a ring from `offset`.
  const segments = useMemo(() => {
    const out: Array<{ text: string; fg: string; bold?: boolean }> = []
    for (const entry of entries) {
      out.push({ text: `${entry.mark} `, fg: TONE_COLOR[entry.tone] })
      out.push({ text: entry.ticker, fg: DESK_COLORS.amber, bold: true })
      out.push({ text: ` ${entry.name} `, fg: DESK_COLORS.text })
      out.push({ text: entry.status, fg: TONE_COLOR[entry.tone], bold: true })
      out.push({ text: '   │   ', fg: DESK_COLORS.dim })
    }
    return out
  }, [entries])
  const totalLength = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  const visible = useMemo(() => {
    if (totalLength === 0) return [{ text: deskFit(' NO SECURITIES ON THE TAPE', width), fg: DESK_COLORS.dim }]
    const start = offset % totalLength
    const out: Array<{ text: string; fg: string; bold?: boolean }> = []
    let skip = start
    let remaining = width
    // Walk the ring twice at most: enough to fill any width the tape is shorter than.
    for (let lap = 0; lap < Math.ceil(width / totalLength) + 2 && remaining > 0; lap += 1) {
      for (const segment of segments) {
        if (remaining <= 0) break
        if (skip >= segment.text.length) { skip -= segment.text.length; continue }
        const piece = segment.text.slice(skip, skip + remaining)
        skip = 0
        remaining -= piece.length
        out.push({ ...segment, text: piece })
      }
    }
    return out
  }, [offset, segments, totalLength, width])
  return (
    <box height={1} width={width} backgroundColor={DESK_COLORS.chrome}>
      <text wrapMode="none">
        {visible.map((segment, index) => (
          <span key={index} fg={segment.fg} attributes={segment.bold ? BOLD : undefined}>{segment.text}</span>
        ))}
      </text>
    </box>
  )
})

// ── Panels ───────────────────────────────────────────────────────────────────

function CellsLine({ cells, widths, aligns, bg, selected }: {
  cells: DeskCell[]
  widths: number[]
  aligns: Array<'left' | 'right' | undefined>
  bg: string
  selected: boolean
}) {
  return (
    <text wrapMode="none" bg={bg}>
      {cells.map((cell, index) => (
        <span
          key={index}
          fg={selected ? '#000000' : TONE_COLOR[cell.tone ?? 'text']}
          bg={bg}
          attributes={cell.bold || selected ? BOLD : undefined}
        >
          {`${deskFit(cell.text, widths[index] ?? 0, aligns[index])}${index < cells.length - 1 ? ' ' : ''}`}
        </span>
      ))}
    </text>
  )
}

function PanelTitle({ index, fn, width, focused, right }: { index: number; fn: DeskFunctionId; width: number; focused: boolean; right: string }) {
  const meta = deskFunction(fn)
  const chip = ` ${index + 1}) ${fn} `
  const title = ` ${meta.title.toUpperCase()}`
  const rest = Math.max(0, width - chip.length - title.length - right.length - 1)
  return (
    <text wrapMode="none" bg={DESK_COLORS.chrome}>
      <span fg="#000000" bg={focused ? DESK_COLORS.yellow : DESK_COLORS.amber} attributes={BOLD}>{chip}</span>
      <span fg={DESK_COLORS.white} bg={DESK_COLORS.chrome} attributes={BOLD}>{deskFit(title, title.length + rest)}</span>
      <span fg={DESK_COLORS.dim} bg={DESK_COLORS.chrome}>{`${right} `}</span>
    </text>
  )
}

function SummaryLine({ cells, width }: { cells: DeskCell[]; width: number }) {
  let used = 0
  return (
    <text wrapMode="none" bg={DESK_COLORS.panel}>
      {cells.map((cell, index) => {
        const text = cell.text.slice(0, Math.max(0, width - used))
        used += text.length
        return <span key={index} fg={TONE_COLOR[cell.tone ?? 'text']} attributes={cell.bold ? BOLD : undefined}>{text}</span>
      })}
    </text>
  )
}

type PanelProps = {
  index: number
  rect: DeskRect
  fn: DeskFunctionId
  focused: boolean
  cursor: number
  table: DeskTable | null
  input: DeskTableInput
}

const DeskPanel = memo(function DeskPanel({ index, rect, fn, focused, cursor, table, input }: PanelProps) {
  const innerWidth = Math.max(rect.width - 2, 1)
  const innerHeight = Math.max(rect.height - 2, 1)
  const borderColor = focused ? DESK_COLORS.focusBorder : DESK_COLORS.border

  if (fn === 'GP') {
    return (
      <box position="absolute" left={rect.left} top={rect.top} width={rect.width} height={rect.height} border borderStyle="single" borderColor={borderColor} backgroundColor={DESK_COLORS.panel} flexDirection="column">
        <PanelTitle index={index} fn={fn} width={innerWidth} focused={focused} right={input.loaded ? deskTicker(input.loaded) : 'ALL SESSIONS 24H'} />
        <DeskChartBody input={input} width={innerWidth} height={innerHeight - 1} />
      </box>
    )
  }

  const rows = table?.rows ?? []
  const widths = table ? deskColumnWidths(table.columns, innerWidth) : []
  const aligns = table ? table.columns.map((column) => column.align) : []
  const summaryRows = table?.summary ? 1 : 0
  const bodyRows = Math.max(0, innerHeight - 2 - summaryRows)
  const clampedCursor = rows.length ? Math.min(cursor, rows.length - 1) : 0
  const start = rows.length <= bodyRows ? 0 : Math.max(0, Math.min(clampedCursor - Math.floor(bodyRows / 3), rows.length - bodyRows))
  const window = rows.slice(start, start + bodyRows)
  const position = rows.length ? `${clampedCursor + 1}/${rows.length}` : ''

  return (
    <box position="absolute" left={rect.left} top={rect.top} width={rect.width} height={rect.height} border borderStyle="single" borderColor={borderColor} backgroundColor={DESK_COLORS.panel} flexDirection="column">
      <PanelTitle index={index} fn={fn} width={innerWidth} focused={focused} right={position} />
      {table?.summary ? <SummaryLine cells={table.summary} width={innerWidth} /> : null}
      {table ? (
        <text wrapMode="none" bg={DESK_COLORS.header}>
          {table.columns.map((column, columnIndex) => (
            <span key={column.title} fg={DESK_COLORS.amber} bg={DESK_COLORS.header} attributes={BOLD}>
              {`${deskFit(column.title, widths[columnIndex] ?? 0, column.align)}${columnIndex < table.columns.length - 1 ? ' ' : ''}`}
            </span>
          ))}
        </text>
      ) : null}
      {rows.length === 0 ? (
        <text wrapMode="word" fg={DESK_COLORS.dim} width={innerWidth}>{table?.empty ?? ''}</text>
      ) : window.map((row, offset) => {
        const rowIndex = start + offset
        const selected = rowIndex === clampedCursor
        const bg = selected ? (focused ? DESK_COLORS.amber : '#3a2a14') : rowIndex % 2 === 1 ? DESK_COLORS.stripe : DESK_COLORS.panel
        return <CellsLine key={row.key} cells={row.cells} widths={widths} aligns={aligns} bg={bg} selected={selected && focused} />
      })}
    </box>
  )
})

function DeskChartBody({ input, width, height }: { input: DeskTableInput; width: number; height: number }) {
  const axisWidth = 6
  const plotWidth = Math.max(4, width - axisWidth)
  const plotHeight = Math.max(2, height - 3)
  const chart = useMemo(() => {
    const times = loadedSessionTimes(input.loadedCards)
    if (input.loaded && times.length > 0) return buildDeskChart(times, plotWidth, plotHeight, 'MSGS')
    // No transcript loaded yet: chart the whole desk's prints over 24 hours.
    const end = input.now
    return buildDeskChart(
      input.sessions.map(deskSessionTime).filter((time) => end - time < 24 * 60 * 60_000),
      plotWidth,
      plotHeight,
      'SESS',
      { start: end - 24 * 60 * 60_000, end },
    )
  }, [input.loaded, input.loadedCards, input.sessions, input.now, plotWidth, plotHeight])

  if (!chart) {
    return <text fg={DESK_COLORS.dim} wrapMode="word" width={width}>NO PRINTS TO CHART</text>
  }
  const summary: DeskCell[] = [
    { text: 'LAST ', tone: 'label' }, { text: String(chart.last), tone: 'text', bold: true },
    { text: '  HIGH ', tone: 'label' }, { text: String(chart.high), tone: 'up', bold: true },
    { text: '  AVG ', tone: 'label' }, { text: chart.average.toFixed(1), tone: 'text' },
    { text: '  VOL ', tone: 'label' }, { text: `${chart.total} ${chart.unit}`, tone: 'text' },
  ]
  return (
    <box flexDirection="column">
      <SummaryLine cells={summary} width={width} />
      {chart.plot.map((line, row) => (
        <text key={row} wrapMode="none">
          <span fg={DESK_COLORS.up}>{line.slice(0, chart.lastColumn)}</span>
          <span fg={DESK_COLORS.yellow}>{line.slice(chart.lastColumn)}</span>
          <span fg={DESK_COLORS.amber}>{` ${deskFit(chart.axisLabels[row] ?? '', axisWidth - 1, 'right')}`}</span>
        </text>
      ))}
      <text wrapMode="none" fg={DESK_COLORS.dim}>{'─'.repeat(plotWidth)}</text>
      <text wrapMode="none" fg={DESK_COLORS.flat}>{chart.timeAxis}</text>
    </box>
  )
}

// ── The desk ─────────────────────────────────────────────────────────────────

export function DeskView({
  sessions,
  activity,
  alerts,
  loaded,
  loadedCards,
  loadedContext,
  loadedModel,
  loadedMessageCount,
  themeActive,
  width,
  height,
  onLoadSession,
  onOpenSession,
  onOpenAlert,
  onApplyTheme,
  onClose,
  onKeyHandlerReady,
  docked = false,
}: DeskViewProps) {
  const [layout, setLayout] = useState<DeskLayoutId>(() => defaultDeskLayout(width, height))
  const [panels, setPanels] = useState<PanelState[]>(initialPanels)
  const [focus, setFocus] = useState(0)
  const [command, setCommand] = useState('')
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [tapeRunning, setTapeRunning] = useState(true)
  const [message, setMessage] = useState<{ text: string; tone: DeskTone } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // Upticks: a session whose last print moved since the desk first saw it.
  const seenRef = useRef<Map<string, number> | null>(null)
  const tickedAtRef = useRef(new Map<string, number>())
  const upticks = useMemo(() => {
    const stamp = Date.now()
    const first = seenRef.current === null
    const seen = seenRef.current ?? new Map<string, number>()
    for (const session of sessions) {
      const key = deskSessionKey(session)
      const time = deskSessionTime(session)
      const previous = seen.get(key)
      if (!first && previous !== undefined && time > previous) tickedAtRef.current.set(key, stamp)
      seen.set(key, time)
    }
    seenRef.current = seen
    const live = new Set<string>()
    for (const [key, at] of tickedAtRef.current) {
      if (Math.max(now, stamp) - at < UPTICK_HOLD_MS) live.add(key)
      else tickedAtRef.current.delete(key)
    }
    return live
  }, [sessions, now])

  const sessionsByKey = useMemo(() => new Map(sessions.map((session) => [deskSessionKey(session), session])), [sessions])
  const panelCount = deskPanelCount(layout)
  const focusIndex = Math.min(focus, panelCount - 1)

  const chartWidth = Math.max(10, width - 10)
  const input = useMemo<DeskTableInput>(() => ({
    sessions,
    activity,
    upticks,
    now,
    alerts,
    loaded,
    loadedCards,
    loadedContext,
    loadedModel,
    loadedMessageCount,
    chartWidth,
    chartHeight: 10,
  }), [sessions, activity, upticks, now, alerts, loaded, loadedCards, loadedContext, loadedModel, loadedMessageCount, chartWidth])

  const tables = useMemo(
    () => panels.slice(0, panelCount).map((panel) => buildDeskTable(panel.fn, input)),
    [panels, panelCount, input],
  )
  const tablesRef = useRef(tables)
  tablesRef.current = tables

  const suggestions = useMemo(() => deskSuggestions(command, sessions), [command, sessions])
  const clampedSuggestion = suggestions.length ? Math.min(suggestionIndex, suggestions.length - 1) : 0

  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (loadTimerRef.current) clearTimeout(loadTimerRef.current) }, [])
  const scheduleLoad = useCallback((sessionKey: string | undefined) => {
    if (!sessionKey) return
    const session = sessionsByKey.get(sessionKey)
    if (!session || (loaded && deskSessionKey(loaded) === sessionKey)) return
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
    // Selecting re-renders the whole app behind the desk; holding ↓ would do
    // that per row, so the load waits until the cursor rests.
    loadTimerRef.current = setTimeout(() => onLoadSession(session), LOAD_DEBOUNCE_MS)
  }, [loaded, onLoadSession, sessionsByKey])

  const say = useCallback((text: string, tone: DeskTone = 'label') => setMessage({ text, tone }), [])

  const setPanelFunction = useCallback((panelIndex: number, fn: DeskFunctionId) => {
    setPanels((current) => current.map((panel, index) => (
      index !== panelIndex || panel.fn === fn ? panel : { fn, history: [...panel.history, panel.fn].slice(-12), cursor: 0 }
    )))
    say(`${panelIndex + 1}) ${fn} — ${deskFunction(fn).title.toUpperCase()}`)
  }, [say])

  const moveCursor = useCallback((delta: number | 'home' | 'end') => {
    const rows = tablesRef.current[focusIndex]?.rows ?? []
    if (rows.length === 0) return
    setPanels((current) => current.map((panel, index) => {
      if (index !== focusIndex) return panel
      const base = Math.min(panel.cursor, rows.length - 1)
      const next = delta === 'home' ? 0 : delta === 'end' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, base + delta))
      scheduleLoad(rows[next]?.sessionKey)
      return { ...panel, cursor: next }
    }))
  }, [focusIndex, scheduleLoad])

  const activateRow = useCallback((rowIndex?: number) => {
    const rows = tablesRef.current[focusIndex]?.rows ?? []
    const panel = panels[focusIndex]
    const index = rowIndex ?? Math.min(panel?.cursor ?? 0, Math.max(rows.length - 1, 0))
    const row = rows[index]
    if (!row) {
      say(rowIndex ? `NO ROW ${rowIndex + 1} IN ${panel?.fn ?? ''}` : 'NOTHING TO SELECT', 'down')
      return
    }
    if (rowIndex !== undefined) {
      setPanels((current) => current.map((entry, entryIndex) => entryIndex === focusIndex ? { ...entry, cursor: index } : entry))
    }
    if (row.functionId) { setPanelFunction(focusIndex, row.functionId); return }
    if (row.attentionKey) { onOpenAlert(row.attentionKey); return }
    const session = row.sessionKey ? sessionsByKey.get(row.sessionKey) : undefined
    if (!session) return
    if (loaded && deskSessionKey(loaded) === row.sessionKey) {
      // Enter on what is already loaded is the second click: read it.
      onOpenSession(session)
      return
    }
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
    onLoadSession(session)
    say(`LOADED ${deskTicker(session)} — <GO> AGAIN OR OPEN <GO> TO READ`)
  }, [focusIndex, loaded, onLoadSession, onOpenAlert, onOpenSession, panels, say, sessionsByKey, setPanelFunction])

  const applySuggestion = useCallback((suggestion: DeskSuggestion) => {
    setCommand('')
    setSuggestionIndex(0)
    if (suggestion.kind === 'function') { setPanelFunction(focusIndex, suggestion.id); return }
    const session = sessionsByKey.get(suggestion.key)
    if (!session) return
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
    onLoadSession(session)
    say(`LOADED ${deskTicker(session)}`)
  }, [focusIndex, onLoadSession, say, sessionsByKey, setPanelFunction])

  const runCommand = useCallback((raw: string) => {
    const parsed = parseDeskCommand(raw)
    setCommand('')
    setSuggestionIndex(0)
    switch (parsed.kind) {
      case 'none': activateRow(); return
      case 'function': setPanelFunction(focusIndex, parsed.id); return
      case 'layout': setLayout(parsed.layout); say(`LAYOUT ${parsed.layout} — ${DESK_LAYOUT_LABEL[parsed.layout]}`); return
      case 'row': activateRow(parsed.row - 1); return
      case 'open':
        if (loaded) onOpenSession(loaded)
        else say('NO SECURITY LOADED', 'down')
        return
      case 'theme': onApplyTheme(); say('APP THEME SET TO BLOOMBERG'); return
      case 'exit': onClose(); return
      case 'search': {
        const match = deskSuggestions(parsed.query, sessions, 20).find((suggestion) => suggestion.kind === 'session')
        if (match) { applySuggestion(match); return }
        say(`NO FUNCTION OR SECURITY MATCHES "${parsed.query.toUpperCase()}" — HELP <GO>`, 'down')
      }
    }
  }, [activateRow, applySuggestion, focusIndex, loaded, onApplyTheme, onClose, onOpenSession, say, sessions, setPanelFunction])

  const pageRows = Math.max(1, Math.floor((height - 4) / (panelCount > 3 ? 2 : 1)) - 5)

  const handleKey = useCallback((key: DeskKeyEvent) => {
    const printable = key.sequence.length === 1 && key.sequence >= ' ' && key.sequence !== '\x7f' && !key.ctrl && !key.meta
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      if (command) { setCommand(''); setSuggestionIndex(0); say('CANCELLED'); return }
      onClose()
      return
    }
    if (key.name === 'return' || key.name === 'enter') {
      // A complete command runs as typed; a partial one (`MO`, a name) takes
      // the highlighted suggestion, as the terminal's autocomplete does.
      if (command && suggestions.length > 0 && (suggestionIndex > 0 || parseDeskCommand(command).kind === 'search')) {
        applySuggestion(suggestions[clampedSuggestion])
        return
      }
      runCommand(command)
      return
    }
    if (key.name === 'backspace') {
      if (command) { setCommand((value) => value.slice(0, -1)); setSuggestionIndex(0); return }
      // MENU: back to the function this panel ran before.
      const panel = panels[focusIndex]
      const previous = panel?.history.at(-1)
      if (!previous) { say('NO EARLIER FUNCTION IN THIS PANEL', 'dim'); return }
      setPanels((current) => current.map((entry, index) => index === focusIndex ? { fn: previous, history: entry.history.slice(0, -1), cursor: 0 } : entry))
      say(`${focusIndex + 1}) BACK TO ${previous}`)
      return
    }
    if (key.name === 'tab') {
      setFocus((value) => (Math.min(value, panelCount - 1) + (key.shift ? panelCount - 1 : 1)) % panelCount)
      return
    }
    if (key.ctrl && key.name === 'l') {
      const next = DESK_LAYOUTS[(DESK_LAYOUTS.indexOf(layout) + 1) % DESK_LAYOUTS.length]
      setLayout(next)
      say(`LAYOUT ${next} — ${DESK_LAYOUT_LABEL[next]}`)
      return
    }
    if (key.ctrl && key.name === 't') { setTapeRunning((value) => !value); return }
    if (key.ctrl && key.name === 'o') { runCommand('OPEN'); return }
    const fKey = key.name.match(/^f(\d{1,2})$/)
    if (fKey) {
      const number = Number(fKey[1])
      const order = DESK_FUNCTIONS.filter((fn) => fn.id !== 'HELP')
      const fn = number === 1 ? 'HELP' : order[number - 2]?.id
      if (fn) setPanelFunction(focusIndex, fn)
      return
    }
    if (key.name === 'up' || key.name === 'down') {
      if (command && suggestions.length > 0) {
        setSuggestionIndex((value) => Math.max(0, Math.min(suggestions.length - 1, value + (key.name === 'down' ? 1 : -1))))
        return
      }
      moveCursor(key.name === 'down' ? 1 : -1)
      return
    }
    if (key.name === 'pagedown') { moveCursor(pageRows); return }
    if (key.name === 'pageup') { moveCursor(-pageRows); return }
    if (key.name === 'home') { moveCursor('home'); return }
    if (key.name === 'end') { moveCursor('end'); return }
    if (printable) {
      setCommand((value) => (value + key.sequence).slice(0, 60))
      setSuggestionIndex(0)
      setMessage(null)
    }
  }, [applySuggestion, clampedSuggestion, command, focusIndex, layout, moveCursor, onClose, pageRows, panelCount, panels, runCommand, say, setPanelFunction, suggestionIndex, suggestions])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const tape = useMemo(() => deskTapeEntries(sessions, activity, upticks, now), [sessions, activity, upticks, now])
  const panelTop = 3
  const panelHeight = Math.max(4, height - panelTop - 1)
  const rects = deskPanelRects(layout, width, panelHeight)
  const needsYou = alerts.filter((alert) => alert.needsInput).length

  // ── Title bar ──
  const actions = ' 91) Layout  92) Theme  93) Open  99) Exit '
  const titleLeft = ' AGENT VIEWER ▸ DESK '
  const clockWidth = 34
  const titleRest = Math.max(0, width - titleLeft.length - actions.length - clockWidth)

  // ── Command line ──
  const focusedFn = panels[focusIndex]?.fn ?? 'MON'
  const prompt = ` ${focusIndex + 1}) ${focusedFn} `
  const security = loaded ? ` ${deskTicker(loaded)}  ${(loaded.customTitle ?? loaded.summary ?? '').toString().toUpperCase()} ` : ' NO SECURITY LOADED '
  const securityWidth = Math.min(security.length, Math.max(20, Math.floor(width * 0.4)))
  const typed = command.toUpperCase()
  const commandWidth = Math.max(0, width - prompt.length - securityWidth - 1)

  return (
    <box {...popoverRootProps(docked, { top: 0, left: 0, width, height }, 60)} backgroundColor={DESK_COLORS.bg} flexDirection="column">
      <box height={1} width={width} flexDirection="row" backgroundColor={DESK_COLORS.redBar}>
        <text wrapMode="none" bg={DESK_COLORS.redBar}>
          <span fg={DESK_COLORS.white} attributes={BOLD}>{titleLeft}</span>
          <span fg={DESK_COLORS.amber} bg={DESK_COLORS.redBar}>{' '.repeat(titleRest)}</span>
          <span fg={DESK_COLORS.white}>{width >= 90 ? actions : ''}</span>
        </text>
        <box flexGrow={1} />
        <DeskClock />
      </box>

      <box height={1} width={width} flexDirection="row" backgroundColor={DESK_COLORS.bg}>
        <text wrapMode="none">
          <span fg="#000000" bg={DESK_COLORS.amber} attributes={BOLD}>{prompt}</span>
          <span fg={DESK_COLORS.white} attributes={BOLD}>{` ${typed}`}</span>
          <span fg={DESK_COLORS.amber} attributes={BOLD}>█</span>
          <span fg={message ? TONE_COLOR[message.tone] : DESK_COLORS.dim}>
            {deskFit(command ? '  <GO>' : `  ${message?.text ?? 'TYPE A FUNCTION · HELP <GO> · ⏎ GO · ESC CANCEL'}`, Math.max(0, commandWidth - typed.length - 2))}
          </span>
        </text>
        <box flexGrow={1} />
        <text wrapMode="none">
          <span fg={DESK_COLORS.yellow} bg={DESK_COLORS.security} attributes={BOLD}>{deskFit(security, securityWidth)}</span>
        </text>
      </box>

      <DeskTape entries={tape} width={width} running={tapeRunning} />

      <box position="relative" height={panelHeight} width={width}>
        {rects.map((rect, index) => (
          <DeskPanel
            key={index}
            index={index}
            rect={rect}
            fn={panels[index]?.fn ?? 'MON'}
            focused={index === focusIndex}
            cursor={panels[index]?.cursor ?? 0}
            table={tables[index] ?? null}
            input={input}
          />
        ))}
      </box>

      <DeskKeyStrip width={width} layout={layout} needsYou={needsYou} themeActive={themeActive} tapeRunning={tapeRunning} />

      {command && suggestions.length > 0 ? (
        <box
          position="absolute"
          top={2}
          left={prompt.length}
          width={Math.min(width - prompt.length, 72)}
          height={suggestions.length + 2}
          border
          borderStyle="single"
          borderColor={DESK_COLORS.amber}
          backgroundColor={DESK_COLORS.chrome}
          flexDirection="column"
          zIndex={61}
        >
          {suggestions.map((suggestion, index) => {
            const active = index === clampedSuggestion
            const innerWidth = Math.min(width - prompt.length, 72) - 2
            const label = suggestion.kind === 'function' ? deskFit(suggestion.label, 6) : deskFit(suggestion.label, 11)
            const kind = suggestion.kind === 'function' ? 'FUNC ' : 'EQUITY '
            return (
              <text key={`${suggestion.kind}:${suggestion.label}:${index}`} wrapMode="none" bg={active ? DESK_COLORS.amber : DESK_COLORS.chrome}>
                <span fg={active ? '#000000' : DESK_COLORS.amber} attributes={BOLD}>{` ${label} `}</span>
                <span fg={active ? '#000000' : DESK_COLORS.text}>{deskFit(suggestion.detail, Math.max(0, innerWidth - label.length - kind.length - 3))}</span>
                <span fg={active ? '#000000' : DESK_COLORS.dim}>{kind}</span>
              </text>
            )
          })}
        </box>
      ) : null}
    </box>
  )
}

function KeyChip({ label, caption, bg, fg = '#000000' }: { label: string; caption: string; bg: string; fg?: string }) {
  return (
    <>
      <span fg={fg} bg={bg} attributes={BOLD}>{` ${label} `}</span>
      <span fg={DESK_COLORS.flat} bg={DESK_COLORS.bg}>{` ${caption}  `}</span>
    </>
  )
}

const DeskKeyStrip = memo(function DeskKeyStrip({ width, layout, needsYou, themeActive, tapeRunning }: {
  width: number
  layout: DeskLayoutId
  needsYou: number
  themeActive: boolean
  tapeRunning: boolean
}) {
  const right = `${needsYou > 0 ? `${needsYou} NEED YOU · ` : ''}LAYOUT ${layout} ${DESK_LAYOUT_LABEL[layout]}${themeActive ? ' · THEME ON' : ''}${tapeRunning ? '' : ' · TAPE HELD'} `
  const compact = width < 110
  return (
    <box height={1} width={width} flexDirection="row" backgroundColor={DESK_COLORS.bg}>
      <text wrapMode="none">
        <KeyChip label="ESC" caption="CANCEL" bg={DESK_COLORS.cancelRed} fg={DESK_COLORS.white} />
        <KeyChip label="⏎" caption="GO" bg={DESK_COLORS.goGreen} fg={DESK_COLORS.white} />
        <KeyChip label="F1" caption="HELP" bg={DESK_COLORS.goGreen} fg={DESK_COLORS.white} />
        <KeyChip label="⌫" caption="MENU" bg={DESK_COLORS.goGreen} fg={DESK_COLORS.white} />
        <KeyChip label="TAB" caption="PANEL" bg={DESK_COLORS.yellow} />
        {compact ? null : <KeyChip label="^L" caption="LAYOUT" bg={DESK_COLORS.yellow} />}
        {compact ? null : <KeyChip label="^O" caption="OPEN" bg={DESK_COLORS.yellow} />}
        {compact ? null : <KeyChip label="^T" caption="TAPE" bg={DESK_COLORS.yellow} />}
      </text>
      <box flexGrow={1} />
      <text wrapMode="none" fg={needsYou > 0 ? DESK_COLORS.yellow : DESK_COLORS.dim}>{right}</text>
    </box>
  )
})

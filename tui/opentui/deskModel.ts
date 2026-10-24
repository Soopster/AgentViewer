import { sessionIdentityKey } from './sessionIdentity'
// The desk: a Bloomberg-Terminal-style workspace over the session list.
//
// Everything here is pure — the functions a panel can run, the launchpad
// layouts, and the tables each function draws — so the rendering component
// stays a thin painter and `deskViewSmoke.tsx` can check the tables directly.
//
// The vocabulary is the terminal's: a session is a *security*, loading one into
// the desk links every panel to it (DES, GP, CN all describe the loaded one),
// a function is a short mnemonic typed into the command line and run with
// <GO>, and a bare number <GO> picks that numbered row. A command that names no
// function is a security search, as on the terminal.

import type { AgentProvider, ContextUsage, Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import { formatSessionTitle } from '../format'

export type DeskActivity = 'needs-input' | 'running' | 'waiting'

export type DeskFunctionId = 'MON' | 'TOP' | 'DES' | 'GP' | 'WEI' | 'MOST' | 'ALRT' | 'CN' | 'HELP'

export type DeskFunction = {
  id: DeskFunctionId
  title: string
  description: string
  aliases: string[]
}

export const DESK_FUNCTIONS: DeskFunction[] = [
  { id: 'MON', title: 'Session Monitor', description: 'Every session as a ticker: status, provider, last trade', aliases: ['W', 'WATCH', 'MONITOR'] },
  { id: 'TOP', title: 'Top Activity', description: 'The newswire: sessions as they print, alerts first', aliases: ['NEWS', 'N', 'NI'] },
  { id: 'DES', title: 'Description', description: 'The loaded session: provider, model, project, context', aliases: ['INFO'] },
  { id: 'GP', title: 'Graph', description: 'Intraday chart of the loaded session\'s message flow', aliases: ['G', 'CHART', 'GIP'] },
  { id: 'WEI', title: 'Agent Indices', description: 'Each provider as an index: 24h prints against the prior 24h', aliases: ['INDEX', 'PROV'] },
  { id: 'MOST', title: 'Most Active', description: 'Projects ranked by sessions printed in the last 24h', aliases: ['MA', 'PROJ'] },
  { id: 'ALRT', title: 'Alerts', description: 'Everything blocked on you: approvals, questions, plans', aliases: ['ALERT', 'ALERTS', '!'] },
  { id: 'CN', title: 'Session News', description: 'The loaded session\'s transcript as headlines', aliases: ['TRAN', 'STORY'] },
  { id: 'HELP', title: 'Function Directory', description: 'Every function on this desk', aliases: ['?', 'FUNC', 'MENU'] },
]

const FUNCTION_BY_NAME = new Map<string, DeskFunctionId>(
  DESK_FUNCTIONS.flatMap((fn) => [[fn.id, fn.id] as const, ...fn.aliases.map((alias) => [alias, fn.id] as const)]),
)

export function deskFunction(id: DeskFunctionId): DeskFunction {
  return DESK_FUNCTIONS.find((fn) => fn.id === id) ?? DESK_FUNCTIONS[0]
}

// ── Launchpad layouts ────────────────────────────────────────────────────────

export type DeskLayoutId = '1' | '2' | '3' | '4' | '6'
export const DESK_LAYOUTS: DeskLayoutId[] = ['1', '2', '3', '4', '6']
export const DESK_LAYOUT_LABEL: Record<DeskLayoutId, string> = {
  '1': 'SINGLE', '2': 'SPLIT', '3': 'FOCUS+2', '4': 'GRID 2×2', '6': 'GRID 3×2',
}

/** What each panel slot runs when the desk opens; a layout shows its first N. */
export const DEFAULT_PANEL_FUNCTIONS: DeskFunctionId[] = ['MON', 'TOP', 'DES', 'GP', 'WEI', 'ALRT']

export function deskPanelCount(layout: DeskLayoutId): number {
  return Number(layout)
}

export function defaultDeskLayout(width: number, height: number): DeskLayoutId {
  if (width >= 170 && height >= 36) return '6'
  if (width >= 110 && height >= 28) return '4'
  if (width >= 90) return '2'
  return '1'
}

export type DeskRect = { left: number; top: number; width: number; height: number }

/**
 * Panel rectangles for a layout inside a `width × height` area. Integer
 * division leaves remainders; they go to the last row/column so the grid
 * always tiles the area exactly, with no gap at the right or bottom edge.
 */
export function deskPanelRects(layout: DeskLayoutId, width: number, height: number): DeskRect[] {
  const split = (total: number, parts: number): Array<[number, number]> => {
    const base = Math.floor(total / parts)
    return Array.from({ length: parts }, (_, index) => [index * base, index === parts - 1 ? total - index * base : base])
  }
  const grid = (cols: number, rows: number): DeskRect[] => {
    const xs = split(width, cols)
    const ys = split(height, rows)
    return ys.flatMap(([top, h]) => xs.map(([left, w]) => ({ left, top, width: w, height: h })))
  }
  switch (layout) {
    case '1': return [{ left: 0, top: 0, width, height }]
    case '2': return grid(2, 1)
    case '3': {
      const leftWidth = Math.max(Math.floor(width * 0.55), 1)
      const [[, topH], [, bottomH]] = split(height, 2)
      return [
        { left: 0, top: 0, width: leftWidth, height },
        { left: leftWidth, top: 0, width: width - leftWidth, height: topH },
        { left: leftWidth, top: topH, width: width - leftWidth, height: bottomH },
      ]
    }
    case '4': return grid(2, 2)
    case '6': return grid(3, 2)
  }
}

// ── Command line ─────────────────────────────────────────────────────────────

export type DeskCommand =
  | { kind: 'function'; id: DeskFunctionId }
  | { kind: 'layout'; layout: DeskLayoutId }
  | { kind: 'row'; row: number }
  | { kind: 'open' }
  | { kind: 'theme' }
  | { kind: 'exit' }
  | { kind: 'search'; query: string }
  | { kind: 'none' }

/**
 * Parse what was typed before <GO>. A trailing `GO` is accepted and dropped,
 * since that is how the command is written on the terminal (`TOP <GO>`).
 */
export function parseDeskCommand(raw: string): DeskCommand {
  const text = raw.trim().replace(/\s*<?GO>?$/i, '').trim()
  if (!text) return { kind: 'none' }
  const upper = text.toUpperCase()
  if (/^\d+$/.test(upper)) return { kind: 'row', row: Number(upper) }
  const layout = upper.match(/^(?:LAY|LAYOUT|L)\s*([12346])$/)
  if (layout) return { kind: 'layout', layout: layout[1] as DeskLayoutId }
  if (upper === 'OPEN' || upper === 'READ') return { kind: 'open' }
  if (upper === 'THEME' || upper === 'SKIN') return { kind: 'theme' }
  if (upper === 'EXIT' || upper === 'QUIT' || upper === 'Q' || upper === 'CANCEL') return { kind: 'exit' }
  const fn = FUNCTION_BY_NAME.get(upper)
  if (fn) return { kind: 'function', id: fn }
  return { kind: 'search', query: text }
}

export type DeskSuggestion =
  | { kind: 'function'; id: DeskFunctionId; label: string; detail: string }
  | { kind: 'session'; key: string; label: string; detail: string }

/**
 * The autocomplete under the command line: functions whose mnemonic or alias
 * starts with what was typed, then sessions matching it anywhere — the
 * terminal's security lookup. Functions first, because a mnemonic is the
 * shorter, more deliberate thing to have typed.
 */
export function deskSuggestions(raw: string, sessions: Session[], limit = 8): DeskSuggestion[] {
  const text = raw.trim()
  if (!text) return []
  const upper = text.toUpperCase()
  const out: DeskSuggestion[] = []
  for (const fn of DESK_FUNCTIONS) {
    if (fn.id.startsWith(upper) || fn.aliases.some((alias) => alias.startsWith(upper))) {
      out.push({ kind: 'function', id: fn.id, label: fn.id, detail: fn.title })
    }
  }
  if (/^\d+$/.test(text)) return out.slice(0, limit)
  const needle = text.toLowerCase()
  for (const session of sessions) {
    if (out.length >= limit) break
    if (deskSessionHaystack(session).includes(needle)) {
      out.push({
        kind: 'session',
        key: deskSessionKey(session),
        label: deskTicker(session),
        detail: formatSessionTitle(session),
      })
    }
  }
  return out.slice(0, limit)
}

function deskSessionHaystack(session: Session): string {
  return [session.customTitle, session.summary, session.firstPrompt, session.sessionId, session.cwd, session.tag]
    .filter(Boolean).join(' ').toLowerCase()
}

// ── Securities ───────────────────────────────────────────────────────────────

export function deskSessionKey(session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>): string {
  return sessionIdentityKey(session)
}

const PROVIDER_CODE: Record<AgentProvider, string> = {
  claude: 'CLD', codex: 'CDX', opencode: 'OPC', copilot: 'CPL', pi: 'PI',
  lmstudio: 'LMS', 'claude-acp': 'CLA', 'codex-acp': 'CXA', acp: 'ACP',
}

export function deskProviderCode(provider: AgentProvider | undefined): string {
  return PROVIDER_CODE[provider ?? 'claude'] ?? String(provider).slice(0, 3).toUpperCase()
}

/** `CLD 3F9A2C` — a session's ticker: provider code and the tail of its id. */
export function deskTicker(session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>): string {
  const tail = session.sessionId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()
  return `${deskProviderCode(session.provider)} ${tail}`
}

export function deskSessionTime(session: Session): number {
  return typeof session.lastModified === 'number' ? session.lastModified : 0
}

function createdTime(session: Session): number {
  if (typeof session.createdAt === 'number') return session.createdAt
  if (typeof session.createdAt === 'string') {
    const parsed = Date.parse(session.createdAt)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function deskAge(ms: number, now: number): string {
  if (!ms) return '—'
  const seconds = Math.max(0, Math.floor((now - ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** `14:07` today, `OCT17` before that — how the terminal stamps a print. */
export function deskStamp(ms: number, now: number): string {
  if (!ms) return '—'
  const date = new Date(ms)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  return `${month}${String(date.getDate()).padStart(2, '0')}`
}

export function deskStatusCode(activity: DeskActivity | undefined): string {
  switch (activity) {
    case 'needs-input': return 'ASK'
    case 'running': return 'RUN'
    case 'waiting': return 'BKG'
    default: return '—'
  }
}

// ── Tables ───────────────────────────────────────────────────────────────────

export type DeskTone = 'text' | 'label' | 'up' | 'down' | 'flat' | 'alert' | 'link' | 'dim' | 'key'

export type DeskCell = { text: string; tone?: DeskTone; bold?: boolean }

export type DeskColumn = { title: string; width: number | 'flex'; align?: 'left' | 'right' }

export type DeskRow = {
  key: string
  cells: DeskCell[]
  /** The session this row is about, which selecting it loads into the desk. */
  sessionKey?: string
  /** A function this row runs instead (the directory's rows). */
  functionId?: DeskFunctionId
  /** An attention item key, opened rather than loaded. */
  attentionKey?: string
}

export type DeskTable = {
  columns: DeskColumn[]
  rows: DeskRow[]
  /** One-line strip above the column headings: totals, the loaded name. */
  summary?: DeskCell[]
  /** Shown when there are no rows. */
  empty?: string
}

export type DeskTableInput = {
  sessions: Session[]
  activity: ReadonlyMap<string, DeskActivity>
  /** Keys whose lastModified moved since the desk last looked: the upticks. */
  upticks: ReadonlySet<string>
  now: number
  alerts: DeskAlert[]
  loaded: Session | null
  loadedCards: TuiTranscriptCard[] | null
  loadedContext: ContextUsage | null
  loadedModel: string | null
  loadedMessageCount: number | null
  chartWidth: number
  chartHeight: number
}

export type DeskAlert = {
  key: string
  sessionKey: string
  provider: AgentProvider
  sessionTitle: string
  title: string
  detail?: string
  needsInput: boolean
  createdAt: number
}

function statusTone(activity: DeskActivity | undefined): DeskTone {
  return activity === 'needs-input' ? 'alert' : activity === 'running' ? 'up' : activity === 'waiting' ? 'link' : 'dim'
}

function ageTone(ms: number, now: number): DeskTone {
  if (!ms) return 'dim'
  const age = now - ms
  if (age < 5 * 60_000) return 'up'
  if (age < 60 * 60_000) return 'text'
  if (age < 24 * 60 * 60_000) return 'label'
  return 'dim'
}

export function buildMonitorTable(input: DeskTableInput): DeskTable {
  const { sessions, activity, upticks, now } = input
  const live = sessions.filter((session) => activity.has(deskSessionKey(session))).length
  const day = sessions.filter((session) => now - deskSessionTime(session) < 24 * 60 * 60_000).length
  return {
    columns: [
      { title: '#', width: 3, align: 'right' },
      { title: 'TICKER', width: 11 },
      { title: 'NAME', width: 'flex' },
      { title: 'ST', width: 3 },
      { title: 'LAST', width: 5, align: 'right' },
      { title: 'CHG', width: 3, align: 'right' },
    ],
    summary: [
      { text: `${sessions.length} SECURITIES`, tone: 'text', bold: true },
      { text: '  LIVE ', tone: 'label' },
      { text: String(live), tone: live > 0 ? 'up' : 'dim', bold: true },
      { text: '  24H ', tone: 'label' },
      { text: String(day), tone: 'text', bold: true },
    ],
    empty: 'NO SECURITIES — no sessions are listed for this provider',
    rows: sessions.map((session, index) => {
      const key = deskSessionKey(session)
      const state = activity.get(key)
      const last = deskSessionTime(session)
      const ticked = upticks.has(key)
      return {
        key,
        sessionKey: key,
        cells: [
          { text: `${index + 1})`, tone: 'key' },
          { text: deskTicker(session), tone: 'label', bold: true },
          { text: formatSessionTitle(session), tone: 'text' },
          { text: deskStatusCode(state), tone: statusTone(state), bold: Boolean(state) },
          { text: deskAge(last, now), tone: ageTone(last, now) },
          { text: ticked ? '▲' : state === 'running' ? '•' : '', tone: ticked ? 'up' : 'up' },
        ],
      }
    }),
  }
}

export function buildTopTable(input: DeskTableInput): DeskTable {
  const { sessions, now, alerts } = input
  const rows: DeskRow[] = alerts.filter((alert) => alert.needsInput).map((alert) => ({
    key: `alert:${alert.key}`,
    sessionKey: alert.sessionKey,
    attentionKey: alert.key,
    cells: [
      { text: alert.createdAt ? deskStamp(alert.createdAt, now) : 'NOW', tone: 'alert', bold: true },
      { text: '*BN', tone: 'alert', bold: true },
      { text: `${alert.sessionTitle.toUpperCase()}: ${alert.title}`, tone: 'alert', bold: true },
    ],
  }))
  const recent = [...sessions].sort((a, b) => deskSessionTime(b) - deskSessionTime(a)).slice(0, 60)
  for (const session of recent) {
    const last = deskSessionTime(session)
    const hot = now - last < 15 * 60_000
    rows.push({
      key: `news:${deskSessionKey(session)}`,
      sessionKey: deskSessionKey(session),
      cells: [
        { text: deskStamp(last, now), tone: 'text' },
        { text: deskProviderCode(session.provider), tone: 'label' },
        { text: `${hot ? '*' : ''}${formatSessionTitle(session)}`, tone: hot ? 'text' : 'flat', bold: hot },
      ],
    })
  }
  return {
    columns: [
      { title: 'TIME', width: 5 },
      { title: 'SRC', width: 3 },
      { title: 'HEADLINE', width: 'flex' },
    ],
    summary: [
      { text: 'ALL SOURCES', tone: 'text', bold: true },
      { text: '  * = PRINTED IN THE LAST 15 MIN', tone: 'dim' },
    ],
    empty: 'NO STORIES',
    rows,
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function buildDescriptionTable(input: DeskTableInput): DeskTable {
  const { loaded, activity, now, loadedCards, loadedContext, loadedModel, loadedMessageCount } = input
  if (!loaded) {
    return { columns: [{ title: 'FIELD', width: 16 }, { title: 'VALUE', width: 'flex' }], rows: [], empty: 'NO SECURITY LOADED — pick a row in MON, or type a name and <GO>' }
  }
  const key = deskSessionKey(loaded)
  const state = activity.get(key)
  const userTurns = loadedCards?.filter((card) => card.role === 'user' && card.category === 'conversation').length ?? null
  const toolCards = loadedCards?.filter((card) => card.category === 'technical' || card.category === 'diff').length ?? null
  const field = (label: string, value: string | null | undefined, tone: DeskTone = 'text', bold = false): DeskRow | null => (
    value ? { key: `des:${label}`, cells: [{ text: label, tone: 'label' }, { text: value, tone, bold }] } : null
  )
  const contextValue = loadedContext && loadedContext.maxTokens > 0
    ? `${formatTokens(loadedContext.totalTokens)} / ${formatTokens(loadedContext.maxTokens)}  (${Math.round(loadedContext.percentage)}%)`
    : null
  const contextTone: DeskTone = loadedContext ? (loadedContext.percentage >= 80 ? 'down' : loadedContext.percentage >= 50 ? 'alert' : 'up') : 'text'
  const rows = [
    field('TICKER', deskTicker(loaded), 'label', true),
    field('NAME', formatSessionTitle(loaded), 'text', true),
    field('STATUS', state === 'needs-input' ? 'NEEDS YOU' : state === 'running' ? 'TRADING' : state === 'waiting' ? 'BACKGROUND WORK' : 'IDLE', statusTone(state), true),
    field('PROVIDER', (loaded.providerDisplayName ?? loaded.provider ?? 'claude').toUpperCase()),
    field('MODEL', loadedModel),
    field('PROJECT', loaded.cwd),
    field('BRANCH', typeof loaded.gitBranch === 'string' ? loaded.gitBranch : null),
    field('LAST PRINT', deskSessionTime(loaded) ? `${deskStamp(deskSessionTime(loaded), now)}  (${deskAge(deskSessionTime(loaded), now)} ago)` : null),
    field('LISTED', createdTime(loaded) ? `${deskStamp(createdTime(loaded), now)}  (${deskAge(createdTime(loaded), now)} ago)` : null),
    field('MESSAGES', loadedMessageCount !== null ? String(loadedMessageCount) : null),
    field('PROMPTS', userTurns !== null ? String(userTurns) : null),
    field('TOOL CARDS', toolCards !== null ? String(toolCards) : null),
    field('CONTEXT', contextValue, contextTone, true),
    field('TAG', loaded.tag ?? null, 'link'),
    field('SESSION ID', loaded.sessionId, 'dim'),
    field('FIRST PROMPT', loaded.firstPrompt ? loaded.firstPrompt.replace(/\s+/g, ' ').trim() : null, 'flat'),
  ].filter((row): row is DeskRow => row !== null)
  return {
    columns: [{ title: 'FIELD', width: 13 }, { title: 'VALUE', width: 'flex' }],
    summary: [
      { text: deskTicker(loaded), tone: 'label', bold: true },
      { text: '  ', tone: 'text' },
      { text: formatSessionTitle(loaded).toUpperCase(), tone: 'text', bold: true },
    ],
    rows,
  }
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export type DeskChart = {
  /** Rows of the plot, top first; each is exactly `width` cells. */
  plot: string[]
  /** Per-column flag: the last bucket is drawn in the highlight tone. */
  lastColumn: number
  axisLabels: string[]
  timeAxis: string
  high: number
  last: number
  average: number
  total: number
  unit: string
}

/**
 * Bucket timestamps into `width` columns and draw them as a bar chart
 * `height` rows tall with eighth-block tops. Returns null with nothing to plot.
 */
export function buildDeskChart(times: number[], width: number, height: number, unit: string, span?: { start: number; end: number }): DeskChart | null {
  const valid = times.filter((time) => Number.isFinite(time) && time > 0).sort((a, b) => a - b)
  if (valid.length === 0 || width < 4 || height < 2) return null
  const start = span?.start ?? valid[0]
  const end = Math.max(span?.end ?? valid[valid.length - 1], start + 1)
  const buckets = new Array<number>(width).fill(0)
  for (const time of valid) {
    if (time < start || time > end) continue
    const index = Math.min(width - 1, Math.floor(((time - start) / (end - start)) * width))
    buckets[index] += 1
  }
  const high = Math.max(...buckets)
  const total = buckets.reduce((sum, value) => sum + value, 0)
  if (total === 0) return null
  const plot: string[] = []
  for (let row = height - 1; row >= 0; row -= 1) {
    let line = ''
    for (const value of buckets) {
      const filled = high === 0 ? 0 : (value / high) * height
      const cell = filled - row
      line += cell >= 1 ? '█' : cell > 0 ? SPARK[Math.max(0, Math.min(7, Math.round(cell * 8) - 1))] : ' '
    }
    plot.push(line)
  }
  const axisLabels = plot.map((_, index) => {
    const value = Math.round(high * (1 - index / height))
    return index === 0 || index === height - 1 || index === Math.floor(height / 2) ? String(value) : ''
  })
  const fmt = (ms: number) => {
    const date = new Date(ms)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const left = fmt(start)
  const right = fmt(end)
  const mid = fmt(start + (end - start) / 2)
  const gap = Math.max(1, width - left.length - right.length - mid.length)
  const timeAxis = `${left}${' '.repeat(Math.floor(gap / 2))}${mid}${' '.repeat(Math.ceil(gap / 2))}${right}`.slice(0, width)
  return {
    plot,
    lastColumn: width - 1,
    axisLabels,
    timeAxis,
    high,
    last: buckets[buckets.length - 1],
    average: total / width,
    total,
    unit,
  }
}

export function loadedSessionTimes(cards: TuiTranscriptCard[] | null): number[] {
  return (cards ?? []).map((card) => card.timestampMs ?? 0).filter((time) => time > 0)
}

/** The provider board: every provider as an index, 24h prints vs the prior 24h. */
export function buildIndicesTable(input: DeskTableInput): DeskTable {
  const { sessions, activity, now } = input
  const day = 24 * 60 * 60_000
  const byProvider = new Map<AgentProvider, { total: number; live: number; today: number; prior: number; last: number }>()
  for (const session of sessions) {
    const provider = session.provider ?? 'claude'
    const entry = byProvider.get(provider) ?? { total: 0, live: 0, today: 0, prior: 0, last: 0 }
    const time = deskSessionTime(session)
    entry.total += 1
    if (activity.has(deskSessionKey(session))) entry.live += 1
    if (now - time < day) entry.today += 1
    else if (now - time < 2 * day) entry.prior += 1
    entry.last = Math.max(entry.last, time)
    byProvider.set(provider, entry)
  }
  const rows = [...byProvider.entries()]
    .sort((a, b) => b[1].today - a[1].today || b[1].total - a[1].total)
    .map(([provider, entry]) => {
      const change = entry.today - entry.prior
      const pct = entry.prior > 0 ? (change / entry.prior) * 100 : entry.today > 0 ? 100 : 0
      const tone: DeskTone = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
      return {
        key: `wei:${provider}`,
        cells: [
          { text: deskProviderCode(provider), tone: 'label', bold: true } as DeskCell,
          { text: provider.toUpperCase(), tone: 'text' } as DeskCell,
          { text: String(entry.today), tone: 'text', bold: true } as DeskCell,
          { text: `${change > 0 ? '+' : ''}${change}`, tone } as DeskCell,
          { text: `${change > 0 ? '▲' : change < 0 ? '▼' : ' '}${Math.abs(pct).toFixed(1)}%`, tone } as DeskCell,
          { text: String(entry.live), tone: entry.live > 0 ? 'up' : 'dim' } as DeskCell,
          { text: String(entry.total), tone: 'flat' } as DeskCell,
          { text: deskAge(entry.last, now), tone: ageTone(entry.last, now) } as DeskCell,
        ],
      }
    })
  const today = rows.length ? [...byProvider.values()].reduce((sum, entry) => sum + entry.today, 0) : 0
  return {
    columns: [
      { title: 'IDX', width: 4 },
      { title: 'NAME', width: 'flex' },
      { title: '24H', width: 4, align: 'right' },
      { title: 'NET', width: 4, align: 'right' },
      { title: '%CHG', width: 7, align: 'right' },
      { title: 'LIVE', width: 4, align: 'right' },
      { title: 'TOT', width: 4, align: 'right' },
      { title: 'LAST', width: 4, align: 'right' },
    ],
    summary: [
      { text: 'AGENT INDICES', tone: 'text', bold: true },
      { text: '  24H PRINTS ', tone: 'label' },
      { text: String(today), tone: 'text', bold: true },
      { text: '  VS PRIOR 24H', tone: 'dim' },
    ],
    empty: 'NO INDICES',
    rows,
  }
}

function basename(path: string | undefined): string {
  if (!path) return 'NO PROJECT'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function buildMostActiveTable(input: DeskTableInput): DeskTable {
  const { sessions, activity, now } = input
  const day = 24 * 60 * 60_000
  const projects = new Map<string, { name: string; total: number; today: number; live: number; last: number; providers: Set<string>; newest: Session }>()
  for (const session of sessions) {
    const id = session.cwd ?? '(none)'
    const time = deskSessionTime(session)
    const entry = projects.get(id) ?? { name: basename(session.cwd), total: 0, today: 0, live: 0, last: 0, providers: new Set<string>(), newest: session }
    entry.total += 1
    if (now - time < day) entry.today += 1
    if (activity.has(deskSessionKey(session))) entry.live += 1
    if (time >= entry.last) { entry.last = time; entry.newest = session }
    entry.providers.add(deskProviderCode(session.provider))
    projects.set(id, entry)
  }
  const ranked = [...projects.values()].sort((a, b) => b.today - a.today || b.last - a.last)
  return {
    columns: [
      { title: '#', width: 3, align: 'right' },
      { title: 'PROJECT', width: 'flex' },
      { title: 'VOL', width: 4, align: 'right' },
      { title: 'TOT', width: 4, align: 'right' },
      { title: 'LIVE', width: 4, align: 'right' },
      { title: 'LAST', width: 4, align: 'right' },
      { title: 'SRC', width: 11 },
    ],
    summary: [
      { text: `${ranked.length} PROJECTS`, tone: 'text', bold: true },
      { text: '  VOL = SESSIONS PRINTED IN 24H', tone: 'dim' },
    ],
    empty: 'NO PROJECTS',
    rows: ranked.map((entry, index) => ({
      key: `most:${entry.name}:${index}`,
      sessionKey: deskSessionKey(entry.newest),
      cells: [
        { text: `${index + 1})`, tone: 'key' },
        { text: entry.name.toUpperCase(), tone: 'text', bold: entry.today > 0 },
        { text: String(entry.today), tone: entry.today > 0 ? 'up' : 'dim', bold: entry.today > 0 },
        { text: String(entry.total), tone: 'flat' },
        { text: String(entry.live), tone: entry.live > 0 ? 'up' : 'dim' },
        { text: deskAge(entry.last, now), tone: ageTone(entry.last, now) },
        { text: [...entry.providers].join(' '), tone: 'label' },
      ],
    })),
  }
}

export function buildAlertsTable(input: DeskTableInput): DeskTable {
  const { alerts, now } = input
  return {
    columns: [
      { title: 'AGE', width: 4, align: 'right' },
      { title: 'SRC', width: 3 },
      { title: 'SESSION', width: 22 },
      { title: 'ALERT', width: 'flex' },
    ],
    summary: [
      { text: `${alerts.filter((alert) => alert.needsInput).length} NEED YOU`, tone: alerts.some((alert) => alert.needsInput) ? 'alert' : 'dim', bold: true },
      { text: `  ${alerts.filter((alert) => !alert.needsInput).length} WAITING OR DONE`, tone: 'dim' },
    ],
    empty: 'ALL CLEAR — approvals, questions and plan reviews from every session land here',
    rows: alerts.map((alert) => ({
      key: `alrt:${alert.key}`,
      sessionKey: alert.sessionKey,
      attentionKey: alert.key,
      cells: [
        { text: alert.createdAt ? deskAge(alert.createdAt, now) : 'NOW', tone: alert.needsInput ? 'alert' : 'dim' },
        { text: deskProviderCode(alert.provider), tone: 'label' },
        { text: alert.sessionTitle, tone: 'text' },
        { text: `${alert.title}${alert.detail ? ` — ${alert.detail}` : ''}`, tone: alert.needsInput ? 'alert' : 'flat', bold: alert.needsInput },
      ],
    })),
  }
}

export function buildSessionNewsTable(input: DeskTableInput): DeskTable {
  const { loaded, loadedCards, now } = input
  if (!loaded) return { columns: [{ title: 'TIME', width: 5 }, { title: 'STORY', width: 'flex' }], rows: [], empty: 'NO SECURITY LOADED' }
  const cards = (loadedCards ?? []).filter((card) => card.compactSummary.trim())
  return {
    columns: [
      { title: 'TIME', width: 5 },
      { title: 'BY', width: 9 },
      { title: 'STORY', width: 'flex' },
    ],
    summary: [
      { text: deskTicker(loaded), tone: 'label', bold: true },
      { text: `  ${cards.length} STORIES`, tone: 'text' },
      { text: '  NEWEST FIRST', tone: 'dim' },
    ],
    empty: loadedCards ? 'NO STORIES' : 'LOADING…',
    rows: [...cards].reverse().map((card) => ({
      key: `cn:${card.key}`,
      cells: [
        { text: card.timestampMs ? deskStamp(card.timestampMs, now) : '', tone: 'text' },
        { text: card.label.toUpperCase().slice(0, 9), tone: card.role === 'user' ? 'link' : card.category === 'technical' || card.category === 'diff' ? 'label' : 'up' },
        { text: card.compactSummary.replace(/\s+/g, ' ').trim(), tone: card.role === 'user' ? 'text' : 'flat', bold: card.role === 'user' },
      ],
    })),
  }
}

export function buildHelpTable(): DeskTable {
  return {
    columns: [
      { title: 'FUNC', width: 5 },
      { title: 'TITLE', width: 19 },
      { title: 'WHAT IT SHOWS', width: 'flex' },
    ],
    summary: [{ text: 'TYPE A FUNCTION AND <GO>  ·  N <GO> PICKS ROW N  ·  LAY 1-6 <GO>  ·  OPEN · THEME · EXIT', tone: 'label' }],
    rows: DESK_FUNCTIONS.map((fn) => ({
      key: `help:${fn.id}`,
      functionId: fn.id,
      cells: [
        { text: fn.id, tone: 'key', bold: true },
        { text: fn.title.toUpperCase(), tone: 'text' },
        { text: fn.description, tone: 'flat' },
      ],
    })),
  }
}

export function buildDeskTable(fn: DeskFunctionId, input: DeskTableInput): DeskTable | null {
  switch (fn) {
    case 'MON': return buildMonitorTable(input)
    case 'TOP': return buildTopTable(input)
    case 'DES': return buildDescriptionTable(input)
    case 'WEI': return buildIndicesTable(input)
    case 'MOST': return buildMostActiveTable(input)
    case 'ALRT': return buildAlertsTable(input)
    case 'CN': return buildSessionNewsTable(input)
    case 'HELP': return buildHelpTable()
    case 'GP': return null
  }
}

// ── Cell layout ──────────────────────────────────────────────────────────────

/** Terminal cells a character occupies: wide East Asian and emoji take two. */
export function deskCharWidth(code: number): number {
  if (code < 0x1100) return code < 0x20 ? 0 : 1
  if (
    (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff)
    || (code >= 0x20000 && code <= 0x3fffd)
  ) return 2
  if (code >= 0xfe00 && code <= 0xfe0f) return 0
  return 1
}

/**
 * Pad or cut to exactly `width` cells, cutting with an ellipsis. Cell-aware,
 * because a desk is columns: one emoji in a title counted as one cell shifts
 * every column to its right by one on that row.
 */
export function deskFit(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (width <= 0) return ''
  let used = 0
  let out = ''
  const chars = Array.from(value)
  const total = chars.reduce((sum, char) => sum + deskCharWidth(char.codePointAt(0) ?? 0), 0)
  if (total <= width) {
    const pad = ' '.repeat(width - total)
    return align === 'right' ? pad + value : value + pad
  }
  for (const char of chars) {
    const w = deskCharWidth(char.codePointAt(0) ?? 0)
    if (used + w > width - 1) break
    out += char
    used += w
  }
  return `${out}…${' '.repeat(Math.max(0, width - used - 1))}`
}

/** Resolve `flex` columns to concrete widths inside `width`, one space between columns. */
export function deskColumnWidths(columns: DeskColumn[], width: number): number[] {
  const gaps = Math.max(0, columns.length - 1)
  const fixed = columns.reduce((sum, column) => sum + (column.width === 'flex' ? 0 : column.width), 0)
  const flexCount = columns.filter((column) => column.width === 'flex').length
  const spare = Math.max(0, width - fixed - gaps)
  const flexWidth = flexCount ? Math.floor(spare / flexCount) : 0
  let remainder = flexCount ? spare - flexWidth * flexCount : 0
  return columns.map((column) => {
    if (column.width !== 'flex') return column.width
    const extra = remainder > 0 ? remainder : 0
    remainder = 0
    return Math.max(4, flexWidth + extra)
  })
}

/** The ticker tape's text: live sessions first, then the newest prints. */
export function deskTapeEntries(sessions: Session[], activity: ReadonlyMap<string, DeskActivity>, upticks: ReadonlySet<string>, now: number, limit = 24): Array<{ ticker: string; name: string; status: string; tone: DeskTone; mark: string }> {
  const ordered = [...sessions].sort((a, b) => {
    const liveA = activity.has(deskSessionKey(a)) ? 1 : 0
    const liveB = activity.has(deskSessionKey(b)) ? 1 : 0
    return liveB - liveA || deskSessionTime(b) - deskSessionTime(a)
  }).slice(0, limit)
  return ordered.map((session) => {
    const key = deskSessionKey(session)
    const state = activity.get(key)
    const ticked = upticks.has(key)
    return {
      ticker: deskTicker(session),
      name: formatSessionTitle(session).slice(0, 28),
      status: state ? deskStatusCode(state) : deskAge(deskSessionTime(session), now),
      tone: state === 'needs-input' ? 'alert' : state || ticked ? 'up' : 'flat',
      mark: state === 'needs-input' ? '◆' : state || ticked ? '▲' : '▪',
    }
  })
}

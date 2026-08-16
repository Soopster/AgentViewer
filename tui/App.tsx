import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import {
  Spinner,
  StatusMessage,
} from '@inkjs/ui'
import {
  formatProviderLabel,
  formatSessionProject,
  formatSessionTitle,
  formatTranscriptCards,
  type TuiTranscriptCard,
  type TuiTranscriptCardLine,
} from './format'
import {
  THEME,
  getThemePalette,
  setActiveTheme,
  getProviderAccent,
  type TuiDensity,
  type TuiThemeMode,
  type TuiThemePalette,
} from './theme'
import {
  readTuiDensity,
  readTuiFocusMode,
  readTuiProvider,
  readTuiRailVisible,
  readTuiSessionDetail,
  readTuiSessionReaderState,
  readTuiSessions,
  readTuiShowToolCalls,
  readTuiTheme,
  readTuiTranscriptView,
  writeTuiDensity,
  writeTuiFocusMode,
  writeTuiProvider,
  writeTuiRailVisible,
  writeTuiSessionReaderState,
  writeTuiShowToolCalls,
  writeTuiTheme,
  writeTuiTranscriptView,
} from '../lib/tui/service'
import type { TuiSessionReaderState } from '../lib/tuiState'
import { stripToolCallBlocks } from '../lib/threading'
import type { ProviderSelection, Session } from '../lib/types'
import type { TuiTranscriptView } from './theme'

const PROVIDERS: ProviderSelection[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio', 'all']
const HEADER_HEIGHT = 2
const FOOTER_HEIGHT = 1
const FOOTER_MARGIN_TOP = 1
const SIDEBAR_GUTTER_WIDTH = 2
const SESSION_ENTRY_HEIGHT = 2
const PROJECT_HEADER_HEIGHT = 1
const SESSION_REFRESH_MS = 5000
const DETAIL_REFRESH_MS = 2000
const SEARCH_MAX_CHARS = 80
const RAIL_MIN_WIDTH = 26
const RAIL_MAX_WIDTH = 34
const TRANSCRIPT_BODY_PADDING_TOP = 1
const TRANSCRIPT_BODY_PADDING_BOTTOM = 2

type PaneFocus = 'sessions' | 'messages'

type SidebarEntry =
  | {
      type: 'project'
      key: string
      projectName: string
      count: number
    }
  | {
      type: 'session'
      key: string
      session: Session
      absoluteIndex: number
    }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function sessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length >= width) {
    if (width === 1) return value.slice(0, 1)
    return `${value.slice(0, width - 1)}…`
  }

  return value.padEnd(width, ' ')
}

function repeatChar(char: string, count: number): string {
  return char.repeat(Math.max(count, 0))
}

function VerticalDivider({
  height,
  color,
  backgroundColor,
}: {
  height: number
  color: string
  backgroundColor: string
}): React.JSX.Element {
  const ruleHeight = Math.max(Math.floor(height), 1)

  return (
    <Box width={1} height={ruleHeight} flexDirection="column" backgroundColor={backgroundColor} overflow="hidden">
      {Array.from({ length: ruleHeight }, (_, index) => (
        <Text key={`divider:${index}`} color={color}>|</Text>
      ))}
    </Box>
  )
}

function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  const minutes = Math.max(Math.floor(ms / 60_000), 0)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('  ·  ')
}

function formatTimeGap(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs < 30 * 60 * 1000) return null
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 90) return `${minutes}m later`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h later`
  return `${Math.round(hours / 24)}d later`
}

function formatToolLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toUpperCase()
}

function densityConfig(density: TuiDensity): {
  cardGap: number
  bodyIndent: number
  innerPadX: number
  mainMarginTop: number
  transcriptMarginTop: number
  messageHeaderHeight: number
  headerHeight: number
} {
  switch (density) {
    case 'comfortable':
      return {
        cardGap: 2,
        bodyIndent: 3,
        innerPadX: 1,
        mainMarginTop: 1,
        transcriptMarginTop: 1,
        messageHeaderHeight: 1,
        headerHeight: 2,
      }
    case 'dense':
      return {
        cardGap: 0,
        bodyIndent: 1,
        innerPadX: 0,
        mainMarginTop: 0,
        transcriptMarginTop: 0,
        messageHeaderHeight: 1,
        headerHeight: 2,
      }
    default:
      return {
        cardGap: 1,
        bodyIndent: 2,
        innerPadX: 1,
        mainMarginTop: 1,
        transcriptMarginTop: 1,
        messageHeaderHeight: 1,
        headerHeight: 2,
      }
  }
}

function uniqueProjectCount(sessions: Session[]): number {
  return new Set(sessions.map((session) => formatSessionProject(session))).size
}

function sidebarEntryHeight(entry: SidebarEntry): number {
  return entry.type === 'project' ? PROJECT_HEADER_HEIGHT : SESSION_ENTRY_HEIGHT
}

function buildSidebarEntries(sessions: Session[]): SidebarEntry[] {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const projectName = formatSessionProject(session).toUpperCase()
    counts.set(projectName, (counts.get(projectName) ?? 0) + 1)
  }

  const entries: SidebarEntry[] = []
  let currentProject: string | null = null
  sessions.forEach((session, absoluteIndex) => {
    const projectName = formatSessionProject(session).toUpperCase()
    if (projectName !== currentProject) {
      currentProject = projectName
      entries.push({
        type: 'project',
        key: `project:${projectName}:${absoluteIndex}`,
        projectName,
        count: counts.get(projectName) ?? 0,
      })
    }

    entries.push({
      type: 'session',
      key: `session:${sessionKey(session)}`,
      session,
      absoluteIndex,
    })
  })

  return entries
}

function findSidebarEntryIndex(entries: SidebarEntry[], selectedIndex: number): number {
  return entries.findIndex((entry) => entry.type === 'session' && entry.absoluteIndex === selectedIndex)
}

function selectSidebarWindow(entries: SidebarEntry[], startIndex: number, rowBudget: number): SidebarEntry[] {
  if (entries.length === 0) return []
  let usedRows = 0
  const visible: SidebarEntry[] = []
  for (let index = clamp(startIndex, 0, entries.length - 1); index < entries.length; index++) {
    const next = entries[index]
    const height = sidebarEntryHeight(next)
    if (visible.length > 0 && usedRows + height > rowBudget) break
    visible.push(next)
    usedRows += height
  }

  return visible
}

function transcriptColor(line: TuiTranscriptCardLine): string {
  switch (line.tone) {
    case 'muted':
      return THEME.muted
    case 'dim':
    case 'system':
      return THEME.dim
    case 'tool':
    case 'diff_meta':
      return THEME.cyan
    case 'result_ok':
    case 'diff_add':
      return THEME.green
    case 'result_error':
    case 'diff_remove':
      return THEME.red
    case 'thinking':
      return THEME.amber
    default:
      return THEME.text
  }
}

function transcriptBackground(line: TuiTranscriptCardLine, theme: TuiThemePalette): string {
  switch (line.tone) {
    case 'diff_add':
      return theme.diffAddBg
    case 'diff_remove':
      return theme.diffRemoveBg
    case 'diff_meta':
      return theme.diffMetaBg
    default:
      return theme.surface
  }
}

function transcriptAccent(cardRole: 'user' | 'assistant' | 'system', provider: ProviderSelection | undefined): string {
  if (cardRole === 'user') return THEME.green
  if (cardRole === 'system') return THEME.dim
  return getProviderAccent(provider ?? 'claude')
}

type LineGroup =
  | { type: 'text'; lines: TuiTranscriptCardLine[] }
  | { type: 'tool'; toolLine: TuiTranscriptCardLine; bodyLines: TuiTranscriptCardLine[] }

function groupBodyLines(lines: TuiTranscriptCardLine[]): LineGroup[] {
  const groups: LineGroup[] = []
  let i = 0

  while (i < lines.length) {
    if (lines[i].tone === 'tool') {
      const toolLine = lines[i]
      i++
      const bodyLines: TuiTranscriptCardLine[] = []
      while (i < lines.length && lines[i].tone !== 'tool') {
        bodyLines.push(lines[i])
        i++
      }
      groups.push({ type: 'tool', toolLine, bodyLines })
    } else {
      const textLines: TuiTranscriptCardLine[] = []
      while (i < lines.length && lines[i].tone !== 'tool') {
        textLines.push(lines[i])
        i++
      }
      if (textLines.length > 0) groups.push({ type: 'text', lines: textLines })
    }
  }

  return groups
}

function findCardIndex(cards: TuiTranscriptCard[], key: string | null): number {
  if (!key) return -1
  return cards.findIndex((card) => card.key === key)
}

function previewBodyLines(card: TuiTranscriptCard): TuiTranscriptCardLine[] {
  return card.lines.filter((line) => line.text.length > 0)
}

function collapsedBodyRows(card: TuiTranscriptCard): number {
  return Math.max(card.lines.filter((line) => line.text.length > 0).length, 1)
}

function expandedBodyRows(card: TuiTranscriptCard): number {
  let rows = 0

  for (const line of card.expandedLines) {
    if (line.tone !== 'tool') {
      rows += 1
      continue
    }

    const toolMatch = line.text.match(/^tool (\S+)(?:: (.*))?$/)
    const toolTarget = toolMatch?.[2] ?? ''
    rows += toolTarget ? 2 : 1
  }

  return Math.max(rows, 1)
}

type CardLandmark = {
  kind: 'resume' | 'unread' | 'day' | 'gap'
  text: string
}

function transcriptLandmarks(
  cards: TuiTranscriptCard[],
  index: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
): CardLandmark[] {
  const card = cards[index]
  if (!card) return []
  const previous = index > 0 ? cards[index - 1] : null
  const landmarks: CardLandmark[] = []

  if (index === resumeMarkerIndex) {
    landmarks.push({
      kind: 'resume',
      text: 'LAST READ POSITION',
    })
  }

  if (index === unreadBoundaryIndex && pendingNewCount > 0) {
    landmarks.push({
      kind: 'unread',
      text: `NEW SINCE LAST READ  ${pendingNewCount} message${pendingNewCount === 1 ? '' : 's'}`,
    })
  }

  if (!previous || previous.dayKey !== card.dayKey) {
    if (card.dayLabel) landmarks.push({ kind: 'day', text: card.dayLabel.toUpperCase() })
  } else if (card.timestampMs != null && previous.timestampMs != null) {
    const gap = formatTimeGap(card.timestampMs - previous.timestampMs)
    if (gap) landmarks.push({ kind: 'gap', text: gap.toUpperCase() })
  }

  return landmarks
}

function cardHeight(
  cards: TuiTranscriptCard[],
  index: number,
  expandedKeys: Set<string>,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
  expandedBorderRows: number,
): number {
  const card = cards[index]
  const bodyRows = expandedKeys.has(card.key)
    ? expandedBodyRows(card)
    : collapsedBodyRows(card)
  const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
  return landmarkRows + 1 + bodyRows + expandedBorderRows + cardGap
}

function selectTranscriptWindow(
  cards: TuiTranscriptCard[],
  startIndex: number,
  rowBudget: number,
  expandedKeys: Set<string>,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
  expandedBorderRows: number,
): { cards: TuiTranscriptCard[]; endIndex: number } {
  if (cards.length === 0) return { cards: [], endIndex: -1 }

  const visible: TuiTranscriptCard[] = []
  let usedRows = 0
  let endIndex = clamp(startIndex, 0, cards.length - 1)

  for (let index = clamp(startIndex, 0, cards.length - 1); index < cards.length; index++) {
    const next = cards[index]
    const nextHeight = cardHeight(
      cards,
      index,
      expandedKeys,
      cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      expandedBorderRows,
    )
    if (visible.length > 0 && usedRows + nextHeight > rowBudget) break
    visible.push(next)
    usedRows += nextHeight
    endIndex = index
  }

  return { cards: visible, endIndex }
}

function windowStartForCursor(
  cards: TuiTranscriptCard[],
  cursorIndex: number,
  rowBudget: number,
  expandedKeys: Set<string>,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
  expandedBorderRows: number,
): number {
  if (cards.length === 0) return 0
  let start = clamp(cursorIndex, 0, cards.length - 1)
  let usedRows = cardHeight(
    cards,
    start,
    expandedKeys,
    cardGap,
    resumeMarkerIndex,
    unreadBoundaryIndex,
    pendingNewCount,
    expandedBorderRows,
  )

  while (start > 0) {
    const nextHeight = cardHeight(
      cards,
      start - 1,
      expandedKeys,
      cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      expandedBorderRows,
    )
    if (usedRows + nextHeight > rowBudget) break
    start -= 1
    usedRows += nextHeight
  }

  return start
}

function Scrollbar({
  total,
  visible,
  offset,
  height,
  trackColor,
  thumbColor,
}: {
  total: number
  visible: number
  offset: number
  height: number
  trackColor: string
  thumbColor: string
}) {
  if (height <= 0) return null
  const showThumb = total > visible && height >= 2
  const thumbHeight = showThumb ? Math.max(1, Math.round((visible / total) * height)) : 0
  const maxScroll = Math.max(total - visible, 1)
  const thumbStart = showThumb
    ? Math.min(Math.round((offset / maxScroll) * (height - thumbHeight)), height - thumbHeight)
    : 0

  return (
    <Box flexDirection="column" width={1}>
      {Array.from({ length: height }, (_, i) => {
        const inThumb = showThumb && i >= thumbStart && i < thumbStart + thumbHeight
        return (
          <Text key={i} color={inThumb ? thumbColor : trackColor}>
            {inThumb ? '█' : '│'}
          </Text>
        )
      })}
    </Box>
  )
}

export default function App() {
  const { exit } = useApp()
  const { stdout } = useStdout()

  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [themeMode, setThemeMode] = useState<TuiThemeMode>('light')
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<Awaited<ReturnType<typeof readTuiSessionDetail>> | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [focusedPane, setFocusedPane] = useState<PaneFocus>('sessions')
  const [focusMode, setFocusMode] = useState(false)
  const [density, setDensity] = useState<TuiDensity>('balanced')
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [transcriptView, setTranscriptView] = useState<TuiTranscriptView>('conversation')
  const [railVisible, setRailVisible] = useState(true)
  const [sidebarTopKey, setSidebarTopKey] = useState<string | null>(null)
  const [transcriptTopKey, setTranscriptTopKey] = useState<string | null>(null)
  const [transcriptCursorKey, setTranscriptCursorKey] = useState<string | null>(null)
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(() => new Set())
  const [collapsedCardKeys, setCollapsedCardKeys] = useState<Set<string>>(() => new Set())
  const [followTail, setFollowTail] = useState(true)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [unreadBoundaryKey, setUnreadBoundaryKey] = useState<string | null>(null)
  const [resumeMarkerKey, setResumeMarkerKey] = useState<string | null>(null)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [terminalRows, setTerminalRows] = useState(stdout.rows ?? 40)
  const [terminalColumns, setTerminalColumns] = useState(stdout.columns ?? 120)
  const [restoredReaderState, setRestoredReaderState] = useState<{
    sessionKey: string | null
    loaded: boolean
    state: TuiSessionReaderState | null
  }>({
    sessionKey: null,
    loaded: false,
    state: null,
  })

  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const quittingRef = useRef(false)
  const readerStateWriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousTranscriptRef = useRef<{ sessionKey: string | null; keys: string[] }>({
    sessionKey: null,
    keys: [],
  })

  const selectedIndex = useMemo(() => {
    if (sessions.length === 0) return -1
    if (!selectedSessionKey) return 0
    return sessions.findIndex((session) => sessionKey(session) === selectedSessionKey)
  }, [selectedSessionKey, sessions])

  const selectedSession = selectedIndex >= 0 ? sessions[selectedIndex] ?? null : sessions[0] ?? null
  const selectedSessionIdentity = selectedSession ? sessionKey(selectedSession) : null
  const selectedSessionTarget = useMemo<Session | null>(() => (
    selectedSession
      ? {
          sessionId: selectedSession.sessionId,
          provider: selectedSession.provider,
        }
      : null
  ), [selectedSessionIdentity])
  const theme = getThemePalette(themeMode)
  const densityState = densityConfig(density)
  const providerAccent = getProviderAccent(provider)
  const showPaneBorders = themeMode !== 'light'
  const paneBorderCols = showPaneBorders ? 2 : 0
  const paneBorderRows = showPaneBorders ? 2 : 0
  const expandedCardBorderRows = 1
  const paneBorderStyle = 'single'
  const inactivePaneBorderColor = themeMode === 'light' ? theme.border : theme.border
  const activePaneBorderColor = themeMode === 'light' ? theme.border2 : theme.border2
  const railPaneBg = theme.bg
  const messagePaneBg = theme.bg
  const showRail = (!focusMode && railVisible) || providerMenuOpen
  const effectiveFocus = !showRail ? 'messages' : focusedPane
  const sidebarAccent = effectiveFocus === 'sessions' ? theme.violet : theme.muted
  const projectCount = useMemo(() => uniqueProjectCount(sessions), [sessions])
  const currentProjectName = selectedSession ? formatSessionProject(selectedSession) : 'THIS PROJECT'
  const selectedSessionShortId = selectedSession?.sessionId.slice(-12) ?? 'NONE'
  const statusLabel = loadingSessions ? 'SYNCING' : refreshingSessions ? 'REFRESHING' : 'LIVE'
  const statusColor = loadingSessions ? theme.amber : refreshingSessions ? theme.cyan : theme.green
  const globalHeaderHeight = focusMode ? 1 : densityState.headerHeight
  const transcriptHeaderHeight = focusMode ? 0 : densityState.messageHeaderHeight

  const contentHeight = Math.max(
    terminalRows - globalHeaderHeight - densityState.mainMarginTop - FOOTER_MARGIN_TOP - FOOTER_HEIGHT,
    12,
  )
  const sidebarWidth = showRail ? clamp(Math.floor((terminalColumns - 2) * 0.24), RAIL_MIN_WIDTH, RAIL_MAX_WIDTH) : 0
  const gutterWidth = showRail ? (themeMode === 'light' ? 1 : SIDEBAR_GUTTER_WIDTH) : 0
  const messagePaneWidth = Math.max(terminalColumns - 2 - sidebarWidth - gutterWidth, 48)
  const sidebarInnerWidth = Math.max(sidebarWidth - 2 - paneBorderCols, 28)
  const messageInnerWidth = Math.max(messagePaneWidth - 2 - paneBorderCols, 44)
  const providerPanelHeight = providerMenuOpen ? PROVIDERS.length + 3 : 4
  const sidebarRowBudget = Math.max(contentHeight - providerPanelHeight - 3 - paneBorderRows, 6)
  const sessionTitleWidth = Math.max(sidebarInnerWidth - 2, 18)
  const sessionMetaWidth = Math.max(sidebarInnerWidth - 2, 18)
  const transcriptLineWidth = Math.max(messageInnerWidth - 2, 24)
  const transcriptViewportRows = Math.max(
    contentHeight
      - transcriptHeaderHeight
      - densityState.transcriptMarginTop
      - (error ? 1 : 0)
      - (!followTail && pendingNewCount > 0 ? 1 : 0)
      - paneBorderRows
      - TRANSCRIPT_BODY_PADDING_TOP
      - TRANSCRIPT_BODY_PADDING_BOTTOM,
    4,
  )

  const transcriptCards = useMemo(() => {
    if (!sessionDetail) return []
    const messages = showToolCalls
      ? sessionDetail.threadedMessages
      : stripToolCallBlocks(sessionDetail.threadedMessages)
    return formatTranscriptCards(messages, density)
  }, [density, sessionDetail, showToolCalls])
  const resolvedExpandedKeys = useMemo(() => {
    const next = new Set<string>()
    for (const card of transcriptCards) {
      const shouldAutoFold = transcriptView === 'conversation' && card.autoFold
      const isExpanded = shouldAutoFold
        ? expandedCardKeys.has(card.key)
        : !collapsedCardKeys.has(card.key)
      if (isExpanded) next.add(card.key)
    }
    return next
  }, [collapsedCardKeys, expandedCardKeys, transcriptCards, transcriptView])
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const searchMatches = useMemo(() => {
    if (!normalizedSearchQuery) return []
    return transcriptCards.flatMap((card, index) => {
      const haystack = `${card.label}\n${card.searchText}`.toLowerCase()
      return haystack.includes(normalizedSearchQuery) ? [index] : []
    })
  }, [normalizedSearchQuery, transcriptCards])
  const cursorIndex = useMemo(() => {
    if (transcriptCards.length === 0) return -1
    const index = findCardIndex(transcriptCards, transcriptCursorKey)
    if (index >= 0) return index
    return followTail ? transcriptCards.length - 1 : 0
  }, [followTail, transcriptCards, transcriptCursorKey])
  const unreadBoundaryIndex = useMemo(
    () => findCardIndex(transcriptCards, unreadBoundaryKey),
    [transcriptCards, unreadBoundaryKey],
  )
  const resumeMarkerIndex = useMemo(
    () => findCardIndex(transcriptCards, resumeMarkerKey),
    [resumeMarkerKey, transcriptCards],
  )
  const topIndex = useMemo(() => {
    if (transcriptCards.length === 0) return 0
    const index = findCardIndex(transcriptCards, transcriptTopKey)
    if (index >= 0) return index
    return windowStartForCursor(
      transcriptCards,
      Math.max(cursorIndex, 0),
      transcriptViewportRows,
      resolvedExpandedKeys,
      densityState.cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      expandedCardBorderRows,
    )
  }, [cursorIndex, densityState.cardGap, expandedCardBorderRows, pendingNewCount, resolvedExpandedKeys, resumeMarkerIndex, transcriptCards, transcriptTopKey, transcriptViewportRows, unreadBoundaryIndex])
  const visibleTranscriptWindow = useMemo(() => (
    selectTranscriptWindow(
      transcriptCards,
      topIndex,
      transcriptViewportRows,
      resolvedExpandedKeys,
      densityState.cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      expandedCardBorderRows,
    )
  ), [densityState.cardGap, expandedCardBorderRows, pendingNewCount, resolvedExpandedKeys, resumeMarkerIndex, topIndex, transcriptCards, transcriptViewportRows, unreadBoundaryIndex])
  const visibleTranscriptCards = visibleTranscriptWindow.cards
  const visibleTranscriptEndIndex = visibleTranscriptWindow.endIndex
  const transcriptWindowEnd = visibleTranscriptEndIndex >= 0 ? visibleTranscriptEndIndex + 1 : 0
  const foldedTechnicalCount = useMemo(
    () => transcriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, transcriptCards],
  )
  const visibleFoldedTechnicalCount = useMemo(
    () => visibleTranscriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, visibleTranscriptCards],
  )

  const sidebarEntries = useMemo(() => buildSidebarEntries(sessions), [sessions])
  const selectedSidebarEntryIndex = useMemo(
    () => findSidebarEntryIndex(sidebarEntries, selectedIndex),
    [selectedIndex, sidebarEntries],
  )
  const sidebarTopIndex = useMemo(() => {
    if (sidebarEntries.length === 0) return 0
    const index = sidebarEntries.findIndex((entry) => entry.key === sidebarTopKey)
    if (index >= 0) return index
    return Math.max(selectedSidebarEntryIndex, 0)
  }, [selectedSidebarEntryIndex, sidebarEntries, sidebarTopKey])
  const visibleSidebarEntries = useMemo(() => (
    selectSidebarWindow(sidebarEntries, sidebarTopIndex, sidebarRowBudget)
  ), [sidebarEntries, sidebarRowBudget, sidebarTopIndex])
  const jumpToTranscriptIndex = useCallback((index: number) => {
    if (transcriptCards.length === 0) return
    const nextIndex = clamp(index, 0, transcriptCards.length - 1)
    const nextStart = windowStartForCursor(
      transcriptCards,
      nextIndex,
      transcriptViewportRows,
      resolvedExpandedKeys,
      densityState.cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      expandedCardBorderRows,
    )
    setTranscriptCursorKey(transcriptCards[nextIndex].key)
    setTranscriptTopKey(transcriptCards[nextStart].key)
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) setPendingNewCount(0)
  }, [densityState.cardGap, expandedCardBorderRows, pendingNewCount, resolvedExpandedKeys, resumeMarkerIndex, transcriptCards, transcriptViewportRows, unreadBoundaryIndex])

  const jumpToTranscriptKey = useCallback((key: string | null) => {
    if (!key) return
    const index = findCardIndex(transcriptCards, key)
    if (index >= 0) jumpToTranscriptIndex(index)
  }, [jumpToTranscriptIndex, transcriptCards])

  const jumpToTranscriptTail = useCallback(() => {
    if (transcriptCards.length === 0) return
    jumpToTranscriptIndex(transcriptCards.length - 1)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  }, [jumpToTranscriptIndex, transcriptCards.length])

  const jumpToUnreadBoundary = useCallback(() => {
    if (unreadBoundaryIndex >= 0) {
      jumpToTranscriptIndex(unreadBoundaryIndex)
      return
    }
    jumpToTranscriptTail()
  }, [jumpToTranscriptIndex, jumpToTranscriptTail, unreadBoundaryIndex])

  const jumpToResumeMarker = useCallback(() => {
    jumpToTranscriptKey(resumeMarkerKey)
  }, [jumpToTranscriptKey, resumeMarkerKey])

  const moveSelection = useCallback((delta: number) => {
    if (sessions.length === 0) return
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
    const nextIndex = clamp(currentIndex + delta, 0, sessions.length - 1)
    setSelectedSessionKey(sessionKey(sessions[nextIndex]))
    setError(null)
  }, [selectedIndex, sessions])

  const moveCursor = useCallback((delta: number) => {
    if (transcriptCards.length === 0) return
    const nextIndex = clamp((cursorIndex >= 0 ? cursorIndex : 0) + delta, 0, transcriptCards.length - 1)
    setTranscriptCursorKey(transcriptCards[nextIndex].key)
    if (nextIndex < topIndex || nextIndex > visibleTranscriptEndIndex) {
      const nextStart = windowStartForCursor(
        transcriptCards,
        nextIndex,
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
        expandedCardBorderRows,
      )
      setTranscriptTopKey(transcriptCards[nextStart].key)
    }
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) setPendingNewCount(0)
  }, [
    cursorIndex,
    densityState.cardGap,
    expandedCardBorderRows,
    pendingNewCount,
    resolvedExpandedKeys,
    resumeMarkerIndex,
    topIndex,
    transcriptCards,
    transcriptViewportRows,
    unreadBoundaryIndex,
    visibleTranscriptEndIndex,
  ])

  const moveViewport = useCallback((direction: -1 | 1) => {
    const step = Math.max(Math.floor(visibleTranscriptCards.length / 2), 1)
    moveCursor(direction * step)
  }, [moveCursor, visibleTranscriptCards.length])

  const toggleExpansion = useCallback(() => {
    const card = cursorIndex >= 0 ? transcriptCards[cursorIndex] : null
    if (!card) return
    const shouldAutoFold = transcriptView === 'conversation' && card.autoFold
    const isExpanded = resolvedExpandedKeys.has(card.key)

    if (shouldAutoFold) {
      setCollapsedCardKeys((current) => {
        if (!current.has(card.key)) return current
        const next = new Set(current)
        next.delete(card.key)
        return next
      })
      setExpandedCardKeys((current) => {
        const next = new Set(current)
        if (isExpanded) next.delete(card.key)
        else next.add(card.key)
        return next
      })
      return
    }

    setExpandedCardKeys((current) => {
      if (!current.has(card.key)) return current
      const next = new Set(current)
      next.delete(card.key)
      return next
    })
    setCollapsedCardKeys((current) => {
      const next = new Set(current)
      if (isExpanded) next.add(card.key)
      else next.delete(card.key)
      return next
    })
  }, [cursorIndex, resolvedExpandedKeys, transcriptCards, transcriptView])

  const jumpToMatchingCard = useCallback((direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => {
    if (transcriptCards.length === 0) return
    let index = cursorIndex >= 0 ? cursorIndex + direction : direction > 0 ? 0 : transcriptCards.length - 1
    while (index >= 0 && index < transcriptCards.length) {
      if (predicate(transcriptCards[index])) {
        jumpToTranscriptIndex(index)
        return
      }
      index += direction
    }
  }, [cursorIndex, jumpToTranscriptIndex, transcriptCards])

  const toggleRail = useCallback(async () => {
    const nextVisible = !railVisible
    setRailVisible(nextVisible)
    if (!nextVisible && focusedPane === 'sessions') {
      setFocusedPane('messages')
    }

    try {
      await writeTuiRailVisible(nextVisible)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store reader layout')
    }
  }, [focusedPane, railVisible])

  const refreshSessions = useCallback(async (
    nextProvider: ProviderSelection,
    preserveSelection = true,
    foreground = true,
  ) => {
    const requestId = ++sessionRequestRef.current

    if (foreground) {
      setLoadingSessions(true)
      setRefreshingSessions(false)
    } else {
      setRefreshingSessions(true)
    }

    if (!providerSwitchRef.current) setError(null)

    try {
      const nextSessions = await readTuiSessions(nextProvider)
      if (requestId !== sessionRequestRef.current) return

      setSessions(nextSessions)
      setSelectedSessionKey((currentKey) => {
        if (nextSessions.length === 0) return null
        if (preserveSelection && currentKey) {
          const matched = nextSessions.find((session) => sessionKey(session) === currentKey)
          if (matched) return sessionKey(matched)
        }

        return sessionKey(nextSessions[0])
      })
    } catch (err) {
      if (requestId !== sessionRequestRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
      setSessions([])
      setSelectedSessionKey(null)
    } finally {
      if (requestId === sessionRequestRef.current) {
        setLoadingSessions(false)
        setRefreshingSessions(false)
      }
    }
  }, [])

  const refreshSelectedSessionDetail = useCallback(async (session: Session, foreground = true) => {
    const requestId = ++detailRequestRef.current
    if (foreground) {
      setLoadingDetail(true)
    }
    setError((current) => current?.startsWith('Failed to load session detail') ? null : current)

    try {
      const detail = await readTuiSessionDetail(session)
      if (requestId !== detailRequestRef.current) return
      setSessionDetail(detail)
    } catch (err) {
      if (requestId !== detailRequestRef.current) return
      setSessionDetail(null)
      setError(err instanceof Error ? `Failed to load session detail: ${err.message}` : 'Failed to load session detail')
    } finally {
      if (requestId === detailRequestRef.current && foreground) {
        setLoadingDetail(false)
      }
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setTerminalRows(stdout.rows ?? process.stdout.rows ?? 40)
      setTerminalColumns(stdout.columns ?? process.stdout.columns ?? 120)
    }

    handleResize()
    stdout.on('resize', handleResize)
    return () => {
      stdout.off('resize', handleResize)
    }
  }, [stdout])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [configuredTheme, configuredProvider, configuredRailVisible, configuredFocusMode, configuredDensity, configuredTranscriptView, configuredShowToolCalls] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiTranscriptView(),
          readTuiShowToolCalls(),
        ])
        if (cancelled) return
        setThemeMode(configuredTheme)
        setActiveTheme(configuredTheme)
        setProvider(configuredProvider)
        setRailVisible(configuredRailVisible)
        setFocusMode(configuredFocusMode)
        setDensity(configuredDensity)
        setTranscriptView(configuredTranscriptView)
        setShowToolCalls(configuredShowToolCalls)
        if (!configuredRailVisible || configuredFocusMode) setFocusedPane('messages')

        await refreshSessions(configuredProvider, false, true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to initialize TUI')
        setLoadingSessions(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshSessions])

  const toggleTheme = useCallback(async () => {
    const nextTheme: TuiThemeMode = themeMode === 'light'
      ? 'dark'
      : themeMode === 'dark'
      ? 'cyber'
      : 'light'
    setThemeMode(nextTheme)
    setActiveTheme(nextTheme)

    try {
      await writeTuiTheme(nextTheme)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    }
  }, [themeMode])

  const toggleFocusMode = useCallback(async () => {
    const next = !focusMode
    setFocusMode(next)
    if (next) setFocusedPane('messages')

    try {
      await writeTuiFocusMode(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store focus mode')
    }
  }, [focusMode])

  const cycleDensity = useCallback(async () => {
    const next: TuiDensity = density === 'comfortable'
      ? 'balanced'
      : density === 'balanced'
      ? 'dense'
      : 'comfortable'
    setDensity(next)

    try {
      await writeTuiDensity(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store density')
    }
  }, [density])

  const cycleTranscriptView = useCallback(async () => {
    const next: TuiTranscriptView = transcriptView === 'conversation' ? 'full' : 'conversation'
    setTranscriptView(next)

    try {
      await writeTuiTranscriptView(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store transcript view')
    }
  }, [transcriptView])

  useEffect(() => {
    if (!selectedSessionTarget) {
      setSessionDetail(null)
      setLoadingDetail(false)
      return
    }

    setSessionDetail(null)
    void refreshSelectedSessionDetail(selectedSessionTarget, true)
  }, [refreshSelectedSessionDetail, selectedSessionIdentity, selectedSessionTarget])

  useEffect(() => {
    if (selectedSession || sessions.length === 0) return
    setSelectedSessionKey(sessionKey(sessions[0]))
  }, [selectedSession, sessions])

  useEffect(() => {
    let cancelled = false

    setTranscriptTopKey(null)
    setTranscriptCursorKey(null)
    setExpandedCardKeys(new Set())
    setCollapsedCardKeys(new Set())
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    setResumeMarkerKey(null)
    setSearchMode(false)
    setSearchQuery('')
    setSearchMatchIndex(0)
    setRestoredReaderState({
      sessionKey: selectedSessionKey,
      loaded: selectedSessionKey == null,
      state: null,
    })

    if (!selectedSessionKey) {
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const state = await readTuiSessionReaderState(selectedSessionKey)
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: selectedSessionKey,
          loaded: true,
          state,
        })
        if (state) {
          setExpandedCardKeys(new Set(state.expandedKeys))
          setCollapsedCardKeys(new Set(state.collapsedKeys))
          if (state.followTail === false) {
            setTranscriptTopKey(state.topKey ?? state.cursorKey)
            setTranscriptCursorKey(state.cursorKey)
            setFollowTail(false)
            setResumeMarkerKey(state.cursorKey)
          }
        }
      } catch {
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: selectedSessionKey,
          loaded: true,
          state: null,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedSessionKey])

  useEffect(() => {
    let active = true
    const interval = setInterval(() => {
      if (!active || loadingSessions || providerSwitchRef.current) return
      void refreshSessions(provider, true, false)
    }, SESSION_REFRESH_MS)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [loadingSessions, provider, refreshSessions])

  useEffect(() => {
    if (!selectedSessionTarget) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }, DETAIL_REFRESH_MS)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [refreshSelectedSessionDetail, selectedSessionIdentity, selectedSessionTarget])

  const openProviderMenu = useCallback(() => {
    setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
    setProviderMenuOpen(true)
  }, [provider])

  const closeProviderMenu = useCallback(() => {
    setProviderMenuOpen(false)
    setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
  }, [provider])

  const chooseProvider = useCallback(async (nextProvider: ProviderSelection) => {
    if (nextProvider === provider) {
      closeProviderMenu()
      return
    }

    closeProviderMenu()
    providerSwitchRef.current = true
    setProvider(nextProvider)
    setSessionDetail(null)
    setSelectedSessionKey(null)
    setSidebarTopKey(null)
    setTranscriptTopKey(null)
    setTranscriptCursorKey(null)
    setExpandedCardKeys(new Set())
    setCollapsedCardKeys(new Set())
    setFollowTail(true)
    setPendingNewCount(0)
    setResumeMarkerKey(null)
    setRestoredReaderState({ sessionKey: null, loaded: false, state: null })
    setError(null)

    try {
      await writeTuiProvider(nextProvider)
      await refreshSessions(nextProvider, false, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      providerSwitchRef.current = false
    }
  }, [closeProviderMenu, provider, refreshSessions])

  const quit = useCallback(() => {
    if (quittingRef.current) return
    quittingRef.current = true
    exit()

    setTimeout(() => {
      process.exit(0)
    }, 25)
  }, [exit])

  useEffect(() => {
    setExpandedCardKeys((current) => {
      const allowed = new Set(transcriptCards.map((card) => card.key))
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
    setCollapsedCardKeys((current) => {
      const allowed = new Set(transcriptCards.map((card) => card.key))
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
  }, [transcriptCards])

  useEffect(() => {
    if (sidebarEntries.length === 0) {
      setSidebarTopKey(null)
      return
    }

    const selectedEntryIndex = Math.max(selectedSidebarEntryIndex, 0)
    const visibleKeys = new Set(visibleSidebarEntries.map((entry) => entry.key))
    const selectedEntryKey = sidebarEntries[selectedEntryIndex]?.key
    if (!selectedEntryKey) return

    if (!sidebarTopKey || !sidebarEntries.some((entry) => entry.key === sidebarTopKey)) {
      setSidebarTopKey(sidebarEntries[selectedEntryIndex].key)
      return
    }

    if (!visibleKeys.has(selectedEntryKey)) {
      setSidebarTopKey(sidebarEntries[selectedEntryIndex].key)
    }
  }, [selectedSidebarEntryIndex, sidebarEntries, sidebarTopKey, visibleSidebarEntries])

  useEffect(() => {
    const currentKeys = transcriptCards.map((card) => card.key)
    const previous = previousTranscriptRef.current
    const sameSession = previous.sessionKey === selectedSessionKey

    if (currentKeys.length === 0) {
      setTranscriptCursorKey(null)
      setTranscriptTopKey(null)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (!sameSession) {
      if (restoredReaderState.sessionKey !== selectedSessionKey || !restoredReaderState.loaded) {
        return
      }

      const restoredState = restoredReaderState.state
      if (restoredState?.followTail === false) {
        const fallbackIndex = findCardIndex(transcriptCards, restoredState.cursorKey)
        const targetIndex = fallbackIndex >= 0 ? fallbackIndex : Math.max(cursorIndex, 0)
        const nextStart = windowStartForCursor(
          transcriptCards,
          targetIndex,
          transcriptViewportRows,
          resolvedExpandedKeys,
          densityState.cardGap,
          resumeMarkerIndex,
          unreadBoundaryIndex,
          pendingNewCount,
          expandedCardBorderRows,
        )
        setTranscriptCursorKey(transcriptCards[targetIndex]?.key ?? transcriptCards[0].key)
        setTranscriptTopKey(
          transcriptCards[findCardIndex(transcriptCards, restoredState.topKey) >= 0 ? findCardIndex(transcriptCards, restoredState.topKey) : nextStart]?.key
            ?? transcriptCards[nextStart].key,
        )
        setFollowTail(false)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(restoredState.cursorKey)
        previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
        return
      }

      const lastIndex = transcriptCards.length - 1
      const nextStart = windowStartForCursor(
        transcriptCards,
        lastIndex,
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
        expandedCardBorderRows,
      )
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart].key)
      setFollowTail(true)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      setResumeMarkerKey(null)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (followTail) {
      const lastIndex = transcriptCards.length - 1
      const nextStart = windowStartForCursor(
        transcriptCards,
        lastIndex,
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
        expandedCardBorderRows,
      )
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart].key)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    const previousLastKey = previous.keys.at(-1) ?? null
    const previousLastIndex = previousLastKey ? currentKeys.indexOf(previousLastKey) : -1
    const appendedCount = previousLastIndex >= 0
      ? currentKeys.length - previousLastIndex - 1
      : 0

    if (appendedCount > 0) {
      setPendingNewCount(appendedCount)
      setUnreadBoundaryKey((current) => {
        if (current && currentKeys.includes(current)) return current
        const firstNewKey = currentKeys[previousLastIndex + 1] ?? null
        return firstNewKey
      })
    }

    setTranscriptCursorKey((current) => {
      if (current && currentKeys.includes(current)) return current
      return transcriptCards[Math.max(cursorIndex, 0)]?.key ?? transcriptCards[0].key
    })
    setTranscriptTopKey((current) => {
      if (current && currentKeys.includes(current)) return current
      const nextStart = windowStartForCursor(
        transcriptCards,
        Math.max(cursorIndex, 0),
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
        expandedCardBorderRows,
      )
      return transcriptCards[nextStart]?.key ?? transcriptCards[0].key
    })
    previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
  }, [
    cursorIndex,
    densityState.cardGap,
    expandedCardBorderRows,
    followTail,
    pendingNewCount,
    resolvedExpandedKeys,
    resumeMarkerIndex,
    restoredReaderState,
    selectedSessionKey,
    transcriptCards,
    transcriptViewportRows,
    unreadBoundaryIndex,
  ])

  useEffect(() => {
    if (transcriptCards.length === 0 || cursorIndex < 0) return
    if (followTail) {
      const lastIndex = transcriptCards.length - 1
      const nextStart = windowStartForCursor(
        transcriptCards,
        lastIndex,
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
        expandedCardBorderRows,
      )
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart].key)
      return
    }

    if (cursorIndex < topIndex || cursorIndex > visibleTranscriptEndIndex) {
      const nextStart = windowStartForCursor(
        transcriptCards,
        cursorIndex,
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
        expandedCardBorderRows,
      )
      setTranscriptTopKey(transcriptCards[nextStart].key)
    }
  }, [
    cursorIndex,
    densityState.cardGap,
    expandedCardBorderRows,
    followTail,
    pendingNewCount,
    resolvedExpandedKeys,
    resumeMarkerIndex,
    topIndex,
    transcriptCards,
    transcriptViewportRows,
    unreadBoundaryIndex,
    visibleTranscriptEndIndex,
  ])

  useEffect(() => {
    if (!selectedSessionKey || !restoredReaderState.loaded || restoredReaderState.sessionKey !== selectedSessionKey) {
      return
    }

    const validKeys = new Set(transcriptCards.map((card) => card.key))
    const persistState: TuiSessionReaderState = {
      followTail,
      cursorKey: followTail ? null : (transcriptCursorKey && validKeys.has(transcriptCursorKey) ? transcriptCursorKey : null),
      topKey: followTail ? null : (transcriptTopKey && validKeys.has(transcriptTopKey) ? transcriptTopKey : null),
      expandedKeys: [...expandedCardKeys].filter((key) => validKeys.has(key)),
      collapsedKeys: [...collapsedCardKeys].filter((key) => validKeys.has(key)),
    }

    if (readerStateWriteTimeoutRef.current) {
      clearTimeout(readerStateWriteTimeoutRef.current)
    }

    readerStateWriteTimeoutRef.current = setTimeout(() => {
      void writeTuiSessionReaderState(selectedSessionKey, persistState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to store reader position')
      })
    }, 150)

    return () => {
      if (readerStateWriteTimeoutRef.current) {
        clearTimeout(readerStateWriteTimeoutRef.current)
        readerStateWriteTimeoutRef.current = null
      }
    }
  }, [
    collapsedCardKeys,
    expandedCardKeys,
    followTail,
    restoredReaderState,
    selectedSessionKey,
    transcriptCards,
    transcriptCursorKey,
    transcriptTopKey,
  ])

  useEffect(() => {
    if (searchMatches.length === 0) {
      setSearchMatchIndex(0)
      return
    }
    setSearchMatchIndex((current) => clamp(current, 0, searchMatches.length - 1))
  }, [searchMatches.length])

  const jumpToSearchMatch = useCallback((matchOffset: number) => {
    if (searchMatches.length === 0) return
    const nextMatchIndex = (searchMatchIndex + matchOffset + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(nextMatchIndex)
    jumpToTranscriptIndex(searchMatches[nextMatchIndex])
  }, [jumpToTranscriptIndex, searchMatchIndex, searchMatches])

  useInput((input, key) => {
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false)
        return
      }

      if (key.return) {
        if (searchMatches.length > 0) jumpToTranscriptIndex(searchMatches[searchMatchIndex] ?? 0)
        setSearchMode(false)
        return
      }

      if (key.backspace || key.delete) {
        setSearchQuery((current) => current.slice(0, -1))
        return
      }

      if (input && !key.ctrl && !key.meta && !key.tab && input >= ' ') {
        setSearchQuery((current) => current.length >= SEARCH_MAX_CHARS ? current : `${current}${input}`)
      }
      return
    }

    if (providerMenuOpen) {
      if (input === 'q' || (key.ctrl && input === 'c')) {
        quit()
        return
      }

      if (key.escape || input === 'p') {
        closeProviderMenu()
        return
      }

      if (input === 'j' || key.downArrow) {
        setProviderMenuIndex((current) => clamp(current + 1, 0, PROVIDERS.length - 1))
        return
      }

      if (input === 'k' || key.upArrow) {
        setProviderMenuIndex((current) => clamp(current - 1, 0, PROVIDERS.length - 1))
        return
      }

      if (input === 'g') {
        setProviderMenuIndex(0)
        return
      }

      if (input === 'G') {
        setProviderMenuIndex(PROVIDERS.length - 1)
        return
      }

      if (key.return || input === ' ') {
        void chooseProvider(PROVIDERS[providerMenuIndex])
      }
      return
    }

    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      quit()
      return
    }

    if ((key.tab || input === '\t') && showRail) {
      setFocusedPane((current) => current === 'sessions' ? 'messages' : 'sessions')
      return
    }

    if (effectiveFocus === 'sessions' && (input === 'j' || key.downArrow)) {
      moveSelection(1)
      return
    }

    if (effectiveFocus === 'sessions' && (input === 'k' || key.upArrow)) {
      moveSelection(-1)
      return
    }

    if (effectiveFocus === 'messages' && (input === 'j' || key.downArrow)) {
      moveCursor(1)
      return
    }

    if (effectiveFocus === 'messages' && (input === 'k' || key.upArrow)) {
      moveCursor(-1)
      return
    }

    if (effectiveFocus === 'sessions' && input === 'g') {
      if (sessions[0]) setSelectedSessionKey(sessionKey(sessions[0]))
      return
    }

    if (effectiveFocus === 'sessions' && input === 'G') {
      const last = sessions.at(-1)
      if (last) setSelectedSessionKey(sessionKey(last))
      return
    }

    if (effectiveFocus === 'messages' && input === 'g') {
      jumpToTranscriptIndex(0)
      return
    }

    if (effectiveFocus === 'messages' && input === 'G') {
      jumpToTranscriptTail()
      return
    }

    if (effectiveFocus === 'messages' && key.pageDown) {
      moveCursor(Math.max(visibleTranscriptCards.length - 1, 1))
      return
    }

    if (effectiveFocus === 'messages' && key.pageUp) {
      moveCursor(-Math.max(visibleTranscriptCards.length - 1, 1))
      return
    }

    if (effectiveFocus === 'messages' && key.ctrl && input === 'd') {
      moveViewport(1)
      return
    }

    if (effectiveFocus === 'messages' && key.ctrl && input === 'u') {
      moveViewport(-1)
      return
    }

    if (effectiveFocus === 'messages' && (input === 'e' || key.return)) {
      toggleExpansion()
      return
    }

    if (effectiveFocus === 'messages' && input === 'f') {
      jumpToTranscriptTail()
      return
    }

    if (effectiveFocus === 'messages' && input === 'u') {
      jumpToUnreadBoundary()
      return
    }

    if (effectiveFocus === 'messages' && input === 'm') {
      jumpToResumeMarker()
      return
    }

    if (effectiveFocus === 'messages' && input === '/') {
      setSearchMode(true)
      return
    }

    if (effectiveFocus === 'messages' && input === '[' && searchMatches.length > 0) {
      setSearchMatchIndex(0)
      jumpToTranscriptIndex(searchMatches[0])
      return
    }

    if (effectiveFocus === 'messages' && input === ']' && searchMatches.length > 0) {
      const lastMatchIndex = searchMatches.length - 1
      setSearchMatchIndex(lastMatchIndex)
      jumpToTranscriptIndex(searchMatches[lastMatchIndex])
      return
    }

    if (effectiveFocus === 'messages' && input === 'n' && searchMatches.length > 0) {
      jumpToSearchMatch(1)
      return
    }

    if (effectiveFocus === 'messages' && input === 'N' && searchMatches.length > 0) {
      jumpToSearchMatch(-1)
      return
    }

    if (effectiveFocus === 'messages' && input === '(') {
      jumpToMatchingCard(-1, (card) => card.category === 'conversation')
      return
    }

    if (effectiveFocus === 'messages' && input === ')') {
      jumpToMatchingCard(1, (card) => card.category === 'conversation')
      return
    }

    if (effectiveFocus === 'messages' && input === '{') {
      jumpToMatchingCard(-1, (card) => card.category !== 'conversation')
      return
    }

    if (effectiveFocus === 'messages' && input === '}') {
      jumpToMatchingCard(1, (card) => card.category !== 'conversation')
      return
    }

    if (input === 'p') {
      openProviderMenu()
      return
    }

    if (input === 't') {
      void toggleTheme()
      return
    }

    if (input === 'h') {
      void toggleRail()
      return
    }

    if (input === 'z') {
      void toggleFocusMode()
      return
    }

    if (input === 'd') {
      void cycleDensity()
      return
    }

    if (input === 'v') {
      void cycleTranscriptView()
      return
    }

    if (input === 'X') {
      setShowToolCalls((v) => {
        const next = !v
        void writeTuiShowToolCalls(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
        return next
      })
      return
    }

    if (input === 'r') {
      void refreshSessions(provider)
      if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }
  }, { isActive: true })

  const readerTitle = useMemo(() => (
    sessionDetail?.info?.customTitle
    ?? sessionDetail?.info?.summary
    ?? selectedSession?.customTitle
    ?? selectedSession?.summary
    ?? '(untitled session)'
  ), [selectedSession, sessionDetail?.info])
  const readerModel = sessionDetail?.info?.currentModel ?? 'unknown'
  const readerTag = sessionDetail?.info?.tag ?? selectedSession?.tag ?? 'none'
  const readerMeta = joinMeta([
    `project ${currentProjectName}`,
    `model ${readerModel}`,
    readerTag !== 'none' ? `tag ${readerTag}` : null,
  ])
  const readerMode = followTail ? 'live mode' : pendingNewCount > 0 ? 'new content waiting' : 'reading mode'
  const readerState = joinMeta([
    `position ${transcriptCards.length === 0 ? '0' : `${Math.max(cursorIndex, 0) + 1}`}/${transcriptCards.length}`,
    readerMode,
    transcriptView === 'conversation' ? 'conversation-first' : 'full transcript',
    pendingNewCount > 0 ? `+${pendingNewCount} new` : null,
    unreadBoundaryIndex >= 0 ? 'u unread' : null,
    resumeMarkerIndex >= 0 ? 'm last read' : null,
    foldedTechnicalCount > 0 ? `${visibleFoldedTechnicalCount}/${foldedTechnicalCount} folded` : null,
    normalizedSearchQuery ? `/${searchQuery} ${searchMatches.length === 0 ? '0' : `${searchMatchIndex + 1}/${searchMatches.length}`}` : null,
  ])
  const readerDensity = density.toUpperCase()
  const slimBarTitle = fitText(
    focusMode ? readerTitle : 'AGENT VIEWER',
    Math.max(terminalColumns - 54, 20),
  )
  const topBarStatus = joinMeta([
    themeMode.toUpperCase(),
    focusMode ? 'FOCUS' : effectiveFocus.toUpperCase(),
    provider.toUpperCase(),
    readerDensity,
    transcriptView === 'conversation' ? 'READER' : 'FULL',
  ])
  const topBarStatusText = fitText(topBarStatus, Math.max(terminalColumns - slimBarTitle.length - 8, 16))
  const showReaderNotice = !followTail && pendingNewCount > 0
  const footerText = fitText(
    `tab focus  j/k move  ctrl-u/d page  () convo  {} tech  u unread  m mark  / search  n/N hits  f live  e fold  v ${transcriptView}  d ${density}  h rail  z focus  p provider  X ${showToolCalls ? 'hide tools' : 'show tools'}  r refresh  q quit`,
    Math.max(terminalColumns - 2, 16),
  )
  const headerLeftText = fitText(
    joinMeta([`${projectCount} projects`, `${sessions.length} sessions`, readerMeta]),
    Math.max(Math.floor((terminalColumns - 2) * 0.52), 28),
  )
  const headerRightText = fitText(
    joinMeta([statusLabel.toLowerCase(), selectedSessionShortId, readerState]),
    Math.max(terminalColumns - 4 - headerLeftText.length, 20),
  )

  return (
      <Box flexDirection="column" paddingX={1} height={terminalRows} overflow="hidden" backgroundColor={theme.bg}>
      <Box justifyContent="space-between" backgroundColor={theme.surface} paddingX={1}>
        <Text bold color={theme.text}>{slimBarTitle}</Text>
        <Text color={theme.muted}>{topBarStatusText}</Text>
      </Box>

      {!focusMode ? (
        <Box justifyContent="space-between" backgroundColor={theme.surface2} paddingX={1}>
          <Text color={theme.muted}>{headerLeftText}</Text>
          <Text color={theme.dim}>{headerRightText}</Text>
        </Box>
      ) : null}

      <Box flexGrow={1} height={contentHeight} overflow="hidden" marginTop={densityState.mainMarginTop}>
        {showRail ? (
          <>
            {themeMode === 'light' ? (
              <Box
                width={sidebarWidth}
                height={contentHeight}
                flexDirection="column"
                overflow="hidden"
                backgroundColor={theme.surface}
              >
                <Box flexDirection="column" backgroundColor={theme.surface} paddingX={1} paddingY={1} height={providerPanelHeight} overflow="hidden">
                  <Text bold color={theme.violet}>READER RAIL</Text>
                  {providerMenuOpen ? (
                    PROVIDERS.map((item, index) => (
                      <Text key={item} color={index === providerMenuIndex ? getProviderAccent(item) : theme.muted}>
                        {index === providerMenuIndex ? '>' : ' '}
                        {' '}
                        {item.toUpperCase()}
                      </Text>
                    ))
                  ) : (
                    <>
                      <Text color={theme.muted}>provider <Text color={providerAccent}>{provider.toUpperCase()}</Text></Text>
                      <Text color={theme.dim}>{projectCount} projects  {sessions.length} sessions</Text>
                      <Text color={effectiveFocus === 'sessions' ? theme.violet : theme.cyan}>tab focus  h hide rail</Text>
                    </>
                  )}
                </Box>

                <Box marginTop={1} backgroundColor={theme.surface} paddingX={1}>
                  <Text bold color={theme.text}>SESSIONS <Text color={theme.dim}>{sessions.length}</Text></Text>
                </Box>

                <Box flexGrow={1} flexDirection="row" marginTop={1} backgroundColor={theme.surface2} overflow="hidden">
                  <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1} overflow="hidden">
                    {visibleSidebarEntries.length === 0 ? (
                      loadingSessions ? (
                        <Spinner label="Loading sessions" />
                      ) : (
                        <Text color={theme.dim}>No sessions found</Text>
                      )
                    ) : (
                      visibleSidebarEntries.map((entry) => {
                        if (entry.type === 'project') {
                          return (
                            <Text key={entry.key} bold color={theme.dim}>
                              {fitText(`${entry.projectName} ${entry.count}`, sidebarInnerWidth - 2)}
                            </Text>
                          )
                        }

                        const selected = entry.absoluteIndex === selectedIndex
                        const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
                        const activityTime = entry.session.lastModified ?? entry.session.createdAt
                        const title = fitText(formatSessionTitle(entry.session), sessionTitleWidth)
                        const meta = fitText(
                          `${formatProviderLabel(entry.session.provider)} ${timeAgo(activityTime)} ${entry.session.sessionId.slice(-8)}`,
                          sessionMetaWidth,
                        )

                        return (
                          <Box
                            key={entry.key}
                            flexDirection="column"
                            backgroundColor={selected ? theme.surface : theme.surface2}
                            paddingX={1}
                            overflow="hidden"
                          >
                            <Text color={selected ? theme.text : theme.muted}>{title}</Text>
                            <Text color={selected ? sessionAccent : theme.dim}>{meta}</Text>
                          </Box>
                        )
                      })
                    )}
                  </Box>
                  <Scrollbar
                    total={sidebarEntries.length}
                    visible={visibleSidebarEntries.length}
                    offset={sidebarTopIndex}
                    height={Math.max(sidebarRowBudget, 1)}
                    trackColor={theme.surface3}
                    thumbColor={sidebarAccent}
                  />
                </Box>
              </Box>
            ) : (
              <Box
                width={sidebarWidth}
                flexDirection="column"
                overflow="hidden"
                borderStyle={showPaneBorders ? paneBorderStyle : undefined}
                borderColor={effectiveFocus === 'sessions' ? activePaneBorderColor : inactivePaneBorderColor}
                backgroundColor={railPaneBg}
              >
                <Box flexDirection="column" backgroundColor={theme.surface} paddingX={1} paddingY={1} height={providerPanelHeight} overflow="hidden">
                  <Text bold color={theme.violet}>READER RAIL</Text>
                  {providerMenuOpen ? (
                    PROVIDERS.map((item, index) => (
                      <Text key={item} color={index === providerMenuIndex ? getProviderAccent(item) : theme.muted}>
                        {index === providerMenuIndex ? '>' : ' '}
                        {' '}
                        {item.toUpperCase()}
                      </Text>
                    ))
                  ) : (
                    <>
                      <Text color={theme.muted}>provider <Text color={providerAccent}>{provider.toUpperCase()}</Text></Text>
                      <Text color={theme.dim}>{projectCount} projects  {sessions.length} sessions</Text>
                      <Text color={effectiveFocus === 'sessions' ? theme.violet : theme.cyan}>tab focus  h hide rail</Text>
                    </>
                  )}
                </Box>

                <Box marginTop={1} backgroundColor={theme.surface} paddingX={1}>
                  <Text bold color={theme.text}>SESSIONS <Text color={theme.dim}>{sessions.length}</Text></Text>
                </Box>

                <Box flexGrow={1} flexDirection="row" marginTop={1} backgroundColor={theme.surface2} overflow="hidden">
                  <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1} overflow="hidden">
                    {visibleSidebarEntries.length === 0 ? (
                      loadingSessions ? (
                        <Spinner label="Loading sessions" />
                      ) : (
                        <Text color={theme.dim}>No sessions found</Text>
                      )
                    ) : (
                      visibleSidebarEntries.map((entry) => {
                        if (entry.type === 'project') {
                          return (
                            <Text key={entry.key} bold color={theme.dim}>
                              {fitText(`${entry.projectName} ${entry.count}`, sidebarInnerWidth - 2)}
                            </Text>
                          )
                        }

                        const selected = entry.absoluteIndex === selectedIndex
                        const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
                        const activityTime = entry.session.lastModified ?? entry.session.createdAt
                        const title = fitText(formatSessionTitle(entry.session), sessionTitleWidth)
                        const meta = fitText(
                          `${formatProviderLabel(entry.session.provider)} ${timeAgo(activityTime)} ${entry.session.sessionId.slice(-8)}`,
                          sessionMetaWidth,
                        )

                        return (
                          <Box
                            key={entry.key}
                            flexDirection="column"
                            backgroundColor={selected ? theme.surface : theme.surface2}
                            paddingX={1}
                            overflow="hidden"
                          >
                            <Text color={selected ? theme.text : theme.muted}>{title}</Text>
                            <Text color={selected ? sessionAccent : theme.dim}>{meta}</Text>
                          </Box>
                        )
                      })
                    )}
                  </Box>
                  <Scrollbar
                    total={sidebarEntries.length}
                    visible={visibleSidebarEntries.length}
                    offset={sidebarTopIndex}
                    height={Math.max(sidebarRowBudget, 1)}
                    trackColor={theme.surface3}
                    thumbColor={sidebarAccent}
                  />
                </Box>
              </Box>
            )}
            {themeMode === 'light' ? (
              <VerticalDivider
                height={contentHeight}
                color={inactivePaneBorderColor}
                backgroundColor={theme.bg}
              />
            ) : (
              <Box width={gutterWidth} />
            )}
          </>
        ) : null}

        {themeMode === 'light' ? (
          <Box
            width={messagePaneWidth}
            height={contentHeight}
            flexDirection="column"
            overflow="hidden"
            backgroundColor={theme.surface}
          >
            {!focusMode ? (
              <Box justifyContent="space-between" backgroundColor={theme.surface} paddingX={1} height={densityState.messageHeaderHeight} overflow="hidden">
                {selectedSession ? (
                  <Text color={theme.text}>{fitText(readerTitle, Math.max(messageInnerWidth - 20, 16))}</Text>
                ) : (
                  <Text color={theme.dim}>No session selected</Text>
                )}
                <Text>
                  <Text color={providerAccent}>{provider.toUpperCase()}</Text>
                  <Text color={theme.dim}>  </Text>
                  <Text color={theme.muted}>{transcriptCards.length} messages</Text>
                </Text>
              </Box>
            ) : null}

            <Box
              flexGrow={1}
              flexDirection="row"
              marginTop={focusMode ? 0 : densityState.transcriptMarginTop}
              backgroundColor={theme.surface2}
              overflow="hidden"
            >
              <Box
                flexGrow={1}
                flexDirection="column"
                paddingX={densityState.innerPadX}
                paddingTop={TRANSCRIPT_BODY_PADDING_TOP}
                paddingBottom={TRANSCRIPT_BODY_PADDING_BOTTOM}
                overflow="hidden"
              >
                {error ? (
                  <StatusMessage variant="error">
                    {fitText(error, Math.max(messageInnerWidth - 8, 16))}
                  </StatusMessage>
                ) : null}

                {showReaderNotice ? (
                  <StatusMessage variant="info">
                    {fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, Math.max(messageInnerWidth - 8, 16))}
                  </StatusMessage>
                ) : null}

                {loadingDetail ? (
                  <Spinner label="Loading transcript" />
                ) : visibleTranscriptCards.length === 0 ? (
                  <Text color={theme.dim}>No messages.</Text>
                ) : (
                  visibleTranscriptCards.map((card, windowIndex) => {
                    const absoluteIndex = topIndex + windowIndex
                    const isSelected = card.key === transcriptCursorKey
                    const hasCursor = isSelected && effectiveFocus === 'messages'
                    const isExpanded = resolvedExpandedKeys.has(card.key)
                    const expandedLines = isExpanded ? card.expandedLines : null
                    const accent = transcriptAccent(card.role, card.provider ?? provider)
                    const timestamp = card.timestamp ?? ''
                    const bodyLineWidth = Math.max(
                      transcriptLineWidth - densityState.bodyIndent - 1,
                      20,
                    )
                    const collapsedLines = card.lines
                    const isSearchHit = normalizedSearchQuery.length > 0
                      && `${card.label}\n${card.searchText}`.toLowerCase().includes(normalizedSearchQuery)
                    const isLatest = absoluteIndex === transcriptCards.length - 1
                    const landmarks = transcriptLandmarks(
                      transcriptCards,
                      absoluteIndex,
                      resumeMarkerIndex,
                      unreadBoundaryIndex,
                      pendingNewCount,
                    )
                    const cardShellBg = hasCursor
                      ? theme.surface2
                      : isSelected
                      ? theme.surface2
                      : undefined
                    const headerBg = hasCursor
                      ? theme.surface3
                      : isSelected
                      ? theme.surface3
                      : undefined
                    const bodyBg = isSelected
                      ? hasCursor
                        ? theme.surface2
                        : theme.surface2
                      : undefined
                    const railColor = hasCursor
                      ? accent
                      : isSelected
                      ? theme.border2
                      : theme.surface2
                    const borderLineColor = hasCursor ? accent : isSelected ? theme.border2 : theme.dim
                    const marker = hasCursor ? '>' : isSelected ? ':' : '⏺'
                    const timestampColor = hasCursor
                      ? theme.muted
                      : isSelected
                      ? theme.text
                      : theme.dim
                    const isAutoFoldedTechnical = transcriptView === 'conversation' && card.autoFold && !isExpanded
                    const headerMeta = joinMeta([
                      timestamp || null,
                      isLatest ? 'latest' : null,
                      isSearchHit ? 'match' : null,
                      isAutoFoldedTechnical ? 'folded' : null,
                      `e ${isExpanded ? 'collapse' : 'expand'}`,
                    ])
                    const markerColor = isSelected ? accent : theme.muted
                    const maxLabelWidth = Math.max(transcriptLineWidth - 2 - 1 - 2 - headerMeta.length, 4)
                    const titleLabel = card.label.length > maxLabelWidth ? card.label.slice(0, maxLabelWidth - 1) + '…' : card.label
                    const titleFill = '─'.repeat(Math.max(transcriptLineWidth - 2 - titleLabel.length - 2 - headerMeta.length, 0))

                    return (
                      <React.Fragment key={card.key}>
                        {landmarks.map((landmark, landmarkIndex) => {
                          const color = landmark.kind === 'resume'
                            ? theme.cyan
                            : landmark.kind === 'unread'
                            ? theme.amber
                            : landmark.kind === 'day'
                            ? theme.violet
                            : theme.dim
                          return (
                            <Box key={`${card.key}:landmark:${landmarkIndex}`} paddingX={densityState.innerPadX}>
                              <Text color={color}>{landmark.text}</Text>
                            </Box>
                          )
                        })}
                        <Box
                          flexDirection="row"
                          marginBottom={densityState.cardGap}
                          overflow="hidden"
                          backgroundColor={cardShellBg}
                        >
                          <Box flexGrow={1} flexDirection="column">
                            <Box overflow="hidden">
                              <Text color={borderLineColor}>─</Text>
                              <Text color={markerColor}>{marker} </Text>
                              <Text bold color={accent}>{titleLabel}</Text>
                              <Text color={timestampColor}>{'  '}{headerMeta}</Text>
                              <Text color={borderLineColor}>{titleFill}</Text>
                            </Box>
                            <Box flexDirection="column" marginLeft={densityState.bodyIndent} backgroundColor={bodyBg}>
                            {isExpanded && expandedLines && expandedLines.length > 0 ? (
                              expandedLines.map((ln, lnIndex) => {
                                if (ln.tone === 'tool') {
                                  const tm = ln.text.match(/^tool (\S+)(?:: (.*))?$/)
                                  const tn = formatToolLabel(tm?.[1] ?? 'TOOL')
                                  const tt = tm?.[2] ?? ''
                                  return (
                                    <Box key={`${card.key}:exp:${lnIndex}`} flexDirection="column" backgroundColor={theme.surface3} paddingX={densityState.innerPadX}>
                                      <Text bold color={theme.cyan}>{fitText(tn, bodyLineWidth - 2)}</Text>
                                      {tt ? <Text color={theme.muted}>{fitText(tt, bodyLineWidth - 2)}</Text> : null}
                                    </Box>
                                  )
                                }
                                return (
                                  <Box key={`${card.key}:exp:${lnIndex}`} backgroundColor={transcriptBackground(ln, theme)} paddingX={densityState.innerPadX}>
                                    <Text color={transcriptColor(ln)}>
                                      {fitText(ln.text, bodyLineWidth - 2)}
                                    </Text>
                                  </Box>
                                )
                              })
                            ) : (
                              <>
                                {collapsedLines.map((ln, lnIndex) => (
                                  <Box
                                    key={`${card.key}:c${lnIndex}`}
                                    backgroundColor={transcriptBackground(ln, theme)}
                                    paddingX={densityState.innerPadX}
                                  >
                                    <Text color={transcriptColor(ln)}>
                                      {fitText(ln.text, Math.max(bodyLineWidth - 2, 16))}
                                    </Text>
                                  </Box>
                                ))}
                              </>
                            )}
                          </Box>
                            <Box overflow="hidden">
                              <Text color={borderLineColor}>{'─'.repeat(transcriptLineWidth)}</Text>
                            </Box>
                        </Box>
                        </Box>
                      </React.Fragment>
                    )
                  })
                )}
              </Box>
              <Scrollbar
                total={transcriptCards.length}
                visible={visibleTranscriptCards.length}
                offset={topIndex}
                height={Math.max(transcriptViewportRows, 1)}
                trackColor={theme.surface3}
                thumbColor={effectiveFocus === 'messages' ? theme.cyan : theme.dim}
              />
            </Box>
          </Box>
        ) : (
          <Box
            flexGrow={1}
            flexDirection="column"
            overflow="hidden"
            borderStyle={showPaneBorders ? paneBorderStyle : undefined}
            borderColor={effectiveFocus === 'messages' ? activePaneBorderColor : inactivePaneBorderColor}
            backgroundColor={messagePaneBg}
          >
            {!focusMode ? (
              <Box justifyContent="space-between" backgroundColor={theme.surface} paddingX={1} height={densityState.messageHeaderHeight} overflow="hidden">
                {selectedSession ? (
                  <Text color={theme.text}>{fitText(readerTitle, Math.max(messageInnerWidth - 20, 16))}</Text>
                ) : (
                  <Text color={theme.dim}>No session selected</Text>
                )}
                <Text>
                  <Text color={providerAccent}>{provider.toUpperCase()}</Text>
                  <Text color={theme.dim}>  </Text>
                  <Text color={theme.muted}>{transcriptCards.length} messages</Text>
                </Text>
              </Box>
            ) : null}

            <Box
              flexGrow={1}
              flexDirection="row"
              marginTop={focusMode ? 0 : densityState.transcriptMarginTop}
              backgroundColor={theme.surface2}
              overflow="hidden"
            >
              <Box
                flexGrow={1}
                flexDirection="column"
                paddingX={densityState.innerPadX}
                paddingTop={TRANSCRIPT_BODY_PADDING_TOP}
                paddingBottom={TRANSCRIPT_BODY_PADDING_BOTTOM}
                overflow="hidden"
              >
                {error ? (
                  <StatusMessage variant="error">
                    {fitText(error, Math.max(messageInnerWidth - 8, 16))}
                  </StatusMessage>
                ) : null}

                {showReaderNotice ? (
                  <StatusMessage variant="info">
                    {fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, Math.max(messageInnerWidth - 8, 16))}
                  </StatusMessage>
                ) : null}

                {loadingDetail ? (
                  <Spinner label="Loading transcript" />
                ) : visibleTranscriptCards.length === 0 ? (
                  <Text color={theme.dim}>No messages.</Text>
                ) : (
                  visibleTranscriptCards.map((card, windowIndex) => {
                  const absoluteIndex = topIndex + windowIndex
                  const isSelected = card.key === transcriptCursorKey
                  const hasCursor = isSelected && effectiveFocus === 'messages'
                  const isExpanded = resolvedExpandedKeys.has(card.key)
                  const expandedLines = isExpanded ? card.expandedLines : null
                  const accent = transcriptAccent(card.role, card.provider ?? provider)
                  const timestamp = card.timestamp ?? ''
                  const bodyLineWidth = Math.max(
                    transcriptLineWidth - densityState.bodyIndent - 1,
                    20,
                  )
                  const collapsedLines = card.lines
                  const isSearchHit = normalizedSearchQuery.length > 0
                    && `${card.label}\n${card.searchText}`.toLowerCase().includes(normalizedSearchQuery)
                  const isLatest = absoluteIndex === transcriptCards.length - 1
                  const landmarks = transcriptLandmarks(
                    transcriptCards,
                    absoluteIndex,
                    resumeMarkerIndex,
                    unreadBoundaryIndex,
                    pendingNewCount,
                  )
                  const cardShellBg = hasCursor
                    ? theme.surface2
                    : isSelected
                    ? theme.surface2
                    : undefined
                  const headerBg = hasCursor
                    ? theme.surface3
                    : isSelected
                    ? theme.surface3
                    : undefined
                  const bodyBg = isSelected
                    ? hasCursor
                      ? theme.surface2
                      : theme.surface2
                    : undefined
                  const railColor = hasCursor
                    ? accent
                    : isSelected
                    ? theme.border2
                    : theme.surface2
                  const borderLineColor = hasCursor ? accent : isSelected ? theme.border2 : theme.dim
                  const marker = hasCursor ? '>' : isSelected ? ':' : '⏺'
                  const timestampColor = hasCursor
                    ? theme.muted
                    : isSelected
                    ? theme.text
                    : theme.dim
                  const isAutoFoldedTechnical = transcriptView === 'conversation' && card.autoFold && !isExpanded
                  const headerMeta = joinMeta([
                    timestamp || null,
                    isLatest ? 'latest' : null,
                    isSearchHit ? 'match' : null,
                    isAutoFoldedTechnical ? 'folded' : null,
                    `e ${isExpanded ? 'collapse' : 'expand'}`,
                  ])
                  const markerColor = isSelected ? accent : theme.muted
                  const maxLabelWidth = Math.max(transcriptLineWidth - 2 - 1 - 2 - headerMeta.length, 4)
                  const titleLabel = card.label.length > maxLabelWidth ? card.label.slice(0, maxLabelWidth - 1) + '…' : card.label
                  const titleFill = '─'.repeat(Math.max(transcriptLineWidth - 2 - titleLabel.length - 2 - headerMeta.length, 0))

                  return (
                    <React.Fragment key={card.key}>
                      {landmarks.map((landmark, landmarkIndex) => {
                        const color = landmark.kind === 'resume'
                          ? theme.cyan
                          : landmark.kind === 'unread'
                          ? theme.amber
                          : landmark.kind === 'day'
                          ? theme.violet
                          : theme.dim
                        return (
                          <Box key={`${card.key}:landmark:${landmarkIndex}`} paddingX={densityState.innerPadX}>
                            <Text color={color}>{landmark.text}</Text>
                          </Box>
                        )
                      })}
                      <Box
                        flexDirection="row"
                        marginBottom={densityState.cardGap}
                        overflow="hidden"
                        backgroundColor={cardShellBg}
                        >
                          <Box
                            flexGrow={1}
                            flexDirection="column"
                          >
                            <Box overflow="hidden">
                              <Text color={borderLineColor}>─</Text>
                              <Text color={markerColor}>{marker} </Text>
                              <Text bold color={accent}>{titleLabel}</Text>
                              <Text color={timestampColor}>{'  '}{headerMeta}</Text>
                              <Text color={borderLineColor}>{titleFill}</Text>
                            </Box>
                          <Box flexDirection="column" marginLeft={densityState.bodyIndent} backgroundColor={bodyBg}>
                          {isExpanded && expandedLines && expandedLines.length > 0 ? (
                            expandedLines.map((ln, lnIndex) => {
                                if (ln.tone === 'tool') {
                                  const tm = ln.text.match(/^tool (\S+)(?:: (.*))?$/)
                                  const tn = formatToolLabel(tm?.[1] ?? 'TOOL')
                                  const tt = tm?.[2] ?? ''
                                  return (
                                    <Box key={`${card.key}:exp:${lnIndex}`} flexDirection="column" backgroundColor={theme.surface3} paddingX={densityState.innerPadX}>
                                      <Text bold color={theme.cyan}>{fitText(tn, bodyLineWidth - 2)}</Text>
                                      {tt ? <Text color={theme.muted}>{fitText(tt, bodyLineWidth - 2)}</Text> : null}
                                    </Box>
                                  )
                                }
                                return (
                                  <Box key={`${card.key}:exp:${lnIndex}`} backgroundColor={transcriptBackground(ln, theme)} paddingX={densityState.innerPadX}>
                                    <Text color={transcriptColor(ln)}>
                                      {fitText(ln.text, bodyLineWidth - 2)}
                                    </Text>
                                  </Box>
                                )
                              })
                          ) : (
                            <>
                              {collapsedLines.map((ln, lnIndex) => (
                                <Box
                                  key={`${card.key}:c${lnIndex}`}
                                  backgroundColor={transcriptBackground(ln, theme)}
                                  paddingX={densityState.innerPadX}
                                >
                                  <Text color={transcriptColor(ln)}>
                                    {fitText(ln.text, Math.max(bodyLineWidth - 2, 16))}
                                  </Text>
                                </Box>
                              ))}
                            </>
                          )}
                        </Box>
                            <Box overflow="hidden">
                              <Text color={borderLineColor}>{'─'.repeat(transcriptLineWidth)}</Text>
                            </Box>
                      </Box>
                      </Box>
                    </React.Fragment>
                  )
                })
              )}
            </Box>
            <Scrollbar
              total={transcriptCards.length}
              visible={visibleTranscriptCards.length}
              offset={topIndex}
              height={Math.max(transcriptViewportRows, 1)}
              trackColor={theme.surface3}
              thumbColor={effectiveFocus === 'messages' ? theme.cyan : theme.dim}
            />
          </Box>
        </Box>
        )}
      </Box>

      <Box marginTop={FOOTER_MARGIN_TOP}>
        {searchMode ? (
          <Text color={theme.dim}>
            {fitText(
              `SEARCH /${searchQuery || ''}  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}  enter jump  esc close  [ first  ] last  n next  N prev`,
              Math.max(terminalColumns - 2, 16),
            )}
          </Text>
        ) : (
          <Text color={theme.dim}>{footerText}</Text>
        )}
      </Box>
      </Box>
  )
}

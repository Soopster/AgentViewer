/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RGBA, SyntaxStyle } from '@opentui/core'
import type { ScrollBoxRenderable, SelectOption } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import {
  formatProviderLabel,
  formatSessionProject,
  formatSessionTitle,
  formatTranscriptCards,
  type TuiTranscriptCard,
  type TuiTranscriptCardLine,
} from '../format'
import {
  THEME,
  getProviderAccent,
  getThemePalette,
  setActiveTheme,
  type TuiDensity,
  type TuiThemeMode,
  type TuiThemePalette,
  type TuiTranscriptView,
} from '../theme'
import {
  readTuiDensity,
  readTuiFocusMode,
  readTuiProvider,
  readTuiRailVisible,
  readTuiSessionDetail,
  readTuiSessionReaderState,
  readTuiSessions,
  readTuiTheme,
  readTuiTranscriptView,
  writeTuiDensity,
  writeTuiFocusMode,
  writeTuiProvider,
  writeTuiRailVisible,
  writeTuiSessionReaderState,
  writeTuiTheme,
  writeTuiTranscriptView,
  type TuiSessionDetail,
} from '../../lib/tui/service'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import type { ProviderSelection, Session } from '../../lib/types'

const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']

function Spinner({ label, fg }: { label: string; fg: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  }, [])
  return <text fg={fg}>{`${SPINNER_FRAMES[frame]} ${label}`}</text>
}

const PROVIDERS: ProviderSelection[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'all']
const THEMES: TuiThemeMode[] = ['light', 'dark', 'cyber']
const SEARCH_MAX_CHARS = 80
const SESSION_REFRESH_MS = 5000
const DETAIL_REFRESH_MS = 2000

type PaneFocus = 'sessions' | 'messages'

type CardLandmark = {
  kind: 'resume' | 'unread' | 'day' | 'gap'
  text: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('  ·  ')
}

function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value.padEnd(width, ' ')
  if (width === 1) return value.slice(0, 1)
  return `${value.slice(0, width - 1)}…`
}

function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.max(Math.round(ms / 60_000), 0)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function formatTimeGap(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs < 30 * 60 * 1000) return null
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 90) return `${minutes}m later`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h later`
  return `${Math.round(hours / 24)}d later`
}

function sessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

type SidebarEntry =
  | { type: 'project'; key: string; projectName: string; count: number }
  | { type: 'session'; key: string; session: Session; absoluteIndex: number }

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
      key: `session:${session.provider ?? 'claude'}:${session.sessionId}`,
      session,
      absoluteIndex,
    })
  })
  return entries
}


function findCardIndex(cards: TuiTranscriptCard[], key: string | null): number {
  if (!key) return -1
  return cards.findIndex((card) => card.key === key)
}

function densityConfig(density: TuiDensity): {
  cardGap: number
  bodyIndent: number
  bodyLines: number
  headerRows: number
} {
  switch (density) {
    case 'comfortable':
      return { cardGap: 1, bodyIndent: 3, bodyLines: 6, headerRows: 2 }
    case 'dense':
      return { cardGap: 0, bodyIndent: 1, bodyLines: 12, headerRows: 1 }
    default:
      return { cardGap: 1, bodyIndent: 2, bodyLines: 8, headerRows: 2 }
  }
}

function buildSyntaxStyle(theme: TuiThemePalette): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    keyword:     { fg: RGBA.fromHex(theme.violet), bold: true },
    string:      { fg: RGBA.fromHex(theme.green) },
    comment:     { fg: RGBA.fromHex(theme.dim), italic: true, dim: true },
    number:      { fg: RGBA.fromHex(theme.amber) },
    function:    { fg: RGBA.fromHex(theme.cyan) },
    type:        { fg: RGBA.fromHex(theme.pink) },
    operator:    { fg: RGBA.fromHex(theme.muted) },
    punctuation: { fg: RGBA.fromHex(theme.muted) },
    default:     { fg: RGBA.fromHex(theme.text) },
  })
}

function transcriptAccent(cardRole: 'user' | 'assistant' | 'system', provider: ProviderSelection | undefined): string {
  if (cardRole === 'user') return THEME.green
  if (cardRole === 'system') return THEME.dim
  return getProviderAccent(provider ?? 'claude')
}

function transcriptColor(line: TuiTranscriptCardLine, theme: TuiThemePalette): string {
  switch (line.tone) {
    case 'tool':
      return theme.cyan
    case 'result_ok':
      return theme.green
    case 'result_error':
      return theme.red
    case 'thinking':
      return theme.violet
    case 'system':
      return theme.amber
    case 'diff_add':
      return theme.green
    case 'diff_remove':
      return theme.red
    case 'diff_meta':
      return theme.cyan
    case 'muted':
      return theme.muted
    case 'dim':
      return theme.dim
    default:
      return theme.text
  }
}

function transcriptBackground(line: TuiTranscriptCardLine, theme: TuiThemePalette): string | undefined {
  switch (line.tone) {
    case 'result_ok':
      return theme.diffAddBg
    case 'result_error':
      return theme.diffRemoveBg
    case 'diff_add':
      return theme.diffAddBg
    case 'diff_remove':
      return theme.diffRemoveBg
    case 'diff_meta':
      return theme.diffMetaBg
    default:
      return undefined
  }
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
    landmarks.push({ kind: 'resume', text: 'LAST READ POSITION' })
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

function renderedBodyLines(card: TuiTranscriptCard, isExpanded: boolean, previewLimit: number): TuiTranscriptCardLine[] {
  const source = isExpanded ? card.expandedLines : card.lines
  let base: TuiTranscriptCardLine[]
  if (isExpanded) {
    base = source.filter((line) => !['diff_add', 'diff_remove', 'diff_meta'].includes(line.tone))
  } else if (card.category === 'diff') {
    // Keep diff_meta (file path header) but strip raw diff lines — <diff> renders those
    base = source.filter((line) => line.tone !== 'diff_add' && line.tone !== 'diff_remove')
  } else {
    base = source.slice(0, previewLimit)
  }
  return base.length > 0 ? base : [{ text: 'No visible content', tone: 'dim' }]
}

function cardDiffText(card: TuiTranscriptCard, isExpanded: boolean): string | null {
  if (card.category !== 'diff' && !isExpanded) return null
  return card.editDiff ?? extractDiffText(card.expandedLines)
}

function cardDiffRows(card: TuiTranscriptCard, isExpanded: boolean, previewLimit: number): number {
  const diffText = cardDiffText(card, isExpanded)
  if (!diffText) return 0
  const maxHeight = isExpanded ? 12 : previewLimit
  return Math.min(maxHeight, Math.max(diffText.split('\n').length + 2, 4)) + 1
}

function codeBlockRows(card: TuiTranscriptCard, isExpanded: boolean): number {
  if (!isExpanded || !card.codeBlocks?.length) return 0
  return card.codeBlocks.reduce((sum, cb) =>
    sum + 1 + Math.min(cb.content.split('\n').length + 1, 20) + 1, 0)
}

function cardHeight(
  cards: TuiTranscriptCard[],
  index: number,
  expandedKeys: Set<string>,
  previewLimit: number,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
): number {
  const card = cards[index]
  const isExpanded = expandedKeys.has(card.key)
  const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
  const bodyRows = renderedBodyLines(card, isExpanded, previewLimit).length
  const diffRows = cardDiffRows(card, isExpanded, previewLimit)
  const codeRows = codeBlockRows(card, isExpanded)
  const borderRows = 2
  const bodyPaddingBottom = 1
  return landmarkRows + borderRows + bodyPaddingBottom + bodyRows + diffRows + codeRows + cardGap
}

function selectTranscriptWindow(
  cards: TuiTranscriptCard[],
  startIndex: number,
  rowBudget: number,
  expandedKeys: Set<string>,
  previewLimit: number,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
): { endIndex: number } {
  if (cards.length === 0) return { endIndex: -1 }

  let usedRows = 0
  let endIndex = clamp(startIndex, 0, cards.length - 1)

  for (let index = clamp(startIndex, 0, cards.length - 1); index < cards.length; index++) {
    const nextHeight = cardHeight(
      cards,
      index,
      expandedKeys,
      previewLimit,
      cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
    )
    if (index > startIndex && usedRows + nextHeight > rowBudget) break
    usedRows += nextHeight
    endIndex = index
  }

  return { endIndex }
}

function windowStartForCursor(
  cards: TuiTranscriptCard[],
  cursorIndex: number,
  rowBudget: number,
  expandedKeys: Set<string>,
  previewLimit: number,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
): number {
  if (cards.length === 0) return 0

  let start = clamp(cursorIndex, 0, cards.length - 1)
  let usedRows = cardHeight(
    cards,
    start,
    expandedKeys,
    previewLimit,
    cardGap,
    resumeMarkerIndex,
    unreadBoundaryIndex,
    pendingNewCount,
  )

  while (start > 0) {
    const nextHeight = cardHeight(
      cards,
      start - 1,
      expandedKeys,
      previewLimit,
      cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
    )
    if (usedRows + nextHeight > rowBudget) break
    start -= 1
    usedRows += nextHeight
  }

  return start
}

function rowOffsetForIndex(
  cards: TuiTranscriptCard[],
  index: number,
  expandedKeys: Set<string>,
  previewLimit: number,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
): number {
  let rows = 0
  for (let i = 0; i < index; i++) {
    rows += cardHeight(
      cards,
      i,
      expandedKeys,
      previewLimit,
      cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
    )
  }
  return rows
}

function cycleTheme(current: TuiThemeMode): TuiThemeMode {
  return current === 'light' ? 'dark' : current === 'dark' ? 'cyber' : 'light'
}

function cycleDensityValue(current: TuiDensity): TuiDensity {
  return current === 'comfortable'
    ? 'balanced'
    : current === 'balanced'
    ? 'dense'
    : 'comfortable'
}

function cycleTranscriptViewValue(current: TuiTranscriptView): TuiTranscriptView {
  return current === 'conversation' ? 'full' : 'conversation'
}

function providerSelectOptions(): SelectOption[] {
  return PROVIDERS.map((provider) => ({
    name: provider.toUpperCase(),
    description: provider === 'all' ? 'All providers' : `${provider} sessions`,
    value: provider,
  }))
}

function extractDiffText(lines: TuiTranscriptCardLine[]): string | null {
  const diffLines = lines
    .filter((line) => line.tone === 'diff_add' || line.tone === 'diff_remove' || line.tone === 'diff_meta')
    .map((line) => line.text)
  return diffLines.length > 0 ? diffLines.join('\n') : null
}

function currentProjectName(session: Session | null): string {
  return session ? formatSessionProject(session) : 'no-project'
}

export default function OpenTuiApp() {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()

  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [themeMode, setThemeMode] = useState<TuiThemeMode>('light')
  const [density, setDensity] = useState<TuiDensity>('balanced')
  const [transcriptView, setTranscriptView] = useState<TuiTranscriptView>('conversation')
  const [focusMode, setFocusMode] = useState(false)
  const [railVisible, setRailVisible] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<TuiSessionDetail | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedPane, setFocusedPane] = useState<PaneFocus>('sessions')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [transcriptTopKey, setTranscriptTopKey] = useState<string | null>(null)
  const [transcriptCursorKey, setTranscriptCursorKey] = useState<string | null>(null)
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(() => new Set())
  const [collapsedCardKeys, setCollapsedCardKeys] = useState<Set<string>>(() => new Set())
  const [followTail, setFollowTail] = useState(true)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [unreadBoundaryKey, setUnreadBoundaryKey] = useState<string | null>(null)
  const [resumeMarkerKey, setResumeMarkerKey] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [restoredReaderState, setRestoredReaderState] = useState<{
    sessionKey: string | null
    loaded: boolean
    state: TuiSessionReaderState | null
  }>({
    sessionKey: null,
    loaded: false,
    state: null,
  })

  const transcriptScrollRef = useRef<ScrollBoxRenderable>(null)
  const sidebarScrollRef = useRef<ScrollBoxRenderable>(null)
  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const readerStateWriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousTranscriptRef = useRef<{ sessionKey: string | null; keys: string[] }>({
    sessionKey: null,
    keys: [],
  })

  useEffect(() => {
    setActiveTheme(themeMode)
  }, [themeMode])

  const theme = getThemePalette(themeMode)
  const syntaxStyle = useMemo(() => buildSyntaxStyle(theme), [themeMode])
  const densityState = densityConfig(density)
  const showRail = !focusMode && railVisible
  const effectiveFocus: PaneFocus = showRail ? focusedPane : 'messages'
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

  const transcriptCards = useMemo(() => (
    sessionDetail ? formatTranscriptCards(sessionDetail.threadedMessages, density) : []
  ), [density, sessionDetail])

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

  const readerTitle = useMemo(() => (
    sessionDetail?.info?.customTitle
    ?? sessionDetail?.info?.summary
    ?? selectedSession?.customTitle
    ?? selectedSession?.summary
    ?? '(untitled session)'
  ), [selectedSession, sessionDetail?.info])

  const readerModel = sessionDetail?.info?.currentModel ?? 'unknown'
  const projectCount = useMemo(
    () => new Set(sessions.map((session) => formatSessionProject(session))).size,
    [sessions],
  )
  const foldedTechnicalCount = useMemo(
    () => transcriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, transcriptCards],
  )
  const sidebarEntries = useMemo(
    () => buildSidebarEntries(sessions),
    [sessions],
  )
  const selectedSidebarEntryIndex = useMemo(() => {
    const idx = sidebarEntries.findIndex((e) => e.type === 'session' && e.absoluteIndex === selectedIndex)
    return idx >= 0 ? idx : 0
  }, [sidebarEntries, selectedIndex])
  const mainContentHeight = Math.max(height - 4 - (searchMode ? 3 : 1), 8)
  const sidebarWidth = showRail ? clamp(Math.floor((width - 4) * 0.27), 28, 40) : 0
  const rightPaneWidth = Math.max(width - 4 - sidebarWidth - (showRail ? 1 : 0), 40)
  const transcriptViewportRows = Math.max(mainContentHeight - (focusMode ? 4 : 7), 8)
  const sidebarRowBudget = Math.max(mainContentHeight - 7, 4)
  const sidebarInnerWidth = Math.max(sidebarWidth - 5, 17)
  const topIndex = useMemo(() => {
    if (transcriptCards.length === 0) return 0
    const storedTop = findCardIndex(transcriptCards, transcriptTopKey)
    if (storedTop >= 0) return storedTop
    return windowStartForCursor(
      transcriptCards,
      Math.max(cursorIndex, 0),
      transcriptViewportRows,
      resolvedExpandedKeys,
      densityState.bodyLines,
      densityState.cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
    )
  }, [
    cursorIndex,
    densityState.bodyLines,
    densityState.cardGap,
    pendingNewCount,
    resolvedExpandedKeys,
    resumeMarkerIndex,
    transcriptCards,
    transcriptTopKey,
    transcriptViewportRows,
    unreadBoundaryIndex,
  ])
  const visibleTranscriptWindow = useMemo(() => (
    selectTranscriptWindow(
      transcriptCards,
      topIndex,
      transcriptViewportRows,
      resolvedExpandedKeys,
      densityState.bodyLines,
      densityState.cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
    )
  ), [
    densityState.bodyLines,
    densityState.cardGap,
    pendingNewCount,
    resolvedExpandedKeys,
    resumeMarkerIndex,
    topIndex,
    transcriptCards,
    transcriptViewportRows,
    unreadBoundaryIndex,
  ])
  const visibleTranscriptEndIndex = visibleTranscriptWindow.endIndex

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
      setSelectedSessionKey((current) => {
        if (nextSessions.length === 0) return null
        if (preserveSelection && current) {
          const matched = nextSessions.find((session) => sessionKey(session) === current)
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
    if (foreground) setLoadingDetail(true)
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
      if (requestId === detailRequestRef.current && foreground) setLoadingDetail(false)
    }
  }, [])

  const jumpToTranscriptIndex = useCallback((index: number) => {
    if (transcriptCards.length === 0) return
    const nextIndex = clamp(index, 0, transcriptCards.length - 1)
    const nextCard = transcriptCards[nextIndex]
    if (!nextCard) return
    const nextStart = windowStartForCursor(
      transcriptCards,
      nextIndex,
      transcriptViewportRows,
      resolvedExpandedKeys,
      densityState.bodyLines,
      densityState.cardGap,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
    )
    setTranscriptCursorKey(nextCard.key)
    setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  }, [
    densityState.bodyLines,
    densityState.cardGap,
    pendingNewCount,
    resolvedExpandedKeys,
    resumeMarkerIndex,
    transcriptCards,
    transcriptViewportRows,
    unreadBoundaryIndex,
  ])

  const jumpToTranscriptTail = useCallback(() => {
    if (transcriptCards.length === 0) return
    const lastIndex = transcriptCards.length - 1
    jumpToTranscriptIndex(lastIndex)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  }, [jumpToTranscriptIndex, transcriptCards])

  const jumpToUnreadBoundary = useCallback(() => {
    if (unreadBoundaryIndex >= 0) {
      jumpToTranscriptIndex(unreadBoundaryIndex)
      return
    }
    jumpToTranscriptTail()
  }, [jumpToTranscriptIndex, jumpToTranscriptTail, unreadBoundaryIndex])

  const jumpToResumeMarker = useCallback(() => {
    const index = findCardIndex(transcriptCards, resumeMarkerKey)
    if (index >= 0) jumpToTranscriptIndex(index)
  }, [jumpToTranscriptIndex, resumeMarkerKey, transcriptCards])

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
        densityState.bodyLines,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
      )
      setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
    }
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  }, [
    cursorIndex,
    densityState.bodyLines,
    densityState.cardGap,
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
    const step = Math.max(Math.floor((height - (focusMode ? 5 : 7)) / 3), 1)
    moveCursor(direction * step)
  }, [focusMode, height, moveCursor])

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

  const jumpToSearchMatch = useCallback((matchOffset: number) => {
    if (searchMatches.length === 0) return
    const nextMatchIndex = (searchMatchIndex + matchOffset + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(nextMatchIndex)
    jumpToTranscriptIndex(searchMatches[nextMatchIndex] ?? 0)
  }, [jumpToTranscriptIndex, searchMatchIndex, searchMatches])

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

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [
          configuredTheme,
          configuredProvider,
          configuredRailVisible,
          configuredFocusMode,
          configuredDensity,
          configuredTranscriptView,
        ] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiTranscriptView(),
        ])
        if (cancelled) return
        setThemeMode(configuredTheme)
        setActiveTheme(configuredTheme)
        setProvider(configuredProvider)
        setRailVisible(configuredRailVisible)
        setFocusMode(configuredFocusMode)
        setDensity(configuredDensity)
        setTranscriptView(configuredTranscriptView)
        if (!configuredRailVisible || configuredFocusMode) setFocusedPane('messages')
        await refreshSessions(configuredProvider, false, true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to initialize OpenTUI')
        setLoadingSessions(false)
      } finally {
        if (!cancelled) setBootstrapped(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshSessions])

  useEffect(() => {
    if (!bootstrapped) return
    if (!selectedSessionTarget) {
      setSessionDetail(null)
      setLoadingDetail(false)
      return
    }

    setSessionDetail(null)
    void refreshSelectedSessionDetail(selectedSessionTarget, true)
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSessionIdentity, selectedSessionTarget])

  useEffect(() => {
    if (selectedSession || sessions.length === 0) return
    setSelectedSessionKey(sessionKey(sessions[0]))
  }, [selectedSession, sessions])

  useEffect(() => {
    if (!bootstrapped) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || loadingSessions || providerSwitchRef.current) return
      void refreshSessions(provider, true, false)
    }, SESSION_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, loadingSessions, provider, refreshSessions])

  useEffect(() => {
    if (!bootstrapped || !selectedSessionTarget) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }, DETAIL_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSessionIdentity, selectedSessionTarget])

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
    const currentKeys = transcriptCards.map((card) => card.key)
    const previous = previousTranscriptRef.current
    const sameSession = previous.sessionKey === selectedSessionKey

    if (currentKeys.length === 0) {
      setTranscriptTopKey(null)
      setTranscriptCursorKey(null)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (!sameSession) {
      if (restoredReaderState.sessionKey !== selectedSessionKey || !restoredReaderState.loaded) return
      const restoredState = restoredReaderState.state
      if (restoredState?.followTail === false) {
        const restoredIndex = findCardIndex(transcriptCards, restoredState.cursorKey)
        const targetIndex = restoredIndex >= 0 ? restoredIndex : 0
        const restoredTopIndex = findCardIndex(transcriptCards, restoredState.topKey)
        const nextStart = restoredTopIndex >= 0
          ? restoredTopIndex
          : windowStartForCursor(
              transcriptCards,
              targetIndex,
              transcriptViewportRows,
              resolvedExpandedKeys,
              densityState.bodyLines,
              densityState.cardGap,
              resumeMarkerIndex,
              unreadBoundaryIndex,
              pendingNewCount,
            )
        setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
        setTranscriptCursorKey(transcriptCards[targetIndex]?.key ?? transcriptCards[0].key)
        setFollowTail(false)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(restoredState.cursorKey)
      } else {
        const lastIndex = transcriptCards.length - 1
        const nextStart = windowStartForCursor(
          transcriptCards,
          lastIndex,
          transcriptViewportRows,
          resolvedExpandedKeys,
          densityState.bodyLines,
          densityState.cardGap,
          resumeMarkerIndex,
          unreadBoundaryIndex,
          pendingNewCount,
        )
        setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
        setTranscriptCursorKey(transcriptCards[lastIndex].key)
        setFollowTail(true)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(null)
      }
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
        densityState.bodyLines,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
      )
      setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
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
        return currentKeys[previousLastIndex + 1] ?? null
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
        densityState.bodyLines,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
      )
      return transcriptCards[nextStart]?.key ?? transcriptCards[0].key
    })
    previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
  }, [
    cursorIndex,
    densityState.bodyLines,
    densityState.cardGap,
    followTail,
    pendingNewCount,
    resolvedExpandedKeys,
    restoredReaderState,
    resumeMarkerIndex,
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
        densityState.bodyLines,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
      )
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
      return
    }

    if (cursorIndex < topIndex || cursorIndex > visibleTranscriptEndIndex) {
      const nextStart = windowStartForCursor(
        transcriptCards,
        cursorIndex,
        transcriptViewportRows,
        resolvedExpandedKeys,
        densityState.bodyLines,
        densityState.cardGap,
        resumeMarkerIndex,
        unreadBoundaryIndex,
        pendingNewCount,
      )
      setTranscriptTopKey(transcriptCards[nextStart]?.key ?? transcriptCards[0].key)
    }
  }, [
    cursorIndex,
    densityState.bodyLines,
    densityState.cardGap,
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

    if (readerStateWriteTimeoutRef.current) clearTimeout(readerStateWriteTimeoutRef.current)

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

  useEffect(() => {
    if (followTail || !transcriptCursorKey) return
    const timer = setTimeout(() => {
      transcriptScrollRef.current?.scrollChildIntoView(`card:${transcriptCursorKey}`)
    }, 0)
    return () => clearTimeout(timer)
  }, [followTail, transcriptCursorKey])

  useEffect(() => {
    const entry = sidebarEntries[selectedSidebarEntryIndex]
    if (!entry) return
    const timer = setTimeout(() => {
      sidebarScrollRef.current?.scrollChildIntoView(`sidebar:${entry.key}`)
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedSidebarEntryIndex, sidebarEntries])

  const footerText = fitText(
    `tab focus  j/k move  ctrl-u/d page  () convo  {} tech  u unread  m mark  / search  n/N hits  f live  e fold  v ${transcriptView}  d ${density}  h rail  z focus  p provider  t theme  r refresh  q quit`,
    Math.max(width - 4, 20),
  )

  useKeyboard((key) => {
    if (key.eventType === 'release') return
    const sequence = key.sequence || ''
    const isShifted = (char: string): boolean => key.name === char.toLowerCase() && key.shift
    const handled = (action: () => void): void => {
      key.preventDefault()
      key.stopPropagation()
      action()
    }

    if (searchMode) {
      if (key.name === 'escape') {
        handled(() => {
          setSearchMode(false)
        })
      }
      return
    }

    if (providerMenuOpen) {
      if (key.name === 'escape' || key.name === 'p') {
        handled(() => {
          closeProviderMenu()
        })
        return
      }
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        handled(() => {
          renderer.destroy()
          process.exit(0)
        })
      }
      return
    }

    if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      handled(() => {
        renderer.destroy()
        process.exit(0)
      })
      return
    }

    if (key.name === 'tab' && showRail) {
      handled(() => {
        setFocusedPane((current) => current === 'sessions' ? 'messages' : 'sessions')
      })
      return
    }

    if (effectiveFocus === 'sessions' && (key.name === 'j' || key.name === 'down')) {
      handled(() => {
        moveSelection(1)
      })
      return
    }

    if (effectiveFocus === 'sessions' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveSelection(-1)
      })
      return
    }

    if (effectiveFocus === 'sessions' && key.name === 'g' && !key.shift) {
      handled(() => {
        if (sessions[0]) setSelectedSessionKey(sessionKey(sessions[0]))
      })
      return
    }

    if (effectiveFocus === 'sessions' && isShifted('G')) {
      handled(() => {
        const last = sessions.at(-1)
        if (last) setSelectedSessionKey(sessionKey(last))
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'j' || key.name === 'down')) {
      handled(() => {
        moveCursor(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveCursor(-1)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'g' && !key.shift) {
      handled(() => {
        jumpToTranscriptIndex(0)
      })
      return
    }

    if (effectiveFocus === 'messages' && isShifted('G')) {
      handled(() => {
        jumpToTranscriptTail()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'pagedown') {
      handled(() => {
        moveCursor(Math.max(Math.floor(transcriptViewportRows * 0.8), 1))
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'pageup') {
      handled(() => {
        moveCursor(-Math.max(Math.floor(transcriptViewportRows * 0.8), 1))
      })
      return
    }

    if (effectiveFocus === 'messages' && key.ctrl && key.name === 'd') {
      handled(() => {
        moveViewport(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.ctrl && key.name === 'u') {
      handled(() => {
        moveViewport(-1)
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'return' || key.name === 'e')) {
      handled(() => {
        toggleExpansion()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'f') {
      handled(() => {
        jumpToTranscriptTail()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'u') {
      handled(() => {
        jumpToUnreadBoundary()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'm') {
      handled(() => {
        jumpToResumeMarker()
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '/') {
      handled(() => {
        setSearchMode(true)
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '[' && searchMatches.length > 0) {
      handled(() => {
        setSearchMatchIndex(0)
        jumpToTranscriptIndex(searchMatches[0] ?? 0)
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === ']' && searchMatches.length > 0) {
      handled(() => {
        const lastMatchIndex = searchMatches.length - 1
        setSearchMatchIndex(lastMatchIndex)
        jumpToTranscriptIndex(searchMatches[lastMatchIndex] ?? 0)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'n' && !key.shift && searchMatches.length > 0) {
      handled(() => {
        jumpToSearchMatch(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && isShifted('N') && searchMatches.length > 0) {
      handled(() => {
        jumpToSearchMatch(-1)
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '(') {
      handled(() => {
        jumpToMatchingCard(-1, (card) => card.category === 'conversation')
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === ')') {
      handled(() => {
        jumpToMatchingCard(1, (card) => card.category === 'conversation')
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '{') {
      handled(() => {
        jumpToMatchingCard(-1, (card) => card.category !== 'conversation')
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '}') {
      handled(() => {
        jumpToMatchingCard(1, (card) => card.category !== 'conversation')
      })
      return
    }

    if (key.name === 'p') {
      handled(() => {
        setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
        setProviderMenuOpen(true)
      })
      return
    }

    if (key.name === 't') {
      handled(() => {
        const nextTheme = cycleTheme(themeMode)
        setThemeMode(nextTheme)
        setActiveTheme(nextTheme)
        void writeTuiTheme(nextTheme).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store theme')
        })
      })
      return
    }

    if (key.name === 'h' && !key.shift) {
      handled(() => {
        const nextVisible = !railVisible
        setRailVisible(nextVisible)
        if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
        void writeTuiRailVisible(nextVisible).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store reader layout')
        })
      })
      return
    }

    if (key.name === 'z') {
      handled(() => {
        const next = !focusMode
        setFocusMode(next)
        if (next) setFocusedPane('messages')
        void writeTuiFocusMode(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store focus mode')
        })
      })
      return
    }

    if (key.name === 'd') {
      handled(() => {
        const next = cycleDensityValue(density)
        setDensity(next)
        void writeTuiDensity(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store density')
        })
      })
      return
    }

    if (key.name === 'v') {
      handled(() => {
        const next = cycleTranscriptViewValue(transcriptView)
        setTranscriptView(next)
        void writeTuiTranscriptView(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store transcript view')
        })
      })
      return
    }

    if (key.name === 'r') {
      handled(() => {
        void refreshSessions(provider)
        if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
      })
    }
  })

  const statusLabel = loadingSessions ? 'syncing' : refreshingSessions ? 'refreshing' : 'live'
  const readerMode = followTail ? 'live mode' : pendingNewCount > 0 ? 'new content waiting' : 'reading mode'
  const headerStatusRight = fitText(
    joinMeta([
      statusLabel,
      `position ${transcriptCards.length === 0 ? '0' : `${Math.max(cursorIndex, 0) + 1}`}/${transcriptCards.length}`,
      readerMode,
      themeMode.toUpperCase(),
      provider.toUpperCase(),
      density.toUpperCase(),
      pendingNewCount > 0 ? `+${pendingNewCount} new` : null,
    ]),
    Math.max(Math.floor(width * 0.55), 20),
  )
  const headerContextLeft = fitText(
    joinMeta([
      `project ${currentProjectName(selectedSession)}`,
      `model ${readerModel}`,
    ]),
    Math.max(Math.floor(width * 0.45) - 16, 12),
  )

  const providerOptions = providerSelectOptions()
  const providerAccent = getProviderAccent(provider)
  const providerSummary = provider.toUpperCase()

  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
      {!focusMode ? (
        <box backgroundColor={theme.surface} paddingX={1}>
          <box width={14} overflow="hidden">
            <text fg={theme.text}>AGENT VIEWER</text>
          </box>
          <box flexGrow={1} overflow="hidden">
            <text fg={theme.muted}>{headerContextLeft}</text>
          </box>
          <box width={Math.max(Math.floor(width * 0.55), 20)} overflow="hidden">
            <text fg={theme.dim}>{headerStatusRight}</text>
          </box>
        </box>
      ) : (
        <box backgroundColor={theme.surface} paddingX={1}>
          <text fg={theme.text}>{fitText(readerTitle, Math.max(width - 4, 20))}</text>
        </box>
      )}

      <box flexGrow={1} padding={1} gap={1} height={mainContentHeight} flexDirection="row" backgroundColor={theme.bg}>
        {showRail ? (
          <box
            width={sidebarWidth}
            border
            borderStyle="single"
            borderColor={effectiveFocus === 'sessions' ? theme.border2 : theme.border}
            backgroundColor={theme.surface}
            flexDirection="column"
            title={`SESSIONS  ${Math.max(sessions.length, 0)}`}
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.cyan}>{fitText('tab focus  h hide rails  / search', sidebarInnerWidth)}</text>
            </box>
            <box flexGrow={1} paddingX={1} paddingBottom={1}>
              {loadingSessions && sessions.length === 0 ? (
                <Spinner label={fitText('Loading…', sidebarInnerWidth - 2)} fg={theme.dim} />
              ) : sidebarEntries.length === 0 ? (
                <text fg={theme.dim}>{fitText('No sessions available', sidebarInnerWidth)}</text>
              ) : (
                <scrollbox
                  ref={sidebarScrollRef}
                  style={{ height: sidebarRowBudget }}
                  backgroundColor={theme.surface}
                  scrollY={false}
                  viewportCulling
                  scrollbarOptions={{
                    trackOptions: {
                      foregroundColor: theme.muted,
                      backgroundColor: theme.surface,
                    },
                  }}
                >
                  {sidebarEntries.map((entry) => {
                    if (entry.type === 'project') {
                      const countLabel = `${entry.count}`
                      const dashes = '─'.repeat(Math.max(sidebarInnerWidth - 2 - entry.projectName.length - countLabel.length - 3, 1))
                      return (
                        <box
                          key={entry.key}
                          id={`sidebar:${entry.key}`}
                          paddingX={1}
                          marginTop={1}
                          backgroundColor={theme.surface2}
                        >
                          <text fg={theme.cyan} wrapMode="none">
                            {fitText(`${entry.projectName} ${dashes} ${countLabel}`, sidebarInnerWidth - 2)}
                          </text>
                        </box>
                      )
                    }

                    const selected = entry.absoluteIndex === selectedIndex
                    const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
                    const activityTime = entry.session.lastModified ?? entry.session.createdAt
                    const ago = timeAgo(activityTime)

                    const project = formatSessionProject(entry.session)
                    const metaLine = joinMeta([formatProviderLabel(entry.session.provider), ago, project])

                    return (
                      <box
                        key={entry.key}
                        id={`sidebar:${entry.key}`}
                        flexDirection="column"
                        backgroundColor={selected ? theme.surface3 : theme.surface}
                        marginBottom={density === 'comfortable' ? 1 : 0}
                      >
                        <box paddingX={1} backgroundColor={selected ? theme.surface3 : theme.surface}>
                          <text fg={selected ? theme.text : theme.muted} wrapMode="none">
                            {fitText(formatSessionTitle(entry.session), sidebarInnerWidth - 2)}
                          </text>
                        </box>
                        <box paddingX={1} backgroundColor={selected ? theme.surface3 : theme.surface}>
                          <text fg={selected ? sessionAccent : theme.dim} wrapMode="none">
                            {fitText(metaLine, sidebarInnerWidth - 2)}
                          </text>
                        </box>
                      </box>
                    )
                  })}
                </scrollbox>
              )}
            </box>
          </box>
        ) : null}

        <box
          width={rightPaneWidth}
          border
          borderStyle="single"
          borderColor={effectiveFocus === 'messages' ? theme.border2 : theme.border}
          backgroundColor={theme.surface}
          flexDirection="column"
        >
          {!focusMode ? (
            <box paddingX={1} paddingTop={1}>
              <box width={Math.max(rightPaneWidth - 16, 16)} overflow="hidden">
                <text fg={theme.text}>{fitText(readerTitle, Math.max(rightPaneWidth - 16, 16))}</text>
              </box>
              <box width={12} overflow="hidden">
                <text fg={providerAccent}>{fitText(providerSummary, 12)}</text>
              </box>
            </box>
          ) : null}

          {showRail ? null : (
            <box paddingX={1}>
              <text fg={theme.dim}>{fitText('rail hidden  ·  press h to show sessions', rightPaneWidth - 4)}</text>
            </box>
          )}

          {error ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.red}>{fitText(error, rightPaneWidth - 4)}</text>
            </box>
          ) : null}

          {!followTail && pendingNewCount > 0 ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.amber}>
                {fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, rightPaneWidth - 4)}
              </text>
            </box>
          ) : null}

          {normalizedSearchQuery ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.dim}>
                {fitText(
                  `/${searchQuery}  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}`,
                  rightPaneWidth - 4,
                )}
              </text>
            </box>
          ) : null}

          <box flexGrow={1} paddingX={1} paddingBottom={1} marginTop={1} overflow="hidden">
            {loadingDetail && transcriptCards.length === 0 ? (
              <Spinner label={fitText('Loading transcript…', rightPaneWidth - 6)} fg={theme.dim} />
            ) : transcriptCards.length === 0 ? (
              !selectedSession ? (
                <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} paddingY={2}>
                  <ascii-font text="AGENT VIEWER" font="tiny" color={theme.dim} />
                  <box marginTop={1}>
                    <text fg={theme.dim}>Select a session to begin reading</text>
                  </box>
                </box>
              ) : (
                <text fg={theme.dim}>{fitText('No messages.', rightPaneWidth - 4)}</text>
              )
            ) : (
              <scrollbox
                ref={transcriptScrollRef}
                style={{ height: transcriptViewportRows }}
                focused={effectiveFocus === 'messages'}
                backgroundColor={theme.surface2}
                stickyScroll={followTail}
                stickyStart="bottom"
                scrollY={effectiveFocus === 'messages'}
                scrollbarOptions={{
                  trackOptions: {
                    foregroundColor: theme.muted,
                    backgroundColor: theme.surface2,
                  },
                }}
              >
                {transcriptCards.slice(topIndex, visibleTranscriptEndIndex + 1).map((card, sliceIndex) => {
                  const index = topIndex + sliceIndex
                  const isSelected = card.key === transcriptCursorKey
                  const hasCursor = isSelected && effectiveFocus === 'messages'
                  const isExpanded = resolvedExpandedKeys.has(card.key)
                  const accent = transcriptAccent(card.role, card.provider ?? provider)
                  const landmarks = transcriptLandmarks(
                    transcriptCards,
                    index,
                    resumeMarkerIndex,
                    unreadBoundaryIndex,
                    pendingNewCount,
                  )
                  const marker = hasCursor ? '>' : isSelected ? ':' : '⏺'
                  const isLatest = index === transcriptCards.length - 1
                  const isSearchHit = normalizedSearchQuery.length > 0
                    && `${card.label}\n${card.searchText}`.toLowerCase().includes(normalizedSearchQuery)
                  const isAutoFoldedTechnical = transcriptView === 'conversation' && card.autoFold && !isExpanded
                  const headerMeta = joinMeta([
                    card.timestamp ?? null,
                    isLatest ? 'latest' : null,
                    isSearchHit ? 'match' : null,
                    isAutoFoldedTechnical ? 'folded' : null,
                    `e ${isExpanded ? 'collapse' : 'expand'}`,
                  ])
                  const bodyLines = renderedBodyLines(card, isExpanded, densityState.bodyLines)
                  const diffText = cardDiffText(card, isExpanded)
                  const isInsight = card.category === 'insight'
                  const cardBg = hasCursor ? theme.surface3 : isSelected ? theme.surface2 : card.role === 'user' ? theme.userBg : isInsight ? theme.surface2 : theme.surface
                  const borderColor = hasCursor ? accent : isInsight ? theme.violet : isSelected ? theme.border2 : card.role === 'user' ? theme.border2 : theme.border
                  const maxTitleWidth = Math.max(rightPaneWidth - 6, 20)
                  const cardTitleFull = `${marker} ${card.label}  ${headerMeta}`
                  const cardTitle = cardTitleFull.length > maxTitleWidth
                    ? cardTitleFull.slice(0, maxTitleWidth - 1) + '…'
                    : cardTitleFull

                  return (
                    <box key={card.key} flexDirection="column" marginBottom={densityState.cardGap}>
                      {landmarks.map((landmark, landmarkIndex) => {
                        const color = landmark.kind === 'resume'
                          ? theme.cyan
                          : landmark.kind === 'unread'
                          ? theme.amber
                          : landmark.kind === 'day'
                          ? theme.violet
                          : theme.dim
                        return (
                          <box key={`${card.key}:landmark:${landmarkIndex}`} paddingX={1}>
                            <text fg={color}>{fitText(landmark.text, rightPaneWidth - 4)}</text>
                          </box>
                        )
                      })}

                      <box
                        id={`card:${card.key}`}
                        border
                        borderStyle="single"
                        borderColor={borderColor}
                        backgroundColor={cardBg}
                        flexDirection="column"
                        title={cardTitle}
                      >
                        <box flexDirection="column" paddingLeft={densityState.bodyIndent} paddingBottom={1}>
                          {bodyLines.map((line, lineIndex) => (
                            <box
                              key={`${card.key}:line:${lineIndex}`}
                              paddingX={1}
                              backgroundColor={transcriptBackground(line, theme) ?? cardBg}
                            >
                              <text fg={transcriptColor(line, theme)} wrapMode="none">
                                {fitText(line.text, Math.max(rightPaneWidth - densityState.bodyIndent - 8, 16))}
                              </text>
                            </box>
                          ))}

                          {isExpanded && card.codeBlocks && card.codeBlocks.length > 0 ? (
                            card.codeBlocks.map((cb) => (
                              <box key={cb.key} paddingX={1} marginTop={1}>
                                <text fg={theme.dim}>{cb.lang}</text>
                                <code
                                  content={cb.content}
                                  filetype={cb.lang}
                                  syntaxStyle={syntaxStyle}
                                  drawUnstyledText={true}
                                  style={{ height: Math.min(cb.content.split('\n').length + 1, 20) }}
                                  width={Math.max(rightPaneWidth - densityState.bodyIndent - 8, 20)}
                                />
                              </box>
                            ))
                          ) : null}

                          {diffText ? (
                            <box paddingX={1} marginTop={1}>
                              <diff
                                diff={diffText}
                                view="unified"
                                wrapMode="char"
                                showLineNumbers={true}
                                addedBg={theme.diffAddBg}
                                removedBg={theme.diffRemoveBg}
                                contextBg={theme.surface}
                                lineNumberBg={theme.surface}
                                lineNumberFg={theme.dim}
                                fg={theme.text}
                                style={{ height: Math.min(isExpanded ? 12 : densityState.bodyLines, Math.max(diffText.split('\n').length + 2, 4)) }}
                              />
                            </box>
                          ) : null}
                        </box>
                      </box>
                    </box>
                  )
                })}

              </scrollbox>
            )}
          </box>

          {followTail && transcriptCards.length > 0 ? (
            <box paddingX={2} paddingBottom={1}>
              <Spinner label="waiting for new messages" fg={theme.dim} />
            </box>
          ) : null}
        </box>

        {providerMenuOpen ? (
          <box
            position="absolute"
            top={focusMode ? 1 : 3}
            right={2}
            width={34}
            height={14}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            zIndex={20}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.text}>PROVIDERS</text>
            </box>
            <box flexGrow={1} paddingX={1} paddingBottom={1}>
              <select
                style={{ height: 10 }}
                focused
                options={providerOptions}
                selectedIndex={providerMenuIndex}
                selectedBackgroundColor={theme.surface3}
                selectedTextColor={theme.text}
                textColor={theme.muted}
                descriptionColor={theme.dim}
                selectedDescriptionColor={theme.cyan}
                backgroundColor={theme.surface}
                showScrollIndicator={false}
                itemSpacing={0}
                onChange={(index) => setProviderMenuIndex(index)}
                onSelect={(_, option) => {
                  const nextProvider = option?.value as ProviderSelection | undefined
                  if (nextProvider) void chooseProvider(nextProvider)
                }}
              />
            </box>
          </box>
        ) : null}
      </box>

      {searchMode ? (
        <box paddingX={1}>
          <box
            width={Math.max(width - 2, 20)}
            height={3}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            flexDirection="column"
          >
            <box paddingX={1}>
              <text fg={theme.dim}>
                {fitText(
                  `SEARCH  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}  enter jump  esc close`,
                  width - 6,
                )}
              </text>
            </box>
            <box paddingX={1}>
              <input
                focused
                value={searchQuery}
                placeholder="Type to search transcript..."
                maxLength={SEARCH_MAX_CHARS}
                onInput={setSearchQuery}
                onSubmit={() => {
                  if (searchMatches.length > 0) jumpToTranscriptIndex(searchMatches[searchMatchIndex] ?? 0)
                  setSearchMode(false)
                }}
              />
            </box>
          </box>
        </box>
      ) : (
        <box backgroundColor={theme.surface} paddingX={1}>
          <text fg={theme.dim}>{footerText}</text>
        </box>
      )}
    </box>
  )
}

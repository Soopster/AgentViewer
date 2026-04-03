import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import {
  formatProviderLabel,
  formatSessionMeta,
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
  type TuiThemeMode,
  type TuiThemePalette,
} from './theme'
import {
  readTuiProvider,
  readTuiSessionDetail,
  readTuiSessions,
  readTuiTheme,
  writeTuiProvider,
  writeTuiTheme,
} from '../lib/tui/service'
import type { ProviderSelection, Session } from '../lib/types'

const PROVIDERS: ProviderSelection[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'all']
const HEADER_HEIGHT = 2
const FOOTER_HEIGHT = 1
const SIDEBAR_GUTTER_WIDTH = 2
const SESSION_ENTRY_HEIGHT = 2
const PROJECT_HEADER_HEIGHT = 1
const MESSAGE_HEADER_HEIGHT = 6
const MESSAGE_CARD_GAP = 1
const SESSION_REFRESH_MS = 5000
const DETAIL_REFRESH_MS = 2000
const SEARCH_MAX_CHARS = 80

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

function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  const minutes = Math.max(Math.floor(ms / 60_000), 0)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
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
  const lines = previewBodyLines(card)
  const groups = groupBodyLines(lines)
  let rows = 0

  for (const group of groups) {
    if (group.type === 'text') {
      rows += group.lines.length
      continue
    }

    const toolMatch = group.toolLine.text.match(/^tool (\S+)(?:: (.*))?$/)
    const toolName = toolMatch?.[1]?.toUpperCase() ?? 'TOOL'
    const resultLine = group.bodyLines.find(
      (line) => line.tone === 'result_ok' || line.tone === 'result_error',
    )
    const contentLines = group.bodyLines.filter(
      (line) => line.tone !== 'result_ok' && line.tone !== 'result_error',
    )

    if (toolName === 'FILECHANGE') {
      const pathLine = group.bodyLines[0]?.tone === 'diff_meta' ? group.bodyLines[0] : null
      const afterPath = pathLine ? group.bodyLines.slice(1) : group.bodyLines
      const diffContent = afterPath.filter((line) => line.tone !== 'dim')
      rows += 1 + (pathLine ? 1 : 0) + diffContent.length + 1
      continue
    }

    rows += 1 + (resultLine ? 1 : 0) + contentLines.length
  }

  const hiddenLines = Math.max(card.expandedLines.length - lines.length, 0)
  if (hiddenLines > 0) rows += 1

  return Math.max(rows, 1)
}

function cardHeight(card: TuiTranscriptCard, expandedKeys: Set<string>): number {
  const bodyRows = expandedKeys.has(card.key)
    ? Math.max(card.expandedLines.length, 1)
    : collapsedBodyRows(card)
  return 1 + bodyRows + MESSAGE_CARD_GAP
}

function selectTranscriptWindow(
  cards: TuiTranscriptCard[],
  startIndex: number,
  rowBudget: number,
  expandedKeys: Set<string>,
): { cards: TuiTranscriptCard[]; endIndex: number } {
  if (cards.length === 0) return { cards: [], endIndex: -1 }

  const visible: TuiTranscriptCard[] = []
  let usedRows = 0
  let endIndex = clamp(startIndex, 0, cards.length - 1)

  for (let index = clamp(startIndex, 0, cards.length - 1); index < cards.length; index++) {
    const next = cards[index]
    const nextHeight = cardHeight(next, expandedKeys)
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
): number {
  if (cards.length === 0) return 0
  let start = clamp(cursorIndex, 0, cards.length - 1)
  let usedRows = cardHeight(cards[start], expandedKeys)

  while (start > 0) {
    const nextHeight = cardHeight(cards[start - 1], expandedKeys)
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
  const [sidebarTopKey, setSidebarTopKey] = useState<string | null>(null)
  const [transcriptTopKey, setTranscriptTopKey] = useState<string | null>(null)
  const [transcriptCursorKey, setTranscriptCursorKey] = useState<string | null>(null)
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(() => new Set())
  const [followTail, setFollowTail] = useState(true)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [terminalRows, setTerminalRows] = useState(stdout.rows ?? process.stdout.rows ?? 40)
  const [terminalColumns, setTerminalColumns] = useState(stdout.columns ?? process.stdout.columns ?? 120)

  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const quittingRef = useRef(false)
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
  const providerAccent = getProviderAccent(provider)
  const sidebarAccent = focusedPane === 'sessions' ? theme.violet : theme.muted
  const projectCount = useMemo(() => uniqueProjectCount(sessions), [sessions])
  const currentProjectName = selectedSession ? formatSessionProject(selectedSession) : 'THIS PROJECT'
  const selectedSessionShortId = selectedSession?.sessionId.slice(-12) ?? 'NONE'
  const statusLabel = loadingSessions ? 'SYNCING' : refreshingSessions ? 'REFRESHING' : 'LIVE'
  const statusColor = loadingSessions ? theme.amber : refreshingSessions ? theme.cyan : theme.green

  const contentHeight = Math.max(terminalRows - HEADER_HEIGHT - FOOTER_HEIGHT, 12)
  const sidebarWidth = clamp(Math.floor((terminalColumns - 2) * 0.31), 32, 42)
  const messagePaneWidth = Math.max(terminalColumns - 2 - sidebarWidth - SIDEBAR_GUTTER_WIDTH, 48)
  const sidebarInnerWidth = Math.max(sidebarWidth - 2, 28)
  const messageInnerWidth = Math.max(messagePaneWidth - 2, 44)
  const providerPanelHeight = providerMenuOpen ? PROVIDERS.length + 3 : 5
  const sidebarRowBudget = Math.max(contentHeight - providerPanelHeight - 3, 6)
  const sessionTitleWidth = Math.max(sidebarInnerWidth - 2, 18)
  const sessionMetaWidth = Math.max(sidebarInnerWidth - 2, 18)
  const transcriptLineWidth = Math.max(messageInnerWidth - 2, 24)
  const transcriptViewportRows = Math.max(
    contentHeight - MESSAGE_HEADER_HEIGHT - 1 - (error ? 1 : 0),
    4,
  )

  const transcriptCards = useMemo(() => (
    sessionDetail ? formatTranscriptCards(sessionDetail.threadedMessages) : []
  ), [sessionDetail])
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
  const topIndex = useMemo(() => {
    if (transcriptCards.length === 0) return 0
    const index = findCardIndex(transcriptCards, transcriptTopKey)
    if (index >= 0) return index
    return windowStartForCursor(transcriptCards, Math.max(cursorIndex, 0), transcriptViewportRows, expandedCardKeys)
  }, [cursorIndex, expandedCardKeys, transcriptCards, transcriptTopKey, transcriptViewportRows])
  const visibleTranscriptWindow = useMemo(() => (
    selectTranscriptWindow(transcriptCards, topIndex, transcriptViewportRows, expandedCardKeys)
  ), [expandedCardKeys, topIndex, transcriptCards, transcriptViewportRows])
  const visibleTranscriptCards = visibleTranscriptWindow.cards
  const visibleTranscriptEndIndex = visibleTranscriptWindow.endIndex
  const transcriptWindowEnd = visibleTranscriptEndIndex >= 0 ? visibleTranscriptEndIndex + 1 : 0

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
    const nextStart = windowStartForCursor(transcriptCards, nextIndex, transcriptViewportRows, expandedCardKeys)
    setTranscriptCursorKey(transcriptCards[nextIndex].key)
    setTranscriptTopKey(transcriptCards[nextStart].key)
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) setPendingNewCount(0)
  }, [expandedCardKeys, transcriptCards, transcriptViewportRows])

  const jumpToTranscriptTail = useCallback(() => {
    if (transcriptCards.length === 0) return
    jumpToTranscriptIndex(transcriptCards.length - 1)
    setFollowTail(true)
    setPendingNewCount(0)
  }, [jumpToTranscriptIndex, transcriptCards.length])

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
      const nextStart = windowStartForCursor(transcriptCards, nextIndex, transcriptViewportRows, expandedCardKeys)
      setTranscriptTopKey(transcriptCards[nextStart].key)
    }
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) setPendingNewCount(0)
  }, [
    cursorIndex,
    expandedCardKeys,
    topIndex,
    transcriptCards,
    transcriptViewportRows,
    visibleTranscriptEndIndex,
  ])

  const toggleExpansion = useCallback(() => {
    const card = cursorIndex >= 0 ? transcriptCards[cursorIndex] : null
    if (!card) return
    setExpandedCardKeys((current) => {
      const next = new Set(current)
      if (next.has(card.key)) next.delete(card.key)
      else next.add(card.key)
      return next
    })
  }, [cursorIndex, transcriptCards])

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
        const configuredTheme = await readTuiTheme()
        if (cancelled) return
        setThemeMode(configuredTheme)
        setActiveTheme(configuredTheme)

        const configuredProvider = await readTuiProvider()
        if (cancelled) return
        setProvider(configuredProvider)

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
    const nextTheme = themeMode === 'light' ? 'dark' : 'light'
    setThemeMode(nextTheme)
    setActiveTheme(nextTheme)

    try {
      await writeTuiTheme(nextTheme)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    }
  }, [themeMode])

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
    setTranscriptTopKey(null)
    setTranscriptCursorKey(null)
    setExpandedCardKeys(new Set())
    setFollowTail(true)
    setPendingNewCount(0)
    setSearchMode(false)
    setSearchQuery('')
    setSearchMatchIndex(0)
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
    setFollowTail(true)
    setPendingNewCount(0)
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
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (!sameSession) {
      const lastIndex = transcriptCards.length - 1
      const nextStart = windowStartForCursor(transcriptCards, lastIndex, transcriptViewportRows, expandedCardKeys)
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart].key)
      setFollowTail(true)
      setPendingNewCount(0)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (followTail) {
      const lastIndex = transcriptCards.length - 1
      const nextStart = windowStartForCursor(transcriptCards, lastIndex, transcriptViewportRows, expandedCardKeys)
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart].key)
      setPendingNewCount(0)
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
    }

    setTranscriptCursorKey((current) => {
      if (current && currentKeys.includes(current)) return current
      return transcriptCards[Math.max(cursorIndex, 0)]?.key ?? transcriptCards[0].key
    })
    setTranscriptTopKey((current) => {
      if (current && currentKeys.includes(current)) return current
      const nextStart = windowStartForCursor(transcriptCards, Math.max(cursorIndex, 0), transcriptViewportRows, expandedCardKeys)
      return transcriptCards[nextStart]?.key ?? transcriptCards[0].key
    })
    previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
  }, [
    cursorIndex,
    expandedCardKeys,
    followTail,
    selectedSessionKey,
    transcriptCards,
    transcriptViewportRows,
  ])

  useEffect(() => {
    if (transcriptCards.length === 0 || cursorIndex < 0) return
    if (followTail) {
      const lastIndex = transcriptCards.length - 1
      const nextStart = windowStartForCursor(transcriptCards, lastIndex, transcriptViewportRows, expandedCardKeys)
      setTranscriptCursorKey(transcriptCards[lastIndex].key)
      setTranscriptTopKey(transcriptCards[nextStart].key)
      return
    }

    if (cursorIndex < topIndex || cursorIndex > visibleTranscriptEndIndex) {
      const nextStart = windowStartForCursor(transcriptCards, cursorIndex, transcriptViewportRows, expandedCardKeys)
      setTranscriptTopKey(transcriptCards[nextStart].key)
    }
  }, [
    cursorIndex,
    expandedCardKeys,
    followTail,
    topIndex,
    transcriptCards,
    transcriptViewportRows,
    visibleTranscriptEndIndex,
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

    if (key.tab || input === '\t') {
      setFocusedPane((current) => current === 'sessions' ? 'messages' : 'sessions')
      return
    }

    if (focusedPane === 'sessions' && (input === 'j' || key.downArrow)) {
      moveSelection(1)
      return
    }

    if (focusedPane === 'sessions' && (input === 'k' || key.upArrow)) {
      moveSelection(-1)
      return
    }

    if (focusedPane === 'messages' && (input === 'j' || key.downArrow)) {
      moveCursor(1)
      return
    }

    if (focusedPane === 'messages' && (input === 'k' || key.upArrow)) {
      moveCursor(-1)
      return
    }

    if (focusedPane === 'sessions' && input === 'g') {
      if (sessions[0]) setSelectedSessionKey(sessionKey(sessions[0]))
      return
    }

    if (focusedPane === 'sessions' && input === 'G') {
      const last = sessions.at(-1)
      if (last) setSelectedSessionKey(sessionKey(last))
      return
    }

    if (focusedPane === 'messages' && input === 'g') {
      jumpToTranscriptIndex(0)
      return
    }

    if (focusedPane === 'messages' && input === 'G') {
      jumpToTranscriptTail()
      return
    }

    if (focusedPane === 'messages' && key.pageDown) {
      moveCursor(Math.max(visibleTranscriptCards.length - 1, 1))
      return
    }

    if (focusedPane === 'messages' && key.pageUp) {
      moveCursor(-Math.max(visibleTranscriptCards.length - 1, 1))
      return
    }

    if (focusedPane === 'messages' && (input === 'e' || key.return)) {
      toggleExpansion()
      return
    }

    if (focusedPane === 'messages' && input === 'f') {
      jumpToTranscriptTail()
      return
    }

    if (focusedPane === 'messages' && input === '/') {
      setSearchMode(true)
      return
    }

    if (focusedPane === 'messages' && input === 'n' && searchMatches.length > 0) {
      jumpToSearchMatch(1)
      return
    }

    if (focusedPane === 'messages' && input === 'N' && searchMatches.length > 0) {
      jumpToSearchMatch(-1)
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

    if (input === 'r') {
      void refreshSessions(provider)
      if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }
  }, { isActive: true })

  return (
    <Box flexDirection="column" paddingX={1} height={terminalRows} overflow="hidden" backgroundColor={theme.bg}>
      <Box justifyContent="space-between" backgroundColor={theme.surface} paddingX={1}>
        <Text bold color={theme.text}>AGENT VIEWER</Text>
        <Text>
          <Text backgroundColor={theme.surface2} color={theme.muted}> {themeMode.toUpperCase()} </Text>
          <Text color={theme.dim}> </Text>
          <Text backgroundColor={theme.surface2} color={focusedPane === 'sessions' ? theme.violet : theme.cyan}>
            {' '}
            {focusedPane.toUpperCase()}
            {' '}
          </Text>
          <Text color={theme.dim}> </Text>
          <Text backgroundColor={providerAccent} color={theme.surface}> {provider.toUpperCase()} </Text>
        </Text>
      </Box>

      <Box justifyContent="space-between" backgroundColor={theme.surface2} paddingX={1}>
        <Text>
          <Text color={theme.muted}>{projectCount} projects</Text>
          <Text color={theme.dim}>  </Text>
          <Text color={theme.muted}>{sessions.length} sessions</Text>
          <Text color={theme.dim}>  </Text>
          <Text color={sidebarAccent}>{currentProjectName.toUpperCase()}</Text>
        </Text>
        <Text>
          <Text color={statusColor}>{statusLabel.toLowerCase()}</Text>
          <Text color={theme.dim}>  </Text>
          <Text color={theme.muted}>{selectedSessionShortId}</Text>
        </Text>
      </Box>

      <Box flexGrow={1} height={contentHeight} overflow="hidden" marginTop={1}>
        <Box width={sidebarWidth} flexDirection="column" overflow="hidden">
          <Box flexDirection="column" backgroundColor={theme.surface} paddingX={1} paddingY={1} height={providerPanelHeight} overflow="hidden">
            <Text bold color={theme.violet}>PROVIDER</Text>
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
                <Text color={theme.muted}>current <Text color={providerAccent}>{provider.toUpperCase()}</Text></Text>
                <Text color={theme.dim}>all projects</Text>
                <Text color={focusedPane === 'sessions' ? theme.violet : theme.cyan}>focus {focusedPane}</Text>
                <Text color={theme.dim}>press p to switch provider</Text>
              </>
            )}
          </Box>

          <Box marginTop={1} backgroundColor={theme.surface} paddingX={1}>
            <Text bold color={theme.text}>SESSIONS <Text color={theme.dim}>{sessions.length}</Text></Text>
          </Box>

          <Box flexGrow={1} flexDirection="row" marginTop={1} backgroundColor={theme.surface2} overflow="hidden">
            <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1} overflow="hidden">
            {visibleSidebarEntries.length === 0 ? (
              <Text color={theme.dim}>{loadingSessions ? 'Loading sessions…' : 'No sessions found'}</Text>
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

        <Box width={SIDEBAR_GUTTER_WIDTH} />

        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          <Box flexDirection="column" backgroundColor={theme.surface} paddingX={1} paddingY={1} height={MESSAGE_HEADER_HEIGHT} overflow="hidden">
            <Box justifyContent="space-between">
              <Text bold color={theme.text}>SESSION</Text>
              <Text>
                <Text color={providerAccent}>{provider.toUpperCase()}</Text>
                <Text color={theme.dim}>  </Text>
                <Text color={theme.muted}>{transcriptCards.length} messages</Text>
              </Text>
            </Box>
            {selectedSession ? (
              <>
                {formatSessionMeta(selectedSession, sessionDetail?.info ?? null).map((line, index) => (
                  <Text key={`${index}:${line}`} color={index === 0 ? theme.text : theme.muted}>
                    {fitText(line, messageInnerWidth - 2)}
                  </Text>
                ))}
                <Text color={theme.dim}>
                  window{' '}
                  <Text color={theme.cyan}>
                    {transcriptCards.length === 0 ? 0 : topIndex + 1}-{transcriptWindowEnd}
                  </Text>
                  /{transcriptCards.length}
                  <Text color={followTail ? theme.green : theme.amber}>
                    {followTail ? '  live' : '  reading'}
                  </Text>
                  {pendingNewCount > 0 ? (
                    <Text color={theme.amber}>  +{pendingNewCount} new</Text>
                  ) : null}
                  {normalizedSearchQuery ? (
                    <Text color={theme.pink}>
                      {'  '}
                      /{fitText(searchQuery, 18).trim()}
                      {' '}
                      {searchMatches.length === 0 ? '0' : `${searchMatchIndex + 1}/${searchMatches.length}`}
                    </Text>
                  ) : null}
                </Text>
              </>
            ) : (
              <Text color={theme.dim}>No session selected</Text>
            )}
          </Box>

          <Box flexGrow={1} flexDirection="row" marginTop={1} backgroundColor={theme.surface2} overflow="hidden">
            <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1} overflow="hidden">
            {error ? (
              <Text color={theme.red}>{fitText(error, messageInnerWidth - 2)}</Text>
            ) : null}

            {loadingDetail ? (
              <Text color={theme.dim}>Loading transcript…</Text>
            ) : visibleTranscriptCards.length === 0 ? (
              <Text color={theme.dim}>No messages.</Text>
            ) : (
              visibleTranscriptCards.map((card, windowIndex) => {
                const absoluteIndex = topIndex + windowIndex
                const hasCursor = card.key === transcriptCursorKey && focusedPane === 'messages'
                const isExpanded = expandedCardKeys.has(card.key)
                const expandedLines = isExpanded ? card.expandedLines : null
                const accent = transcriptAccent(card.role, card.provider ?? provider)
                const timestamp = card.timestamp ?? ''
                const rawBodyLines = previewBodyLines(card)
                const groups = groupBodyLines(rawBodyLines)
                const bodyLineWidth = Math.max(transcriptLineWidth - 2, 20)
                const hiddenLines = Math.max(card.expandedLines.length - rawBodyLines.length, 0)
                const isSearchHit = normalizedSearchQuery.length > 0
                  && `${card.label}\n${card.searchText}`.toLowerCase().includes(normalizedSearchQuery)
                const isLatest = absoluteIndex === transcriptCards.length - 1

                return (
                  <Box key={card.key} flexDirection="column" marginBottom={1} overflow="hidden">
                    <Box>
                      <Text color={accent}>{hasCursor ? '▶ ' : '● '}</Text>
                      <Text bold color={accent}>{card.label}</Text>
                      {timestamp ? <Text color={theme.dim}>  {timestamp}</Text> : null}
                      {isLatest ? <Text color={theme.green}>  latest</Text> : null}
                      {isSearchHit ? <Text color={theme.pink}>  match</Text> : null}
                      {isExpanded ? <Text color={theme.dim}>  e collapse</Text> : null}
                    </Box>
                    <Box flexDirection="column" marginLeft={2}>
                      {isExpanded && expandedLines && expandedLines.length > 0 ? (
                        expandedLines.map((ln, lnIndex) => {
                          if (ln.tone === 'tool') {
                            const tm = ln.text.match(/^tool (\S+)(?:: (.*))?$/)
                            const tn = (tm?.[1] ?? 'TOOL').toUpperCase()
                            const tt = tm?.[2] ?? ''
                            return (
                              <Box key={`${card.key}:exp:${lnIndex}`} backgroundColor={theme.surface3} paddingX={1}>
                                <Text bold color={theme.cyan}>{tn}</Text>
                                {tt ? <Text color={theme.muted}> {fitText(tt, Math.max(bodyLineWidth - tn.length - 2, 8))}</Text> : null}
                              </Box>
                            )
                          }
                          return (
                            <Box key={`${card.key}:exp:${lnIndex}`} backgroundColor={transcriptBackground(ln, theme)} paddingX={1}>
                              <Text color={transcriptColor(ln)}>
                                {fitText(ln.text, bodyLineWidth - 2)}
                              </Text>
                            </Box>
                          )
                        })
                      ) : (
                        <>
                        {groups.map((group, groupIndex) => {
                          if (group.type === 'text') {
                            return (
                              <React.Fragment key={`${card.key}:t${groupIndex}`}>
                                {group.lines.map((ln, lnIndex) => (
                                  <Box key={`${card.key}:t${groupIndex}:${lnIndex}`}>
                                    <Text color={transcriptColor(ln)}>
                                      {fitText(ln.text, bodyLineWidth)}
                                    </Text>
                                  </Box>
                                ))}
                              </React.Fragment>
                            )
                          }

                          const toolMatch = group.toolLine.text.match(/^tool (\S+)(?:: (.*))?$/)
                          const toolName = toolMatch?.[1]?.toUpperCase() ?? 'TOOL'
                          const toolTarget = toolMatch?.[2] ?? ''
                          const resultLine = group.bodyLines.find(
                            (ln) => ln.tone === 'result_ok' || ln.tone === 'result_error',
                          )
                          const contentLines = group.bodyLines.filter(
                            (ln) => ln.tone !== 'result_ok' && ln.tone !== 'result_error',
                          )
                          const isError = resultLine?.tone === 'result_error'
                          const statusColor = isError ? theme.red : theme.green
                          const statusIcon = isError ? '✗' : '✓'
                          const statusLabel = isError ? 'ERROR' : 'OK'
                          const targetWidth = Math.max(bodyLineWidth - toolName.length - 2, 8)

                          if (toolName === 'FILECHANGE') {
                            const pathLine = group.bodyLines[0]?.tone === 'diff_meta' ? group.bodyLines[0] : null
                            const afterPath = pathLine ? group.bodyLines.slice(1) : group.bodyLines
                            const diffContent = afterPath.filter((ln) => ln.tone !== 'dim')
                            const pathText = pathLine?.text ?? ''
                            const slashIdx = pathText.indexOf('/')
                            const kind = slashIdx > 0 ? pathText.slice(0, slashIdx).trim() : 'change'
                            const filePath = slashIdx >= 0 ? pathText.slice(slashIdx) : pathText
                            const fileName = filePath.split('/').at(-1) ?? filePath
                            const kindColor = kind === 'delete' ? theme.red : theme.green
                            const fileNameWidth = Math.max(bodyLineWidth - kind.length - 16, 8)
                            return (
                              <Box key={`${card.key}:g${groupIndex}`} flexDirection="column">
                                <Box backgroundColor={theme.surface3} paddingX={1} justifyContent="space-between">
                                  <Box>
                                    <Text bold color={theme.cyan}>FILE CHANGE</Text>
                                    {fileName ? (
                                      <Text color={theme.text}>  {fitText(fileName, fileNameWidth)}</Text>
                                    ) : null}
                                  </Box>
                                  <Text color={kindColor}>{kind || 'completed'} ▲</Text>
                                </Box>
                                {filePath ? (
                                  <Box paddingX={1} backgroundColor={theme.diffMetaBg}>
                                    <Text color={theme.dim}>{fitText(filePath, bodyLineWidth - 2)}</Text>
                                  </Box>
                                ) : null}
                                {diffContent.map((ln, lnIndex) => (
                                  <Box
                                    key={`${card.key}:g${groupIndex}:d${lnIndex}`}
                                    backgroundColor={transcriptBackground(ln, theme)}
                                    paddingX={1}
                                  >
                                    <Text color={transcriptColor(ln)}>
                                      {fitText(ln.text, bodyLineWidth - 2)}
                                    </Text>
                                  </Box>
                                ))}
                                <Box paddingX={1} backgroundColor={theme.diffAddBg}>
                                  <Text color={theme.green}>✓ Applied {toolTarget}</Text>
                                </Box>
                              </Box>
                            )
                          }

                          return (
                            <Box key={`${card.key}:g${groupIndex}`} flexDirection="column">
                              <Box backgroundColor={theme.surface3} paddingX={1}>
                                <Text bold color={theme.cyan}>{toolName}</Text>
                                {toolTarget ? (
                                  <Text color={theme.muted}> {fitText(toolTarget, targetWidth)}</Text>
                                ) : null}
                              </Box>
                              {resultLine ? (
                                <Box
                                  paddingX={1}
                                  backgroundColor={isError ? theme.diffRemoveBg : theme.diffAddBg}
                                >
                                  <Text bold color={statusColor}>{statusIcon} {statusLabel}</Text>
                                  <Text color={theme.dim}>
                                    {'  '}
                                    {fitText(
                                      resultLine.text.replace(/^result (?:ok|error): /, ''),
                                      Math.max(bodyLineWidth - statusLabel.length - 6, 8),
                                    )}
                                  </Text>
                                </Box>
                              ) : null}
                              {contentLines.map((ln, lnIndex) => (
                                <Box
                                  key={`${card.key}:g${groupIndex}:c${lnIndex}`}
                                  backgroundColor={transcriptBackground(ln, theme)}
                                  paddingX={1}
                                >
                                  <Text color={transcriptColor(ln)}>
                                    {fitText(ln.text, Math.max(bodyLineWidth - 2, 16))}
                                  </Text>
                                </Box>
                              ))}
                            </Box>
                          )
                        })}
                        {hiddenLines > 0 && !isExpanded ? (
                          <Box paddingX={1}>
                            <Text color={theme.dim}>▼ {hiddenLines} more lines</Text>
                          </Box>
                        ) : null}
                        </>
                      )}
                    </Box>
                  </Box>
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
              thumbColor={focusedPane === 'messages' ? theme.cyan : theme.dim}
            />
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        {searchMode ? (
          <Text color={theme.dim}>
            SEARCH
            <Text color={theme.pink}> /{searchQuery || ''}</Text>
            <Text color={theme.muted}>
              {'  '}
              {searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}
              {'  enter jump  esc close'}
            </Text>
          </Text>
        ) : (
          <Text color={theme.dim}>
            TAB
            <Text color={theme.muted}> focus  </Text>
            J/K
            <Text color={theme.muted}> move  </Text>
            /
            <Text color={theme.muted}> search  </Text>
            N
            <Text color={theme.muted}> next  </Text>
            F
            <Text color={theme.muted}> live  </Text>
            E
            <Text color={theme.muted}> expand  </Text>
            P
            <Text color={theme.muted}> provider  </Text>
            R
            <Text color={theme.muted}> refresh  </Text>
            Q
            <Text color={theme.muted}> quit</Text>
          </Text>
        )}
      </Box>
    </Box>
  )
}

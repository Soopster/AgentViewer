/** @jsxImportSource @opentui/react */
import { indexComposerMessages, visibleComposerMessages } from '../../../lib/composerTranscript'
import { transcriptMeasure } from '../engineeringLayout'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { WindowButton } from '../WindowButton'
import { transcriptViewportPosition, useTranscriptWindowPositions } from '../transcriptWindowState'
import { useWorkspaceContext } from '../workspaceContext'
import { registerTuiMetricsGauge } from '../metricsLogger'
import { type SelectedLineRange } from '@pierre/diffs'
import { LayoutEvents, SyntaxStyle, TextAttributes, type BoxRenderable, type Renderable, type MouseEvent, type ScrollBoxRenderable } from '@opentui/core'
import { createReaderWindowStore } from '../readerWindowStore'
import { useRenderer } from '@opentui/react'
import { formatSessionTitle, formatTranscriptCard, type TuiTranscriptCard } from '../../format'
import { type ThreadedMessage } from '../../../lib/threading'
import { type TuiDensity, type TuiThemePalette, type TuiTranscriptView } from '../../theme'
import { readTuiSessionBookmarkIds, toggleTuiSessionBookmark, type TuiSessionDetail, type TuiDiffLayout, type TuiTranscriptWidth } from '../../../lib/tui/service'
import { useWindowVisible } from '../windowActivity'
import { type TranscriptBlockRestore } from '../VirtualTranscriptRows'
import { useTranscriptWindowChrome } from '../windowChrome'
import { usePinnedSessionDetail } from '../usePinnedSessionDetail'
import { useTranscriptCards } from '../useTranscriptCards'
import { type Session } from '../../../lib/types'
import { fitText, joinMeta } from '../textLayout'
import { calculateSplitPaneBodyRows } from '../splitPaneState'
import { type CardLandmark, type AgentToolGroupCard, type DensityState } from './types'
import { EMPTY_EXPANDED_KEYS } from './timing'
import { DOUBLE_CLICK_MS, READER_SCROLL_POLL_MS, SPLIT_PANE_CARD_WINDOW, READER_FIXUP_RETRY_MS, FLOATING_PANE_INDEX, MESSAGE_SCROLL_ACCEL } from './layoutConstants'
import { clamp } from './util'
import { Spinner, TuiErrorBoundary } from './chrome'
import { isDurableSessionMessage, isLiveAssistantTextMessage } from './liveStream'
import { sessionKey } from './sessionList'
import { transcriptAccent, turnSummaryMouseProps, streamLandmarkText, streamCompletedTurnHint } from './transcriptStyle'
import { readerRowCard, findReaderCard } from './readerRows'
import { agentToolCardsFor, stickyPromptText, groupStreamToolCards, isStreamGhostCard, visibleCardsForTranscriptView, resolveExpandedCardKeys, cardFoldsByDefault, scrollbackParkedCursorKey } from './transcriptRows'
import { type ReaderScrollFixup, type ReaderWindowGauge, type ReaderWindowOutput, type TranscriptWindowInputs, useReaderWindowSliding, TranscriptWindowBody } from './TranscriptWindowBody'

// A side-panel surface, or a popover broken out into a window (popoverWindows.ts).
// A surface window's id is its kind, or `kind#n` for a further one of a kind
// that can have several (shells, browsers, file views).
export type WindowSurfaceId = string
export function isDoubleClick(last: { current: { x: number; y: number; at: number } | null }, event: { x: number; y: number }): boolean {
  const now = Date.now()
  const previous = last.current
  const double = previous !== null && now - previous.at < DOUBLE_CLICK_MS && Math.abs(previous.x - event.x) <= 1 && previous.y === event.y
  last.current = double ? null : { x: event.x, y: event.y, at: now }
  return double
}
// Transcript refreshes are owned by TranscriptSessionLoader. Views acquire
// one observer while visible; the broker orders foreground reads and shares
// updates across transcript and pinned-tool views of the same variant.
export const EMPTY_SEARCH_MATCHES: number[] = []
export const SPLIT_PANE_EMPTY_LIVE: ThreadedMessage[] = []
export const noopSelectCard = () => {}

// A pinned session's detail handed to whatever renders it, or why there is none.
export function PinnedSessionDetail({ session, density, showToolCalls, shouldYield, theme, children }: {
  session: Session | null
  density: TuiDensity
  showToolCalls: boolean
  shouldYield: () => boolean
  theme: TuiThemePalette
  children: (detail: TuiSessionDetail, session: Session) => React.ReactNode
}) {
  const { detail, status } = usePinnedSessionDetail(session, density, showToolCalls, shouldYield)
  if (status === 'gone' || !session) return <text fg={theme.dim}>  That session is no longer available.</text>
  if (!detail) return <text fg={theme.dim}>{status === 'error' ? '  Could not read the session.' : '  Loading…'}</text>
  return <>{children(detail, session)}</>
}

export function shouldPollSplitPaneDetail(
  previous: { key: string; variant: string; lastModified: number } | null,
  key: string,
  variant: string,
  lastModified: number | undefined,
  active: boolean,
): boolean {
  return active
    || previous === null
    || previous.key !== key
    || previous.variant !== variant
    || lastModified === undefined
    || previous.lastModified < lastModified
}

// Imperative scroll surface a focused pane hands to the root key dispatcher.
// The pane keeps its own tail-follow flag inside these methods, so scrolling up
// detaches from the live tail and G re-attaches — the root never has to know.
// Keys the reader binds to its transcript (cursor, scroll, folds, marks,
// jumps, search, the selected card's diff); a focused window keeps them.

export const subscribeNothing = (_listener: () => void) => () => {}
export const getNothing = () => null

export type SplitPaneHandle = {
  frame: () => BoxRenderable | null
  scrollByRows: (rows: number) => void
  scrollToTop: () => void
  scrollToBottom: () => void
  // Card-level reader controls. The root dispatcher owns the keymap; the pane
  // owns the state, so both readers behave identically without the pane having
  // to re-implement clipboard, bookmarks or the composer.
  moveCursor: (delta: number) => void
  cursorToEdge: (edge: 'first' | 'last') => void
  toggleExpandedAtCursor: () => void
  collapseAll: () => void
  getCursorCard: () => TuiTranscriptCard | null
  getSession: () => Session
  toggleBookmarkAtCursor: () => Promise<boolean>
  /**
   * Move the cursor to the next card containing `query`: older for -1, newer
   * for 1. Older history outside the loaded window is paged in first, so the
   * whole transcript is searched. 'loading' means it is being paged in.
   */
  search: (query: string, direction: 1 | -1) => 'found' | 'loading' | 'none'
  /** What the window has mounted: the root's diff keys act on the cursor card's display. */
  mountedOutput: () => ReaderWindowOutput
  /** A jump made elsewhere (search, bookmarks, markers) lands on this card. */
  jumpToKey: (cardKey: string, follow: boolean) => void
  /** SCROLLBACK: the text scrolls by rows and has no visible cursor. */
  isScrollback: () => boolean
  /** A page of this window's own viewport: two rows of overlap, as a pager keeps. */
  pageRows: () => number
  /** SCROLLBACK's e / Enter: expand or fold everything. */
  toggleScrollbackAll: () => void
}

// Sticky prompt header: the last user prompt whose card has scrolled above the
// viewport's top edge. Polled off layout because scroll position is not React
// state; it sets state only on a change, so an idle window does not re-render.
export function useStickyPromptKey(scrollRef: React.RefObject<ScrollBoxRenderable | null>, cards: TuiTranscriptCard[], enabled: boolean): string | null {
  const [stickyKey, setStickyKey] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) {
      setStickyKey(null)
      return undefined
    }
    const userKeys = new Set(cards.filter((card) => card.role === 'user').map((card) => `card:${card.key}`))
    // Each child.y is a native layout read, and at the tail this walk visits
    // every mounted card, eight times a second, for an answer that cannot
    // change while nothing moves. It was most of the main thread's CPU while a
    // session sat open. Same geometry, same header: the walk runs only when the
    // viewport or the content moved.
    let lastGeometry = ''
    const interval = setInterval(() => {
      const sb = scrollRef.current
      if (!sb || userKeys.size === 0) return
      const scrollTop = sb.scrollTop
      const children = sb.content.getChildren()
      const geometry = `${scrollTop}:${sb.scrollHeight}:${sb.viewport.height}:${children.length}`
      if (geometry === lastGeometry) return
      lastGeometry = geometry
      const viewportBottom = scrollTop + sb.viewport.height
      // The newest prompt that has scrolled above the top edge — unless a
      // newer one is already on screen, which then takes over: near the tail
      // the header names the question being answered, not the one before it.
      let next: string | null = null
      let reachedTop = false
      const contentTop = sb.content.y
      for (const child of children) {
        const row = readerRowCard(child as Renderable) ?? child
        const top = child.y - contentTop
        if (top >= viewportBottom) break
        if (top >= scrollTop) reachedTop = true
        if (userKeys.has(row.id) && (!reachedTop || next !== null)) next = row.id.slice('card:'.length)
      }
      setStickyKey((prev) => (prev === next ? prev : next))
    }, READER_SCROLL_POLL_MS)
    return () => clearInterval(interval)
  }, [enabled, cards, scrollRef])
  return stickyKey
}

export function StickyPromptHeader({ card, theme, accent, width }: { card: TuiTranscriptCard; theme: TuiThemePalette; accent: string; width: number }) {
  // A prompt's first line can be a single word ("Do") with the request on the
  // lines below it; the header reads them as one.
  return (
    <box id="sticky-header" position="absolute" top={0} left={1} width={Math.max(width - 4, 12)} height={1}
      flexDirection="row" zIndex={5} backgroundColor={theme.userBg} overflow="hidden">
      <text fg={accent} attributes={TextAttributes.BOLD} wrapMode="none" width={10} flexShrink={0}>{'▌ PROMPT  '}</text>
      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">{fitText(stickyPromptText(card), Math.max(width - 14, 2))}</text>
    </box>
  )
}

// The rule under a finished turn at the tail of a stream view: the closing
// "Worked for … · n files" summary, clickable like the ones between turns.
export function StreamTurnFooter({ landmark, theme, densityState, transcriptWidth, width }: {
  landmark: CardLandmark
  theme: TuiThemePalette
  densityState: DensityState
  transcriptWidth: TuiTranscriptWidth
  width: number
}) {
  // The same box a stream card draws its own turn rule in, so the closing rule
  // shares the column's edge instead of hugging the pane's while the text
  // above it is centered.
  const footerWidth = transcriptWidth === 'full'
    ? Math.max(width - 5, 12)
    : Math.max(transcriptMeasure(Math.max(width - 4, 16) - densityState.bodyIndent, transcriptWidth), 16)
      + densityState.bodyIndent
  return (
    <box
      key="stream-turn-footer"
      paddingX={transcriptWidth === 'full' ? 1 : 0}
      marginBottom={densityState.cardGap}
      width={transcriptWidth === 'full' ? undefined : footerWidth}
      alignSelf={transcriptWidth === 'centered' ? 'center' : undefined}
    >
      <text fg={theme.dim} width={footerWidth} wrapMode="none" selectable {...turnSummaryMouseProps(landmark)}>
        {streamLandmarkText(landmark, footerWidth)}
      </text>
    </box>
  )
}

export type TranscriptDiffControls = Pick<TranscriptWindowInputs,
  | 'diffNotes' | 'diffDraft' | 'hoveredDiffAnchor' | 'diffPlainCardKeys'
  | 'diffHiddenLineNumberCardKeys' | 'diffHiddenHunkHeaderCardKeys' | 'diffRowCursorByCardKey'
  | 'diffSelectionAnchorByCardKey' | 'setDiffRowCursor' | 'setDiffSelectionAnchor'
> & {
  activateDiffHover: (anchor: string, position?: { namespace: string; scrollTop: number | null }) => void
  openDiffNote: (namespace: string, selection: SelectedLineRange, cardKey?: string) => void
  sendDiffNoteToComposer: (namespace: string, ...args: Parameters<TranscriptWindowInputs['sendDiffNoteToComposer']>) => void
}

export type SplitTranscriptPaneProps = {
  session: Session
  theme: TuiThemePalette
  densityState: DensityState
  density: TuiDensity
  showToolCalls: boolean
  syntaxStyle: SyntaxStyle | null
  shouldEnableSyntaxHighlighting: boolean
  thinkingMode: boolean
  diffLayout: TuiDiffLayout
  imessageStyle: boolean
  transcriptWidth: TuiTranscriptWidth
  transcriptView: TuiTranscriptView
  width: number
  height: number
  paneIndex: number
  paneNumber: number
  /** Total mounted panes — drives the ⌃B <digit> hint in the frame title. */
  paneCount: number
  focused: boolean
  /** Shows the selected session: the transcript being read, under the reader's ids. */
  selected: boolean
  /** The selected transcript's cursor is the reader's: jumps and search start from it. */
  onCursorChange?: (cardKey: string | null) => void
  /** …and so is whether it follows the tail: the banner and idle ticker read it. */
  onFollowChange?: (follow: boolean) => void
  /** Draws the reader's chrome (header, banners, composer bar): the window showing the selected session, else the focused one. */
  chromeHost: boolean
  /** Full screen: no frame, title or key hints; the transcript takes the edges. */
  frameless?: boolean
  /** The transcript search, highlighted in the window showing the selected session. */
  searchQuery: string
  activeSearchKey: string | null
  // Live overlay for THIS pane's session, sliced from the app-wide live stream.
  liveMessages: ThreadedMessage[]
  liveBaselineCount?: number
  running: boolean
  attentionBadge: string | null
  coordinatorLabel?: string
  diffControls: TranscriptDiffControls
  agentToolCursorByGroupKey: Record<string, string>
  onSelectAgentTool: (groupKey: string, toolKey: string) => void
  onActivity: (key: string, version: string, errorVersion: string | null) => void
  liveText: string | null
  registerHandle: (paneIndex: number, handle: SplitPaneHandle | null, expected?: SplitPaneHandle) => void
  onActivate: (paneIndex: number) => void
  /** Title bar actions target this window. */
  onClosePane: (paneIndex: number) => void
  onPromotePane: (session: Session) => void
  /** The title bar's ⊞ layout: the window layout menu. */
  onOpenLayout: () => void
  onContextMenu: (session: Session, source: 'pane', point: { x: number; y: number }, paneIndex: number) => void
  stickyHeaders: boolean
  /** Lightweight windows: the current view drawn the old pane's way (see `lightView`). */
  lightweight: boolean
  /** Links in the transcript: noted on press, followed on an unmoved release (`renderer.getLinkAt`). True when one was. */
  onTranscriptPress: (event: MouseEvent) => void
  onTranscriptRelease: (event: MouseEvent) => boolean
  /** A card's follow-up questions, opened by clicking it in SCROLLBACK. */
  onOpenAsyncQuestions: (session: Session, card: TuiTranscriptCard) => void
  /** A floating window moves by its title (App's float gesture). */
  floatGesture: { start: (event: { x: number; y: number }) => void; move: (event: { x: number; y: number }) => void; end: (event: { x: number; y: number }) => void }
  /** Dragging the pane by its title onto the window area (App's shared press/move/release). */
  sessionDrag: { press: (session: Session, fromPane: number | null, event: { x: number; y: number }, onClick?: () => void) => void; move: (event: { x: number; y: number }) => void; release: (event: { x: number; y: number }) => void }
  // True while the reader is opening a session. The threading worker is
  // serial, and a pane's poll is a FULL detail read — the same shape the
  // neighbour prefetch was reshaped to avoid — so a pane posted ahead of a
  // real open delays the thing the user is actually waiting for. With two
  // panes it delays it twice.
  shouldYieldToForeground: () => boolean
}

export function SplitTranscriptPaneInner({
  session,
  theme,
  densityState,
  density,
  showToolCalls,
  syntaxStyle,
  shouldEnableSyntaxHighlighting,
  thinkingMode,
  diffLayout,
  imessageStyle,
  transcriptWidth,
  transcriptView,
  width,
  height,
  paneIndex,
  paneNumber,
  paneCount,
  focused,
  selected,
  onCursorChange,
  onFollowChange,
  chromeHost,
  frameless = false,
  searchQuery,
  activeSearchKey,
  liveMessages,
  liveBaselineCount,
  running,
  attentionBadge,
  coordinatorLabel,
  onActivity,
  diffControls,
  agentToolCursorByGroupKey,
  onSelectAgentTool,
  liveText,
  registerHandle,
  onActivate,
  onClosePane,
  onPromotePane,
  onOpenLayout,
  onContextMenu,
  stickyHeaders,
  lightweight,
  onTranscriptPress,
  onTranscriptRelease,
  onOpenAsyncQuestions,
  floatGesture,
  sessionDrag,
  shouldYieldToForeground,
}: SplitTranscriptPaneProps) {
  const key = sessionKey(session)
  const { header: selectedWindowHeader, footer: selectedWindowFooter } = useTranscriptWindowChrome()
  const positions = useTranscriptWindowPositions()
  const paneWorkspace = useWorkspaceContext()
  const [initialPosition] = useState(() => positions.current.get(key))
  const legacy = paneWorkspace?.runtime.values
  const paneFrameRef = useRef<BoxRenderable | null>(null)
  const titleClickRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const promoteThisPane = useCallback(() => onPromotePane(session), [onPromotePane, session])
  const closeThisPane = useCallback(() => onClosePane(paneIndex), [onClosePane, paneIndex])
  const { cards, status, error, detail: persistedPaneDetail } = useTranscriptCards({
    session, density, showToolCalls, focused,
    active: running || liveMessages.length > 0 || Boolean(liveText),
    shouldYield: shouldYieldToForeground,
  })
  const [followTail, setFollowTail] = useState(initialPosition?.state.followTail ?? (legacy?.get(`pane:${key}:followTail`) as boolean | undefined) ?? true)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [initialScrollTop] = useState(() => initialPosition?.scrollTop ?? (legacy?.get(`ref:pane:${key}:scroll`) as { current: number | null } | undefined)?.current ?? null)
  const capturePanePositionRef = useRef(() => {})
  useLayoutEffect(() => {
    const capture = () => capturePanePositionRef.current()
    paneWorkspace?.runtime.flushers.add(capture)
    return () => { capture(); paneWorkspace?.runtime.flushers.delete(capture) }
  }, [key, paneWorkspace?.runtime])
  const visible = useWindowVisible()
  // The mounted card window slides like the reader's, from this window's own
  // store, starting where the transcript was last read.
  const [windowStore] = useState(() => {
    const store = createReaderWindowStore()
    store.prime(initialPosition && initialPosition.state.followTail === false ? initialPosition.windowStart : null)
    return store
  })

  const paneMessageIndex = useMemo(() => {
    let at = 0
    const recent = new Set((persistedPaneDetail?.rawMessages ?? []).filter(message => {
      if (!isDurableSessionMessage(message)) return false
      return at++ >= (liveBaselineCount ?? Number.POSITIVE_INFINITY) && message.type === 'user'
    }).map(message => message.uuid))
    return indexComposerMessages(persistedPaneDetail?.threadedMessages ?? [], recent)
  }, [persistedPaneDetail, liveBaselineCount])
  // Live overlay: the pane polls persisted state every few seconds, but a
  // running turn streams through the app-wide live list — formatting that here
  // is what makes a pane a real-time window instead of a stale snapshot. Live
  // cards win over persisted ones with the same key, so the poll that finally
  // lands the message doesn't render it twice.
  const liveCards = useMemo(
    () => visibleComposerMessages(liveMessages, paneMessageIndex).map((message) => {
      const formatted = formatTranscriptCard(message, density)
      return isLiveAssistantTextMessage(message)
        ? { ...formatted, markdownContent: undefined }
        : formatted
    }),
    [liveMessages, density, paneMessageIndex],
  )
  // A pane reads in the reader's own view. For the stream views that means the
  // reader's shaping too: bookkeeping rows dropped, tool calls grouped into
  // activity rows, and no "No visible content" stop for every tool-only
  // message — otherwise the two halves of a split are two different apps.
  const paneStreamLike = transcriptView === 'stream' || transcriptView === 'chat'
    || transcriptView === 'transcript' || transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || transcriptView === 'copilot' || transcriptView === 'opencode'
  // Lightweight windows draw the current view the way the old pane did:
  // bookkeeping rows dropped, tool calls grouped into activity rows and no
  // empty streaming placeholders, whatever the view; every card starts folded;
  // and only the tail is mounted, loading a page at a time as the cursor walks
  // back, so a long transcript costs nothing it is not showing.
  const lightView = lightweight
  const fullPaneCards = useMemo(() => {
    const liveKeys = new Set(liveCards.map(card => card.key))
    const merged = liveCards.length ? [...cards.filter(card => !liveKeys.has(card.key)), ...liveCards] : cards
    return lightView
      ? groupStreamToolCards(merged.filter(card => card.category !== 'system')).filter(card => !isStreamGhostCard(card))
      : visibleCardsForTranscriptView(merged, transcriptView)
  }, [cards, liveCards, transcriptView, lightView])
  // Counted against the persisted cards: live cards are additions and must not
  // push history out of the window while a turn streams. Kept with the
  // window's position, so a remount does not drop the pages already loaded.
  const [loadedCount, setLoadedCount] = useState(initialPosition?.loadedCount ?? SPLIT_PANE_CARD_WINDOW)
  const lightStart = lightView ? Math.max(0, fullPaneCards.length - liveCards.length - loadedCount) : 0
  const allPaneCards = useMemo(() => lightStart > 0 ? fullPaneCards.slice(lightStart) : fullPaneCards, [fullPaneCards, lightStart])
  const fullCardsRef = useRef(fullPaneCards)
  fullCardsRef.current = fullPaneCards
  const lightRef = useRef({ light: lightView, start: lightStart })
  lightRef.current = { light: lightView, start: lightStart }

  const activityReport = useMemo(() => {
    const last = liveCards.at(-1) ?? cards.at(-1)
    const errorCard = [...cards, ...liveCards].findLast((card) => card.lines.some((line) => line.tone === 'result_error'))
    return {
      version: JSON.stringify([cards.length, last?.key, last?.searchText, liveText]),
      errorVersion: status === 'error' ? `load:${error}` : errorCard ? `${errorCard.key}:${errorCard.searchText}` : null,
    }
  }, [cards, liveCards, liveText, status, error])
  useEffect(() => {
    if (status !== 'loading') onActivity(key, activityReport.version, activityReport.errorVersion)
  }, [onActivity, key, status, activityReport])

  // Cursor: null means "following the tail". Set once the reader focuses this
  // pane and moves, which is also what detaches tail-follow.
  const [cursorKey, setCursorKey] = useState<string | null>(initialPosition?.state.cursorKey ?? (legacy?.get(`pane:${key}:cursorKey`) as string | null | undefined) ?? null)
  // Expansion as the reader keeps it: per-card overrides of the view's
  // default, so cards that arrive later fold or open by that default.
  const [expandedCardKeys, setExpandedCardKeys] = useState<ReadonlySet<string>>(() => new Set(initialPosition?.state.expandedKeys))
  const [collapsedCardKeys, setCollapsedCardKeys] = useState<ReadonlySet<string>>(() => new Set(initialPosition?.state.collapsedKeys))
  const expandedKeys = useMemo(
    () => resolveExpandedCardKeys(allPaneCards, transcriptView, paneStreamLike, expandedCardKeys, collapsedCardKeys, lightView),
    [allPaneCards, transcriptView, paneStreamLike, expandedCardKeys, collapsedCardKeys, lightView],
  )
  // SCROLLBACK folds everything or nothing (e), with clicked exceptions.
  const [scrollbackExpanded, setScrollbackExpanded] = useState(initialPosition?.scrollbackExpanded ?? false)
  const [scrollbackToggledKeys, setScrollbackToggledKeys] = useState<ReadonlySet<string>>(() => new Set(initialPosition?.scrollbackToggledKeys))
  const scrollbackSyncedCursorKeyRef = useRef<string | null>(null)
  const expansionRef = useRef({ expandedKeys, view: transcriptView, chatLike: paneStreamLike, foldAll: lightView })
  expansionRef.current = { expandedKeys, view: transcriptView, chatLike: paneStreamLike, foldAll: lightView }
  const cardsRef = useRef(allPaneCards)
  const cursorKeyRef = useRef<string | null>(cursorKey)

  const paneScrollbackLike = transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || transcriptView === 'copilot' || transcriptView === 'opencode'
  const scrollbackRef = useRef(paneScrollbackLike)
  scrollbackRef.current = paneScrollbackLike
  const sessionRef = useRef(session)

  // Bookmarks are per session, so a pane loads its own set rather than
  // borrowing the reader's — and owns the toggle so the state stays local.
  const [bookmarkedKeys, setBookmarkedKeys] = useState<ReadonlySet<string>>(EMPTY_EXPANDED_KEYS)
  const bookmarkedKeysRef = useRef<ReadonlySet<string>>(bookmarkedKeys)
  useLayoutEffect(() => {
    cardsRef.current = allPaneCards
    cursorKeyRef.current = cursorKey
    sessionRef.current = session
    bookmarkedKeysRef.current = bookmarkedKeys
  }, [bookmarkedKeys, allPaneCards, cursorKey, session])
  useEffect(() => {
    let cancelled = false
    void readTuiSessionBookmarkIds({ sessionId: session.sessionId, provider: session.provider } as Session)
      .then((ids) => { if (!cancelled) setBookmarkedKeys(new Set(ids)) })
      .catch(() => { if (!cancelled) setBookmarkedKeys(EMPTY_EXPANDED_KEYS) })
    return () => { cancelled = true }
  }, [key, session.provider, session.sessionId])

  const selectPaneCard = useCallback((cardKey: string) => {
    setCursorKey(cardKey)
    onActivate(paneIndex)
  }, [onActivate, paneIndex])

  // A search hit can sit inside a grouped tool row; the row is what the cursor lands on.
  const cardMatches = (card: TuiTranscriptCard, query: string): boolean =>
    card.searchHaystackLower.includes(query)
    || ((card as AgentToolGroupCard).agentToolCards ?? []).some((tool) => tool.searchHaystackLower.includes(query))
  // The handle is registered once per pane index; every method reads through a
  // ref so it never goes stale as cards stream in.
  useEffect(() => {
    const maxScroll = (sb: ScrollBoxRenderable): number => Math.max(sb.scrollHeight - sb.viewport.height, 0)
    const scrollTo = (position: number, follow: boolean) => {
      const sb = scrollRef.current
      if (!sb) return
      sb.scrollTop = position
      setFollowTail(follow)
    }
    const cursorIndexNow = (): number => {
      const list = cardsRef.current
      const current = cursorKeyRef.current
      if (!current) return list.length - 1
      const found = list.findIndex((card) => card.key === current)
      return found >= 0 ? found : list.length - 1
    }
    // An explicit move is revealed, even onto the card scrolling parked it on.
    const jumpCursor = (cardKey: string) => {
      scrollbackSyncedCursorKeyRef.current = null
      // Lightweight: a card older than what is loaded pages in, with a little above it.
      const { light, start } = lightRef.current
      if (light && start > 0) {
        const index = fullCardsRef.current.findIndex((card) => card.key === cardKey)
        if (index >= 0 && index < start) setLoadedCount((count) => count + start - index + 4)
      }
      setCursorKey(cardKey)
    }
    const loadEarlier = () => {
      if (lightRef.current.light && lightRef.current.start > 0) setLoadedCount((count) => count + SPLIT_PANE_CARD_WINDOW)
    }
    const handle: SplitPaneHandle = {
      frame: () => paneFrameRef.current,
      search: (rawQuery, direction) => {
        const query = rawQuery.trim().toLowerCase()
        if (!query) return 'none'
        // The whole transcript: a match outside the mounted window recenters it.
        const list = fullCardsRef.current
        const cursorAt = cursorKeyRef.current ? list.findIndex((card) => card.key === cursorKeyRef.current) : -1
        const from = cursorAt >= 0 ? cursorAt : list.length - 1
        for (let index = from + direction; index >= 0 && index < list.length; index += direction) {
          if (cardMatches(list[index]!, query)) {
            jumpCursor(list[index]!.key)
            setFollowTail(index === list.length - 1)
            return 'found'
          }
        }
        return 'none'
      },
      pageRows: () => Math.max((scrollRef.current?.viewport.height ?? 3) - 2, 1),
      scrollByRows: (rows) => {
        const sb = scrollRef.current
        if (!sb) return
        const limit = maxScroll(sb)
        const next = clamp(sb.scrollTop + rows, 0, limit)
        sb.scrollTop = next
        settleScrollRef.current(sb, next, limit)
      },
      scrollToTop: () => {
        const sb = scrollRef.current
        if (!sb) return
        scrollTo(0, maxScroll(sb) === 0)
      },
      scrollToBottom: () => {
        const sb = scrollRef.current
        if (!sb) return
        scrollTo(maxScroll(sb), true)
      },
      moveCursor: (delta) => {
        const list = cardsRef.current
        if (list.length === 0) return
        const next = clamp(cursorIndexNow() + delta, 0, list.length - 1)
        const nextCard = list[next]
        if (!nextCard) return
        jumpCursor(nextCard.key)
        // Cursor at the last card means the reader is watching the tail again.
        setFollowTail(next === list.length - 1)
        // Walking onto the first loaded card loads the page before it.
        if (next === 0) loadEarlier()
      },
      cursorToEdge: (edge) => {
        const list = cardsRef.current
        if (list.length === 0) return
        const target = edge === 'first' ? list[0] : list[list.length - 1]
        if (!target) return
        jumpCursor(target.key)
        setFollowTail(edge === 'last')
        const sb = scrollRef.current
        if (sb) scrollTo(edge === 'first' ? 0 : maxScroll(sb), edge === 'last')
        if (edge === 'first') loadEarlier()
      },
      toggleExpandedAtCursor: () => {
        const list = cardsRef.current
        const card = list[cursorIndexNow()]
        if (!card) return
        jumpCursor(card.key)
        const { expandedKeys: open, view, chatLike, foldAll } = expansionRef.current
        const isExpanded = open.has(card.key)
        const toggle = (current: ReadonlySet<string>, add: boolean) => {
          if (current.has(card.key) === add) return current
          const next = new Set(current)
          if (add) next.add(card.key)
          else next.delete(card.key)
          return next
        }
        if (cardFoldsByDefault(card, view, chatLike, foldAll)) {
          setCollapsedCardKeys((current) => toggle(current, false))
          setExpandedCardKeys((current) => toggle(current, !isExpanded))
        } else {
          setExpandedCardKeys((current) => toggle(current, false))
          setCollapsedCardKeys((current) => toggle(current, isExpanded))
        }
      },
      isScrollback: () => scrollbackRef.current,
      mountedOutput: () => windowOutputRef.current,
      jumpToKey: (cardKey, follow) => {
        jumpCursor(cardKey)
        setFollowTail(follow)
      },
      toggleScrollbackAll: () => {
        setScrollbackExpanded((current) => !current)
        setScrollbackToggledKeys(EMPTY_EXPANDED_KEYS)
      },
      collapseAll: () => {
        setExpandedCardKeys(EMPTY_EXPANDED_KEYS)
        setCollapsedCardKeys(new Set(cardsRef.current.map((card) => card.key)))
      },
      getCursorCard: () => cardsRef.current[cursorIndexNow()] ?? null,
      getSession: () => sessionRef.current,
      toggleBookmarkAtCursor: async () => {
        const card = cardsRef.current[cursorIndexNow()]
        if (!card) throw new Error('No message selected')
        if (card.key.startsWith('live-')) throw new Error('Cannot bookmark a streaming message')
        const target = sessionRef.current
        const adding = !bookmarkedKeysRef.current.has(card.key)
        setBookmarkedKeys((current) => {
          const next = new Set(current)
          if (adding) next.add(card.key)
          else next.delete(card.key)
          return next
        })
        try {
          const ids = await toggleTuiSessionBookmark(
            { sessionId: target.sessionId, provider: target.provider } as Session,
            card.key,
            adding,
            adding
              ? {
                  role: card.role,
                  label: card.role === 'user' ? 'user' : 'assistant',
                  preview: (card.compactSummary || card.searchText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
                  sessionTitle: formatSessionTitle(target) || undefined,
                  messageTimestamp: card.timestamp,
                }
              : undefined,
          )
          setBookmarkedKeys(new Set(ids))
        } catch (err) {
          // Roll the optimistic flip back so the gutter never lies.
          setBookmarkedKeys((current) => {
            const next = new Set(current)
            if (adding) next.delete(card.key)
            else next.add(card.key)
            return next
          })
          throw err
        }
        return adding
      },
    }
    registerHandle(paneIndex, handle)
    return () => registerHandle(paneIndex, null, handle)
  }, [paneIndex, registerHandle])

  // Following the tail pins the bottom once the tail window has mounted — on
  // starting to follow and as cards arrive — as the reader does. Scrolling in
  // the key handler alone lands in the window that was mounted before.
  const prevFollowTailRef = useRef(followTail)
  const prevCardCountRef = useRef(allPaneCards.length)
  useLayoutEffect(() => {
    if (followTail && allPaneCards.length > 0 && (prevCardCountRef.current !== allPaneCards.length || !prevFollowTailRef.current)) {
      const sb = scrollRef.current
      sb?.scrollTo(sb.scrollHeight)
    }
    prevFollowTailRef.current = followTail
    prevCardCountRef.current = allPaneCards.length
  }, [followTail, allPaneCards.length])

  // Keep the cursor card in view as the cursor moves or new cards arrive.
  const paneRenderer = useRenderer()
  useEffect(() => {
    // Following, the bottom is pinned; a card not laid out yet would scroll to
    // where it was last measured, which for a freshly mounted tail is the top.
    if (!cursorKey || followTail || restoreHold.current) return
    // A cursor the scroll parked must not be revealed: that undoes the scroll.
    if (cursorKey === scrollbackSyncedCursorKeyRef.current) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const scroll = () => { paneRenderer.root.off(LayoutEvents.LAYOUT_CHANGED, afterLayout); scrollRef.current?.scrollChildIntoView(`card:${cursorKey}`) }
    const afterLayout = () => { if (timer) clearTimeout(timer); timer = setTimeout(scroll, 0) }
    paneRenderer.root.on(LayoutEvents.LAYOUT_CHANGED, afterLayout)
    scrollRef.current?.scrollChildIntoView(`card:${cursorKey}`)
    timer = setTimeout(scroll, 50)
    return () => { paneRenderer.root.off(LayoutEvents.LAYOUT_CHANGED, afterLayout); if (timer) clearTimeout(timer) }
  }, [cursorKey, allPaneCards, paneRenderer, followTail])

  // The viewport is restored from the store as it is when this runs, not as
  // it was at mount: a window that moved (floated, docked) remounts before
  // its previous instance has written where it was.
  const paneRestored = useRef(false)
  const restoreHold = useRef(Boolean(initialPosition && !followTail))
  const blockRestore = useRef<TranscriptBlockRestore | null>(initialPosition?.blockAnchorKey ? { id: initialPosition.blockAnchorKey, offset: initialPosition.blockAnchorOffset ?? 0 } : null)
  useEffect(() => {
    if (paneRestored.current || !allPaneCards.length) return
    if (followTail) { paneRestored.current = true; restoreHold.current = false; blockRestore.current = null; return }
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const restore = () => {
      const sb = scrollRef.current
      const position = positions.current.get(key) ?? initialPosition
      const saved = position?.scrollTop ?? initialScrollTop
      if (!sb || saved == null) { restoreHold.current = false; blockRestore.current = null; return }
      let anchor = position?.anchorKey ? findReaderCard(sb.content, `card:${position.anchorKey}`) : undefined
      if (!anchor && position?.anchorKey && tries++ < 120) {
        const index = allPaneCards.findIndex(card => card.key === position.anchorKey)
        if (index >= 0) { windowStore.set(Math.max(0, index - 2)); timer = setTimeout(restore, READER_FIXUP_RETRY_MS); return }
      }
      const block = anchor && blockRestore.current ? anchor.findDescendantById(blockRestore.current.id) : undefined
      const loading = anchor?.findDescendantById('transcript-block-loading')
      if ((blockRestore.current && !block || loading || !windowGaugeRef.current.settled) && tries++ < 120) {
        timer = setTimeout(restore, READER_FIXUP_RETRY_MS)
        return
      }
      const target = block && block.height > 0 ? block.y - sb.content.y - (blockRestore.current?.offset ?? 0)
        : anchor && anchor.height > 0 ? anchor.y - sb.content.y - position!.anchorOffset : saved
      sb.scrollTo(Math.max(0, target))
      blockRestore.current = null
      paneRestored.current = true
      restoreHold.current = false
    }
    timer = setTimeout(restore, READER_FIXUP_RETRY_MS)
    return () => clearTimeout(timer)
  }, [allPaneCards, followTail])
  // What the reader keeps about a transcript is written through as it
  // changes, so a remount (a window moving) starts from it.
  useEffect(() => {
    const sb = scrollRef.current
    const previous = positions.current.get(key)
      ?? (sb ? { ...transcriptViewportPosition(sb), windowStart: windowGaugeRef.current.start, state: { followTail, cursorKey, topKey: null, expandedKeys: [], collapsedKeys: [] } } : null)
    if (!previous) return
    positions.current.set(key, {
      ...previous,
      state: { ...previous.state, followTail, cursorKey, expandedKeys: [...expandedCardKeys], collapsedKeys: [...collapsedCardKeys] },
      scrollbackExpanded,
      scrollbackToggledKeys: [...scrollbackToggledKeys],
      loadedCount,
    })
  }, [followTail, cursorKey, expandedCardKeys, collapsedCardKeys, scrollbackExpanded, scrollbackToggledKeys, loadedCount])

  useLayoutEffect(() => {
    capturePanePositionRef.current = () => {
      const sb = scrollRef.current
      if (!visible || !sb || sb.viewport.height <= 0 || sb.viewport.width <= 0 || status === 'loading' || !cards.length || (!followTail && !paneRestored.current && initialScrollTop !== null)) return
      const viewport = transcriptViewportPosition(sb)
      const previous = positions.current.get(key)
      positions.current.set(key, {
        ...previous, ...viewport,
        state: {
          followTail: followTail && sb.scrollTop >= Math.max(0, sb.scrollHeight - sb.viewport.height) - 1,
          cursorKey, topKey: viewport.anchorKey,
          expandedKeys: [...expandedCardKeys],
          collapsedKeys: [...collapsedCardKeys],
        },
        windowStart: windowGaugeRef.current.start,
        scrollbackExpanded,
        scrollbackToggledKeys: [...scrollbackToggledKeys],
        loadedCount,
      })
    }
  })

  // Keep the last *visible commit*, not the closure from the first mount:
  // follow-tail and folding may have changed many times before this hides.
  const lastVisibleCaptureRef = useRef(() => {})
  useLayoutEffect(() => {
    if (visible) lastVisibleCaptureRef.current = capturePanePositionRef.current
  })
  useLayoutEffect(() => {
    if (!visible) return
    return () => lastVisibleCaptureRef.current()
  }, [visible])

  // SCROLLBACK folds with the mouse: a click on a folded tool row or group
  // expands it. Like a link it acts on mouse UP with the pointer unmoved, so a
  // drag is still a text selection. Folding again takes a click on the item's
  // first row only — an expanded diff has its own click targets below it.
  const transcriptPressRef = useRef<{ x: number; y: number } | null>(null)
  const pressTranscript = (event: MouseEvent) => {
    transcriptPressRef.current = event.button === 0 ? { x: event.x, y: event.y } : null
    onTranscriptPress(event)
  }
  const releaseTranscript = (event: MouseEvent) => {
    const press = transcriptPressRef.current
    transcriptPressRef.current = null
    if (onTranscriptRelease(event)) return
    if (!paneScrollbackLike || event.button !== 0 || !press || press.x !== event.x || press.y !== event.y) return
    const sb = scrollRef.current
    if (!sb) return
    let hit: Renderable | undefined
    for (const row of sb.content.getChildren()) {
      const child = readerRowCard(row as Renderable)
      if (child && event.y >= child.y && event.y < child.y + child.height) {
        hit = child
        break
      }
    }
    if (!hit) return
    const cardKey = hit.id.slice('card:'.length)
    const card = allPaneCards.find((entry) => entry.key === cardKey)
    if (card?.asyncQuestions?.length) { onOpenAsyncQuestions(session, card); return }
    if (!card || !(card.autoFold || agentToolCardsFor(card).length > 0)) return
    if (windowOutputRef.current.scrollbackExpandedKeys?.has(cardKey) && event.y !== hit.y) return
    // At the tail the view sticks to the bottom, so the rows a click unfolds
    // would push the clicked row up and away. Let go of the tail first.
    if (followTail) {
      scrollbackSyncedCursorKeyRef.current = cardKey
      setCursorKey(cardKey)
      setFollowTail(false)
    }
    setScrollbackToggledKeys((current) => {
      const next = new Set(current)
      if (!next.delete(cardKey)) next.add(cardKey)
      return next
    })
  }
  const stickyKey = useStickyPromptKey(scrollRef, allPaneCards, visible && stickyHeaders && !lightView)
  const turnFooter = useMemo(
    () => (!running && (transcriptView === 'stream' || paneScrollbackLike) ? streamCompletedTurnHint(allPaneCards) : null),
    [running, transcriptView, paneScrollbackLike, allPaneCards],
  )
  const stickyCard = stickyKey ? allPaneCards.find((card) => card.key === stickyKey) ?? null : null

  // Focus changes intentionally do not touch cursorKey, followTail, or the
  // scrollbox. Each pane owns its viewport, so cycling reader → pane → pane
  // returns to the exact card and offset that pane had before losing focus.

  const scrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }),
    [theme.muted, theme.surface2],
  )

  const accent = transcriptAccent('assistant', session.provider ?? undefined)
  // A frameless window lends its border's two columns and rows to the transcript.
  const frameExtent = frameless ? 0 : 2
  const innerWidth = Math.max(width - 2 - frameExtent, 12)
  const statusRowCount = (liveText || (running && allPaneCards.length > 0)) ? 1 : 0
  // Exact row budget, or the frame shrinks: border (2) + meta row (1) + the
  // body box's own paddingBottom (1) + the optional live row + one action row.
  // The action row is reserved in every pane so focus never changes viewport
  // height or the meaning of its stored scrollTop.
  // The reader's trailing chrome (CHAT's composer bar), in the window showing the selected transcript.
  // Lightweight windows draw no view header: the title already names the session.
  const header = useSyncExternalStore(visible && chromeHost && !lightView ? selectedWindowHeader.subscribe : subscribeNothing, visible && chromeHost && !lightView ? selectedWindowHeader.get : getNothing)
  const footer = useSyncExternalStore(visible && chromeHost ? selectedWindowFooter.subscribe : subscribeNothing, visible && chromeHost ? selectedWindowFooter.get : getNothing)
  const bodyRows = Math.max(calculateSplitPaneBodyRows(height + 2 - frameExtent, statusRowCount) - (header?.rows ?? 0) - (footer?.rows ?? 0), 1)
  const hiddenCount = lightStart
  const windowGaugeRef = useRef<ReaderWindowGauge>({ start: 0, end: 0, total: 0, settled: true })
  // The window holding the selected transcript reports its card window, which
  // is what `tui:inputperf`'s cards column reads.
  useEffect(() => visible && chromeHost ? registerTuiMetricsGauge(() => ({
    readerWindowStart: windowGaugeRef.current.start,
    readerWindowEnd: windowGaugeRef.current.end,
    readerWindowTotal: windowGaugeRef.current.total,
  })) : undefined, [visible, chromeHost])
  const windowOutputRef = useRef<ReaderWindowOutput>({ start: 0, cardDisplayData: [], scrollbackExpandedKeys: null })
  const scrollFixupRef = useRef<ReaderScrollFixup | null>(null)
  const cursorIndex = useMemo(() => cursorKey ? allPaneCards.findIndex(card => card.key === cursorKey) : allPaneCards.length - 1, [allPaneCards, cursorKey])
  useEffect(() => { onCursorChange?.(cursorKey) }, [onCursorChange, cursorKey])
  useEffect(() => { onFollowChange?.(followTail) }, [onFollowChange, followTail])
  const searchMatchIndexes = useMemo(() => {
    if (!searchQuery) return EMPTY_SEARCH_MATCHES
    const matches: number[] = []
    allPaneCards.forEach((card, index) => { if (card.searchHaystackLower.includes(searchQuery)) matches.push(index) })
    return matches
  }, [allPaneCards, searchQuery])
  const activeMatch = activeSearchKey ? searchMatchIndexes.findIndex(index => allPaneCards[index]?.key === activeSearchKey) : -1
  // A scroll is the reading position: at the bottom it follows the tail again,
  // elsewhere it parks the invisible cursor on what is on screen.
  const settleScrollRef = useRef((_sb: ScrollBoxRenderable, _top: number, _limit: number) => {})
  settleScrollRef.current = (sb, scrollTop, limit) => {
    if (scrollTop >= limit && windowGaugeRef.current.end >= allPaneCards.length) {
      setFollowTail(true)
      return
    }
    setFollowTail(false)
    if (!paneScrollbackLike) return
    const parked = scrollbackParkedCursorKey(sb, scrollTop, cursorKey)
    if (parked) {
      scrollbackSyncedCursorKeyRef.current = parked
      setCursorKey(parked)
    }
  }
  // SCROLLBACK wheel: the scrollbox emits no scroll events, so poll for a
  // scroll the keys did not make. While following, only scrollTop going DOWN
  // in value under content that did not shrink is the user — a growing reply
  // sits above the bottom for a frame before sticky scroll catches up.
  useEffect(() => {
    if (!visible || !paneScrollbackLike) return undefined
    let lastTop = -1
    let lastHeight = 0
    const interval = setInterval(() => {
      if (scrollFixupRef.current || restoreHold.current) return
      const sb = scrollRef.current
      if (!sb) return
      const { scrollTop, scrollHeight } = sb
      const moved = followTail ? lastTop >= 0 && scrollTop < lastTop && scrollHeight >= lastHeight : scrollTop !== lastTop
      lastTop = scrollTop
      lastHeight = scrollHeight
      if (moved) settleScrollRef.current(sb, scrollTop, Math.max(scrollHeight - sb.viewport.height, 0))
    }, READER_SCROLL_POLL_MS)
    return () => clearInterval(interval)
  }, [visible, paneScrollbackLike, followTail])
  useReaderWindowSliding({
    store: windowStore, scrollRef, gaugeRef: windowGaugeRef, fixupRef: scrollFixupRef,
    cards: allPaneCards, cursorKey, cursorIndex, followTail, setFollowTail, active: visible, holdRef: restoreHold,
    scrollbackSyncedKeyRef: paneScrollbackLike ? scrollbackSyncedCursorKeyRef : undefined,
  })
  const thinkingFullKeys = useMemo(() => thinkingMode
    ? new Set(allPaneCards.filter(card => card.lines.some(line => line.tone === 'thinking')).map(card => card.key))
    : EMPTY_EXPANDED_KEYS, [allPaneCards, thinkingMode])
  const activatePaneDiffHover = useCallback((anchor: string) => diffControls.activateDiffHover(anchor, { namespace: key, scrollTop: scrollRef.current?.scrollTop ?? null }), [diffControls.activateDiffHover, key])
  const openPaneDiffNote = useCallback((selection: SelectedLineRange, cardKey?: string) => diffControls.openDiffNote(key, selection, cardKey), [diffControls.openDiffNote, key])
  const sendPaneDiffNote = useCallback((...args: Parameters<TranscriptWindowInputs['sendDiffNoteToComposer']>) => diffControls.sendDiffNoteToComposer(key, ...args), [diffControls.sendDiffNoteToComposer, key])
  const windowInputs: TranscriptWindowInputs = {
    viewportRows: bodyRows,
    blockRestore,
    visibleTranscriptCards: allPaneCards, windowStore, followTail,
    isScrollbackView: paneScrollbackLike, scrollbackExpanded, scrollbackToggledKeys,
    resolvedExpandedKeys: expandedKeys, thinkingFullKeys, expandedCardKeys, collapsedCardKeys,
    transcriptView, focused, isPreviewMode: false,
    isChatLikeView: paneStreamLike, isContinuousView: transcriptView === 'transcript' || transcriptView === 'opencode',
    groupedToolView: transcriptView === 'agents' || paneStreamLike, liveCardCount: liveCards.length,
    resumeMarkerIndex: -1, unreadBoundaryIndex: -1, pendingNewCount: 0,
    provider: session.provider ?? 'claude', shouldEnableSyntaxHighlighting,
    searchMatches: searchMatchIndexes, searchMatchIndex: Math.max(activeMatch, 0), bookmarkKeys: bookmarkedKeys,
    agentToolCursorByGroupKey, transcriptCursorKey: cursorKey,
    cursorIndex,
    sessionKey: key, readerWindowGaugeRef: windowGaugeRef, readerWindowOutputRef: windowOutputRef,
    readerScrollFixupRef: scrollFixupRef, transcriptScrollRef: scrollRef,
    theme, densityState, syntaxStyle, rightPaneWidth: width + 2 - frameExtent, onSelectCard: selectPaneCard,
    thinkingMode, diffLayout, imessageStyle, transcriptWidth, onSelectAgentTool,
    ...diffControls, noteNamespace: key,
    activateDiffHover: activatePaneDiffHover, openDiffNote: openPaneDiffNote, sendDiffNoteToComposer: sendPaneDiffNote,
    linkCwd: session.cwd ?? undefined,
  }

  return (
    <box
      width={width}
      height={height}
      border={frameless ? [] : ['top', 'left', 'right', 'bottom']}
      borderStyle="single"
      // Focused frame lights in the provider accent, exactly like the reader
      // and sidebar — one visual language for "this pane has the keyboard".
      borderColor={focused ? theme.cyan : theme.border}
      backgroundColor={theme.surface}
      flexDirection="column"
      // Number the frame whenever more than one is mounted: ⌃B 1/⌃B 2 jump
      // straight to a pane, and nothing else on screen says which is which.
      // The title carries what the pane's own header row used to: which
      // session, and the state worth knowing without focusing it.
      title={frameless ? undefined : fitText(
        joinMeta([
          attentionBadge,
          coordinatorLabel,
          paneCount > 1 ? `${paneNumber} · ${formatSessionTitle(session)}` : formatSessionTitle(session),
          running ? 'running' : null,
          followTail ? null : 'paused',
        ]),
        Math.max(width - 4, 8),
      // fitText pads to width; padding would paint over the border.
      ).trimEnd()}
      titleColor={attentionBadge?.includes('?') ? theme.amber : attentionBadge?.includes('! error') ? theme.red : attentionBadge ? theme.cyan : running ? theme.green : accent}
      ref={paneFrameRef}
      id={selected && visible ? 'transcript-reader' : undefined}
      onMouseDown={(event) => {
        if (event.button === 2) {
          onActivate(paneIndex)
          onContextMenu(session, 'pane', event, paneIndex)
          return
        }
        if (event.button !== 0) return
        onActivate(paneIndex)
        // The title row drags a window; a double-click zooms a tiled frame.
        if (paneFrameRef.current && event.y === paneFrameRef.current.y) {
          // A floating window's title moves it.
          if (paneIndex === FLOATING_PANE_INDEX) { floatGesture.start(event); return }
          if (isDoubleClick(titleClickRef, event)) { onPromotePane(session); return }
          sessionDrag.press(session, paneIndex, event)
        }
      }}
      onMouseDrag={(event) => (paneIndex === FLOATING_PANE_INDEX ? floatGesture.move(event) : sessionDrag.move(event))}
      onMouseUp={(event) => (paneIndex === FLOATING_PANE_INDEX ? floatGesture.end(event) : sessionDrag.release(event))}
    >
      <box position="absolute" top={-1} right={1} height={1} flexDirection="row" zIndex={3} visible={!frameless}>
        <WindowButton id={selected ? 'reader-window-menu' : `split-pane-menu:${paneIndex}`} label=" ≡ " theme={theme} onPress={point => onContextMenu(session, 'pane', point, paneIndex)} />
        <WindowButton id={selected ? 'reader-window-layout' : `split-pane-layout:${paneIndex}`} label=" ⊞ layout " theme={theme} onPress={onOpenLayout} />
        <WindowButton id={selected ? 'reader-window-fullscreen' : `split-pane-promote:${paneIndex}`} label=" ⤢ " theme={theme} onPress={promoteThisPane} />
        <WindowButton id={selected ? 'reader-window-close' : `split-pane-close:${paneIndex}`} label=" × " theme={theme} tone="danger" onPress={closeThisPane} />
      </box>
      {header ? <box flexDirection="column" flexShrink={0}>{header.render(width)}</box> : null}
      <box flexGrow={1} paddingX={1} overflow="hidden">
        {status === 'error' ? (
          <text fg={theme.red} wrapMode="none">{fitText(error ?? 'Failed to load transcript', innerWidth)}</text>
        ) : status === 'loading' && allPaneCards.length === 0 ? (
          <Spinner label={fitText('Loading…', innerWidth)} fg={theme.dim} />
        ) : allPaneCards.length === 0 ? (
          <text fg={theme.dim} wrapMode="none">{fitText('No messages yet', innerWidth)}</text>
        ) : (
          <scrollbox
            ref={scrollRef}
            id={selected && visible ? 'transcript-scroll' : `split-scroll:${paneIndex}`}
            style={{ height: bodyRows }}
            backgroundColor={theme.surface}
            // Sticky only while the pane is still following: once the reader
            // scrolls it up, new cards must not yank the view back down.
            stickyScroll={followTail}
            stickyStart="bottom"
            scrollY
            scrollAcceleration={MESSAGE_SCROLL_ACCEL}
            viewportCulling
            scrollbarOptions={scrollbarOptions}
            onMouseDown={pressTranscript}
            onMouseUp={releaseTranscript}
          >
            <TuiErrorBoundary>
              {hiddenCount > 0 ? (
                <box key="split-earlier-hint" paddingX={1}>
                  <text fg={theme.dim} wrapMode="none">
                    {fitText(`↑ ${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'} — k/g to load`, Math.max(innerWidth - 2, 8))}
                  </text>
                </box>
              ) : null}
              <TranscriptWindowBody inputs={windowInputs} />
              {turnFooter ? <StreamTurnFooter landmark={turnFooter} theme={theme} densityState={densityState} transcriptWidth={transcriptWidth} width={width} /> : null}
            </TuiErrorBoundary>
          </scrollbox>
        )}
        {stickyCard ? <StickyPromptHeader card={stickyCard} theme={theme} accent={accent} width={width} /> : null}
      </box>
      {liveText ? (
        <box paddingX={1} height={1}>
          <text fg={accent} wrapMode="none">{fitText(`● ${liveText.replace(/\s+/g, ' ')}`, innerWidth)}</text>
        </box>
      ) : running && allPaneCards.length > 0 ? (
        <box paddingX={1} height={1}>
          <Spinner label={fitText('working…', Math.max(innerWidth - 2, 8))} fg={theme.dim} />
        </box>
      ) : null}
      {footer ? <box flexDirection="column" flexShrink={0}>{footer.render(width)}</box> : null}
      {/* Key hints sit in the bottom border, as the composer's status does. */}
      <box position="absolute" bottom={-1} left={1} height={1} backgroundColor={theme.surface} visible={!frameless}>
        <text fg={theme.dim} wrapMode="none">
          {` ${(focused
            ? fitText(running ? 'j/k card  e fold  y copy  b mark  c send  ⌃C stop  ↵ zoom  esc focus' : 'j/k card  e fold  y copy  b mark  Q reply  c send  ↵ zoom  esc focus', innerWidth - 2)
            // An unfocused pane says how to reach it.
            : fitText(`⌃B ${paneNumber} focus  ·  ⌃B n next session`, innerWidth - 2)).trimEnd()} `}
        </text>
      </box>
    </box>
  )
}

export const SplitTranscriptPane = React.memo(SplitTranscriptPaneInner)
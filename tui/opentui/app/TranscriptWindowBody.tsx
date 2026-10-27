/** @jsxImportSource @opentui/react */
import { readReaderLayout } from '../readerLayout'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { logCardRecompute } from '../metricsLogger'
import { LayoutEvents, type Renderable, type ScrollBoxRenderable } from '@opentui/core'
import { pruneUnmountedCardData } from '../readerCardCache'
import { RowHeightIndex } from '../rowHeightIndex'
import { deriveRowReaderWindow, stepReaderWindow, type ReaderWindow, type ReaderWindowStore } from '../readerWindowStore'
import { useRenderer } from '@opentui/react'
import { type TuiTranscriptCard } from '../../format'
import { type TuiTranscriptView } from '../../theme'
import { useWindowVisible } from '../windowActivity'
import { TranscriptViewportContext, TranscriptBlockRestoreContext, type TranscriptBlockRestore } from '../VirtualTranscriptRows'
import { useStableEvent } from '../useStableEvent'
import { type ProviderSelection } from '../../../lib/types'
import { fitText, joinMeta } from '../textLayout'
import { type CardLandmark, type CardDisplayData, type StableCardData } from './types'
import { EMPTY_EXPANDED_KEYS } from './timing'
import { READER_WINDOW_MARGIN, READER_CARD_WINDOW, READER_WINDOW_SLIDE, READER_SLIDE_REQUEST_TTL_MS, READER_SLIDE_AHEAD_VIEWPORTS, READER_EDGE_ROWS, READER_OPEN_WINDOW, READER_GROW_INTERVAL_MS, READER_EXPAND_FIRST, READER_EXPAND_STEP } from './layoutConstants'
import { clamp } from './util'
import { CARD_PROFILE } from './perf'
import { sessionKey } from './sessionList'
import { EMPTY_LANDMARKS, transcriptAccent, continuousTurnFooter } from './transcriptStyle'
import { findReaderCard, readerLayoutOffset, readerRowKey } from './readerRows'
import { cardDiffView, agentToolCardsFor, countCodeBlockLines, usesAgentCardPresentation, renderedBodyLines, computeAllLandmarks } from './transcriptRows'
import { type TranscriptCardSelectionVariants, type TranscriptCardVariantCacheEntry, cachedTranscriptCardSelectionVariants, selectTranscriptCardVariants } from './TranscriptCard'

// The mounted slice of the transcript: the window derivation and the whole
// per-card pipeline (stableCardData → allLandmarks → cardDisplayData → card
// elements). It lives outside the root so that moving the window — a slide, a
// recenter — re-renders this component alone; the window start comes from
// readerWindowStore for the selected window; other panes supply their range.
// Everything else arrives as `inputs`. It is always mounted
// inside the transcript scrollbox (it draws the scrubbing placeholder itself),
// so its per-card caches survive a scrub exactly as they did in the root.
export type ReaderScrollFixup =
  | { kind: 'slide'; at: number }
  | { kind: 'anchor'; el: Renderable; prevOffset: number }
  | { kind: 'cursor'; cardKey: string; committed: boolean }
// The window the reader is heading for (the mounted one trails it by a few
// commits after a jump), and whether it has arrived.
export type ReaderWindowGauge = { start: number; end: number; total: number; settled: boolean; maxStart?: number; cursorStart?: (index: number) => number }
export type ReaderWindowOutput = {
  // First mounted card's index: cardDisplayData is relative to it.
  start: number
  cardDisplayData: CardDisplayData[]
  scrollbackExpandedKeys: ReadonlySet<string> | null
}
export type TranscriptCardVariantInputs = Parameters<typeof cachedTranscriptCardSelectionVariants>[1]
export type TranscriptWindowInputs = Pick<TranscriptCardVariantInputs,
  | 'theme' | 'densityState' | 'syntaxStyle' | 'rightPaneWidth' | 'onSelectCard' | 'thinkingMode' | 'diffLayout'
  | 'imessageStyle' | 'transcriptWidth' | 'onSelectAgentTool' | 'noteNamespace' | 'diffNotes' | 'diffDraft'
  | 'hoveredDiffAnchor' | 'activateDiffHover' | 'openDiffNote' | 'sendDiffNoteToComposer' | 'diffPlainCardKeys'
  | 'diffHiddenLineNumberCardKeys' | 'diffHiddenHunkHeaderCardKeys' | 'diffRowCursorByCardKey'
  | 'diffSelectionAnchorByCardKey' | 'setDiffRowCursor' | 'setDiffSelectionAnchor' | 'linkCwd'
> & {
  /** A pane supplies its own viewport range; it never subscribes to another window's scroll position. */
  /** The window's own card-window store. */
  windowStore: ReaderWindowStore
  viewportRows: number
  blockRestore: React.RefObject<TranscriptBlockRestore | null>
  visibleTranscriptCards: TuiTranscriptCard[]
  followTail: boolean
  isScrollbackView: boolean
  scrollbackExpanded: boolean
  scrollbackToggledKeys: ReadonlySet<string>
  resolvedExpandedKeys: ReadonlySet<string>
  thinkingFullKeys: ReadonlySet<string>
  expandedCardKeys: ReadonlySet<string>
  collapsedCardKeys: ReadonlySet<string>
  transcriptView: TuiTranscriptView
  focused: boolean
  isPreviewMode: boolean
  isChatLikeView: boolean
  isContinuousView: boolean
  groupedToolView: boolean
  liveCardCount: number
  resumeMarkerIndex: number
  unreadBoundaryIndex: number
  pendingNewCount: number
  provider: ProviderSelection
  shouldEnableSyntaxHighlighting: boolean
  searchMatches: number[]
  searchMatchIndex: number
  bookmarkKeys: ReadonlySet<string>
  agentToolCursorByGroupKey: Record<string, string>
  transcriptCursorKey: string | null
  cursorIndex: number
  sessionKey: string | null
  readerWindowGaugeRef: React.RefObject<ReaderWindowGauge>
  readerWindowOutputRef: React.RefObject<ReaderWindowOutput>
  readerScrollFixupRef: React.RefObject<ReaderScrollFixup | null>
  transcriptScrollRef: React.RefObject<ScrollBoxRenderable | null>
}

export type ReaderWindowSlidingOptions = {
  store: ReaderWindowStore
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  gaugeRef: React.RefObject<ReaderWindowGauge>
  fixupRef: React.MutableRefObject<ReaderScrollFixup | null>
  cards: TuiTranscriptCard[]
  cursorKey: string | null
  cursorIndex: number
  followTail: boolean
  setFollowTail: (follow: boolean) => void
  /** The window is being read: it slides under scrolling and recenters on its cursor. */
  active: boolean
  /** Set while a saved position is being restored; nothing moves the window until it is. */
  holdRef?: React.RefObject<unknown>
  /** SCROLLBACK: a cursor the scroll poll parked must not recenter the window it was parked in. */
  scrollbackSyncedKeyRef?: React.RefObject<string | null>
  onScrolled?: (scrollTop: number) => void
  /** The cursor the window last recentered for. A restore sets it, so the restored cursor is not a move. */
  recenterKeyRef?: React.MutableRefObject<string | null>
}

// The mounted card window of one transcript window: it follows the tail,
// recenters on a cursor that leaves its middle, slides under scrolling, and
// keeps the text still across each of those (the scroll fixups). Every
// transcript window runs its own, against its own store.
export function useReaderWindowSliding({
  store, scrollRef, gaugeRef, fixupRef, cards, cursorKey, cursorIndex, followTail, setFollowTail,
  active, holdRef, scrollbackSyncedKeyRef, onScrolled, recenterKeyRef,
}: ReaderWindowSlidingOptions): void {
  const renderer = useRenderer()
  const totalCards = cards.length
  // Re-engaging the tail lets the derived tail window take over again.
  // Silent: the tail-pinned derivation ignores the stored start anyway.
  useEffect(() => {
    if (followTail) store.prime(null)
  }, [followTail, store])

  // Keyboard recenter: when the cursor (absolute index) leaves the comfortable
  // middle of the mounted window — within READER_WINDOW_MARGIN of an edge that
  // has more cards beyond it, or outside the window entirely (search jump,
  // bookmark jump, g) — recenter the window on the cursor. The fixup scrolls
  // the cursor card into view once the new window has mounted and laid out.
  // Gated on the cursor actually MOVING: wheel-scrolling slides the window
  // away from a stationary cursor, and recentering on it then would yank the
  // window straight back — a slide/recenter livelock against the scroll poll.
  const ownRecenterKeyRef = useRef<string | null>(null)
  const recenterCursorKeyRef = recenterKeyRef ?? ownRecenterKeyRef
  useEffect(() => {
    if (holdRef?.current) return
    const cursorMoved = cursorKey !== recenterCursorKeyRef.current
    recenterCursorKeyRef.current = cursorKey
    if (!cursorMoved) return
    // The scroll poll slides the window under a scrolled SCROLLBACK;
    // recentering on the cursor it dragged along would yank the text.
    if (scrollbackSyncedKeyRef && cursorKey === scrollbackSyncedKeyRef.current) return
    if (!active || followTail) return
    if (cursorIndex < 0) return
    const { start, end } = gaugeRef.current
    if (end - start >= totalCards) return
    const nearStart = start > 0 && cursorIndex < start + READER_WINDOW_MARGIN
    const nearEnd = end < totalCards && cursorIndex >= end - READER_WINDOW_MARGIN
    if (!nearStart && !nearEnd) return
    const nextStart = gaugeRef.current.cursorStart?.(cursorIndex)
      ?? clamp(cursorIndex - Math.floor(READER_CARD_WINDOW / 2), 0, Math.max(0, totalCards - READER_CARD_WINDOW))
    if (nextStart === start) return
    const cursorCard = cards[cursorIndex]
    if (cursorCard) fixupRef.current = { kind: 'cursor', cardKey: cursorCard.key, committed: false }
    store.set(nextStart)
  }, [cursorIndex, cursorKey, active, followTail, totalCards, cards, store])

  // Window slide. A frame callback reads scrollTop before each painted frame
  // (two property reads; no frame, no read) and requests a slide once the
  // viewport is within READER_SLIDE_AHEAD_VIEWPORTS of the mounted content's
  // edge in the direction the user is scrolling. Direction matters: a slide
  // moves scrollTop by the rows it added or removed above, and without it a
  // tall card could land the viewport inside the opposite threshold and slide
  // straight back.
  const seenRef = useRef<{ top: number; direction: -1 | 0 | 1 }>({ top: -1, direction: 0 })
  const requestSlide = useStableEvent((direction: -1 | 1) => {
    const start = gaugeRef.current.start
    const nextStart = direction < 0
      ? Math.max(0, start - READER_WINDOW_SLIDE)
      : Math.min(start + READER_WINDOW_SLIDE, gaugeRef.current.maxStart ?? Math.max(0, totalCards - READER_CARD_WINDOW))
    if (nextStart === start) return
    fixupRef.current = { kind: 'slide', at: performance.now() }
    // Out of the frame that noticed the scroll: a store update renders
    // synchronously, and inside a frame callback that render would be part of
    // the frame the user is waiting on.
    setTimeout(() => {
      store.set(nextStart)
      // Scrolling far up off the tail means reading history; the tail-pinned
      // derivation (and its scroll-to-bottom effects) must let go.
      if (direction < 0 && followTail) setFollowTail(false)
    }, 0)
  })
  const slides = totalCards > 0
  useEffect(() => {
    if (!active || !slides) return undefined
    const seen = seenRef.current
    seen.top = -1
    seen.direction = 0
    const onFrame = async () => {
      const sb = scrollRef.current
      if (!sb) return
      const scrollTop = sb.scrollTop
      if (seen.top >= 0 && scrollTop !== seen.top) seen.direction = scrollTop > seen.top ? 1 : -1
      seen.top = scrollTop
      if (holdRef?.current) return
      const pending = fixupRef.current
      if (pending) {
        if (pending.kind !== 'slide' || performance.now() - pending.at < READER_SLIDE_REQUEST_TTL_MS) return
        fixupRef.current = null
      }
      // Content not laid out yet (fresh mount) or shorter than the viewport —
      // scrollTop reads 0 and would spuriously trigger a top-edge slide.
      const viewportRows = sb.viewport.height
      const maxScroll = sb.scrollHeight - viewportRows
      if (maxScroll <= 0) return
      // Never more than a third of the mounted rows, so the two thresholds
      // cannot overlap however short the window's content is.
      const ahead = Math.min(READER_SLIDE_AHEAD_VIEWPORTS * viewportRows, Math.floor(maxScroll / 3))
      const { start, end, total, settled } = gaugeRef.current
      // Still growing toward the last target: the rows are already on their way.
      if (!settled) return
      if (start > 0 && (scrollTop <= READER_EDGE_ROWS || (seen.direction < 0 && scrollTop <= ahead))) {
        requestSlide(-1)
      } else if (end < total
        && (maxScroll - scrollTop <= READER_EDGE_ROWS || (seen.direction > 0 && maxScroll - scrollTop <= ahead))) {
        requestSlide(1)
      }
    }
    renderer.setFrameCallback(onFrame)
    return () => renderer.removeFrameCallback(onFrame)
  }, [active, slides, renderer])

  // Scroll fixup, in two halves, so the corrected scrollTop reaches the screen
  // in the SAME frame as the new window's content. A frame painted between the
  // two showed the wrong rows — the visible jump of the old timer-based fixup.
  // 1. At the commit that changed the window, TranscriptWindowBody picks an
  //    anchor row mounted in both windows and records where it sat.
  // 2. In the next frame's layout pass. The root emits `layout-changed` after
  //    Yoga has computed the new tree and before any renderable is positioned
  //    or drawn, and a scrollbox applies scrollTop to its content's screen
  //    position immediately — so a scrollTop set here is the one this frame
  //    paints. The anchor moved by exactly the rows added or removed above it;
  //    scrollTop moves by the same, applied to wherever the user has scrolled
  //    to since the commit.
  const onScrolledEvent = useStableEvent((top: number) => { onScrolled?.(top) })
  useEffect(() => {
    const root = renderer.root
    const onLayout = () => {
      const fixup = fixupRef.current
      if (!fixup || fixup.kind === 'slide' || (fixup.kind === 'cursor' && !fixup.committed)) return
      fixupRef.current = null
      const sb = scrollRef.current
      if (!sb) return
      const content = sb.content
      const contentLayout = readReaderLayout(content)
      if (!contentLayout) return
      const scrollTop = sb.scrollTop
      let nextTop = scrollTop
      if (fixup.kind === 'anchor') {
        if (fixup.el.isDestroyed) return // session switched mid-slide — drop
        const offset = readerLayoutOffset(fixup.el, content)
        if (offset === null) return
        nextTop = scrollTop + offset - fixup.prevOffset
      } else {
        const el = findReaderCard(content, `card:${fixup.cardKey}`)
        const offset = el ? readerLayoutOffset(el, content) : null
        if (!el || offset === null) return
        // scrollChildIntoView's rule, against the layout Yoga just produced.
        const layout = readReaderLayout(el)
        if (!layout) return
        const height = layout.height
        const viewportRows = sb.viewport.height
        const startsAbove = offset < scrollTop
        const endsBelow = offset + height > scrollTop + viewportRows
        if (startsAbove !== endsBelow) {
          nextTop = startsAbove === height < viewportRows ? offset : offset + height - viewportRows
        }
      }
      // The scrollbar clamps to the content height it last saw, which is the
      // old window's until the content box is positioned later this frame.
      sb.verticalScrollBar.scrollSize = Math.max(contentLayout.height, 1)
      sb.scrollTo(Math.max(0, nextTop))
      seenRef.current.top = sb.scrollTop
      onScrolledEvent(sb.scrollTop)
    }
    root.on(LayoutEvents.LAYOUT_CHANGED, onLayout)
    return () => {
      root.off(LayoutEvents.LAYOUT_CHANGED, onLayout)
    }
  }, [renderer])
}

export function TranscriptWindowBody({ inputs }: { inputs: TranscriptWindowInputs }) {
  const renderer = useRenderer()
  const windowVisible = useWindowVisible()
  const {
    visibleTranscriptCards, followTail, isScrollbackView, scrollbackExpanded, scrollbackToggledKeys,
    resolvedExpandedKeys, thinkingFullKeys, expandedCardKeys, collapsedCardKeys, transcriptView, focused,
    isPreviewMode, isChatLikeView, isContinuousView, groupedToolView, liveCardCount, resumeMarkerIndex,
    unreadBoundaryIndex, pendingNewCount, provider, shouldEnableSyntaxHighlighting, searchMatches, searchMatchIndex,
    bookmarkKeys, agentToolCursorByGroupKey, transcriptCursorKey, cursorIndex, sessionKey, readerWindowGaugeRef,
    readerWindowOutputRef,
    readerScrollFixupRef, transcriptScrollRef, theme, densityState, syntaxStyle, rightPaneWidth,
    onSelectCard: selectTranscriptCard, thinkingMode, diffLayout, imessageStyle, transcriptWidth,
    onSelectAgentTool: selectAgentTool, noteNamespace: transcriptNoteNamespace, diffNotes: transcriptDiffNotes,
    diffDraft: transcriptDiffDraft, hoveredDiffAnchor: hoveredTranscriptDiffAnchor,
    activateDiffHover: activateTranscriptDiffHover, openDiffNote: openTranscriptDiffNote,
    sendDiffNoteToComposer: sendTranscriptDiffNoteToComposer, diffPlainCardKeys: transcriptDiffPlainCardKeys,
    diffHiddenLineNumberCardKeys: transcriptDiffHiddenLineNumberCardKeys,
    diffHiddenHunkHeaderCardKeys: transcriptDiffHiddenHunkHeaderCardKeys,
    diffRowCursorByCardKey: transcriptDiffRowCursorByCardKey,
    diffSelectionAnchorByCardKey: transcriptDiffSelectionAnchorByCardKey,
    setDiffRowCursor: setTranscriptDiffRowCursorForCard, setDiffSelectionAnchor: setTranscriptDiffSelectionAnchorForCard,
    linkCwd: transcriptLinkCwd,
  } = inputs
  // Mounted-card window: a READER_CARD_WINDOW slice that follows the tail
  // (followTail) or the detached readerWindowStart anchor (slides/recenters).
  // This window bounds the ENTIRE per-card pipeline below (stableCardData →
  // allLandmarks → cardDisplayData → transcriptChildren), not just element
  // construction — and OpenTUI's scrollbox lays out every mounted card on
  // every commit (viewportCulling only skips paint), so it also bounds the
  // per-commit Yoga layout cost while reading.
  //
  // Deliberately NOT a function of which pane has focus. Browsing used to cap
  // the mount to a much smaller preview, which meant every Tab between the
  // sidebar and the reader mounted or unmounted the difference and re-laid it
  // out: 91% of the commits during focus toggling missed the 60fps budget,
  // worst frame 46ms. Holding the window fixed takes that to zero over budget
  // and a 16ms worst frame, and costs nothing on open — browse-mode cards all
  // render collapsed (see expandedKeysForRender), so what a mounted card costs
  // there is bounded by density, not by how many are mounted..
  const totalTranscriptCards = visibleTranscriptCards.length
  const { windowStore } = inputs
  const readerWindowStart = useSyncExternalStore(windowStore.subscribe, windowStore.get, windowStore.get)
  // Six viewport heights give wheel flings room to advance before a slide.
  // Source estimates are cheap; native layout refines only the mounted rows.
  // A card-count cap still protects pathological runs of one-line cards.
  const rowBudget = Math.max(120, inputs.viewportRows * 6)
  const rowIndex = useMemo(() => new RowHeightIndex(visibleTranscriptCards.map(card => {
    const expanded = transcriptView === 'full' || resolvedExpandedKeys.has(card.key)
      || isScrollbackView && scrollbackExpanded
      || isChatLikeView && (card.category === 'conversation' || card.category === 'insight')
    const lines = expanded ? card.expandedLines : card.lines
    const prose = expanded && card.markdownContent ? Math.ceil(card.markdownContent.length / Math.max(rightPaneWidth - 8, 20)) : 0
    return 3 + densityState.cardGap + Math.max(lines.length, prose)
  })), [visibleTranscriptCards, transcriptView, resolvedExpandedKeys, isScrollbackView, scrollbackExpanded, isChatLikeView, rightPaneWidth, densityState.cardGap])
  const targetWindow = deriveRowReaderWindow(rowIndex, READER_CARD_WINDOW, rowBudget, followTail, readerWindowStart)
  useEffect(() => {
    if (!windowVisible) return
    const measure = () => {
      const sb = transcriptScrollRef.current
      if (!sb) return
      const rows = (sb.content.getChildren() as Renderable[]).filter(row => readerRowKey(row))
      for (let relative = 0; relative < rows.length; relative++) {
        const row = rows[relative]!
        const index = readerWindowOutputRef.current.start + relative
        if (index >= rowIndex.length) break
        const next = rows[relative + 1]
        rowIndex.update(index, next ? next.y - row.y : row.height + densityState.cardGap)
      }
    }
    renderer.root.on(LayoutEvents.LAYOUT_CHANGED, measure)
    return () => { renderer.root.off(LayoutEvents.LAYOUT_CHANGED, measure) }
  }, [renderer, rowIndex, transcriptScrollRef, densityState.cardGap, windowVisible])
  // What the last commit mounted, and for which session. Read during render to
  // decide how far this commit may move: it only changes at a commit, so a
  // render repeated without one derives the same window.
  const committedWindowRef = useRef<{ sessionKey: string | null; window: ReaderWindow } | null>(null)
  const committedWindow = committedWindowRef.current
  const windowFocus = followTail ? totalTranscriptCards - 1 : cursorIndex >= 0 ? cursorIndex : targetWindow.start + (READER_CARD_WINDOW >> 1)
  // Another session's cards (a tab switch, an open) are mounted from a seed of
  // READER_OPEN_WINDOW around the focus and grown to the full window by the
  // steps below. Taking all READER_CARD_WINDOW in one commit made that commit
  // the switch's cost: tab-switch rendered 34.6ms with 240 cards, 18.1ms with
  // 60, so the first paint now waits on the cards it shows rather than on the
  // whole window; the rest arrives a step at a time, anchored like a slide.
  const sameSessionWindow = committedWindow && committedWindow.sessionKey === sessionKey ? committedWindow.window : null
  const { start: transcriptRenderStart, end: transcriptRenderEnd } = stepReaderWindow(
    sameSessionWindow ?? { start: windowFocus, end: windowFocus },
    targetWindow,
    windowFocus,
    sameSessionWindow ? READER_WINDOW_SLIDE : READER_OPEN_WINDOW,
  )
  const windowSettled = transcriptRenderStart === targetWindow.start && transcriptRenderEnd === targetWindow.end
  // Growing toward the target: one step per frame interval, and never while a
  // scroll fixup is still waiting on its layout pass.
  const [, growWindow] = useState(0)
  useEffect(() => {
    if (!windowVisible || windowSettled) return undefined
    let timer: ReturnType<typeof setTimeout>
    const grow = () => {
      const fixup = readerScrollFixupRef.current
      if (fixup && fixup.kind !== 'slide') {
        timer = setTimeout(grow, READER_GROW_INTERVAL_MS)
        return
      }
      growWindow((step) => step + 1)
    }
    timer = setTimeout(grow, READER_GROW_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [windowVisible, windowSettled, transcriptRenderStart, transcriptRenderEnd])
  const renderedTranscriptCards = useMemo(
    () => transcriptRenderStart === 0 && transcriptRenderEnd === visibleTranscriptCards.length
      ? visibleTranscriptCards
      : visibleTranscriptCards.slice(transcriptRenderStart, transcriptRenderEnd),
    [transcriptRenderStart, transcriptRenderEnd, visibleTranscriptCards],
  )
  useLayoutEffect(() => {
    readerWindowGaugeRef.current = {
      start: targetWindow.start,
      end: targetWindow.end,
      total: totalTranscriptCards,
      settled: windowSettled,
      maxStart: targetWindow.maxStart,
      cursorStart: index => Math.min(targetWindow.maxStart, rowIndex.at(Math.max(0, rowIndex.offset(index) - rowBudget / 2))),
    }
  }, [totalTranscriptCards, targetWindow.start, targetWindow.end, targetWindow.maxStart, windowSettled, rowIndex, rowBudget])
  // Browse-mode preview renders every card COLLAPSED. Text cards are expanded
  // by default in conversation view, and an expanded card mounts its entire
  // body — for prompt-heavy sessions that means feeding 100KB+ of markdown to
  // OpenTUI's <markdown> renderable, whose marked lexer alone cost seconds of
  // main-thread time per scrub settle (CPU-profiled: ~25% in marked block
  // regexes). Collapsed bodies are truncated to densityState.bodyLines lines,
  // so a preview mount is bounded no matter what the cards contain. Expansion
  // state applies only once the reader pane is focused.
  // Once a preview has been promoted into a tab, keep its expansion geometry
  // stable while focus moves between the sidebar and reader. Collapsing every
  // conversation card on each focus change invalidated native text buffers and
  // Yoga layout for the whole mounted window. Non-tab sidebar previews remain
  // collapsed, preserving the bounded-cost session-scrubbing path.
  // These three sets cover the whole transcript, not the mounted slice. Each is
  // a card prop or a dep of the per-card pipeline, so a set rebuilt per window
  // slide re-rendered every mounted card on every slide: with 8-card slides a
  // sustained SCROLLBACK wheel was 192 commits over budget, 23-30ms of render
  // each, to mount 8 cards. Built from every card they change only when the
  // transcript or the expansion state does.
  const allVisibleCardKeys = useMemo(
    () => transcriptView === 'full' ? new Set(visibleTranscriptCards.map((card) => card.key)) : EMPTY_EXPANDED_KEYS,
    [transcriptView, visibleTranscriptCards],
  )
  // SCROLLBACK has no cursor to fold a card with, so a card is expanded when
  // expand-all or its ordinary default says so, unless a click flipped it.
  const scrollbackExpandedKeys = useMemo(() => {
    if (!isScrollbackView) return null
    const keys = new Set<string>()
    for (const card of visibleTranscriptCards) {
      const base = scrollbackExpanded || resolvedExpandedKeys.has(card.key)
      if (base !== scrollbackToggledKeys.has(card.key)) keys.add(card.key)
    }
    return keys
  }, [isScrollbackView, scrollbackExpanded, scrollbackToggledKeys, resolvedExpandedKeys, visibleTranscriptCards])
  const fullExpandedKeys = transcriptView === 'full'
    ? allVisibleCardKeys
    : focused
      || !isPreviewMode
      || transcriptView === 'agents'
      ? scrollbackExpandedKeys ?? resolvedExpandedKeys
      : EMPTY_EXPANDED_KEYS
  // Leaving the collapsed preview (the reader's first focus) expands every card
  // with a default expansion at once: ~130 bodies rebuilt in one ~40ms commit.
  // At the tail only the last cards are on screen, so they expand first and the
  // rest READER_EXPAND_STEP at a time over the following frames; sticky scroll
  // holds the bottom while content above grows.
  // Anywhere else the viewport is anchored to nothing, so it all lands at once.
  const previewCollapsedRef = useRef(true)
  const [expansionStage, setExpansionStage] = useState<{ keys: ReadonlySet<string>; cards: number } | null>(null)
  // `followTail` alone is not "at the bottom": the preview scrolls under the
  // wheel without clearing it, and staging there grew cards above a viewport
  // that sticky scroll was not holding — the view drifted down for a few frames.
  const leavingPreview = fullExpandedKeys !== EMPTY_EXPANDED_KEYS && previewCollapsedRef.current && expansionStage?.keys !== fullExpandedKeys
  const viewportAtBottom = (() => {
    const sb = transcriptScrollRef.current
    return !sb || sb.scrollTop >= sb.scrollHeight - sb.viewport.height - 1
  })()
  const stageExpansion = fullExpandedKeys !== EMPTY_EXPANDED_KEYS && followTail
    && (!leavingPreview || viewportAtBottom)
    && renderedTranscriptCards.length > READER_EXPAND_FIRST
    && (expansionStage?.keys === fullExpandedKeys
      ? expansionStage.cards < renderedTranscriptCards.length
      : previewCollapsedRef.current)
  const stagedCards = expansionStage?.keys === fullExpandedKeys ? expansionStage.cards : READER_EXPAND_FIRST
  const stagedExpansion = useMemo(() => {
    if (!stageExpansion) return null
    const keys = new Set<string>()
    for (const card of renderedTranscriptCards.slice(-stagedCards)) if (fullExpandedKeys.has(card.key)) keys.add(card.key)
    return keys
  }, [stageExpansion, stagedCards, fullExpandedKeys, renderedTranscriptCards])
  useEffect(() => {
    previewCollapsedRef.current = fullExpandedKeys === EMPTY_EXPANDED_KEYS
    if (!windowVisible || !stageExpansion) return undefined
    const timer = setTimeout(() => setExpansionStage({ keys: fullExpandedKeys, cards: stagedCards + READER_EXPAND_STEP }), READER_GROW_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [windowVisible, stageExpansion, stagedCards, fullExpandedKeys])
  const expandedKeysForRender = stagedExpansion ?? fullExpandedKeys
  // A tool group expands to its tools, each folded by its own key — which
  // nothing in SCROLLBACK can press. An expanded group shows its tools' output.
  const scrollbackExpandedToolKeys = useMemo(() => {
    if (!scrollbackExpandedKeys) return null
    const keys = new Set<string>()
    for (const card of visibleTranscriptCards) {
      if (!scrollbackExpandedKeys.has(card.key)) continue
      for (const toolCard of agentToolCardsFor(card)) keys.add(toolCard.key)
    }
    return keys
  }, [scrollbackExpandedKeys, visibleTranscriptCards])
  // Stable per-card data: body lines, diffs, code blocks. Cached by card reference so
  // when only one card's expansion toggles (transcriptCards ref unchanged), the other
  // cards reuse their prior StableCardData object — TranscriptCard memo then bails out.
  const stableCardCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    isExpanded: boolean
    bodyLineLimit: number
    thinkingFull: boolean
    agentsMode: boolean
    fullText: boolean
    value: StableCardData
  }>())
  const stableCardData = useMemo((): StableCardData[] => {
    const cache = stableCardCacheRef.current
    const profileStart = CARD_PROFILE ? performance.now() : 0
    let recomputed = 0
    const result = renderedTranscriptCards.map((card) => {
      const isExpanded = expandedKeysForRender.has(card.key)
      const thinkingFull = thinkingFullKeys.has(card.key)
      const agentsModeForCard = usesAgentCardPresentation(card, transcriptView)
      // Stream is a chronological transcript, not a collapsed card preview:
      // feed prose its untruncated formatter lines and let the text renderer
      // wrap them to the active transcript width. Technical cards stay bounded.
      const fullTextForCard = isChatLikeView
        && (card.category === 'conversation' || card.category === 'insight')
      const prev = cache.get(card)
      if (
        prev
        && prev.isExpanded === isExpanded
        && prev.bodyLineLimit === densityState.bodyLines
        && prev.thinkingFull === thinkingFull
        && prev.agentsMode === agentsModeForCard
        && prev.fullText === fullTextForCard
      ) {
        return prev.value
      }
      recomputed += 1
      const bodyLines = renderedBodyLines(
        card,
        isExpanded,
        densityState.bodyLines,
        thinkingFull,
        agentsModeForCard,
        fullTextForCard,
      )
      const diffView = cardDiffView(card, isExpanded)
      const codeBlockLineCounts = (isExpanded && card.codeBlocks)
        ? card.codeBlocks.map((cb) => countCodeBlockLines(cb.content))
        : []
      const value: StableCardData = { bodyLines, diffView, codeBlockLineCounts }
      cache.set(card, {
        isExpanded,
        bodyLineLimit: densityState.bodyLines,
        thinkingFull,
        agentsMode: agentsModeForCard,
        fullText: fullTextForCard,
        value,
      })
      return value
    })
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'stableCardData',
        totalCards: renderedTranscriptCards.length,
        recomputed,
        liveCards: liveCardCount,
        durationMs: performance.now() - profileStart,
      })
    }
    return result
  }, [renderedTranscriptCards, expandedKeysForRender, densityState.bodyLines, thinkingFullKeys, transcriptView])

  // Landmark arrays are reused per CARD, not per window index. Keyed by index,
  // every slide handed each card its neighbour's previous array, so every card
  // with a landmark got a fresh one — and a fresh display object, and a
  // re-render — on a commit that had only moved the window.
  const landmarksByCardRef = useRef(new WeakMap<TuiTranscriptCard, CardLandmark[]>())
  const allLandmarks = useMemo(() => {
    const byCard = landmarksByCardRef.current
    // Marker indices are absolute; shift them into window space. A marker that
    // falls before the mounted window goes negative and simply never matches.
    const next = computeAllLandmarks(
      renderedTranscriptCards,
      resumeMarkerIndex - transcriptRenderStart,
      unreadBoundaryIndex - transcriptRenderStart,
      pendingNewCount,
      renderedTranscriptCards.map((card) => byCard.get(card) ?? EMPTY_LANDMARKS),
      isChatLikeView,
      isScrollbackView,
    )
    renderedTranscriptCards.forEach((card, index) => byCard.set(card, next[index]))
    return next
  }, [renderedTranscriptCards, transcriptRenderStart, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount, transcriptView])
  const cardDisplayCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    inputs: {
      isExpanded: boolean
      isLatest: boolean
      isAutoFoldedTechnical: boolean
      landmarks: CardLandmark[]
      stable: StableCardData
      providerKey: ProviderSelection
      syntaxEnabled: boolean
    }
    value: CardDisplayData
  }>())

  const cardDisplayData = useMemo((): CardDisplayData[] => {
    const cache = cardDisplayCacheRef.current
    const profileStart = CARD_PROFILE ? performance.now() : 0
    let recomputed = 0
    const result = renderedTranscriptCards.map((card, index) => {
      const isExpanded = expandedKeysForRender.has(card.key)
      // Latest = last card of the FULL transcript; a detached reader window
      // may end before it.
      const isLatest = transcriptRenderStart + index === totalTranscriptCards - 1
      const isAutoFoldedTechnical = (transcriptView === 'conversation' || transcriptView === 'agents') && card.autoFold && !isExpanded
      const landmarks = allLandmarks[index] ?? EMPTY_LANDMARKS
      const stable = stableCardData[index] ?? {
        bodyLines: [],
        diffView: null,
        codeBlockLineCounts: [],
      }
      const providerKey = card.provider ?? provider

      const prev = cache.get(card)
      if (
        prev
        && prev.inputs.isExpanded === isExpanded
        && prev.inputs.isLatest === isLatest
        && prev.inputs.isAutoFoldedTechnical === isAutoFoldedTechnical
        && prev.inputs.landmarks === landmarks
        && prev.inputs.stable === stable
        && prev.inputs.providerKey === providerKey
        && prev.inputs.syntaxEnabled === shouldEnableSyntaxHighlighting
      ) {
        return prev.value
      }
      recomputed += 1

      const headerMeta = joinMeta([
        card.timestamp ?? null,
        isLatest ? 'latest' : null,
        isAutoFoldedTechnical ? 'folded' : null,
        `e ${isExpanded ? 'collapse' : 'expand'}`,
      ])
      const accent = transcriptAccent(card.role, providerKey)
      const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
      const isInsight = card.category === 'insight'
      const isTechnical = card.category === 'technical'
      const isDiff = card.category === 'diff'
      const isSystem = card.category === 'system'
      // BMP-safe category glyphs (all < U+FFFF, text presentation, no variation
      // selectors). The prior set used an astral wrench (U+1F527) and pencil/gear
      // with U+FE0F variation selectors; those rendered into every card header and
      // fed the native text-width/layout pass — exactly the documented Windows
      // render hazard and a candidate trigger for the opentui.dll layout-recursion
      // segfault.
      const categoryEmoji = isInsight ? '✦ ' : isTechnical ? '⚒ ' : isDiff ? '✎ ' : isSystem ? '⚙ ' : ''
      const markdownFallbackLines = (isExpanded && card.markdownContent && !card.hasMermaidDiagrams && !shouldEnableSyntaxHighlighting)
        ? card.markdownContent.split('\n')
        : null
      const value: CardDisplayData = {
        landmarks,
        bodyLines: stable.bodyLines,
        diffView: stable.diffView,
        codeBlockLineCounts: stable.codeBlockLineCounts,
        headerMeta,
        accent,
        isThinkingCard,
        categoryEmoji,
        isInsight,
        markdownFallbackLines,
      }
      cache.set(card, {
        inputs: {
          isExpanded,
          isLatest,
          isAutoFoldedTechnical,
          landmarks,
          stable,
          providerKey,
          syntaxEnabled: shouldEnableSyntaxHighlighting,
        },
        value,
      })
      return value
    })
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'cardDisplayData',
        totalCards: renderedTranscriptCards.length,
        recomputed,
        liveCards: liveCardCount,
        durationMs: performance.now() - profileStart,
      })
    }
    return result
  }, [
    allLandmarks,
    stableCardData,
    renderedTranscriptCards,
    transcriptRenderStart,
    totalTranscriptCards,
    expandedKeysForRender,
    transcriptView,
    provider,
    shouldEnableSyntaxHighlighting,
  ])

  // Memoize the full list of <TranscriptCard /> elements so unrelated
  // re-renders (composer input, notice banner, theme menu, status tick, etc.)
  // don't rebuild N elements + run N React.memo comparisons. Only deps that
  // actually change what a card displays belong here.
  //
  // isSearchHit is derived here from searchMatches (instead of living on
  // CardDisplayData) so search-query changes don't invalidate cardDisplayData
  // — they only re-run this memo, whose per-card work is cheap (Set lookup).
  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches])
  const activeMatchTargetIndex = searchMatches[searchMatchIndex] ?? -1
  // Diff-note namespace tracks the session whose transcript is actually
  // displayed (the debounced `transcriptSession`), NOT the live selection.
  // Keying it off `selectedSessionIdentity` would (a) mislabel notes during the
  // open-debounce window when the old transcript is still showing, and (b) — far
  // worse for perf — make the `transcriptChildren` memo below rebuild all N card
  // elements on every scrub step, since it reads this value. Stable during a
  // scrub → the whole transcript subtree keeps element identity and React skips
  // reconciling it.
  const transcriptCardVariantCacheRef = useRef(new WeakMap<TuiTranscriptCard, TranscriptCardVariantCacheEntry>())
  const transcriptCardVariants = useMemo(() => renderedTranscriptCards.map((card, i) => {
      // cardDisplayData/stableCardData are window-relative (index i); search
      // matches are absolute indices into visibleTranscriptCards.
      const absoluteIndex = transcriptRenderStart + i
      const display = cardDisplayData[i]
      if (!display) return null
      const isExpanded = expandedKeysForRender.has(card.key)
      const isSearchHit = searchMatchSet.has(absoluteIndex)
      const isActiveMatch = isSearchHit && activeMatchTargetIndex === absoluteIndex
      return cachedTranscriptCardSelectionVariants(transcriptCardVariantCacheRef.current, {
        card,
        display,
        theme,
        densityState,
        syntaxStyle,
        rightPaneWidth,
        isExpanded,
        isSearchHit,
        isActiveMatch,
        bookmarked: bookmarkKeys.has(card.key),
        onSelectCard: selectTranscriptCard,
        thinkingMode,
        diffLayout,
        imessageStyle,
        transcriptWidth,
        streamMode: isChatLikeView,
        continuousMode: isContinuousView,
        codexMode: transcriptView === 'codex',
        claudeCodeMode: transcriptView === 'claude-code',
        copilotMode: transcriptView === 'copilot',
      openCodeMode: transcriptView === 'opencode',
        turnFooter: isContinuousView ? continuousTurnFooter(card, visibleTranscriptCards[absoluteIndex + 1]) : null,
        agentsMode: usesAgentCardPresentation(card, transcriptView),
        agentToolCursorKey: groupedToolView ? agentToolCursorByGroupKey[card.key] ?? null : null,
        agentToolExpandedKeys: scrollbackExpandedToolKeys ?? (groupedToolView ? expandedCardKeys : EMPTY_EXPANDED_KEYS),
        agentToolCollapsedKeys: groupedToolView ? collapsedCardKeys : EMPTY_EXPANDED_KEYS,
        onSelectAgentTool: selectAgentTool,
        noteNamespace: transcriptNoteNamespace,
        diffNotes: transcriptDiffNotes,
        diffDraft: transcriptDiffDraft,
        hoveredDiffAnchor: hoveredTranscriptDiffAnchor,
        activateDiffHover: activateTranscriptDiffHover,
        openDiffNote: openTranscriptDiffNote,
        sendDiffNoteToComposer: sendTranscriptDiffNoteToComposer,
        diffPlain: transcriptDiffPlainCardKeys.has(card.key),
        diffShowLineNumbers: !transcriptDiffHiddenLineNumberCardKeys.has(card.key),
        diffShowHunkHeaders: !transcriptDiffHiddenHunkHeaderCardKeys.has(card.key),
        diffRowCursor: transcriptDiffRowCursorByCardKey[card.key] ?? 0,
        diffSelectionAnchor: transcriptDiffSelectionAnchorByCardKey[card.key] ?? null,
        diffPlainCardKeys: transcriptDiffPlainCardKeys,
        diffHiddenLineNumberCardKeys: transcriptDiffHiddenLineNumberCardKeys,
        diffHiddenHunkHeaderCardKeys: transcriptDiffHiddenHunkHeaderCardKeys,
        diffRowCursorByCardKey: transcriptDiffRowCursorByCardKey,
        diffSelectionAnchorByCardKey: transcriptDiffSelectionAnchorByCardKey,
        setDiffRowCursor: setTranscriptDiffRowCursorForCard,
        setDiffSelectionAnchor: setTranscriptDiffSelectionAnchorForCard,
        linkCwd: transcriptLinkCwd,
      })
    }).filter((variant): variant is TranscriptCardSelectionVariants => variant !== null), [
    renderedTranscriptCards,
    visibleTranscriptCards,
    transcriptRenderStart,
    cardDisplayData,
    expandedKeysForRender,
    searchMatchSet,
    activeMatchTargetIndex,
    bookmarkKeys,
    selectTranscriptCard,
    theme,
    densityState,
    syntaxStyle,
    rightPaneWidth,
    thinkingMode,
    diffLayout,
    imessageStyle,
    transcriptWidth,
    transcriptView,
    groupedToolView,
    agentToolCursorByGroupKey,
    expandedCardKeys,
    scrollbackExpandedToolKeys,
    collapsedCardKeys,
    selectAgentTool,
    transcriptNoteNamespace,
    transcriptDiffNotes,
    transcriptDiffDraft,
    hoveredTranscriptDiffAnchor,
    activateTranscriptDiffHover,
    openTranscriptDiffNote,
    sendTranscriptDiffNoteToComposer,
    transcriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey,
    setTranscriptDiffSelectionAnchorForCard,
    setTranscriptDiffRowCursorForCard,
    transcriptLinkCwd,
  ])
  // Delete only departed cards after the window commits. Overlap keeps its
  // identities and ordinary selection/typing renders do no cache bookkeeping.
  const cachedWindowRef = useRef<readonly TuiTranscriptCard[]>([])
  useLayoutEffect(() => {
    pruneUnmountedCardData(cachedWindowRef.current, renderedTranscriptCards, [
      stableCardCacheRef.current,
      landmarksByCardRef.current,
      cardDisplayCacheRef.current,
      transcriptCardVariantCacheRef.current,
    ])
    cachedWindowRef.current = renderedTranscriptCards
  }, [renderedTranscriptCards])
  const transcriptChildren = useMemo(() => {
    const cards: React.ReactNode[] = selectTranscriptCardVariants(
      transcriptCardVariants,
      // SCROLLBACK highlights nothing: every card renders its idle variant.
      isScrollbackView ? null : transcriptCursorKey,
      focused,
    )
    if (transcriptRenderStart > 0) {
      cards.unshift(
        <box key="preview-cap-hint" paddingX={1}>
          <text fg={theme.dim} wrapMode="none">
            {fitText(
              focused
                ? `↑ ${transcriptRenderStart} earlier message${transcriptRenderStart === 1 ? '' : 's'} — scroll up to load`
                : `↑ ${transcriptRenderStart} earlier message${transcriptRenderStart === 1 ? '' : 's'} — open the session (Enter) to view all`,
              rightPaneWidth - 2,
            )}
          </text>
        </box>,
      )
    }
    if (transcriptRenderEnd < totalTranscriptCards) {
      const laterCount = totalTranscriptCards - transcriptRenderEnd
      cards.push(
        <box key="reader-window-tail-hint" paddingX={1}>
          <text fg={theme.dim} wrapMode="none">
            {fitText(`↓ ${laterCount} later message${laterCount === 1 ? '' : 's'} — scroll down to load, G for latest`, rightPaneWidth - 2)}
          </text>
        </box>,
      )
    }
    return cards
  }, [
    transcriptCardVariants,
    transcriptRenderStart,
    transcriptRenderEnd,
    totalTranscriptCards,
    transcriptCursorKey,
    isScrollbackView,
    focused,
    theme,
    rightPaneWidth,
  ])

  useLayoutEffect(() => {
    readerWindowOutputRef.current = { start: transcriptRenderStart, cardDisplayData, scrollbackExpandedKeys }
  }, [transcriptRenderStart, cardDisplayData, scrollbackExpandedKeys])
  // Scroll fixup, first half (the second is the root's layout-pass listener).
  // At the commit that changed the mounted window: pick the anchor — the first
  // row mounted in both windows that reaches the viewport — and record where
  // it sat. Its renderable still holds the old layout: no frame has run.
  useLayoutEffect(() => {
    const prev = committedWindowRef.current
    committedWindowRef.current = { sessionKey, window: { start: transcriptRenderStart, end: transcriptRenderEnd } }
    const fixup = readerScrollFixupRef.current
    if (fixup?.kind === 'cursor') {
      fixup.committed = true
      return
    }
    readerScrollFixupRef.current = null
    const sb = transcriptScrollRef.current
    // Following the tail, sticky scroll pins the bottom in the same pass.
    if (!sb || !prev || prev.sessionKey !== sessionKey || followTail) return
    const retained = new Set<string>()
    const lastRetained = Math.min(prev.window.end, transcriptRenderEnd)
    for (let index = Math.max(prev.window.start, transcriptRenderStart); index < lastRetained; index += 1) {
      const card = visibleTranscriptCards[index]
      if (card) retained.add(card.key)
    }
    if (retained.size === 0) return
    const content = sb.content
    const contentY = content.y
    const scrollTop = sb.scrollTop
    let anchor: Renderable | null = null
    for (const row of content.getChildren() as Renderable[]) {
      const key = readerRowKey(row)
      if (!key || !retained.has(key)) continue
      anchor = row
      if (row.y - contentY + row.height > scrollTop) break
    }
    if (anchor) readerScrollFixupRef.current = { kind: 'anchor', el: anchor, prevOffset: anchor.y - contentY }
  }, [sessionKey, transcriptRenderStart, transcriptRenderEnd])
  // Leaving the preview anywhere but the bottom expands every card at once, and
  // the ones above the viewport grow under it. Anchor the first row reaching the
  // viewport, as a slide does; the root's layout pass applies it in the frame
  // that shows the expansion.
  const expandedAnchorRef = useRef<ReadonlySet<string>>(EMPTY_EXPANDED_KEYS)
  useLayoutEffect(() => {
    const previous = expandedAnchorRef.current
    expandedAnchorRef.current = expandedKeysForRender
    if (previous !== EMPTY_EXPANDED_KEYS || expandedKeysForRender === EMPTY_EXPANDED_KEYS || stagedExpansion) return
    const sb = transcriptScrollRef.current
    if (!sb || readerScrollFixupRef.current || sb.scrollTop >= sb.scrollHeight - sb.viewport.height - 1) return
    const contentY = sb.content.y
    for (const row of sb.content.getChildren() as Renderable[]) {
      if (!readerRowKey(row) || row.y - contentY + row.height <= sb.scrollTop) continue
      readerScrollFixupRef.current = { kind: 'anchor', el: row, prevOffset: row.y - contentY }
      break
    }
  }, [expandedKeysForRender, stagedExpansion])
  return <TranscriptViewportContext value={transcriptScrollRef}><TranscriptBlockRestoreContext value={inputs.blockRestore}>{transcriptChildren}</TranscriptBlockRestoreContext></TranscriptViewportContext>
}
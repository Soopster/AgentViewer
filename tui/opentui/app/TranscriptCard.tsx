/** @jsxImportSource @opentui/react */
import { transcriptMeasure } from '../engineeringLayout'
import { TranscriptImages } from '../TranscriptImages'
import React, { useMemo } from 'react'
import { getAssistantDisplayName } from '../../../lib/provider'
import { hasTuiLinkTarget } from '../../../lib/tuiLinkTargets'
import { CardSelectionVariants } from '../cardSelectionVariants'
import { type TuiPierreDiffRow, type TuiPierreSplitRow } from '../pierreDiffView'
import { type SelectedLineRange } from '@pierre/diffs'
import { SyntaxStyle, TextAttributes, type MouseEvent } from '@opentui/core'
import { type TuiTranscriptCard } from '../../format'
import { type TuiThemePalette } from '../../theme'
import { type TuiDiffLayout, type TuiTranscriptWidth } from '../../../lib/tui/service'
import { VirtualTranscriptRows } from '../VirtualTranscriptRows'
import { SelectableMarkdown } from '../SelectableMarkdown'
import { type SelectionColors } from '../selectionTree'
import { fitText, joinMeta } from '../textLayout'
import { type CardDisplayData, type DensityState } from './types'
import { EMPTY_EXPANDED_KEYS, NOOP_SELECT_AGENT_TOOL } from './timing'
import { clamp } from './util'
import { type InlineTextSegment, renderInlineTextSegments, renderInlineMarkdownSpans, hasInlineSpans, renderInlineMarkdownClipped } from './inlineText'
import { formatCopilotTimestamp } from './format'
import { streamStatusColor, transcriptColor, streamToolGroupMarker, diffRowColor, formatDiffLineNumber, diffRowIndicator, terminalSelectionColors, turnSummaryMouseProps, streamLandmarkText, streamLineMarker, mixHexColor, continuousUserBackground, streamUserBackground, streamContinuationMarker, transcriptBackground, diffRowBackground, diffGutterBar, SplitDiffSide } from './transcriptStyle'
import { extractDiffText } from './diffCache'
import { cardDiffText, shouldCenterTranscriptCard, canRenderMarkdownWithSyntax, agentToolCardsFor, streamToolSummaryName, agentToolCardIsExpanded, nestedAgentToolDisplay, streamActivitySummarySegments, isStreamActivityToolCard, transcriptToolLineSegments, streamToolSummarySegments, streamToolDetailLine, agentsToolSummaryLine, coordinatorResultSegments, countCodeBlockLines, codeBlockHeight, sliceCodeBlockLines, codeBlockLabel, isCompactSystemCard, codeBlockHiddenLineCount } from './transcriptRows'
import { streamDiffPreviewData, StreamDiffPreview } from './StreamDiffPreview'
import { type TranscriptDiffNoteDraft, type TranscriptDiffNote, type TranscriptDiffSelectionSpan, transcriptDiffStackRowAnchor, transcriptDiffSplitRowAnchor, transcriptDiffSelectionPointForStackRow, transcriptDiffSelectionPointForSplitRow, transcriptDiffCardNamespace, transcriptDiffSelectionKey, transcriptDiffSelectionSpanFromRowRange, transcriptDiffSelectionSpanFromSelection, renderTranscriptDiffNoteDraft, renderTranscriptDiffNoteCard } from './transcriptDiffSelection'

// Conversation prose becomes difficult to scan when cards stretch across an
// ultrawide terminal. Keep normal cards at a readable measure while allowing
// diffs to use the full reader width for side-by-side content.
export const MAX_USER_CARD_WIDTH = 112

export type TranscriptCardProps = {
  card: TuiTranscriptCard
  display: CardDisplayData
  theme: TuiThemePalette
  densityState: DensityState
  syntaxStyle: SyntaxStyle | null
  rightPaneWidth: number
  isExpanded: boolean
  hasCursor: boolean
  isSelected: boolean
  isSearchHit: boolean
  isActiveMatch: boolean
  bookmarked: boolean
  onSelectCard: (cardKey: string) => void
  thinkingMode: boolean
  diffLayout: TuiDiffLayout
  imessageStyle: boolean
  transcriptWidth: TuiTranscriptWidth
  streamMode: boolean
  /** STREAM restyled after opencode's session view: prompts are ruled bands, replies are plain prose. */
  continuousMode: boolean
  codexMode?: boolean
  claudeCodeMode?: boolean
  copilotMode?: boolean
  openCodeMode?: boolean
  /**
   * The line under a turn's last reply — who answered and how long it took —
   * set only on that card and only in the continuous view. A card cannot know
   * it ends a turn, so the reader decides.
   */
  turnFooter?: string | null
  agentsMode: boolean
  agentToolCursorKey: string | null
  agentToolExpandedKeys: ReadonlySet<string>
  agentToolCollapsedKeys: ReadonlySet<string>
  onSelectAgentTool: (groupKey: string, toolKey: string) => void
  noteNamespace: string
  diffNotes: Map<string, TranscriptDiffNote>
  diffDraft: TranscriptDiffNoteDraft | null
  hoveredDiffAnchor: string | null
  activateDiffHover: (anchor: string) => void
  openDiffNote: (selection: SelectedLineRange, cardKey?: string) => void
  sendDiffNoteToComposer: (card: TuiTranscriptCard, note: TranscriptDiffNote, label: string, diffText: string | null) => void
  diffPlain: boolean
  diffShowLineNumbers: boolean
  diffShowHunkHeaders: boolean
  diffRowCursor: number
  diffSelectionAnchor: number | null
  diffPlainCardKeys: ReadonlySet<string>
  diffHiddenLineNumberCardKeys: ReadonlySet<string>
  diffHiddenHunkHeaderCardKeys: ReadonlySet<string>
  diffRowCursorByCardKey: Readonly<Record<string, number>>
  diffSelectionAnchorByCardKey: Readonly<Record<string, number>>
  setDiffRowCursor: (cardKey: string, rowIndex: number, preserveSelection?: boolean) => void
  setDiffSelectionAnchor: (cardKey: string, rowIndex: number) => void
  // The session's working directory, used to resolve a relative path in the
  // transcript into a clickable target. Per card rather than module-level
  // because split panes can show two sessions rooted in different repositories,
  // and a path resolved against the wrong one is a link to nothing.
  linkCwd?: string
}

// Shared block-markdown body for the Stream and Agents views. Mirrors the
// reader card's three-way decision: full <markdown> (tables/headings/lists/
// fenced code) when syntax is on, the raw-source fallback with inline styling
// when it isn't, or null so the caller keeps its own bodyLines rendering.
// Both gated on the same `shouldRenderSyntaxMarkdown`/`markdownFallbackLines`
// the reader computes, so all views agree on when a card is "markdown".
// A body that is one paragraph of plain text, **bold** and `code` renders the
// same through the inline span renderer as through OpenTUI's <markdown> —
// characters, colours and attributes compared — and costs one text instead of
// a markdown renderable, a code renderable and a tree-sitter highlight round
// trip. Most stream cards are exactly that (a prompt, a short reply). Anything
// the two render differently stays on <markdown>: blocks and blank lines,
// _ and single * emphasis, ~~, links and anything linkable, entities, HTML.
export const MARKDOWN_BLOCK_START = /^(?: {4}|\t| {0,3}(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|>|```|~~~|\||={2,}\s*$|-{2,}\s*$))/m
export const MARKDOWN_NON_PLAIN = /[_~<>\\[\]&|]|``|(?<!\*)\*(?!\*)|\n\s*\n/
export function isPlainMarkdownParagraph(content: string): boolean {
  if (content.length > 4000) return false
  if (MARKDOWN_NON_PLAIN.test(content) || MARKDOWN_BLOCK_START.test(content)) return false
  if (/\*\*\*/.test(content) || (content.match(/\*\*/g)?.length ?? 0) % 2 !== 0) return false
  if ((content.match(/`/g)?.length ?? 0) % 2 !== 0) return false
  return !hasTuiLinkTarget(content)
}

export function renderCardMarkdownBody(opts: {
  markdownContent: string | null | undefined
  markdownFallbackLines: string[] | null
  shouldRenderSyntaxMarkdown: boolean
  syntaxStyle: SyntaxStyle | null
  theme: TuiThemePalette
  fg: string
  width: number
  selectionColors: SelectionColors
  keyPrefix: string
  linkCwd?: string
}): React.ReactNode | null {
  const {
    markdownContent, markdownFallbackLines, shouldRenderSyntaxMarkdown,
    syntaxStyle, theme, fg, width, selectionColors, keyPrefix, linkCwd,
  } = opts
  if (shouldRenderSyntaxMarkdown && markdownContent && syntaxStyle && isPlainMarkdownParagraph(markdownContent)) {
    return (
      <text fg={fg} width={width} wrapMode="word" selectable {...selectionColors}>
        {renderInlineMarkdownSpans(markdownContent, theme, fg, `${keyPrefix}:plain-md`, linkCwd)}
      </text>
    )
  }
  if (shouldRenderSyntaxMarkdown && markdownContent && syntaxStyle) {
    return (
      <SelectableMarkdown
        documentKey={keyPrefix}
        content={markdownContent}
        syntaxStyle={syntaxStyle}
        fg={fg}
        width={width}
        selectionColors={selectionColors}
        borderColor={theme.border}
      />
    )
  }
  if (markdownFallbackLines) {
    return (
      <box flexDirection="column">
        {/* One text for every line — see groupLinesByBackground. */}
        <text fg={fg} wrapMode="none" selectable {...selectionColors}>
          {markdownFallbackLines.map((line, index) => (
            <React.Fragment key={index}>
              {index > 0 ? '\n' : null}
              {hasInlineSpans(line)
                ? renderInlineMarkdownClipped(line, theme, fg, width, `${keyPrefix}:mdf:${index}`, linkCwd)
                : fitText(line, width)}
            </React.Fragment>
          ))}
        </text>
      </box>
    )
  }
  return null
}

// Consecutive body lines that share a background are one <text>, one line per
// row. A line was a box and a text of its own, so a six-line card mounted twelve
// renderables for its body alone, and mounting is what a reader window slide or
// a tab switch spends its time on (createInstance was a quarter of the samples
// in split-reader scrolling). Spans carry each line's colour, so the rows render
// exactly as before; a line with its own background still gets its own box.
export function groupLinesByBackground<T>(lines: readonly T[], backgroundOf: (line: T) => string): Array<{ start: number; background: string; lines: T[] }> {
  const groups: Array<{ start: number; background: string; lines: T[] }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const background = backgroundOf(lines[index])
    const last = groups[groups.length - 1]
    if (last && last.background === background) last.lines.push(lines[index])
    else groups.push({ start: index, background, lines: [lines[index]] })
  }
  return groups
}

export const EMPTY_STACK_DIFF_ROWS: TuiPierreDiffRow[] = []
export const EMPTY_SPLIT_DIFF_ROWS: TuiPierreSplitRow[] = []
export const EMPTY_DIFF_ROWS: Array<TuiPierreDiffRow | TuiPierreSplitRow> = []

export function TranscriptCardInner({
  card,
  display,
  theme,
  densityState,
  syntaxStyle,
  rightPaneWidth,
  isExpanded,
  hasCursor,
  isSelected,
  isSearchHit,
  isActiveMatch,
  bookmarked,
  onSelectCard,
  thinkingMode,
  diffLayout,
  imessageStyle,
  transcriptWidth,
  streamMode,
  continuousMode,
  codexMode = false,
  claudeCodeMode = false,
  copilotMode = false,
  openCodeMode = false,
  turnFooter,
  agentsMode,
  agentToolCursorKey,
  agentToolExpandedKeys,
  agentToolCollapsedKeys,
  onSelectAgentTool,
  noteNamespace: sessionNoteNamespace,
  diffNotes,
  diffDraft,
  hoveredDiffAnchor,
  activateDiffHover,
  openDiffNote,
  sendDiffNoteToComposer,
  diffPlain,
  diffShowLineNumbers,
  diffShowHunkHeaders,
  diffRowCursor,
  diffSelectionAnchor,
  diffPlainCardKeys,
  diffHiddenLineNumberCardKeys,
  diffHiddenHunkHeaderCardKeys,
  diffRowCursorByCardKey,
  diffSelectionAnchorByCardKey,
  setDiffRowCursor,
  setDiffSelectionAnchor,
  linkCwd,
}: TranscriptCardProps) {
  const noteNamespace = transcriptDiffCardNamespace(sessionNoteNamespace, card.key)
  const {
    landmarks,
    bodyLines,
    diffView,
    codeBlockLineCounts,
    headerMeta,
    accent,
    isThinkingCard,
    categoryEmoji,
    isInsight,
    markdownFallbackLines,
  } = display

  const diffTextForComposer = card.category === 'diff' ? cardDiffText(card, isExpanded) : null
  const marker = hasCursor ? '>' : isSelected ? ':' : card.role === 'user' ? '▸' : '●'
  const cardBg = card.role === 'user'
    ? theme.userBg
    : hasCursor
      ? theme.surface3
      : isSelected
        ? theme.surface2
        : isInsight
          ? theme.surface2
          : theme.surface
  const borderColor = hasCursor
    ? accent
    : isActiveMatch
      ? theme.amber
      : isSearchHit
        ? theme.cyan
        : isInsight
          ? theme.violet
          : bookmarked
            ? theme.amber
            : isSelected
              ? theme.border2
              : card.role === 'user'
                ? accent
                : theme.border
  const availableCardWidth = Math.max(rightPaneWidth - 4, 20)
  // Native diff review keeps the full reader width. Once a diff is presented
  // as an Agents operation, its outer container should follow the same centered
  // width as every multi-tool group; the nested diff still fills that container.
  const centeredCard = shouldCenterTranscriptCard(card, transcriptWidth, agentsMode)
  const boundedCard = centeredCard || (transcriptWidth === 'readable' && (card.category !== 'diff' || agentsMode))
  const readableCardWidth = boundedCard
    ? transcriptMeasure(availableCardWidth, transcriptWidth)
    : availableCardWidth
  const userBubble = centeredCard && card.role === 'user'
  const cardWidth = userBubble
    ? Math.min(Math.max(Math.floor(readableCardWidth * 0.78), 20), MAX_USER_CARD_WIDTH)
    : readableCardWidth
  const imessageUserBubble = userBubble && imessageStyle
  const maxTitleWidth = Math.max(cardWidth - 4, 20)
  const titleMeta = joinMeta([
    headerMeta,
    card.category === 'diff' ? `s ${diffLayout}` : null,
    isSearchHit ? 'match' : null,
    isExpanded || hasCursor ? card.usageSummary ?? null : null,
    (isExpanded || hasCursor) && card.durationLabel ? `⏱ ${card.durationLabel}` : null,
    hasCursor ? 'y copy  b bookmark  Q reply' : null,
  ])
  const cardTitleColor = hasCursor || isSearchHit
    ? accent
    : isActiveMatch || bookmarked
      ? theme.amber
      : theme.dim
  const bookmarkGlyph = bookmarked ? '★ ' : ''
  const cardTitleFull = `${marker} ${bookmarkGlyph}${categoryEmoji}${card.label}${titleMeta ? `  ${titleMeta}` : ''}`
  const cardTitle = cardTitleFull.length > maxTitleWidth
    ? cardTitleFull.slice(0, maxTitleWidth - 1) + '…'
    : cardTitleFull
  const bubbleTextColor = imessageUserBubble ? '#ffffff' : theme.text
  const bodyInnerWidth = Math.max(cardWidth - densityState.bodyIndent - 8, 16)
  const markdownWidth = Math.max(cardWidth - densityState.bodyIndent - 8, 20)
  const effectiveDiffLayout = diffLayout === 'split' && (diffView?.splitRows.length ?? 0) > 0
    ? 'split'
    : 'stack'
  const rawDiffLines = useMemo(() => diffPlain
    ? ((card.editDiff ?? extractDiffText(card.expandedLines) ?? '').split('\n').filter(line => line.length > 0))
    : [], [diffPlain, card])
  const activeDiffRows = !diffPlain && diffView
    ? effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    : EMPTY_DIFF_ROWS
  const renderedDiffRows = useMemo(() => diffShowHunkHeaders ? activeDiffRows : activeDiffRows.filter(row => row.tone !== 'hunk'), [activeDiffRows, diffShowHunkHeaders])
  const diffRows = useMemo(() => isExpanded ? renderedDiffRows : renderedDiffRows.slice(0, densityState.bodyLines), [renderedDiffRows, isExpanded, densityState.bodyLines])
  const hiddenDiffRows = renderedDiffRows.length - diffRows.length
  const stackedDiffRows = !diffPlain && effectiveDiffLayout === 'stack' ? diffRows as TuiPierreDiffRow[] : EMPTY_STACK_DIFF_ROWS
  const splitDiffRows = !diffPlain && effectiveDiffLayout === 'split' ? diffRows as TuiPierreSplitRow[] : EMPTY_SPLIT_DIFF_ROWS
  const diffGutterWidth = useMemo(() => {
    let max = 1
    if (diffShowLineNumbers) for (const row of stackedDiffRows) max = Math.max(max, row.oldLine ?? 0, row.newLine ?? 0)
    return String(max).length
  }, [diffShowLineNumbers, stackedDiffRows])
  const diffBadgeWidth = 3
  const diffTextWidth = Math.max(bodyInnerWidth - (diffShowLineNumbers ? (diffGutterWidth * 2 + 2) : 0) - 5 - diffBadgeWidth - 1, 12)
  const splitGutterWidth = useMemo(() => {
    if (!diffShowLineNumbers) return 0
    let max = 1
    for (const row of splitDiffRows) max = Math.max(max, row.left?.lineNum ?? 0, row.right?.lineNum ?? 0)
    return String(max).length
  }, [diffShowLineNumbers, splitDiffRows])
  const splitDividerWidth = 1
  const splitBadgeWidth = 1
  const splitContentWidth = Math.max(bodyInnerWidth - splitBadgeWidth, 2)
  const splitLeftWidth = Math.floor((splitContentWidth - splitDividerWidth) / 2)
  const splitRightWidth = splitContentWidth - splitDividerWidth - splitLeftWidth
  const diffSelectionRows = !diffPlain && diffView
    ? effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    : []
  const diffSelectionCurrentIndex = diffSelectionRows.length > 0
    ? clamp(diffRowCursor, 0, diffSelectionRows.length - 1)
    : 0
  const selectionAnchorIndex = diffSelectionAnchor != null
    ? clamp(diffSelectionAnchor, 0, Math.max(diffSelectionRows.length - 1, 0))
    : null
  const diffSelectionSpan = diffSelectionRows.length > 0
    ? (
        selectionAnchorIndex != null
          ? transcriptDiffSelectionSpanFromRowRange(
              noteNamespace,
              diffSelectionRows,
              selectionAnchorIndex,
              diffSelectionCurrentIndex,
            )
          : transcriptDiffSelectionSpanFromRowRange(
              noteNamespace,
              diffSelectionRows,
              diffSelectionCurrentIndex,
              diffSelectionCurrentIndex,
            )
      )
    : null
  const diffSelectionKey = diffSelectionSpan?.key ?? null
  const diffSelectionCurrentSelection = diffSelectionSpan?.selection ?? null
  const diffSelectionStartIndex = diffSelectionSpan?.startIndex ?? diffSelectionCurrentIndex
  const diffSelectionEndIndex = diffSelectionSpan?.endIndex ?? diffSelectionCurrentIndex
  const diffSelectionNotesByEndIndex = useMemo(() => {
    const notesByEndIndex = new Map<number, Array<{ key: string; note: TranscriptDiffNote; label: string; span: TranscriptDiffSelectionSpan }>>()
    if (diffPlain || !diffView) return notesByEndIndex
    const rows = effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    for (const [key, note] of diffNotes) {
      const span = transcriptDiffSelectionSpanFromSelection(noteNamespace, rows, note.range)
      if (!span) continue
      const legacyKey = transcriptDiffSelectionKey(sessionNoteNamespace, note.range)
      if (span.key !== key && (legacyKey !== key || diffNotes.has(span.key))) continue
      const list = notesByEndIndex.get(span.endIndex) ?? []
      list.push({ key, note, label: span.label, span })
      notesByEndIndex.set(span.endIndex, list)
    }
    return notesByEndIndex
  }, [diffNotes, diffPlain, diffView, effectiveDiffLayout, noteNamespace, sessionNoteNamespace])
  const diffDraftSpan = useMemo(() => {
    if (diffPlain || !diffView || !diffDraft) return null
    const rows = effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    const span = transcriptDiffSelectionSpanFromSelection(noteNamespace, rows, diffDraft.range)
    return span?.key === diffDraft.anchor ? span : null
  }, [diffDraft, diffPlain, diffView, effectiveDiffLayout, noteNamespace])
  const shouldRenderSyntaxMarkdown = Boolean(
    isExpanded
    && card.markdownContent
    && !card.hasMermaidDiagrams
    && syntaxStyle
    && canRenderMarkdownWithSyntax(card.markdownContent),
  )
  // Keys pop in cyan, labels stay muted — same scan-at-a-glance convention as
  // the main status bar (see footerSegments). The `syntax` status is rendered
  // as a real status chip (green dot = active), not disguised as a keybinding,
  // and only when parsed mode is actually highlighting.
  const diffFooterSegments = card.category === 'diff'
    ? (() => {
        const controls: Array<[string, string]> = [
          ['v', diffPlain ? 'parsed' : 'plain'],
          ['s', diffLayout],
          ['n', diffShowLineNumbers ? '#' : 'no#'],
          ['m', diffShowHunkHeaders ? '@@' : 'no@@'],
          ['{}', 'hunk'],
          ['⇧j/k', 'range'],
          ['a', 'note'],
          ['A', 'composer'],
          ['x', 'del'],
        ]
        const segs: InlineTextSegment[] = []
        controls.forEach(([keyGlyph, label], i) => {
          if (i > 0) segs.push({ text: '  ', fg: theme.dim })
          segs.push({ text: keyGlyph, fg: theme.cyan })
          segs.push({ text: ` ${label}`, fg: theme.muted })
        })
        if (!diffPlain) {
          segs.push({ text: '   ● ', fg: theme.green })
          segs.push({ text: 'syntax', fg: theme.muted })
        }
        return segs
      })()
    : null
  const beginDiffMouseSelection = (event: MouseEvent, rowIndex: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (event.modifiers.shift) {
      setDiffSelectionAnchor(card.key, diffSelectionAnchor ?? diffSelectionCurrentIndex)
    } else {
      setDiffSelectionAnchor(card.key, rowIndex)
    }
    setDiffRowCursor(card.key, rowIndex, true)
  }
  const updateDiffMouseSelection = (event: MouseEvent, rowIndex: number) => {
    if (event.button !== 0 || (!event.isDragging && event.type !== 'drag')) return
    event.stopPropagation()
    setDiffRowCursor(card.key, rowIndex, true)
  }
  const landmarkWidth = readableCardWidth - 4
  const selectionColors = terminalSelectionColors(theme)

  if (agentsMode) {
    const agentWidth = Math.max(readableCardWidth, 24)
    const toolCards = agentToolCardsFor(card)
    const operationalCard = toolCards.length > 0
    const streamAskUserCard = streamMode
      && toolCards.length === 1
      && streamToolSummaryName(toolCards[0]) === 'ask user'
      ? toolCards[0]
      : null
    const streamAskUserLines = streamAskUserCard
      ? isExpanded ? streamAskUserCard.expandedLines : streamAskUserCard.lines
      : []
    const streamGroupMarker = operationalCard ? streamToolGroupMarker(toolCards) : '•'
    const operationFailed = operationalCard && streamGroupMarker === '×'
    const operationRunning = operationalCard && toolCards.some((tool) => tool.pending)
    const operationStatus = joinMeta([operationFailed ? 'failed' : null, operationRunning ? 'running' : null])
    const agentAccent = operationFailed ? theme.red : operationalCard ? theme.amber : accent
    const agentBg = hasCursor
      ? theme.surface3
      : isSelected
        ? theme.surface2
        : cardBg
    const streamAgentBg = hasCursor
      ? isExpanded && agentToolCursorKey
        ? theme.surface2
        : theme.userBg
      : undefined
    const contentWidth = Math.max(agentWidth - 2, 16)
    const agentBodyWidth = Math.max(contentWidth - 2, 12)
    const agentMarkdownBody = renderCardMarkdownBody({
      markdownContent: card.markdownContent,
      markdownFallbackLines,
      shouldRenderSyntaxMarkdown,
      syntaxStyle,
      theme,
      fg: theme.text,
      width: agentBodyWidth,
      selectionColors,
      keyPrefix: `${card.key}:agent`,
    })
    const toolCount = toolCards.length || bodyLines.filter((line) => line.tone === 'tool' && /^tool\s+/i.test(line.text.trim())).length || 1
    const headerLabel = operationalCard
      ? `${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}${!streamMode && operationStatus ? ` · ${operationStatus}` : ''}`
      : card.label
    const agentsMarker = hasCursor ? '>' : operationFailed ? '×' : operationRunning ? '○' : operationalCard ? '⚙' : card.role === 'user' ? '▸' : '●'
    const agentsTitleMeta = joinMeta([
      headerMeta,
      isSearchHit ? 'match' : null,
      bookmarked ? 'bookmarked' : null,
      hasCursor || isExpanded ? card.usageSummary ?? null : null,
      (hasCursor || isExpanded) && card.durationLabel ? `⏱ ${card.durationLabel}` : null,
      hasCursor ? 'y copy  b bookmark  Q reply' : null,
    ])
    const agentsMaxTitleWidth = Math.max(agentWidth - 4, 20)
    const agentsCardTitleFull = `${agentsMarker} ${headerLabel}${agentsTitleMeta ? `  ${agentsTitleMeta}` : ''}`
    const agentsCardTitle = agentsCardTitleFull.length > agentsMaxTitleWidth
      ? agentsCardTitleFull.slice(0, agentsMaxTitleWidth - 1) + '…'
      : agentsCardTitleFull
    const expandedToolDisplays = isExpanded && toolCards.length > 0 && !streamAskUserCard
      ? toolCards.map((toolCard) => {
          const toolExpanded = agentToolCardIsExpanded(toolCard, agentToolExpandedKeys, agentToolCollapsedKeys)
          return {
            card: toolCard,
            display: nestedAgentToolDisplay(
              toolCard,
              toolCard.provider,
              toolExpanded,
              densityState.bodyLines,
              Boolean(syntaxStyle),
              thinkingMode,
            ),
            isExpanded: toolExpanded,
            hasCursor: hasCursor && agentToolCursorKey === toolCard.key,
          }
        })
      : []
    const rendersCollapsedStreamTools = streamMode && operationalCard && !isExpanded
    const collapsedStreamToolCards = toolCards
    const streamActivitySegments = rendersCollapsedStreamTools
      ? streamActivitySummarySegments(collapsedStreamToolCards, theme)
      : null
    const streamDetailToolCards = collapsedStreamToolCards
    let streamActivityToolCount = 0
    let lastStreamActivityIndex = -1
    for (let index = 0; index < streamDetailToolCards.length; index += 1) {
      if (isStreamActivityToolCard(streamDetailToolCards[index])) {
        streamActivityToolCount += 1
        lastStreamActivityIndex = index
      }
    }
    const hasSingleStreamActivity = streamActivityToolCount === 1
    return (
      <box
        flexDirection="column"
        marginBottom={streamMode ? densityState.streamGap : densityState.cardGap}
        width={agentWidth}
        alignSelf={centeredCard ? 'center' : undefined}
      >
        {landmarks.map((landmark, landmarkIndex) => {
          const color = landmark.kind === 'resume'
            ? theme.cyan
            : landmark.kind === 'unread'
              ? theme.amber
              : landmark.kind === 'day'
                ? theme.violet
                : theme.dim
          return (
            <box key={`${card.key}:agent-landmark:${landmarkIndex}`} paddingX={1}>
              <text fg={color} width={landmarkWidth} wrapMode="none" selectable {...selectionColors} {...turnSummaryMouseProps(landmark)}>
                {streamMode
                  ? streamLandmarkText(landmark, landmarkWidth)
                  : fitText(landmark.text, landmarkWidth)}
              </text>
            </box>
          )
        })}
        <box
          id={`${card.images?.length ? 'card-content' : 'card'}:${card.key}`}
          flexDirection="row"
          width={agentWidth}
          // Explicit edges clear native borders when keyed cards change views.
          // A single separator keeps operational groups distinct without boxing
          // every message; cursor emphasis does not change the row geometry.
          border={streamMode ? [] : ['top']}
          borderStyle={streamMode ? undefined : hasCursor ? 'heavy' : 'single'}
          borderColor={streamMode ? undefined : hasCursor || isSearchHit || operationFailed ? agentAccent : theme.border}
          backgroundColor={streamMode ? streamAgentBg : agentBg}
          title={streamMode ? undefined : agentsCardTitle}
          titleColor={hasCursor || isSearchHit || operationFailed || operationRunning ? agentAccent : theme.dim}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            onSelectCard(card.key)
          }}
        >
          <box
            flexDirection="column"
            width={contentWidth}
            paddingX={1}
            paddingBottom={streamMode ? 0 : densityState.bodyPad}
          >
            {streamAskUserCard ? (
              <box flexDirection="column">
                {streamAskUserLines.map((line, lineIndex) => (
                  <text
                    key={`${card.key}:stream-ask-user:${lineIndex}`}
                    fg={transcriptColor(line, theme)}
                    wrapMode="none"
                    selectable
                    {...selectionColors}
                  >
                    {line.tone === 'tool'
                      ? renderInlineTextSegments(
                          transcriptToolLineSegments(line.text, theme),
                          agentBodyWidth,
                          theme.dim,
                        )
                      : hasInlineSpans(line.text)
                        ? renderInlineMarkdownClipped(
                            line.text,
                            theme,
                            transcriptColor(line, theme),
                            agentBodyWidth,
                            `${card.key}:stream-ask-user-md:${lineIndex}`,
                            linkCwd,
                          )
                        : fitText(line.text, agentBodyWidth)}
                  </text>
                ))}
              </box>
            ) : rendersCollapsedStreamTools ? (
              <box flexDirection="column">
                {streamActivitySegments && !hasSingleStreamActivity ? (
                  <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                    {renderInlineTextSegments(
                      hasCursor && streamActivitySegments[0]
                        ? [{ text: '❯ ', fg: theme.text }, ...streamActivitySegments.slice(1)]
                        : streamActivitySegments,
                      agentBodyWidth,
                      theme.dim,
                    )}
                  </text>
                ) : null}
                {streamDetailToolCards.map((toolCard, toolIndex) => {
                  let segments = streamToolSummarySegments(toolCard, theme)
                  if (claudeCodeMode) segments = segments.map((segment, index) => ({
                    ...segment, text: index === 0 ? '  ' : segment.text, fg: theme.dim,
                  }))
                  if (copilotMode) segments = segments.map((segment, index) => index === 1
                    ? { ...segment, text: streamToolSummaryName(toolCard) === 'bash' ? 'Shell' : segment.text, fg: theme.text, attributes: TextAttributes.BOLD }
                    : index > 1 ? { ...segment, fg: theme.dim } : segment)
                  if (openCodeMode && streamToolSummaryName(toolCard) === 'bash') segments = segments.map((segment, index) => index === 0
                    ? { ...segment, text: '$ ', fg: theme.amber }
                    : index === 1
                      ? { ...segment, text: 'Shell', fg: theme.text, attributes: TextAttributes.BOLD }
                      : { ...segment, fg: theme.dim })
                  const diffPreview = toolCard.category === 'diff' ? streamDiffPreviewData(toolCard) : null
                  const isActivityTool = Boolean(streamActivitySegments && isStreamActivityToolCard(toolCard))
                  const isSingleActivityTool = hasSingleStreamActivity && isActivityTool
                  const detailLine = diffPreview ? null : streamToolDetailLine(toolCard)
                  const isLastActivityTool = isActivityTool && toolIndex === lastStreamActivityIndex
                  if (isSingleActivityTool && segments[0]) {
                    if (hasCursor && segments[0]) segments[0] = { text: '❯ ', fg: theme.text }
                  } else if (isActivityTool && segments[0]) {
                    segments[0] = { text: isLastActivityTool ? '  └ ' : '  ├ ', fg: theme.dim }
                  } else if (hasCursor && streamActivitySegments === null && toolIndex === 0 && segments[0]) {
                    segments[0] = { text: '❯ ', fg: theme.text }
                  }
                  if (hasCursor && toolIndex === streamDetailToolCards.length - 1) {
                    segments.push({ text: '  ·  e details', fg: theme.dim })
                  }
                  return (
                    <box
                      key={`${card.key}:stream-tool-summary:${toolCard.key}`}
                      flexDirection="column"
                    >
                      <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                        {renderInlineTextSegments(segments, agentBodyWidth, theme.dim)}
                      </text>
                      {detailLine ? (
                        <text fg={transcriptColor(detailLine, theme)} wrapMode="none" selectable {...selectionColors}>
                          {renderInlineTextSegments([
                            {
                              text: isActivityTool
                                ? isLastActivityTool ? '    └ ' : '  │ └ '
                                : '  └ ',
                              fg: theme.dim,
                            },
                            ...(/^tool\s+coordinator |^coordinator /i.test(agentsToolSummaryLine(toolCard).text.trim()) && /^[✓✗]/.test(detailLine.text.trim())
                              ? coordinatorResultSegments(detailLine.text.trim(), theme)
                              : [{ text: detailLine.text.trim(), fg: transcriptColor(detailLine, theme) }]),
                          ], agentBodyWidth, theme.dim)}
                        </text>
                      ) : null}
                      {diffPreview ? (
                        <StreamDiffPreview
                          card={toolCard}
                          theme={theme}
                          syntaxStyle={syntaxStyle}
                          width={agentBodyWidth}
                          selectionColors={selectionColors}
                        />
                      ) : null}
                    </box>
                  )
                })}
              </box>
            ) : streamMode ? (
              <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                {renderInlineTextSegments([
                  { text: hasCursor ? '❯ ' : `${streamGroupMarker} `, fg: hasCursor ? theme.text : streamStatusColor(streamGroupMarker, theme) },
                  // Key hints belong to the card the cursor is on, like every
                  // other hint in this branch; a cursor-less view shows none.
                  { text: hasCursor ? `${headerLabel}  ·  e collapse  ·  j/k select` : headerLabel, fg: theme.dim },
                ], agentBodyWidth, theme.dim)}
              </text>
            ) : null}
            {expandedToolDisplays.length > 0 ? (
              <box flexDirection="column" marginTop={streamMode ? 0 : 1}>
                {expandedToolDisplays.map((toolEntry, toolIndex) => {
                  const toolCard = toolEntry.card
                  return (
                    <TranscriptCard
                      key={`${card.key}:agent-tool-card:${toolCard.key}:${toolIndex}`}
                      card={toolCard}
                      display={toolEntry.display}
                      theme={theme}
                      densityState={densityState}
                      syntaxStyle={syntaxStyle}
                      rightPaneWidth={agentBodyWidth + 4}
                      isExpanded={toolEntry.isExpanded}
                      hasCursor={toolEntry.hasCursor}
                      isSelected={toolEntry.hasCursor}
                      isSearchHit={false}
                      isActiveMatch={false}
                      bookmarked={false}
                      onSelectCard={() => {
                        onSelectCard(card.key)
                        onSelectAgentTool(card.key, toolCard.key)
                      }}
                      thinkingMode={thinkingMode}
                      diffLayout={diffLayout}
                      imessageStyle={imessageStyle}
                      transcriptWidth="full"
                      streamMode={streamMode}
                      continuousMode={continuousMode}
                      agentsMode={false}
                      agentToolCursorKey={null}
                      agentToolExpandedKeys={EMPTY_EXPANDED_KEYS}
                      agentToolCollapsedKeys={EMPTY_EXPANDED_KEYS}
                      onSelectAgentTool={NOOP_SELECT_AGENT_TOOL}
                      noteNamespace={noteNamespace}
                      diffNotes={diffNotes}
                      diffDraft={diffDraft}
                      hoveredDiffAnchor={hoveredDiffAnchor}
                      activateDiffHover={activateDiffHover}
                      openDiffNote={openDiffNote}
                      sendDiffNoteToComposer={sendDiffNoteToComposer}
                      diffPlain={diffPlainCardKeys.has(toolCard.key)}
                      diffShowLineNumbers={!diffHiddenLineNumberCardKeys.has(toolCard.key)}
                      diffShowHunkHeaders={!diffHiddenHunkHeaderCardKeys.has(toolCard.key)}
                      diffRowCursor={diffRowCursorByCardKey[toolCard.key] ?? 0}
                      diffSelectionAnchor={diffSelectionAnchorByCardKey[toolCard.key] ?? null}
                      diffPlainCardKeys={diffPlainCardKeys}
                      diffHiddenLineNumberCardKeys={diffHiddenLineNumberCardKeys}
                      diffHiddenHunkHeaderCardKeys={diffHiddenHunkHeaderCardKeys}
                      diffRowCursorByCardKey={diffRowCursorByCardKey}
                      diffSelectionAnchorByCardKey={diffSelectionAnchorByCardKey}
                      setDiffRowCursor={setDiffRowCursor}
                      setDiffSelectionAnchor={setDiffSelectionAnchor}
                    />
                  )
                })}
              </box>
            ) : rendersCollapsedStreamTools || streamAskUserCard ? null : agentMarkdownBody ? (
              agentMarkdownBody
            ) : bodyLines.map((line, lineIndex) => {
              const toolLine = operationalCard && line.tone === 'tool'
              const wrapProse = !operationalCard && isExpanded
              return (
                <box
                  key={`${card.key}:agent-line:${lineIndex}`}
                  backgroundColor={!streamMode && toolLine ? theme.surface2 : undefined}
                >
                  <text fg={transcriptColor(line, theme)} width={agentBodyWidth} wrapMode={wrapProse ? 'word' : 'none'} selectable {...selectionColors}>
                    {toolLine
                      ? renderInlineTextSegments(transcriptToolLineSegments(line.text, theme, streamMode ? '  └ ' : '› ', theme.dim, streamMode), agentBodyWidth, theme.dim)
                      : wrapProse
                        ? renderInlineMarkdownSpans(line.text, theme, transcriptColor(line, theme), `${card.key}:agent-md:${lineIndex}`, linkCwd)
                        : hasInlineSpans(line.text)
                          ? renderInlineMarkdownClipped(line.text, theme, transcriptColor(line, theme), agentBodyWidth, `${card.key}:agent-md:${lineIndex}`, linkCwd)
                          : fitText(line.text, agentBodyWidth)}
                  </text>
                </box>
              )
            })}
          </box>
        </box>
      </box>
    )
  }

  // Keep collapsed diffs compact in Stream mode, but route expanded diffs
  // through the full card renderer below. That renderer owns the existing
  // split/stack/plain views, hunk navigation, range selection, notes, and
  // composer actions; duplicating it here would make the two views drift.
  if (streamMode && !(card.category === 'diff' && isExpanded)) {
    // Collapsed diff rows stay inside the centered column too (unlike the
    // reader path's diff exemption) — only expanded diffs, routed to the full
    // renderer above, keep the whole pane width.
    const streamCentered = transcriptWidth === 'centered'
    // The transcript pane spends two columns on its border and two more on
    // the surrounding paddingX={1}; bodyIndent is budgeted separately below.
    const streamAvailableWidth = Math.max(rightPaneWidth - 4, 16)
    const streamWidth = Math.max((copilotMode || openCodeMode) ? streamAvailableWidth - densityState.bodyIndent : transcriptMeasure(streamAvailableWidth - densityState.bodyIndent, transcriptWidth), 16)
    const streamLandmarkWidth = streamWidth + densityState.bodyIndent
    // Subagent cards prefix the marker with one ↪ per spawn-chain level
    // (`subagent:parent/child` origin), widening the marker gutter to match.
    const streamSubagentArrows = card.subagentDepth ? '↪'.repeat(Math.min(card.subagentDepth, 3)) : ''
    // The continuous view spends no columns on a marker gutter — the left rule
    // already says whose message this is, and a glyph per line is the thing
    // that stops a transcript reading as prose. Subagent arrows stay: they say
    // something the rule cannot, and they are why this is not simply zero.
    const streamMarkerWidth = (continuousMode ? 0 : 2) + streamSubagentArrows.length
    // Every continuous message starts its text in the column a prompt's text
    // does (rule + two), so prompts and replies share one left edge the way
    // opencode's do; only the prompt draws the rule.
    const continuousInset = 3
    const copilotTimeWidth = copilotMode && card.role === 'user' && card.timestampMs ? 8 : 0
    const streamTextWidth = continuousMode
      ? Math.max(streamLandmarkWidth - continuousInset - streamMarkerWidth, 12)
      : Math.max(streamWidth - streamMarkerWidth - copilotTimeWidth, 12)
    const streamChildTextWidth = continuousMode
      ? Math.max(streamTextWidth - 2, 10)
      : Math.max(streamWidth - 4, 10)
    // Turn separators are the rule the band replaces: a prompt on its own
    // panel already says where a turn starts.
    const streamLandmarks = continuousMode || codexMode || claudeCodeMode || copilotMode || openCodeMode ? landmarks.filter((landmark) => landmark.kind !== 'turn') : landmarks
    const firstLine = bodyLines[0]
    const streamBaseMarker = copilotMode
      ? card.role === 'user' ? '❯' : '●'
      : claudeCodeMode
      ? card.role === 'user' ? '❯' : '•'
      : codexMode
      ? card.role === 'user' ? '›' : '•'
      : continuousMode
      ? ''
      : hasCursor
        ? '❯'
        : firstLine
          ? streamLineMarker(firstLine, card.role)
          : card.role === 'user' ? '❯' : '•'
    const streamMarker = `${streamSubagentArrows}${streamBaseMarker}`
    const streamMarkerColor = hasCursor
      ? theme.text
      : isSearchHit
        ? theme.cyan
        : copilotMode
          ? card.role === 'user' ? theme.text : theme.cyan
          : card.role === 'user'
            ? claudeCodeMode ? theme.text : accent
            : firstLine && ['tool', 'result_ok', 'result_error', 'system'].includes(firstLine.tone)
              ? transcriptColor(firstLine, theme)
              : theme.text
    const streamFirstLineColor = hasCursor && firstLine
      ? theme.text
      : firstLine
        ? copilotMode && firstLine.tone === 'thinking' ? theme.muted : openCodeMode && firstLine.tone === 'thinking' ? theme.amber : transcriptColor(firstLine, theme)
        : theme.dim
    const remainingLines = bodyLines.slice(1)
    const streamDiffPreview = card.category === 'diff' ? streamDiffPreviewData(card) : null
    const streamDiffHeaderSegments = streamDiffPreview
      ? (() => {
          const segments = streamToolSummarySegments(card, theme)
          if (hasCursor && segments[0]) segments[0] = { text: '❯ ', fg: theme.text }
          if (hasCursor) segments.push({ text: '  ·  e details', fg: theme.dim })
          return segments
        })()
      : null
    // Full block markdown (tables/headings/lists/fenced code) for expanded
    // text cards, same as the reader view — null for everything else, so the
    // per-line stream rendering below still owns tool cards and previews.
    const streamMarkdownBody = renderCardMarkdownBody({
      markdownContent: card.markdownContent,
      markdownFallbackLines,
      shouldRenderSyntaxMarkdown,
      syntaxStyle,
      theme,
      fg: theme.text,
      width: streamTextWidth,
      selectionColors,
      keyPrefix: `${card.key}:stream`,
    })
    // Turn boundaries and tool-only assistant messages carry no text body. They
    // would otherwise render a "(no output)" row of pure noise in Stream view —
    // drop the body entirely, even when focused. A card with no body and no
    // landmarks collapses to zero height (id anchor preserved for scroll-to).
    const streamHasBody = Boolean(streamMarkdownBody)
      || Boolean(streamDiffPreview)
      || Boolean(firstLine)
      || remainingLines.length > 0
      || (isExpanded && (card.codeBlocks?.length ?? 0) > 0)
    const streamRendersSomething = streamHasBody || streamLandmarks.length > 0
    // User prompts get a full-width tinted band plus an accent rail so they
    // remain obvious even in palettes whose base user background is subtle.
    const streamBg = card.role === 'user'
      ? copilotMode ? mixHexColor(theme.text, theme.bg, 0.13) ?? theme.surface2 : claudeCodeMode ? mixHexColor(theme.text, theme.bg, 0.20) ?? theme.surface2 : codexMode ? theme.surface2 : continuousMode ? continuousUserBackground(theme) : streamUserBackground(theme)
      : hasCursor
        ? theme.surface2
        : undefined
    return (
      <box
        id={`${card.images?.length ? 'card-content' : 'card'}:${card.key}`}
        flexDirection="column"
        // Agents mode uses this same keyed outer card with a top separator.
        // Keep the stream/chat edge set explicit so returning here clears the
        // native frame instead of leaving the previous view's border painted.
        border={[]}
        marginBottom={streamRendersSomething
          // The continuous view never lets two messages touch: the rule is its
          // only separator, and two abutting rules read as one message with a
          // colour change halfway down. Density can still make it roomier.
          ? Math.max(
              card.role === 'user' ? densityState.streamUserGap : densityState.streamGap,
              continuousMode ? 1 : 0,
            )
          : 0}
        alignSelf={streamCentered ? 'center' : undefined}
        width={transcriptWidth !== 'full' ? streamWidth + densityState.bodyIndent : undefined}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          onSelectCard(card.key)
        }}
      >
        {streamLandmarks.map((landmark, landmarkIndex) => {
          const lmColor = landmark.kind === 'resume'
            ? theme.cyan
            : landmark.kind === 'unread'
              ? theme.amber
              : landmark.kind === 'day'
                ? theme.violet
                : theme.dim
          return (
            <text
              {...selectionColors}
              key={`${card.key}:lm:${landmarkIndex}`}
              fg={lmColor}
              width={streamLandmarkWidth}
              wrapMode="none"
              selectable
              {...turnSummaryMouseProps(landmark)}
            >
              {streamLandmarkText(landmark, streamLandmarkWidth)}
            </text>
          )
        })}
        {streamHasBody && (
        <box
          flexDirection="column"
          width={streamLandmarkWidth}
          // A prompt is a ruled band; everything else is unmarked prose indented
          // to the prompt's text column. The band's vertical padding is what
          // makes it read as a panel rather than a highlighted line.
          border={card.role === 'user' && !codexMode && !claudeCodeMode && !copilotMode ? ['left'] : []}
          borderStyle={card.role === 'user' ? 'heavy' : undefined}
          borderColor={card.role === 'user' ? theme.cyan : undefined}
          paddingLeft={codexMode || claudeCodeMode || copilotMode ? 0 : continuousMode
            ? card.role === 'user' ? continuousInset - 1 : continuousInset
            : card.role === 'user'
              ? Math.max(densityState.bodyIndent - 1, 0)
              : densityState.bodyIndent}
          paddingTop={continuousMode && card.role === 'user' ? 1 : 0}
          paddingBottom={continuousMode && card.role === 'user' ? 1 : 0}
          backgroundColor={streamBg}
        >
        {streamDiffPreview && streamDiffHeaderSegments ? (
          <box flexDirection="column">
            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
              {renderInlineTextSegments(streamDiffHeaderSegments, streamTextWidth, theme.dim)}
            </text>
            <StreamDiffPreview
              card={card}
              theme={theme}
              syntaxStyle={syntaxStyle}
              width={streamTextWidth}
              selectionColors={selectionColors}
            />
          </box>
        ) : streamMarkdownBody ? (
          <box flexDirection="row">
            <text
              fg={streamMarkerColor}
              width={streamMarkerWidth}
              wrapMode="none"
              selectable
              {...selectionColors}
            >
              {`${streamMarker} `}
            </text>
            <box flexDirection="column" width={streamTextWidth}>
              {streamMarkdownBody}
            </box>
          </box>
        ) : (
        <>
        {firstLine ? (
          <box flexDirection="row">
            <text fg={streamMarkerColor} width={streamMarkerWidth} wrapMode="none" selectable {...selectionColors}>
              {`${streamMarker} `}
            </text>
            <text
              fg={streamFirstLineColor}
              width={streamTextWidth}
              wrapMode={firstLine.tone === 'tool' ? 'none' : 'word'}
              attributes={(copilotMode || openCodeMode) && firstLine.tone === 'thinking' ? TextAttributes.ITALIC : card.role === 'user' && !continuousMode && !codexMode && !claudeCodeMode && !copilotMode ? TextAttributes.BOLD : undefined}
              selectable
              {...selectionColors}
            >
              {firstLine.tone === 'tool'
                ? renderInlineTextSegments(transcriptToolLineSegments(firstLine.text, theme, '', theme.dim, true), streamTextWidth, theme.dim)
                : hasInlineSpans(firstLine.text)
                  ? renderInlineMarkdownSpans(firstLine.text, theme, streamFirstLineColor, `${card.key}:f`, linkCwd)
                  : firstLine.text}
            </text>
            {copilotMode && card.role === 'user' && card.timestampMs ? (
              <text fg={theme.dim} width={copilotTimeWidth} wrapMode="none" selectable {...selectionColors}>
                {formatCopilotTimestamp(card.timestampMs)}
              </text>
            ) : null}
          </box>
        ) : (
          <text fg={theme.dim} selectable {...selectionColors}>{`${streamMarker} (no output)`}</text>
        )}
        {remainingLines.map((line, lineIndex) => {
          // A line's own leading spaces join the gutter rather than the text,
          // so a long indented line wraps under itself. Left in the text, the
          // wrapped part fell back to the block's edge — a teammate's quoted
          // reply lost its indent halfway through every long sentence.
          const hang = line.tone === 'tool'
            ? 0
            : Math.min(line.text.length - line.text.trimStart().length, 16, Math.max(streamChildTextWidth - 12, 0))
          const continuationMarker = `${continuousMode ? '  ' : streamContinuationMarker(line)}${' '.repeat(hang)}`
          const lineText = hang > 0 ? line.text.slice(hang) : line.text
          const lineWidth = streamChildTextWidth - hang
          const lineColor = copilotMode && line.tone === 'thinking' ? theme.muted : openCodeMode && line.tone === 'thinking' ? theme.amber : transcriptColor(line, theme)
          return (
            <box key={`${card.key}:s:${lineIndex}`} flexDirection="row">
              <text fg={theme.dim} width={continuationMarker.length} wrapMode="none" selectable {...selectionColors}>
                {continuationMarker}
              </text>
              <text
                {...selectionColors}
                fg={lineColor}
                attributes={(copilotMode || openCodeMode) && line.tone === 'thinking' ? TextAttributes.ITALIC : undefined}
                width={lineWidth}
                wrapMode={line.tone === 'tool' ? 'none' : 'word'}
                selectable
              >
                {line.tone === 'tool'
                  ? renderInlineTextSegments(transcriptToolLineSegments(line.text, theme, '', theme.dim, true), lineWidth, theme.dim)
                  : hasInlineSpans(lineText)
                    ? renderInlineMarkdownSpans(lineText, theme, lineColor, `${card.key}:s:${lineIndex}`, linkCwd)
                    : lineText}
              </text>
            </box>
          )
        })}
        {isExpanded && card.codeBlocks?.map((codeBlock, codeBlockIndex) => {
          const lineCount = codeBlockLineCounts[codeBlockIndex] ?? countCodeBlockLines(codeBlock.content)
          const renderHeight = codeBlockHeight(codeBlock, lineCount)
          const visibleCode = sliceCodeBlockLines(codeBlock.content, renderHeight)
          return (
            <box key={codeBlock.key} flexDirection="column" paddingLeft={2} marginTop={1}>
              <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                {fitText(codeBlockLabel(codeBlock), streamTextWidth)}
              </text>
              {syntaxStyle ? (
                <code
                  content={visibleCode}
                  filetype={codeBlock.filetype}
                  syntaxStyle={syntaxStyle}
                  drawUnstyledText={true}
                  selectable
                  {...selectionColors}
                  style={{ height: renderHeight }}
                  width={streamTextWidth}
                />
              ) : visibleCode.split('\n').map((codeLine, lineIndex) => (
                <text {...selectionColors} key={`${codeBlock.key}:stream:${lineIndex}`} fg={theme.text} wrapMode="none" selectable>
                  {fitText(codeLine, streamTextWidth)}
                </text>
              ))}
            </box>
          )
        })}
        </>
        )}
        </box>
        )}
        {continuousMode && turnFooter && streamHasBody ? (
          <box marginTop={1} paddingLeft={continuousInset}>
            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
              {renderInlineTextSegments([
                { text: getAssistantDisplayName(card.provider), fg: accent },
                { text: ` · ${turnFooter}`, fg: theme.dim },
              ], streamTextWidth, theme.dim)}
            </text>
          </box>
        ) : null}
      </box>
    )
  }

  if (isCompactSystemCard(card, isExpanded)) {
    const compactWidth = Math.max(readableCardWidth - 2, 16)
    // The descriptor ("thinking_tokens", "session resumed", …) lives in the body,
    // not the label, so fold the first body line in — minus a redundant leading
    // "system " that the label already conveys.
    const firstBody = bodyLines.length > 0 ? bodyLines[0].text.trim() : ''
    const descriptor = firstBody && firstBody.toLowerCase() !== card.label.toLowerCase()
      ? firstBody.replace(/^system[\s·:]+/i, '')
      : ''
    const headLabel = `${marker} ${bookmarkGlyph}${categoryEmoji}${card.label}${descriptor ? ` · ${descriptor}` : ''}`
    const lineColor = hasCursor
      ? accent
      : isActiveMatch
        ? theme.amber
        : isSearchHit
          ? theme.cyan
          : theme.dim
    const compactBg = hasCursor ? theme.surface3 : isSelected ? theme.surface2 : undefined
    const labelWidth = Math.max(compactWidth - (headerMeta ? headerMeta.length + 2 : 0), 8)
    return (
      <box flexDirection="column" marginBottom={densityState.cardGap} width={readableCardWidth}>
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
              <text fg={color} selectable {...selectionColors} {...turnSummaryMouseProps(landmark)}>{fitText(landmark.text, landmarkWidth)}</text>
            </box>
          )
        })}
        <box
          id={`${card.images?.length ? 'card-content' : 'card'}:${card.key}`}
          paddingX={1}
          width={readableCardWidth}
          flexDirection="row"
          justifyContent="space-between"
          backgroundColor={compactBg}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            onSelectCard(card.key)
          }}
        >
          <text fg={lineColor} wrapMode="none" selectable {...selectionColors}>
            {fitText(headLabel, labelWidth)}
          </text>
          {headerMeta ? (
            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
              {fitText(headerMeta, headerMeta.length)}
            </text>
          ) : null}
        </box>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      marginBottom={densityState.cardGap}
      alignSelf={centeredCard ? 'center' : undefined}
      width={readableCardWidth}
    >
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
            <text fg={color} selectable {...selectionColors} {...turnSummaryMouseProps(landmark)}>{fitText(landmark.text, landmarkWidth)}</text>
          </box>
        )
      })}

      <box
        id={`${card.images?.length ? 'card-content' : 'card'}:${card.key}`}
        alignSelf={userBubble ? 'flex-end' : undefined}
        width={cardWidth}
        // Use an explicit empty edge set for the borderless stream/chat
        // presentation. The native renderer can retain a prior `border=true`
        // frame when this keyed card is reused across transcript views.
        border={streamMode ? [] : ['top', 'left', 'right', 'bottom']}
        borderStyle={streamMode ? undefined : hasCursor ? 'heavy' : 'single'}
        borderColor={streamMode ? undefined : borderColor}
        backgroundColor={cardBg}
        flexDirection="column"
        title={streamMode ? undefined : cardTitle}
        titleColor={streamMode ? undefined : cardTitleColor}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          onSelectCard(card.key)
        }}
      >
        <box flexDirection="column" paddingLeft={densityState.bodyIndent} paddingBottom={densityState.bodyPad}>
          {shouldRenderSyntaxMarkdown && card.markdownContent && syntaxStyle && isPlainMarkdownParagraph(card.markdownContent) ? (
            <box paddingX={1}>
              {/* One plain paragraph: drawn identically without <markdown> — see isPlainMarkdownParagraph. */}
              <text fg={bubbleTextColor} width={markdownWidth} wrapMode="word" selectable {...selectionColors}>
                {renderInlineMarkdownSpans(card.markdownContent, theme, bubbleTextColor, `${card.key}:plain-md`, linkCwd)}
              </text>
            </box>
          ) : shouldRenderSyntaxMarkdown && card.markdownContent && syntaxStyle ? (
            <box paddingX={1}>
              <SelectableMarkdown
                documentKey={card.key}
                content={card.markdownContent}
                syntaxStyle={syntaxStyle}
                fg={bubbleTextColor}
                width={markdownWidth}
                selectionColors={selectionColors}
                borderColor={theme.border}
              />
            </box>
          ) : markdownFallbackLines ? (
            <box paddingX={1}>
              <text fg={bubbleTextColor} selectable {...selectionColors}>
                {markdownFallbackLines.map((line, lineIndex) => (
                  <React.Fragment key={lineIndex}>
                    {lineIndex > 0 ? '\n' : null}
                    {hasInlineSpans(line)
                      ? renderInlineMarkdownClipped(line, theme, bubbleTextColor, markdownWidth, `${card.key}:md-fallback:${lineIndex}`, linkCwd)
                      : fitText(line, markdownWidth)}
                  </React.Fragment>
                ))}
              </text>
            </box>
          ) : (
            <>
              {groupLinesByBackground(bodyLines, (line) => transcriptBackground(line, theme) ?? cardBg).map((group) => (
                <box key={`${card.key}:line:${group.start}`} paddingX={1} backgroundColor={group.background}>
                  <text fg={bubbleTextColor} wrapMode="none" selectable {...selectionColors}>
                    {group.lines.map((line, offset) => {
                      const lineIndex = group.start + offset
                      const lineColor = imessageUserBubble ? bubbleTextColor : transcriptColor(line, theme)
                      return (
                        <React.Fragment key={lineIndex}>
                          {offset > 0 ? '\n' : null}
                          <span fg={lineColor}>
                            {line.tone === 'tool' && !imessageUserBubble
                              ? renderInlineTextSegments(transcriptToolLineSegments(line.text, theme), bodyInnerWidth, theme.dim)
                              : hasInlineSpans(line.text)
                                ? renderInlineMarkdownClipped(line.text, theme, lineColor, bodyInnerWidth, `${card.key}:body-md:${lineIndex}`, linkCwd)
                                : fitText(line.text, bodyInnerWidth)}
                          </span>
                        </React.Fragment>
                      )
                    })}
                  </text>
                </box>
              ))}

              {isExpanded && card.codeBlocks && card.codeBlocks.length > 0 ? (
                card.codeBlocks.map((cb, cbIndex) => {
                  const lineCount = codeBlockLineCounts[cbIndex] ?? countCodeBlockLines(cb.content)
                  const renderHeight = codeBlockHeight(cb, lineCount)
                  const visibleCode = sliceCodeBlockLines(cb.content, renderHeight)
                  const hiddenLineCount = codeBlockHiddenLineCount(lineCount, renderHeight)
                  const lineNumbers = cb.lineNumbers?.slice(0, renderHeight)
                  const gutterWidth = lineNumbers
                    ? Math.max(...lineNumbers.map((num) => num.length), 1) + 1
                    : 0
                  const codeWidth = Math.max(markdownWidth - gutterWidth - (lineNumbers ? 1 : 0), 12)
                  return (
                    <box key={cb.key} paddingX={1} marginTop={1}>
                      <text fg={theme.dim} selectable {...selectionColors}>{fitText(codeBlockLabel(cb), markdownWidth)}</text>
                      {syntaxStyle ? (
                        lineNumbers ? (
                          <box flexDirection="row">
                            <box width={gutterWidth} flexDirection="column">
                              {lineNumbers.map((num, lineIndex) => (
                                <text key={`${cb.key}:gutter:${lineIndex}`} fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                                  {fitText(num, gutterWidth)}
                                </text>
                              ))}
                            </box>
                            <code
                              content={visibleCode}
                              filetype={cb.filetype}
                              syntaxStyle={syntaxStyle}
                              drawUnstyledText={true}
                              selectable
                              {...selectionColors}
                              style={{ height: renderHeight }}
                              width={codeWidth}
                            />
                          </box>
                        ) : (
                          <code
                            content={visibleCode}
                            filetype={cb.filetype}
                            syntaxStyle={syntaxStyle}
                            drawUnstyledText={true}
                            selectable
                            {...selectionColors}
                            style={{ height: renderHeight }}
                            width={markdownWidth}
                          />
                        )
                      ) : (
                        visibleCode.split('\n').map((line, lineIndex) => (
                          <box key={`${cb.key}:fallback:${lineIndex}`} flexDirection="row">
                            {lineNumbers ? (
                              <text fg={theme.dim} selectable {...selectionColors}>{fitText(lineNumbers[lineIndex] ?? '', gutterWidth)}</text>
                            ) : null}
                            <text fg={theme.text} selectable {...selectionColors}>
                              {fitText(line, lineNumbers ? codeWidth : markdownWidth)}
                            </text>
                          </box>
                        ))
                      )}
                      {hiddenLineCount > 0 ? (
                        <text fg={theme.dim} selectable {...selectionColors}>{fitText(`... ${hiddenLineCount} more lines`, markdownWidth)}</text>
                      ) : null}
                    </box>
                  )
                })
              ) : null}
            </>
          )}

          {card.category === 'diff' && diffPlain ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.text} wrapMode="none" selectable {...selectionColors}>
                {rawDiffLines.map((line, index) => {
                  const fg = line.startsWith('+') && !line.startsWith('+++')
                    ? theme.green
                    : line.startsWith('-') && !line.startsWith('---')
                      ? theme.red
                      : line.startsWith('@@')
                        ? theme.cyan
                        : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
                          ? theme.muted
                          : theme.text
                  return (
                    <React.Fragment key={`${card.key}:raw:${index}`}>
                      {index > 0 ? '\n' : null}
                      <span fg={fg}>{fitText(line, bodyInnerWidth)}</span>
                    </React.Fragment>
                  )
                })}
              </text>
              {diffFooterSegments ? (
                <box marginTop={1}>
                  <text fg={theme.cyan} selectable {...selectionColors}>
                    {renderInlineTextSegments(diffFooterSegments, bodyInnerWidth, theme.dim)}
                  </text>
                </box>
              ) : null}
            </box>
          ) : diffView && effectiveDiffLayout === 'stack' ? (
            <box paddingX={1} marginTop={1}>
              <VirtualTranscriptRows documentKey={card.key} rows={stackedDiffRows} rowKey={row => row.key} estimateHeight={() => 1}
                geometryKey={`${card.key}:${effectiveDiffLayout}:${bodyInnerWidth}`} jumpKey={hasCursor ? diffSelectionRows[diffSelectionCurrentIndex]?.key : undefined}
                renderRow={(row, rowIndex) => (
                (() => {
                  const anchor = transcriptDiffStackRowAnchor(noteNamespace, row)
                  const point = transcriptDiffSelectionPointForStackRow(row)
                  const singleRowSelection = point
                    ? {
                        start: point.lineNumber,
                        side: point.side,
                        end: point.lineNumber,
                        endSide: point.side,
                      }
                    : null
                  const currentSelectionRange = diffSelectionCurrentSelection ?? singleRowSelection
                  const hasDraft = diffDraftSpan?.endIndex === rowIndex
                  const noteCards = (diffSelectionNotesByEndIndex.get(rowIndex) ?? []).filter(({ key }) => diffDraft?.anchor !== key && diffDraft?.legacyAnchor !== key)
                  const isHovered = anchor !== null && hoveredDiffAnchor === anchor
                  const isSelectedDiffRow = hasCursor && card.category === 'diff' && rowIndex >= diffSelectionStartIndex && rowIndex <= diffSelectionEndIndex
                  const rowBackground = isSelectedDiffRow ? theme.surface3 : diffRowBackground(row, theme)
                  const rowLabelSelection = currentSelectionRange ?? singleRowSelection
                  return (
                    <React.Fragment key={row.key}>
                      <box
                        width={bodyInnerWidth}
                        flexDirection="row"
                        backgroundColor={rowBackground}
                        onMouseDown={(event) => beginDiffMouseSelection(event, rowIndex)}
                        onMouseDrag={(event) => updateDiffMouseSelection(event, rowIndex)}
                        onMouseOver={(event) => {
                          anchor && activateDiffHover(anchor)
                          updateDiffMouseSelection(event, rowIndex)
                        }}
                        onMouseMove={(event) => {
                          anchor && activateDiffHover(anchor)
                          updateDiffMouseSelection(event, rowIndex)
                        }}
                        onMouseUp={(event) => {
                          if (event.button !== 0) return
                          event.stopPropagation()
                          setDiffRowCursor(card.key, rowIndex, true)
                        }}
                      >
                        <text fg={diffGutterBar(row, theme)} wrapMode="none">▎</text>
                        {/* Line numbers, indicator and code are one text (spans per part): a
                            row was seven renderables, and a diff card mounts dozens of rows. */}
                        <text fg={diffRowColor(row, theme)} wrapMode="none" selectable {...selectionColors}>
                          {diffShowLineNumbers ? (
                            <span fg={theme.dim}>
                              {`${fitText(formatDiffLineNumber(row.oldLine, diffGutterWidth), diffGutterWidth)} ${fitText(formatDiffLineNumber(row.newLine, diffGutterWidth), diffGutterWidth)}`}
                            </span>
                          ) : null}
                          {fitText(`${isSelectedDiffRow ? '▶' : ' '} ${row.indicator ?? diffRowIndicator(row)} `, 3)}
                          {fitText(row.text, Math.max(diffTextWidth, 12))}
                        </text>
                        {isHovered ? (
                          <box
                            id={`diff-note-add:${card.key}:${rowIndex}`}
                            width={3}
                            onMouseUp={(event) => {
                              event.stopPropagation()
                              rowLabelSelection && openDiffNote(rowLabelSelection, card.key)
                            }}
                          >
                            <text fg={theme.cyan} bg={theme.surface3} wrapMode="none">[+]</text>
                          </box>
                        ) : noteCards.length > 0 ? (
                          <text fg={theme.violet} wrapMode="none"> ● </text>
                        ) : (
                          <text fg={theme.dim} wrapMode="none">{'   '}</text>
                        )}
                      </box>
                      {hasDraft && diffDraft ? renderTranscriptDiffNoteDraft(diffDraft, bodyInnerWidth, theme) : null}
                      {noteCards.map(({ key, note, label }) => (
                        <React.Fragment key={key}>
                          {renderTranscriptDiffNoteCard(
                            note,
                            bodyInnerWidth,
                            theme,
                            label,
                            () => sendDiffNoteToComposer(card, note, label, diffTextForComposer),
                          )}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  )
                })()
               )} />
              {hiddenDiffRows > 0 ? (
                <text fg={theme.dim} selectable {...selectionColors}>
                  {fitText(`... ${hiddenDiffRows} more diff lines`, bodyInnerWidth)}
                </text>
              ) : null}
              {diffFooterSegments ? (
                <box marginTop={1}>
                  <text fg={theme.cyan} selectable {...selectionColors}>
                    {renderInlineTextSegments(diffFooterSegments, bodyInnerWidth, theme.dim)}
                  </text>
                </box>
              ) : null}
            </box>
          ) : diffView ? (
            <box paddingX={1} marginTop={1}>
              <VirtualTranscriptRows documentKey={card.key} rows={splitDiffRows} rowKey={row => row.key} estimateHeight={() => 1}
                geometryKey={`${card.key}:${effectiveDiffLayout}:${bodyInnerWidth}`} jumpKey={hasCursor ? diffSelectionRows[diffSelectionCurrentIndex]?.key : undefined}
                renderRow={(row, rowIndex) => {
                if (row.tone !== 'split-change' && row.tone !== 'split-context') {
                  const rowColor = row.tone === 'file' || row.tone === 'hunk' ? theme.cyan : theme.dim
                  const rowBackground = row.tone === 'hunk'
                    ? theme.diffMetaBg
                    : row.tone === 'file'
                      ? theme.surface2
                      : undefined
                  return (
                    <box key={row.key} backgroundColor={rowBackground}>
                      <text fg={rowColor} wrapMode="none" selectable {...selectionColors}>
                        {fitText(row.text ?? '', bodyInnerWidth)}
                      </text>
                    </box>
                  )
                }

                const anchor = transcriptDiffSplitRowAnchor(noteNamespace, row)
                const point = transcriptDiffSelectionPointForSplitRow(row)
                const singleRowSelection = point
                  ? {
                      start: point.lineNumber,
                      side: point.side,
                      end: point.lineNumber,
                      endSide: point.side,
                    }
                  : null
                const currentSelectionRange = diffSelectionCurrentSelection ?? singleRowSelection
                const hasDraft = diffDraftSpan?.endIndex === rowIndex
                const noteCards = (diffSelectionNotesByEndIndex.get(rowIndex) ?? []).filter(({ key }) => diffDraft?.anchor !== key && diffDraft?.legacyAnchor !== key)
                const isHovered = anchor !== null && hoveredDiffAnchor === anchor
                const isSelectedDiffRow = hasCursor && card.category === 'diff' && rowIndex >= diffSelectionStartIndex && rowIndex <= diffSelectionEndIndex
                return (
                  <React.Fragment key={row.key}>
                    <box
                      width={bodyInnerWidth}
                      flexDirection="row"
                      backgroundColor={isSelectedDiffRow ? theme.surface3 : undefined}
                      onMouseDown={(event) => beginDiffMouseSelection(event, rowIndex)}
                      onMouseDrag={(event) => updateDiffMouseSelection(event, rowIndex)}
                      onMouseOver={(event) => {
                        anchor && activateDiffHover(anchor)
                        updateDiffMouseSelection(event, rowIndex)
                      }}
                      onMouseMove={(event) => {
                        anchor && activateDiffHover(anchor)
                        updateDiffMouseSelection(event, rowIndex)
                      }}
                      onMouseUp={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        setDiffRowCursor(card.key, rowIndex, true)
                      }}
                    >
                      <SplitDiffSide
                        side={row.left}
                        width={splitLeftWidth}
                        gutterWidth={splitGutterWidth}
                        showLineNumbers={diffShowLineNumbers}
                        theme={theme}
                        selectionColors={selectionColors}
                      />
                      {isHovered ? (
                        <box
                          id={`diff-note-add:${card.key}:${rowIndex}`}
                          width={1}
                          onMouseUp={(event) => {
                            event.stopPropagation()
                            currentSelectionRange && openDiffNote(currentSelectionRange, card.key)
                          }}
                        >
                          <text fg={theme.cyan} bg={theme.surface3} wrapMode="none">+</text>
                        </box>
                      ) : noteCards.length > 0 ? (
                        <text fg={theme.violet} wrapMode="none">{'●'}</text>
                      ) : (
                        <text fg={isSelectedDiffRow ? theme.cyan : theme.border} wrapMode="none">{isSelectedDiffRow ? '▶' : '│'}</text>
                      )}
                      <SplitDiffSide
                        side={row.right}
                        width={splitRightWidth}
                        gutterWidth={splitGutterWidth}
                        showLineNumbers={diffShowLineNumbers}
                        theme={theme}
                        selectionColors={selectionColors}
                      />
                    </box>
                    {hasDraft && diffDraft ? renderTranscriptDiffNoteDraft(diffDraft, bodyInnerWidth, theme) : null}
                    {noteCards.map(({ key, note, label }) => (
                      <React.Fragment key={key}>
                        {renderTranscriptDiffNoteCard(
                          note,
                          bodyInnerWidth,
                          theme,
                          label,
                          () => sendDiffNoteToComposer(card, note, label, diffTextForComposer),
                        )}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                )
              }} />
              {hiddenDiffRows > 0 ? (
                <text fg={theme.dim} selectable {...selectionColors}>
                  {fitText(`... ${hiddenDiffRows} more diff lines`, bodyInnerWidth)}
                </text>
              ) : null}
              {diffFooterSegments ? (
                <box marginTop={1}>
                  <text fg={theme.cyan} selectable {...selectionColors}>
                    {renderInlineTextSegments(diffFooterSegments, bodyInnerWidth, theme.dim)}
                  </text>
                </box>
              ) : null}
            </box>
          ) : null}
          {isThinkingCard ? (
            <box paddingX={1} marginTop={bodyLines.length > 0 ? 1 : 0}>
              <text fg={thinkingMode ? theme.cyan : theme.dim}>
                {thinkingMode ? '✦ thinking shown · T to hide' : '✦ thinking hidden · T to show'}
              </text>
            </box>
          ) : null}
        </box>
      </box>
    </box>
  )
}

export const TranscriptCard = React.memo(function TranscriptCardWithImages(props: TranscriptCardProps) {
  if (!props.card.images?.length) return <TranscriptCardInner {...props} />
  return <box id={`card:${props.card.key}`} flexDirection="column" flexShrink={0}>
    <TranscriptCardInner {...props} />
    <TranscriptImages sources={props.card.images} width={Math.max(1, props.rightPaneWidth - 8)} muted={props.theme.muted} />
  </box>
})

export type TranscriptCardSelectionVariants = {
  cardKey: string
  idle: React.ReactNode
  selected: React.ReactNode
  focused: React.ReactNode
}

export type TranscriptCardVariantProps = Omit<TranscriptCardProps, 'hasCursor' | 'isSelected'>
export type TranscriptCardVariantCacheEntry = {
  props: TranscriptCardVariantProps
  variants: TranscriptCardSelectionVariants
}

export function makeTranscriptCardSelectionVariants(
  props: TranscriptCardVariantProps,
): TranscriptCardSelectionVariants {
  const render = (hasCursor: boolean, isSelected: boolean) => (
    <TranscriptCard
      key={props.card.key}
      {...props}
      hasCursor={hasCursor}
      isSelected={isSelected}
    />
  )
  return new CardSelectionVariants(props.card.key, render)
}

export function transcriptCardVariantPropsEqual(
  left: TranscriptCardVariantProps,
  right: TranscriptCardVariantProps,
): boolean {
  if (left === right) return true
  // This runs once per mounted card on every root render. Avoid allocating two
  // key arrays per card just to compare the stable prop object we cache in the
  // WeakMap. The props are object literals, so own-key iteration is equivalent
  // while keeping the hot path allocation-free.
  let keyCount = 0
  for (const key in left) {
    if (!Object.prototype.hasOwnProperty.call(left, key)) continue
    keyCount += 1
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!Object.is(left[key as keyof TranscriptCardVariantProps], right[key as keyof TranscriptCardVariantProps])) return false
  }
  let rightKeyCount = 0
  for (const key in right) {
    if (Object.prototype.hasOwnProperty.call(right, key)) rightKeyCount += 1
  }
  return keyCount === rightKeyCount
}

export function cachedTranscriptCardSelectionVariants(
  cache: WeakMap<TuiTranscriptCard, TranscriptCardVariantCacheEntry>,
  props: TranscriptCardVariantProps,
): TranscriptCardSelectionVariants {
  const previous = cache.get(props.card)
  if (previous && transcriptCardVariantPropsEqual(previous.props, props)) return previous.variants
  const variants = makeTranscriptCardSelectionVariants(props)
  cache.set(props.card, { props, variants })
  return variants
}

// Cursor movement used to rebuild a fresh React element for every mounted
// card, even though React.memo ultimately rendered only the old and new
// selection. Reuse the exact cached element for every unchanged card so
// React can skip reconciliation by identity. The chosen TranscriptCard and
// its props are identical to the previous implementation; this adds no
// wrapper or native node and cannot change card geometry or scroll offsets.
export function selectTranscriptCardVariants<T extends TranscriptCardSelectionVariants>(
  variants: readonly T[],
  cursorKey: string | null,
  focused: boolean,
): React.ReactNode[] {
  return variants.map((variant) => variant.cardKey === cursorKey
    ? focused ? variant.focused : variant.selected
    : variant.idle)
}
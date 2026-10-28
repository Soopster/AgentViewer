import { type ScrollBoxRenderable, type Renderable, TextAttributes } from '@opentui/core'
import type { TuiTranscriptWidth } from '../../../lib/tuiState'
import { mergeFileEditStats } from '../../../lib/turnEditStats'
import type { ProviderSelection } from '../../../lib/types'
import type { TuiTranscriptCard, TuiTranscriptCardLine, TuiTranscriptCodeBlock } from '../../format'
import type { TuiTranscriptView, TuiThemePalette } from '../../theme'
import { extractDiffText, PIERRE_DIFF_CACHE } from './diffCache'
import type { InlineTextSegment } from './inlineText'
import { formatTimeGap } from './liveStream'
import { readerRowCard } from './readerRows'
import { MAX_CODE_BLOCK_RENDER_LINES, MAX_MARKDOWN_SYNTAX_CHARS } from './timing'
import { turnSummaryText, EMPTY_LANDMARKS, transcriptToolColor, streamToolCardMarker, streamStatusColor, toolNameFromTranscriptLine, transcriptColor, streamToolGroupMarker, transcriptAccent } from './transcriptStyle'
import type { CardLandmark, AgentToolGroupCard, CardDisplayData } from './types'
import { type TuiPierreDiffView, buildPierreDiffView } from '../pierreDiffView'
import { joinMeta } from '../textLayout'

// A turn the CLI re-ran after a worker restart. It is a property of the message,
// not a position in the list, so it belongs in the card's header meta rather than
// among the landmarks — and without it the re-run's reply reads as the same turn
// answered twice. Shares `formatResumeReason`'s open-ended handling: the host's
// own reason is shown when it set one, 'interrupted_turn' reads as a bare re-run.
function resumeReasonMeta(reason: string | undefined): string | null {
  if (!reason) return null
  return reason === 'interrupted_turn' ? 're-run' : `re-run: ${reason.replace(/_/g, ' ')}`
}
function landmarksEqual(a: CardLandmark[], b: CardLandmark[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind || a[i].text !== b[i].text || a[i].promptKey !== b[i].promptKey) return false
  }
  return true
}
export function computeAllLandmarks(
  cards: TuiTranscriptCard[],
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
  previous: CardLandmark[][] | null,
  streamMode: boolean,
  quietTurns = false): CardLandmark[][] {
  const result: CardLandmark[][] = new Array(cards.length)
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const prev = i > 0 ? cards[i - 1] : null
    let landmarks: CardLandmark[] | null = null

    if (streamMode
      && prev
      && (
        card.role === 'user'
        || (
          card.role === 'assistant'
          && (card.category === 'conversation' || card.category === 'insight')
          && (prev.category === 'technical' || prev.category === 'diff')
        )
      )) {
      landmarks = landmarks ?? []
      let text = ''
      let promptKey: string | undefined
      if (card.role === 'user') {
        for (let turnIndex = i - 1; turnIndex >= 0; turnIndex -= 1) {
          const turnCard = cards[turnIndex]
          if (turnCard.role !== 'user') continue
          const elapsedMs = prev.timestampMs != null && turnCard.timestampMs != null && prev.timestampMs >= turnCard.timestampMs
            ? prev.timestampMs - turnCard.timestampMs
            : null
          text = turnSummaryText(cards, turnIndex, i, elapsedMs) ?? ''
          if (text) promptKey = turnCard.key
          break
        }
      }
      // SCROLLBACK keeps a rule only where it carries the turn's summary; a
      // full-width line between a tool row and the reply after it is chrome.
      landmarks.push(promptKey ? { kind: 'turn', text, promptKey } : { kind: quietTurns && !text ? 'break' : 'turn', text })
    }

    if (i === resumeMarkerIndex) {
      landmarks = landmarks ?? []
      landmarks.push({ kind: 'resume', text: 'LAST READ POSITION' })
    }

    if (i === unreadBoundaryIndex && pendingNewCount > 0) {
      landmarks = landmarks ?? []
      landmarks.push({
        kind: 'unread',
        text: `NEW SINCE LAST READ  ${pendingNewCount} message${pendingNewCount === 1 ? '' : 's'}`,
      })
    }

    if (!prev || prev.dayKey !== card.dayKey) {
      if (card.dayLabel) {
        landmarks = landmarks ?? []
        landmarks.push({ kind: 'day', text: card.dayLabel.toUpperCase() })
      }
    } else if (card.timestampMs != null && prev.timestampMs != null) {
      const gap = formatTimeGap(card.timestampMs - prev.timestampMs)
      if (gap) {
        landmarks = landmarks ?? []
        landmarks.push({ kind: 'gap', text: gap.toUpperCase() })
      }
    }

    const next = landmarks ?? EMPTY_LANDMARKS
    const prevEntry = previous?.[i]
    result[i] = prevEntry && landmarksEqual(prevEntry, next) ? prevEntry : next
  }
  return result
}
function transcriptLandmarks(
  cards: TuiTranscriptCard[],
  index: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number
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
export function renderedBodyLines(
  card: TuiTranscriptCard,
  isExpanded: boolean,
  previewLimit: number,
  thinkingFull: boolean = false,
  agentsMode: boolean = false,
  fullText: boolean = false): TuiTranscriptCardLine[] {
  if (agentsMode && (card.key.startsWith('agents-tools:') || isAgentsToolOnlyCard(card))) {
    return agentsToolCollapsedLines(card)
  }

  const useExpandedLines = isExpanded || thinkingFull || fullText
  const source = useExpandedLines ? card.expandedLines : card.lines
  let base: TuiTranscriptCardLine[]
  if (useExpandedLines) {
    // Parsed diff rows own expanded patches in every transcript view. Keeping
    // the raw diff lines here would render the same patch once as body prose
    // and again in the interactive diff immediately below it.
    base = source.filter((line) => !['diff_add', 'diff_remove', 'diff_meta'].includes(line.tone))
  } else if (card.category === 'diff') {
    // Keep diff_meta (file path header) but strip raw diff lines — Pierre renders those
    base = source.filter((line) => line.tone !== 'diff_add' && line.tone !== 'diff_remove')
  } else {
    base = source.slice(0, previewLimit)
  }
  if (base.length > 0) return base
  // A thinking card with thinking hidden has nothing to show here — the
  // thinking-mode hint rendered beneath already explains the empty state, so the
  // "No visible content" placeholder is pure noise (and it stacked up on every
  // hidden-thinking turn). Suppress it for thinking cards; keep it elsewhere so a
  // genuinely empty non-thinking card still says something. Both cardHeight and
  // the renderer call this, so the row count stays in lockstep.
  const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
  return isThinkingCard ? [] : [{ text: 'No visible content', tone: 'dim' }]
}
function isAgentsToolOnlyCard(card: TuiTranscriptCard): boolean {
  // Provider mappers do not all express operations with a `tool`-tone header:
  // command output, task notifications, agent results, and some MCP events can
  // arrive as result/agent/dim lines. Category classification is the canonical
  // cross-provider signal, so group every operational or diff card and keep
  // prose/insight/system cards as natural group boundaries.
  return card.category === 'technical' || card.category === 'diff'
}
function agentsToolCollapsedLines(card: TuiTranscriptCard): TuiTranscriptCardLine[] {
  const summary = agentsToolSummaryLine(card)
  if (card.lines.length === 0) return [summary]
  const toolIndex = card.lines.findIndex((line) => line.tone === 'tool')
  if (toolIndex === -1) return [summary, ...card.lines]
  if (card.lines[toolIndex]?.text === summary.text) return card.lines
  const lines = card.lines.slice()
  lines[toolIndex] = summary
  return lines
}
export function agentsToolSummaryLine(card: TuiTranscriptCard): TuiTranscriptCardLine {
  const toolLine = card.lines.find((line) => line.tone === 'tool')
    ?? card.expandedLines.find((line) => line.tone === 'tool')
    ?? card.expandedLines[0]
    ?? card.lines[0]
  const fallback = toolLine ?? { text: 'tool call', tone: 'tool' as const }
  return enrichAgentsFileChangeSummary(card, fallback)
}
function enrichAgentsFileChangeSummary(card: TuiTranscriptCard, line: TuiTranscriptCardLine): TuiTranscriptCardLine {
  if (line.tone !== 'tool' || !/^tool\s+FileChange:/i.test(line.text.trim())) return line
  const metadata = fileChangeSummaryMetadata(card)
  if (!metadata) return line

  const label = line.text.replace(/^tool\s+FileChange:\s*/i, '').trim()
  const genericLabel = /^\d+\s+file\s+changes?$/i.test(label) || label.toLowerCase() === 'file change'
  const detail = genericLabel
    ? metadata
    : mergeFileChangeSummaryLabel(label, metadata)
  return { ...line, text: `tool FileChange: ${detail}` }
}
function mergeFileChangeSummaryLabel(label: string, metadata: string): string {
  if (!label) return metadata
  if (metadata === label || metadata.startsWith(`${label} `) || metadata.startsWith(`${label} ·`)) return metadata
  return `${label} · ${metadata}`
}
function fileChangeSummaryMetadata(card: TuiTranscriptCard): string | null {
  const diffText = cardDiffText(card, true)
  const metaPath = filePathFromDiffText(diffText, diffMetaFilePath(card) ?? '')
  const pathLabel = metaPath ? compactPathTail(metaPath, 2) : ''
  const hunkLabel = firstDiffHunkLabel(diffText)
  const statsLabel = diffStatsLabel(diffText, card.expandedLines)
  const parts = [pathLabel, hunkLabel, statsLabel].filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join(' ') : null
}
export function diffMetaFilePath(card: TuiTranscriptCard): string | null {
  for (const line of card.expandedLines) {
    if (line.tone !== 'diff_meta') continue
    const match = line.text.match(/^(?:FILE CHANGE|CREATE|UPDATE|DELETE|MODIFY|RENAME|MOVE)\s+(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }
  return null
}
function compactPathTail(value: string, segmentCount: number): string {
  const cleaned = value.trim().replace(/\\/g, '/')
  if (!cleaned) return ''
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length <= segmentCount) return parts.join('/') || cleaned
  return parts.slice(-segmentCount).join('/')
}
function firstDiffHunkLabel(diffText: string | null): string {
  if (!diffText) return ''
  const hunk = diffText.split('\n').find((line) => line.startsWith('@@ '))
  const match = hunk?.match(/\+(\d+)/)
  return match?.[1] ? `@${match[1]}` : ''
}
function diffStatsLabel(diffText: string | null, fallbackLines: TuiTranscriptCardLine[]): string {
  let additions = 0
  let deletions = 0
  if (diffText) {
    for (const line of diffText.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
    }
  } else {
    additions = fallbackLines.filter((line) => line.tone === 'diff_add').length
    deletions = fallbackLines.filter((line) => line.tone === 'diff_remove').length
  }
  return additions > 0 || deletions > 0 ? `+${additions} -${deletions}` : ''
}
// A stream "ghost" card renders nothing (or only the "No visible content"
// placeholder) in Stream view: no real body lines, no markdown, no code, no
// diff. TranscriptCard already collapses these to zero height via
// streamHasBody; filtering them out of the visible list as well keeps them
// from remaining as invisible j/k cursor stops.
export function isStreamGhostCard(card: TuiTranscriptCard): boolean {
  if (card.key.startsWith('agents-tools:')) return false
  if (card.codeBlocks?.length) return false
  if (card.editDiff) return false
  if (card.markdownContent && card.markdownContent.trim().length > 0) return false
  const hasRealLine = (lines: TuiTranscriptCardLine[]) => lines.some((line) => {
    const text = line.text.trim()
    return text.length > 0 && text !== 'No visible content'
  })
  return !hasRealLine(card.lines) && !hasRealLine(card.expandedLines)
}
function groupToolCards(
  cards: TuiTranscriptCard[],
  shouldGroup: (card: TuiTranscriptCard) => boolean
): TuiTranscriptCard[] {
  const grouped: TuiTranscriptCard[] = []
  let pending: TuiTranscriptCard[] = []

  const flush = () => {
    if (pending.length === 0) return
    if (pending.length === 1) {
      grouped.push(pending[0])
      pending = []
      return
    }

    const first = pending[0]
    const last = pending[pending.length - 1]
    const lines = pending.map(agentsToolSummaryLine)
    const searchText = pending.map((card) => card.searchText).join('\n')
    const groupCard: AgentToolGroupCard = {
      ...first,
      key: `agents-tools:${first.key}:${last.key}:${pending.length}`,
      agentToolCards: pending,
      label: `${pending.length} tool ${pending.length === 1 ? 'call' : 'calls'}`,
      category: 'technical',
      autoFold: true,
      compactSummary: lines.map((line) => line.text).join(' · '),
      lines,
      expandedLines: lines,
      searchText,
      searchHaystackLower: `${pending.map((card) => card.label).join('\n')}\n${searchText}`.toLowerCase(),
      codeBlocks: undefined,
      editDiff: undefined,
      markdownContent: undefined,
      hasMermaidDiagrams: false,
      fileEdits: pending.some((card) => card.fileEdits) ? mergeFileEditStats(pending.map((card) => card.fileEdits)) : undefined,
    }
    grouped.push(groupCard)
    pending = []
  }

  for (const card of cards) {
    if (shouldGroup(card)) {
      pending.push(card)
    } else {
      flush()
      grouped.push(card)
    }
  }
  flush()
  return grouped
}
function groupAgentsToolCards(cards: TuiTranscriptCard[]): TuiTranscriptCard[] {
  return groupToolCards(cards, isAgentsToolOnlyCard)
}
export function groupStreamToolCards(cards: TuiTranscriptCard[]): TuiTranscriptCard[] {
  // Keep file edits as standalone stream events so repeated updates retain
  // their own compact excerpt. Routine technical calls still collapse into a
  // single Claude-style activity narration row.
  return groupToolCards(cards, (card) => card.category === 'technical')
}
export function visibleCardsForTranscriptView(cards: TuiTranscriptCard[], view: TuiTranscriptView): TuiTranscriptCard[] {
  if (view === 'continue') return cards.filter(card => !card.autoFold)
  if (view === 'agents') return groupAgentsToolCards(cards)
  if (view === 'stream' || view === 'chat' || view === 'transcript' || view === 'scrollback'
    || view === 'codex' || view === 'claude-code' || view === 'copilot' || view === 'opencode') {
    return groupStreamToolCards(cards.filter(card => card.category !== 'system')).filter(card => !isStreamGhostCard(card))
  }
  return cards
}
function isStreamOperationalCard(card: TuiTranscriptCard): boolean {
  return card.key.startsWith('agents-tools:') || card.category === 'technical'
}
// Agents view uses one consistent card language for prose, standalone tools,
// and grouped tools. Stream keeps that treatment only for operational rows.
// Keeping this decision shared between body preparation and element creation
// prevents a single tool from receiving grouped lines but a native wrapper (or
// vice versa).

export function usesAgentCardPresentation(
  card: TuiTranscriptCard,
  transcriptView: TuiTranscriptView
): boolean {
  return transcriptView === 'agents'
    || ((transcriptView === 'stream' || transcriptView === 'chat' || transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || transcriptView === 'copilot' || transcriptView === 'opencode') && isStreamOperationalCard(card))
}

export function shouldCenterTranscriptCard(
  card: TuiTranscriptCard,
  transcriptWidth: TuiTranscriptWidth,
  agentsMode: boolean
): boolean {
  return transcriptWidth === 'centered'
    && (card.category !== 'diff' || agentsMode)
}
export function agentToolCardsFor(card: TuiTranscriptCard): TuiTranscriptCard[] {
  const grouped = (card as AgentToolGroupCard).agentToolCards
  if (grouped && grouped.length > 0) return grouped
  return isAgentsToolOnlyCard(card) ? [card] : []
}
// A card's expansion is its view's default — technical cards fold in the
// conversation, agents and stream views — overridden per card: `expanded`
// opens a folding card, `collapsed` closes any other.
export function cardFoldsByDefault(card: TuiTranscriptCard, transcriptView: TuiTranscriptView, chatLike: boolean, foldAll = false): boolean {
  if (foldAll) return true
  return (transcriptView === 'conversation' || chatLike || transcriptView === 'agents') && Boolean(card.autoFold)
}
export function resolveExpandedCardKeys(
  cards: TuiTranscriptCard[], transcriptView: TuiTranscriptView, chatLike: boolean,
  expanded: ReadonlySet<string>, collapsed: ReadonlySet<string>, foldAll = false): Set<string> {
  const next = new Set<string>()
  for (const card of cards) {
    if (cardFoldsByDefault(card, transcriptView, chatLike, foldAll) ? expanded.has(card.key) : !collapsed.has(card.key)) next.add(card.key)
  }
  return next
}
// SCROLLBACK parks its invisible cursor on what the viewport shows, so a jump
// starts from the screen: the cursor itself while still visible, else the
// first message the viewport reaches.
export function scrollbackParkedCursorKey(sb: ScrollBoxRenderable, scrollTop: number, cursorKey: string | null): string | null {
  const viewportBottom = scrollTop + sb.viewport.height
  const cursorId = cursorKey ? `card:${cursorKey}` : null
  let topKey: string | null = null
  for (const row of sb.content.getChildren()) {
    const child = readerRowCard(row as Renderable)
    if (!child || child.height === 0) continue
    const top = child.y - sb.content.y
    if (top >= viewportBottom) break
    if (top + child.height <= scrollTop) continue
    // A cursor still on screen stays put: moving it to the top on every poll
    // would walk it backwards off the card a jump just landed on.
    if (child.id === cursorId) return cursorKey
    topKey ??= child.id.slice('card:'.length)
  }
  return topKey
}
export function agentToolCardIsExpanded(
  card: TuiTranscriptCard,
  expandedKeys: ReadonlySet<string>,
  collapsedKeys: ReadonlySet<string>): boolean {
  return card.autoFold ? expandedKeys.has(card.key) : !collapsedKeys.has(card.key)
}
// A Coordinator call's header is `coordinator verb[ → who][ · qualifier…]  said`
// (`coordinatorHeader` in tui/format.ts). Colour follows what the reader scans
// for: who it went to, which task, whether it obliges a reply — and the quoted
// words last and quietest, since the transcript around it already has them.
const COORDINATOR_BAD = /\b(fail(?:ed)?|reject(?:ed)?|denied|not accepted|interrupt|leave|cut short|stale|dead|stalled|timeout)\b/i
const COORDINATOR_OWED = /\b(owed|reply required|urgent|unread|to review|blocked|overlaps?|unresolved|needs reply|claimable)\b/i
const COORDINATOR_GOOD = /\b(accepted|sent|done|granted|claimed|created|completed|approve|complete|finalize|all tasks finished|queued)\b/i
function coordinatorPartColor(part: string, theme: TuiThemePalette, fallback: string): string {
  return COORDINATOR_BAD.test(part) ? theme.red
    : COORDINATOR_OWED.test(part) ? theme.amber
      : COORDINATOR_GOOD.test(part) ? theme.green
        : fallback
}
function coordinatorWordSegments(text: string, theme: TuiThemePalette, fg: string, bold = false): InlineTextSegment[] {
  // Names after an arrow and task ids are what a row is about.
  return text.split(/(→ \S+|\btask-[\w-]+)/).filter(Boolean).map((piece) => (
    /^→ |^task-/.test(piece)
      ? { text: piece, fg: theme.cyan, attributes: TextAttributes.BOLD }
      : { text: piece, fg, attributes: bold ? TextAttributes.BOLD : undefined }
  ))
}
function coordinatorHeaderSegments(cleaned: string, theme: TuiThemePalette, emphasizeName: boolean): InlineTextSegment[] {
  const rest = cleaned.slice('coordinator '.length)
  const cut = rest.indexOf('  ')
  const [verb = '', ...qualifiers] = (cut >= 0 ? rest.slice(0, cut) : rest).split(' · ')
  const said = cut >= 0 ? rest.slice(cut).trim() : ''
  return [
    { text: '⇄ ', fg: theme.violet },
    ...coordinatorWordSegments(verb, theme, coordinatorPartColor(verb, theme, theme.text), emphasizeName),
    ...qualifiers.flatMap((part) => [
      { text: ' · ', fg: theme.dim },
      ...coordinatorWordSegments(part, theme, coordinatorPartColor(part, theme, theme.muted)),
    ]),
    ...(said ? [{ text: `  ${said}`, fg: theme.muted }] : []),
  ]
}
/** The result row under a Coordinator call: `✓ part · part  said`, each part in the colour of what it means. */
export function coordinatorResultSegments(text: string, theme: TuiThemePalette): InlineTextSegment[] {
  const failed = text.startsWith('✗')
  const body = text.replace(/^[✓✗]\s*/, '')
  const cut = body.indexOf('  ')
  const parts = (cut >= 0 ? body.slice(0, cut) : body).split(' · ')
  const said = cut >= 0 ? body.slice(cut).trim() : ''
  return [
    { text: failed ? '✗ ' : '✓ ', fg: failed ? theme.red : theme.green },
    ...parts.flatMap((part, index) => [
      ...(index > 0 ? [{ text: ' · ', fg: theme.dim }] : []),
      ...coordinatorWordSegments(part, theme, failed && index === 0 ? theme.red : coordinatorPartColor(part, theme, theme.muted)),
    ]),
    ...(said ? [{ text: `  ${said}`, fg: failed ? theme.text : theme.muted }] : []),
  ]
}
export function transcriptToolLineSegments(
  text: string,
  theme: TuiThemePalette,
  marker = 'tool ',
  markerColor = theme.dim,
  emphasizeName = false): InlineTextSegment[] {
  const cleaned = text.replace(/^tool\s+/i, '').trim()
  if (cleaned.startsWith('coordinator ')) return [{ text: marker, fg: markerColor }, ...coordinatorHeaderSegments(cleaned, theme, emphasizeName)]
  const colon = cleaned.indexOf(':')
  const name = colon >= 0
    ? cleaned.slice(0, colon).trim()
    : cleaned.split(/\s+/, 1)[0] || cleaned
  const detail = colon >= 0
    ? cleaned.slice(colon + 1).trim()
    : cleaned.slice(name.length).trim()
  if (name.toLowerCase() === 'bash' && detail) {
    return [
      { text: marker, fg: markerColor },
      { text: name, fg: transcriptToolColor(name, theme), attributes: emphasizeName ? TextAttributes.BOLD : undefined },
      { text: ' ', fg: theme.dim },
      ...bashCommandSegments(detail, theme),
    ]
  }
  return [
    { text: marker, fg: markerColor },
    { text: name || 'tool', fg: transcriptToolColor(name, theme), attributes: emphasizeName ? TextAttributes.BOLD : undefined },
    ...(detail ? [{ text: ` ${detail}`, fg: theme.dim }] : []),
  ]
}
function streamDiffOperationLabel(card: TuiTranscriptCard): string | null {
  if (card.category !== 'diff') return null
  const diffText = cardDiffText(card, false)
  const path = filePathFromDiffText(diffText, diffMetaFilePath(card) ?? card.label)
  if (!path) return null
  let operation = 'Update'
  if (diffText?.includes('--- /dev/null')) operation = 'Create'
  else if (diffText?.includes('+++ /dev/null')) operation = 'Delete'
  else {
    const toolName = streamToolSummaryName(card)
    if (toolName === 'write') operation = 'Create'
  }
  return `${operation}(${path})`
}
export function streamToolSummarySegments(card: TuiTranscriptCard, theme: TuiThemePalette): InlineTextSegment[] {
  const summary = agentsToolSummaryLine(card)
  const marker = streamToolCardMarker(card)
  const markerColor = streamStatusColor(marker, theme)
  const diffLabel = streamDiffOperationLabel(card)
  if (diffLabel) {
    return [
      { text: `${marker} `, fg: markerColor },
      { text: diffLabel, fg: theme.text, attributes: TextAttributes.BOLD },
    ]
  }
  if (summary.tone === 'tool') {
    const cleaned = summary.text.replace(/^tool\s+/i, '').trim()
    const colon = cleaned.indexOf(':')
    const name = colon >= 0 ? cleaned.slice(0, colon).trim() : toolNameFromTranscriptLine(summary.text)
    const detail = colon >= 0 ? cleaned.slice(colon + 1).trim() : ''
    if (name.toLowerCase() === 'bash') {
      return [
        { text: `${marker} `, fg: markerColor },
        { text: 'Ran', fg: transcriptToolColor('bash', theme), attributes: TextAttributes.BOLD },
        ...(detail ? [{ text: ' ', fg: theme.dim }, ...bashCommandSegments(detail, theme)] : []),
      ]
    }
    return transcriptToolLineSegments(summary.text, theme, `${marker} `, markerColor, true)
  }
  return [
    { text: `${marker} `, fg: markerColor },
    { text: summary.text, fg: transcriptColor(summary, theme) },
  ]
}
export function stickyPromptText(card: TuiTranscriptCard): string {
  const text = card.lines.map((line) => line.text.trim()).filter(Boolean).join(' ')
  return (text || card.compactSummary).replace(/\s+/g, ' ').trim()
}
export function streamToolSummaryName(card: TuiTranscriptCard): string {
  const summary = agentsToolSummaryLine(card)
  return summary.tone === 'tool' ? toolNameFromTranscriptLine(summary.text).toLowerCase() : ''
}
export function isStreamActivityToolCard(card: TuiTranscriptCard): boolean {
  const name = streamToolSummaryName(card)
  return name === 'bash' || name === 'grep' || name === 'glob' || name === 'read'
}
export function streamActivitySummarySegments(cards: TuiTranscriptCard[], theme: TuiThemePalette): InlineTextSegment[] | null {
  let shellCount = 0
  let searchCount = 0
  let readCount = 0
  const activityCards: TuiTranscriptCard[] = []
  for (const card of cards) {
    const name = streamToolSummaryName(card)
    if (name === 'bash') shellCount += 1
    else if (name === 'grep' || name === 'glob') searchCount += 1
    else if (name === 'read') readCount += 1
    else continue
    activityCards.push(card)
  }
  if (activityCards.length === 0) return null
  const marker = streamToolGroupMarker(activityCards)
  const segments: InlineTextSegment[] = [
    { text: `${marker} `, fg: streamStatusColor(marker, theme) },
    { text: 'Activity', fg: theme.text, attributes: TextAttributes.BOLD },
  ]
  const appendCount = (detail: string) => {
    if (segments.length > 1) segments.push({ text: '  ·  ', fg: theme.dim })
    segments.push({ text: detail, fg: theme.dim })
  }
  if (readCount > 0) appendCount(`${readCount} ${readCount === 1 ? 'file' : 'files'}`)
  if (searchCount > 0) appendCount(`${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`)
  if (shellCount > 0) appendCount(`${shellCount} shell ${shellCount === 1 ? 'command' : 'commands'}`)
  return segments
}
export function streamToolDetailLine(card: TuiTranscriptCard): TuiTranscriptCardLine | null {
  const summaryText = agentsToolSummaryLine(card).text.trim()
  const seen = new Set<string>()
  const lines = [...card.lines, ...card.expandedLines]
  const orderedLines = streamToolSummaryName(card) === 'bash'
    ? [
      ...lines.filter((line) => line.tone === 'muted'),
      ...lines.filter((line) => line.tone !== 'muted'),
    ]
    : lines
  for (const line of orderedLines) {
    const text = line.text.trim()
    if (!text || text === summaryText || text === 'No visible content' || seen.has(text)) continue
    seen.add(text)
    if (line.tone === 'tool' || line.tone === 'diff_add' || line.tone === 'diff_remove') continue
    if (/^[└├│─\s]+$/.test(text) || /^[✓✔]️?\s*(?:OK|done|sent)?$/i.test(text)) continue
    return line
  }
  return null
}
function bashCommandSegments(detail: string, theme: TuiThemePalette): InlineTextSegment[] {
  let command = detail.replace(/^\$\s*/, '').trim()
  const launcher = command.match(/^(?:\/[^\s]+\/)?(?:zsh|bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/)
  if (launcher?.[2]) command = launcher[2]

  const parts = command.split(/(\s+|&&|\|\||[|;])/).filter(Boolean)
  let expectsCommand = true
  return parts.map((part): InlineTextSegment => {
    if (/^\s+$/.test(part)) return { text: part, fg: theme.dim }
    if (part === '&&' || part === '||' || part === '|' || part === ';') {
      expectsCommand = true
      return { text: part, fg: theme.pink }
    }
    if (expectsCommand) {
      expectsCommand = false
      return { text: part, fg: theme.green }
    }
    if (/^-{1,2}[A-Za-z0-9]/.test(part)) return { text: part, fg: theme.amber }
    if (/^(?:\.?\.?\/|~\/|\/)/.test(part)) return { text: part, fg: theme.cyan }
    if (/^(['"`]).*\1$/.test(part)) return { text: part, fg: theme.text }
    return { text: part, fg: theme.muted }
  })
}
export function nestedAgentToolDisplay(
  card: TuiTranscriptCard,
  provider: ProviderSelection | undefined,
  isExpanded: boolean,
  bodyLineLimit: number,
  syntaxEnabled: boolean,
  thinkingMode: boolean): CardDisplayData {
  const providerKey = card.provider ?? provider
  const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
  const isInsight = card.category === 'insight'
  const isTechnical = card.category === 'technical'
  const isDiff = card.category === 'diff'
  const isSystem = card.category === 'system'
  return {
    landmarks: EMPTY_LANDMARKS,
    bodyLines: renderedBodyLines(card, isExpanded, bodyLineLimit, thinkingMode && isThinkingCard, false),
    diffView: cardDiffView(card, isExpanded),
    codeBlockLineCounts: isExpanded && card.codeBlocks
      ? card.codeBlocks.map((cb) => countCodeBlockLines(cb.content))
      : [],
    headerMeta: joinMeta([card.timestamp ?? null, resumeReasonMeta(card.resumeReason)]),
    accent: transcriptAccent(card.role, providerKey),
    isThinkingCard,
    categoryEmoji: isInsight ? '✦ ' : isTechnical ? '⚒ ' : isDiff ? '✎ ' : isSystem ? '⚙ ' : '',
    isInsight,
    markdownFallbackLines: isExpanded && card.markdownContent && !card.hasMermaidDiagrams && !syntaxEnabled
      ? card.markdownContent.split('\n')
      : null,
  }
}
export function cardDiffText(card: TuiTranscriptCard, isExpanded: boolean): string | null {
  if (card.category !== 'diff' && !isExpanded) return null
  return card.editDiff ?? extractDiffText(card.expandedLines)
}
export function filePathFromDiffText(diffText: string | null, fallback: string): string {
  if (!diffText) return fallback
  const lines = diffText.split('\n')
  for (const line of lines) {
    if (line.startsWith('+++ b/')) return line.slice(6).trim()
    if (line.startsWith('--- a/')) return line.slice(6).trim()
  }
  const fileHeader = lines.find((line) => line.startsWith('diff --git '))
  if (fileHeader) {
    const match = fileHeader.match(/\sb\/(.+)$/)
    if (match?.[1]) return match[1].trim()
  }
  return fallback
}
export function cardDiffView(card: TuiTranscriptCard, isExpanded: boolean): TuiPierreDiffView | null {
  const cached = PIERRE_DIFF_CACHE.get(card)
  if (cached && cached.isExpanded === isExpanded) return cached.value

  const diffText = cardDiffText(card, isExpanded)
  const value = diffText ? buildPierreDiffView(diffText, card.key) : null
  PIERRE_DIFF_CACHE.set(card, { isExpanded, value })
  return value
}
function cardDiffRows(card: TuiTranscriptCard, isExpanded: boolean, previewLimit: number): number {
  const diffView = cardDiffView(card, isExpanded)
  if (!diffView) return 0
  const visibleRows = isExpanded ? diffView.rows.length : Math.min(previewLimit, diffView.rows.length)
  const hiddenSummaryRows = visibleRows < diffView.rows.length ? 1 : 0
  return visibleRows + hiddenSummaryRows + 1
}
function codeBlockRows(card: TuiTranscriptCard, isExpanded: boolean): number {
  if (!isExpanded || !card.codeBlocks?.length) return 0
  return card.codeBlocks.reduce((sum, cb) => {
    const lineCount = countCodeBlockLines(cb.content)
    const renderHeight = codeBlockHeight(cb, lineCount)
    const footerRows = codeBlockHiddenLineCount(lineCount, renderHeight) > 0 ? 1 : 0
    return sum + 1 + renderHeight + footerRows + 1
  }, 0)
}
export function countCodeBlockLines(content: string): number {
  if (!content) return 0
  let count = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++
  }
  return count
}
export function codeBlockHeight(block: TuiTranscriptCodeBlock, lineCount: number): number {
  if (block.maxVisibleLines != null) return Math.min(lineCount, block.maxVisibleLines)
  if (block.lineNumbers) return Math.min(lineCount, MAX_CODE_BLOCK_RENDER_LINES)
  return Math.min(lineCount + 1, 20)
}
export function codeBlockHiddenLineCount(lineCount: number, renderHeight: number): number {
  return Math.max(lineCount - Math.min(lineCount, renderHeight), 0)
}
export function sliceCodeBlockLines(content: string, maxLines: number): string {
  if (maxLines <= 0 || !content) return ''
  let lines = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue
    if (lines >= maxLines) return content.slice(0, i)
    lines++
  }
  return content
}
export function canRenderMarkdownWithSyntax(content: string): boolean {
  // Structured blocks are partitioned off-thread, including documents beyond
  // the old whole-native-buffer guard. Keep the guard for unstructured prose.
  return content.length <= MAX_MARKDOWN_SYNTAX_CHARS
    || /(?:^|\n)[ \t]*(?:`{3,}|~{3,}|[-*+]\s|\d+[.)]\s|\|)|\|[^\n]*\|/.test(content)
}
export function codeBlockLabel(block: TuiTranscriptCodeBlock): string {
  if (block.filePath) return `${block.lang} · ${block.filePath}`
  return block.lang
}
// Collapsed system cards (session notices, thinking_tokens, init) carry no
// actionable body — only a label and timestamp. Rendering each in a full
// bordered box wastes ~4 rows of dead space apiece and visually shouts over
// the conversation. When folded we render them as a single quiet line; the
// full box returns on expand. Height math below must mirror that branch.
export function isCompactSystemCard(card: TuiTranscriptCard, isExpanded: boolean): boolean {
  return card.category === 'system' && !isExpanded
}
// Tail-follow normally owns the scroll position, so the outer cursor does not
// request a reveal there. Nested tool navigation is different: its parent card
// key stays fixed while the highlighted child moves, and that child still needs
// to be brought into view even when the group is the latest transcript card.

export function transcriptCursorScrollTargetKey(
  transcriptCursorKey: string | null,
  agentToolCursorKey: string | null,
  followTail: boolean
): string | null {
  if (agentToolCursorKey) return agentToolCursorKey
  return followTail ? null : transcriptCursorKey
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
  thinkingFullKeys: Set<string>
): number {
  const card = cards[index]
  const isExpanded = expandedKeys.has(card.key)
  if (isCompactSystemCard(card, isExpanded)) {
    const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
    return landmarkRows + 1 + cardGap
  }
  const thinkingFull = thinkingFullKeys.has(card.key)
  const useMarkdown = isExpanded && !!card.markdownContent && !card.hasMermaidDiagrams
  const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
  const bodyRows = useMarkdown ? 0 : renderedBodyLines(card, isExpanded, previewLimit, thinkingFull).length
  const diffRows = cardDiffRows(card, isExpanded, previewLimit)
  const codeRows = useMarkdown ? 0 : codeBlockRows(card, isExpanded)
  const mdRows = useMarkdown ? card.markdownContent!.split('\n').length : 0
  const diffFooterRows = card.category === 'diff' && cardDiffView(card, isExpanded) ? 1 : 0
  const borderRows = 2
  const bodyPaddingBottom = 1
  return landmarkRows + borderRows + bodyPaddingBottom + bodyRows + diffRows + diffFooterRows + codeRows + mdRows + cardGap
}

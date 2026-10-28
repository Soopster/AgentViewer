/** @jsxImportSource @opentui/react */
import { type NativeResourceOwner, SyntaxStyle, RGBA, type MouseEvent } from '@opentui/core'
import React from 'react'
import { formatFileEditSummary, mergeFileEditStats } from '../../../lib/turnEditStats'
import type { ProviderSelection } from '../../../lib/types'
import type { TuiTranscriptCard, TuiTranscriptCardLine } from '../../format'
import { type TuiDensity, type TuiThemePalette, THEME, getProviderAccent } from '../../theme'
import { formatElapsedClock } from './format'
import type { CardLandmark, AgentToolGroupCard } from './types'
import type { TuiPierreDiffRow, TuiSplitRowSide } from '../pierreDiffView'
import type { SelectionColors } from '../selectionTree'
import { fitText } from '../textLayout'

function findCardIndex(cards: TuiTranscriptCard[], key: string | null): number {
  if (!key) return -1
  return cards.findIndex((card) => card.key === key)
}
export function densityConfig(density: TuiDensity): {
  cardGap: number
  bodyIndent: number
  bodyLines: number
  headerRows: number
  bodyPad: number
  streamGap: number
  streamUserGap: number
} {
  switch (density) {
    // bodyPad is the trailing blank row inside each card. Comfortable keeps it
    // for breathing room; balanced/dense drop it so the bottom border hugs the
    // last line and the transcript packs tighter.
    // streamGap/streamUserGap are the Stream-view equivalents of cardGap: the
    // flat view packs assistant prose tight by default (gap only after user
    // prompts), comfortable opens a row after every card, dense drops them all.
    case 'comfortable':
      return { cardGap: 1, bodyIndent: 3, bodyLines: 6, headerRows: 2, bodyPad: 1, streamGap: 1, streamUserGap: 1 }
    case 'dense':
      return { cardGap: 0, bodyIndent: 1, bodyLines: 12, headerRows: 1, bodyPad: 0, streamGap: 0, streamUserGap: 0 }
    default:
      return { cardGap: 1, bodyIndent: 2, bodyLines: 8, headerRows: 2, bodyPad: 0, streamGap: 0, streamUserGap: 1 }
  }
}
function chooseSyntaxColor(theme: TuiThemePalette, preferred: string, fallbacks: string[]): string {
  const lowSignal = new Set([
    theme.text.toLowerCase(),
    theme.muted.toLowerCase(),
    theme.dim.toLowerCase(),
  ])
  if (!lowSignal.has(preferred.toLowerCase())) return preferred
  return fallbacks.find((color) => !lowSignal.has(color.toLowerCase())) ?? preferred
}
function parseHexRgb(color: string): { r: number; g: number; b: number}  | null {
  const hex = color.trim().replace(/^#/, '')
  if (hex.length === 3) {
    const [r, g, b] = hex.split('').map((part) => Number.parseInt(`${part}${part}`, 16))
    return [r, g, b].every(Number.isFinite) ? { r, g, b } : null
  }
  if (hex.length !== 6) return null
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return [r, g, b].every(Number.isFinite) ? { r, g, b } : null
}
function rgbToHex({ r, g, b }: { r: number; g: number; b: number} ): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
export function mixHexColor(accent: string, base: string, accentWeight: number): string | null {
  const accentRgb = parseHexRgb(accent)
  const baseRgb = parseHexRgb(base)
  if (!accentRgb || !baseRgb) return null
  const baseWeight = 1 - accentWeight
  return rgbToHex({
    r: accentRgb.r * accentWeight + baseRgb.r * baseWeight,
    g: accentRgb.g * accentWeight + baseRgb.g * baseWeight,
    b: accentRgb.b * accentWeight + baseRgb.b * baseWeight,
  })
}
function relativeLuminance(color: string): number | null {
  const rgb = parseHexRgb(color)
  if (!rgb) return null
  const channel = (value: number) => {
    const next = value / 255
    return next <= 0.03928 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}
export function terminalSelectionColors(theme: TuiThemePalette): SelectionColors {
  const lightTheme = (relativeLuminance(theme.bg) ?? relativeLuminance(theme.surface) ?? 0) > 0.5
  const selectionBg = mixHexColor(theme.cyan, theme.surface, lightTheme ? 0.22 : 0.42) ?? theme.surface3
  return {
    selectionBg,
    selectionFg: theme.text,
  }
}
// opencode sets a prompt on a panel a shade away from the page rather than on a
// tint of the accent, so the rule carries the colour and the band stays quiet.
export function continuousUserBackground(theme: TuiThemePalette): string {
  const lightTheme = (relativeLuminance(theme.bg) ?? 0) > 0.5
  return (lightTheme ? mixHexColor(theme.text, theme.bg, 0.06) : mixHexColor('#000000', theme.bg, 0.35)) ?? theme.userBg
}
export function streamUserBackground(theme: TuiThemePalette): string {
  const lightTheme = (relativeLuminance(theme.bg) ?? relativeLuminance(theme.surface) ?? 0) > 0.5
  return mixHexColor(theme.cyan, theme.surface, lightTheme ? 0.06 : 0.09) ?? theme.surface2
}

export function buildSyntaxStyle(theme: TuiThemePalette, owner: NativeResourceOwner): SyntaxStyle {
  const keywordColor = chooseSyntaxColor(theme, theme.violet, [theme.amber, theme.pink, theme.cyan])
  const functionColor = chooseSyntaxColor(theme, theme.cyan, [theme.green, theme.amber, theme.violet])
  const memberColor = chooseSyntaxColor(theme, theme.cyan, [theme.green, theme.amber, theme.violet])
  const typeColor = chooseSyntaxColor(theme, theme.pink, [theme.violet, theme.amber, theme.cyan])
  const builtinColor = chooseSyntaxColor(theme, theme.amber, [theme.pink, theme.violet, theme.green])

  return SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex(keywordColor), bold: true },
    string: { fg: RGBA.fromHex(theme.green) },
    comment: { fg: RGBA.fromHex(theme.dim), italic: true, dim: true },
    number: { fg: RGBA.fromHex(builtinColor) },
    function: { fg: RGBA.fromHex(functionColor) },
    'function.call': { fg: RGBA.fromHex(functionColor) },
    'function.method': { fg: RGBA.fromHex(functionColor) },
    'function.method.call': { fg: RGBA.fromHex(functionColor) },
    'function.builtin': { fg: RGBA.fromHex(functionColor), bold: true },
    type: { fg: RGBA.fromHex(typeColor), bold: true },
    'type.builtin': { fg: RGBA.fromHex(builtinColor), bold: true },
    'type.definition': { fg: RGBA.fromHex(typeColor), bold: true },
    variable: { fg: RGBA.fromHex(theme.text) },
    'variable.builtin': { fg: RGBA.fromHex(builtinColor) },
    'variable.member': { fg: RGBA.fromHex(memberColor), bold: true },
    'variable.parameter': { fg: RGBA.fromHex(theme.text) },
    property: { fg: RGBA.fromHex(memberColor), bold: true },
    constructor: { fg: RGBA.fromHex(typeColor), bold: true },
    constant: { fg: RGBA.fromHex(theme.text) },
    'constant.builtin': { fg: RGBA.fromHex(builtinColor), bold: true },
    'constant.macro': { fg: RGBA.fromHex(builtinColor), bold: true },
    boolean: { fg: RGBA.fromHex(builtinColor) },
    character: { fg: RGBA.fromHex(theme.green) },
    'character.special': { fg: RGBA.fromHex(builtinColor) },
    tag: { fg: RGBA.fromHex(typeColor) },
    attribute: { fg: RGBA.fromHex(builtinColor) },
    module: { fg: RGBA.fromHex(functionColor) },
    namespace: { fg: RGBA.fromHex(functionColor) },
    label: { fg: RGBA.fromHex(typeColor) },
    embedded: { fg: RGBA.fromHex(theme.text) },
    escape: { fg: RGBA.fromHex(builtinColor), bold: true },
    operator: { fg: RGBA.fromHex(theme.muted) },
    'keyword.conditional': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.directive': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.function': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.import': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.modifier': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.operator': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.repeat': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.return': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.type': { fg: RGBA.fromHex(keywordColor), bold: true },
    punctuation: { fg: RGBA.fromHex(theme.muted) },
    'punctuation.bracket': { fg: RGBA.fromHex(theme.muted) },
    'punctuation.delimiter': { fg: RGBA.fromHex(theme.muted) },
    'punctuation.special': { fg: RGBA.fromHex(builtinColor) },
    'extmark.paste': { fg: RGBA.fromHex(theme.bg), bg: RGBA.fromHex(theme.amber), bold: true },
    // Markdown prose captures — OpenTUI's <markdown> renderer styles inline
    // elements via these `markup.*` keys. Without them, inline code, bold, and
    // headings fall back to the flat default fg (the SelectableMarkdown "plain"
    // look). Match the per-line inline renderer: code → cyan, strong → bold.
    'markup.raw': { fg: RGBA.fromHex(theme.cyan) },
    'markup.raw.block': { fg: RGBA.fromHex(theme.cyan) },
    'markup.strong': { fg: RGBA.fromHex(theme.text), bold: true },
    'markup.italic': { fg: RGBA.fromHex(theme.text), italic: true },
    'markup.strikethrough': { fg: RGBA.fromHex(theme.muted) },
    'markup.heading': { fg: RGBA.fromHex(keywordColor), bold: true },
    'markup.link': { fg: RGBA.fromHex(theme.cyan) },
    'markup.link.label': { fg: RGBA.fromHex(theme.cyan) },
    'markup.link.url': { fg: RGBA.fromHex(theme.dim) },
    'markup.list': { fg: RGBA.fromHex(builtinColor) },
    'markup.quote': { fg: RGBA.fromHex(theme.dim), italic: true },
    default: { fg: RGBA.fromHex(theme.text) },
  }, owner)
}
export function buildComposerSyntaxStyle(theme: TuiThemePalette, owner: NativeResourceOwner): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    'extmark.paste': { fg: RGBA.fromHex(theme.bg), bg: RGBA.fromHex(theme.amber), bold: true },
    default: { fg: RGBA.fromHex(theme.text) },
  }, owner)
}
export function transcriptAccent(cardRole: 'user' | 'assistant' | 'system', provider: ProviderSelection | undefined): string {
  if (cardRole === 'user') return THEME.green
  if (cardRole === 'system') return THEME.dim
  return getProviderAccent(provider ?? 'claude')
}
export function toolNameFromTranscriptLine(text: string): string {
  const cleaned = text.replace(/^tool\s+/i, '').trim()
  const colon = cleaned.indexOf(':')
  return (colon >= 0 ? cleaned.slice(0, colon) : cleaned.split(/\s+/, 1)[0] ?? '').trim()
}
export function transcriptToolColor(name: string, theme: TuiThemePalette): string {
  switch (name.toLowerCase()) {
    case 'bash':
      return theme.amber
    case 'edit':
    case 'multiedit':
    case 'filechange':
    case 'notebookedit':
      return theme.green
    case 'write':
      return theme.cyan
    case 'read':
    case 'webfetch':
      return theme.violet
    case 'grep':
      return theme.red
    case 'glob':
      return theme.pink
    case 'agent':
    case 'task':
    case 'taskcreate':
    case 'taskget':
    case 'taskupdate':
    case 'tasklist':
    case 'taskstop':
    case 'task_status':
    case 'agentswitch':
      return theme.pink
    case 'websearch':
    case 'toolsearch':
      return theme.cyan
    case 'todowrite':
      return theme.green
    default:
      return theme.muted
  }
}
export function transcriptColor(line: TuiTranscriptCardLine, theme: TuiThemePalette): string {
  switch (line.tone) {
    case 'tool':
      return transcriptToolColor(toolNameFromTranscriptLine(line.text), theme)
    case 'agent':
      return theme.violet
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
export function streamLineMarker(line: TuiTranscriptCardLine, role: TuiTranscriptCard['role']): string {
  if (role === 'user') return '❯'
  switch (line.tone) {
    case 'result_ok':
      return '●'
    case 'result_error':
      return '×'
    case 'system':
      return '▲'
    default:
      return '•'
  }
}
export function streamContinuationMarker(line: TuiTranscriptCardLine): string {
  switch (line.tone) {
    case 'result_ok':
      return '  └ '
    case 'result_error':
      return '  └ '
    case 'system':
      return '  └ '
    case 'tool':
      return '  └ '
    default:
      return '    '
  }
}
export function streamToolGroupMarker(cards: TuiTranscriptCard[]): string {
  let hasWarning = false
  let hasPending = false
  for (const card of cards) {
    if (card.pending) hasPending = true
    for (const line of [...card.lines, ...card.expandedLines]) {
      if (line.tone === 'result_error') return '×'
      if (line.tone === 'system') hasWarning = true
    }
  }
  if (hasWarning) return '▲'
  // A called-but-unfinished tool reads as an open circle until its result
  // lands, so a streaming turn shows what is still running at a glance.
  return hasPending ? '○' : '●'
}
export function streamToolCardMarker(card: TuiTranscriptCard): string {
  return streamToolGroupMarker([card])
}
export function streamStatusColor(marker: string, theme: TuiThemePalette): string {
  if (marker === '✓') return theme.green
  if (marker === '×') return theme.red
  if (marker === '▲') return theme.amber
  if (marker === '●') return theme.green
  if (marker === '○') return theme.amber
  return theme.dim
}
// opencode closes each reply with who answered and how long the turn took.
// Only the turn's last reply carries it, and never while that reply streams —
// the duration is still growing and the turn may not be over.
export function continuousTurnFooter(card: TuiTranscriptCard, next: TuiTranscriptCard | undefined): string | null {
  if (card.role === 'user' || card.pending || !card.durationLabel) return null
  if (next && next.role !== 'user') return null
  return card.durationLabel
}
// A turn summary opens that turn's checkpoint diff. The cards that draw it are
// memoized and cached per selection variant, so the action is reached through
// one module slot the root fills rather than a prop on every card. Like a link
// it acts on mouse UP with the pointer unmoved, so a drag stays a selection.
let turnSummaryOpener: ((promptKey: string) => void) | null = null
/** Register the handler a turn-summary click opens, and release it on unmount (only if still the one registered). */
export function registerTurnSummaryOpener(opener: (promptKey: string) => void): () => void {
  turnSummaryOpener = opener
  return () => {
    if (turnSummaryOpener === opener) turnSummaryOpener = null
  }
}
let turnSummaryPress: { promptKey: string; x: number; y: number}  | null = null
export function turnSummaryMouseProps(landmark: CardLandmark) {
  const promptKey = landmark.promptKey
  if (!promptKey) return undefined
  return {
    onMouseDown: (event: MouseEvent) => {
      turnSummaryPress = event.button === 0 ? { promptKey, x: event.x, y: event.y } : null
    },
    onMouseUp: (event: MouseEvent) => {
      const press = turnSummaryPress
      turnSummaryPress = null
      if (event.button !== 0 || !press || press.promptKey !== promptKey) return
      if (press.x !== event.x || press.y !== event.y) return
      turnSummaryOpener?.(promptKey)
    },
  }
}
export function streamLandmarkText(landmark: CardLandmark, width: number): string {
  if (landmark.kind === 'break') return ' '
  if (landmark.kind === 'turn') {
    return landmark.text
      ? fitText(`─ ${landmark.text} `, width).padEnd(width, '─')
      : '─'.repeat(Math.max(width, 1))
  }
  return fitText(`─ ${landmark.text} `, width).padEnd(width, '─')
}
function streamCardLatestTimestampMs(card: TuiTranscriptCard): number | null {
  let latest = card.timestampMs ?? null
  for (const toolCard of (card as AgentToolGroupCard).agentToolCards ?? []) {
    if (toolCard.timestampMs != null && (latest == null || toolCard.timestampMs > latest)) {
      latest = toolCard.timestampMs
    }
  }
  return latest
}
// `Worked for 16s · 3 files · +42 −7`: how long the turn took and what it did
// to files, so "what did it actually do" needs no scroll back through tools.
// Either half stands alone; null when there is nothing to say.
export function turnSummaryText(cards: readonly TuiTranscriptCard[], promptIndex: number, endIndex: number, elapsedMs: number | null): string | null {
  const edits = formatFileEditSummary(mergeFileEditStats(cards.slice(promptIndex + 1, endIndex).map((card) => card.fileEdits)))
  const worked = elapsedMs != null && elapsedMs >= 1000 ? `Worked for ${formatElapsedClock(elapsedMs)}` : null
  if (worked && edits) return `${worked} · ${edits}`
  return worked ?? edits
}
export function streamCompletedTurnHint(cards: TuiTranscriptCard[]): CardLandmark | null {
  let userIndex = -1
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (cards[index].role === 'user') {
      userIndex = index
      break
    }
  }
  if (userIndex < 0 || userIndex === cards.length - 1) return null

  const startedAt = cards[userIndex].timestampMs
  let elapsedMs: number | null = null
  if (startedAt != null) {
    let completedAt = startedAt
    for (let index = userIndex + 1; index < cards.length; index += 1) {
      completedAt = Math.max(completedAt, streamCardLatestTimestampMs(cards[index]) ?? completedAt)
    }
    elapsedMs = completedAt - startedAt
  }
  const text = turnSummaryText(cards, userIndex, cards.length, elapsedMs)
  return text ? { kind: 'turn', text, promptKey: cards[userIndex].key } : null
}
export function transcriptBackground(line: TuiTranscriptCardLine, theme: TuiThemePalette): string | undefined {
  switch (line.tone) {
    // Tool result summaries (✓ OK, ✓ -2 +10 lines, command output) previously
    // reused the diff add/remove fills as a full-width band, which read as a
    // saturated highlight bar dominating the transcript. The green/red text color
    // + ✓/✗ glyph already carry the success/error semantic, so no band is needed —
    // the diff fills stay reserved for actual diff content below.
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
export function diffRowColor(row: TuiPierreDiffRow, theme: TuiThemePalette): string {
  switch (row.tone) {
    case 'addition':
      return theme.green
    case 'deletion':
      return theme.red
    case 'file':
    case 'hunk':
      return theme.cyan
    case 'tree':
    case 'meta':
      return theme.dim
    default:
      return theme.text
  }
}
export function diffRowBackground(row: TuiPierreDiffRow, theme: TuiThemePalette): string | undefined {
  switch (row.tone) {
    case 'addition':
      return theme.diffAddBg
    case 'deletion':
      return theme.diffRemoveBg
    case 'file':
    case 'hunk':
      return theme.diffMetaBg
    default:
      return undefined
  }
}
export function diffRowIndicator(row: TuiPierreDiffRow): string {
  switch (row.tone) {
    case 'addition':
      return '+'
    case 'deletion':
      return '-'
    case 'file':
      return '>'
    case 'hunk':
      return '@'
    case 'tree':
      return '|'
    default:
      return ' '
  }
}
// Editor-style sign column: a continuous left gutter bar tinted by change type
// (green add / red remove / cyan file·hunk / faint border for context) so a
// diff's shape reads at a glance, matching the ▎ accent bars used elsewhere.
export function diffGutterBar(row: TuiPierreDiffRow, theme: TuiThemePalette): string {
  switch (row.tone) {
    case 'addition':
      return theme.green
    case 'deletion':
      return theme.red
    case 'file':
    case 'hunk':
      return theme.cyan
    default:
      return theme.border
  }
}
function splitDiffSideColor(side: TuiSplitRowSide, theme: TuiThemePalette): string {
  if (side.kind === 'deletion') return theme.red
  if (side.kind === 'addition') return theme.green
  return theme.text
}
function splitDiffSideBackground(side: TuiSplitRowSide, theme: TuiThemePalette): string | undefined {
  if (side.kind === 'deletion') return theme.diffRemoveBg
  if (side.kind === 'addition') return theme.diffAddBg
  if (side.kind === 'empty') return theme.surface2
  return undefined
}
function splitDiffSideIndicator(side: TuiSplitRowSide): string {
  if (side.kind === 'deletion') return '-'
  if (side.kind === 'addition') return '+'
  return ' '
}
type SplitDiffSideProps = {
  side?: TuiSplitRowSide
  width: number
  gutterWidth: number
  showLineNumbers: boolean
  theme: TuiThemePalette
  selectionColors: SelectionColors
}
export function SplitDiffSide({
  side, width, gutterWidth, showLineNumbers, theme, selectionColors,
}: SplitDiffSideProps) {
  const resolved = side ?? { kind: 'empty' as const, text: '' }
  const sideColor = splitDiffSideColor(resolved, theme)
  const textWidth = Math.max(width - gutterWidth - 1, 4)
  return (
    <box width={width} flexDirection="row" backgroundColor={splitDiffSideBackground(resolved, theme)}>
      {showLineNumbers ? (
        <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
          {formatDiffLineNumber(resolved.lineNum, gutterWidth)}{' '}
        </text>
      ) : null}
      <text fg={sideColor} wrapMode="none" selectable {...selectionColors}>
        {fitText(` ${splitDiffSideIndicator(resolved)} ${resolved.text}`, textWidth)}
      </text>
    </box>
  )
}
export function formatDiffLineNumber(lineNumber: number | undefined, width: number): string {
  return lineNumber == null ? ''.padStart(width, ' ') : lineNumber.toString().padStart(width, ' ')
}
export const EMPTY_LANDMARKS: CardLandmark[] = []

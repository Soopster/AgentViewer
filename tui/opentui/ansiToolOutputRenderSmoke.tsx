/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { TranscriptCard, type TranscriptCardProps } from './app/TranscriptCard'
import { inlineSegmentIndexAt, renderInlineTextSegments } from './app/inlineText'
import { toolOutputPreview } from './app/toolOutputPreview'
import { densityConfig } from './app/transcriptStyle'
import { DARK_THEME } from '../theme'
import type { TuiTranscriptCard } from '../format'

import { RGBA } from '@opentui/core'
import { ansiRunSegments } from './app/ansiSegments'
import { ensureTuiAnsiHighlighter } from '../format'
import { ansiRuns } from '../../lib/ansiOutput'

// Coloured tool output must reach the screen in every way a card is drawn, not
// only the expanded tool row: each case mounts a real card and reads the
// foreground the painted text ended up with.
await ensureTuiAnsiHighlighter()
const runs = ansiRuns('\x1b[31mREDWORD\x1b[0m trailing', 'semantic')![0]!
const lines = [
  { text: 'tool Bash: test', tone: 'tool' as const },
  { text: '✓ OK', tone: 'result_ok' as const },
  { text: 'REDWORD trailing', tone: 'muted' as const, runs },
]
const card: TuiTranscriptCard = { key: 'ansi-card', role: 'assistant', label: 'Bash', category: 'technical', autoFold: false, compactSummary: 'test', lines, expandedLines: lines, searchText: '', searchHaystackLower: '' }
const noop = () => {}
const props: TranscriptCardProps = {
  card, display: { landmarks: [], bodyLines: lines, diffView: null, codeBlockLineCounts: [], headerMeta: '', accent: DARK_THEME.cyan, isThinkingCard: false, categoryEmoji: '', isInsight: false, markdownFallbackLines: null },
  theme: DARK_THEME, densityState: densityConfig('balanced'), syntaxStyle: null, rightPaneWidth: 100,
  isExpanded: true, hasCursor: false, isSelected: false, isSearchHit: false, isActiveMatch: false, bookmarked: false,
  onSelectCard: noop, thinkingMode: false, diffLayout: 'stack', imessageStyle: false, transcriptWidth: 'readable', streamMode: true, continuousMode: false, agentsMode: false,
  agentToolCursorKey: null, agentToolExpandedKeys: new Set(), agentToolCollapsedKeys: new Set(), onSelectAgentTool: noop,
  noteNamespace: 'test', diffNotes: new Map(), diffDraft: null, hoveredDiffAnchor: null, activateDiffHover: noop, openDiffNote: noop, sendDiffNoteToComposer: noop,
  diffPlain: false, diffShowLineNumbers: true, diffShowHunkHeaders: true, diffRowCursor: 0, diffSelectionAnchor: null,
  diffPlainCardKeys: new Set(), diffHiddenLineNumberCardKeys: new Set(), diffHiddenHunkHeaderCardKeys: new Set(), diffRowCursorByCardKey: {}, diffSelectionAnchorByCardKey: {}, setDiffRowCursor: noop, setDiffSelectionAnchor: noop,
}

const base = (): TranscriptCardProps => ({
  card, display: { landmarks: [], bodyLines: lines, diffView: null, codeBlockLineCounts: [], headerMeta: '', accent: DARK_THEME.cyan, isThinkingCard: false, categoryEmoji: '', isInsight: false, markdownFallbackLines: null },
  theme: DARK_THEME, densityState: densityConfig('balanced'), syntaxStyle: null, rightPaneWidth: 100,
  isExpanded: true, hasCursor: false, isSelected: false, isSearchHit: false, isActiveMatch: false, bookmarked: false,
  onSelectCard: noop, thinkingMode: false, diffLayout: 'stack', imessageStyle: false, transcriptWidth: 'readable', streamMode: true, continuousMode: false, agentsMode: false,
  agentToolCursorKey: null, agentToolExpandedKeys: new Set(), agentToolCollapsedKeys: new Set(), onSelectAgentTool: noop,
  noteNamespace: 'test', diffNotes: new Map(), diffDraft: null, hoveredDiffAnchor: null, activateDiffHover: noop, openDiffNote: noop, sendDiffNoteToComposer: noop,
  diffPlain: false, diffShowLineNumbers: true, diffShowHunkHeaders: true, diffRowCursor: 0, diffSelectionAnchor: null,
  diffPlainCardKeys: new Set(), diffHiddenLineNumberCardKeys: new Set(), diffHiddenHunkHeaderCardKeys: new Set(), diffRowCursorByCardKey: {}, diffSelectionAnchorByCardKey: {}, setDiffRowCursor: noop, setDiffSelectionAnchor: noop,
})
const expectedRed = RGBA.fromHex(ansiRunSegments(runs, DARK_THEME)[0]!.fg).toString()
const defaultText = RGBA.fromHex(DARK_THEME.text).toString()
assert.notEqual(expectedRed, defaultText, 'the fixture must distinguish colour from the default')

const views: Array<[string, Partial<TranscriptCardProps>]> = [
  ['stream', { streamMode: true }],
  ['card body (non-stream)', { streamMode: false }],
  ['agents', { streamMode: true, agentsMode: true }],
]
for (const [name, override] of views) {
  const setup = await testRender(<TranscriptCard {...base()} {...override} />, { width: 100, height: 30 })
  try {
    await act(async () => { await setup.flush() })
    let painted: string | null = null
    for (const row of setup.captureSpans().lines) {
      const span = row.spans.find(candidate => candidate.text.includes('REDWORD'))
      if (span) painted = span.fg.toString()
    }
    assert.ok(painted, `${name}: the output line is on screen\n${setup.captureCharFrame()}`)
    assert.equal(painted!, expectedRed, `${name}: REDWORD is drawn in the ANSI red`)
  } finally { await act(async () => { setup.renderer.destroy() }) }
}
console.log('Coloured tool output reaches the stream, card-body and agents views.')
process.exit(0)

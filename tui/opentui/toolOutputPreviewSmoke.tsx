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

const lines = [{ text: 'tool Bash: test', tone: 'tool' as const }, ...Array.from({ length: 25 }, (_, i) => ({ text: `OUTPUT_${String(i + 1).padStart(2, '0')}`, tone: 'default' as const }))]
const card: TuiTranscriptCard = { key: 'preview-tool', role: 'assistant', label: 'Bash', category: 'technical', autoFold: true, compactSummary: 'test', lines, expandedLines: lines, searchText: '', searchHaystackLower: '' }
assert.equal(toolOutputPreview(card, lines)?.lines.length, 7)
assert.equal(toolOutputPreview({ ...card, thinkingTranscript: true }, lines), null)
assert.equal(toolOutputPreview({ ...card, category: 'conversation' }, lines), null)
assert.equal(toolOutputPreview({ ...card, category: 'diff' }, lines), null)
assert.equal(toolOutputPreview(card, [...lines, { text: 'FAILED', tone: 'result_error' }])?.lines.at(-1)?.text, 'FAILED')
const status = [{ text: 'main', fg: 'white' }, { text: ' stash:2', fg: 'white', atomic: true, action: 'git' as const }]
assert.equal(inlineSegmentIndexAt(status, 8, 6), null, 'omitted counter is not clickable')
assert.equal(inlineSegmentIndexAt(status, 12, 6), 1)
const renderedStatus = renderInlineTextSegments(status, 8, 'white')
assert(!JSON.stringify(renderedStatus).includes('stash'), 'counter must not be rendered partially')
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
const setup = await testRender(<TranscriptCard {...props} />, { width: 100, height: 45 })
try {
  await act(async () => { await setup.flush() })
  assert(setup.captureCharFrame().includes('OUTPUT_06'))
  assert(!setup.captureCharFrame().includes('OUTPUT_07'))
  const clickToggle = async () => {
    const button = setup.renderer.root.findDescendantById('tool-output-toggle:preview-tool')!
    assert(button)
    await act(async () => { await setup.mockMouse.click(button.x + 3, button.y); await setup.flush() })
  }
  await clickToggle()
  assert(setup.captureCharFrame().includes('OUTPUT_25'), 'show all reveals last output line')
  assert(setup.captureCharFrame().includes('Show less output'))
  await clickToggle()
  assert(!setup.captureCharFrame().includes('OUTPUT_07'), 'show less restores the bounded preview')
  console.log('Tool output preview passed: 6 lines, show all/less clicks, reasoning/prose/diff exemptions, failure visibility.')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)

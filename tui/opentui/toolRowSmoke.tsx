/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { TranscriptCard, type TranscriptCardProps } from './app/TranscriptCard'
import { inlineSegmentIndexAt, renderInlineTextSegments } from './app/inlineText'
import { findToolRow } from './app/readerRows'
import { densityConfig } from './app/transcriptStyle'
import { DARK_THEME } from '../theme'
import type { TuiTranscriptCard } from '../format'

const tool = (key: string, command: string, output: string[]): TuiTranscriptCard => ({
  key, role: 'assistant', label: 'Bash', category: 'technical', autoFold: true, compactSummary: command,
  lines: [{ text: `tool Bash: $ ${command}`, tone: 'tool' }, { text: output[0]!, tone: 'result_ok' }],
  expandedLines: [{ text: `tool Bash: $ ${command}`, tone: 'tool' }, ...output.map(text => ({ text, tone: 'result_ok' as const }))],
  searchText: '', searchHaystackLower: '',
})
const first = tool('t1', 'grep -n alpha lib', ['ONE_FIRST', 'ONE_SECOND'])
const second = tool('t2', 'cat lib/b.ts', ['TWO_FIRST', 'TWO_SECOND'])
const lines = [{ text: 'tool Bash: $ grep -n alpha lib', tone: 'tool' as const }]
const card = { key: 'group', role: 'assistant', label: 'Bash', category: 'technical', autoFold: true, compactSummary: 'group', lines, expandedLines: lines, searchText: '', searchHaystackLower: '', agentToolCards: [first, second] } as TuiTranscriptCard
let OPEN = new Set<string>()
const noop = () => {}
const props: TranscriptCardProps = {
  card, display: { landmarks: [], bodyLines: lines, diffView: null, codeBlockLineCounts: [], headerMeta: '', accent: DARK_THEME.cyan, isThinkingCard: false, categoryEmoji: '', isInsight: false, markdownFallbackLines: null },
  theme: DARK_THEME, densityState: densityConfig('balanced'), syntaxStyle: null, rightPaneWidth: 100,
  isExpanded: false, hasCursor: false, isSelected: false, isSearchHit: false, isActiveMatch: false, bookmarked: false,
  onSelectCard: noop, thinkingMode: false, diffLayout: 'stack', imessageStyle: false, transcriptWidth: 'readable', streamMode: true, continuousMode: false, agentsMode: true,
  agentToolCursorKey: null, agentToolExpandedKeys: new Set<string>(), agentToolCollapsedKeys: new Set(), onSelectAgentTool: noop,
  noteNamespace: 'test', diffNotes: new Map(), diffDraft: null, hoveredDiffAnchor: null, activateDiffHover: noop, openDiffNote: noop, sendDiffNoteToComposer: noop,
  diffPlain: false, diffShowLineNumbers: true, diffShowHunkHeaders: true, diffRowCursor: 0, diffSelectionAnchor: null,
  diffPlainCardKeys: new Set(), diffHiddenLineNumberCardKeys: new Set(), diffHiddenHunkHeaderCardKeys: new Set(), diffRowCursorByCardKey: {}, diffSelectionAnchorByCardKey: {}, setDiffRowCursor: noop, setDiffSelectionAnchor: noop,
}

const frame = async () => {
  const setup = await testRender(<TranscriptCard {...props} agentToolExpandedKeys={OPEN} />, { width: 100, height: 30 })
  try {
    await act(async () => { await setup.flush() })
    const text = setup.captureCharFrame()
    const ids = ['tool-row:t1', 'tool-row:t2', 'tool-row-open:t1', 'tool-row-open:t2'].filter(id => setup.renderer.root.findDescendantById(id))
    const row = findToolRow(setup.renderer.root.findDescendantById('card:group') ?? setup.renderer.root, setup.renderer.root.findDescendantById(ids[0] ?? '')?.y ?? 0)
    return { text, ids, row }
  } finally { await act(async () => { setup.renderer.destroy() }) }
}
const closed = await frame()
assert(!closed.text.includes('ONE_SECOND') && !closed.text.includes('TWO_SECOND'), 'every tool starts as one row plus its first output line')
assert.deepEqual(closed.ids, ['tool-row:t1', 'tool-row:t2'], 'each tool row is addressable on its own')
OPEN = new Set(['t2'])
const opened = await frame()
assert(opened.text.includes('TWO_SECOND'), 'opening one tool shows all of its output')
assert(!opened.text.includes('ONE_SECOND'), 'its neighbour stays folded')
assert.deepEqual(opened.ids, ['tool-row:t1', 'tool-row-open:t2'])
console.log('Tool row smoke passed: per-tool ids, one tool opens alone, neighbours stay folded.')
process.exit(0)

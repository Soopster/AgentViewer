/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { RGBA } from '@opentui/core'
import { testRenderWithSyntaxStyle, act } from './testRender'
import { TranscriptCard, type TranscriptCardProps } from './app/TranscriptCard'
import { densityConfig } from './app/transcriptStyle'
import { DARK_THEME } from '../theme'
import { highlightDisplayCodeAsync } from './markdownBlocksWorkerClient'
import type { TuiTranscriptCard } from '../format'

// Colours the syntax style assigns, distinct from the regex fallback.
const STRING = '#11cc77'
const KEYWORD = '#ee3399'
const definitions = {
  default: { fg: RGBA.fromHex('#cccccc') },
  string: { fg: RGBA.fromHex(STRING) },
  keyword: { fg: RGBA.fromHex(KEYWORD) },
}
// The second row is inside a template literal opened on the first; only a real parse knows that.
const source = ['const a = `first', 'const b = 1', 'last`', 'return 2']
const captures = await highlightDisplayCodeAsync(source.join('\n'), 'ts')
assert(captures?.some(([start, end, scope]) => scope === 'string' && source.join('\n').slice(start, end).includes('const b')), 'real Highlights worker preserves multiline string state')
const lines = [{ text: 'tool Read: lib/a.ts', tone: 'tool' as const }, ...source.map(text => ({ text, tone: 'result_ok' as const }))]
const card: TuiTranscriptCard = { key: 'read', role: 'assistant', label: 'Read', category: 'technical', autoFold: true, compactSummary: 'Read a.ts', lines, expandedLines: lines, searchText: '', searchHaystackLower: '' }
const noop = () => {}
const propsFor = (syntaxStyle: TranscriptCardProps['syntaxStyle']): TranscriptCardProps => ({
  card, display: { landmarks: [], bodyLines: lines, diffView: null, codeBlockLineCounts: [], headerMeta: '', accent: DARK_THEME.cyan, isThinkingCard: false, categoryEmoji: '', isInsight: false, markdownFallbackLines: null },
  theme: DARK_THEME, densityState: densityConfig('balanced'), syntaxStyle, rightPaneWidth: 100,
  isExpanded: true, hasCursor: false, isSelected: false, isSearchHit: false, isActiveMatch: false, bookmarked: false,
  onSelectCard: noop, thinkingMode: false, diffLayout: 'stack', imessageStyle: false, transcriptWidth: 'readable', streamMode: true, continuousMode: false, agentsMode: true,
  agentToolCursorKey: null, agentToolExpandedKeys: new Set(), agentToolCollapsedKeys: new Set(), onSelectAgentTool: noop,
  noteNamespace: 'test', diffNotes: new Map(), diffDraft: null, hoveredDiffAnchor: null, activateDiffHover: noop, openDiffNote: noop, sendDiffNoteToComposer: noop,
  diffPlain: false, diffShowLineNumbers: true, diffShowHunkHeaders: true, diffRowCursor: 0, diffSelectionAnchor: null,
  diffPlainCardKeys: new Set(), diffHiddenLineNumberCardKeys: new Set(), diffHiddenHunkHeaderCardKeys: new Set(), diffRowCursorByCardKey: {}, diffSelectionAnchorByCardKey: {}, setDiffRowCursor: noop, setDiffSelectionAnchor: noop,
})
const setup = await testRenderWithSyntaxStyle(definitions, style => <TranscriptCard {...propsFor(style)} />, { width: 100, height: 20 })
const spans = () => setup.captureSpans().lines.flatMap(line => line.spans)
const fgOf = (word: string) => spans().find(span => span.text.includes(word))?.fg?.toString()
try {
  await act(async () => { await setup.flush() })
  for (let i = 0; i < 40 && fgOf('const b') !== RGBA.fromHex(STRING).toString(); i += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); await setup.flush() })
  }
  assert(setup.captureCharFrame().includes('const b = 1'))
  // Highlights sees the whole template string; the regex fallback cannot.
  assert.equal(fgOf('const b'), RGBA.fromHex(STRING).toString(), 'a row inside a multi-line string is coloured as string')
  assert.equal(fgOf('return'), RGBA.fromHex(KEYWORD).toString(), 'code after it is a keyword again')
  console.log('Tool output syntax smoke passed: Highlights worker replaces the regex fallback and preserves multiline strings and scene colors.')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)

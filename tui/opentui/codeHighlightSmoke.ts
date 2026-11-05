import assert from 'node:assert/strict'
import { highlightCodeLine, highlightToolOutputLine, languageForPath, toolOutputContext } from './app/codeHighlight'
import { DARK_THEME as theme } from '../theme'
import type { TuiTranscriptCard } from '../format'

const colorOf = (segments: Array<{ text: string; fg: string }> | null, text: string) => segments?.find(segment => segment.text.includes(text))?.fg
const line = highlightCodeLine('  const open = useCallback((x: number) => "hi", 42) // note', 'ts', theme)
assert.equal(line.map(segment => segment.text).join(''), '  const open = useCallback((x: number) => "hi", 42) // note', 'tokens reassemble into the input')
assert.equal(colorOf(line, 'const'), theme.pink, 'keywords')
assert.equal(colorOf(line, '"hi"'), theme.green, 'strings')
assert.equal(colorOf(line, '42'), theme.amber, 'numbers')
assert.equal(colorOf(line, '// note'), theme.dim, 'comments')
assert.equal(colorOf(line, 'useCallback'), theme.green, 'calls')
assert.equal(colorOf(highlightCodeLine('<TranscriptCard key={1}>', 'ts', theme), '<TranscriptCard'), theme.pink, 'JSX tags')
assert.equal(colorOf(highlightCodeLine('#include <x>', 'c', theme), '#include'), theme.pink)
assert.equal(colorOf(highlightCodeLine('x = 1  # why', 'py', theme), '# why'), theme.dim)
assert.equal(languageForPath('tui/opentui/App.tsx:12'), 'ts')
assert.equal(languageForPath('Makefile'), null)

const card = (toolLine: string): TuiTranscriptCard => ({ key: toolLine, role: 'assistant', label: 'x', category: 'technical', autoFold: true, compactSummary: '', lines: [{ text: toolLine, tone: 'tool' }], expandedLines: [{ text: toolLine, tone: 'tool' }], searchText: '', searchHaystackLower: '' })
assert.deepEqual(toolOutputContext(card('tool Read: lib/a.ts')), { kind: 'code', lang: 'ts', ext: 'ts' })
assert.deepEqual(toolOutputContext(card('tool Bash: $ sed -n 2,9p lib/a.py')), { kind: 'code', lang: 'py', ext: 'py' })
assert.deepEqual(toolOutputContext(card('tool Bash: $ grep -n x lib')), { kind: 'search' })
assert.equal(toolOutputContext(card('tool Bash: $ npm test')), null, 'unknown output is left plain')
assert.equal(toolOutputContext(card('tool Read: notes.txt')), null)

const hit = highlightToolOutputLine('tui/App.tsx:299:    onSelect: selectAgentTool, 5,', { kind: 'search' }, theme)
assert.equal(colorOf(hit, 'tui/App.tsx'), theme.cyan, 'hit path')
assert.equal(colorOf(hit, ':299:'), theme.dim, 'hit position')
assert.equal(colorOf(hit, '5'), theme.amber, 'hit content is highlighted by the hit file\'s language')
assert.equal(highlightToolOutputLine('just some prose', { kind: 'search' }, theme), null)
const numbered = highlightToolOutputLine('  42→const x = 1', { kind: 'code', lang: 'ts', ext: 'ts' }, theme)
assert.equal(colorOf(numbered, '42'), theme.dim, 'line numbers stay dim')
assert.equal(colorOf(numbered, 'const'), theme.pink)
console.log('codeHighlightSmoke ok')

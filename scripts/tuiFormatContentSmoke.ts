import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildThreadedMessages } from '../lib/threading'
import type { ContentBlock, SessionMessage, ToolUseBlock } from '../lib/types'
import {
  ensureTuiMermaidRenderer, formatTranscriptCards, formatMessageExpanded,
  formatTranscriptExpandedText, textNeedsTuiMermaid,
} from '../tui/format'
import { extractCodeBlocksFromBlocks } from '../tui/format/code'

// Complete public output captured before extracting code/diff presentation.
const raw: SessionMessage[] = []
function assistant(content: ContentBlock[]) {
  raw.push({ type: 'assistant', uuid: `assistant-${raw.length}`, session_id: 'format-content',
    parent_tool_use_id: null, message: { role: 'assistant', content } })
}
function tool(name: string, input: ToolUseBlock['input'], content?: string, isError = false) {
  const id = `tool-${raw.length}`
  assistant([{ type: 'tool_use', id, name, input }])
  if (content !== undefined) raw.push({ type: 'user', uuid: `result-${raw.length}`, session_id: 'format-content',
    parent_tool_use_id: null, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: id, content, is_error: isError },
    ] } })
}
assistant([{ type: 'text', text: 'Before\n```typescript\nconst a = 42\n```\nBetween\n```python\nprint(42)\n```\nAfter' }])
assistant([{ type: 'text', text: '```mermaid\ngraph LR\n  A --> B\n```' }])
assistant([{ type: 'text', text: '```mmd\ngraph TD\n  A --> B\n```' }])
assistant([{ type: 'text', text: '```typescript\nunclosed fence' }])
tool('read_file', { path: 'example.ts' }, '10\tconst a = 42\n11\texport { a }\n')
tool('Read', { file_path: 'empty.txt' }, '\n\t\n')
tool('Read', { file_path: 'failed.ts' }, 'read failed', true)
tool('Read', { file_path: 'pending.ts' })
tool('mcp__fixture__lookup', { query: 'code' }, 'Before\n```json\n{"ok":true}\n```\nAfter\n```sh\necho ok\n```')
tool('mcp__fixture__lookup', {}, '```js\nunclosed')
tool('FileChange', { changes: [{ path: 'example.ts', kind: { type: 'update' },
  diff: 'update example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@ function\n-old\n+new\n context\n\\ No newline at end of file' },
  { path: 'other.ts', kind: 'create', diff: '+new file' }] }, 'applied')
tool('FileChange', { changes: [] }, 'no changes')
tool('FileChange', { changes: [{ path: 'fallback.txt', diff: 'plain change without hunk markers' }] }, 'applied')
tool('Edit', { file_path: 'example.ts', old_string: 'old\ntext', new_string: 'new\ntext' }, 'updated')
tool('MultiEdit', { file_path: 'multi.ts', edits: [
  { old_string: 'a', new_string: 'b' }, { file_path: 'other.ts', old_string: '', new_string: 'c' },
] }, 'updated')
tool('write_file', { path: 'new.ts', content: 'export const answer = 42\n' }, 'written')
tool('TodoWrite', { todos: [
  { content: 'Already done', status: 'completed' },
  { content: 'Current task', activeForm: 'Working now', status: 'in_progress' },
  { content: 'Next task', status: 'pending' },
] }, 'updated')
tool('AskUserQuestion', { questions: [{ question: 'Which mode?', header: 'Mode', multiSelect: false,
  options: [{ label: 'Fast', description: 'Quick result' }, { label: 'Full', description: 'Complete result' }],
}] }, JSON.stringify({ answers: { 'Which mode?': 'Full' } }))
const messages = buildThreadedMessages(raw)
const output = {
  cards: (['dense', 'balanced', 'comfortable'] as const).map(density => formatTranscriptCards(messages, density)),
  expanded: messages.map(message => formatMessageExpanded(messages, message.uuid)),
  text: formatTranscriptExpandedText(messages),
}
const digest = createHash('sha256').update(JSON.stringify(output)).digest('hex')
assert.equal(digest, 'a681c0f692d5ee0e9503b40afeabbd6cf2e0097039d5d494c69ef09d422946b4')
const code = output.cards[1]!.flatMap(card => card.codeBlocks ?? [])
assert.ok(code.some(block => block.lang === 'typescript' && block.content === 'const a = 42'))
assert.ok(code.some(block => block.filePath === 'example.ts' && block.lineNumbers?.join(',') === '10,11'))
assert.ok(!code.some(block => block.filePath === 'failed.ts' || block.filePath === 'pending.ts'))
assert.ok(output.cards[1]!.some(card => card.hasMermaidDiagrams && card.expandedLines.some(row => row.text === '```mermaid')))
assert.equal(textNeedsTuiMermaid('ordinary text'), false)
assert.equal(textNeedsTuiMermaid('```mmd\ngraph LR\nA --> B\n```'), true)

// Code extraction accepts a block presenter without importing card assembly.
// Normalization must reach that presenter without mutating the source thread.
const read = messages.flatMap(message => message.blocks).find(block => (
  block.type === 'tool_thread' && block.toolUse.name === 'read_file'
))!
const before = structuredClone(read)
let callbacks = 0
const extracted = extractCodeBlocksFromBlocks([read], block => {
  callbacks++
  assert.equal(block.type, 'tool_thread')
  if (block.type === 'tool_thread') {
    assert.equal(block.toolUse.name, 'Read')
    assert.equal(block.toolUse.input.file_path, 'example.ts')
  }
  return [{ text: 'custom read presentation', tone: 'agent' }]
})
assert.equal(callbacks, 1)
assert.equal(extracted.codeBlocks[0]?.content, 'const a = 42\nexport { a }')
assert.deepEqual(extracted.processedLines, [{ text: 'custom read presentation', tone: 'agent' }])
assert.deepEqual(read, before)

await Promise.all([ensureTuiMermaidRenderer(), ensureTuiMermaidRenderer()])
const mermaidCards = formatTranscriptCards(messages).filter(card => card.hasMermaidDiagrams)
assert.equal(mermaidCards.length, 2)
assert.ok(mermaidCards.every(card => card.expandedLines.some(row => row.text === '```mermaid')))
console.log('TUI content formatting: code, diff, questions, todos, and lazy Mermaid checks passed')

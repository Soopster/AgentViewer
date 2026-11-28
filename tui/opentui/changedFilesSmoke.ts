// Files touched groups edits by the prompt that led to them, newest turn first,
// merging repeat edits of one file inside a turn.
import assert from 'node:assert/strict'
import { touchedTurns, touchedRows, relativeTo, touchedTurnsFromProvenance } from '../../plugins/session-insights/tui/changed-files/model'
import type { TuiTranscriptCard } from '../format'

const card = (key: string, role: string, text: string, fileEdits?: unknown) => ({ key, role, category: role === 'user' ? 'conversation' : 'technical', lines: [{ text, tone: 'default' }], fileEdits }) as unknown as TuiTranscriptCard
const cards = [
  card('u1', 'user', 'Fix the resize bug'),
  card('a', 'assistant', 'edit', [{ path: '/r/a.ts', added: 3, removed: 1 }]),
  card('b', 'assistant', 'edit', [{ path: '/r/a.ts', added: 2, removed: 0 }, { path: '/r/b.ts', added: 1, removed: 1 }]),
  card('u2', 'user', 'Commit and push'),
  card('c', 'assistant', 'nothing edited'),
  card('u3', 'user', 'Add tests'),
  { ...card('g', 'assistant', 'group'), agentToolCards: [card('d', 'assistant', 'edit', [{ path: '/r/t.ts', added: 9, removed: 0 }])] } as unknown as TuiTranscriptCard,
]
const turns = touchedTurns(cards)
assert.deepEqual(turns.map((turn) => turn.title), ['Add tests', 'Fix the resize bug'], 'newest first; a turn with no edits is dropped')
assert.deepEqual(turns[1]!.files, [{ path: '/r/a.ts', added: 5, removed: 1 }, { path: '/r/b.ts', added: 1, removed: 1 }])
assert.deepEqual([turns[1]!.added, turns[1]!.removed], [6, 2])
const rows = touchedRows(turns)
assert.deepEqual(rows.map((row) => row.kind), ['turn', 'file', 'turn', 'file', 'file'])
assert.equal(relativeTo('/r', '/r/src/a.ts'), 'src/a.ts')
assert.equal(relativeTo('/r', '/elsewhere/a.ts'), '/elsewhere/a.ts')

// The provenance index: grouped by the prompt that led to each edit, newest first, survival from the summary.
const edit = (id: number, at: number, filePath: string, lines: number, prompt: string | null) => ({ id, timestampMs: at, filePath, addedLines: Array(lines).fill('x'), prompt }) as never
const summary = { files: [{ filePath: '/r/a.ts', linesSurviving: 4 }, { filePath: '/r/b.ts', linesSurviving: 0 }] } as never
const fromIndex = touchedTurnsFromProvenance([
  edit(1, 100, '/r/a.ts', 3, 'Fix the  resize\nbug'),
  edit(2, 200, '/r/a.ts', 2, 'Fix the  resize\nbug'),
  edit(3, 210, '/r/b.ts', 1, 'Fix the  resize\nbug'),
  edit(4, 900, '/r/c.ts', 7, 'Add tests'),
  edit(5, 50, '/r/a.ts', 1, null),
], summary)
assert.deepEqual(fromIndex.map((turn) => turn.title), ['Add tests', 'Fix the resize bug', 'earlier'], 'newest turn first; prompts are one line')
const fix = fromIndex[1]!
assert.deepEqual(fix.files.map((file) => [file.path, file.added, file.edits, file.surviving]), [['/r/a.ts', 5, 2, 4], ['/r/b.ts', 1, 1, 0]])
assert.equal(fromIndex[0]!.files[0]!.surviving, undefined, 'a file the summary does not know has no survival figure')
assert.equal(fix.added, 6)
console.log('Changed files smoke passed (transcript grouping, provenance grouping and survival)')

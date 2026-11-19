// Which status segment a click column lands on: model and effort open the model
// picker, the folder its full path, the branch and counts Git. A wrong column
// maps to the wrong action with nothing on screen to show it.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'composer-status-click-')))
const { inlineSegmentActionAt } = await import('./App')

const row = [
  { text: '1 line', fg: 'x' },
  { text: ' · ', fg: 'x' },
  { text: 'model:gpt', fg: 'x', action: 'model' as const },
  { text: ' · ', fg: 'x' },
  { text: 'effort:auto', fg: 'x', action: 'model' as const },
  { text: ' · ', fg: 'x' },
  { text: 'agentViewer  ', fg: 'x', action: 'path' as const },
  { text: 'main', fg: 'x', action: 'git' as const },
  { text: '  ~1', fg: 'x', action: 'git' as const },
]
const at = (needle: string) => row.map(s => s.text).join('').indexOf(needle)
assert.equal(inlineSegmentActionAt(row, 200, at('1 line')), undefined)
assert.equal(inlineSegmentActionAt(row, 200, at('model:gpt') + 2), 'model')
assert.equal(inlineSegmentActionAt(row, 200, at('effort:') + 1), 'model')
assert.equal(inlineSegmentActionAt(row, 200, at(' · ')), undefined, 'separator is inert')
assert.equal(inlineSegmentActionAt(row, 200, at('agentViewer')), 'path')
assert.equal(inlineSegmentActionAt(row, 200, at('main')), 'git')
assert.equal(inlineSegmentActionAt(row, 200, at('~1')), 'git')
// A clipped row: the ellipsis shortens a segment, so later columns shift left.
assert.equal(inlineSegmentActionAt(row, 12, 11), 'model')
assert.equal(inlineSegmentActionAt(row, 12, 12), undefined, 'past the drawn width')
console.log('composerStatusClickSmoke: ok')
process.exit(0)

import assert from 'node:assert/strict'
import { buildPierreDiffView } from './pierreDiffView'
import { buildDiffProgress } from './gitDiffProgress'

const patch = [
  'diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new',
  '@@ -3 +3 @@', ' context', 'diff --git a/b.ts b/b.ts', '--- a/b.ts', '+++ b/b.ts', '@@ -1 +1 @@', '-old', '+new',
].join('\n')
const view = buildPierreDiffView(patch, 'progress', null)!
const progressAt = buildDiffProgress(view.rows, ['a.ts', 'b.ts'])
const firstChange = view.rows.findIndex(row => row.tone === 'addition')
const secondHunk = view.rows.findIndex((row, index) => index > firstChange && row.tone === 'hunk')
const secondFile = view.rows.findIndex((row, index) => index > secondHunk && row.tone === 'file')
assert.deepEqual(progressAt(firstChange), { filePath: 'a.ts', fileIndex: 1, fileCount: 2, hunkIndex: 1, hunkCount: 2, fileHeader: 'change a.ts', hunkHeader: '@@ -1 +1 @@' })
assert.equal(progressAt(secondHunk)?.hunkIndex, 2)
assert.equal(progressAt(secondFile)?.fileIndex, 2)
assert.equal(progressAt(secondFile)?.hunkCount, 1)
console.log('Git diff progress smoke passed: sticky file/hunk context and file counts')

import { detectEditorIndentUnit, transformEditorCase, transformEditorLines, trimEditorTrailingWhitespace } from './editorTransforms'

const moved = transformEditorLines('alpha\nbeta\ngamma\n', 6, 6, 'move-up')
if (moved.content !== 'beta\nalpha\ngamma\n' || moved.start !== 0) throw new Error(`Move line up failed: ${JSON.stringify(moved)}`)
const movedDown = transformEditorLines(moved.content, 0, 4, 'move-down')
if (movedDown.content !== 'alpha\nbeta\ngamma\n') throw new Error(`Move line down failed: ${JSON.stringify(movedDown)}`)
const sorted = transformEditorLines('zeta\nAlpha\nitem10\nitem2\n', 0, 24, 'sort')
if (sorted.content !== 'Alpha\nitem2\nitem10\nzeta\n') throw new Error(`Natural line sort failed: ${JSON.stringify(sorted)}`)
const duplicated = transformEditorLines('one\ntwo\n', 0, 7, 'duplicate')
if (duplicated.content !== 'one\ntwo\none\ntwo\n') throw new Error(`Duplicate selected lines failed: ${JSON.stringify(duplicated)}`)
const upper = transformEditorCase('const café = 1', 7, 7, 'upper')
if (upper.content !== 'const CAFÉ = 1') throw new Error(`Unicode word uppercase failed: ${JSON.stringify(upper)}`)
const trimmed = trimEditorTrailingWhitespace('one  \n two\t\n')
if (trimmed.content !== 'one\n two\n') throw new Error(`Trailing whitespace cleanup failed: ${JSON.stringify(trimmed)}`)
if (detectEditorIndentUnit('if true:\n    value = 1\n', 'main.py') !== '    '
  || detectEditorIndentUnit('if (ok) {\n\treturn\n}', 'main.go') !== '\t'
  || detectEditorIndentUnit('', 'main.ts') !== '  ') throw new Error('Indent-unit inference failed')

console.log('Editor move/sort/duplicate/Unicode-case/whitespace transform smoke passed')

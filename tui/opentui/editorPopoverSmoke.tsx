/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import type { ScrollBarRenderable, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-'))
const filePath = join(cwd, 'main.ts')
const secondFilePath = join(cwd, 'second.ts')
const fakeLspPath = join(cwd, 'tsc')
const originalTypeScriptLspBin = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
let closeCount = 0
let clipboardText = ''
const notices: Array<{ kind: 'info' | 'error'; message: string }> = []
registerExtraTreeSitterParsers()

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex(DARK_THEME.violet), bold: true },
  string: { fg: RGBA.fromHex(DARK_THEME.green) },
  function: { fg: RGBA.fromHex(DARK_THEME.cyan) },
  variable: { fg: RGBA.fromHex(DARK_THEME.text) },
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

async function flush(setup: Awaited<ReturnType<typeof testRender>>, delay = 250) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, delay))
  })
  await setup.flush()
}

try {
  await writeFile(fakeLspPath, String.raw`#!/usr/bin/env node
let input = Buffer.alloc(0)
let documentText = ''
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  while (true) {
    const headerEnd = input.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const match = /Content-Length:\s*(\d+)/i.exec(input.subarray(0, headerEnd).toString('ascii'))
    if (!match) return
    const length = Number(match[1])
    const start = headerEnd + 4
    if (input.length < start + length) return
    const message = JSON.parse(input.subarray(start, start + length).toString('utf8'))
    input = input.subarray(start + length)
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: { triggerCharacters: ['.'], resolveProvider: true } } } })
    if (message.method === 'textDocument/didOpen') documentText = message.params.textDocument.text
    if (message.method === 'textDocument/didChange') documentText = message.params.contentChanges[0].text
    if (message.method === 'textDocument/completion') {
      const position = message.params.position
      const line = (documentText.split('\n')[position.line] || '').slice(0, position.character)
      const prefix = /[A-Za-z_$][\w$]*$/.exec(line)?.[0] || ''
      const memberAccess = line.slice(0, line.length - prefix.length).endsWith('console.')
      const labels = prefix === 'bad'
        ? ['badValue']
        : memberAccess
        ? ['log', 'warn', 'error', 'info', 'debug', 'dir', 'table', 'time', 'timeEnd', 'trace', 'group', 'groupEnd']
        : ['answer']
      send({
        jsonrpc: '2.0', id: message.id, result: labels.map((label, index) => ({
          label,
          kind: 2,
          detail: memberAccess ? '(message?: any) => void' : 'number',
          sortText: String(index).padStart(3, '0'),
          preselect: index === 0,
          data: { memberAccess, label },
          textEdit: {
            range: { start: { line: position.line, character: position.character - prefix.length }, end: position },
            newText: label,
          },
        })),
      })
    }
    if (message.method === 'completionItem/resolve') send({
      jsonrpc: '2.0', id: message.id, result: {
        ...message.params,
        documentation: { kind: 'markdown', value: message.params.label === 'log' ? 'Writes a log message.' : 'Console member.' },
        additionalTextEdits: message.params.label === 'badValue'
          ? [{ range: message.params.textEdit.range, newText: 'corrupt' }]
          : message.params.label === 'log'
          ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// completion import\n' }]
          : [],
      },
    })
    if (message.method === 'textDocument/definition') send({
      jsonrpc: '2.0', id: message.id, result: {
        targetUri: message.params.textDocument.uri.replace('main.ts', 'second.ts'),
        targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } },
        targetSelectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
      },
    })
    if (message.method === 'textDocument/references') send({
      jsonrpc: '2.0', id: message.id, result: [
        { uri: message.params.textDocument.uri, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } } },
        { uri: message.params.textDocument.uri.replace('main.ts', 'second.ts'), range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } } },
      ],
    })
    if (message.method === 'textDocument/implementation') send({
      jsonrpc: '2.0', id: message.id, result: [{
        uri: message.params.textDocument.uri.replace('main.ts', 'second.ts'),
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
      }],
    })
    if (message.method === 'textDocument/prepareRename') send({
      jsonrpc: '2.0', id: message.id, result: {
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 12 } },
        placeholder: 'answer',
      },
    })
    if (message.method === 'textDocument/rename') {
      const edits = []
      for (const [lineIndex, line] of documentText.split('\n').entries()) {
        const pattern = /\banswer\b/g
        for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
          edits.push({ range: { start: { line: lineIndex, character: match.index }, end: { line: lineIndex, character: match.index + 6 } }, newText: message.params.newName })
        }
      }
      send({ jsonrpc: '2.0', id: message.id, result: { changes: {
        [message.params.textDocument.uri]: edits,
        [message.params.textDocument.uri.replace('main.ts', 'second.ts')]: [
          { range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } }, newText: message.params.newName },
        ],
      } } })
    }
    if (message.method === 'textDocument/formatting') send({
      jsonrpc: '2.0', id: message.id, result: [{
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
        newText: 'CONST',
      }],
    })
    if (message.method === 'textDocument/codeAction') send({
      jsonrpc: '2.0', id: message.id, result: [
        { title: 'Explain issue', kind: 'source', command: { command: 'fake.explain' } },
        { title: 'Insert preferred fix', kind: 'quickfix', isPreferred: true, edit: { changes: {
          [message.params.textDocument.uri]: [{ range: message.params.range, newText: 'fixed' }],
        } } },
      ],
    })
    if (message.method === 'workspace/executeCommand') send({ jsonrpc: '2.0', id: message.id, result: null })
  }
})
`, 'utf8')
  await chmod(fakeLspPath, 0o755)
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = fakeLspPath
  const longLine = `const wrappedText = '${'word '.repeat(36).trim()}'`
  const overflowLines = Array.from({ length: 36 }, (_, index) => `const filler${index} = ${index}`).join('\n')
  await writeFile(filePath, `const answer = 41\nconst otherAnswer = answer + 1\n  const nested = true\n${longLine}\n${overflowLines}\n`, 'utf8')
  await writeFile(secondFilePath, 'export const second = true\n', 'utf8')
  await Promise.all(Array.from({ length: 36 }, (_, index) => (
    writeFile(join(cwd, `fixture-${String(index).padStart(2, '0')}.ts`), `export const fixture${index} = ${index}\n`, 'utf8')
  )))
  const setup = await testRender(
    <EditorPopover
      cwd={cwd}
      initialPath={filePath}
      theme={DARK_THEME}
      width={110}
      height={34}
      syntaxStyle={syntaxStyle}
      onClose={() => { closeCount += 1 }}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onNotice={(kind, message) => { notices.push({ kind, message }) }}
      onClipboardRead={async () => clipboardText}
      onClipboardWrite={async (text) => { clipboardText = text }}
    />,
    { width: 110, height: 34 },
  )

  try {
    await flush(setup, 300)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await setup.flush()
    const initialFrame = setup.captureCharFrame()
    for (const expected of ['EDITOR', 'EXPLORER', 'main.ts', 'INSERT', '^P open', '^Space complete', 'Alt+Z wrap off', 'V velocity off']) {
      if (!initialFrame.includes(expected)) throw new Error(`Missing ${expected} from editor frame:\n${initialFrame}`)
    }
    if (!/\b1\s+const answer/.test(initialFrame)) throw new Error(`Editor did not render line numbers:\n${initialFrame}`)
    const keywordColor = RGBA.fromHex(DARK_THEME.violet).toString()
    const syntaxSpans = setup.captureSpans().lines.flatMap((line) => line.spans)
    if (!syntaxSpans.some((span) => span.text.includes('const') && span.fg.toString() === keywordColor)) {
      const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
      throw new Error(`Tree-sitter syntax highlighting did not color the TypeScript keyword: ${JSON.stringify(editor?.getLineHighlights(0) ?? [])}\n${initialFrame}`)
    }

    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor) throw new Error('Editor textarea was not mounted')
    const firstAnswer = editor.plainText.indexOf('answer')
    const secondAnswer = editor.plainText.indexOf('answer', firstAnswer + 1)
    editor.setSelection(firstAnswer, firstAnswer + 'answer'.length)
    act(() => { handleKey?.({ name: 'd', ctrl: true, shift: false, sequence: '\u0004' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('2 cursors')) throw new Error('Ctrl+D did not expose the multi-cursor state')
    act(() => { handleKey?.({ name: 'x', ctrl: false, shift: false, sequence: 'x' }) })
    await flush(setup, 150)
    if (editor.plainText.slice(firstAnswer, firstAnswer + 1) !== 'x'
      || editor.plainText.slice(secondAnswer - ('answer'.length - 1), secondAnswer - ('answer'.length - 2)) !== 'x') {
      throw new Error(`Typing with multiple cursors did not replace both occurrences: ${JSON.stringify(editor.plainText.slice(0, 70))}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    act(() => { editor.undo() })
    await flush(setup, 150)
    if (!editor.plainText.startsWith('const answer = 41')) throw new Error('Undo did not restore the multi-cursor bulk edit atomically')
    const explorerScrollbox = setup.renderer.root.findDescendantById('project-editor-explorer-scrollbox') as ScrollBoxRenderable | null
    if (!explorerScrollbox?.verticalScrollBar.visible || explorerScrollbox.scrollHeight <= explorerScrollbox.viewport.height) {
      throw new Error(`Explorer scrollbar was not visible for an overflowing tree: ${JSON.stringify({ scrollHeight: explorerScrollbox?.scrollHeight, viewportHeight: explorerScrollbox?.viewport.height, visible: explorerScrollbox?.verticalScrollBar.visible })}`)
    }
    const editorScrollbar = setup.renderer.root.findDescendantById('project-editor-scrollbar') as ScrollBarRenderable | null
    if (!editorScrollbar?.visible || editorScrollbar.scrollSize <= editorScrollbar.viewportSize) {
      throw new Error(`Editor scrollbar was not visible for an overflowing buffer: ${JSON.stringify({ scrollSize: editorScrollbar?.scrollSize, viewportSize: editorScrollbar?.viewportSize, visible: editorScrollbar?.visible })}`)
    }
    act(() => { editorScrollbar.slider.value = 5 })
    await flush(setup, 150)
    if (editor.scrollY <= 0 || editorScrollbar.scrollPosition !== editor.scrollY) {
      throw new Error(`Dragging the editor scrollbar did not synchronize its viewport: ${JSON.stringify({ editorScrollY: editor.scrollY, scrollbarPosition: editorScrollbar.scrollPosition })}`)
    }
    act(() => { editor.setCursor(1, 5) })
    await setup.flush()
    act(() => { setup.mockInput.pressKey('HOME') })
    await setup.flush()
    if (editor.logicalCursor.row !== 1 || editor.logicalCursor.col !== 0) {
      throw new Error(`Home did not move to the current line start: ${JSON.stringify(editor.logicalCursor)}`)
    }
    act(() => { setup.mockInput.pressKey('END') })
    if (editor.logicalCursor.row !== 1 || editor.logicalCursor.col !== 'const otherAnswer = answer + 1'.length) {
      throw new Error(`End did not move to line end: ${JSON.stringify(editor.logicalCursor)}`)
    }
    act(() => { editor.setCursor(2, '  const nested = true'.length) })
    await setup.flush()
    act(() => { handleKey?.({ name: 'home', ctrl: false, shift: false, sequence: '\u001b[H' }) })
    const smartHomeCursor: { row: number; col: number } = editor.logicalCursor
    if (smartHomeCursor.row !== 2 || smartHomeCursor.col !== 2) {
      throw new Error(`Smart Home did not move to the first non-whitespace column: ${JSON.stringify(smartHomeCursor)}`)
    }
    await setup.flush()
    act(() => { handleKey?.({ name: 'home', ctrl: false, shift: false, sequence: '\u001b[H' }) })
    if (editor.logicalCursor.col !== 0) throw new Error(`Second Smart Home did not toggle to column zero: ${JSON.stringify(editor.logicalCursor)}`)

    act(() => { editor.setCursor(1, 0) })
    act(() => { handleKey?.({ name: 'right', ctrl: false, shift: false, option: true, sequence: '\u001bf' }) })
    if (editor.logicalCursor.col <= 0) throw new Error(`Alt+Right did not move by a word: ${JSON.stringify(editor.logicalCursor)}`)
    act(() => { handleKey?.({ name: 'left', ctrl: true, shift: true, option: false, sequence: '\u001b[1;6D' }) })
    if (!editor.hasSelection()) throw new Error('Shift+Ctrl+Left did not extend a word selection')
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    if (editor.hasSelection()) throw new Error('Escape did not collapse the active word selection')

    act(() => { editor.setCursor(1, 5) })
    act(() => { handleKey?.({ name: 'right', ctrl: false, shift: true, option: true, sequence: '\u001b[1;10C' }) })
    if (!editor.hasSelection()) throw new Error('Shift+Alt+Right did not extend a block selection')
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    if (editor.hasSelection()) throw new Error('Escape did not collapse the active block selection')

    const answerOffset = editor.plainText.indexOf('answer')
    editor.setSelection(answerOffset, answerOffset + 'answer'.length)
    act(() => { handleKey?.({ name: 'c', ctrl: true, shift: false, sequence: '\u0003' }) })
    await flush(setup, 80)
    if (clipboardText !== 'answer') throw new Error(`Ctrl+C did not copy the editor selection: ${JSON.stringify(clipboardText)}`)
    editor.clearSelection()
    editor.setCursor(0, 'const answer = 41'.length)
    clipboardText = '_clipboard'
    act(() => { handleKey?.({ name: 'v', ctrl: true, shift: false, sequence: '\u0016' }) })
    await flush(setup, 80)
    if (!editor.plainText.startsWith('const answer = 41_clipboard')) throw new Error(`Ctrl+V did not insert clipboard text: ${JSON.stringify(editor.plainText.slice(0, 40))}`)
    act(() => { handleKey?.({ name: 'z', ctrl: true, shift: false, sequence: '\u001a' }) })
    if (!editor.plainText.startsWith('const answer = 41\n')) throw new Error('Ctrl+Z did not undo the clipboard insertion')
    act(() => { handleKey?.({ name: 'y', ctrl: true, shift: false, sequence: '\u0019' }) })
    if (!editor.plainText.startsWith('const answer = 41_clipboard')) throw new Error('Ctrl+Y did not redo the clipboard insertion')
    act(() => { handleKey?.({ name: 'z', ctrl: true, shift: false, sequence: '\u001a' }) })
    await flush(setup, 120)
    if (!editor.plainText.startsWith('const answer = 41\n')) throw new Error('A subsequent Ctrl+Z did not undo the redone insertion')

    act(() => { editor.clearSelection(); editor.setCursor(1, 20) })
    await flush(setup, 120)
    const occurrenceHighlights = [0, 1].flatMap((line) => editor.getLineHighlights(line)).filter((highlight) => highlight.hlRef === 41_001)
    if (occurrenceHighlights.length < 2) {
      throw new Error(`Word occurrences were not highlighted near the cursor: ${JSON.stringify(occurrenceHighlights)}`)
    }

    act(() => { handleKey?.({ name: 'end', ctrl: true, shift: false, sequence: '\u001b[1;5F' }) })
    if (editor.cursorOffset !== editor.plainText.length) throw new Error('Ctrl+End did not navigate to the document end')
    act(() => { handleKey?.({ name: 'home', ctrl: true, shift: false, sequence: '\u001b[1;5H' }) })
    if (editor.cursorOffset !== 0) throw new Error('Ctrl+Home did not navigate to the document start')

    act(() => { editor.setCursor(2, '  const nested = true'.length) })
    await setup.flush()
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await act(async () => { await setup.mockInput.typeText('keptIndent') })
    await setup.flush()
    if (!editor.plainText.includes('\n  keptIndent')) {
      throw new Error(`Enter did not preserve current indentation: ${JSON.stringify(editor.plainText)}`)
    }
    act(() => { handleKey?.({ name: '{', ctrl: false, shift: true, sequence: '{' }) })
    await setup.flush()
    const pairOffset = editor.cursorOffset
    if (editor.plainText.slice(pairOffset - 1, pairOffset + 1) !== '{}') {
      throw new Error(`Typing an opening delimiter did not insert a balanced pair: ${JSON.stringify(editor.plainText)}`)
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await act(async () => { await setup.mockInput.typeText('nestedValue') })
    await setup.flush()
    if (!editor.plainText.includes('{\n    nestedValue\n  }')) {
      throw new Error(`Enter between delimiters did not create an indented block: ${JSON.stringify(editor.plainText)}`)
    }
    const unwrappedLineCount = editor.editorView.getTotalVirtualLineCount()
    act(() => { handleKey?.({ name: 'z', ctrl: false, shift: false, option: true, sequence: 'z' }) })
    await flush(setup, 150)
    const wrappedLineCount = editor.editorView.getTotalVirtualLineCount()
    if (editor.wrapMode !== 'word' || wrappedLineCount <= unwrappedLineCount) {
      throw new Error(`Alt+Z did not enable word wrapping: ${JSON.stringify({ wrapMode: editor.wrapMode, before: unwrappedLineCount, after: wrappedLineCount })}`)
    }
    if (!notices.some((notice) => notice.message === 'Editor word wrap enabled')) {
      throw new Error(`Enabling word wrap did not emit a toast notice: ${JSON.stringify(notices)}`)
    }
    act(() => { handleKey?.({ name: 'z', ctrl: false, shift: false, option: true, sequence: 'z' }) })
    await flush(setup, 150)
    if (String(editor.wrapMode) !== 'none' || !notices.some((notice) => notice.message === 'Editor word wrap disabled')) {
      throw new Error(`Alt+Z did not disable word wrapping cleanly: ${JSON.stringify({ wrapMode: editor.wrapMode, notices })}`)
    }
    act(() => { editor.gotoBufferEnd() })
    await act(async () => { await setup.mockInput.typeText('\nconsole.') })
    await flush(setup, 800)
    const memberCompletionFrame = setup.captureCharFrame()
    if (!memberCompletionFrame.includes('completions 1/12') || !memberCompletionFrame.includes('log') || !memberCompletionFrame.includes('warn')) {
      throw new Error(`Member access did not open a code-aware LSP completion list at ${JSON.stringify(editor.logicalCursor)} / ${editor.cursorOffset}:\n${memberCompletionFrame}`)
    }
    if (!memberCompletionFrame.includes('Writes a log message.')) {
      throw new Error(`Selected member completion did not resolve documentation:\n${memberCompletionFrame}`)
    }
    for (let index = 0; index < 9; index += 1) {
      act(() => { handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '\u001b[B' }) })
    }
    await flush(setup, 200)
    const scrolledCompletionFrame = setup.captureCharFrame()
    if (!scrolledCompletionFrame.includes('completions 10/12') || !scrolledCompletionFrame.includes('trace') || !scrolledCompletionFrame.includes('error')) {
      throw new Error(`Completion selection did not keep the active item visible while scrolling:\n${scrolledCompletionFrame}`)
    }
    for (let index = 0; index < 9; index += 1) {
      act(() => { handleKey?.({ name: 'up', ctrl: false, shift: false, sequence: '\u001b[A' }) })
    }
    await flush(setup, 150)
    await act(async () => { await setup.mockInput.typeText('lo') })
    await flush(setup, 450)
    const filteredMemberFrame = setup.captureCharFrame()
    if (!filteredMemberFrame.includes('completions 1/1') || !filteredMemberFrame.includes('log') || filteredMemberFrame.includes('ƒ warn')) {
      throw new Error(`Typing a member prefix did not narrow the LSP list like an editor completion menu:\n${filteredMemberFrame}`)
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    await flush(setup, 150)
    if (!editor.plainText.startsWith('// completion import\n') || !editor.plainText.includes('console.log')) {
      throw new Error(`Accepting a member completion did not apply its range and additional edits: ${JSON.stringify(editor.plainText)}`)
    }
    act(() => {
      editor.gotoBufferEnd()
      editor.insertText("\nconst wide = '界'; console.")
    })
    await flush(setup, 800)
    const unicodeCompletionFrame = setup.captureCharFrame()
    if (!unicodeCompletionFrame.includes('completions 1/12') || !unicodeCompletionFrame.includes('log')) {
      throw new Error(`Unicode text before the cursor corrupted the LSP completion position at ${JSON.stringify(editor.logicalCursor)} / ${editor.cursorOffset}:\n${unicodeCompletionFrame}`)
    }
    const beforeStaleCompletion = editor.plainText
    const completionCursorBeforeMove = editor.logicalCursor
    act(() => { editor.setCursor(completionCursorBeforeMove.row, completionCursorBeforeMove.col - 1) })
    await setup.flush()
    if (editor.logicalCursor.col !== completionCursorBeforeMove.col - 1) {
      throw new Error(`Completion stale-cursor setup did not move the caret: ${JSON.stringify(editor.logicalCursor)}`)
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    await flush(setup, 120)
    if (editor.plainText !== beforeStaleCompletion || !setup.captureCharFrame().includes('Completion dismissed after the buffer or cursor changed')) {
      throw new Error(`A stale completion was applied after cursor movement:\n${setup.captureCharFrame()}`)
    }
    act(() => { editor.gotoBufferEnd() })
    await setup.flush()
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await act(async () => { await setup.mockInput.typeText('bad') })
    await flush(setup, 600)
    if (!setup.captureCharFrame().includes('badValue')) {
      throw new Error(`Invalid-edit completion fixture did not open:\n${setup.captureCharFrame()}`)
    }
    const beforeInvalidCompletion = editor.plainText
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    await flush(setup, 120)
    if (editor.plainText !== beforeInvalidCompletion || !setup.captureCharFrame().includes('Language server returned overlapping completion edits')) {
      throw new Error(`Overlapping completion edits corrupted the buffer:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'v', ctrl: false, shift: false, option: true, sequence: 'v' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('NORMAL')) throw new Error('Alt+V did not enable Vim Normal mode')
    if (!notices.some((notice) => notice.kind === 'info' && notice.message === 'Editor Vim mode enabled')) {
      throw new Error(`Enabling Vim mode did not emit a toast notice: ${JSON.stringify(notices)}`)
    }
    const answerLine = editor.plainText.split('\n').findIndex((line) => line.startsWith('const answer'))
    act(() => { editor.setCursor(answerLine, 5) })
    await setup.flush()
    act(() => { handleKey?.({ name: '0', ctrl: false, shift: false, sequence: '0' }) })
    if (editor.logicalCursor.col !== 0) throw new Error(`Vim 0 did not move to line start: ${JSON.stringify(editor.logicalCursor)}`)
    act(() => { handleKey?.({ name: 'a', ctrl: false, shift: true, sequence: 'A' }) })
    await act(async () => { await setup.mockInput.typeText(' // vim') })
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await setup.flush()
    if (!editor.plainText.includes('const answer = 41 // vim') || !setup.captureCharFrame().includes('NORMAL')) {
      throw new Error(`Vim A/Insert/Escape flow failed:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'v', ctrl: false, shift: false, option: true, sequence: 'v' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('INSERT')) throw new Error('Alt+V did not disable Vim mode')
    if (!notices.some((notice) => notice.message === 'Editor Vim mode disabled')) {
      throw new Error(`Disabling Vim mode did not emit a toast notice: ${JSON.stringify(notices)}`)
    }
    act(() => { handleKey?.({ name: 'V', ctrl: false, shift: true, sequence: 'V' }) })
    act(() => { handleKey?.({ name: 'V', ctrl: false, shift: true, sequence: 'V' }) })
    act(() => { handleKey?.({ name: 'b', ctrl: true, shift: false, sequence: '\u0002' }) })
    act(() => { handleKey?.({ name: 'b', ctrl: true, shift: false, sequence: '\u0002' }) })
    await setup.flush()
    for (const expectedNotice of [
      'Editor velocity scrolling enabled',
      'Editor velocity scrolling disabled',
      'Editor explorer disabled',
      'Editor explorer enabled',
    ]) {
      if (!notices.some((notice) => notice.message === expectedNotice)) {
        throw new Error(`Missing toggle toast ${expectedNotice}: ${JSON.stringify(notices)}`)
      }
    }

    const tabResult = (handleKey as ((key: EditorKeyEvent) => boolean) | null)?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' })
    if (tabResult !== false) throw new Error('Tab was intercepted instead of being left for the text editor')
    act(() => { handleKey?.({ name: 'e', ctrl: true, shift: false, sequence: '\u0005' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('EXPLORER')) throw new Error('Ctrl+E did not move focus to Explorer')
    act(() => { handleKey?.({ name: 'e', ctrl: true, shift: false, sequence: '\u0005' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('INSERT')) throw new Error('Ctrl+E did not move focus back to editor')

    await act(async () => {
      await setup.mockInput.typeText('// edited\n')
    })
    await flush(setup, 200)
    const dirtyFrame = setup.captureCharFrame()
    if (!dirtyFrame.includes('modified')) throw new Error(`Editor did not mark changed buffer dirty:\n${dirtyFrame}`)
    act(() => { handleKey?.({ name: 'q', ctrl: true, shift: false, sequence: '\u0011' }) })
    await setup.flush()
    if (closeCount !== 0 || !setup.captureCharFrame().includes('unsaved changes') || !setup.captureCharFrame().includes('main.ts')) {
      throw new Error('Editor did not guard Ctrl+Q while a buffer was dirty')
    }

    await act(async () => { await setup.mockInput.typeText('ans') })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await setup.flush()
    const completionFrame = setup.captureCharFrame()
    if (!completionFrame.includes('completions') || !completionFrame.includes('answer')) {
      throw new Error(`Buffer autocomplete did not open with the matching symbol:\n${completionFrame}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await setup.flush()

    await act(async () => {
      handleKey?.({ name: 's', ctrl: true, shift: false, sequence: '\u0013' })
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    await setup.flush()
    const written = await readFile(filePath, 'utf8')
    if (!written.includes('// edited')) throw new Error(`Ctrl+S did not write edited content: ${JSON.stringify(written)}`)
    if (!setup.captureCharFrame().includes('saved')) throw new Error('Editor did not return to saved state')

    act(() => { handleKey?.({ name: 'f', ctrl: true, shift: false, sequence: '\u0006' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('Find in file')) throw new Error('Ctrl+F did not open in-buffer search')
    for (const character of 'answer') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'c', ctrl: false, shift: false, option: true, sequence: 'c' }) })
    act(() => { handleKey?.({ name: 'c', ctrl: false, shift: false, option: true, sequence: 'c' }) })
    if (!notices.some((notice) => notice.message === 'Editor find match case enabled')
      || !notices.some((notice) => notice.message === 'Editor find match case disabled')) {
      throw new Error(`Find match-case toggles did not emit toast notices: ${JSON.stringify(notices)}`)
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await setup.flush()
    if (editor?.getSelectedText().toLowerCase() !== 'answer' || !setup.captureCharFrame().includes('/3')) {
      throw new Error(`Find did not select and count the first result:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    act(() => { handleKey?.({ name: 'g', ctrl: true, shift: false, sequence: '\u0007' }) })
    act(() => { handleKey?.({ name: '2', ctrl: false, shift: false, sequence: '2' }) })
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await setup.flush()
    if (editor?.logicalCursor.row !== 1) throw new Error(`Ctrl+G did not move to line 2: ${JSON.stringify(editor?.logicalCursor)}`)

    act(() => { handleKey?.({ name: 'r', ctrl: true, shift: false, sequence: '\u0012' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('Replace in file')) throw new Error('Ctrl+R did not open in-buffer replace')
    for (const character of 'filler') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    for (const character of 'entry') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, option: true, sequence: '\r' }) })
    await setup.flush()
    if (editor.plainText.includes('filler') || !editor.plainText.includes('const entry35 = 35')
      || !setup.captureCharFrame().includes('Replaced 36 occurrences')) {
      throw new Error(`Alt+Enter replace-all did not update every match atomically: ${JSON.stringify(editor.plainText)}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })

    act(() => { handleKey?.({ name: 'p', ctrl: true, shift: false, sequence: '\u0010' }) })
    act(() => { handleKey?.({ name: '>', ctrl: false, shift: true, sequence: '>' }) })
    await setup.flush()
    const commandFrame = setup.captureCharFrame()
    if (!commandFrame.includes('COMMANDS') || !commandFrame.includes('Find in File')) {
      throw new Error(`Unified quick open did not expose commands:\n${commandFrame}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })

    act(() => { handleKey?.({ name: 'p', ctrl: true, shift: false, sequence: '\u0010' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('Quick open')) throw new Error('Ctrl+P did not open file picker')

    for (const character of 'second.ts') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await flush(setup, 300)
    const secondFrame = setup.captureCharFrame()
    if (!secondFrame.includes('second.ts') || !secondFrame.includes('export const second')) {
      throw new Error(`Opening a second file did not switch buffers cleanly:\n${secondFrame}`)
    }
    act(() => { handleKey?.({ name: 'p', ctrl: true, shift: false, sequence: '\u0010' }) })
    act(() => { handleKey?.({ name: '#', ctrl: false, shift: true, sequence: '#' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('BUFFERS') || !setup.captureCharFrame().includes('main.ts')) {
      throw new Error(`Unified quick open did not expose open buffers:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    act(() => { handleKey?.({ name: 'tab', ctrl: true, shift: false, sequence: '\u0009' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('const answer')) throw new Error('Ctrl+Tab did not switch to the previous open file')
    act(() => { handleKey?.({ name: 'pagedown', ctrl: true, shift: false, sequence: '\u001b[6;5~' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('export const second')) throw new Error('Ctrl+PageDown did not switch to the next open file')

    act(() => { handleKey?.({ name: 'tab', ctrl: true, shift: false, sequence: '\u0009' }) })
    await flush(setup, 150)
    const navigationOrigin = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    act(() => { navigationOrigin?.setCursor(1, 8) })
    await setup.flush()
    act(() => { handleKey?.({ name: 'f2', ctrl: false, shift: false, sequence: '' }) })
    await flush(setup, 200)
    if (!setup.captureCharFrame().includes('Rename symbol') || !setup.captureCharFrame().includes('answer')) {
      throw new Error(`F2 did not prepare a symbol rename:\n${setup.captureCharFrame()}`)
    }
    for (let index = 0; index < 'answer'.length; index += 1) {
      act(() => { handleKey?.({ name: 'backspace', ctrl: false, shift: false, sequence: '\u007f' }) })
    }
    for (const character of 'renamedAnswer') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await flush(setup, 350)
    if (!navigationOrigin?.plainText.includes('const renamedAnswer = 41')
      || !navigationOrigin.plainText.includes('= renamedAnswer + 1')
      || !setup.captureCharFrame().includes('Renamed symbol to')) {
      throw new Error(`F2 rename did not apply all active-buffer workspace edits: ${JSON.stringify(navigationOrigin?.plainText)}`)
    }
    act(() => { navigationOrigin?.setCursor(1, 25) })
    await setup.flush()
    act(() => { handleKey?.({ name: 'f12', ctrl: false, shift: false, sequence: '' }) })
    await flush(setup, 300)
    const definitionEditor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!definitionEditor || !setup.captureCharFrame().includes('second.ts') || !definitionEditor.plainText.includes('renamedAnswer')
      || definitionEditor.logicalCursor.row !== 0 || definitionEditor.logicalCursor.col !== 13) {
      throw new Error(`F12 did not jump to the LSP definition: ${JSON.stringify({ frame: setup.captureCharFrame(), cursor: definitionEditor?.logicalCursor })}`)
    }
    act(() => { handleKey?.({ name: 't', ctrl: true, shift: false, sequence: '\u0014' }) })
    await flush(setup, 300)
    const returnedEditor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!returnedEditor || !setup.captureCharFrame().includes('main.ts')
      || returnedEditor.logicalCursor.row !== 1 || returnedEditor.logicalCursor.col !== 25) {
      throw new Error(`Ctrl+T did not restore the previous jump position: ${JSON.stringify({ frame: setup.captureCharFrame(), cursor: returnedEditor?.logicalCursor })}`)
    }
    act(() => { handleKey?.({ name: 'f12', ctrl: false, shift: true, sequence: '' }) })
    await flush(setup, 250)
    const referencesFrame = setup.captureCharFrame()
    if (!referencesFrame.includes('references 1/2') || !referencesFrame.includes('second.ts:1:14')) {
      throw new Error(`Shift+F12 did not show the multi-location reference picker:\n${referencesFrame}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await setup.flush()

    act(() => { handleKey?.({ name: '.', ctrl: false, shift: false, option: true, sequence: '.' }) })
    await flush(setup, 250)
    const actionsFrame = setup.captureCharFrame()
    if (!actionsFrame.includes('Code actions 1/2') || !actionsFrame.includes('Insert preferred fix')) {
      throw new Error(`Alt+. did not show preferred-first code actions:\n${actionsFrame}`)
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await flush(setup, 250)
    const actionEditor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!actionEditor?.plainText.includes('fixed') || !setup.captureCharFrame().includes('Applied code action')) {
      throw new Error(`Applying a direct-edit code action did not update the buffer: ${JSON.stringify(actionEditor?.plainText)}`)
    }
    act(() => { handleKey?.({ name: 'f', ctrl: false, shift: true, option: true, sequence: 'f' }) })
    await flush(setup, 250)
    if (!actionEditor.plainText.includes('\nCONST renamedAnswer') || !setup.captureCharFrame().includes('Formatted main.ts')) {
      throw new Error(`Shift+Alt+F did not apply document formatting edits: ${JSON.stringify(actionEditor.plainText)}`)
    }

    // Legacy/raw terminals (including Windows) expose Alt as `meta`, not
    // `option`; the portable modifier path must still open project search.
    act(() => { handleKey?.({ name: '/', ctrl: false, shift: false, meta: true, sequence: '\u001b/' }) })
    for (const character of 'renamedAnswer') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    await flush(setup, 500)
    const projectSearchFrame = setup.captureCharFrame()
    if (!projectSearchFrame.includes('Project search') || !projectSearchFrame.includes('3 matches')
      || !projectSearchFrame.includes('second.ts:1:14')) {
      throw new Error(`Project search did not merge unsaved open-buffer matches with disk results:\n${projectSearchFrame}`)
    }
    act(() => { handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '\u001b[B' }) })
    act(() => { handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '\u001b[B' }) })
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await flush(setup, 250)
    const projectSearchEditor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!projectSearchEditor || !setup.captureCharFrame().includes('second.ts')
      || projectSearchEditor.logicalCursor.row !== 0 || projectSearchEditor.logicalCursor.col !== 13) {
      throw new Error(`Opening a project-search result did not jump to its exact unsaved-buffer location: ${JSON.stringify(projectSearchEditor?.logicalCursor)}`)
    }
    projectSearchEditor.setSelection(0, 'export const renamedAnswer = true'.length)
    act(() => { handleKey?.({ name: '_', ctrl: true, shift: false, sequence: '\u001f' }) })
    await setup.flush()
    if (!projectSearchEditor.plainText.startsWith('// export const renamedAnswer')) {
      throw new Error(`Ctrl+/ did not comment the selected TypeScript line: ${JSON.stringify(projectSearchEditor.plainText)}`)
    }
    act(() => { handleKey?.({ name: '_', ctrl: true, shift: false, sequence: '\u001f' }) })
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    await setup.flush()
    if (!projectSearchEditor.plainText.startsWith('  export const renamedAnswer')) {
      throw new Error(`Tab did not indent the selected line: ${JSON.stringify(projectSearchEditor.plainText)}`)
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: true, sequence: '\u001b[Z' }) })
    await setup.flush()
    if (!projectSearchEditor.plainText.startsWith('export const renamedAnswer')) {
      throw new Error(`Shift+Tab did not outdent the selected line: ${JSON.stringify(projectSearchEditor.plainText)}`)
    }
    act(() => { handleKey?.({ name: 's', ctrl: false, shift: false, meta: true, sequence: '\u001bs' }) })
    await flush(setup, 250)
    const [savedMain, savedSecond] = await Promise.all([readFile(filePath, 'utf8'), readFile(secondFilePath, 'utf8')])
    if (!savedMain.includes('CONST renamedAnswer') || !savedSecond.includes('renamedAnswer')
      || !setup.captureCharFrame().includes('Saved all 2 modified files')) {
      throw new Error(`Raw Alt+S did not persist every dirty refactor buffer: ${JSON.stringify({ savedMain, savedSecond })}`)
    }

    act(() => { handleKey?.({ name: 'n', ctrl: true, shift: false, sequence: '\u000e' }) })
    for (const character of 'created.ts') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await flush(setup, 300)
    if (await readFile(join(cwd, 'created.ts'), 'utf8') !== ''
      || !setup.captureCharFrame().includes('Created created.ts')) {
      throw new Error(`Ctrl+N did not create and open a workspace file:\n${setup.captureCharFrame()}`)
    }
    await writeFile(join(cwd, 'created.ts'), 'export const external = 1\n', 'utf8')
    await flush(setup, 1_750)
    const createdEditor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (createdEditor?.plainText !== 'export const external = 1\n'
      || !setup.captureCharFrame().includes('Reloaded 1 externally changed file: created.ts')) {
      throw new Error(`Clean buffer did not auto-reload an external disk edit: ${JSON.stringify(createdEditor?.plainText)}`)
    }
    act(() => { createdEditor.insertText('local ') })
    await writeFile(join(cwd, 'created.ts'), 'export const external = 2\n', 'utf8')
    await flush(setup, 1_750)
    if (!setup.captureCharFrame().includes('disk changed')) throw new Error('Dirty external edit did not show a disk-conflict warning')
    act(() => { handleKey?.({ name: 's', ctrl: true, shift: false, sequence: '\u0013' }) })
    await flush(setup, 300)
    if (await readFile(join(cwd, 'created.ts'), 'utf8') !== 'export const external = 2\n'
      || !setup.captureCharFrame().includes('changed on disk')) {
      throw new Error('Stale Ctrl+S overwrote an external disk edit')
    }

    console.log('Editor popover edit/multi-cursor/project-search/LSP-refactor/safe-save/auto-reload/file-create/navigation/quick-open smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalTypeScriptLspBin == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalTypeScriptLspBin
  syntaxStyle.destroy()
  await rm(cwd, { recursive: true, force: true })
}

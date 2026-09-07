/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { disposeAllLspSessions } from './editorLspSession'

// Jumping to a symbol is the most common thing anyone does in a long file, and
// until now the editor could only go to a line number or a text match. This
// drives the real key path: App.tsx hands every key to the popover's handleKey
// first, so a binding that the popover declines is not a binding at all.

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-symbol-picker-'))
const filePath = join(cwd, 'main.ts')
const otherPath = join(cwd, 'other.ts')
const fakeLspPath = join(cwd, 'tsc')
const originalLspBin = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN

const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

try {
  await writeFile(filePath, [
    'export class Widget {',
    '  render() {}',
    '}',
    'export function helperFunction() {}',
    '',
  ].join('\n'), 'utf8')
  await writeFile(otherPath, 'export const remoteThing = 1\n', 'utf8')

  await writeFile(fakeLspPath, String.raw`#!/usr/bin/env node
let input = Buffer.alloc(0)
let documentUri = ''
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
const at = (line) => ({ start: { line, character: 0 }, end: { line, character: 6 } })
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
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {
      documentSymbolProvider: true, workspaceSymbolProvider: true,
    } } })
    if (message.method === 'textDocument/didOpen') documentUri = message.params.textDocument.uri
    if (message.method === 'textDocument/documentSymbol') send({ jsonrpc: '2.0', id: message.id, result: [
      { name: 'Widget', kind: 5, range: at(0), selectionRange: at(0), children: [
        { name: 'render', kind: 6, range: at(1), selectionRange: at(1) },
      ] },
      { name: 'helperFunction', kind: 12, range: at(3), selectionRange: at(3) },
    ] })
    if (message.method === 'workspace/symbol') send({ jsonrpc: '2.0', id: message.id, result: [
      { name: 'remoteThing', kind: 14, location: { uri: documentUri.replace('main.ts', 'other.ts'), range: at(0) } },
    ] })
  }
})
`, 'utf8')
  await chmod(fakeLspPath, 0o755)
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = fakeLspPath

  const setup = await testRender(
    <EditorPopover
      cwd={cwd}
      initialPath={filePath}
      theme={DARK_THEME}
      width={110}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onNotice={() => {}}
      onClipboardRead={async () => ''}
      onClipboardWrite={async () => {}}
    />,
    { width: 110, height: 30 },
  )

  const settle = async (ms = 400) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const press = async (key: EditorKeyEvent) => {
    await act(async () => { handleKey?.(key) })
    await settle(300)
  }
  const frame = () => setup.captureCharFrame()
  /**
   * Poll rather than sleep a fixed amount: an outline arrives when the fake
   * server answers, and a fixed wait makes the test pass or fail on machine
   * load. A flaky smoke is worse than none — it teaches people to re-run.
   */
  const waitForFrame = async (predicate: (rendered: string) => boolean, description: string, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate(frame())) return frame()
      await settle(100)
    }
    throw new Error(`Timed out waiting for ${description}:\n${frame()}`)
  }

  try {
    await settle(1_500)
    await settle(1_500)
    assert(handleKey, 'The editor never published a key handler')

    // Ctrl+Shift+O — the binding this exists to add.
    await press({ name: 'o', ctrl: true, shift: true, sequence: '' } as EditorKeyEvent)
    const opened = await waitForFrame((rendered) => rendered.includes('SYMBOLS IN FILE'), 'the symbol picker to open')
    assert(opened.includes('SYMBOLS IN FILE'), 'unreachable')
    const outline = await waitForFrame(
      (rendered) => ['Widget', 'render', 'helperFunction'].every((name) => rendered.includes(name)),
      'the outline to list every symbol',
    )
    // A nested symbol reads as nested, and carries its kind.
    const renderRow = outline.split('\n').find((row) => row.includes('render') && row.includes('method'))
    assert(renderRow, `A nested symbol lost its indent or its kind:\n${outline}`)
    assert(/\s{3}render/.test(renderRow), `A child symbol must be indented under its parent: ${JSON.stringify(renderRow)}`)

    // Typing filters the outline locally rather than re-querying.
    for (const character of 'helper') {
      await act(async () => { handleKey?.({ name: character, sequence: character } as EditorKeyEvent) })
    }
    const filtered = await waitForFrame(
      (rendered) => rendered.includes('helperFunction')
        && !rendered.split('\n').some((row) => row.includes('render') && row.includes('method')),
      'the outline to filter down to the typed symbol',
    )
    assert(filtered.includes('helperFunction'), 'unreachable')

    // Enter jumps to it — and the status bar is the proof, since the caret
    // moved within the same file.
    await press({ name: 'return', sequence: '\r' } as EditorKeyEvent)
    const jumped = await waitForFrame(
      (rendered) => !rendered.includes('SYMBOLS IN FILE') && /Ln 4,/.test(rendered),
      'the caret to land on the chosen symbol with the picker closed',
    )
    assert(/Ln 4,/.test(jumped), 'unreachable')

    // Alt+O searches the workspace, and its results name their own file.
    await press({ name: 'o', meta: true, sequence: '' } as EditorKeyEvent)
    await settle(400)
    for (const character of 'remote') {
      await act(async () => { handleKey?.({ name: character, sequence: character } as EditorKeyEvent) })
    }
    const workspace = await waitForFrame(
      (rendered) => rendered.includes('WORKSPACE SYMBOLS') && rendered.includes('remoteThing') && rendered.includes('other.ts'),
      'the workspace symbol search to answer, naming the file each symbol lives in',
    )
    assert(workspace.includes('remoteThing'), 'unreachable')

    await press({ name: 'escape', sequence: '' } as EditorKeyEvent)
    console.log('Editor symbol picker smoke passed (Ctrl+Shift+O outline, filter, jump, Alt+O workspace)')
  } finally {
    setup.renderer?.destroy?.()
    disposeAllLspSessions()
  }
} finally {
  if (originalLspBin == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalLspBin
  await rm(cwd, { recursive: true, force: true })
}

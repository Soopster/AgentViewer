/** @jsxImportSource @opentui/react */
// The editor's line-number gutter shows each row's own line number, scrolled
// anywhere in the file, with wrapping off and on.
//
// The gutter reads its numbers through a windowed getLineSources the editor
// installs on its textarea (installWindowedLineSources) instead of OpenTUI's
// fallback, which decoded every line of the buffer per paint. A wrong window
// paints plausible numbers against the wrong rows, so each visible row's number
// is checked against the line's own text ("line 1234").
import React from 'react'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, type SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { act, testRenderWithSyntaxStyle } from './testRender'
import { EditorPopover } from '../../plugins/editor/tui/EditorPopover'
import { DARK_THEME } from '../theme'

const LINES = 3000
const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-gutter-'))
process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = join(workspace, 'absent-language-server')
const sourcePath = join(workspace, 'notes.txt')
await writeFile(sourcePath, Array.from({ length: LINES }, (_, index) => `line ${index + 1}`).join('\n') + '\n', 'utf8')

let syntaxStyle!: SyntaxStyle
const setup = await testRenderWithSyntaxStyle({ default: { fg: RGBA.fromHex(DARK_THEME.text) } }, (style) => {
  syntaxStyle = style
  return <EditorPopover cwd={workspace} initialPath={sourcePath} theme={DARK_THEME} width={100} height={30} syntaxStyle={syntaxStyle} onClose={() => {}} onKeyHandlerReady={() => {}} />
}, { width: 100, height: 30 })
const settle = async (ms: number) => {
  const until = performance.now() + ms
  while (performance.now() < until) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
}
await settle(600)
const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
if (!editor) throw new Error('editor did not mount')

const check = (label: string) => {
  let rows = 0
  for (const row of setup.captureCharFrame().split('\n')) {
    const match = row.match(/(?:^|│)\s*(\d+)\s+line (\d+)\b/)
    if (!match) continue
    rows += 1
    if (match[1] !== match[2]) throw new Error(`${label}: gutter shows ${match[1]} beside "line ${match[2]}"\n${setup.captureCharFrame()}`)
  }
  if (rows < 10) throw new Error(`${label}: only ${rows} numbered rows found\n${setup.captureCharFrame()}`)
  return rows
}

const shown: string[] = []
for (const line of [0, 1500, LINES - 5]) {
  await act(async () => { editor.gotoLine(line) })
  await settle(250)
  shown.push(`${line + 1}:${check(`line ${line + 1}`)} rows`)
}
// Word wrap goes through OpenTUI's own full read; it must still agree.
await act(async () => { editor.wrapMode = 'word' })
await act(async () => { editor.gotoLine(2000) })
await settle(250)
shown.push(`wrapped:${check('word wrap')} rows`)
console.log(`Editor gutter smoke passed (${shown.join(', ')})`)
process.exit(0)

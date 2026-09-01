/** @jsxImportSource @opentui/react */
// A file the editor opens must be the whole file.
//
// The terminal edit buffer holds 1,048,576 characters and discards the rest
// without saying so, while the editor advertised a 2 MB limit: a 1.5 MB file
// opened as "Opened main.ts" with two thirds of it missing, and the editor
// then computed every offset, line number and language-server position against
// content that was not the file. Nothing else notices — a truncated buffer
// renders exactly like a short file.
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover } from './EditorPopover'

const BUFFER_LIMIT_CHARS = 1024 * 1024
const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-large-file-'))
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = join(workspace, 'absent-language-server')
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

function sourceOfBytes(target: number): string {
  const lines: string[] = []
  let size = 0
  for (let index = 0; size < target; index += 1) {
    const line = `export const value${index} = ${index}`
    lines.push(line)
    size += line.length + 1
  }
  return `${lines.join('\n')}\n`
}

async function open(path: string): Promise<{ text: string; frame: string; content: string | null }> {
  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={path}
      theme={DARK_THEME}
      width={100}
      height={28}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={() => {}}
    />,
    { width: 100, height: 28 },
  )
  try {
    const deadline = performance.now() + 8_000
    let editor: TextareaRenderable | null = null
    while (performance.now() < deadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
      editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
      if (editor || setup.captureCharFrame().includes('limit')) break
    }
    // Settle, so a buffer that mounts and is then rejected is seen as rejected.
    const settleDeadline = performance.now() + 1_200
    while (performance.now() < settleDeadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
    }
    editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    return { text: '', frame: setup.captureCharFrame(), content: editor?.plainText ?? null }
  } finally {
    act(() => setup.renderer.destroy())
  }
}

try {
  // Both files exist before the first render: the project listing is cached
  // per workspace, so a file written between renders would never be listed.
  const fittingPath = join(workspace, 'fits.ts')
  const fitting = sourceOfBytes(BUFFER_LIMIT_CHARS - 64 * 1024)
  await writeFile(fittingPath, fitting, 'utf8')
  const oversizePath = join(workspace, 'oversize.ts')
  const oversize = sourceOfBytes(BUFFER_LIMIT_CHARS + 512 * 1024)
  await writeFile(oversizePath, oversize, 'utf8')

  // Comfortably inside the buffer's capacity: must open, whole.
  const fits = await open(fittingPath)
  if (fits.content == null) throw new Error(`A file inside the buffer limit did not open:\n${fits.frame}`)
  if (fits.content !== fitting) {
    throw new Error(`A file inside the buffer limit opened with ${fits.content.length} of ${fitting.length} characters`)
  }
  console.log(`A ${(fitting.length / 1024).toFixed(0)}KB file opens with every character intact.`)

  // Past capacity: must be refused outright, never presented truncated.
  const over = await open(oversizePath)
  if (over.content != null) {
    throw new Error(
      `A ${(oversize.length / 1024 / 1024).toFixed(1)}MB file opened with ${over.content.length}`
      + ` of ${oversize.length} characters instead of being refused:\n${over.frame}`,
    )
  }
  if (!/limit|truncat|did not fit/i.test(over.frame)) {
    throw new Error(`A file past the buffer limit was refused without telling the user why:\n${over.frame}`)
  }
  console.log('A file past the buffer limit is refused, with a message, rather than opened truncated.')
  console.log('Editor large-file smoke passed')
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}

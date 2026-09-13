/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-many-tabs-'))
const names = Array.from({ length: 14 }, (_, index) => `module-number-${String(index).padStart(2, '0')}.ts`)
for (const name of names) await writeFile(join(cwd, name), `export const x = ${name.length}\n`, 'utf8')

let keyHandler: ((key: EditorKeyEvent) => boolean) | null = null
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })
const setup = await testRender(
  <EditorPopover cwd={cwd} initialPath={join(cwd, names[0]!)} theme={DARK_THEME} width={110} height={28}
    syntaxStyle={syntaxStyle} onClose={() => {}} onKeyHandlerReady={(h) => { keyHandler = h }}
    onNotice={() => {}} onClipboardRead={async () => ''} onClipboardWrite={async () => {}} />,
  { width: 110, height: 28 },
)
const settle = async (ms = 250) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
  await act(async () => { await setup.flush() })
}
const press = async (key: EditorKeyEvent) => {
  const handler = keyHandler as ((key: EditorKeyEvent) => boolean) | null
  await act(async () => { handler?.(key) })
  await settle(150)
}
await settle(1200); await settle(1200)

for (const name of names.slice(1)) {
  await press({ name: 'p', ctrl: true, sequence: '' } as EditorKeyEvent)
  for (const ch of name.slice(0, 16)) await press({ name: ch, sequence: ch } as EditorKeyEvent)
  await press({ name: 'return', sequence: '\r' } as EditorKeyEvent)
  await settle(200)
}
await settle(400)

const frame = setup.captureCharFrame().split('\n')
console.log('tab row     :', JSON.stringify(frame[1]))
console.log('row width   :', frame[1]?.length, 'terminal width: 110')
const visible = (frame[1] ?? '').match(/module-number-\d\d/g) ?? []
console.log('tabs opened : 14 | names visible in the tab row:', visible.length, visible.join(','))
console.log('active tab visible:', (frame[1] ?? '').includes('module-number-13'))
await rm(cwd, { recursive: true, force: true })
process.exit(0)

/** @jsxImportSource @opentui/react */
// The surface panel beside the reader or under it (`|`), read from the laid-out
// frames rather than the characters: a panel laid over the transcript or the
// composer looks like content either way, so only geometry tells.
import React from 'react'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// Hermetic: state files resolve from process.cwd(). Import App AFTER chdir.
const workspace = mkdtempSync(path.join(tmpdir(), 'agent-viewer-surface-placement-'))
process.chdir(workspace)
const { default: OpenTuiApp } = await import('./App')

const WIDTH = 160
const HEIGHT = 48
const setup = await testRender(<OpenTuiApp />, { width: WIDTH, height: HEIGHT, kittyKeyboard: true })
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
type Frame = { x: number; y: number; width: number; height: number }
// A snapshot: the renderable is live, and a later layout would rewrite a held reference.
const frame = (id: string): Frame | null => {
  const box = setup.renderer.root.findDescendantById(id) as unknown as Frame | null
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}
const describe = (box: Frame | null) => box ? `${box.x},${box.y} ${box.width}x${box.height}` : 'missing'
const press = async (sequence: string, options: { shift?: boolean } = {}) => {
  act(() => { setup.mockInput.pressKey(sequence, options) })
  await settle(300)
}

try {
  await settle(2500)
  await press('O', { shift: true })
  const beside = frame('surface-panel-frame')
  const readerBeside = frame('transcript-reader')
  assert(beside && readerBeside && beside.x + beside.width === WIDTH && beside.x >= readerBeside.x + readerBeside.width,
    `the panel does not open beside the reader: panel ${describe(beside)}, reader ${describe(readerBeside)}`)

  await press('|')
  const under = frame('surface-panel-frame')
  if (process.env.DUMP_FRAME) console.log(setup.captureCharFrame())
  const reader = frame('transcript-reader')
  const composer = frame('composer-dock')
  assert(under && reader && composer, `frames missing: panel ${describe(under)}, reader ${describe(reader)}, composer ${describe(composer)}`)
  assert(under.y >= reader.y + reader.height, `the panel overlaps the transcript: panel ${describe(under)}, reader ${describe(reader)}`)
  assert(under.y + under.height <= composer.y, `the panel overlaps the composer: panel ${describe(under)}, composer ${describe(composer)}`)
  assert(under.x === reader.x && under.width === reader.width, `the panel does not span the reader: panel ${describe(under)}, reader ${describe(reader)}`)
  assert(reader.width > readerBeside.width, 'under the reader, the panel must give the reader its width back')
  assert(setup.captureCharFrame().includes('Panel · under'), 'the panel title does not say where it is')
  console.log('| puts the panel under the reader, between the transcript and the composer, at the reader\'s width.')

  const rows = under.height
  await press('+')
  const taller = frame('surface-panel-frame')!
  const shorterReader = frame('transcript-reader')!
  assert(taller.height === rows + 2 && shorterReader.height === reader.height - 2, `+ did not trade two reader rows for panel rows: ${describe(taller)} / ${describe(shorterReader)}`)
  console.log('+ and - resize it in rows when it is under the reader.')

  const stored = JSON.parse(readFileSync(path.join(workspace, '.agent-viewer-data', 'tui.json'), 'utf8')) as { surfacePanelPlacement?: string }
  assert(stored.surfacePanelPlacement === 'bottom', `placement was not stored: ${JSON.stringify(stored.surfacePanelPlacement)}`)

  await press('|')
  const back = frame('surface-panel-frame')
  assert(back && back.x + back.width === WIDTH && back.y === beside.y, `| did not move the panel back beside the reader: ${describe(back)}`)
  console.log('| moves it back, and the choice is kept in tui.json.')
  console.log('Surface panel placement smoke passed')
} finally {
  act(() => setup.renderer.destroy())
}
process.exit(0)

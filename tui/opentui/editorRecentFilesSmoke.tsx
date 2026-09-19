/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

// Ctrl+P with nothing typed used to list whatever the file walk produced first,
// because every fuzzy score is 0 for an empty query. In a repository of any
// size that is a list of files you have never opened. The files you have been
// working in come first instead, most recent at the top.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-recent-'))
let keyHandler: ((key: EditorKeyEvent) => boolean) | null = null
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

try {
  // Enough files that an unordered list would not put ours near the top, and
  // named so alphabetical order does not accidentally do the job for us.
  for (let index = 0; index < 40; index += 1) {
    await writeFile(join(cwd, `aaa-filler-${String(index).padStart(2, '0')}.txt`), `filler ${index}\n`, 'utf8')
  }
  await writeFile(join(cwd, 'zeta-worked-in.txt'), 'one\n', 'utf8')
  await writeFile(join(cwd, 'yankee-worked-in.txt'), 'two\n', 'utf8')

  const setup = await testRender(
    <EditorPopover cwd={cwd} initialPath={join(cwd, 'aaa-filler-00.txt')} theme={DARK_THEME}
      width={110} height={30} syntaxStyle={syntaxStyle} onClose={() => {}}
      onKeyHandlerReady={(handler) => { keyHandler = handler }} onNotice={() => {}}
      onClipboardRead={async () => ''} onClipboardWrite={async () => {}} />,
    { width: 110, height: 30 },
  )
  const settle = async (ms = 300) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const press = async (key: EditorKeyEvent) => {
    const handler = keyHandler as ((key: EditorKeyEvent) => boolean) | null
    assert(handler, 'The editor never published a key handler')
    await act(async () => { handler(key) })
    await settle(200)
  }
  const type = async (text: string) => {
    for (const character of text) await press({ name: character, sequence: character } as EditorKeyEvent)
  }
  /**
   * Row order of the quick-open list as rendered. Scoped to the rows below the
   * list's own header: the tab bar and the explorer show filenames too, and
   * scraping the whole frame reads those as results.
   */
  const listedFiles = () => {
    const rows = setup.captureCharFrame().split('\n')
    const header = rows.findIndex((row) => row.includes('FILES'))
    if (header === -1) return []
    // The explorer tree sits to the LEFT of the overlay on the same rows and
    // lists filenames too, so a row-wide match reads the tree instead of the
    // results. Only the columns from the overlay's own left edge count.
    const left = rows[header]!.indexOf('FILES')
    return rows.slice(header + 1)
      .map((row) => /(?:aaa-filler-\d\d|zeta-worked-in|yankee-worked-in)\.txt/.exec(row.slice(left))?.[0])
      .filter((name): name is string => Boolean(name))
  }

  try {
    await settle(1_500)
    await settle(1_500)

    // Open two files, so there is a history to order by.
    for (const name of ['zeta-worked-in.txt', 'yankee-worked-in.txt']) {
      await press({ name: 'p', ctrl: true, sequence: '' } as EditorKeyEvent)
      await settle(250)
      await type(name.slice(0, 6))
      await settle(350)
      await press({ name: 'return', sequence: '\r' } as EditorKeyEvent)
      await settle(500)
    }

    await press({ name: 'p', ctrl: true, sequence: '' } as EditorKeyEvent)
    await settle(600)
    const listed = listedFiles()
    assert(listed.length > 0, `The quick-open list rendered no files:\n${setup.captureCharFrame()}`)
    // Most recent first: yankee was opened last.
    assert(listed[0] === 'yankee-worked-in.txt',
      `The most recently opened file must be first: ${JSON.stringify(listed.slice(0, 4))}`)
    assert(listed[1] === 'zeta-worked-in.txt',
      `The next most recent file must be second: ${JSON.stringify(listed.slice(0, 4))}`)

    // Typing still ranks by match, not by recency: a query that only the filler
    // files match must not be outranked by the recent ones.
    await type('filler-07')
    await settle(500)
    const filtered = listedFiles()
    assert(filtered[0] === 'aaa-filler-07.txt',
      `A typed query must outrank recency: ${JSON.stringify(filtered.slice(0, 3))}`)

    console.log('Editor recent-files smoke passed (empty query lists what you were working in)')
    await settle(300)
  } finally {
    setup.renderer?.destroy?.()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
process.exit(0)

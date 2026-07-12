/** @jsxImportSource @opentui/react */
// Manual smoke for the GitPopover-style PR review popover. Non-hermetic: needs
// `gh` auth and an open PR on this repo, so it is not part of `tui:smoke`.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { PullRequestPopover } from './PullRequestPopover'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
let handleKey: ((key: Key) => void) | null = null

const setup = await testRender(
  <PullRequestPopover
    cwd={process.cwd()}
    theme={DARK_THEME}
    width={170}
    height={45}
    onClose={() => {}}
    onKeyHandlerReady={(handler) => { handleKey = handler }}
    onAskAgent={() => {}}
  />,
  { width: 170, height: 45 },
)

async function flush(ms = 200) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
  await setup.flush()
}

function press(name: string, mods: Partial<Key> = {}) {
  return act(async () => { handleKey?.({ name, ctrl: false, shift: false, sequence: name, ...mods }) })
}

try {
  // gh calls take a while — poll until the PR header lands in [1] Overview.
  let frame = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    await flush(500)
    frame = setup.captureCharFrame()
    if (/#\d+ /.test(frame) && !frame.includes('loading…')) break
  }
  if (!/#\d+ /.test(frame)) throw new Error(`PR never loaded:\n${frame}`)
  for (const section of ['[1] Overview', '[2] Files', '[3] Discussion', '[4] Pull requests']) {
    if (!frame.includes(section)) throw new Error(`Missing section ${section}:\n${frame}`)
  }
  if (!frame.includes('shift-tab return left')) throw new Error(`Diff pane should start focused:\n${frame}`)

  const readIndicator = (text: string): { bottom: number; total: number } => {
    const match = /(\d+)\/(\d+)\s+file \d+\//.exec(text)
    if (!match) throw new Error(`Missing scroll/file indicator:\n${text}`)
    return { bottom: Number(match[1]), total: Number(match[2]) }
  }
  const initial = readIndicator(frame)

  // G jumps to the end of the whole-PR diff, g returns to the top.
  await press('g', { shift: true })
  await flush()
  frame = setup.captureCharFrame()
  const atEnd = readIndicator(frame)
  if (atEnd.bottom !== atEnd.total) throw new Error(`G did not reach the end (${atEnd.bottom}/${atEnd.total})`)
  await press('g')
  await flush()
  frame = setup.captureCharFrame()
  if (readIndicator(frame).bottom !== initial.bottom) throw new Error(`g did not return to the top:\n${frame}`)

  // Shift+J jumps to the next file.
  await press('j', { shift: true })
  await flush()
  frame = setup.captureCharFrame()
  if (!frame.includes('file 2/')) throw new Error(`Shift+J did not jump to file 2:\n${frame}`)

  // z folds the current file.
  await press('z')
  await flush()
  frame = setup.captureCharFrame()
  if (!frame.includes('▸')) throw new Error(`Collapse marker not shown after z:\n${frame}`)
  await press('z')
  await flush()

  // 3 activates the Discussion section and moves focus left.
  await press('3', { sequence: '3' })
  await flush()
  frame = setup.captureCharFrame()
  if (!frame.includes('tab focus right')) throw new Error(`Section key did not move focus left:\n${frame}`)
  if (!frame.includes('Discussion')) throw new Error(`Discussion pane label missing:\n${frame}`)

  // Back to the diff; a on a code line opens the inline note composer (Esc cancels).
  await press('tab')
  await flush()
  for (let i = 0; i < 4; i++) await press('j')
  await press('a', { sequence: 'a' })
  await flush()
  frame = setup.captureCharFrame()
  if (!frame.includes('Enter submit')) throw new Error(`Inline note composer did not open:\n${frame}`)
  await press('escape')
  await flush()
  frame = setup.captureCharFrame()
  if (frame.includes('Enter submit')) throw new Error(`Esc did not close the composer:\n${frame}`)

  console.log('PR popover GitPopover-style smoke passed')
} finally {
  act(() => { setup.renderer.destroy() })
}

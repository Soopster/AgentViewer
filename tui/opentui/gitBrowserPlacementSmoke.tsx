/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../lib/git/command'
import { GitPopover } from '../../plugins/git/tui/GitPopover'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'

const cwd = await mkdtemp(join(tmpdir(), 'git-placement-'))
try {
  await git(cwd, ['init', '-q'])
  await writeFile(join(cwd, 'sample.txt'), 'visible change\n')
  for (const docked of [false, true]) {
    const view = <GitPopover cwd={cwd} docked={docked} width={docked ? 100 : 120} height={docked ? 32 : 40} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={() => {}} />
    const setup = await testRender(docked
      ? <box width={120} height={40} flexDirection="column"><box height={4} flexShrink={0}><text>App header</text></box><box height={32} flexDirection="row"><box width={20} flexShrink={0}><text>Sidebar</text></box><box id="git-host" width={100} height={32}>{view}</box></box><box height={4} flexShrink={0}><text>Composer dock</text></box></box>
      : <box width={120} height={40} flexDirection="column"><box id="transcript" height={34} flexShrink={0}><text>Transcript</text></box><box id="composer" height={6} flexShrink={0}><text>Composer dock</text></box>{view}</box>,
      { width: 120, height: 40 })
    const checkBounds = () => {
      const browser = setup.renderer.root.findDescendantById('git-browser')!
      assert(browser, 'browser mounted')
      assert.equal(browser.x, docked ? 20 : 0, 'browser starts at host left edge')
      assert.equal(browser.y, docked ? 4 : 0, 'browser starts at host top edge, regardless of preceding content')
      assert(browser.x + browser.width <= 120 && browser.y + browser.height <= 40, 'browser remains inside the terminal')
      if (!docked) assert.equal(setup.renderer.root.findDescendantById('composer')!.y, 34, 'overlay does not displace composer')
    }
    try {
      await setup.flush(); checkBounds()
      for (let i = 0; i < 20 && !setup.captureCharFrame().includes('File Tree'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await setup.flush() })
      checkBounds()
      assert(setup.captureCharFrame().includes('File Tree'), `Git details visible in ${docked ? 'docked' : 'overlay'} placement:\n${setup.captureCharFrame()}`)
      const lines = setup.captureCharFrame().split('\n')
      const headerRow = lines.findIndex(line => line.includes('[Repo]'))
      assert(headerRow >= (docked ? 4 : 0) && headerRow <= (docked ? 5 : 2), 'Git header remains near host top')
    } finally { act(() => setup.renderer.destroy()) }
  }
  console.log('Git placement passed: loading and loaded overlays after transcript/composer, plus docked windows offset from terminal origin.')
} finally { await rm(cwd, { recursive: true, force: true }) }

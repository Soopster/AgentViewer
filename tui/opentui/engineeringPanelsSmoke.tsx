/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React from 'react'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { EngineeringRail } from './engineering/EngineeringFrame'
import { EngineeringChanges } from './engineering/EngineeringChanges'
import { ENGINEERING_DEFAULTS } from './engineering/model'

const noop = () => {}
const sessions = Array.from({ length: 150 }, (_, index) => ({ sessionId: `session-${index}`, provider: 'claude' as const, summary: `Engineering task ${index}`, lastModified: 0 }))
const rail = await testRender(<EngineeringRail sessions={sessions} running={[]} recent={new Set()} attention={[]}
  selected={null} width={28} height={30} theme={DARK_THEME} preferences={ENGINEERING_DEFAULTS}
  onPreferences={noop} onSelect={noop} onNavigate={noop} onFocus={noop} enabled={false} registerKeys={noop} />, { width: 28, height: 30 })
try {
  await act(async () => { await rail.flush() })
  const lines = rail.captureCharFrame().split('\n')
  assert.match(lines[1]!, /SESSIONS · 150/)
  assert.match(lines[2]!, /Search sessions/)
  assert.match(lines[3]!, /all.*input.*run.*pin/)
  assert.match(lines[4]!, /RECENT/)
} finally { await act(async () => { rail.renderer.destroy() }) }

const files = Array.from({ length: 60 }, (_, index) => ({ path: `src/long-directory/changed-file-${index}.ts`, status: ' M', additions: '12', deletions: '3' }))
const changes = await testRender(<box width={48} height={38}><EngineeringChanges files={files}
  width={48} height={38} theme={DARK_THEME} selectedPath={files[50]!.path}
  patch={'@@ -1 +1 @@\n-before\n+after-visible-in-preview\n'} evidence={[]}
  focused={false} editing={false} onSelect={noop} onReview={noop} onJump={noop}
  onBeginEdit={noop} onEndEdit={noop} onAppend={noop} /></box>, { width: 48, height: 38 })
try {
  await act(async () => { await changes.flush() })
  const frame = changes.captureCharFrame()
  assert.match(frame, /after-visible-in-preview/, 'A long file list must not push the selected diff off screen')
  assert.match(frame, /Comment · Enter adds to composer/)
  const diff = changes.renderer.root.findDescendantById('engineering-diff-preview')!
  const input = changes.renderer.root.findDescendantById('engineering-input:comment')!
  assert.ok(diff.height >= 10, 'The diff owns a useful independent viewport')
  assert.ok(input.y >= diff.y + diff.height, 'The comment field stays below the diff viewport')
} finally { await act(async () => { changes.renderer.destroy() }) }
const single = await testRender(<box width={48} height={38}><EngineeringChanges files={files.slice(0, 1)}
  width={48} height={38} theme={DARK_THEME} selectedPath={files[0]!.path}
  patch={'+single-file-preview\n'} evidence={[]} focused={false} editing={false}
  onSelect={noop} onReview={noop} onJump={noop} onBeginEdit={noop} onEndEdit={noop} onAppend={noop} /></box>, { width: 48, height: 38 })
try {
  await act(async () => { await single.flush() })
  const frame = single.captureCharFrame()
  assert.match(frame, /1 changed file/)
  const preview = single.renderer.root.findDescendantById('engineering-diff-preview')!
  assert.ok(preview.y <= 6, 'One changed file must not reserve an empty tall file list')
  assert.ok(preview.height >= 25, 'The preview receives the freed rows')
} finally { await act(async () => { single.renderer.destroy() }) }
console.log('Engineering crowded sidebar and independent file/diff viewport smoke passed')
process.exit(0)

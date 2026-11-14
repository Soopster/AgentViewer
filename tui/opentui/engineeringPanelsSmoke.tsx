/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React from 'react'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { inspectorTabLabel } from './engineering/EngineeringFrame'
import { EngineeringChanges, type EngineeringChangesHandle } from './engineering/EngineeringChanges'

const noop = () => {}
assert.equal(inspectorTabLabel('handoff', 48), 'hand', 'A 48-column inspector uses short tab labels so the strip is one row')
assert.equal(inspectorTabLabel('handoff', 64), 'handoff')

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
  assert.match(frame, /Comment.*Enter adds to composer/)
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
  assert.ok(preview.y <= 7, 'One changed file must not reserve an empty tall file list')
  assert.ok(preview.height >= 24, 'The preview receives the freed rows')
} finally { await act(async () => { single.renderer.destroy() }) }
const longLine = `+${'x'.repeat(120)}`
const handle = React.createRef<EngineeringChangesHandle>()
const review = await testRender(<box width={48} height={38}><EngineeringChanges files={files.slice(0, 3)} sessionFiles={new Set([files[1]!.path])}
  width={48} height={38} theme={DARK_THEME} selectedPath={files[1]!.path} handleRef={handle} root={process.cwd()}
  patch={['diff --git a/f.ts b/f.ts', 'index 1111111..2222222 100644', '--- a/f.ts', '+++ b/f.ts', '@@ -1 +1 @@', '-old', '+new', '@@ -40,2 +40,2 @@ second()', ' ctx', '-gone', longLine, ''].join('\n')}
  evidence={[]} focused={false} editing={false} onSelect={noop} onReview={noop} onJump={noop} onBeginEdit={noop} onEndEdit={noop} onAppend={noop} onToggleScope={noop} /></box>, { width: 48, height: 38 })
try {
  await act(async () => { await review.flush() })
  assert.equal(handle.current?.hunkLine(), 1, 'The cursor starts on the first hunk')
  await act(async () => { assert.ok(handle.current?.moveHunk(1)); await review.flush() })
  await act(async () => { await review.flush() })
  const frame = review.captureCharFrame()
  assert.equal(handle.current?.hunkLine(), 40, 'n moves to the second hunk')
  assert.doesNotMatch(frame, /diff --git|index 1111111|\+\+\+ b\/f/, 'File headers that restate the file are not drawn')
  assert.match(frame, /changed-file-1\.ts ●/, "This session's file is marked")
  assert.match(frame, /● 1 mine/)
  assert.match(frame, /hunk 2\/2/)
  assert.match(frame, /▶@ @@ -40,2 \+40,2 @@ second\(\)/, 'The selected hunk carries the cursor, drawn by the shared row')
  assert.match(frame, /40 40\s+ctx/, 'Context lines carry old and new numbers')
  assert.match(frame, /41\s+- gone/, 'Deletions carry the old number and the Git view indicator')
  const wrapped = frame.split('\n').filter(line => /x{10}/.test(line))
  assert.ok(wrapped.length >= 2, 'A long line wraps onto continuation rows')
  assert.ok(wrapped.slice(1).every(line => /^\s{8}x/.test(line)), 'Continuations stay in the code column, under the gutter')
  assert.match(frame, /\[\+\] Show 20 preceding lines \(38 hidden\)/, 'Omitted context is offered, as in the Git view')
  assert.equal(handle.current?.moveHunk(5), true)
  assert.equal(handle.current?.hunkLine(), 40, 'Stepping past the last hunk stays on it')
} finally { await act(async () => { review.renderer.destroy() }) }
console.log('Engineering independent file/diff viewport smoke passed')
process.exit(0)

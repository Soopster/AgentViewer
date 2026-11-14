/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { EngineeringChanges, type EngineeringChangesHandle } from './engineering/EngineeringChanges'
import { buildGitFileTree, gitFileTreeDirectories } from './gitFileTree'
import { SpacesController } from './spacesStore'
import { WorkspaceContext } from './workspaceContext'

const files = ['docs/guide.md', 'tui/opentui/app/A.ts', 'tui/opentui/engineering/B.ts', 'package.json'].map(path => ({ path, status: path.endsWith('A.ts') ? '??' : ' M', additions: '2', deletions: '1' }))
const entries = files.map(file => ({ path: file.path, x: file.status[0]!, y: file.status[1]! }))
const nodes = buildGitFileTree(entries, gitFileTreeDirectories(entries))
assert.deepEqual(nodes.filter(node => node.kind === 'dir').map(node => node.name), ['docs', 'tui/opentui', 'app', 'engineering'])
assert.equal(nodes.at(-1)?.path, 'package.json', 'Directories precede root files')
const fixture = mkdtempSync(join(tmpdir(), 'engineering-tree-'))
const controller = new SpacesController(fixture)
const space = controller.activeSpace() ?? controller.addSpace(fixture)
const runtime = controller.runtime(controller.activeWorkspace()!)
const handle = React.createRef<EngineeringChangesHandle>()
let selected = files[1]!.path
let remount: () => void
let refresh: () => void
function Fixture() {
  const [path, setPath] = useState(selected)
  const [placement, setPlacement] = useState(false)
  const [currentFiles, setFiles] = useState(files)
  remount = () => setPlacement(value => !value)
  refresh = () => setFiles(value => [...value])
  return <WorkspaceContext.Provider value={{ controller, space, runtime }}>
    <EngineeringChanges key={String(placement)} files={currentFiles} width={60} height={36} theme={DARK_THEME} root={fixture}
      selectedPath={path} handleRef={handle} focused editing={false} evidence={[]} patch={'@@ -1 +1 @@\n-old\n+new\n@@ -40 +40 @@\n-before\n+after\n'}
      onSelect={next => { selected = next; setPath(next) }} onReview={() => {}} onJump={() => {}} onBeginEdit={() => {}} onEndEdit={() => {}} onAppend={() => {}} />
  </WorkspaceContext.Provider>
}
const setup = await testRender(<Fixture />, { width: 60, height: 36 })
const settle = async () => { await act(async () => { await setup.flush() }) }
const key = async (name: string) => {
  await act(async () => { assert.ok(handle.current?.handleTreeKey(name)) })
  await settle()
}
try {
  await settle()
  assert.match(setup.captureCharFrame(), /tui\/opentui/)
  assert.equal(handle.current?.fileCursor(), 'tui/opentui/app/A.ts')
  await key('left')
  assert.equal(handle.current?.fileCursor(), null, 'Left selects parent without replacing the diff')
  await key('left')
  assert.doesNotMatch(setup.captureCharFrame(), /\? A\.ts/, 'Left collapses the directory')
  assert.equal(selected, 'tui/opentui/app/A.ts', 'Directory selection preserves the diff')
  await act(async () => { refresh!(); remount!() })
  await settle()
  assert.doesNotMatch(setup.captureCharFrame(), /\? A\.ts/, 'Refresh and moving presentation retain directory folds')
  await key('right')
  assert.match(setup.captureCharFrame(), /\? A\.ts/)
  await key('right')
  assert.equal(handle.current?.fileCursor(), 'tui/opentui/app/A.ts')
  await act(async () => { handle.current?.moveHunk(1) })
  await settle()
  assert.equal(handle.current?.hunkLine(), 40)
  await act(async () => { remount!() })
  await settle()
  assert.equal(handle.current?.hunkLine(), 40, 'Moving presentation retains the selected hunk')
  const docs = setup.renderer.root.findDescendantById('engineering-tree:dir:docs')!
  await act(async () => { await setup.mockMouse.click(docs.x + 3, docs.y) })
  await settle()
  assert.doesNotMatch(setup.captureCharFrame(), /M guide\.md/, 'Clicking a folder collapses it')
  assert.equal(handle.current?.fileCursor(), null)
  console.log('Engineering tree ordering, mouse/keyboard folders, polling, diff selection and presentation-state smoke passed')
} finally {
  await act(async () => { setup.renderer.destroy() })
  controller.flush()
  rmSync(fixture, { recursive: true, force: true })
}
process.exit(0)

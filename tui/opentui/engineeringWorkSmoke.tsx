/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import type { TextareaRenderable, ScrollBoxRenderable } from '@opentui/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DARK_THEME } from '../theme'
import type { TuiTranscriptCard } from '../format'
import { act, testRender } from './testRender'
import { WorkspaceContext } from './workspaceContext'
import { SpacesController } from './spacesStore'
import { EngineeringWork, type EngineeringWorkHandle, type WorkSection } from './engineering/EngineeringWork'
import { acknowledgeWorkSnapshot, compareWorkSnapshots, editTaskBrief, emptyTaskBrief, indexChangeEvidence, workSnapshot, type TaskBrief } from './engineering/workbenchModel'

const directory = mkdtempSync(join(tmpdir(), 'engineering-work-panel-'))
const controller = new SpacesController(directory)
const space = controller.activeSpace() ?? controller.addSpace(directory)
const runtime = controller.runtime(controller.activeWorkspace()!)
const card = (key: string, role: 'user' | 'assistant', edit = false): TuiTranscriptCard => ({
  key, role, label: edit ? 'Edit a.ts' : key, category: edit ? 'diff' : 'conversation', autoFold: false,
  compactSummary: key, lines: [], expandedLines: [], searchText: key, searchHaystackLower: key,
  ...(edit ? { fileEdits: [{ path: 'a.ts', added: 1, removed: 0 }] } : {}),
})
const cards = [card('Request identity tracking', 'user'), card('edit-source', 'assistant', true), card('Implemented tracking', 'assistant')]
const sources = indexChangeEvidence(cards, '/repo')
const session = { key: 'codex:instance:one', title: 'Identity work', provider: 'codex' }
const repository = { root: '/repo', branch: 'main', fingerprint: 'now', files: [{ path: 'a.ts', status: ' M', additions: '1', deletions: '0', version: 'one' }] }
const before = workSnapshot({ ...repository, files: [] }, [], [], [], 1)
const current = workSnapshot(repository, [{ ...session, version: 'one' }], [], ['question'], 2)
let brief: TaskBrief
let setParentBrief: React.Dispatch<React.SetStateAction<TaskBrief>>
let remount: () => void
let opened = '', jumped = '', copied = '', command = ''
let commandPaths: string[] | undefined
let commandCriterion: string | undefined
let attentionOpened = false
const handle = React.createRef<EngineeringWorkHandle>()
function Fixture() {
  const [task, setTask] = useState(() => editTaskBrief(emptyTaskBrief(), 'criteria', 'Preserve source identities'))
  const [section, setSection] = useState<WorkSection>('brief')
  const [checkpoint, setCheckpoint] = useState(before)
  const [placement, setPlacement] = useState(0)
  brief = task; setParentBrief = setTask; remount = () => setPlacement(value => value + 1)
  return <WorkspaceContext.Provider value={{ controller, space, runtime }}>
    <EngineeringWork key={placement} root="/repo" width={48} height={32} theme={DARK_THEME} focused ready
      brief={task} setBrief={setTask} section={section} onSection={setSection} checkpoint={checkpoint} current={current}
      delta={compareWorkSnapshots(checkpoint, current)} onAcknowledge={() => setCheckpoint(previous => acknowledgeWorkSnapshot(previous, current))}
      currentSession={session} selectedMessage={cards[1]!} selectedMessageFiles={['a.ts']} selectedFile="a.ts" sources={sources} checks={[]}
      attention={[{ key: 'question', kind: 'question', sessionId: 'one', sessionKey: session.key, sessionTitle: session.title, provider: 'codex', title: 'Choose an approach', createdAt: 0 }]}
      onRunCheck={(value, criterionId, paths) => { command = value; commandCriterion = criterionId; commandPaths = paths }}
      onOpenFile={path => { opened = path }} onChooseFile={() => {}} onOpenSession={key => { opened = key }}
      onJump={(source, key) => { jumped = `${source.key}/${key}` }} onCopy={text => { copied = text }} onAppend={text => { copied = text }}
      onAttention={() => { attentionOpened = true }} onFocus={() => {}} handleRef={handle} />
  </WorkspaceContext.Provider>
}
const setup = await testRender(<Fixture />, { width: 48, height: 32 })
const settle = async () => { await act(async () => { await setup.flush() }) }
const click = async (name: string) => {
  const id = `engineering-work:${name}`
  await act(async () => { (setup.renderer.root.findDescendantById('engineering-work-body') as ScrollBoxRenderable | null)?.scrollChildIntoView(id) })
  await settle()
  const node = setup.renderer.root.findDescendantById(id)
  assert.ok(node, `Missing ${id}`)
  await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
  await settle()
}
const edit = async (text: string) => {
  await act(async () => { (setup.renderer.root.findDescendantById('engineering-input:work-editor') as TextareaRenderable).setText(text) })
  await settle()
}
try {
  await settle()
  await click('edit-objective')
  await edit('Keep evidence attached\nAcross providers')
  await act(async () => { remount!() })
  await settle()
  assert.equal((setup.renderer.root.findDescendantById('engineering-input:work-editor') as TextareaRenderable).plainText, 'Keep evidence attached\nAcross providers', 'Draft survives presentation changes')
  await act(async () => { assert.ok(handle.current?.handleKey({ name: 's', sequence: 's', ctrl: true, shift: false })) })
  await settle()
  assert.equal(brief!.objective, 'Keep evidence attached\nAcross providers')
  await click('edit-objective'); await edit('Discard this draft')
  await act(async () => { handle.current?.handleKey({ name: 'escape', sequence: '', ctrl: false, shift: false }) })
  await settle()
  assert.equal(brief!.objective, 'Keep evidence attached\nAcross providers', 'Cancel does not replace the saved brief')
  await click('review:accepted')
  assert.equal(brief!.criteria[0]?.review, 'accepted')
  await click('pin-message'); await click('pin-message')
  assert.equal(brief!.evidence.length, 1, 'Pinning the same source twice does not duplicate evidence')
  const pin = brief!.evidence[0]!
  await click(`pin:${pin.id}`)
  assert.equal(jumped, `${session.key}/edit-source`)
  await click('link-session')
  assert.equal(brief!.sessions[0]?.key, session.key)
  await click('copy')
  assert.match(copied, /Keep evidence attached/)
  await click('criterion-check')
  assert.equal(command, '', 'Opening the command editor does not run anything')
  await edit('printf verification'); await click('save')
  assert.equal(commandCriterion, brief!.criteria[0]?.id)
  assert.equal(commandPaths, undefined)
  await click('catchup')
  assert.match(setup.captureCharFrame(), /new: a\.ts/)
  await click('changed:a.ts')
  assert.equal(opened, 'a.ts')
  await click('attention:question')
  assert.ok(attentionOpened)
  assert.ok(setup.renderer.root.findDescendantById('engineering-work:changed:a.ts'), 'Opening attention does not clear observations')
  await click('reviewed')
  assert.match(setup.captureCharFrame(), /No new observations/)
  await click('evidence')
  await click('request:0')
  assert.equal(jumped, `${session.key}/Request identity tracking`)
  await click('response:0')
  assert.equal(jumped, `${session.key}/Implemented tracking`)
  await click('message-file:a.ts')
  assert.equal(opened, 'a.ts', 'A selected transcript message can open its affected file')
  await click('file-check'); await edit('printf file-check'); await click('save')
  assert.deepEqual(commandPaths, ['a.ts'])
  assert.equal(commandCriterion, undefined, 'A file check does not silently attach itself to a requirement')
  await act(async () => { setParentBrief!(previous => editTaskBrief(previous, 'decisions', 'Use stable source identities')) })
  console.log('Engineering Work editing, draft recovery, criteria, source links, catch-up, acknowledgement and explicit check controls smoke passed')
} finally {
  await act(async () => { setup.renderer.destroy() })
  controller.flush(); rmSync(directory, { recursive: true, force: true })
}
process.exit(0)

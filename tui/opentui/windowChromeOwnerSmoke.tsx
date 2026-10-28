/** @jsxImportSource @opentui/react */
import React, { useState, useSyncExternalStore } from 'react'
import assert from 'node:assert/strict'
import { WorkspaceRuntime, type SpacesController } from './spacesStore'
import { WorkspaceContext, type WorkspaceContextValue } from './workspaceContext'
import { useTranscriptWindowChrome, useTranscriptWindowChromeHost, type WindowChromeStore } from './windowChrome'
import { testRender, act } from './testRender'

const contexts = ['A', 'B'].map(id => {
  const workspace = { id, name: id, values: {} }
  return { runtime: new WorkspaceRuntime(workspace, () => {}), controller: {} as SpacesController,
    space: { id, name: id, cwd: process.cwd(), activeWorkspaceId: id, workspaces: [workspace] } } satisfies WorkspaceContextValue
})
let switchTo!: (index: number) => void
function Host({ label }: { label: string }) {
  useTranscriptWindowChromeHost({ rows: 1, render: () => <text>{`HEADER_${label}`}</text> }, { rows: 1, render: () => <text>{`FOOTER_${label}`}</text> })
  return null
}
function Outlet() {
  const stores = useTranscriptWindowChrome()
  const header = useSyncExternalStore(stores.header.subscribe, stores.header.get)
  const footer = useSyncExternalStore(stores.footer.subscribe, stores.footer.get)
  return <box flexDirection="column">{header?.render(40)}{footer?.render(40)}</box>
}
function Harness() {
  const [index, setIndex] = useState(0)
  switchTo = setIndex
  return <WorkspaceContext value={contexts[index]!}><Host label={String(index)} /><Outlet /></WorkspaceContext>
}
const stores = (index: number) => contexts[index]!.runtime.values.get('ref:transcriptWindowChrome') as { header: WindowChromeStore; footer: WindowChromeStore }
const setup = await testRender(<Harness />, { width: 40, height: 8 })
const settle = async () => { await act(async () => { await setup.flush() }) }
try {
  await settle()
  assert.ok(setup.captureCharFrame().includes('HEADER_0'))
  await act(async () => switchTo(1)); await settle()
  assert.equal(stores(0).header.get(), null, 'leaving clears only the previous workspace header')
  assert.equal(stores(0).footer.get(), null)
  assert.notEqual(stores(0), stores(1), 'native render closures have workspace ownership')
  assert.ok(setup.captureCharFrame().includes('HEADER_1'))
  assert.ok(setup.captureCharFrame().includes('FOOTER_1'))
} finally { act(() => setup.renderer.destroy()) }
assert.equal(stores(1).header.get(), null, 'unmount releases committed native render closures')
assert.equal(stores(1).footer.get(), null)
console.log('Window chrome ownership passed: isolated workspace stores, correct replacement and unmount cleanup')
process.exit(0)

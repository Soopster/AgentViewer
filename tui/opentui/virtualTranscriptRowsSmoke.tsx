/** @jsxImportSource @opentui/react */
import React, { createRef, useState } from 'react'
import assert from 'node:assert/strict'
import type { ScrollBoxRenderable } from '@opentui/core'
import { testRender, act } from './testRender'
import { TranscriptViewportContext, TranscriptBlockRestoreContext, type TranscriptBlockRestore, VirtualTranscriptRows } from './VirtualTranscriptRows'
import { transcriptViewportPosition } from './transcriptWindowState'
const rows = Array.from({ length: 10_000 }, (_, index) => index)
const scroll = createRef<ScrollBoxRenderable>()
let rendered = 0
const restoring = createRef<TranscriptBlockRestore>()
let remount!: (generation: number) => void
function Body() {
 const [generation, setGeneration] = useState(0)
 remount = setGeneration
 return <scrollbox ref={scroll} height={20} width={60}>
  <TranscriptViewportContext value={scroll}><TranscriptBlockRestoreContext value={restoring}>
   <box id="card:test" flexDirection="column">
   <VirtualTranscriptRows key={generation} rows={rows} documentKey="test" rowKey={row => String(row)}
    estimateHeight={row => generation && row === 100 ? 40 : 1} geometryKey={`fixed:${generation}`}
    renderRow={row => { rendered++; return <text height={generation && row === 100 ? 40 : 1} wrapMode="none">{`row-${String(row).padStart(5, '0')}`}</text> }} />
   </box>
  </TranscriptBlockRestoreContext></TranscriptViewportContext>
 </scrollbox>
}
const setup = await testRender(<Body />, { width: 60, height: 20 })
const settle = async () => {
 for (let i = 0; i < 8; i++) await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 16)) })
}
await settle()
assert.equal(scroll.current!.scrollHeight, rows.length, 'spacers preserve full extent')
assert.ok(setup.captureCharFrame().includes('row-00000'))
rendered = 0
await act(async () => { scroll.current!.scrollTo(5000) })
await settle()
assert.ok(setup.captureCharFrame().includes('row-05000'), setup.captureCharFrame())
assert.ok(rendered < 250, `scroll mounted ${rendered} rows for a 20-row viewport`)
await act(async () => { scroll.current!.scrollTo(9980) })
await settle()
assert.ok(setup.captureCharFrame().includes('row-09999'), setup.captureCharFrame())
assert.equal(scroll.current!.scrollHeight, rows.length)
await act(async () => { scroll.current!.scrollTo(5000) })
await settle()
const saved = transcriptViewportPosition(scroll.current!)
assert.ok(saved.blockAnchorKey, 'capture the source row inside the large card')
restoring.current = { id: saved.blockAnchorKey, offset: saved.blockAnchorOffset ?? 0 }
await act(async () => { scroll.current!.scrollTo(0); remount(1) })
await settle()
assert.ok(setup.captureCharFrame().includes('row-05000'), 'source anchor survives remount and earlier rows changing height')
assert.equal(scroll.current!.scrollTop, 5039)
restoring.current = null
setup.renderer.destroy()
console.log('Virtual transcript rows passed: 10k-row extent, middle/tail scrolling, bounded mounts and source-anchor restoration')
process.exit(0)

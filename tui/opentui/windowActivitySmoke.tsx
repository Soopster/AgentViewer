/** @jsxImportSource @opentui/react */
import React, { useEffect, useState } from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { RetainedWindow, useWindowVisible, useWindowSnapshot } from './windowActivity'
import { TranscriptSessionLoader } from './transcriptSessionLoader'
import type { TuiSessionDetail } from '../../lib/tui/service'
let revision = 1
let reads = 0
let renders = 0
const listeners = new Set<() => void>()
let backend = { version: 0 }
const subscribeBackend = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const readBackend = () => backend
const loader = new TranscriptSessionLoader(async () => { reads++; return { marker: revision } as unknown as TuiSessionDetail }, 8, 1_000_000, 20)
let setShown!: (value: boolean) => void
let setTick!: (value: number) => void
function Leaf({ tick }: { tick: number }) {
 const visible = useWindowVisible()
 const snapshot = useWindowSnapshot(subscribeBackend, readBackend)
 const [value, setValue] = useState(0)
 renders++
 useEffect(() => {
  if (!visible) return
  return loader.observe({ session: { provider: 'codex', sessionId: 'visible' }, density: 'balanced', tools: true,
   revision: () => revision, active: () => false, priority: () => 0, shouldYield: () => false,
   onDetail: detail => setValue((detail as unknown as { marker: number }).marker), onError: error => { throw error },
  })
 }, [visible])
 return <text>{`value=${value} tick=${tick} backend=${snapshot.version}`}</text>
}
function Harness() {
 const [shown, show] = useState(true)
 const [tick, update] = useState(0)
 setShown = show; setTick = update
 return <box visible={shown}><RetainedWindow visible={shown}><Leaf tick={tick} /></RetainedWindow></box>
}
const setup = await testRender(<Harness />, { width: 40, height: 10 })
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 16)) }) }
await settle()
assert.equal(reads, 1)
assert.equal(listeners.size, 1)
await act(async () => setShown(false)); await settle()
assert.equal(loader.stats.timer, false)
assert.equal(loader.stats.pinned, 0)
assert.equal(listeners.size, 0, 'hidden shell/process snapshots unsubscribe')
const before = renders
revision = 2
for (let i = 1; i <= 10; i++) await act(async () => {
 backend = { version: i }
 listeners.forEach(listener => listener())
 setTick(i)
})
await settle()
assert.equal(renders, before, 'hidden presentation ignores unrelated parent changes')
assert.equal(reads, 1, 'hidden presentation does not poll new revisions')
await act(async () => setShown(true)); await settle()
assert.equal(reads, 2)
assert.ok(setup.captureCharFrame().includes('value=2 tick=10 backend=10'))
assert.equal(listeners.size, 1, 'resume reads the latest backend snapshot')
setup.renderer.destroy()
console.log('Window activity passed: retained state, zero hidden refreshes/renders and fresh resume')
process.exit(0)

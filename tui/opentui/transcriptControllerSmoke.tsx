/** @jsxImportSource @opentui/react */
import React, { useLayoutEffect, useState } from 'react'
import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { TuiTranscriptCard } from '../format'
import type { TranscriptObserver } from './transcriptSessionLoader'
import { sessionIdentityKey } from './sessionIdentity'
import { RetainedWindow } from './windowActivity'
import { testRender, act } from './testRender'

const observers = new Set<TranscriptObserver>()
const pending: Array<(cards: TuiTranscriptCard[]) => void> = []
const loader = { peek: () => undefined, observe: (observer: TranscriptObserver) => {
  observers.add(observer); return () => { observers.delete(observer) }
} }
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module(name: string, factory: () => unknown): void } }
mock.module('./useTranscriptSessionLoader', () => ({ useTranscriptSessionLoader: () => loader }))
mock.module('./sessionDetailWorkerClient', () => ({
  attachedTranscriptCardsForVariant: (detail: TuiSessionDetail) => detail.transcriptCards ?? null,
  getTranscriptCardsSync: () => null,
  formatTranscriptCardsAsync: () => new Promise<TuiTranscriptCard[]>(resolve => pending.push(resolve)),
}))
const { useTranscriptCards } = await import('./useTranscriptCards')
const { usePinnedSessionDetail } = await import('./usePinnedSessionDetail')
const first: Session = { provider: 'codex', providerInstanceId: 'work', sessionId: 'same-native-id' }
const second: Session = { ...first, providerInstanceId: 'personal' }
const committed: Array<{ owner: string; cards: string[] }> = []
let change!: (value: { session: Session; visible: boolean; tools: boolean }) => void
const neverYield = () => false
function Body({ session, tools }: { session: Session; tools: boolean }) {
  const state = useTranscriptCards({ session, density: 'balanced', showToolCalls: tools, active: false, focused: true, shouldYield: neverYield })
  const pinned = usePinnedSessionDetail(session, 'balanced', tools, neverYield)
  const owner = sessionIdentityKey(session) + ':' + tools
  useLayoutEffect(() => { committed.push({ owner, cards: state.cards.map(card => card.key) }) }, [owner, state.cards])
  return <text>{`${owner} cards=${state.cards.map(card => card.key).join(',')} pinned=${pinned.detail?.transcriptCards?.map(card => card.key).join(',') ?? ''}`}</text>
}
function Harness() {
  const [view, setView] = useState({ session: first, visible: true, tools: true })
  change = setView
  return <box visible={view.visible}><RetainedWindow visible={view.visible}><Body session={view.session} tools={view.tools} /></RetainedWindow></box>
}
const cards = (key: string) => [{ key } as TuiTranscriptCard]
const detail = (key?: string): TuiSessionDetail => ({ rawMessages: [], threadedMessages: [], ...(key ? { transcriptCards: cards(key) } : {}) }) as unknown as TuiSessionDetail
const publish = (session: Session, payload: TuiSessionDetail) => {
  for (const observer of observers) if (sessionIdentityKey(observer.session) === sessionIdentityKey(session)) observer.onDetail(payload)
}
const setup = await testRender(<Harness />, { width: 120, height: 8 })
const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 20)) }) }
try {
  await settle()
  assert.equal(observers.size, 2)
  const stale = [...observers]
  await act(async () => publish(first, detail('WORK'))); await settle()
  assert.ok(setup.captureCharFrame().includes('cards=WORK pinned=WORK'))
  await act(async () => publish(first, detail())); await settle()
  assert.equal(pending.length, 1)
  await act(async () => change({ session: first, visible: false, tools: true })); await settle()
  assert.equal(observers.size, 0, 'hiding releases both transcript and pinned-source observers')
  await act(async () => change({ session: second, visible: true, tools: true })); await settle()
  await act(async () => publish(second, detail('PERSONAL'))); await settle()
  assert.ok(setup.captureCharFrame().includes('cards=PERSONAL pinned=PERSONAL'))
  await act(async () => { pending.shift()!(cards('LATE_WORK')); stale.forEach(observer => observer.onDetail(detail('STALE_WORK'))) }); await settle()
  assert.ok(setup.captureCharFrame().includes('cards=PERSONAL pinned=PERSONAL'), 'late completions cannot replace the new owner')
  assert.ok(committed.filter(entry => entry.owner.startsWith(sessionIdentityKey(second))).every(entry => !entry.cards.some(key => key.includes('WORK'))), 'a new instance never commits a frame of the previous instance')
  await act(async () => change({ session: second, visible: true, tools: false })); await settle()
  assert.ok(committed.filter(entry => entry.owner.endsWith(':false')).every(entry => !entry.cards.includes('PERSONAL')), 'a changed variant does not commit old card content')
  await act(async () => publish(second, detail('PERSONAL_NO_TOOLS'))); await settle()
  assert.ok(setup.captureCharFrame().includes('cards=PERSONAL_NO_TOOLS pinned=PERSONAL_NO_TOOLS'))
} finally { act(() => setup.renderer.destroy()) }
assert.equal(observers.size, 0, 'unmount releases source observers')
console.log('Transcript controllers passed: hidden leases, instance/variant ownership, no stale committed frames and late-format rejection')
process.exit(0)

/** @jsxImportSource @opentui/react */
// The reader mounts a sliding window of cards, and a slide must be invisible.
// Two things about it cannot be seen in any one frame:
//
//  1. THE JUMP. A slide adds rows above or below what is on screen, and the
//     scroll position has to move by exactly that much in the same frame. A
//     frame painted between the two shows the wrong rows. So this samples the
//     viewport's absolute transcript row on EVERY painted frame of a long wheel
//     scroll: it may only move with the wheel, and never further than a notch.
//  2. THE ROOT. The window start lives in readerWindowStore so a slide
//     re-renders the transcript window alone. The frame is identical if the
//     root re-rendered too, so the assertion reads readRootRenderCount().
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ScrollBoxRenderable } from '@opentui/core'
import { buildThreadedMessages } from '../../lib/threading'
import { formatTranscriptCards } from '../format'
import type { Session, SessionMessage } from '../../lib/types'
import { testRender } from '@opentui/react/test-utils'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-reader-window-')))
const view = process.env.READER_WINDOW_SMOKE_VIEW ?? 'stream'
const count = 1600
const session: Session = {
  sessionId: 'reader-window', provider: 'codex', cwd: process.cwd(), summary: 'Reader window', lastModified: 1700000000000,
}
const rawMessages: SessionMessage[] = Array.from({ length: count }, (_, i) => ({
  type: i % 2 ? 'assistant' : 'user', uuid: `reader-window-${i}`,
  session_id: session.sessionId, parent_tool_use_id: null,
  message: { role: i % 2 ? 'assistant' : 'user', content: `Message ${i}\n${'A line of transcript text.\n'.repeat(3)}` },
}))
const threadedMessages = buildThreadedMessages(rawMessages)
const transcriptCards = formatTranscriptCards(threadedMessages)
const detail = { info: session, rawMessages, threadedMessages, transcriptCards,
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module: (name: string, factory: () => unknown) => void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => [session],
  readTuiSessionDetailAsync: async () => detail,
  warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'codex', readTuiTranscriptView: async () => view,
  readTuiSessions: async () => [session], readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App, readRootRenderCount } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 44, kittyKeyboard: true })

const cardIndexByKey = new Map(transcriptCards.map((card, index) => [card.key, index]))
const scrollbox = () => {
  const sb = setup.renderer.root.findDescendantById('transcript-scroll') as ScrollBoxRenderable | null
  assert.ok(sb, 'Transcript scrollbox is mounted')
  return sb
}
type Mounted = { index: number; top: number; height: number }
// Every mounted card with its row inside the content box, as laid out now.
const mountedCards = (sb: ScrollBoxRenderable): Mounted[] => {
  const found: Mounted[] = []
  const visit = (node: { id: string; y: number; height: number; getChildren(): unknown[] }, depth: number) => {
    const index = node.id.startsWith('card:') ? cardIndexByKey.get(node.id.slice('card:'.length)) : undefined
    if (index !== undefined) {
      if (node.height > 0) found.push({ index, top: node.y - sb.content.y, height: node.height })
      return
    }
    if (depth < 4) for (const child of node.getChildren()) visit(child as Parameters<typeof visit>[0], depth + 1)
  }
  visit(sb.content as unknown as Parameters<typeof visit>[0], 0)
  return found.sort((left, right) => left.index - right.index)
}

// A card's absolute transcript row, learned as cards mount: every window shares
// cards with the one before it, so one known card places all the others. The
// same card found at two different rows relative to its neighbours means a
// card changed height, which this fixture never does.
const absoluteTops = new Map<number, number>()
const heights = new Map<number, number>()
// The absolute transcript row at the top of the viewport, or null before the
// first layout of a remount.
const viewportRow = (): { row: number; first: number } | null => {
  const sb = scrollbox()
  const cards = mountedCards(sb)
  if (cards.length === 0) return null
  const first = cards[0].index
  // The window's first card draws no separator above itself, so it is a row
  // shorter there than it is anywhere else: place cards by the ones after it.
  if (first > 0) cards.shift()
  const known = cards.find((card) => absoluteTops.has(card.index))
  const base = known ? absoluteTops.get(known.index)! - known.top : absoluteTops.size === 0 ? 0 : null
  assert.ok(base !== null, 'the mounted window shares no card with the previous one')
  for (const card of cards) {
    const seen = absoluteTops.get(card.index)
    if (seen === undefined) absoluteTops.set(card.index, base + card.top)
    else if (base + card.top !== seen) {
      const changed = cards.filter((other) => heights.has(other.index) && heights.get(other.index) !== other.height)
        .map((other) => `${other.index}: ${heights.get(other.index)} → ${other.height}`)
      assert.fail(`card ${card.index} moved ${base + card.top - seen} rows relative to card ${known?.index}; heights changed: ${changed.join(', ') || 'none'}`)
    }
  }
  for (const card of cards) heights.set(card.index, card.height)
  return { row: base + sb.scrollTop, first }
}

// Sample after every tree pass: the layout a frame was painted from.
type Sample = { row: number; first: number; scrollTop?: number; mounted?: number; frame?: number }
let samples: Sample[] | null = null
let tracking = false
let frameNo = 0
const root = setup.renderer.root as unknown as { render(buffer: unknown, deltaTime: number): void }
const renderTree = root.render.bind(root)
root.render = (buffer, deltaTime) => {
  renderTree(buffer, deltaTime)
  if (!tracking) return
  const sample = viewportRow()
  if (sample && samples) samples.push({ ...sample, scrollTop: scrollbox().scrollTop, mounted: mountedCards(scrollbox()).length, frame: frameNo++ })
}

const settle = async (ms = 160) => {
  const until = performance.now() + ms
  while (performance.now() < until) {
    await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
  }
}
const key = async (name: string, ms = 160) => {
  act(() => name === 'tab' ? setup.mockInput.pressTab() : setup.mockInput.pressKey(name))
  await settle(ms)
}

// Wheel one notch at a time and sample every painted frame. A slide lands
// while the wheel is still turning, so the rows cannot simply be held still;
// what a missed or late scroll correction does is move them by the height of
// the cards the slide added or removed — far more than a notch, and back again
// a frame later. So: never against the wheel, never further than a notch goes.
const MAX_NOTCH_ROWS = 12
async function wheel(direction: 'up' | 'down', notches: number) {
  const viewport = scrollbox().viewport
  const sign = direction === 'down' ? 1 : -1
  const frames: Sample[] = []
  samples = frames
  for (let notch = 0; notch < notches; notch += 1) {
    const before = frames.length
    await act(async () => { await setup.mockMouse.scroll(viewport.x + 5, viewport.y + 3, direction) })
    await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 4)) })
    const previous: Sample | undefined = frames[before - 1]
    let last: Sample | undefined = previous
    for (const sample of frames.slice(before)) {
      if (last) {
        const moved: number = (sample.row - last.row) * sign
        assert.ok(moved >= 0, `the viewport moved ${-moved} rows against the wheel (window start ${last.first} → ${sample.first})`)
      }
      last = sample
    }
    if (previous && last) {
      const moved = (last.row - previous.row) * sign
      assert.ok(moved <= MAX_NOTCH_ROWS, `one notch moved the viewport ${moved} rows (window start ${previous.first} → ${last.first})\n${frames.slice(Math.max(before - 6, 0)).map((entry) => JSON.stringify(entry)).join('\n')}`)
    }
  }
  // Slides still on their way land with nothing scrolling: nothing may move.
  const settledFrom = frames.length
  await settle(200)
  const held = frames.slice(Math.max(settledFrom - 1, 0))
  for (const sample of held) {
    assert.equal(sample.row, held[0].row, `the viewport moved ${sample.row - held[0].row} rows with the wheel at rest`)
  }
  samples = null
  let slides = 0
  for (let at = 1; at < frames.length; at += 1) if (frames[at].first !== frames[at - 1].first) slides += 1
  return { slides, frames: frames.length, rows: Math.abs(frames[frames.length - 1].row - frames[0].row) }
}

try {
  await settle(1500)
  await key('tab')
  await key('g', 400)
  assert.equal(viewportRow()?.first, 0, 'g did not reach the top of the transcript')
  tracking = true

  const rootBefore = readRootRenderCount()
  const down = await wheel('down', 700)
  assert.ok(down.slides >= 10, `scrolling down ${down.rows} rows slid the window only ${down.slides} times`)
  const up = await wheel('up', 700)
  assert.ok(up.slides >= 10, `scrolling up ${up.rows} rows slid the window only ${up.slides} times`)
  const rootRenders = readRootRenderCount() - rootBefore
  const slides = down.slides + up.slides
  // SCROLLBACK parks its hidden cursor from the root as the text moves; in
  // every other view a slide re-renders the transcript window alone.
  if (view !== 'scrollback') {
    assert.ok(rootRenders * 4 < slides, `${slides} window slides re-rendered the root ${rootRenders} times`)
  }
  console.log(`Reader window smoke passed (${view}): ${slides} slides across ${down.rows + up.rows} rows and `
    + `${down.frames + up.frames} frames, no row out of place, ${rootRenders} root renders`)
} finally {
  act(() => setup.renderer.destroy())
}
process.exit(0)

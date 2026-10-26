import type { Renderable } from '@opentui/core'
import { READER_CARD_SEARCH_DEPTH } from './layoutConstants'
import { readReaderLayout } from '../readerLayout'

// OpenTUI's `findDescendantById` is a recursive walk of the WHOLE subtree, and
// it sorts each level's children on the way down. Under a mounted transcript
// that is every renderable inside every card — and the fixup executors below
// call it on a 16ms timer, each time a
// window slides or a tab is restored. Profiled during tab switching against
// real sessions it was 9.7% of all CPU, landing squarely in the window between
// the switch and the first paint. A card box is never deeper than
// READER_CARD_SEARCH_DEPTH, so stopping there skips every card's interior
// while still finding the card. The full search stays as a fallback: a missed
// card would silently drop a scroll restore, not fail loudly.
export function findReaderCard(content: Renderable | undefined | null, id: string): Renderable | undefined {
  if (!content) return undefined
  const scan = (node: Renderable, depth: number): Renderable | undefined => {
    for (const child of node.getChildren()) {
      if (child.id === id) return child as Renderable
      if (depth > 1) {
        const found = scan(child as Renderable, depth - 1)
        if (found) return found
      }
    }
    return undefined
  }
  return scan(content, READER_CARD_SEARCH_DEPTH) ?? content.findDescendantById(id)
}
// The card key a scrollbox row holds, at whatever depth its `card:` box sits.
export function readerRowKey(row: Renderable, depth = READER_CARD_SEARCH_DEPTH): string | null {
  if (row.id?.startsWith('card:')) return row.id.slice('card:'.length)
  if (depth <= 1) return null
  for (const child of row.getChildren()) {
    const key = readerRowKey(child as Renderable, depth - 1)
    if (key) return key
  }
  return null
}
// A renderable's offset inside the scrollbox content as Yoga just computed it.
// `el.y` is only refreshed later in the frame (updateFromLayout), so inside the
// layout pass this is the one place the new position can be read.
export function readerLayoutOffset(el: Renderable, content: Renderable): number | null {
  let offset = 0
  let node: Renderable | null = el
  while (node && node !== content) {
    const layout = readReaderLayout(node)
    if (!layout) return null
    offset += layout.top
    node = node.parent as Renderable | null
  }
  return node === content ? offset : null
}
// A transcript row's card box: the row itself, or — for tool rows, whose keyed
// box sits inside a centering wrapper — its child.
export function readerRowCard(row: Renderable): Renderable | undefined {
  if (row.id?.startsWith('card:')) return row
  return row.getChildren().find((child) => child.id?.startsWith('card:')) as Renderable | undefined
}

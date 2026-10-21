// Window arrangements for the reader and its split panes — the macOS "Move &
// Resize / Fill & Arrange" set, in cells.
//
//   split       reader and panes along one axis (`orientation`), the original
//               tmux-style split; `readerLast` puts the reader at the end
//   main-stack  the reader on one side, the panes stacked in a column beside it
//   grid        two by two: reader and one pane on top, the rest below
//
// Pure arithmetic: App renders from what this returns, so the sizes a card is
// laid out at and the frames it is drawn in come from one place.

import { calculateSplitPaneLayout, SPLIT_SHARE_EVEN, type SplitPaneOrientation } from './splitPaneState'

export type WindowArrangement = 'split' | 'main-stack' | 'grid'

export const WINDOW_ARRANGEMENTS: readonly WindowArrangement[] = ['split', 'main-stack', 'grid']

export type WindowSize = { width: number; height: number }

export type WindowLayout = {
  arrangement: WindowArrangement
  /** Panes actually shown; fewer than asked for when they would not fit. */
  visibleCount: number
  reader: WindowSize
  panes: WindowSize[]
  /** The row (grid) or column (main-stack) the panes beyond the first share. */
  secondary: WindowSize | null
  /** Grid only: how many panes share the top row with the reader; the rest are below. */
  topPanes: number
  /** Runs of two or more panes whose shared borders can be dragged. */
  groups: WindowGroup[]
}

export type WindowLayoutInput = {
  arrangement: WindowArrangement
  orientation: SplitPaneOrientation
  width: number
  height: number
  requestedCount: number
  availableCount: number
  maxPanes: number
  /** Fraction of the main axis the reader keeps; SPLIT_SHARE_EVEN for the arrangement's default. */
  readerShare: number
  /**
   * The second divider: the grid's top row, or the first pane of a stack, as a
   * fraction of the height. SPLIT_SHARE_EVEN (or omitted) splits evenly.
   */
  secondaryShare?: number
  /** The grid's bottom row: the first pane's share of the width. SPLIT_SHARE_EVEN (or omitted) splits evenly. */
  bottomShare?: number
  /**
   * Relative sizes inside each group of panes, so every shared border can be
   * dragged. A group's weights win over `bottomShare` (the grid's bottom row)
   * and `secondaryShare` (a stack); missing entries count as 1.
   */
  weights?: WindowWeights
  minPaneWidth: number
  minPaneRows: number
  minReaderWidth: number
  minReaderRows: number
}

/** A run of panes that share one axis, each border between neighbours draggable. */
export type WindowGroupKey = 'split' | 'stack' | 'gridTop' | 'gridBottom'
export type WindowWeights = Partial<Record<WindowGroupKey, number[]>>
export type WindowGroup = { key: WindowGroupKey; axis: 'x' | 'y'; members: number[] }

/**
 * `total` cells over `count` frames in proportion to `weights`, each at least
 * `min` where the total allows it, summing to exactly `total`.
 */
export function distributeExtent(total: number, count: number, weights: readonly number[] | undefined, min: number): number[] {
  if (count <= 0) return []
  const raw = Array.from({ length: count }, (_, index) => {
    const weight = weights?.[index]
    return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1
  })
  const floor = Math.min(min, Math.floor(total / count))
  // Proportional first; a frame that would fall below its minimum is held at
  // it, and the rest share what is left by weight, until none falls below.
  const held = new Set<number>()
  let ideal: number[] = []
  for (;;) {
    const free = raw.map((weight, index) => (held.has(index) ? 0 : weight))
    const freeTotal = total - floor * held.size
    const sum = free.reduce((acc, weight) => acc + weight, 0) || 1
    ideal = raw.map((_, index) => (held.has(index) ? floor : (freeTotal * free[index]!) / sum))
    const under = ideal.findIndex((size, index) => !held.has(index) && size < floor)
    if (under < 0) break
    held.add(under)
  }
  const sizes = ideal.map((size) => Math.floor(size))
  let remainder = total - sizes.reduce((acc, size) => acc + size, 0)
  // Rounding leftovers go to the frames that lost the most to it, last first on ties.
  const order = ideal.map((size, index) => ({ index, loss: size - Math.floor(size) }))
    .sort((a, b) => b.loss - a.loss || b.index - a.index)
  for (let at = 0; remainder > 0; at = (at + 1) % count, remainder -= 1) sizes[order[at]!.index]! += 1
  return sizes
}

/** The reader's default share where "even" would make it no larger than a pane. */
const MAIN_STACK_DEFAULT_SHARE = 0.6

export function computeWindowLayout(input: WindowLayoutInput): WindowLayout {
  const { arrangement, width, height } = input
  const wanted = Math.max(0, Math.min(input.requestedCount, input.availableCount, input.maxPanes))
  // The axis calculation alone cannot protect the other dimension.
  if (height < Math.max(input.minReaderRows, input.minPaneRows)
    || width < Math.max(input.minReaderWidth, input.minPaneWidth)) {
    return { arrangement, visibleCount: 0, reader: { width, height }, panes: [], secondary: null, topPanes: 0, groups: [] }
  }
  if (arrangement === 'split' || wanted === 0) {
    const stacked = input.orientation === 'rows'
    const layout = calculateSplitPaneLayout({
      availableExtent: stacked ? height : width,
      requestedCount: wanted,
      availableCount: wanted,
      maxPanes: input.maxPanes,
      minPaneExtent: stacked ? input.minPaneRows : input.minPaneWidth,
      minReaderExtent: stacked ? input.minReaderRows : input.minReaderWidth,
      readerShare: input.readerShare,
    })
    // The panes' share of the axis, divided between them by their weights.
    const extents = distributeExtent(layout.paneExtent * layout.visibleCount, layout.visibleCount, input.weights?.split, stacked ? input.minPaneRows : input.minPaneWidth)
    return {
      arrangement: 'split',
      visibleCount: layout.visibleCount,
      reader: stacked ? { width, height: layout.readerExtent } : { width: layout.readerExtent, height },
      panes: extents.map((extent) => (stacked ? { width, height: extent } : { width: extent, height })),
      secondary: null,
      topPanes: 0,
      groups: layout.visibleCount > 1 ? [{ key: 'split', axis: stacked ? 'y' : 'x', members: extents.map((_, index) => index) }] : [],
    }
  }

  // Both remaining arrangements first split the width between the reader and one other column.
  const share = input.readerShare === SPLIT_SHARE_EVEN
    ? (arrangement === 'main-stack' ? MAIN_STACK_DEFAULT_SHARE : 0.5)
    : input.readerShare
  const columns = calculateSplitPaneLayout({
    availableExtent: width,
    requestedCount: 1,
    availableCount: 1,
    maxPanes: 1,
    minPaneExtent: input.minPaneWidth,
    minReaderExtent: input.minReaderWidth,
    readerShare: share,
  })
  if (columns.visibleCount === 0) {
    return { arrangement, visibleCount: 0, reader: { width, height }, panes: [], secondary: null, topPanes: 0, groups: [] }
  }
  const readerWidth = columns.readerExtent
  const otherWidth = columns.paneExtent

  if (arrangement === 'main-stack') {
    // As many panes as the column has rows for.
    const fit = Math.max(1, Math.min(wanted, Math.floor(height / input.minPaneRows)))
    const secondary = input.secondaryShare ?? SPLIT_SHARE_EVEN
    // The stack's own weights, else the older first-pane share, else even.
    const weights = input.weights?.stack ?? (fit > 1 && secondary !== SPLIT_SHARE_EVEN
      ? [secondary * (fit - 1), ...Array.from({ length: fit - 1 }, () => 1 - secondary)]
      : undefined)
    const heights = distributeExtent(height, fit, weights, input.minPaneRows)
    const panes = heights.map((paneHeight) => ({ width: otherWidth, height: paneHeight }))
    return {
      arrangement, visibleCount: fit, reader: { width: readerWidth, height }, panes, secondary: { width: otherWidth, height }, topPanes: 0,
      groups: fit > 1 ? [{ key: 'stack', axis: 'y', members: panes.map((_, index) => index) }] : [],
    }
  }

  // Grid: two rows, the reader first in the top one. The top row takes the
  // larger half of the windows, so two panes sit beside and below the reader,
  // four sit two beside and two below, and so on.
  const secondary = input.secondaryShare ?? SPLIT_SHARE_EVEN
  const topHeight = secondary === SPLIT_SHARE_EVEN
    ? Math.floor(height / 2)
    : clampExtent(Math.round(height * secondary), input.minReaderRows, height - input.minPaneRows)
  const bottomHeight = height - topHeight
  const roomBelow = topHeight >= input.minReaderRows && bottomHeight >= input.minPaneRows
  const oneRow = (): WindowLayout => ({
    arrangement,
    visibleCount: 1,
    reader: { width: readerWidth, height },
    panes: [{ width: otherWidth, height }],
    secondary: null,
    topPanes: 1,
    groups: [],
  })
  if (wanted === 1 || !roomBelow) return oneRow()
  // Drop panes from the end until both rows fit their minimum widths.
  for (let count = wanted; count >= 2; count -= 1) {
    const total = count + 1
    const top = Math.ceil(total / 2)
    const topPanes = top - 1
    const bottom = total - top
    const roomForPanes = width - topPanes * input.minPaneWidth
    if (roomForPanes < input.minReaderWidth || Math.floor(width / bottom) < input.minPaneWidth) continue
    const gridReader = input.readerShare === SPLIT_SHARE_EVEN
      ? Math.floor(width / top)
      : clampExtent(Math.round(width * input.readerShare), input.minReaderWidth, roomForPanes)
    // Each row divided by its own weights; the bottom row falls back to the older first-pane share.
    const topWidths = distributeExtent(width - gridReader, topPanes, input.weights?.gridTop, input.minPaneWidth)
    const bottomShare = input.bottomShare ?? SPLIT_SHARE_EVEN
    const bottomWeights = input.weights?.gridBottom ?? (bottom > 1 && bottomShare !== SPLIT_SHARE_EVEN
      ? [bottomShare * (bottom - 1), ...Array.from({ length: bottom - 1 }, () => 1 - bottomShare)]
      : undefined)
    const bottomWidths = distributeExtent(width, bottom, bottomWeights, input.minPaneWidth)
    const panes: WindowSize[] = [
      ...topWidths.map((paneWidth) => ({ width: paneWidth, height: topHeight })),
      ...bottomWidths.map((paneWidth) => ({ width: paneWidth, height: bottomHeight })),
    ]
    const groups: WindowGroup[] = []
    if (topPanes > 1) groups.push({ key: 'gridTop', axis: 'x', members: topWidths.map((_, index) => index) })
    if (bottom > 1) groups.push({ key: 'gridBottom', axis: 'x', members: bottomWidths.map((_, index) => topPanes + index) })
    return {
      arrangement,
      visibleCount: count,
      reader: { width: gridReader, height: topHeight },
      panes,
      secondary: { width, height: bottomHeight },
      topPanes,
      groups,
    }
  }
  return oneRow()
}

/** Reserve one row for overflow only when needed, then fit again in that budget. */
export function computeResponsiveWindowLayout(input: WindowLayoutInput): { layout: WindowLayout; overflowRows: number } {
  const layout = computeWindowLayout(input)
  const wanted = Math.min(input.requestedCount, input.availableCount)
  if (layout.visibleCount >= wanted || wanted === 0) return { layout, overflowRows: 0 }
  return { layout: computeWindowLayout({ ...input, height: Math.max(0, input.height - 1) }), overflowRows: 1 }
}

export type WindowRect = { x: number; y: number; width: number; height: number }

/** The same frames used by the renderer, positioned for operation previews. */
export function windowLayoutRects(layout: WindowLayout, input: { width: number; height: number; orientation: SplitPaneOrientation; readerLast: boolean }): WindowRect[] {
  const reader = { x: 0, y: 0, ...layout.reader }
  const panes: WindowRect[] = []
  if (layout.arrangement === 'split') {
    const stacked = input.orientation === 'rows'
    let offset = stacked ? reader.height : reader.width
    for (const pane of layout.panes) {
      panes.push({ x: stacked ? 0 : offset, y: stacked ? offset : 0, ...pane })
      offset += stacked ? pane.height : pane.width
    }
  } else if (layout.arrangement === 'main-stack') {
    let y = 0
    for (const pane of layout.panes) {
      panes.push({ x: reader.width, y, ...pane })
      y += pane.height
    }
  } else {
    let topX = reader.width
    let bottomX = 0
    for (let index = 0; index < layout.panes.length; index += 1) {
      const pane = layout.panes[index]!
      const top = index < layout.topPanes
      panes.push({ x: top ? topX : bottomX, y: top ? 0 : reader.height, ...pane })
      if (top) topX += pane.width
      else bottomX += pane.width
    }
  }
  const rects = [reader, ...panes]
  if (input.readerLast) {
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index]!
      if (layout.arrangement === 'split' && input.orientation === 'rows') rect.y = input.height - rect.y - rect.height
      // The grid reverses only its top row; the stack reverses its columns.
      else if (layout.arrangement !== 'grid' || index <= layout.topPanes) rect.x = input.width - rect.x - rect.width
    }
  }
  return rects
}

/** Scale geometry by sampling cells, retaining the true pane proportions. */
export function windowPreviewLines(rects: WindowRect[], area: WindowSize, columns = 51, rows = 6): string[] {
  return Array.from({ length: rows }, (_, row) => {
    let line = ''
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * area.width / columns
      const y = (row + 0.5) * area.height / rows
      const index = rects.findIndex((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
      const rect = rects[index]
      if (!rect) { line += ' '; continue }
      const left = Math.floor(rect.x * columns / area.width)
      const right = Math.ceil((rect.x + rect.width) * columns / area.width) - 1
      const top = Math.floor(rect.y * rows / area.height)
      const bottom = Math.ceil((rect.y + rect.height) * rows / area.height) - 1
      if (row === top || row === bottom) line += column === left || column === right ? '+' : '─'
      else if (column === left || column === right) line += '│'
      else line += column === Math.floor((left + right) / 2) && row === Math.floor((top + bottom) / 2) ? String(index + 1) : ' '
    }
    return line
  })
}

function clampExtent(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value))
}

/** Where a drop lands in the window area: an edge makes a pane there, the middle opens it in the reader. */
export type WindowDropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** The edge bands are a quarter of each axis, so the middle is half the area each way. */
export function windowDropZone(area: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): WindowDropZone | null {
  const fx = (point.x - area.x) / Math.max(1, area.width)
  const fy = (point.y - area.y) / Math.max(1, area.height)
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null
  // The nearest edge wins, so a corner goes to whichever side it is closer to.
  const distances: Array<[WindowDropZone, number]> = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]]
  const [zone, distance] = distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best))
  return distance < 0.25 ? zone : 'center'
}

/** The rectangle a drop zone highlights, inside the area. */
export function windowDropZoneRect(area: { x: number; y: number; width: number; height: number }, zone: WindowDropZone) {
  const halfWidth = Math.floor(area.width / 2)
  const halfHeight = Math.floor(area.height / 2)
  switch (zone) {
    case 'left': return { x: area.x, y: area.y, width: halfWidth, height: area.height }
    case 'right': return { x: area.x + area.width - halfWidth, y: area.y, width: halfWidth, height: area.height }
    case 'top': return { x: area.x, y: area.y, width: area.width, height: halfHeight }
    case 'bottom': return { x: area.x, y: area.y + area.height - halfHeight, width: area.width, height: halfHeight }
    default: return { ...area }
  }
}

/** The reader share a divider dragged to `position` asks for, before clamping. */
export function readerShareAt(area: { x: number; y: number; width: number; height: number }, position: number, axis: 'x' | 'y', readerLast: boolean): number {
  const start = axis === 'x' ? area.x : area.y
  const extent = Math.max(1, axis === 'x' ? area.width : area.height)
  const fraction = (position - start) / extent
  return readerLast ? 1 - fraction : fraction
}

export type WindowDirection = 'left' | 'right' | 'up' | 'down'
type Rect = { x: number; y: number; width: number; height: number }

/**
 * The window to move focus to from `current` in `direction`: the nearest one
 * whose centre lies that way, preferring those that overlap on the other axis
 * (the pane directly beside, not one diagonally across). Null at an edge.
 */
export function windowInDirection<Id>(windows: ReadonlyArray<{ id: Id; rect: Rect }>, current: Id, direction: WindowDirection): Id | null {
  const from = windows.find((window) => window.id === current)
  if (!from) return null
  const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const origin = centre(from.rect)
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'right' || direction === 'down' ? 1 : -1
  let best: { id: Id; score: number } | null = null
  for (const window of windows) {
    if (window.id === current) continue
    const point = centre(window.rect)
    const along = (horizontal ? point.x - origin.x : point.y - origin.y) * sign
    // Beyond this window's edge on that side (frames share a border cell), not
    // merely a centre a few cells further along: from the bottom-right pane of
    // a grid whose rows split differently, "right" is nothing, not the top row.
    const beyond = direction === 'right' ? window.rect.x >= from.rect.x + from.rect.width - 1
      : direction === 'left' ? window.rect.x + window.rect.width <= from.rect.x + 1
      : direction === 'down' ? window.rect.y >= from.rect.y + from.rect.height - 1
      : window.rect.y + window.rect.height <= from.rect.y + 1
    if (along <= 0 || !beyond) continue
    const overlaps = horizontal
      ? window.rect.y < from.rect.y + from.rect.height && window.rect.y + window.rect.height > from.rect.y
      : window.rect.x < from.rect.x + from.rect.width && window.rect.x + window.rect.width > from.rect.x
    const across = Math.abs(horizontal ? point.y - origin.y : point.x - origin.x)
    const score = along + across * 2 + (overlaps ? 0 : 10_000)
    if (!best || score < best.score) best = { id: window.id, score }
  }
  return best?.id ?? null
}

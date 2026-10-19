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
  minPaneWidth: number
  minPaneRows: number
  minReaderWidth: number
  minReaderRows: number
}

/** The reader's default share where "even" would make it no larger than a pane. */
const MAIN_STACK_DEFAULT_SHARE = 0.6

export function computeWindowLayout(input: WindowLayoutInput): WindowLayout {
  const { arrangement, width, height } = input
  const wanted = Math.max(0, Math.min(input.requestedCount, input.availableCount, input.maxPanes))
  // The axis calculation alone cannot protect the other dimension.
  if (height < Math.max(input.minReaderRows, input.minPaneRows)
    || width < Math.max(input.minReaderWidth, input.minPaneWidth)) {
    return { arrangement, visibleCount: 0, reader: { width, height }, panes: [], secondary: null, topPanes: 0 }
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
    const pane = stacked ? { width, height: layout.paneExtent } : { width: layout.paneExtent, height }
    return {
      arrangement: 'split',
      visibleCount: layout.visibleCount,
      reader: stacked ? { width, height: layout.readerExtent } : { width: layout.readerExtent, height },
      panes: Array.from({ length: layout.visibleCount }, () => ({ ...pane })),
      secondary: null,
      topPanes: 0,
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
    return { arrangement, visibleCount: 0, reader: { width, height }, panes: [], secondary: null, topPanes: 0 }
  }
  const readerWidth = columns.readerExtent
  const otherWidth = columns.paneExtent

  if (arrangement === 'main-stack') {
    // As many panes as the column has rows for.
    const fit = Math.max(1, Math.min(wanted, Math.floor(height / input.minPaneRows)))
    const secondary = input.secondaryShare ?? SPLIT_SHARE_EVEN
    // The first pane may be sized by its divider; the rest share what is left evenly.
    const first = fit > 1 && secondary !== SPLIT_SHARE_EVEN
      ? clampExtent(Math.round(height * secondary), input.minPaneRows, height - (fit - 1) * input.minPaneRows)
      : Math.floor(height / fit)
    const rest = fit > 1 ? Math.floor((height - first) / (fit - 1)) : 0
    const panes = Array.from({ length: fit }, (_, index) => ({
      width: otherWidth,
      // The rounding remainder goes to the last pane, so the column ends on the reader's last row.
      height: index === 0 ? (fit === 1 ? height : first) : index === fit - 1 ? height - first - rest * (fit - 2) : rest,
    }))
    return { arrangement, visibleCount: fit, reader: { width: readerWidth, height }, panes, secondary: { width: otherWidth, height }, topPanes: 0 }
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
    const topPaneWidth = Math.floor((width - gridReader) / topPanes)
    const panes: WindowSize[] = []
    for (let index = 0; index < topPanes; index += 1) {
      // The rounding remainder goes to the last frame in each row, so both rows end at the area's edge.
      panes.push({ width: index === topPanes - 1 ? width - gridReader - topPaneWidth * (topPanes - 1) : topPaneWidth, height: topHeight })
    }
    // The bottom row's first pane may be sized by its own divider; the rest share what is left.
    const bottomShare = input.bottomShare ?? SPLIT_SHARE_EVEN
    const firstBottom = bottom > 1 && bottomShare !== SPLIT_SHARE_EVEN
      ? clampExtent(Math.round(width * bottomShare), input.minPaneWidth, width - (bottom - 1) * input.minPaneWidth)
      : Math.floor(width / bottom)
    const restBottom = bottom > 1 ? Math.floor((width - firstBottom) / (bottom - 1)) : 0
    for (let index = 0; index < bottom; index += 1) {
      const paneWidth = index === 0 ? (bottom === 1 ? width : firstBottom)
        : index === bottom - 1 ? width - firstBottom - restBottom * (bottom - 2)
        : restBottom
      panes.push({ width: paneWidth, height: bottomHeight })
    }
    return {
      arrangement,
      visibleCount: count,
      reader: { width: gridReader, height: topHeight },
      panes,
      secondary: { width, height: bottomHeight },
      topPanes,
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
      else line += column === Math.floor((left + right) / 2) && row === Math.floor((top + bottom) / 2) ? (index === 0 ? 'R' : String(index)) : ' '
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

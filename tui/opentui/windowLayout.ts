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
    return { arrangement, visibleCount: 0, reader: { width, height }, panes: [], secondary: null }
  }
  const readerWidth = columns.readerExtent
  const otherWidth = columns.paneExtent

  if (arrangement === 'main-stack') {
    // As many panes as the column has rows for.
    const fit = Math.max(1, Math.min(wanted, Math.floor(height / input.minPaneRows)))
    const base = Math.floor(height / fit)
    const panes = Array.from({ length: fit }, (_, index) => ({
      width: otherWidth,
      // The rounding remainder goes to the last pane, so the column ends on the reader's last row.
      height: index === fit - 1 ? height - base * (fit - 1) : base,
    }))
    return { arrangement, visibleCount: fit, reader: { width: readerWidth, height }, panes, secondary: { width: otherWidth, height } }
  }

  // Grid: one pane beside the reader; any others share a row below both.
  const topHeight = Math.floor(height / 2)
  const bottomHeight = height - topHeight
  const roomBelow = topHeight >= input.minReaderRows && bottomHeight >= input.minPaneRows
  if (wanted === 1 || !roomBelow) {
    return {
      arrangement,
      visibleCount: 1,
      reader: { width: readerWidth, height },
      panes: [{ width: otherWidth, height }],
      secondary: null,
    }
  }
  const below = Math.max(1, Math.min(wanted - 1, Math.floor(width / input.minPaneWidth)))
  const belowWidth = Math.floor(width / below)
  const panes: WindowSize[] = [{ width: otherWidth, height: topHeight }]
  for (let index = 0; index < below; index += 1) {
    panes.push({ width: index === below - 1 ? width - belowWidth * (below - 1) : belowWidth, height: bottomHeight })
  }
  return {
    arrangement,
    visibleCount: 1 + below,
    reader: { width: readerWidth, height: topHeight },
    panes,
    secondary: { width, height: bottomHeight },
  }
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

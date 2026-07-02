export type TimelineLayoutRow = {
  key: string
}

// Read-only key→index lookup. Kept minimal (only .get) so composed layouts
// can chain a small overlay in front of a large base map instead of cloning
// the base — see appendTimelineRowLayout.
export type TimelineRowIndex = Pick<Map<string, number>, 'get'>

export type TimelineRowLayout = {
  tops: Float64Array
  heights: Float64Array
  totalHeight: number
  indexByKey: TimelineRowIndex
}

export type TimelineScrollAnchor = {
  index: number
  key: string
  offset: number
}

export type TimelineMeasurementChange = {
  index: number
  previousHeight: number
  nextHeight: number
}

export type VirtualTimelineWindow = {
  startIndex: number
  endIndex: number
  totalHeight: number
}

export function buildTimelineRowLayout<Row extends TimelineLayoutRow>(
  timelineRows: readonly Row[],
  measuredHeights: ReadonlyMap<string, number>,
  estimateHeight: (row: Row) => number,
): TimelineRowLayout {
  const n = timelineRows.length
  const tops = new Float64Array(n)
  const heights = new Float64Array(n)
  const indexByKey = new Map<string, number>()
  let totalHeight = 0

  for (let i = 0; i < n; i++) {
    const row = timelineRows[i]
    tops[i] = totalHeight
    heights[i] = measuredHeights.get(row.key) ?? estimateHeight(row)
    indexByKey.set(row.key, i)
    totalHeight += heights[i]
  }

  return { tops, heights, totalHeight, indexByKey }
}

// Compose a layout for [...baseRows, ...extraRows] by reusing a prebuilt
// `base` layout for the prefix and appending only `extraRows`. Equivalent to
// buildTimelineRowLayout over the concatenation, but it skips the per-row
// measured-height lookup + estimate for the (large, invariant) prefix — only
// a typed-array memcpy plus a tiny overlay map for the extras. The overlay is
// chained in front of the base index rather than cloning it: this runs on
// every live-streaming frame, and an O(prefix) Map clone per frame dominated
// the cost on multi-thousand-row transcripts. Row keys are unique across
// base and extras (live rows are 'live:'-prefixed), so lookup order between
// the two maps is immaterial.
export function appendTimelineRowLayout<Row extends TimelineLayoutRow>(
  base: TimelineRowLayout,
  extraRows: readonly Row[],
  measuredHeights: ReadonlyMap<string, number>,
  estimateHeight: (row: Row) => number,
): TimelineRowLayout {
  if (extraRows.length === 0) return base
  const baseN = base.tops.length
  const n = baseN + extraRows.length
  const tops = new Float64Array(n)
  const heights = new Float64Array(n)
  tops.set(base.tops)
  heights.set(base.heights)
  const extraIndexByKey = new Map<string, number>()
  let totalHeight = base.totalHeight

  for (let i = 0; i < extraRows.length; i++) {
    const row = extraRows[i]
    const idx = baseN + i
    tops[idx] = totalHeight
    heights[idx] = measuredHeights.get(row.key) ?? estimateHeight(row)
    extraIndexByKey.set(row.key, idx)
    totalHeight += heights[idx]
  }

  const baseIndexByKey = base.indexByKey
  const indexByKey: TimelineRowIndex = {
    get: (key) => extraIndexByKey.get(key) ?? baseIndexByKey.get(key),
  }

  return { tops, heights, totalHeight, indexByKey }
}

function upperBound(values: Float64Array, length: number, target: number): number {
  let low = 0
  let high = length

  while (low < high) {
    const mid = (low + high) >>> 1
    if (values[mid] <= target) low = mid + 1
    else high = mid
  }

  return low
}

export function findTimelineScrollAnchor<Row extends TimelineLayoutRow>(
  rows: readonly Row[],
  layout: TimelineRowLayout,
  scrollTop: number,
): TimelineScrollAnchor | null {
  const n = rows.length
  if (n === 0) return null

  let index = Math.max(0, upperBound(layout.tops, n, scrollTop) - 1)
  while (index < n - 1 && layout.tops[index] + layout.heights[index] <= scrollTop) {
    index += 1
  }

  const row = rows[index]
  if (!row) return null

  return {
    index,
    key: row.key,
    offset: scrollTop - layout.tops[index],
  }
}

export function computeTimelineScrollCompensation(
  changes: readonly TimelineMeasurementChange[],
  anchor: TimelineScrollAnchor | null,
): number {
  if (!anchor) return 0

  let scrollDelta = 0
  for (const change of changes) {
    if (change.index < anchor.index) {
      scrollDelta += change.nextHeight - change.previousHeight
    }
  }
  return scrollDelta
}

export function getVirtualTimelineWindow({
  layout,
  rowCount,
  scrollTop,
  viewportHeight,
  overscanPx,
}: {
  layout: TimelineRowLayout
  rowCount: number
  scrollTop: number
  viewportHeight: number
  overscanPx: number
}): VirtualTimelineWindow {
  const rangeStart = Math.max(0, scrollTop - overscanPx)
  const rangeEnd = scrollTop + viewportHeight + overscanPx

  let startIndex = Math.max(0, upperBound(layout.tops, rowCount, rangeStart) - 1)
  while (startIndex > 0 && layout.tops[startIndex - 1] + layout.heights[startIndex - 1] >= rangeStart) {
    startIndex -= 1
  }
  const endIndex = Math.max(upperBound(layout.tops, rowCount, rangeEnd), startIndex + 1)

  return {
    startIndex,
    endIndex: Math.min(endIndex, rowCount),
    totalHeight: layout.totalHeight,
  }
}

export function resolveTimelineRenderedHeight({
  measuredTotalHeight,
  activeScrollHeight,
  visibleBottom,
}: {
  measuredTotalHeight: number
  activeScrollHeight: number | null
  visibleBottom: number
}): number {
  if (activeScrollHeight == null) return measuredTotalHeight
  return Math.max(activeScrollHeight, visibleBottom)
}

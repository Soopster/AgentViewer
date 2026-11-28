// Read Yoga's current layout during layout-changed, before screen coordinates
// are refreshed. Runtime nodes can expose a different API than installed types.
type Layout = { top: number; height: number }
type LayoutNode = {
  isDestroyed?: boolean
  getLayout?: () => Layout
  getComputedLayout?: () => Layout
}

export function readReaderLayout(node: LayoutNode): Layout | null {
  if (node.isDestroyed) return null
  const read = typeof node.getLayout === 'function' ? node.getLayout : node.getComputedLayout
  if (typeof read !== 'function') return null
  const layout = read.call(node)
  return Number.isFinite(layout.top) && Number.isFinite(layout.height) ? layout : null
}

/** Measure sibling rows during layout-changed, before screen coordinates are
 * refreshed. Read each native layout once, including the gaps between rows. */
export function measureReaderRowHeights(
  rows: readonly LayoutNode[],
  start: number,
  index: { length: number; update(at: number, height: number): unknown },
  trailingGap: number,
): void {
  let current = rows[0] ? readReaderLayout(rows[0]) : null
  for (let relative = 0; relative < rows.length && start + relative < index.length; relative++) {
    const next = rows[relative + 1] ? readReaderLayout(rows[relative + 1]) : null
    if (current) {
      // A destroyed/missing following row cannot provide a valid offset.
      index.update(start + relative, next ? next.top - current.top : current.height + trailingGap)
    }
    current = next
  }
}

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

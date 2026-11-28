// Finding where an overlay view drew its frame, so the host can put the `⧉ window` button on it.
// The view is a plugin and decides its own rectangle; the host only reads the result.

export type DetachAnchor = { left: number; top: number; width: number }

type Measured = { x: number; y: number; width: number; height: number; getChildren?: () => Measured[]; findDescendantById?: (id: string) => unknown }

/** The popover's own button id (`PopoverDetachButton`); a view that drew one needs no second. */
export const DETACH_BUTTON_ID = 'popover-detach'
/** The host's own button is not a view's: finding it must not hide it. */
export const AUTO_DETACH_BUTTON_ID = 'popover-detach-auto'

/**
 * The frame to anchor to, or null when there is nothing to add: the host's wrapper holds the view's root as its first
 * child, a view that already carries the button is left alone, and a view that fills the screen (an editor) has its own
 * chrome and no free border to sit on.
 */
export function readOverlayDetachAnchor(wrapper: unknown, screenWidth: number): DetachAnchor | null {
  const box = wrapper as Measured | null
  const root = box?.getChildren?.()[0]
  if (!box || !root || root.width <= 0 || root.height <= 0) return null
  if (box.findDescendantById?.(DETACH_BUTTON_ID)) return null
  if (root.width >= screenWidth - 1) return null
  // Measured on screen, drawn relative to the wrapper: where the wrapper itself sits (below a header, say) must not shift it.
  return { left: Math.max(0, Math.round(root.x - box.x)), top: Math.max(0, Math.round(root.y - box.y)), width: Math.round(root.width) }
}

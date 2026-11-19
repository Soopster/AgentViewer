// A dimming backdrop that leaves one rectangle uncovered.
//
// OpenTUI has no click-through: whatever box is on top at a cell takes the press. The composer
// window's backdrop is a root box, and the spaces rail sits deep inside the session rail, so no
// z-index on the rail can lift it above the backdrop (z-index orders siblings only). The backdrop
// is drawn as the strips around the rail instead, which keeps the rail what `layers.ts` says it
// is: navigation above the composer window, usable with a draft open.

export type Rect = { x: number; y: number; width: number; height: number }

/** The strips of a `width` × `height` area that are not `hole`: above, below, left and right of it. */
export function rectsAround(width: number, height: number, hole: Rect | null): Rect[] {
  if (!hole || hole.width <= 0 || hole.height <= 0) return [{ x: 0, y: 0, width, height }]
  const top = Math.max(0, Math.min(hole.y, height))
  const bottom = Math.max(top, Math.min(hole.y + hole.height, height))
  const left = Math.max(0, Math.min(hole.x, width))
  const right = Math.max(left, Math.min(hole.x + hole.width, width))
  return [
    { x: 0, y: 0, width, height: top },
    { x: 0, y: bottom, width, height: height - bottom },
    { x: 0, y: top, width: left, height: bottom - top },
    { x: right, y: top, width: width - right, height: bottom - top },
  ].filter(rect => rect.width > 0 && rect.height > 0)
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
}

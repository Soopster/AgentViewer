// Where surface windows (a shell, the diff, files, …) sit among the session
// panes. The session pins keep deciding which sessions show and in what order
// — every drop and swap plan works on them — and this only says which slots
// are surfaces. So a session moved by a plan keeps the surfaces in place, and a
// surface moved among the sessions leaves their order alone.

export const SURFACE_KEY_PREFIX = 'surface:'

export function surfaceWindowKey(id: string): string {
  return `${SURFACE_KEY_PREFIX}${id}`
}

export function isSurfaceWindowKey(key: string): boolean {
  return key.startsWith(SURFACE_KEY_PREFIX)
}

export function surfaceIdOfKey(key: string): string {
  return key.slice(SURFACE_KEY_PREFIX.length)
}

/**
 * The windows in display order. `order` is the remembered slot sequence; its
 * session entries mark session slots, filled from `sessionKeys` in their own
 * order. Windows `order` does not mention yet follow it: sessions, then surfaces.
 */
export function orderWindows(order: readonly string[], sessionKeys: readonly string[], surfaceIds: readonly string[]): string[] {
  const surfaces = surfaceIds.map(surfaceWindowKey)
  const sessionSet = new Set(sessionKeys)
  const surfaceSet = new Set(surfaces)
  // A slot is a surface, or a session slot (any key that is a session now).
  const slots: Array<{ surface: string } | { session: true }> = []
  const placedSurfaces = new Set<string>()
  let sessionSlots = 0
  for (const key of order) {
    if (surfaceSet.has(key) && !placedSurfaces.has(key)) {
      slots.push({ surface: key })
      placedSurfaces.add(key)
    } else if (sessionSet.has(key) && sessionSlots < sessionKeys.length) {
      slots.push({ session: true })
      sessionSlots += 1
    }
  }
  for (; sessionSlots < sessionKeys.length; sessionSlots += 1) slots.push({ session: true })
  for (const key of surfaces) if (!placedSurfaces.has(key)) slots.push({ surface: key })
  let next = 0
  return slots.map((slot) => ('surface' in slot ? slot.surface : sessionKeys[next++]!))
}

/**
 * Those of `ordered` that fit `visible` windows: session panes go before
 * surfaces. Sessions go from the end of `sessionKeys` (the pins) when given —
 * so moving a window never changes which sessions fit — else from the end of
 * `ordered`; surfaces from the end of `ordered`.
 */
export function fitWindows(ordered: readonly string[], visible: number, sessionKeys?: readonly string[]): string[] {
  const drop = Math.max(0, ordered.length - Math.max(0, visible))
  if (drop === 0) return [...ordered]
  const removed = new Set<number>()
  const sessionOrder = sessionKeys
    ? [...sessionKeys].reverse().map((key) => ordered.indexOf(key)).filter((index) => index >= 0)
    : ordered.map((_, index) => ordered.length - 1 - index).filter((index) => !isSurfaceWindowKey(ordered[index]!))
  for (const index of sessionOrder) {
    if (removed.size >= drop) break
    removed.add(index)
  }
  for (let index = ordered.length - 1; index >= 0 && removed.size < drop; index -= 1) removed.add(index)
  return ordered.filter((_, index) => !removed.has(index))
}

/** `ordered` with the windows at `a` and `b` exchanged: the new slot order to remember. */
export function swapWindowSlots(ordered: readonly string[], a: number, b: number): string[] {
  const next = [...ordered]
  if (a < 0 || b < 0 || a >= next.length || b >= next.length) return next
  ;[next[a], next[b]] = [next[b]!, next[a]!]
  return next
}

/** `ordered` with `key` moved beside `anchor` (after it unless `before`). */
export function moveWindowBeside(ordered: readonly string[], key: string, anchor: string, before: boolean): string[] {
  if (key === anchor) return [...ordered]
  const next = ordered.filter((entry) => entry !== key)
  const at = next.indexOf(anchor)
  if (at < 0) return [...ordered]
  next.splice(before ? at : at + 1, 0, key)
  return next
}

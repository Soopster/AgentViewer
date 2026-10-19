// Windows that share one frame as tabs, and the one window floating over the
// layout. Both hold window keys (a session key, or `surface:<id>`) off the
// layout: the session pins and surface list keep saying what is laid out, and
// a tab's frame is wherever its active member is.

/** A tab group: every member's window key, in tab order. Exactly one member is in the layout. */
export type WindowStack = string[]

export function stackOf(stacks: readonly WindowStack[], key: string): WindowStack | null {
  return stacks.find((stack) => stack.includes(key)) ?? null
}

/** `stacks` with `key` added as a tab of `anchor`'s frame, after it; `key` leaves any other stack. */
export function addToStack(stacks: readonly WindowStack[], anchor: string, key: string): WindowStack[] {
  if (anchor === key) return stacks.map((stack) => [...stack])
  const without = removeFromStack(stacks, key)
  const index = without.findIndex((stack) => stack.includes(anchor))
  if (index < 0) return [...without, [anchor, key]]
  const stack = without[index]!
  const next = [...stack]
  next.splice(stack.indexOf(anchor) + 1, 0, key)
  return without.map((entry, at) => (at === index ? next : entry))
}

/** `stacks` without `key`; a stack left with one member is no longer a stack. */
export function removeFromStack(stacks: readonly WindowStack[], key: string): WindowStack[] {
  return stacks
    .map((stack) => stack.filter((member) => member !== key))
    .filter((stack) => stack.length > 1)
}

/** The member `delta` tabs from `key`, wrapping. */
export function stackNeighbour(stack: WindowStack, key: string, delta: number): string | null {
  const index = stack.indexOf(key)
  if (index < 0 || stack.length < 2) return null
  return stack[(index + delta + stack.length * 4) % stack.length]!
}

/** The member that takes a frame when `key` leaves it: the next tab, else the one before. */
export function stackSuccessor(stack: WindowStack, key: string): string | null {
  const index = stack.indexOf(key)
  if (index < 0 || stack.length < 2) return null
  return stack[index + 1] ?? stack[index - 1] ?? null
}

/**
 * The stacks that still hold together. A member must still exist (`exists`), and
 * a stack must have exactly one member in the layout (`laidOut`) — its frame. A
 * stack with none has no frame to show its tabs in, and is dropped; with more
 * than one, the first laid-out member keeps the frame and the others leave the
 * stack, since they are windows of their own now.
 */
export function liveStacks(
  stacks: readonly WindowStack[],
  exists: (key: string) => boolean,
  laidOut: (key: string) => boolean,
): WindowStack[] {
  const claimed = new Set<string>()
  const result: WindowStack[] = []
  for (const stack of stacks) {
    const present = stack.filter((key) => exists(key) && !claimed.has(key))
    const frame = present.find(laidOut)
    if (!frame) continue
    const members = present.filter((key) => key === frame || !laidOut(key))
    if (members.length < 2) continue
    for (const key of members) claimed.add(key)
    result.push(members)
  }
  return result
}

/** `keys` with `from` replaced by `to` (and any other copy of `to` removed). */
export function replaceWindowKey(keys: readonly string[], from: string, to: string): string[] {
  return keys.filter((key) => key !== to).map((key) => (key === from ? to : key))
}

/** Where a floating window sits, in cells relative to the window area. */
export type FloatingRect = { x: number; y: number; width: number; height: number }

export const FLOATING_MIN_WIDTH = 24
export const FLOATING_MIN_HEIGHT = 6

/** A floating window opens centred, at most three quarters of the area each way. */
export function defaultFloatingRect(area: { width: number; height: number }): FloatingRect {
  const width = Math.max(Math.min(FLOATING_MIN_WIDTH, area.width), Math.min(area.width - 4, Math.round(area.width * 0.75)))
  const height = Math.max(Math.min(FLOATING_MIN_HEIGHT, area.height), Math.min(area.height - 2, Math.round(area.height * 0.75)))
  return clampFloatingRect({ x: Math.round((area.width - width) / 2), y: Math.round((area.height - height) / 2), width, height }, area)
}

/** `rect` kept inside the area and at least the minimum size, so it can always be grabbed again. */
export function clampFloatingRect(rect: FloatingRect, area: { width: number; height: number }): FloatingRect {
  const width = Math.max(Math.min(FLOATING_MIN_WIDTH, area.width), Math.min(rect.width, area.width))
  const height = Math.max(Math.min(FLOATING_MIN_HEIGHT, area.height), Math.min(rect.height, area.height))
  return {
    x: Math.max(0, Math.min(rect.x, area.width - width)),
    y: Math.max(0, Math.min(rect.y, area.height - height)),
    width,
    height,
  }
}

// Where the reader's mounted card window starts, held outside React.
//
// It was `useState` in the OpenTUI root, so every window slide re-rendered the
// whole root (~4-5ms before a single card mounts) to move a slice of the
// transcript. The transcript window component subscribes here instead, and a
// slide re-renders it alone. The root reads the value imperatively (key
// handlers, effects) and never subscribes — `readerWindowSmoke.tsx` asserts
// that with `readRootRenderCount()`, because the frame is identical either way.
//
// `null` means "follow the tail": the window is derived from the card count.

export type ReaderWindowStore = {
  get: () => number | null
  subscribe: (listener: () => void) => () => void
  // A slide or a recenter: the window component re-renders on its own.
  set: (next: number | null) => void
  // For a change that rides a root render already on its way (a session switch
  // restoring its saved window alongside its cursor and expansion state).
  // Notifying there would render the window twice: once for the new start under
  // the old state, then again with the rest.
  prime: (next: number | null) => void
}

/** One per transcript window: each slides its own mounted card window. */
export function createReaderWindowStore(): ReaderWindowStore {
  let start: number | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => start,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      if (next === start) return
      start = next
      for (const listener of listeners) listener()
    },
    prime: (next) => { start = next },
  }
}

// The window the root's reader draws in.
const readerStore = createReaderWindowStore()
export const getReaderWindowStart = readerStore.get
export const subscribeReaderWindowStart = readerStore.subscribe
export const setReaderWindowStart = readerStore.set
export const primeReaderWindowStart = readerStore.prime

export type ReaderWindow = { start: number; end: number }

// The mounted slice for a transcript of `total` cards: all of it when it fits,
// the tail while following, otherwise `size` cards from the stored start.
export function deriveReaderWindow(
  total: number,
  size: number,
  followTail: boolean,
  storedStart: number | null,
): ReaderWindow {
  if (total <= size) return { start: 0, end: total }
  if (followTail || storedStart == null) return { start: total - size, end: total }
  const windowStart = Math.max(0, Math.min(storedStart, total - size))
  return { start: windowStart, end: windowStart + size }
}

// One commit's worth of progress from what is mounted toward `target`.
//
// A window change costs what it mounts: ~0.3ms a card, against a root render
// that is no longer on this path at all. So no commit mounts more than `step`
// new cards. A wheel slide moves the target by one step and lands in one
// commit; a recenter or a jump to the far end of a transcript mounts a step
// around `focus` (the cursor, or the tail) and grows from there over the
// following commits, nearest side first. `mounted` null means nothing
// comparable is on screen (first mount, another session): take the target
// whole, as before.
export function stepReaderWindow(
  mounted: ReaderWindow | null,
  target: ReaderWindow,
  focus: number,
  step: number,
): ReaderWindow {
  if (!mounted || target.end - target.start <= step) return target
  const focusIndex = Math.max(target.start, Math.min(focus, target.end - 1))
  let start = Math.max(mounted.start, target.start)
  let end = Math.min(mounted.end, target.end)
  // A slide moves the window one step, so the focus is at most a step outside
  // what stays mounted — and the focus is the cursor, which a wheel scroll
  // leaves wherever it was. Seeding there dropped the whole window for eight
  // cards on every upward slide in the views that show a cursor, moving the
  // text by a hundred rows. Only a jump puts the focus further away than that.
  const focusGap = focusIndex < start ? start - focusIndex : focusIndex >= end ? focusIndex - end + 1 : 0
  if (end <= start || focusGap > step) {
    // Nothing mounted that the reader is looking at: seed around the focus.
    start = Math.max(target.start, Math.min(focusIndex - Math.floor(step / 2), target.end - step))
    return { start, end: start + step }
  }
  let budget = step
  const growEnd = () => {
    const added = Math.min(budget, target.end - end)
    end += added
    budget -= added
  }
  const growStart = () => {
    const added = Math.min(budget, start - target.start)
    start -= added
    budget -= added
  }
  if (focusIndex - start < end - 1 - focusIndex) {
    growStart()
    growEnd()
  } else {
    growEnd()
    growStart()
  }
  return { start, end }
}

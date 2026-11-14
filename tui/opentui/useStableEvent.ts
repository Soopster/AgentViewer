import { useRef } from 'react'

/**
 * A callback with one identity for the component's lifetime that always runs
 * the latest closure.
 *
 * Use it instead of `useCallback` in the root. A memoized closure keeps the
 * render scope it was made in, and that scope keeps whichever older memoized
 * closures were current then, so two callbacks recreated at different renders
 * chain every past render together with each render's state. The root kept
 * one whole transcript per session browsed that way.
 *
 * The wrapper is made once, outside the component's scope, and only the latest
 * closure is kept. It is updated during render rather than in a layout effect:
 * the root has a few hundred of these, and an effect each was work on every
 * commit. A handler called before the commit already sees the newest state.
 */
export function useStableEvent<Callback extends (...args: never[]) => unknown>(callback: Callback): Callback {
  const box = useRef<{ latest: Callback; stable: Callback } | null>(null)
  if (box.current) box.current.latest = callback
  else {
    const created: { latest: Callback; stable: Callback } = {
      latest: callback,
      stable: ((...args: Parameters<Callback>) => created.latest(...args)) as Callback,
    }
    box.current = created
  }
  return box.current.stable
}

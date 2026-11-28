/** @jsxImportSource @opentui/react */
import React, { createContext, useContext, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

/** Visibility is a lifecycle input, separate from focus and native clipping.
 * Retaining a window must not keep its presentation refreshes running. */
export const WindowVisibleContext = createContext(true)
export const useWindowVisible = () => useContext(WindowVisibleContext)

/** Commit the hide transition once (so effects release their work), then keep
 * the subtree's props stable until resume. Provider/session processes keep
 * running; only presentation updates are suspended. */
export const RetainedWindow = React.memo(function RetainedWindow({ visible, children }: {
  visible: boolean
  identity?: string
  children: React.ReactNode
}) {
  return <WindowVisibleContext value={visible}>{children}</WindowVisibleContext>
}, (previous, next) => !previous.visible && !next.visible && previous.identity === next.identity)

const subscribeNothing = () => () => {}
/** Subscribe only while visible, retaining the last committed snapshot while
 * hidden. Backend stores keep running independently; resume reads their latest
 * version before paint rather than replaying every hidden publication. */
export function useWindowSnapshot<Value>(subscribe: (listener: () => void) => () => void, snapshot: () => Value): Value {
  const visible = useWindowVisible()
  const committed = useRef({ value: snapshot() })
  const read = useCallback(() => visible ? snapshot() : committed.current.value, [visible, snapshot])
  const value = useSyncExternalStore(visible ? subscribe : subscribeNothing, read, read)
  useLayoutEffect(() => { committed.current = { value } }, [value])
  return value
}

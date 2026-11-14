import { useCallback, useRef, useState } from 'react'

/** A view borrows a runtime connection; releasing it never changes routing. */
export function usePresentationInterest() {
  const leases = useRef(new Set<symbol>())
  const [count, setCount] = useState(0)
  const acquire = useCallback(() => {
    const token = Symbol('presentation')
    leases.current.add(token)
    setCount(leases.current.size)
    return () => { if (leases.current.delete(token)) setCount(leases.current.size) }
  }, [])
  return { count, acquire }
}

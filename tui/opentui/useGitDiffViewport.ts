import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { captureDiffAnchor, diffRowWindow, resolveDiffAnchor, type DiffGeometry, type DiffViewportAnchor } from './gitDiffGeometry'

/** Keep file/source reading anchors while mounting only the current row window. */
export function useGitDiffViewport(
  scrollRef: RefObject<ScrollBoxRenderable | null>,
  geometry: DiffGeometry,
  documentKey: string,
  ready: boolean,
  viewportHeight: number,
  jumpKey?: string,
  onJump?: (index: number) => void,
  jumpRevision = 0,
  anchorGroup = documentKey,
) {
  const [top, setTop] = useState(0)
  const current = useRef<{ geometry: DiffGeometry; key: string; group: string; top: number; preferredKey?: string } | null>(null)
  const lastJump = useRef<string | undefined>(undefined)
  const acceptingScroll = useRef(false)
  const positions = useRef(new Map<string, DiffViewportAnchor>())
  useEffect(() => {
    const bar = scrollRef.current?.verticalScrollBar
    if (!bar) return
    const changed = ({ position }: { position: number }) => {
      if (!acceptingScroll.current) return
      if (current.current) current.current.top = position
      setTop(position)
    }
    bar.on('change', changed)
    return () => { bar.off('change', changed) }
  }, [scrollRef])

  useLayoutEffect(() => {
    acceptingScroll.current = ready
    if (!ready) return
    const previous = current.current
    if (previous) {
      positions.current.delete(previous.key)
      positions.current.set(previous.key, captureDiffAnchor(previous.geometry, previous.top, previous.preferredKey))
      if (positions.current.size > 80) positions.current.delete(positions.current.keys().next().value!)
    }
    const previousAnchor = previous?.group === anchorGroup ? captureDiffAnchor(previous.geometry, previous.top, previous.preferredKey) : undefined
    const retainedAnchor = previousAnchor?.keys.some(key => geometry.byKey.has(key)) ? previousAnchor : undefined
    const anchor = positions.current.get(documentKey) ?? retainedAnchor
    const jumpIdentity = jumpKey ? JSON.stringify([jumpKey, jumpRevision]) : undefined
    const jumpIndex = jumpKey && jumpIdentity !== lastJump.current ? geometry.byKey.get(jumpKey) : undefined
    if (jumpIndex !== undefined || !jumpKey) lastJump.current = jumpIdentity
    if (jumpIndex !== undefined) onJump?.(jumpIndex)
    const targetTop = jumpIndex !== undefined ? geometry.rows[jumpIndex]!.top : anchor ? resolveDiffAnchor(geometry, anchor) : 0
    const nextTop = Math.max(0, Math.min(targetTop, geometry.total - viewportHeight))
    current.current = { geometry, key: documentKey, group: anchorGroup, top: nextTop, preferredKey: anchor?.keys[0] }
    setTop(nextTop)
    // The new spacers must finish layout before ScrollBox can accept their full extent.
    const timer = setTimeout(() => { scrollRef.current?.scrollTo(nextTop) }, 0)
    return () => { clearTimeout(timer) }
  }, [anchorGroup, documentKey, geometry, jumpKey, jumpRevision, onJump, ready, scrollRef, viewportHeight])

  return { ...diffRowWindow(geometry, top, viewportHeight), top }
}

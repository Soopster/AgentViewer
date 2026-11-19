/** @jsxImportSource @opentui/react */
import React, { useEffect, useRef, useState } from 'react'
import { RGBA, type MouseEvent } from '@opentui/core'
import { createPortal, useRenderer } from '@opentui/react'
import { useWindowVisible } from '../../../tui/opentui/shell/sdkDiff'
import type { GitPopoverProps } from './GitPopover'

/** Mouse coordinates are terminal-relative; deltas also work inside offset windows. */
export function GitDivider({ id, vertical, width, height, size, theme, onResize }: {
  id: string; vertical: boolean; width: number; height: number; size: number; theme: GitPopoverProps['theme']; onResize: (size: number) => void
}) {
  const renderer = useRenderer()
  const visible = useWindowVisible()
  const start = useRef<{ position: number; size: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => { if (!visible) { start.current = null; setDragging(false) } }, [visible])
  const move = (event: MouseEvent) => {
    event.stopPropagation()
    if (start.current) onResize(start.current.size + (vertical ? event.x : event.y) - start.current.position)
  }
  const release = (event: MouseEvent) => { move(event); start.current = null; setDragging(false) }
  return <><box id={id} width={width} height={height} flexShrink={0} backgroundColor={theme.surface}
    onMouseDown={event => { if (event.button !== 0) return; event.stopPropagation(); start.current = { position: vertical ? event.x : event.y, size }; setDragging(true) }}
    onMouseDrag={move} onMouseUp={release} onMouseDragEnd={release}>
    <text fg={dragging ? theme.cyan : theme.border} selectable={false} wrapMode="none">{vertical ? Array.from({ length: height }, () => '│').join('\n') : '─'.repeat(width)}</text>
  </box>
    {visible && dragging ? createPortal(<box id={`git-divider-drag:${id}`} position="absolute" top={0} left={0} width={renderer.width} height={renderer.height} zIndex={10000} backgroundColor={RGBA.fromValues(0, 0, 0, 0)} onMouseDrag={move} onMouseUp={release} onMouseDragEnd={release} />, renderer.root, null) : null}
  </>
}

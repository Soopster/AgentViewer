/** @jsxImportSource @opentui/react */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { RGBA, type MouseEvent } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import type { TuiThemePalette } from '../theme'
import { useBordersVisible } from './app/borders'
import { ResizeReadout } from './ResizeReadout'

export type PaneResizeKind = 'sidebar' | 'inspector' | 'drawer' | 'files' | 'composer' | 'tasks' | 'surface-width' | 'surface-rows'
export type PaneResizeEdge = 'left' | 'right' | 'top' | 'bottom'
export type PaneResizeBinding = {
  min: number; max: number
  available?: number
  apply: (value: number) => void
  restore: () => void
  commit?: (value: number) => void
}
type Limits = { min: number; max: number }
type StartResize = (kind: PaneResizeKind, extent: number, edge: PaneResizeEdge, event: MouseEvent, limits?: Limits) => void
const ResizeContext = createContext<{ start: StartResize; theme: TuiThemePalette } | null>(null)
export const PaneResizeProvider = ResizeContext.Provider
export function useSharedPaneResize(): boolean { return useContext(ResizeContext) !== null }

export function paneResizeExtent(extent: number, edge: PaneResizeEdge, dx: number, dy: number, min: number, max: number) {
  const delta = edge === 'left' ? -dx : edge === 'right' ? dx : edge === 'top' ? -dy : dy
  return Math.round(Math.max(min, Math.min(extent + delta, Math.max(min, max))))
}

/** One app-wide pointer owner for a drag, including after it leaves the border. */
export function usePaneResize({ blocked, width, height, theme, bindings }: {
  blocked: boolean; width: number; height: number; theme: TuiThemePalette; bindings: Partial<Record<PaneResizeKind, PaneResizeBinding>>
}) {
  const renderer = useRenderer()
  const [dragging, setDragging] = useState(false)
  const [readout, setReadout] = useState<{ x: number; y: number; value: number; available?: number; unit: string } | null>(null)
  const drag = useRef<{ extent: number; value: number; edge: PaneResizeEdge; x: number; y: number; binding: PaneResizeBinding } | null>(null)
  const finish = (cancel = false) => {
    const previous = drag.current
    drag.current = null
    if (previous) {
      if (cancel) previous.binding.restore()
      else previous.binding.commit?.(previous.value)
    }
    setDragging(false)
    setReadout(null)
  }
  useEffect(() => {
    const cancel = () => finish(true)
    renderer.on('blur', cancel)
    renderer.on('resize', cancel)
    return () => { renderer.off('blur', cancel); renderer.off('resize', cancel); if (drag.current) cancel() }
  }, [renderer, blocked])
  const move = (event: MouseEvent) => {
    const current = drag.current
    if (!current) return
    event.preventDefault(); event.stopPropagation()
    const value = paneResizeExtent(current.extent, current.edge, event.x - current.x, event.y - current.y, current.binding.min, current.binding.max)
    if (current.value !== value) { current.value = value; current.binding.apply(value) }
    setReadout({ x: event.x, y: event.y, value, available: current.binding.available, unit: current.edge === 'left' || current.edge === 'right' ? 'cols' : 'rows' })
  }
  const start: StartResize = (kind, extent, edge, event, limits) => {
    const binding = bindings[kind]
    if (blocked || !binding || event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); renderer.clearSelection()
    drag.current = { extent, value: extent, edge, x: event.x, y: event.y, binding: limits ? { ...binding, ...limits } : binding }
    setDragging(true)
    setReadout({ x: event.x, y: event.y, value: extent, available: binding.available, unit: edge === 'left' || edge === 'right' ? 'cols' : 'rows' })
  }
  return {
    start,
    context: { start, theme },
    cancel: () => { if (!drag.current) return false; finish(true); return true },
    layer: dragging ? <><box id="pane-resize-capture" position="absolute" left={0} top={0}
      width={width} height={height} zIndex={1000} backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
      onMouseDrag={move} onMouseMove={event => { if (event.isDragging) move(event) }}
      onMouseUp={event => { move(event); event.preventDefault(); event.stopPropagation(); finish() }} />
      {readout ? <ResizeReadout id="pane-resize-readout"
        left={Math.max(0, Math.min(width - 26, readout.x + 2))} top={Math.max(0, Math.min(height - 1, readout.y - 1))}
        width={Math.min(26, width)} zIndex={1001} theme={theme}
        label={`${readout.value}${readout.available === undefined ? '' : ` / ${Math.max(0, readout.available - readout.value)}`} ${readout.unit}`} /> : null}</> : null,
  }
}

/** A one-cell target on the existing border; never consumes content space. */
function handlePosition(edge: PaneResizeEdge, inset: number, leading: number, trailing: number) {
  const vertical = edge === 'left' || edge === 'right'
  return {
    vertical,
    left: edge === 'left' ? inset : !vertical ? leading : undefined,
    right: edge === 'right' ? inset : !vertical ? trailing : undefined,
    top: edge === 'top' ? inset : vertical ? leading : undefined,
    bottom: edge === 'bottom' ? inset : vertical ? trailing : undefined,
    width: vertical ? 1 : undefined, height: vertical ? undefined : 1,
  }
}

export function PaneResizeHandle({ id, kind, extent, edge, direction, limits, inset = 0, leading = 0, trailing = 0 }: {
  id?: string
  kind: PaneResizeKind; extent: number; edge: PaneResizeEdge; limits?: Limits
  direction?: PaneResizeEdge
  /** Bordered boxes position children inside the border; -1 covers its actual cells. */
  inset?: number; leading?: number; trailing?: number
}) {
  const context = useContext(ResizeContext)
  const renderer = useRenderer()
  const bordersVisible = useBordersVisible()
  const [hovered, setHovered] = useState(false)
  const [length, setLength] = useState(1)
  if (!context) return null
  const { vertical, ...position } = handlePosition(edge, inset, leading, trailing)
  return <box id={id ?? `pane-resize-${kind}`} position="absolute" zIndex={40} overflow="hidden"
    backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
    {...position}
    onSizeChange={function () { setLength(Math.max(1, vertical ? this.height : this.width)) }}
    onMouseOver={() => { setHovered(true); renderer.setMousePointer(vertical ? 'ew-resize' : 'ns-resize') }}
    onMouseOut={() => { setHovered(false); renderer.setMousePointer('default') }}
    onMouseDown={event => context.start(kind, extent, direction ?? edge, event, limits)}>
    <text fg={!bordersVisible ? context.theme.bg : hovered ? context.theme.cyan : context.theme.border} selectable={false} wrapMode="none">
      {vertical ? Array(length).fill(bordersVisible ? '│' : ' ').join('\n') : (bordersVisible ? '─' : ' ').repeat(length)}
    </text>
  </box>
}

import { CliRenderEvents, EditBufferRenderable, Renderable, RGBA, ScrollBoxRenderable, SelectRenderable, TabSelectRenderable, TargetChannel, parseColor, type MouseEvent } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { useEffect } from 'react'

type Point = { x: number; y: number }
type HoverRegion = { node: Renderable; top: number; bottom: number; strength: number }

/** OpenTUI exposes setters for mouse handlers. Keep the installed runtime's
 * handler and select-layout fields at this boundary. */
function mouseHandlers(node: Renderable) {
  return (node as unknown as { _mouseListeners?: Partial<Record<MouseEvent['type'], unknown>> })._mouseListeners
}

function hoverRegion(target: Renderable | undefined, point: Point): HoverRegion | undefined {
  for (let node: Renderable | null = target ?? null; node; node = node.parent) {
    const handlers = mouseHandlers(node)
    if (node instanceof TabSelectRenderable) return // The session tab painter handles individual tabs.
    if (handlers?.over || handlers?.move || handlers?.out) {
      // Session rows use mouse enter/exit for their full-title preview.
      if (!node.id.startsWith('sidebar:')) return
    }
    const top = node.y
    const bottom = top + node.height
    if (node instanceof SelectRenderable) {
      const layout = node as unknown as { scrollOffset: number; linesPerItem: number; _itemSpacing: number }
      const slot = Math.floor((point.y - top) / layout.linesPerItem)
      const itemTop = top + slot * layout.linesPerItem
      const itemBottom = itemTop + layout.linesPerItem - layout._itemSpacing
      if (slot >= 0 && slot + layout.scrollOffset < node.options.length && itemTop + layout.linesPerItem <= bottom && point.y < itemBottom) {
        return { node, top: itemTop, bottom: itemBottom, strength: 0.14 }
      }
      return
    }
    if (node instanceof EditBufferRenderable) return { node, top, bottom, strength: 0.08 }
    if (!handlers?.down && !handlers?.up) continue
    // Large click-to-focus frames and drag surfaces don't behave like buttons.
    if (node.height <= 4 || node.id.startsWith('sidebar:')) return { node, top, bottom, strength: 0.14 }
  }
}

/**
 * Paint through the hovered control's native hook, so scroll viewports and
 * higher layers clip it in the same pass as the control itself.
 */
export function useMouseHover(textColor: string) {
  const renderer = useRenderer()
  useEffect(() => {
    let pointer: Point | undefined
    let owner: Renderable | undefined
    let restore: (() => void) | undefined
    let mask = new Float32Array(0)
    const { r, g, b } = parseColor(textColor)
    const matrix = new Float32Array([
      0, 0, 0, r,
      0, 0, 0, g,
      0, 0, 0, b,
      0, 0, 0, 1,
    ])
    const clear = () => {
      restore?.()
      restore = undefined
      owner = undefined
      pointer = undefined
    }
    renderer.root.onMouse = event => {
      if (event.type === 'drag' || event.source || event.isDragging) {
        clear()
        return
      }
      if (event.type !== 'move' && event.type !== 'over' && event.type !== 'out') return
      const point = { x: event.x, y: event.y }
      // OpenTUI emits out/over between child nodes. Keep the same hover hook
      // installed when both children belong to the same control.
      const target = event.type === 'out'
        ? Renderable.renderablesByNumber.get(renderer.hitTest(point.x, point.y))
        : event.target ?? undefined
      const next = hoverRegion(target, point)
      if (next?.node === owner) {
        if (owner && pointer?.y !== point.y && owner instanceof SelectRenderable) renderer.requestRender()
        pointer = point
        return
      }

      clear()
      pointer = point
      if (!next) return
      const { node } = next
      owner = node
      // Native editors skip render hooks and already have their own focused fill.
      if (node instanceof EditBufferRenderable) {
        const base = node.backgroundColor
        const tint = next.strength
        const remaining = base.a * (1 - tint)
        const alpha = tint + remaining
        const tinted = RGBA.fromValues(
          (base.r * remaining + r * tint) / alpha,
          (base.g * remaining + g * tint) / alpha,
          (base.b * remaining + b * tint) / alpha,
          alpha,
        )
        node.backgroundColor = tinted
        restore = () => {
          if (!node.isDestroyed && node.backgroundColor.equals(tinted)) node.backgroundColor = base
        }
        return
      }
      const prior = node.renderAfter
      const paint: NonNullable<Renderable['renderAfter']> = function (buffer, deltaTime) {
        prior?.call(this, buffer, deltaTime)
        if (!pointer || renderer.getSelection()?.isDragging) return
        const region = hoverRegion(node, pointer)
        if (!region || region.node !== node) return
        let left = Math.max(0, node.x)
        let right = Math.min(buffer.width, node.x + node.width)
        let firstRow = Math.max(0, region.top)
        let lastRow = Math.min(buffer.height, region.bottom)
        // The color-matrix operation takes absolute cells and ignores scissor.
        for (let parent = node.parent; parent; parent = parent.parent) {
          const clip = parent instanceof ScrollBoxRenderable ? parent.viewport
            : parent.overflow === 'visible' ? null : parent
          if (!clip) continue
          left = Math.max(left, clip.x)
          right = Math.min(right, clip.x + clip.width)
          firstRow = Math.max(firstRow, clip.y)
          lastRow = Math.min(lastRow, clip.y + clip.height)
        }
        if (pointer.x < left || pointer.x >= right || pointer.y < firstRow || pointer.y >= lastRow) return
        const capacity = (right - left) * (lastRow - firstRow) * 3
        if (mask.length < capacity) mask = new Float32Array(capacity)
        let used = 0
        for (let y = firstRow; y < lastRow; y++) {
          for (let x = left; x < right; x++) {
            mask[used++] = x
            mask[used++] = y
            mask[used++] = 1
          }
        }
        buffer.colorMatrix(matrix, mask.subarray(0, used), region.strength, TargetChannel.BG)
      }
      node.renderAfter = paint
      node.requestRender()
      restore = () => {
        if (node.isDestroyed || node.renderAfter !== paint) return
        node.renderAfter = prior
        node.requestRender()
      }
    }
    renderer.on(CliRenderEvents.BLUR, clear)
    return () => {
      if (!renderer.root.isDestroyed) renderer.root.onMouse = undefined
      renderer.off(CliRenderEvents.BLUR, clear)
      clear()
    }
  }, [renderer, textColor])
}

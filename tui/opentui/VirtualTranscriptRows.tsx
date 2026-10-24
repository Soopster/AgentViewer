/** @jsxImportSource @opentui/react */
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { LayoutEvents, type BoxRenderable, type ScrollBoxRenderable } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { RowHeightIndex } from './rowHeightIndex'
import { useWindowVisible } from './windowActivity'
import { useStableEvent } from './useStableEvent'

export type TranscriptBlockRestore = { id: string; offset: number }
export const TranscriptBlockRestoreContext = createContext<RefObject<TranscriptBlockRestore | null> | null>(null)
export const TranscriptViewportContext = createContext<RefObject<ScrollBoxRenderable | null> | null>(null)

/** Shares the window's scrolling surface. Spacers retain the complete content
 * extent, while only visible blocks/rows and overscan own native renderables.
 * Measurement keys include document geometry (e.g. width and diff layout).
 */
export function VirtualTranscriptRows<Row>({ rows, rowKey, estimateHeight, geometryKey, renderRow, jumpKey, documentKey = '', threshold = 160 }: {
  rows: readonly Row[]
  rowKey: (row: Row, index: number) => string
  estimateHeight: (row: Row, index: number) => number
  geometryKey: string
  renderRow: (row: Row, index: number) => React.ReactNode
  documentKey?: string
  threshold?: number
  jumpKey?: string
}) {
  const viewport = useContext(TranscriptViewportContext)
  const restoring = useContext(TranscriptBlockRestoreContext)
  const visible = useWindowVisible()
  const renderer = useRenderer()
  const root = useRef<BoxRenderable | null>(null)
  const nodes = useRef(new Map<number, BoxRenderable>())
  const measurements = useRef<{ key: string; heights: Map<string, number> }>({ key: geometryKey, heights: new Map() })
  const model = useMemo(() => {
    const old = measurements.current.key === geometryKey ? measurements.current.heights : new Map<string, number>()
    const retained = new Map<string, number>()
    const keys = rows.map(rowKey)
    const heights = rows.map((row, index) => {
      const measured = old.get(keys[index]!)
      if (measured !== undefined) retained.set(keys[index]!, measured)
      return measured ?? estimateHeight(row, index)
    })
    return { keys, index: new RowHeightIndex(heights), measurements: { key: geometryKey, heights: retained } }
  }, [rows, geometryKey])
  useLayoutEffect(() => { measurements.current = model.measurements }, [model])
  const virtual = Boolean(viewport && rows.length > threshold)
  const [range, setRange] = useState(() => model.index.window(0, viewport?.current?.viewport.height || 24))
  const currentRange = useRef(range)
  const idForKey = (key: string) => `virtual-row:${JSON.stringify([documentKey, key])}`
  const restoreLookup = useRef<{ id: string; model: typeof model; index: number } | null>(null)
  const syncing = useRef(false)
  const sync = useStableEvent(() => {
    const sb = viewport?.current
    const block = root.current
    if (!virtual || !visible || !sb || !block) return
    let relativeTop = sb.scrollTop - (block.y - sb.content.y)
    const request = restoring?.current
    if (request && (restoreLookup.current?.id !== request.id || restoreLookup.current.model !== model)) {
      restoreLookup.current = { id: request.id, model, index: model.keys.findIndex(key => idForKey(key) === request.id) }
    }
    if (request && (restoreLookup.current?.index ?? -1) >= 0) {
      relativeTop = model.index.offset(restoreLookup.current!.index) - request.offset
      const top = block.y - sb.content.y + relativeTop
      if (!syncing.current && Math.abs(sb.scrollTop - top) > 0.5) {
        syncing.current = true
        try { sb.scrollTo(top) } finally { syncing.current = false }
      }
    }
    // A far-offscreen block needs one placeholder, not a window at either end.
    const next = relativeTop + sb.viewport.height < -sb.viewport.height || relativeTop > model.index.total + sb.viewport.height
      ? { start: 0, end: 0, before: 0, after: model.index.total }
      : model.index.window(relativeTop, sb.viewport.height)
    const previous = currentRange.current
    if (previous.start !== next.start || previous.end !== next.end || previous.before !== next.before || previous.after !== next.after) {
      currentRange.current = next
      setRange(next)
    }
  })
  useEffect(() => {
    if (!virtual || !visible) return
    const sb = viewport?.current
    const bar = sb?.verticalScrollBar
    const measure = () => {
      const block = root.current
      if (!sb || !block) return
      const relativeTop = sb.scrollTop - (block.y - sb.content.y)
      const anchor = model.index.at(Math.max(0, relativeTop))
      let correction = 0
      for (const [index, node] of nodes.current) {
        if (node.isDestroyed || node.height <= 0) continue
        const delta = model.index.update(index, node.height)
        measurements.current.heights.set(model.keys[index]!, node.height)
        if (index < anchor) correction += delta
      }
      if (correction && relativeTop > 0) sb.scrollTo(sb.scrollTop + correction)
      sync()
    }
    bar?.on('change', sync)
    renderer.root.on(LayoutEvents.LAYOUT_CHANGED, measure)
    sync()
    return () => { bar?.off('change', sync); renderer.root.off(LayoutEvents.LAYOUT_CHANGED, measure) }
  }, [viewport, renderer, virtual, visible, model, sync])
  const lastJump = useRef(jumpKey)
  useEffect(() => {
    if (!virtual || !visible || !jumpKey || jumpKey === lastJump.current) return
    lastJump.current = jumpKey
    const position = model.keys.indexOf(jumpKey)
    const sb = viewport?.current
    const block = root.current
    if (position < 0 || !sb || !block) return
    const top = block.y - sb.content.y + model.index.offset(position)
    if (top < sb.scrollTop || top + model.index.height(position) > sb.scrollTop + sb.viewport.height) {
      sb.scrollTo(top)
      sync()
    }
  }, [jumpKey, virtual, visible, model, viewport, sync])
  if (!virtual) return <>{rows.map(renderRow)}</>
  // A new document must not reuse another document's stale range bounds.
  const start = Math.min(range.start, rows.length)
  const end = Math.max(start, Math.min(range.end, rows.length))
  return <box ref={root} flexDirection="column">
    {model.index.offset(start) > 0 ? <box height={model.index.offset(start)} flexShrink={0} /> : null}
    {rows.slice(start, end).map((row, relative) => {
      const index = start + relative
      return <box key={model.keys[index]} id={idForKey(model.keys[index]!)} ref={node => { if (node) nodes.current.set(index, node); else nodes.current.delete(index) }} flexDirection="column" flexShrink={0}>
        {renderRow(row, index)}
      </box>
    })}
    {model.index.total - model.index.offset(end) > 0 ? <box height={model.index.total - model.index.offset(end)} flexShrink={0} /> : null}
  </box>
}

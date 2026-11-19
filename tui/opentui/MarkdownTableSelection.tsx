/** @jsxImportSource @opentui/react */
import { BoxRenderable, Selection, type BoxOptions, type RenderContext, type TextRenderable } from '@opentui/core'
import { extend } from '@opentui/react'

export type MarkdownTableCell = { row: number; column: number; node: TextRenderable }
type Options = BoxOptions & { cells: Map<string, MarkdownTableCell>; columns: number[] }

/** One selection owner for the mounted table cells. Text buffers remain
 * viewport-sized while single-cell, column-lock and tab-separated grid copy
 * retain native table semantics. Only public selection APIs are used. */
export class MarkdownTableSelection extends BoxRenderable {
  cells: Map<string, MarkdownTableCell>
  columns: number[]
  private mode: string | null = null
  constructor(context: RenderContext, options: Options) {
    super(context, options)
    this.cells = options.cells; this.columns = options.columns
    this.selectable = true
  }
  private cellAt(x: number, y: number) {
    return [...this.cells.values()].find(({ node }) => !node.isDestroyed && x >= node.x && x < node.x + node.width
      && y >= node.y && y < node.y + (node.parent?.height ?? node.height))
  }
  private columnAt(x: number): number | null {
    let left = this.x + 1
    for (let index = 0; index < this.columns.length; index++) {
      if (x >= left && x < left + this.columns[index]!) return index
      left += this.columns[index]! + 1
    }
    return null
  }
  override shouldStartSelection(x: number, y: number) { return this.selectable && Boolean(this.cellAt(x, y)) }
  override onSelectionChanged(selection: Selection | null): boolean {
    if (!selection?.isActive) {
      for (const { node } of this.cells.values()) if (!node.isDestroyed) node.onSelectionChanged(null)
      this.mode = null
      return false
    }
    const anchor = this.cellAt(selection.anchor.x, selection.anchor.y)
    const focus = this.cellAt(selection.focus.x, selection.focus.y)
    const column = anchor?.column ?? this.columnAt(selection.anchor.x)
    const mode = anchor && focus && anchor.row === focus.row && anchor.column === focus.column
      ? 'single' : column !== null && this.columnAt(selection.focus.x) === column ? 'column' : 'grid'
    const changed = this.mode !== mode
    this.mode = mode
    const top = Math.min(selection.anchor.y, selection.focus.y), bottom = Math.max(selection.anchor.y, selection.focus.y)
    for (const cell of this.cells.values()) {
      const { node } = cell
      if (node.isDestroyed) continue
      const height = node.parent?.height ?? node.height
      const isAnchor = anchor?.row === cell.row && anchor.column === cell.column
      if (bottom < node.y || top >= node.y + height || mode === 'single' && !isAnchor || mode === 'column' && column !== cell.column) {
        node.onSelectionChanged(null)
        continue
      }
      const fullAnchor = isAnchor && mode !== 'single'
      const local = new Selection(node,
        fullAnchor ? { x: node.x - 1, y: node.y } : selection.anchor,
        fullAnchor ? { x: node.x + node.width, y: node.y + height } : selection.focus,
        selection.behavior)
      local.isActive = true; local.isDragging = selection.isDragging; local.isStart = selection.isStart || changed || fullAnchor
      node.onSelectionChanged(local)
    }
    return this.hasSelection()
  }
  override hasSelection() { return [...this.cells.values()].some(({ node }) => !node.isDestroyed && node.hasSelection()) }
  override getSelectedText() {
    const rows = new Map<number, Array<{ column: number; text: string }>>()
    for (const { row, column, node } of this.cells.values()) {
      if (node.isDestroyed || !node.hasSelection()) continue
      const text = node.getSelectedText()
      if (!text.length) continue
      const selected = rows.get(row) ?? []
      selected.push({ column, text }); rows.set(row, selected)
    }
    return [...rows].sort(([a], [b]) => a - b).map(([, cells]) => cells.sort((a, b) => a.column - b.column).map(cell => cell.text).join('\t')).join('\n')
  }
}

extend({ markdownTableSelection: MarkdownTableSelection })
declare module '@opentui/react' { interface OpenTUIComponents { markdownTableSelection: typeof MarkdownTableSelection } }

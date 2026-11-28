/** @jsxImportSource @opentui/react */
// A stacked (unified) diff in two halves, so a host can own what differs and share the rest:
//   useStackDiffModel — parse, context expansion, row heights and geometry (no rendering);
//   StackDiffView     — the windowed, syntax-coloured scrollbox over that model.
// The Engineering inspector uses both; the Git review uses the rows, geometry and DiffStackRow
// with its own selection, notes and split layout around them.
import React, { useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import { buildPierreDiffView, type TuiPierreDiffRow } from '../pierreDiffView'
import { applyDiffContext, type DiffContextGap } from '../gitDiffContext'
import { buildDiffGeometry, diffRowKeys, type DiffGeometry } from './geometry'
import { useDiffContext } from './useDiffContext'
import { useDiffViewport } from './useDiffViewport'
import { useDiffHighlights } from './useDiffHighlights'
import { diffGutterDigits, diffStackRowHeight, diffStackTextColumns } from './rowStyle'
import { DiffContextGapRow, DiffStackRow } from './DiffStackRow'

export type StackDiffModelOptions = {
  diffText: string
  /** Identity of what is shown: scroll anchors and context expansions are kept per key. */
  documentKey: string
  /** Repository the omitted context is read from. */
  cwd: string
  width: number
  appearance?: 'dark' | 'light'
  wrap?: boolean
  tabWidth?: number
  showLineNumbers?: boolean
  /** Columns a host draws after the text (badges). */
  trailingColumns?: number
  /** Offer `[+] Show N lines` rows that read omitted context from the base blob. */
  expandable?: boolean
  /** Drop per-file header rows, for a view that already names its one file. */
  hideFileRows?: boolean
}

export type StackDiffModel = ReturnType<typeof useStackDiffModel>

export function useStackDiffModel(options: StackDiffModelOptions) {
  const { diffText, documentKey, cwd, width, appearance = 'dark', wrap = true, tabWidth = 4, showLineNumbers = true, trailingColumns = 0, expandable = true, hideFileRows = false } = options
  const { expansions, change } = useDiffContext(cwd, documentKey)
  const base = useMemo(() => diffText ? buildPierreDiffView(diffText, documentKey, null, appearance, false, expandable) : null, [diffText, documentKey, appearance, expandable])
  const view = useMemo(() => base && expandable ? applyDiffContext(base, expansions) : base, [base, expandable, expansions])
  const rows = useMemo(() => (view?.rows ?? []).filter(row => !(hideFileRows && row.tone === 'file')), [view, hideFileRows])
  const gutterDigits = useMemo(() => diffGutterDigits(rows), [rows])
  const textColumns = diffStackTextColumns(width, gutterDigits, showLineNumbers, trailingColumns)
  const heights = useMemo(() => rows.map(row => diffStackRowHeight(row, textColumns, tabWidth, wrap)), [rows, textColumns, tabWidth, wrap])
  const geometry: DiffGeometry = useMemo(() => buildDiffGeometry(rows.map((row, index) => ({ keys: diffRowKeys(row), height: heights[index]! }))), [rows, heights])
  const hunkRows = useMemo(() => rows.flatMap((row, index) => row.tone === 'hunk' ? [index] : []), [rows])
  return {
    files: base?.files, rows, heights, geometry, hunkRows, gutterDigits, textColumns, tabWidth, wrap, showLineNumbers, width, documentKey, appearance,
    expansions, changeContext: change as (gap: DiffContextGap, collapse?: boolean) => void,
  }
}

export type StackDiffHunk = { row: number; newStart: number; newEnd: number; text: string }

/** Each hunk's first row, new-side line range and unified text (`@@` header plus its lines), read off the model's rows. */
export function stackDiffHunks(model: Pick<StackDiffModel, 'rows' | 'hunkRows'>): StackDiffHunk[] {
  return model.hunkRows.map((start, index) => {
    const end = model.hunkRows[index + 1] ?? model.rows.length
    const lines = [model.rows[start]!.text]
    let newStart = Infinity, newEnd = 0
    for (let at = start + 1; at < end; at++) {
      const row = model.rows[at]!
      if (row.tone === 'file') break
      if (row.contextGap || !(row.tone === 'context' || row.tone === 'addition' || row.tone === 'deletion')) continue
      lines.push(`${row.tone === 'addition' ? '+' : row.tone === 'deletion' ? '-' : ' '}${row.text}`)
      if (row.newLine != null) { newStart = Math.min(newStart, row.newLine); newEnd = Math.max(newEnd, row.newLine) }
    }
    if (!Number.isFinite(newStart)) { newStart = 1; newEnd = 1 }
    return { row: start, newStart, newEnd, text: lines.join('\n') }
  })
}

/** The row a host should treat as "the hunk the cursor is in" for a row index. */
export function stackDiffHunkAt(model: Pick<StackDiffModel, 'hunkRows'>, rowIndex: number): number {
  let hunk = -1
  for (const [index, row] of model.hunkRows.entries()) { if (row <= rowIndex) hunk = index; else break }
  return hunk
}

export function StackDiffView({ model, theme, height, id, cursor = null, jumpKey, jumpRevision = 0, scrollRef, highlight = true, ready = true,
  rowBackground, trailing, onRowPress, emptyText = 'No textual diff.' }: {
  model: StackDiffModel
  theme: TuiThemePalette
  /** Viewport rows; the view mounts only these plus overscan. */
  height: number
  id?: string
  /** Row index drawn with the ▶ cursor. */
  cursor?: number | null
  /** Scroll so the row with this geometry key is at the top, whenever the key or revision changes. */
  jumpKey?: string
  jumpRevision?: number
  scrollRef?: RefObject<ScrollBoxRenderable | null>
  highlight?: boolean
  ready?: boolean
  rowBackground?: (row: TuiPierreDiffRow, index: number) => string | undefined
  trailing?: (row: TuiPierreDiffRow, index: number) => ReactNode
  onRowPress?: (index: number) => void
  emptyText?: string
}) {
  const ownRef = useRef<ScrollBoxRenderable | null>(null)
  const ref = scrollRef ?? ownRef
  const window = useDiffViewport(ref, model.geometry, model.documentKey, ready, height, jumpKey, undefined, jumpRevision)
  const highlights = useDiffHighlights(model.files, model.rows, window.start, window.end, model.appearance, highlight)
  return <scrollbox ref={ref} id={id} height={height} flexShrink={0}>
    {window.before > 0 ? <box height={window.before} flexShrink={0} /> : null}
    {!model.rows.length ? <text fg={theme.dim}>{` ${emptyText}`}</text> : null}
    {model.rows.slice(window.start, window.end).map((row, local) => {
      const index = window.start + local
      if (row.contextGap) return <DiffContextGapRow key={row.key} row={row} theme={theme} width={model.width} cursor={cursor === index}
        onPress={collapse => { onRowPress?.(index); model.changeContext(row.contextGap!, collapse) }} />
      const file = highlights.get(row.filePath ?? '')
      const spans = row.newLine != null ? file?.new.get(row.newLine) : row.oldLine != null ? file?.old.get(row.oldLine) : undefined
      return <DiffStackRow key={row.key} row={row} theme={theme} width={model.width} height={model.heights[index]!}
        gutterDigits={model.gutterDigits} showLineNumbers={model.showLineNumbers} textColumns={model.textColumns}
        tabWidth={model.tabWidth} wrap={model.wrap} spans={spans} cursor={cursor === index}
        background={rowBackground?.(row, index)} trailing={trailing?.(row, index)}
        onMouseUp={onRowPress ? event => { if (event.button === 0) { event.stopPropagation(); onRowPress(index) } } : undefined} />
    })}
    {window.after > 0 ? <box height={window.after} flexShrink={0} /> : null}
  </scrollbox>
}

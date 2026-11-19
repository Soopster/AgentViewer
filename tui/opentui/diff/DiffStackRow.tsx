/** @jsxImportSource @opentui/react */
import React, { type ReactNode } from 'react'
import type { MouseEvent } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import type { TuiPierreDiffRow, TuiRenderSpan } from '../pierreDiffView'
import { DiffCodeText } from '../DiffCodeText'
import { diffRowBackground, diffRowColor, diffRowIndicator, fitDiffCell, formatDiffLineNumber, isDiffCodeRow } from './rowStyle'

type MouseHandler = (event: MouseEvent) => void

/**
 * One unified diff row: old/new gutter, cursor/indicator, then the code. Everything a host adds
 * (selection colour, note badges, mouse handling) arrives as props, so the Git review and the
 * Engineering inspector draw the same cells.
 */
export const DiffStackRow = React.memo(function DiffStackRow({
  row, theme, width, height, gutterDigits, showLineNumbers = true, textColumns, tabWidth, wrap, offset = 0,
  spans, cursor = false, background, searchQuery = '', trailing, onMouseDown, onMouseDrag, onMouseOver, onMouseMove, onMouseUp,
}: {
  row: TuiPierreDiffRow
  theme: TuiThemePalette
  width: number
  height: number
  gutterDigits: number
  showLineNumbers?: boolean
  textColumns: number
  tabWidth: number
  wrap: boolean
  /** Horizontal scroll offset for code rows when not wrapping. */
  offset?: number
  /** Syntax spans for this row; falls back to the row's own. */
  spans?: TuiRenderSpan[]
  cursor?: boolean
  /** Overrides the tone background (a selection, say). */
  background?: string
  searchQuery?: string
  /** A column after the text (the Git review's note badge). */
  trailing?: ReactNode
  onMouseDown?: MouseHandler; onMouseDrag?: MouseHandler; onMouseOver?: MouseHandler; onMouseMove?: MouseHandler; onMouseUp?: MouseHandler
}) {
  const fg = diffRowColor(row, theme)
  const code = isDiffCodeRow(row)
  const indicator = diffRowIndicator(row)
  return <box width={width} height={height} flexShrink={0} flexDirection="row" backgroundColor={background ?? diffRowBackground(row, theme)}
    onMouseDown={onMouseDown} onMouseDrag={onMouseDrag} onMouseOver={onMouseOver} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
    {showLineNumbers ? <>
      <text fg={theme.dim} wrapMode="none">{fitDiffCell(formatDiffLineNumber(row.oldLine, gutterDigits), gutterDigits)}</text>
      <text fg={theme.dim} wrapMode="none"> </text>
      <text fg={theme.dim} wrapMode="none">{fitDiffCell(formatDiffLineNumber(row.newLine, gutterDigits), gutterDigits)}</text>
    </> : null}
    <text fg={cursor ? theme.cyan : fg} wrapMode="none">{fitDiffCell(cursor ? `▶${indicator} ` : ` ${indicator} `, 3)}</text>
    <DiffCodeText text={row.text || ' '} spans={spans ?? row.spans} searchQuery={code ? searchQuery : ''} searchFg={theme.bg} searchBg={theme.amber}
      columns={textColumns} tabWidth={tabWidth} wrap={wrap && code} offset={code ? offset : 0} fg={fg} />
    {trailing}
  </box>
})

/** The `[+] Show 20 preceding lines · e` row standing in for omitted context. */
export const DiffContextGapRow = React.memo(function DiffContextGapRow({ row, theme, width, cursor = false, onPress }: {
  row: Pick<TuiPierreDiffRow, 'text'>; theme: TuiThemePalette; width: number; cursor?: boolean
  /** Shift-click collapses an expansion instead of growing it. */
  onPress?: (collapse: boolean) => void
}) {
  return <box height={1} flexShrink={0} width={width} backgroundColor={cursor ? theme.surface3 : theme.surface2}
    onMouseUp={event => { if (event.button !== 0 || !onPress) return; event.stopPropagation(); onPress(event.modifiers.shift) }}>
    <text fg={theme.cyan} wrapMode="none">{fitDiffCell(`${cursor ? '▶ ' : '  '}${row.text ?? ''}`, width - 1)}</text>
  </box>
})

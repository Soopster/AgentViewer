/** @jsxImportSource @opentui/react */
import { type TuiPierreDiffRow, type TuiPierreSplitRow } from '../pierreDiffView'
import { type SelectedLineRange } from '@pierre/diffs'
import { type TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { join } from 'node:path'

export type TranscriptDiffNoteDraft = {
  legacyAnchor?: string
  anchor: string
  range: SelectedLineRange
  lineLabel: string
  text: string
}

export type TranscriptDiffNote = {
  range: SelectedLineRange
  text: string
}

export type TranscriptDiffSelectionPoint = {
  lineNumber: number
  side: SelectedLineRange['side']
}

export type TranscriptDiffSelectionSpan = {
  startIndex: number
  endIndex: number
  selection: SelectedLineRange
  key: string
  label: string
}

export function transcriptDiffStackRowAnchor(namespace: string, row: TuiPierreDiffRow): string | null {
  if (row.newLine !== undefined) return `${namespace}:new:${row.newLine}`
  if (row.oldLine !== undefined) return `${namespace}:old:${row.oldLine}`
  return null
}

export function transcriptDiffSplitRowAnchor(namespace: string, row: TuiPierreSplitRow): string | null {
  if (row.right?.lineNum !== undefined) return `${namespace}:new:${row.right.lineNum}`
  if (row.left?.lineNum !== undefined) return `${namespace}:old:${row.left.lineNum}`
  return null
}

export function transcriptDiffSelectionPointForStackRow(row: TuiPierreDiffRow): TranscriptDiffSelectionPoint | null {
  if (row.newLine !== undefined) return { lineNumber: row.newLine, side: 'additions' }
  if (row.oldLine !== undefined) return { lineNumber: row.oldLine, side: 'deletions' }
  return null
}

export function transcriptDiffSelectionPointForSplitRow(row: TuiPierreSplitRow): TranscriptDiffSelectionPoint | null {
  if (row.right?.lineNum !== undefined) return { lineNumber: row.right.lineNum, side: 'additions' }
  if (row.left?.lineNum !== undefined) return { lineNumber: row.left.lineNum, side: 'deletions' }
  return null
}

export function transcriptDiffCardNamespace(namespace: string, cardKey: string): string {
  return `${namespace}\u0000card:${cardKey}`
}

export function transcriptDiffSelectionKey(namespace: string, selection: SelectedLineRange): string {
  return [namespace, selection.start, selection.side ?? '', selection.end, selection.endSide ?? ''].join('\u0000')
}

export function transcriptDiffSelectionLineLabel(selection: SelectedLineRange): string {
  const start = `L${selection.start}${selection.side === 'deletions' ? ' (old)' : ''}`
  const end = `L${selection.end}${selection.endSide === 'deletions' ? ' (old)' : ''}`
  return selection.start === selection.end && selection.side === selection.endSide ? start : `${start} → ${end}`
}

export function transcriptDiffSelectionPointForRow(row: TuiPierreDiffRow | TuiPierreSplitRow): TranscriptDiffSelectionPoint | null {
  const splitRow = row as TuiPierreSplitRow
  if (splitRow.left !== undefined || splitRow.right !== undefined) {
    return transcriptDiffSelectionPointForSplitRow(splitRow)
  }
  return transcriptDiffSelectionPointForStackRow(row as TuiPierreDiffRow)
}

export function transcriptDiffSelectionSpanFromRowRange(
  namespace: string,
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  startIndex: number,
  endIndex: number,
): TranscriptDiffSelectionSpan | null {
  if (rows.length === 0) return null
  const lo = Math.max(0, Math.min(startIndex, endIndex))
  const hi = Math.min(rows.length - 1, Math.max(startIndex, endIndex))
  let startPoint: TranscriptDiffSelectionPoint | null = null
  for (let index = lo; index <= hi; index += 1) {
    startPoint = transcriptDiffSelectionPointForRow(rows[index] as TuiPierreDiffRow | TuiPierreSplitRow)
    if (startPoint) break
  }
  let endPoint: TranscriptDiffSelectionPoint | null = null
  for (let index = hi; index >= lo; index -= 1) {
    endPoint = transcriptDiffSelectionPointForRow(rows[index] as TuiPierreDiffRow | TuiPierreSplitRow)
    if (endPoint) break
  }
  if (!startPoint || !endPoint) return null
  const selection: SelectedLineRange = {
    start: startPoint.lineNumber,
    side: startPoint.side,
    end: endPoint.lineNumber,
    endSide: endPoint.side,
  }
  return {
    startIndex: lo,
    endIndex: hi,
    selection,
    key: transcriptDiffSelectionKey(namespace, selection),
    label: transcriptDiffSelectionLineLabel(selection),
  }
}

export function transcriptDiffSelectionSpanFromSelection(
  namespace: string,
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  selection: SelectedLineRange,
): TranscriptDiffSelectionSpan | null {
  if (rows.length === 0) return null
  let startIndex = -1
  let endIndex = -1
  for (let index = 0; index < rows.length; index += 1) {
    const point = transcriptDiffSelectionPointForRow(rows[index] as TuiPierreDiffRow | TuiPierreSplitRow)
    if (!point) continue
    if (startIndex === -1 && point.lineNumber === selection.start && point.side === selection.side) {
      startIndex = index
    }
    if (point.lineNumber === selection.end && point.side === selection.endSide) {
      endIndex = index
    }
  }
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null
  return {
    startIndex,
    endIndex,
    selection,
    key: transcriptDiffSelectionKey(namespace, selection),
    label: transcriptDiffSelectionLineLabel(selection),
  }
}

export function nextTranscriptDiffRowIndex(
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  currentIndex: number,
  direction: 1 | -1,
  showHunkHeaders: boolean,
): number | null {
  if (rows.length === 0) return null
  const hunkIndexes = rows
    .map((row, index) => row.tone === 'hunk' ? index : -1)
    .filter((index) => index >= 0)
  if (hunkIndexes.length === 0) return null

  const next = direction > 0
    ? hunkIndexes.find((index) => index > currentIndex) ?? hunkIndexes[0]
    : [...hunkIndexes].reverse().find((index) => index < currentIndex) ?? hunkIndexes[hunkIndexes.length - 1]
  if (showHunkHeaders) return next

  for (let index = next + 1; index < rows.length; index += 1) {
    if (rows[index]?.tone !== 'hunk') return index
  }
  return next
}

export function renderTranscriptDiffNoteDraft(draft: TranscriptDiffNoteDraft, width: number, theme: TuiThemePalette) {
  const displayText = draft.text || 'Write a note…'
  return (
    <box width={width} flexDirection="column" border borderStyle="single" borderColor={theme.cyan} paddingX={1}>
      <box>
        <text fg={theme.cyan} wrapMode="none">
          {fitText(`Draft note — ${draft.lineLabel}`, Math.max(width - 4, 8))}
        </text>
      </box>
      <box height={2}>
        <text fg={draft.text ? theme.text : theme.dim} wrapMode="none">
          {`${displayText}${draft.text ? '▋' : ''}`}
        </text>
      </box>
      <box flexDirection="row" paddingY={0}>
        <box flexGrow={1} />
        <text fg={theme.green} wrapMode="none">Save (^S)</text>
        <text fg={theme.dim} wrapMode="none">{'  '}</text>
        <text fg={theme.muted} wrapMode="none">Cancel (Esc)</text>
      </box>
    </box>
  )
}

export function renderTranscriptDiffNoteCard(
  note: TranscriptDiffNote,
  width: number,
  theme: TuiThemePalette,
  label: string,
  onSendToComposer?: () => void,
) {
  return (
    <box width={width} flexDirection="column" border borderStyle="single" borderColor={theme.violet} paddingX={1}>
      <box flexDirection="row">
        <text fg={theme.violet} wrapMode="none">
          {fitText(`Note — ${label}`, Math.max(width - 6, 8))}
        </text>
        <box flexGrow={1} />
        {onSendToComposer ? (
          <text fg={theme.green} wrapMode="none"> C:composer</text>
        ) : null}
        <text fg={theme.dim} wrapMode="none"> x:del</text>
      </box>
      <box>
        <text fg={theme.text} wrapMode="none">{note.text}</text>
      </box>
      {onSendToComposer ? (
        <box flexDirection="row">
          <box flexGrow={1} />
          <text fg={theme.green} wrapMode="none" onMouseUp={(event) => {
            event.stopPropagation()
            onSendToComposer()
          }}>Send to composer</text>
        </box>
      ) : null}
    </box>
  )
}
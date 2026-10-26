/** @jsxImportSource @opentui/react */
import { SyntaxStyle } from '@opentui/core'
import React from 'react'
import { detectTuiCodeFiletypeFromPath } from '../../codeFiletypes'
import type { TuiTranscriptCard } from '../../format'
import type { TuiThemePalette } from '../../theme'
import { cardDiffView, cardDiffText, filePathFromDiffText, diffMetaFilePath } from './transcriptRows'
import { diffRowColor, formatDiffLineNumber, diffRowIndicator } from './transcriptStyle'
import type { TuiPierreDiffRow } from '../pierreDiffView'
import type { SelectionColors } from '../selectionTree'
import { fitText } from '../textLayout'

const STREAM_DIFF_PREVIEW_MAX_ROWS = 7
type StreamDiffPreviewData = {
  rows: TuiPierreDiffRow[]
  hiddenRows: number
  gutterWidth: number
  filetype: string | undefined
  additions: number
  deletions: number
}
const STREAM_DIFF_PREVIEW_CACHE = new WeakMap<TuiTranscriptCard, StreamDiffPreviewData | null>()
export function streamDiffPreviewData(card: TuiTranscriptCard): StreamDiffPreviewData | null {
  if (STREAM_DIFF_PREVIEW_CACHE.has(card)) return STREAM_DIFF_PREVIEW_CACHE.get(card) ?? null
  const diffView = cardDiffView(card, false)
  if (!diffView) {
    STREAM_DIFF_PREVIEW_CACHE.set(card, null)
    return null
  }
  const contentRows = diffView.rows.filter((row) => row.oldLine != null || row.newLine != null)
  if (contentRows.length === 0) {
    STREAM_DIFF_PREVIEW_CACHE.set(card, null)
    return null
  }
  const firstChangeIndex = contentRows.findIndex((row) => row.tone === 'addition' || row.tone === 'deletion')
  const startIndex = Math.max((firstChangeIndex >= 0 ? firstChangeIndex : 0) - 2, 0)
  const rows = contentRows.slice(startIndex, startIndex + STREAM_DIFF_PREVIEW_MAX_ROWS)
  const largestLineNumber = rows.reduce((largest, row) => Math.max(largest, row.newLine ?? row.oldLine ?? 0), 0)
  const diffText = cardDiffText(card, false)
  const filePath = filePathFromDiffText(diffText, diffMetaFilePath(card) ?? card.label)
  const value = {
    rows,
    hiddenRows: contentRows.length - rows.length,
    gutterWidth: Math.max(String(largestLineNumber).length, 2),
    filetype: detectTuiCodeFiletypeFromPath(filePath),
    additions: contentRows.filter((row) => row.tone === 'addition').length,
    deletions: contentRows.filter((row) => row.tone === 'deletion').length,
  }
  STREAM_DIFF_PREVIEW_CACHE.set(card, value)
  return value
}
export function StreamDiffPreview({
  card, theme, syntaxStyle, width, selectionColors,
}: {
  card: TuiTranscriptCard
  theme: TuiThemePalette
  syntaxStyle: SyntaxStyle | null
  width: number
  selectionColors: SelectionColors
}) {
  const preview = streamDiffPreviewData(card)
  if (!preview) return null
  const gutterWidth = preview.gutterWidth + 4
  const codeWidth = Math.max(width - gutterWidth, 8)
  const codeContent = preview.rows.map((row) => row.text).join('\n')
  const changeParts = [
    preview.additions > 0
      ? `Added ${preview.additions} ${preview.additions === 1 ? 'line' : 'lines'}`
      : '',
    preview.deletions > 0
      ? `${preview.additions > 0 ? 'removed' : 'Removed'} ${preview.deletions} ${preview.deletions === 1 ? 'line' : 'lines'}`
      : '',
  ].filter(Boolean)
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={0}>
      {changeParts.length > 0 ? (
        <text fg={theme.text} wrapMode="none" selectable {...selectionColors}>
          <span fg={theme.dim}>{'└  '}</span>
          {changeParts.join(', ')}
        </text>
      ) : null}
      <box flexDirection="row" height={preview.rows.length}>
        {/* Each column is one text, a span per row — see groupLinesByBackground. */}
        <box width={gutterWidth} flexDirection="column">
          <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
            {preview.rows.map((row, index) => (
              <React.Fragment key={`${row.key}:gutter`}>
                {index > 0 ? '\n' : null}
                <span fg={diffRowColor(row, theme)}>
                  {`${formatDiffLineNumber(row.newLine ?? row.oldLine, preview.gutterWidth)} ${row.indicator ?? diffRowIndicator(row)} `}
                </span>
              </React.Fragment>
            ))}
          </text>
        </box>
        {syntaxStyle ? (
          <code
            content={codeContent}
            filetype={preview.filetype}
            syntaxStyle={syntaxStyle}
            drawUnstyledText={true}
            selectable
            {...selectionColors}
            style={{ height: preview.rows.length }}
            width={codeWidth} />
        ) : (
          <box width={codeWidth} flexDirection="column">
            <text fg={theme.text} wrapMode="none" selectable {...selectionColors}>
              {preview.rows.map((row, index) => (
                <React.Fragment key={`${row.key}:plain`}>
                  {index > 0 ? '\n' : null}
                  <span fg={diffRowColor(row, theme)}>{fitText(row.text, codeWidth)}</span>
                </React.Fragment>
              ))}
            </text>
          </box>
        )}
      </box>
      {preview.hiddenRows > 0 ? (
        <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
          {fitText(`   … ${preview.hiddenRows} more lines`, width)}
        </text>
      ) : null}
    </box>
  )
}

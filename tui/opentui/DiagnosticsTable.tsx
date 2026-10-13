/** @jsxImportSource @opentui/react */
import React, { memo, useMemo } from 'react'
import { RGBA, TextTableRenderable, type TextTableContent } from '@opentui/core'
import { extend } from '@opentui/react'
import type { TuiThemePalette } from '../theme'

extend({ textTable: TextTableRenderable })

declare module '@opentui/react' {
  interface OpenTUIComponents {
    textTable: typeof TextTableRenderable
  }
}

/** What a provider joins a diagnostics row's fields with. */
const FIELD_SEPARATOR = ' · '

export type DiagnosticRun =
  | { kind: 'lines'; start: number; items: string[] }
  | { kind: 'table'; start: number; rows: string[][] }

/**
 * Splits a section's rows into runs that are tables and runs that are prose.
 *
 * A row is tabular when it has more than one field, and a table needs two such
 * rows in a row: a heading or a sentence between them stays a line of its own,
 * because as a one-cell row it would set the first column's width for every
 * row around it.
 */
export function diagnosticRuns(items: string[]): DiagnosticRun[] {
  const runs: DiagnosticRun[] = []
  let index = 0
  while (index < items.length) {
    const start = index
    const rows: string[][] = []
    while (index < items.length) {
      const fields = items[index]!.split(FIELD_SEPARATOR)
      if (fields.length < 2) break
      rows.push(fields)
      index += 1
    }
    if (rows.length >= 2) {
      runs.push({ kind: 'table', start, rows })
      continue
    }
    // One tabular row alone, or none: it is a line. Take the prose after it too.
    index = start + Math.max(rows.length, 1)
    while (index < items.length && !items[index]!.includes(FIELD_SEPARATOR)) index += 1
    const previous = runs[runs.length - 1]
    const lines = items.slice(start, index)
    if (previous?.kind === 'lines') previous.items.push(...lines)
    else runs.push({ kind: 'lines', start, items: lines })
  }
  return runs
}

export const DiagnosticsTable = memo(function DiagnosticsTable({
  rows,
  theme,
  width,
}: {
  rows: string[][]
  theme: TuiThemePalette
  width: number
}) {
  const content = useMemo<TextTableContent>(() => {
    const columns = rows.reduce((most, row) => Math.max(most, row.length), 0)
    const lead = RGBA.fromHex(theme.text)
    const rest = RGBA.fromHex(theme.muted)
    return rows.map((row) => Array.from({ length: columns }, (_, column) => (
      row[column] === undefined
        ? null
        : [{ __isChunk: true as const, text: row[column]!, fg: column === 0 ? lead : rest }]
    )))
  }, [rows, theme.text, theme.muted])
  return (
    <textTable
      content={content}
      width={width}
      flexShrink={0}
      border={false}
      outerBorder={false}
      columnGap={2}
      cellPadding={0}
      wrapMode="word"
      columnWidthMode="content"
      columnFitter="balanced"
      backgroundColor={theme.surface}
    />
  )
})

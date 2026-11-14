/** @jsxImportSource @opentui/react */
import React, { useMemo } from 'react'
import type { TuiRenderSpan } from './pierreDiffView'
import { highlightDiffMatches } from './gitDiffReviewActions'
import { layoutDiffText } from './gitDiffText'

/** Paint exactly the wrapped or horizontally sliced cells used by diff geometry. */
export function DiffCodeText({ text, spans, columns, tabWidth, wrap, offset, fg, searchQuery = '', searchFg = fg, searchBg }: {
  text: string; spans?: TuiRenderSpan[]; columns: number; tabWidth: number; wrap: boolean; offset: number; fg: string; searchQuery?: string; searchFg?: string; searchBg?: string
}) {
  const highlighted = useMemo(() => searchQuery && searchBg ? highlightDiffMatches(text, spans, searchQuery, searchFg, searchBg) : spans, [text, spans, searchQuery, searchFg, searchBg])
  const lines = useMemo(() => layoutDiffText(text, columns, tabWidth, wrap, offset, highlighted), [text, highlighted, columns, tabWidth, wrap, offset])
  return <text width={columns} height={lines.length} fg={fg} wrapMode="none">
    {lines.map((line, index) => <React.Fragment key={index}>
      {index > 0 ? '\n' : ''}
      {line.length ? line.map((span, i) => <span key={i} fg={span.fg ?? fg} bg={span.bg}>{span.text}</span>) : ' '}
    </React.Fragment>)}
  </text>
}

/** @jsxImportSource @opentui/react */
import React from 'react'
import type { TuiThemePalette } from '../theme'

export function DiffReviewActionsBar({ theme, width, query, editing, matchLabel, status, onSearch, onNext, onCopy }: {
  theme: TuiThemePalette; width: number; query: string; editing: boolean; matchLabel: string; status: string
  onSearch: () => void; onNext: (direction: number) => void; onCopy: (side: 'old' | 'new') => void
}) {
  const button = (text: string, action: () => void) => <text fg={theme.cyan} wrapMode="none" onMouseUp={event => {
    if (event.button === 0) { event.stopPropagation(); action() }
  }}>{text}</text>
  return <box id="git-diff-review-actions" height={1} width={width} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>
    {button(' ^F find ', onSearch)}
    {query || editing ? <text fg={theme.text} wrapMode="none">{`${query}${editing ? '▏' : ''} ${matchLabel} `}</text> : null}
    {query ? <>{button(' ^R prev ', () => onNext(-1))}{button(' ^G next ', () => onNext(1))}</> : null}
    {button(' y copy ', () => onCopy('new'))}{button(' Y old ', () => onCopy('old'))}
    {status ? <text fg={theme.muted} wrapMode="none">{status}</text> : null}
  </box>
}

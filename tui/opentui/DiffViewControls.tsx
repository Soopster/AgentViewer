/** @jsxImportSource @opentui/react */
import React from 'react'
import type { TuiThemePalette } from '../theme'
import type { DiffLayoutMode } from './gitDiffText'

/** Keep pointer and keyboard access to the same diff preferences. */
export function DiffViewControls({ width, theme, mode, layout, wrap, tabWidth, offset, onLayout, onWrap, onTabs, onPan, onFilter }: {
  width: number; theme: TuiThemePalette; mode: DiffLayoutMode; layout: 'stack' | 'split'; wrap: boolean; tabWidth: number; offset: number
  onLayout: () => void; onWrap: () => void; onTabs: () => void; onPan: (delta: number) => void; onFilter: () => void
}) {
  const button = (label: string, action: () => void) => <text fg={theme.cyan} wrapMode="none" onMouseUp={event => {
    if (event.button !== 0) return
    event.stopPropagation(); action()
  }}>{label}</text>
  return <box id="git-diff-controls" width={width} height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>
    {button(` ${mode === 'auto' ? 'auto:' : ''}${layout === 'stack' ? 'unified' : 'split'} `, onLayout)}
    {button(` z wrap:${wrap ? 'on' : 'off'} `, onWrap)}
    {button(` T tabs:${tabWidth} `, onTabs)}
    {button(' h← ', () => onPan(-8))}
    <text fg={theme.muted} wrapMode="none">{wrap ? '—' : String(offset)}</text>
    {button(' →l ', () => onPan(8))}
    {button(' / filter ', onFilter)}
  </box>
}

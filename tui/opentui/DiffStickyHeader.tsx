/** @jsxImportSource @opentui/react */
import React from 'react'
import type { TuiThemePalette } from '../theme'
import type { DiffProgress } from './gitDiffProgress'

export function DiffStickyHeader({ width, theme, progress }: { width: number; theme: TuiThemePalette; progress: DiffProgress | null }) {
  if (!progress) return <box id="git-diff-sticky-header" width={width} height={1} flexShrink={0} backgroundColor={theme.surface2} />
  const file = `${progress.fileIndex}/${progress.fileCount} ${progress.filePath}`
  const hunk = progress.hunkHeader && progress.hunkCount ? `  ${progress.hunkIndex}/${progress.hunkCount} ${progress.hunkHeader}` : ''
  return <box id="git-diff-sticky-header" width={width} height={1} flexShrink={0} backgroundColor={theme.surface2}>
    <text fg={theme.cyan} wrapMode="none">{`${file}${hunk}`.slice(0, Math.max(1, width - 1))}</text>
  </box>
}

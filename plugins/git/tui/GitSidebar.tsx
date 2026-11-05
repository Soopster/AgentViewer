/** @jsxImportSource @opentui/react */
import React from 'react'
import type { RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { GitDivider } from './GitDivider'
import type { GitPopoverProps } from './GitPopover'

export type GitNavigation = { id: string; label: string; kind: 'local' | 'history' | 'branch' | 'remote-branch' | 'stash' | 'worktree' | 'group' | 'tag' | 'submodule'; ref?: string; path?: string; selector?: string; depth?: number }
const fit = (value: string, columns: number) => value.length <= columns ? value : `${value.slice(0, Math.max(0, columns - 1))}…`
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, ' ')
export function GitSidebar({ theme, width, height, repository, rows, cursor, selection, focused, visible, filter, filtering, scrollRef, onChoose, onFilter, onEdit, onResize, onCollapse }: {
  theme: GitPopoverProps['theme']; width: number; height: number; repository: string; rows: GitNavigation[]; cursor: number; selection: string
  focused: boolean; visible: boolean; filter: string; filtering: boolean; scrollRef: RefObject<ScrollBoxRenderable | null>
  onCollapse: () => void; onResize: (width: number) => void; onChoose: (index: number) => void; onFilter: (value: string) => void; onEdit: () => void
}) {
  const innerWidth = Math.max(1, width - 3)
  const row = (item: GitNavigation, index: number) => {
    const selected = item.kind !== 'group' && item.id === selection
    const pointed = focused && cursor === index
    const prefix = item.kind === 'local' ? '± ' : item.kind === 'history' ? '≡ ' : item.kind === 'group' ? '' : '  '.repeat(item.depth ?? 1)
    return <box id={`git-sidebar-row:${item.id}`} key={item.id} width={width - 1} height={1} flexShrink={0} paddingX={1} overflow="hidden" backgroundColor={selected || pointed ? theme.surface3 : undefined} onMouseDown={event => { event.stopPropagation(); onChoose(index) }}>
      <text fg={selected || pointed ? theme.cyan : item.kind === 'group' ? theme.muted : theme.text} wrapMode="none">{fit(`${prefix}${clean(item.label)}`, innerWidth)}</text>
    </box>
  }
  return <box id="git-navigation" width={width} height={height} flexShrink={0} overflow="hidden" flexDirection="column" border={[]} backgroundColor={theme.surface2}>
    <box height={2} flexShrink={0} paddingX={1}><text fg={theme.text} wrapMode="none"><b>{fit(clean(repository), Math.max(1, innerWidth - 3))}</b></text><box id="git-sidebar-collapse" position="absolute" right={1} top={0} width={2} height={1} onMouseDown={event => { event.stopPropagation(); onCollapse() }}><text fg={theme.cyan} selectable={false}>◀</text></box></box>
    {rows.slice(0, 2).map(row)}
    <box height={1} flexShrink={0} border={['bottom']} borderColor={theme.border} />
    <box id="git-sidebar-filter" height={1} flexShrink={0} marginX={1} width={innerWidth} backgroundColor={theme.surface3} onMouseDown={event => { event.stopPropagation(); onEdit() }}>
      <input id="git-sidebar-filter-input" width={innerWidth} value={filter} placeholder="/ Filter" backgroundColor={theme.surface3} focusedBackgroundColor={theme.surface3} textColor={theme.text} focusedTextColor={theme.text} placeholderColor={theme.dim} focused={visible && filtering} onInput={onFilter} />
    </box>
    <box height={1} flexShrink={0} />
    <scrollbox id="git-navigation-scroll" ref={scrollRef} flexGrow={1} minHeight={0} width={width - 1} scrollY scrollX={false}>
      {rows.slice(2).map((item, index) => row(item, index + 2))}
      {rows.length === 2 && filter ? <text fg={theme.dim}> No matches</text> : null}
    </scrollbox>
    <box position="absolute" top={0} right={0} width={1} height={height}><GitDivider id="git-sidebar-divider" vertical width={1} height={height} size={width} theme={theme} onResize={onResize} /></box>
  </box>
}

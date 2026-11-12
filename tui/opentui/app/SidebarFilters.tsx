/** @jsxImportSource @opentui/react */
import { mixHexColor } from './transcriptStyle'
import { sidebarQuietColor } from './SidebarChrome'
import React from 'react'
import type { TuiThemePalette } from '../../theme'
import type { ContextMenuItem } from '../ContextMenu'
import { SEARCH_MAX_CHARS } from './timing'

export type { SidebarActivity } from '../../../lib/sessionSidebarModel'
import { SIDEBAR_ACTIVITY_OPTIONS, type SidebarActivity } from '../../../lib/sessionSidebarModel'
export type SidebarFilterMenu = { x: number; y: number; title: string; items: ContextMenuItem[] }
// The web rail's names for the same two scopes.
const SCOPES = [['repo', 'This project'], ['all', 'All projects']] as const
const ACTIVITIES = SIDEBAR_ACTIVITY_OPTIONS

/** One filter surface across views; the shell owns its dropdowns and keyboard routing. */
export function SidebarFilters({ idPrefix, theme, query, searchFocused, onSearchFocus, onQuery, onSubmit, scope, activity, onScope, onActivity, onOpenMenu, tags = [], tag = null, onTag, includeWorktrees, onIncludeWorktrees, note, onClearNote }: {
  idPrefix: string; theme: TuiThemePalette; query: string; searchFocused: boolean
  onSearchFocus: () => void; onQuery: (query: string) => void; onSubmit: () => void
  scope: 'repo' | 'all'; activity: SidebarActivity
  onScope: (scope: 'repo' | 'all') => void; onActivity: (activity: SidebarActivity) => void
  onOpenMenu: (menu: SidebarFilterMenu) => void
  /** The most used tags (the web rail's chips), and the one filtering the list. */
  tags?: ReadonlyArray<readonly [string, number]>
  tag?: string | null
  onTag?: (tag: string | null) => void
  /** Project scope takes in the project's other worktrees (the web's "worktrees" box). */
  includeWorktrees?: boolean
  onIncludeWorktrees?: (value: boolean) => void
  /** What is narrowing the list ("1 settled hidden · Running"); a click clears the tag and activity filters. */
  note?: string
  onClearNote?: () => void
}) {
  const activityLabel = ACTIVITIES.find(([value]) => value === (activity ?? 'all'))![1]
  // A chip at its default is quiet; one that narrows the list is filled and cyan, so the narrowing is visible.
  const quiet = sidebarQuietColor(theme)
  const chip = (label: string, narrowing: boolean) => <text fg={narrowing ? theme.cyan : quiet} bg={narrowing ? theme.surface3 : undefined}
    wrapMode="none" selectable={false}>{narrowing ? ` ${label} ▾ ` : `${label} ▾`}</text>
  // Space, not a dot: the carets already mark each chip as a control.
  const separator = <text wrapMode="none" selectable={false}>{'  '}</text>
  return <box flexShrink={0} flexDirection="column">
    {/* A glyph so the row reads as an input; the key that jumps to it is in the placeholder, beside the words it
        refers to, rather than adrift at the far edge. */}
    <box height={1} paddingX={1} flexShrink={0} flexDirection="row" onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onSearchFocus() } }}>
      <text fg={searchFocused ? theme.cyan : quiet} wrapMode="none" selectable={false}>{'⌕ '}</text>
      <box flexGrow={1} height={1}>
        <input id={`${idPrefix}-input:search`} placeholder="Search sessions  /" maxLength={SEARCH_MAX_CHARS} value={query} focused={searchFocused} onInput={onQuery} onSubmit={onSubmit} />
      </box>
    </box>
    <box flexShrink={0} flexDirection="row" flexWrap="wrap" paddingX={1}>
      <box id={`${idPrefix}-scope`} height={1} flexShrink={0} onMouseDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        onOpenMenu({ x: event.x, y: event.y, title: 'Repository scope', items: [
          ...SCOPES.map(([value, label]) => ({
            id: `${idPrefix}-scope:${value}`, label: `${scope === value ? '✓ ' : '  '}${label}`, run: () => onScope(value),
          })),
          ...(onIncludeWorktrees ? [{
            id: `${idPrefix}-scope:worktrees`, label: `${includeWorktrees ? '☑' : '☐'} Include worktrees`, run: () => onIncludeWorktrees(!includeWorktrees),
          }] : []),
        ] })
      }}>{chip(scope === 'repo' ? 'This project' : 'All projects', scope !== 'repo')}</box>
      {separator}
      <box id={`${idPrefix}-activity`} height={1} flexShrink={0} onMouseDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        onOpenMenu({ x: event.x, y: event.y, title: 'Session activity', items: ACTIVITIES.map(([value, label]) => ({
          id: `${idPrefix}-activity:${value}`, label: `${(activity ?? 'all') === value ? '✓ ' : '  '}${label}`, run: () => onActivity(value === 'all' ? null : value),
        })) })
      }}>{chip(activity ? activityLabel : 'All', Boolean(activity))}</box>
      {onTag ? separator : null}
      {onTag ? <box id={`${idPrefix}-tag`} height={1} flexShrink={0} onMouseDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        onOpenMenu({ x: event.x, y: event.y, title: 'Tag', items: [
          { id: `${idPrefix}-tag:any`, label: `${tag ? '  ' : '✓ '}Any tag`, run: () => onTag(null) },
          ...tags.map(([value, count]) => ({ id: `${idPrefix}-tag:${value}`, label: `${tag === value ? '✓ ' : '  '}#${value}  ${count}`, run: () => onTag(value) })),
          // Nothing tagged yet: say where tags come from rather than offering an empty list.
          ...(tags.length === 0 ? [{ id: `${idPrefix}-tag:none`, label: '  No tags yet: right-click a session → Add tags', run: () => {} }] : []),
        ] })
      }}>{chip(tag ? `#${tag}` : 'Tag', Boolean(tag))}</box> : null}
      {/* Right-aligned at the end of the chips row when it fits (a line of its own when it does not), so it reads as
          a status rather than a fourth control. A bare count is dimmer still; a note that can be cleared (×) is not. */}
      {note ? <box id={`${idPrefix}-filter-note`} height={1} flexGrow={1} flexShrink={0} marginLeft={2} flexDirection="row" justifyContent="flex-end"
        onMouseDown={event => { if (event.button === 0 && onClearNote) { event.stopPropagation(); onClearNote() } }}>
        <text fg={note.includes('×') ? quiet : mixHexColor(quiet, theme.surface, 0.7) ?? quiet} wrapMode="none" selectable={false}>{note}</text>
      </box> : null}
    </box>
    {/* One rule between the controls (how the list is filtered) and the list itself. */}
    <box id={`${idPrefix}-filters-rule`} height={1} flexShrink={0} marginX={1} overflow="hidden">
      <text fg={mixHexColor(quiet, theme.surface, 0.55) ?? theme.border} wrapMode="none" selectable={false}>{'─'.repeat(200)}</text>
    </box>
  </box>
}

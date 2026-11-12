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
export function SidebarFilters({ idPrefix, theme, query, searchFocused, onSearchFocus, onQuery, onSubmit, scope, activity, onScope, onActivity, onOpenMenu, tags = [], tag = null, onTag, includeWorktrees, onIncludeWorktrees }: {
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
}) {
  const activityLabel = ACTIVITIES.find(([value]) => value === (activity ?? 'all'))![1]
  // A chip at its default is quiet; one that narrows the list is filled and cyan, so the narrowing is visible.
  const chip = (label: string, narrowing: boolean) => <SidebarChip theme={theme} label={label} narrowing={narrowing} />
  // Space, not a dot: the carets already mark each chip as a control.
  const separator = <text wrapMode="none" selectable={false}>{'  '}</text>
  return <box flexShrink={0} flexDirection="column">
    <SidebarSearchRow idPrefix={idPrefix} theme={theme} placeholder="Search sessions  /" query={query} focused={searchFocused}
      onFocus={onSearchFocus} onQuery={onQuery} onSubmit={onSubmit} />
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
    </box>
    <SidebarFiltersRule idPrefix={idPrefix} theme={theme} />
  </box>
}

/** A glyph so the row reads as an input; the key that jumps to it is in the placeholder, beside the words it refers
 *  to, rather than adrift at the far edge. Shared by both rail tabs. */
export function SidebarSearchRow({ idPrefix, theme, placeholder, query, focused, onFocus, onQuery, onSubmit }: {
  idPrefix: string; theme: TuiThemePalette; placeholder: string; query: string; focused: boolean
  onFocus: () => void; onQuery: (query: string) => void; onSubmit: () => void
}) {
  return <box height={1} paddingX={1} flexShrink={0} flexDirection="row" onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onFocus() } }}>
    <text fg={focused ? theme.cyan : sidebarQuietColor(theme)} wrapMode="none" selectable={false}>{'⌕ '}</text>
    <box flexGrow={1} height={1}>
      <input id={`${idPrefix}-input:search`} placeholder={placeholder} maxLength={SEARCH_MAX_CHARS} value={query} focused={focused} onInput={onQuery} onSubmit={onSubmit} />
    </box>
  </box>
}

/** One rule between the controls (how the list is filtered) and the list itself. */
export function SidebarFiltersRule({ idPrefix, theme }: { idPrefix: string; theme: TuiThemePalette }) {
  return <box id={`${idPrefix}-filters-rule`} height={1} flexShrink={0} marginX={1} overflow="hidden">
    <text fg={mixHexColor(sidebarQuietColor(theme), theme.surface, 0.55) ?? theme.border} wrapMode="none" selectable={false}>{'─'.repeat(200)}</text>
  </box>
}

/** A dropdown chip: quiet at its default, filled and cyan once it narrows the list. */
export function SidebarChip({ theme, label, narrowing }: { theme: TuiThemePalette; label: string; narrowing: boolean }) {
  return <text fg={narrowing ? theme.cyan : sidebarQuietColor(theme)} bg={narrowing ? theme.surface3 : undefined}
    wrapMode="none" selectable={false}>{narrowing ? ` ${label} ▾ ` : `${label} ▾`}</text>
}

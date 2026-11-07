/** @jsxImportSource @opentui/react */
import React from 'react'
import type { TuiThemePalette } from '../../theme'
import type { ContextMenuItem } from '../ContextMenu'
import { SEARCH_MAX_CHARS } from './timing'

export type SidebarActivity = 'running' | 'attention' | 'pinned' | 'settled' | null
export type SidebarFilterMenu = { x: number; y: number; title: string; items: ContextMenuItem[] }
const SCOPES = [['repo', 'This repo'], ['all', 'All repos']] as const
const ACTIVITIES = [['all', 'All sessions'], ['running', 'Running'], ['attention', 'Needs input'], ['pinned', 'Pinned'], ['settled', 'Settled']] as const

/** One filter surface across views; the shell owns its dropdowns and keyboard routing. */
export function SidebarFilters({ idPrefix, theme, query, searchFocused, onSearchFocus, onQuery, onSubmit, scope, activity, onScope, onActivity, onOpenMenu }: {
  idPrefix: string; theme: TuiThemePalette; query: string; searchFocused: boolean
  onSearchFocus: () => void; onQuery: (query: string) => void; onSubmit: () => void
  scope: 'repo' | 'all'; activity: SidebarActivity
  onScope: (scope: 'repo' | 'all') => void; onActivity: (activity: SidebarActivity) => void
  onOpenMenu: (menu: SidebarFilterMenu) => void
}) {
  const activityLabel = ACTIVITIES.find(([value]) => value === (activity ?? 'all'))![1]
  return <box flexShrink={0} flexDirection="column">
    <box height={1} paddingX={1} flexShrink={0} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onSearchFocus() } }}>
      <input id={`${idPrefix}-input:search`} placeholder="Search sessions…" maxLength={SEARCH_MAX_CHARS} value={query} focused={searchFocused} onInput={onQuery} onSubmit={onSubmit} />
    </box>
    <box flexShrink={0} flexDirection="row" flexWrap="wrap" paddingX={1}>
      <box id={`${idPrefix}-scope`} height={1} flexShrink={0} onMouseDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        onOpenMenu({ x: event.x, y: event.y, title: 'Repository scope', items: SCOPES.map(([value, label]) => ({
          id: `${idPrefix}-scope:${value}`, label: `${scope === value ? '✓ ' : '  '}${label}`, run: () => onScope(value),
        })) })
      }}><text fg={theme.text} bg={theme.surface3} wrapMode="none" selectable={false}>{` ${scope === 'repo' ? 'This repo' : 'All repos'} ▾ `}</text></box>
      <box id={`${idPrefix}-activity`} height={1} flexShrink={0} onMouseDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        onOpenMenu({ x: event.x, y: event.y, title: 'Session activity', items: ACTIVITIES.map(([value, label]) => ({
          id: `${idPrefix}-activity:${value}`, label: `${(activity ?? 'all') === value ? '✓ ' : '  '}${label}`, run: () => onActivity(value === 'all' ? null : value),
        })) })
      }}><text fg={theme.text} bg={theme.surface3} wrapMode="none" selectable={false}>{` ${activityLabel} ▾ `}</text></box>
    </box>
  </box>
}

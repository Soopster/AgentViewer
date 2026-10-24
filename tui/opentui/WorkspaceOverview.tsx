/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { TuiThemePalette } from '../theme'
import type { SpacesController } from './spacesStore'
import { overviewRows, workspaceOverview, subscribeWorkspaceOverview, type OverviewNode } from './workspaceOverviewData'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { fitText } from './textLayout'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export function WorkspaceOverview({ controller, theme, width, height, onClose, onPick, onMove, recent, onKeyHandlerReady }: {
  recent?: Array<{ workspaceId: string; target: string }>; controller: SpacesController; theme: TuiThemePalette; width: number; height: number
  onMove?: (node: OverviewNode) => void; onClose: () => void; onPick: (node: OverviewNode) => void; onKeyHandlerReady: (handler: (key: Key) => boolean) => void
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const attention = useSyncExternalStore(controller.subscribeAttention, controller.getAttentionVersion, controller.getAttentionVersion)
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeWorkspaceOverview(controller, () => setRevision(value => value + 1)), [controller, state])
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const nodes = useMemo(() => workspaceOverview(controller), [controller, state, revision, attention])
  const rows = useMemo(() => {
    if (!recent) return overviewRows(nodes, collapsed, query)
    const all = overviewRows(nodes, new Set(), '')
    const visits = recent.flatMap(visit => {
      const node = all.find(row => row.workspaceId === visit.workspaceId && row.target === visit.target)
      const workspace = all.find(row => row.id === `workspace:${visit.workspaceId}`)
      return node ? [{ ...node, title: `${workspace?.title ?? ''} / ${node.title}`, depth: 0, children: [], parent: undefined }] : []
    })
    const terms = query.toLowerCase().trim().split(/\s+/)
    return visits.filter(row => terms.every(term => `${row.title} ${row.detail}`.toLowerCase().includes(term)))
  }, [nodes, collapsed, query, recent])
  const index = Math.min(cursor, Math.max(0, rows.length - 1))
  const live = useRef({ rows, index })
  useLayoutEffect(() => { live.current = { rows, index } }, [rows, index])
  const popWidth = Math.max(16, Math.min(width - 2, 110))
  const popHeight = Math.max(6, Math.min(height - 2, 30))
  const capacity = Math.max(1, popHeight - 5)
  const start = Math.max(0, index - capacity + 1)
  const toggle = (id: string, close: boolean) => setCollapsed(previous => { const next = new Set(previous); if (close) next.add(id); else next.delete(id); return next })
  const handleKey = useCallback((key: Key) => {
    const { rows, index } = live.current
    const row = rows[index]
    if (key.ctrl && key.name === 'w' && row?.target) { onMove?.(row); return true }
    if (key.name === 'escape') { onClose(); return true }
    if (key.name === 'up' || key.name === 'down' || key.name === 'tab') {
      setCursor(Math.max(0, Math.min(rows.length - 1, index + (key.name === 'up' || key.shift ? -1 : 1)))); return true
    }
    if (key.name === 'right') {
      if (row?.children.length) { if (!query && collapsed.has(row.id)) toggle(row.id, false); else if (rows[index + 1]?.parent === row.id) setCursor(index + 1) }
      return true
    }
    if (key.name === 'left') {
      if (!query && row?.children.length && !collapsed.has(row.id)) toggle(row.id, true)
      else if (row?.parent) setCursor(Math.max(0, rows.findIndex(node => node.id === row.parent)))
      return true
    }
    if (key.name === 'return') {
      // Search opens the first matching window rather than its containing space.
      const target = query ? rows.slice(index).find(node => node.target && node.matched) ?? rows.slice(index).find(node => node.workspaceId && node.matched) ?? row : row
      if (target) onPick(target)
      return true
    }
    return false
  }, [collapsed, onClose, onPick, onMove, query])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  return <box id="window-switcher" position="absolute" left={Math.max(0, Math.floor((width - popWidth) / 2))} top={Math.max(0, Math.floor((height - popHeight) / 2))}
    width={popWidth} height={popHeight} border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} paddingX={1} flexDirection="column">
    <text fg={theme.cyan} wrapMode="none">{recent ? 'Recent windows' : 'Workspace overview'}</text>
    <input id="window-switcher:query" focused value={query} placeholder="Search workspaces, windows, tabs, providers, or projects…" onInput={(value: string) => { setQuery(value); setCursor(0) }} />
    <box flexGrow={1} overflow="hidden" flexDirection="column" onMouseScroll={event => { event.stopPropagation(); setCursor(Math.max(0, Math.min(rows.length - 1, index + (event.scroll?.direction === 'up' ? -1 : 1)))) }}>
      {rows.length === 0 ? <text fg={theme.dim}>No matching windows</text> : rows.slice(start, start + capacity).map((row, offset) => <box key={row.id} id={`overview-node:${row.id}`} height={1} flexShrink={0} flexDirection="row" backgroundColor={index === start + offset ? theme.surface3 : undefined}
        onMouseDown={event => { if (event.button === 2 && row.target) { event.stopPropagation(); onMove?.(row); return } if (event.button !== 0) return; event.stopPropagation(); if (row.children.length && event.x < Math.floor((width - popWidth) / 2) + 5 + row.depth * 2) toggle(row.id, !collapsed.has(row.id)); else onPick(row) }}>
        <text fg={index === start + offset ? theme.cyan : theme.text} wrapMode="none" selectable={false}>{fitText(`${'  '.repeat(row.depth)}${row.children.length ? (!query && collapsed.has(row.id) ? '▸' : '▾') : '·'} ${row.title} · ${row.detail}`, popWidth - 4)}</text>
      </box>)}
    </box>
    <text fg={theme.dim} wrapMode="none">{fitText('↑↓ select · ←→ fold · Enter open · Ctrl+W move · Esc close', popWidth - 4)}</text>
  </box>
}

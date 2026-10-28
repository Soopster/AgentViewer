/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { TuiThemePalette } from '../theme'
import type { SpacesController } from './spacesStore'
import { overviewRows, workspaceOverview, subscribeWorkspaceOverview, type OverviewNode } from './workspaceOverviewData'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { fitText } from './textLayout'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export function WorkspaceOverview({ controller, theme, width, height, onClose, onPick, onMove, onShelf, onShelfMany, onRestoreMany, onBatchAction, recent, onKeyHandlerReady }: {
  recent?: Array<{ workspaceId: string; target: string }>; controller: SpacesController; theme: TuiThemePalette; width: number; height: number
  onMove?: (node: OverviewNode) => void; onShelf?: (node: OverviewNode) => void; onShelfMany?: (nodes: OverviewNode[]) => void
  onRestoreMany?: (nodes: OverviewNode[]) => void
  onBatchAction?: (action: 'tab' | 'float' | 'close' | 'move', nodes: OverviewNode[], destinationWorkspaceId?: string) => void
  onClose: () => void; onPick: (node: OverviewNode) => void; onKeyHandlerReady: (handler: (key: Key) => boolean) => void
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const attention = useSyncExternalStore(controller.subscribeAttention, controller.getAttentionVersion, controller.getAttentionVersion)
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeWorkspaceOverview(controller, () => setRevision(value => value + 1)), [controller, state])
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set())
  const [menuStep, setMenuStep] = useState<'closed' | 'actions' | 'destination' | 'review'>('closed')
  const [actionCursor, setActionCursor] = useState(0)
  const [chosenAction, setChosenAction] = useState<'tab' | 'float' | 'close' | 'move'>('tab')
  const [destinationCursor, setDestinationCursor] = useState(0)
  const [destinationWorkspaceId, setDestinationWorkspaceId] = useState<string | undefined>()
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
  const allTargets = useMemo(() => {
    const found = new Map<string, OverviewNode>()
    const visit = (items: OverviewNode[]) => items.forEach(item => { if (item.target && !item.shelved) found.set(item.target, item); visit(item.children) })
    visit(nodes)
    return found
  }, [nodes])
  const selectedNodes = [...selectedTargets].map(key => allTargets.get(key)).filter((node): node is OverviewNode => Boolean(node))
  const sameWorkspace = selectedNodes.length > 0 && selectedNodes.every(node => node.workspaceId === selectedNodes[0]?.workspaceId)
  const actions = ['tab', 'float', 'close', 'move'] as const
  const workspaces = nodes.flatMap(space => space.children)
  const destinations = workspaces.filter(workspace => workspace.id !== `workspace:${selectedNodes[0]?.workspaceId}`)
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
    const sequence = (key.sequence || key.name).toLowerCase()
    if (menuStep === 'closed' && key.ctrl && (key.name.toLowerCase() === 'w' || sequence === 'w') && row?.target) { onMove?.(row); return true }
    if (menuStep === 'closed' && searchFocused) {
      if (key.name === 'escape') { setSearchFocused(false); return true }
      if (key.name === 'return') {
        const target = query ? rows.slice(index).find(node => node.target && node.matched) ?? rows.slice(index).find(node => node.workspaceId && node.matched) ?? row : row
        if (target) onPick(target)
        return true
      }
      if (key.name === 'tab') { setSearchFocused(false); return true }
      if (key.name === 'up' || key.name === 'down') {
        setCursor(Math.max(0, Math.min(rows.length - 1, index + (key.name === 'up' ? -1 : 1))))
        return true
      }
      if (key.name === 'backspace' || key.name === 'delete') { setQuery(value => value.slice(0, -1)); setCursor(0); return true }
      if (!key.ctrl && key.sequence.length === 1 && key.sequence >= ' ') { setQuery(value => value + key.sequence); setCursor(0); return true }
      return true
    }
    if (menuStep !== 'closed') {
      if (key.name === 'escape') {
        setMenuStep(menuStep === 'actions' ? 'closed' : menuStep === 'destination' ? 'actions' : chosenAction === 'move' ? 'destination' : 'actions')
        return true
      }
      if (menuStep === 'actions') {
        if (key.name === 'up' || key.name === 'down' || key.name === 'tab') { setActionCursor(value => (value + (key.name === 'up' ? actions.length - 1 : 1)) % actions.length); return true }
        if (key.name === 'return') { const action = actions[actionCursor]!; setChosenAction(action); setMenuStep(action === 'move' ? 'destination' : 'review'); return true }
      } else if (menuStep === 'destination') {
        if (key.name === 'up' || key.name === 'down' || key.name === 'tab') { setDestinationCursor(value => Math.max(0, Math.min(destinations.length - 1, value + (key.name === 'up' ? -1 : 1)))); return true }
        if (key.name === 'return' && destinations[destinationCursor]) { setDestinationWorkspaceId(destinations[destinationCursor]!.workspaceId); setMenuStep('review'); return true }
      } else if (key.name === 'return') {
        if (sameWorkspace) onBatchAction?.(chosenAction, chosenAction === 'float' ? selectedNodes.slice(0, 1) : selectedNodes, destinationWorkspaceId)
        setMenuStep('closed'); onClose(); return true
      }
      return true
    }
    if (key.name === 'escape') { onClose(); return true }
    if (key.sequence === '/') { setSearchFocused(true); return true }
    if ((key.name === 'space' || key.sequence === ' ') && row?.target && !row.shelved) {
      setSelectedTargets(previous => { const next = new Set(previous); if (next.has(row.target!)) next.delete(row.target!); else next.add(row.target!); return next })
      return true
    }
    if (sequence === 'u') {
      if (row?.target && row.shelved) onPick(row)
      else if (row) {
        const shelved: OverviewNode[] = []
        const visit = (node: OverviewNode) => { if (node.shelved && node.target) shelved.push(node); node.children.forEach(visit) }
        visit(row)
        if (shelved.length) onRestoreMany?.(shelved)
      }
      return true
    }
    if (sequence === 's') {
      if (selectedTargets.size) onShelfMany?.(selectedNodes)
      else if (row?.target && !row.shelved) onShelf?.(row)
      else {
        const scope = row?.workspaceId ? row : row?.children.find(child => child.workspaceId) ?? row
        const targets: OverviewNode[] = []
        const visit = (node: OverviewNode) => { if (node.target && !node.shelved) targets.push(node); node.children.forEach(visit) }
        if (scope) visit(scope)
        if (targets.length) onShelfMany?.(targets)
      }
      return true
    }
    if (sequence === 'a' || sequence === 'm') {
      const targets = selectedTargets.size ? [...selectedTargets] : row?.target && !row.shelved ? [row.target] : (() => {
        const found: string[] = []
        const visit = (node: OverviewNode) => { if (node.target && !node.shelved && (!row?.workspaceId || node.workspaceId === row.workspaceId)) found.push(node.target); node.children.forEach(visit) }
        if (row) visit(row)
        return found
      })()
      if (targets.length) {
        setSelectedTargets(new Set(targets))
        setMenuStep('actions'); setActionCursor(0); return true
      }
    }
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
  }, [collapsed, onClose, onPick, onMove, onShelf, onShelfMany, onRestoreMany, query, searchFocused, menuStep, chosenAction, actionCursor, actions, destinations, destinationCursor, selectedTargets, selectedNodes, sameWorkspace, destinationWorkspaceId, onBatchAction])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  return <box id="window-switcher" position="absolute" left={Math.max(0, Math.floor((width - popWidth) / 2))} top={Math.max(0, Math.floor((height - popHeight) / 2))}
    width={popWidth} height={popHeight} border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} paddingX={1} flexDirection="column">
    <text fg={theme.cyan} wrapMode="none">{menuStep === 'closed' ? (recent ? 'Recent windows' : 'Workspace overview') : 'Window actions · preview'}</text>
    <text id="window-switcher:query" fg={searchFocused ? theme.cyan : theme.dim} wrapMode="none">{fitText(searchFocused ? `Search: ${query}▏` : query ? `Search: ${query} · press / to edit` : 'Press / to search workspaces, windows, tabs, providers, or projects', popWidth - 4)}</text>
    {menuStep === 'closed' ? <box flexGrow={1} overflow="hidden" flexDirection="column" onMouseScroll={event => { event.stopPropagation(); setCursor(Math.max(0, Math.min(rows.length - 1, index + (event.scroll?.direction === 'up' ? -1 : 1)))) }}>
      {rows.length === 0 ? <text fg={theme.dim}>No matching windows</text> : rows.slice(start, start + capacity).map((row, offset) => <box key={row.id} id={`overview-node:${row.id}`} height={1} flexShrink={0} flexDirection="row" backgroundColor={index === start + offset ? theme.surface3 : undefined}
        onMouseDown={event => { if (event.button === 2 && row.target) { event.stopPropagation(); if (row.shelved) onPick(row); else onMove?.(row); return } if (event.button !== 0) return; event.stopPropagation(); if (row.children.length && event.x < Math.floor((width - popWidth) / 2) + 5 + row.depth * 2) toggle(row.id, !collapsed.has(row.id)); else onPick(row) }}>
        <text fg={selectedTargets.has(row.target ?? '') ? theme.amber : index === start + offset ? theme.cyan : theme.text} wrapMode="none" selectable={false}>{fitText(`${selectedTargets.has(row.target ?? '') ? '[x]' : '   '}${'  '.repeat(row.depth)}${row.children.length ? (!query && collapsed.has(row.id) ? '▸' : '▾') : '·'} ${row.title} · ${row.detail}`, popWidth - 4)}</text>
      </box>)}
    </box> : <box flexGrow={1} flexDirection="column" paddingY={1}>
      {menuStep === 'actions' ? actions.map((action, i) => <text key={action} fg={i === actionCursor ? theme.cyan : theme.text}>{`${i === actionCursor ? '›' : ' '} ${action}`}</text>) : null}
      {menuStep === 'destination' ? destinations.map((workspace, i) => <text key={workspace.id} fg={i === destinationCursor ? theme.cyan : theme.text}>{`${i === destinationCursor ? '›' : ' '} ${workspace.title}`}</text>) : null}
      {menuStep === 'review' ? <>
        <text fg={theme.text} wrapMode="word">{`Preview: ${chosenAction === 'float' ? `float 1 of ${selectedNodes.length} selected windows` : `${selectedNodes.length} windows · ${chosenAction}`}${chosenAction === 'move' ? ` to ${destinations.find(item => item.workspaceId === destinationWorkspaceId)?.title ?? 'workspace'}` : ''}`}</text>
        {(chosenAction === 'float' ? selectedNodes.slice(0, 1) : selectedNodes).slice(0, Math.max(1, capacity - 5)).map(node => <text key={node.target} fg={theme.dim} wrapMode="none">{`  · ${node.title}`}</text>)}
        {chosenAction === 'float' && selectedNodes.length > 1 ? <text fg={theme.dim}>Other selected windows stay in place.</text> : null}
        {!sameWorkspace ? <text fg={theme.red}>Select windows from one workspace to continue.</text> : <text fg={theme.amber}>Enter apply · Esc back</text>}
      </> : null}
    </box>}
    <text fg={theme.dim} wrapMode="none">{fitText(menuStep === 'closed' ? '↑↓ select · Space mark · A actions · S shelf · U restore · / search · Enter open · Ctrl+W move · Esc close' : '↑↓ choose · Enter preview/apply · Esc back', popWidth - 4)}</text>
  </box>
}

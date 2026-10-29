/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { TuiThemePalette } from '../theme'
import type { SpacesController, Workspace } from './spacesStore'
import { closeWorkspaceResources, subscribeWorkspaceResources, workspaceResources, workspaceResourceVersion } from './workspaceResources'
import { useWorkspaceContext } from './workspaceContext'
import { MODAL_CONTENT_Z_INDEX, NAVIGATION_Z_INDEX } from './layers'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
const fit = (text: string, width: number) => text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text
export function workspaceBadge(controller: SpacesController, workspace: Workspace): string {
  const values = controller.runtime(workspace).snapshot()
  const attention = values.windowAttention instanceof Map ? [...values.windowAttention.values()] : []
  if (attention.some(mark => mark?.error) || workspaceResources([workspace.id]).some(resource => resource.error)) return '!'
  if (controller.getAttention(workspace.id)) return controller.getAttention(workspace.id)
  if (attention.some(mark => mark?.unread)) return '●'
  return ''
}
export function SpacesRail({ theme, width, onManage, under = false }: { theme: TuiThemePalette; width: number; onManage: (id?: string, close?: boolean) => void; under?: boolean }) {
  const context = useWorkspaceContext()!
  useSyncExternalStore(context.controller.subscribeAttention, context.controller.getAttentionVersion, context.controller.getAttentionVersion)
  const state = useSyncExternalStore(context.controller.subscribe, context.controller.getSnapshot, context.controller.getSnapshot)
  useSyncExternalStore(subscribeWorkspaceResources, workspaceResourceVersion, workspaceResourceVersion)
  const spaceCount = Math.min(4, state.spaces.length)
  return <box id="spaces-rail" zIndex={under ? 0 : NAVIGATION_Z_INDEX} height={spaceCount + 2} flexShrink={0} flexDirection="column" border={['bottom']} borderColor={theme.border}>
    <box height={1} flexDirection="row" onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onManage() } }}><text fg={theme.dim}>spaces</text><box flexGrow={1} /><text fg={theme.cyan}>+ · menu</text></box>
    {state.spaces.slice(Math.max(0, state.spaces.findIndex(space => space.id === state.activeSpaceId) - 3), Math.max(4, state.spaces.findIndex(space => space.id === state.activeSpaceId) + 1)).map(space => <box key={space.id} id={`space:${space.id}`} height={1} backgroundColor={space.id === state.activeSpaceId ? theme.surface3 : theme.surface}
      onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); context.controller.activate(space.id) } else if (event.button === 2) { event.stopPropagation(); onManage(space.id) } }}>
      <text fg={space.id === state.activeSpaceId ? theme.cyan : theme.text} wrapMode="none">{fit(`${space.workspaces.map(workspace => workspaceBadge(context.controller, workspace)).find(Boolean) || (space.id === state.activeSpaceId ? '▸' : ' ')} ${space.name} · ${path.basename(space.cwd)}`, width - 2)}</text>
    </box>)}
  </box>
}
// `under` drops the bar beneath the layer while a full-screen popover covers the
// screen: above it, the bar painted over the popover's own top border.
export function WorkspaceTabs({ theme, width, onManage, under = false }: { theme: TuiThemePalette; width: number; onManage: (id?: string, close?: boolean) => void; under?: boolean }) {
  const context = useWorkspaceContext()!
  useSyncExternalStore(context.controller.subscribeAttention, context.controller.getAttentionVersion, context.controller.getAttentionVersion)
  const state = useSyncExternalStore(context.controller.subscribe, context.controller.getSnapshot, context.controller.getSnapshot)
  useSyncExternalStore(subscribeWorkspaceResources, workspaceResourceVersion, workspaceResourceVersion)
  const space = state.spaces.find(space => space.id === state.activeSpaceId)!
  // Keep tabs at 12 columns, keeping the active workspace visible on narrow
  // terminals and reserving room for overflow and management controls.
  const active = Math.max(0, space.workspaces.findIndex(workspace => workspace.id === space.activeWorkspaceId))
  const storageWarning = context.controller.persistenceError || context.controller.recoveryWarning
  const budget = Math.max(6, width - 13 - (storageWarning ? 16 : 0))
  const tabs = space.workspaces.map(workspace => {
    const badge = workspaceBadge(context.controller, workspace)
    const label = `${badge ? `${badge} ` : ''}${workspace.name}`
    return { workspace, label, width: 12 }
  })
  let start = active
  let end = active + 1
  let used = tabs[active].width + 1
  while (start > 0 && used + tabs[start - 1].width + 1 <= budget) used += tabs[--start].width + 1
  while (end < tabs.length && used + tabs[end].width + 1 <= budget) used += tabs[end++].width + 1
  return <box id="workspace-tabs" zIndex={under ? 0 : NAVIGATION_Z_INDEX} height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface}>
    {start > 0 ? <text fg={theme.dim} onMouseDown={() => onManage()}>‹ </text> : null}
    {tabs.slice(start, end).map(({ workspace, label, width: tabWidth }) => {
      const selected = workspace.id === space.activeWorkspaceId
      const title = fit(label, tabWidth - 6)
      return <box key={workspace.id} id={`workspace-tab:${workspace.id}`} width={tabWidth} height={1} marginRight={1} flexShrink={0} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface} onMouseDown={event => {
        event.stopPropagation(); if (event.button === 0) context.controller.activate(space.id, workspace.id); else if (event.button === 2) onManage(workspace.id)
      }}>
        <text fg={selected ? theme.cyan : theme.border}>[</text>
        {/* Center across the whole interior; the close control takes no layout space. */}
        <text width={tabWidth - 2} textAlign="center" fg={selected ? theme.cyan : theme.muted} wrapMode="none">{selected ? <b>{title}</b> : title}</text>
        <text fg={selected ? theme.cyan : theme.border}>]</text>
        <box id={`workspace-close:${workspace.id}`} position="absolute" right={1} top={0} width={2} height={1} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onManage(workspace.id, true) } }}><text fg={theme.dim}> ×</text></box>
      </box>
    })}
    {end < tabs.length ? <text fg={theme.dim} onMouseDown={() => onManage()}>› </text> : null}
    <box id="workspace-add" width={3} height={1} flexShrink={0} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); context.controller.addWorkspace(space.id) } }}><text fg={theme.cyan}> + </text></box>
    {storageWarning ? <text fg={theme.red} onMouseDown={() => onManage()}> ! restore/save </text> : null}
    <box id="workspace-menu" width={6} height={1} flexShrink={0} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onManage() } }}><text fg={theme.muted}>menu</text></box>
  </box>
}
export function WorkspaceLauncher({ theme, cwd, onOpenSession, onNewAgent, onTerminal, onLayout }: { theme: TuiThemePalette; cwd: string; onOpenSession: () => void; onNewAgent: () => void; onTerminal: () => void; onLayout: () => void }) {
  return <box id="workspace-launcher" flexGrow={1} flexDirection="column" padding={2}>
    <text fg={theme.cyan}>New workspace</text><text fg={theme.dim} wrapMode="word">{cwd}</text><box height={1}/>
    {([['open-session', '[1] Open session', onOpenSession], ['start-agent', '[2] Start agent', onNewAgent], ['open-terminal', '[3] Open terminal', onTerminal], ['apply-layout', '[4] Apply saved layout', onLayout]] as const).map(([id, label, action]) => <box id={`workspace-launcher:${id}`} key={id} height={2} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); action() } }}><text fg={theme.text}>{label}</text></box>)}
  </box>
}
export function SpacesManager({ controller, theme, width, height, initialId, closeId, onClose, onKeyHandlerReady }: { controller: SpacesController; theme: TuiThemePalette; width: number; height: number; initialId?: string; closeId?: string; onClose: () => void; onKeyHandlerReady: (handler: (key: Key) => boolean) => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const rows = useMemo(() => state.spaces.flatMap(space => [{ id: space.id, label: space.name, space, workspace: null as Workspace | null }, ...space.workspaces.map(workspace => ({ id: workspace.id, label: `  ${workspace.name}`, space, workspace }))]), [state])
  const [query, setQuery] = useState('')
  const [heldId, setHeldId] = useState<string | null>(initialId ?? controller.activeWorkspace()?.id ?? null)
  const [cursor, setCursor] = useState(() => Math.max(0, rows.findIndex(row => row.id === (initialId ?? controller.activeWorkspace()?.id))))
  const [edit, setEdit] = useState<{ kind: 'space' | 'rename'; id?: string; text: string } | null>(state.spaces.length ? null : { kind: 'space', text: controller.launchCwd })
  const [confirm, setConfirm] = useState<{ id: string; lines: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const filtered = rows.filter(row => `${row.label} ${row.space.cwd}`.toLowerCase().includes(query.toLowerCase()))
  const heldIndex = heldId ? filtered.findIndex(row => row.id === heldId) : -1
  const index = heldIndex >= 0 ? heldIndex : Math.min(cursor, Math.max(0, filtered.length - 1))
  const selected = filtered[index]
  const closeItem = (id: string) => {
    const workspaces = controller.workspacesFor(id)
    for (const workspace of workspaces) closeWorkspaceResources(workspace.id)
    controller.close(id); setConfirm(null)
    if (!controller.activeSpace()) setEdit({ kind: 'space', text: controller.launchCwd })
  }
  const requestClose = (id: string) => {
    const workspaces = controller.workspacesFor(id)
    for (const workspace of workspaces) controller.runtime(workspace).flushers.forEach(flush => flush())
    const lines = workspaceResources(workspaces.map(workspace => workspace.id)).filter(resource => resource.running).map(resource => `Stop terminal/process: ${resource.label}`)
    for (const workspace of workspaces) {
      const values = controller.runtime(workspace).snapshot()
      if (String(values.composerDraft ?? '').trim() || Object.keys(values).some(key => key.startsWith('draft:') && String(values[key] ?? '').trim()) || Object.keys(values).some(key => key.endsWith(':draft') && String(values[key] ?? '').trim())) lines.push(`Discard drafts: ${workspace.name}`)
      if (Array.isArray(values.queuedComposerSends) && values.queuedComposerSends.length) lines.push(`Discard queued prompts: ${workspace.name}`)
      if (Object.entries(values).some(([key, value]) => key.startsWith('editor:') && key.endsWith(':tabs') && Array.isArray(value) && value.some(tab => tab.content !== tab.savedContent))) lines.push(`Discard unsaved editor buffers: ${workspace.name}`)
    }
    if (lines.length) setConfirm({ id, lines }); else closeItem(id)
  }
  useEffect(() => { if (closeId) requestClose(closeId) }, [])
  const submit = () => {
    if (!edit) return
    try {
      if (edit.kind === 'rename' && edit.id) controller.rename(edit.id, edit.text)
      else {
        const cwd = path.resolve(controller.launchCwd, edit.text.trim().replace(/^~(?=\/|$)/, process.env.HOME ?? '~'))
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('Choose an existing project directory')
        controller.addSpace(cwd)
      }
      setEdit(null); setError(null); onClose()
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to update spaces') }
  }
  const handle = useCallback((key: Key): boolean => {
    if (edit) {
      if (key.name === 'escape') { if (state.spaces.length) setEdit(null); else onClose(); return true }
      if (key.name === 'return') { submit(); return true }
      return false
    }
    if (confirm) { if (key.name === 'y' || key.name === 'return') closeItem(confirm.id); else if (key.name === 'escape' || key.name === 'n') setConfirm(null); return true }
    if (key.name === 'escape') { onClose(); return true }
    if (key.name === 'down') { setHeldId(null); setCursor(Math.min(index + 1, filtered.length - 1)); return true }
    if (key.name === 'up') { setHeldId(null); setCursor(Math.max(0, index - 1)); return true }
    if (key.name === 'return' && selected) { controller.activate(selected.space.id, selected.workspace?.id); onClose(); return true }
    if (key.ctrl && key.name === 'n') { if (selected) controller.addWorkspace(selected.space.id); onClose(); return true }
    if (key.ctrl && key.name === 'a') { setEdit({ kind: 'space', text: controller.activeSpace()?.cwd ?? controller.launchCwd }); return true }
    if (key.ctrl && key.name === 'r' && selected) { setEdit({ kind: 'rename', id: selected.id, text: selected.workspace?.name ?? selected.space.name }); return true }
    if (key.ctrl && key.name === 'x' && selected) { requestClose(selected.id); return true }
    if (key.ctrl && (key.name === 'left' || key.name === 'right') && selected) { setHeldId(selected.id); controller.move(selected.id, key.name === 'left' ? -1 : 1); return true }
    return false
  }, [edit, confirm, selected, index, filtered.length, state, controller, onClose])
  useEffect(() => { onKeyHandlerReady(handle) }, [handle, onKeyHandlerReady])
  const popWidth = Math.max(24, Math.min(width - 2, 90)); const popHeight = Math.max(10, Math.min(height - 2, 28))
  const pageSize = Math.max(1, popHeight - 8); const start = Math.floor(index / pageSize) * pageSize
  return <box id="spaces-manager" position="absolute" left={Math.max(0, Math.floor((width - popWidth) / 2))} top={Math.max(0, Math.floor((height - popHeight) / 2))} width={popWidth} height={popHeight} border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} paddingX={1} flexDirection="column">
    <text fg={theme.cyan}>{confirm ? 'Close workspace / space' : edit ? edit.kind === 'space' ? 'New space · project directory' : 'Rename' : 'Spaces and workspaces'}</text>
    {edit ? <input id="spaces-manager:edit" focused value={edit.text} onInput={text => setEdit({ ...edit, text })} /> : confirm ? <scrollbox flexGrow={1} scrollY>{confirm.lines.map((line, index) => <text key={index} fg={theme.amber} wrapMode="word">{line}</text>)}<text fg={theme.dim}>Agent sessions will continue running.</text></scrollbox> : <>
      <input id="spaces-manager:search" focused value={query} onInput={text => { setQuery(text); setHeldId(null); setCursor(0) }} placeholder="Search spaces or workspaces…" />
      <box flexGrow={1} flexDirection="column">{filtered.slice(start, start + pageSize).map((row, offset) => <box key={row.id} height={1} backgroundColor={start + offset === index ? theme.surface3 : theme.surface} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); controller.activate(row.space.id, row.workspace?.id); onClose() } }}><text fg={row.workspace ? theme.text : theme.cyan} wrapMode="none">{fit(`${row.label} · ${row.space.cwd}`, popWidth - 4)}</text></box>)}</box>
    </>}
    {error || controller.persistenceError || controller.recoveryWarning ? <text fg={theme.red} wrapMode="word">{error ?? controller.persistenceError ?? controller.recoveryWarning}</text> : null}
    <text fg={theme.dim} wrapMode="word">{confirm ? 'Enter/y close · Escape/n cancel' : edit ? 'Enter save · Escape cancel' : '↑↓ select · Enter open · Ctrl+N workspace · Ctrl+A space · Ctrl+R rename · Ctrl+X close · Ctrl+←/→ reorder · Esc'}</text>
  </box>
}

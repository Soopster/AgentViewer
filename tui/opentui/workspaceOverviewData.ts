import type { Session } from '../../lib/types'
import { formatSessionTitle } from '../format'
import { orderWindows, isSurfaceWindowKey, surfaceIdOfKey } from './windowOrder'
import { surfaceTitle } from './windowSurfaceNames'
import type { WorkspaceRuntime, SpacesController } from './spacesStore'

export type OverviewWindow = { key: string; title: string; detail: string; hidden: boolean; badge?: string; tabs?: OverviewWindow[] }
export type OverviewNode = { id: string; title: string; detail: string; spaceId: string; workspaceId?: string; target?: string; children: OverviewNode[] }
export type OverviewRow = OverviewNode & { depth: number; parent?: string; matched: boolean }

const OVERVIEW_FIELDS = ['windowOverviewWindows', 'windowAttention', 'openTabSessions', 'readerSession', 'splitPinnedKeys', 'splitPaneCount', 'windowSurfaces', 'windowOrder', 'windowStacks', 'floatingWindow', 'popoverTabs', 'activePopoverTab', 'selectedSessionKey', 'primaryWindowOpen', 'workspaceHasSession', 'windowZoom'] as const
export function subscribeWorkspaceOverview(controller: SpacesController, listener: () => void): () => void {
  let active = true, queued = false
  const changed = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; if (active) listener() })
  }
  const disposers = controller.getSnapshot().spaces.flatMap(space => space.workspaces.flatMap(workspace => OVERVIEW_FIELDS.map(field => controller.runtime(workspace).subscribe(field, changed))))
  return () => { active = false; for (const dispose of disposers) dispose() }
}

/** Combine durable logical membership with the last measured visibility, never stale membership. */
export function workspaceWindowOverview(runtime: WorkspaceRuntime): OverviewWindow[] {
  const values = { ...runtime.snapshot(), ...Object.fromEntries(runtime.values) }
  const sessions = [...((values.openTabSessions ?? []) as Session[]), ...(values.readerSession ? [values.readerSession as Session] : [])]
  const sessionByKey = new Map(sessions.map(session => [`${session.provider ?? 'claude'}:${session.sessionId}`, session]))
  const cached = new Map<string, OverviewWindow>()
  for (const window of (runtime.values.get('windowOverviewWindows') ?? []) as OverviewWindow[]) {
    cached.set(window.key, window)
    for (const tab of window.tabs ?? []) cached.set(tab.key, tab)
  }
  const reader = values.primaryWindowOpen === false || values.workspaceHasSession === false ? undefined : values.selectedSessionKey as string | undefined
  const keys = orderWindows((values.windowOrder ?? []) as string[], ((values.splitPinnedKeys ?? []) as string[]).slice(0, Number(values.splitPaneCount ?? 0)), (values.windowSurfaces ?? []) as string[])
  const stacks = (values.windowStacks ?? []) as string[][]
  const stripIds = [...new Set((values.popoverTabs ?? []) as string[])]
  const activeStrip = stripIds.includes(String(values.activePopoverTab)) ? values.activePopoverTab as string : null
  const floating = values.floatingWindow as { key?: string } | undefined
  const floatingKey = floating?.key && !keys.includes(floating.key) ? floating.key : null
  const zoom = values.windowZoom ?? null
  const meta = (values.windowSurfaceMeta ?? {}) as Record<string, { session?: string; path?: string; cwd?: string }>
  const title = (key: string): string => {
    if (!isSurfaceWindowKey(key)) return sessionByKey.has(key) ? formatSessionTitle(sessionByKey.get(key)!) : cached.get(key)?.title ?? key
    const id = surfaceIdOfKey(key), pin = meta[id]
    const pinned = pin?.session ? sessionByKey.get(pin.session) : null
    return cached.get(key)?.title ?? `${surfaceTitle(id)}${pinned ? ` · ${formatSessionTitle(pinned)}` : pin?.path ? ` · ${pin.path}` : ''}`
  }
  const badge = (key: string): string | undefined => {
    const mark = values.windowAttention instanceof Map ? values.windowAttention.get(key) : null
    return cached.get(key)?.badge === '?' ? '?' : mark?.error ? '!' : mark?.unread ? '●' : undefined
  }
  const describe = (key: string, hidden: boolean, kind: string, tabs = true): OverviewWindow => ({
    key, title: title(key), hidden, badge: badge(key),
    detail: cached.get(key)?.detail.replace(/\s*·\s*hidden\b/g, '') ?? `${kind}${isSurfaceWindowKey(key) && meta[surfaceIdOfKey(key)]?.cwd ? ` · ${meta[surfaceIdOfKey(key)]!.cwd}` : ''}`,
    tabs: tabs ? stacks.find(stack => stack.includes(key))?.map(member => describe(member, hidden || member !== key, 'tab', false)) : undefined,
  })
  return [
    ...(reader ? [describe(reader, Boolean(activeStrip) || zoom !== null && zoom !== 'reader', 'session')] : []),
    ...keys.map((key, index) => describe(key, zoom !== null ? zoom !== index : cached.get(key)?.hidden ?? false, 'window')),
    ...stripIds.map(id => describe(`surface:${id}`, id !== activeStrip || zoom !== null && zoom !== 'reader', 'workspace tab')),
    ...(floatingKey ? [describe(floatingKey, false, 'floating')] : []),
  ]
}

export function workspaceOverview(controller: SpacesController): OverviewNode[] {
  return controller.getSnapshot().spaces.map(space => ({
    id: `space:${space.id}`, title: space.name, detail: space.cwd, spaceId: space.id,
    children: space.workspaces.map(workspace => {
      const runtime = controller.runtime(workspace)
      const windows = workspaceWindowOverview(runtime)
      const node = (window: OverviewWindow, tab = false): OverviewNode => ({
        id: `${workspace.id}:${tab ? 'tab' : 'window'}:${window.key}`, title: `${window.badge ? `${window.badge} ` : ''}${window.title}`,
        detail: `${window.detail}${window.hidden ? ' · hidden' : ''}`, spaceId: space.id, workspaceId: workspace.id, target: window.key,
        children: tab ? [] : (window.tabs ?? []).map(tab => node(tab, true)),
      })
      return { id: `workspace:${workspace.id}`, title: `${controller.getAttention(workspace.id) || ''} ${workspace.name}`.trim(), detail: `${windows.length} windows`, spaceId: space.id, workspaceId: workspace.id, children: windows.map(window => node(window)) }
    }),
  }))
}

export function overviewRows(nodes: OverviewNode[], collapsed: ReadonlySet<string>, query: string): OverviewRow[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const matches = (node: OverviewNode, ancestors: string): boolean => {
    const text = `${ancestors} ${node.title} ${node.detail} ${node.target ?? ''}`.toLowerCase()
    return terms.every(term => text.includes(term)) || node.children.some(child => matches(child, text))
  }
  const visit = (node: OverviewNode, depth: number, parent?: string, ancestors = ''): OverviewRow[] => {
    if (terms.length && !matches(node, ancestors)) return []
    return [{ ...node, depth, parent, matched: terms.every(term => `${ancestors} ${node.title} ${node.detail} ${node.target ?? ''}`.toLowerCase().includes(term)) }, ...(!collapsed.has(node.id) || terms.length ? node.children.flatMap(child => visit(child, depth + 1, node.id, `${ancestors} ${node.title} ${node.detail} ${node.target ?? ''}`)) : [])]
  }
  return nodes.flatMap(node => visit(node, 0))
}

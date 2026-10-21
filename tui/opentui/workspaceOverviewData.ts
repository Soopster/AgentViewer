import type { Session } from '../../lib/types'
import { formatSessionTitle } from '../format'
import { orderWindows, isSurfaceWindowKey, surfaceIdOfKey } from './windowOrder'
import type { SpacesController } from './spacesStore'

export type OverviewWindow = { key: string; title: string; detail: string; hidden: boolean; badge?: string; tabs?: OverviewWindow[] }
export type OverviewNode = { id: string; title: string; detail: string; spaceId: string; workspaceId?: string; target?: string; children: OverviewNode[] }
export type OverviewRow = OverviewNode & { depth: number; parent?: string; matched: boolean }

export function subscribeWorkspaceOverview(controller: SpacesController, listener: () => void): () => void {
  const disposers = controller.getSnapshot().spaces.flatMap(space => space.workspaces.map(workspace => controller.runtime(workspace).subscribe('windowOverviewWindows', listener)))
  return () => { for (const dispose of disposers) dispose() }
}

export function workspaceOverview(controller: SpacesController): OverviewNode[] {
  return controller.getSnapshot().spaces.map(space => ({
    id: `space:${space.id}`, title: space.name, detail: space.cwd, spaceId: space.id,
    children: space.workspaces.map(workspace => {
      const runtime = controller.runtime(workspace)
      const values = runtime.snapshot()
      let windows = runtime.values.get('windowOverviewWindows') as OverviewWindow[] | undefined
      if (!windows) {
        const sessions = [...((values.openTabSessions ?? []) as Session[]), ...(values.readerSession ? [values.readerSession as Session] : [])]
        const title = (key: string) => isSurfaceWindowKey(key) ? surfaceIdOfKey(key) : formatSessionTitle(sessions.find(session => `${session.provider ?? 'claude'}:${session.sessionId}` === key) ?? { sessionId: key } as Session)
        const stacks = (values.windowStacks ?? []) as string[][]
        const badge = (key: string): string | undefined => {
          const mark = values.windowAttention instanceof Map ? values.windowAttention.get(key) : null
          return mark?.error ? '!' : mark?.unread ? '●' : undefined
        }
        const reader = values.primaryWindowOpen === false || values.workspaceHasSession === false ? undefined : values.selectedSessionKey as string | undefined
        const keys = orderWindows((values.windowOrder ?? []) as string[], ((values.splitPinnedKeys ?? []) as string[]).slice(0, Number(values.splitPaneCount ?? 0)), (values.windowSurfaces ?? []) as string[])
        const floating = values.floatingWindow as { key?: string } | undefined
        if (floating?.key) keys.push(floating.key)
        windows = [...(reader ? [{ key: reader, title: title(reader), detail: 'session', hidden: false, badge: badge(reader) }] : []), ...keys.map(key => ({
          key, title: title(key), badge: badge(key), detail: key === floating?.key ? 'floating' : 'window', hidden: true,
          tabs: stacks.find(stack => stack.includes(key))?.map(tab => ({ key: tab, title: title(tab), badge: badge(tab), detail: 'tab', hidden: tab !== key })),
        }))]
      }
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

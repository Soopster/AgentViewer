import type { SpacesController, WorkspaceRuntime } from './spacesStore'
import { orderWindows, isSurfaceWindowKey, surfaceIdOfKey, surfaceWindowKey } from './windowOrder'
import { addToStack, stackOf, stackSuccessor, removeFromStack, defaultFloatingRect, type FloatingRect } from './windowTabs'
import { isPopoverWindowKind, POPOVER_WINDOWS } from './popoverWindows'
import { reconcileWindowSplitTree, validWindowSplitTree } from './windowSplitTree'

export type ShelvedWindow = {
  key: string
  placement: 'window' | 'tab' | 'floating' | 'popover'
  anchor?: string
  index?: number
  floating?: { rect: FloatingRect; slot: number }
}

const read = <T>(runtime: WorkspaceRuntime, key: string, fallback: T): T => runtime.get(key, fallback, true)
const write = (runtime: WorkspaceRuntime, key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
const layoutKeys = (runtime: WorkspaceRuntime) => orderWindows(
  read(runtime, 'windowOrder', [] as string[]),
  read(runtime, 'splitPinnedKeys', [] as string[]).slice(0, read(runtime, 'splitPaneCount', 0)),
  read(runtime, 'windowSurfaces', [] as string[]),
)

function commit(runtime: WorkspaceRuntime, keys: string[]) {
  write(runtime, 'windowOrder', keys)
  write(runtime, 'splitPinnedKeys', keys.filter(key => !isSurfaceWindowKey(key)))
  write(runtime, 'splitPaneCount', keys.filter(key => !isSurfaceWindowKey(key)).length)
  write(runtime, 'windowSurfaces', keys.filter(isSurfaceWindowKey).map(surfaceIdOfKey))
  const tree = runtime.values.get('windowSplitTree')
  if (validWindowSplitTree(tree)) write(runtime, 'windowSplitTree', reconcileWindowSplitTree(tree, keys,
    runtime.values.get('primaryWindowOpen') !== false && runtime.values.get('workspaceHasSession') !== false && Boolean(runtime.values.get('selectedSessionKey')) || Boolean(runtime.values.get('activePopoverTab'))))
  write(runtime, 'windowZoom', null)
  write(runtime, 'splitFocusIndex', null)
  runtime.set('windowOverviewWindows', undefined)
}

function workspaceRuntime(controller: SpacesController, workspaceId: string): WorkspaceRuntime {
  const workspace = controller.getSnapshot().spaces.flatMap(space => space.workspaces).find(item => item.id === workspaceId)
  if (!workspace) throw new Error('That workspace is no longer available')
  return controller.runtime(workspace)
}

export function shelveWorkspaceWindow(controller: SpacesController, workspaceId: string, key: string): void {
  const runtime = workspaceRuntime(controller, workspaceId)
  const shelves = read(runtime, 'shelvedWindowKeys', [] as ShelvedWindow[])
  if (shelves.some(item => item.key === key)) return
  const keys = layoutKeys(runtime)
  const stacks = read(runtime, 'windowStacks', [] as string[][])
  const stack = stackOf(stacks, key)
  const floating = read(runtime, 'floatingWindow', null as ({ key: string; rect: FloatingRect; slot: number } | null))
  const tabs = read(runtime, 'popoverTabs', [] as string[])
  const id = isSurfaceWindowKey(key) ? surfaceIdOfKey(key) : ''
  if (!keys.includes(key) && floating?.key !== key && !stack?.includes(key) && !(id && tabs.includes(id))) throw new Error('That window is no longer available')

  const placement: ShelvedWindow['placement'] = id && tabs.includes(id) ? 'popover'
    : floating?.key === key ? 'floating'
      : stack ? 'tab' : 'window'
  const index = keys.indexOf(key)
  const anchor = stack?.find(member => member !== key)
  write(runtime, 'shelvedWindowKeys', [...shelves, {
    key, placement, ...(anchor ? { anchor } : {}), ...(index >= 0 ? { index } : {}),
    ...(placement === 'floating' && floating ? { floating: { rect: floating.rect, slot: floating.slot } } : {}),
  }])
  if (placement === 'popover') {
    write(runtime, 'popoverTabs', tabs.filter(entry => entry !== id))
    if (read(runtime, 'activePopoverTab', null as string | null) === id) write(runtime, 'activePopoverTab', null)
  }
  if (placement === 'floating') write(runtime, 'floatingWindow', null)
  if (stack) {
    const successor = keys.includes(key) ? stackSuccessor(stack, key) : null
    write(runtime, 'windowStacks', removeFromStack(stacks, key))
    if (successor && keys.includes(key)) commit(runtime, keys.map(entry => entry === key ? successor : entry))
  } else if (keys.includes(key)) commit(runtime, keys.filter(entry => entry !== key))
}

export function restoreShelvedWorkspaceWindow(controller: SpacesController, workspaceId: string, key: string): void {
  const runtime = workspaceRuntime(controller, workspaceId)
  const shelves = read(runtime, 'shelvedWindowKeys', [] as ShelvedWindow[])
  const item = shelves.find(entry => entry.key === key)
  if (!item) return
  const keys = layoutKeys(runtime)
  const stacks = read(runtime, 'windowStacks', [] as string[][])
  const tabs = read(runtime, 'popoverTabs', [] as string[])
  const floating = read(runtime, 'floatingWindow', null as ({ key: string; rect: FloatingRect; slot: number } | null))
  const anchor = item.anchor
  if (item.placement === 'popover') {
    const id = surfaceIdOfKey(key)
    const kind = id.split('#')[0]!
    if (isPopoverWindowKind(kind) && POPOVER_WINDOWS[kind].single && tabs.some(existing => existing.split('#')[0] === kind)) throw new Error(`This workspace already has a ${kind} tab`)
    write(runtime, 'popoverTabs', [...tabs, id])
    write(runtime, 'activePopoverTab', id)
  } else if (item.placement === 'tab' && anchor && (keys.includes(anchor) || stacks.some(stack => stack.includes(anchor))) ) {
    write(runtime, 'windowStacks', addToStack(stacks, anchor, key))
  } else if (item.placement === 'floating' && !floating && item.floating) {
    write(runtime, 'floatingWindow', { key, ...item.floating })
  } else {
    if (isSurfaceWindowKey(key) && !keys.includes(key)) {
      const kind = surfaceIdOfKey(key).split('#')[0]!
      if (isPopoverWindowKind(kind) && POPOVER_WINDOWS[kind].single && keys.some(existing => isSurfaceWindowKey(existing) && surfaceIdOfKey(existing).split('#')[0] === kind)) throw new Error(`This workspace already has a ${kind} window`)
    }
    const next = keys.filter(entry => entry !== key)
    next.splice(Math.max(0, Math.min(item.index ?? next.length, next.length)), 0, key)
    commit(runtime, next)
  }
  write(runtime, 'shelvedWindowKeys', shelves.filter(entry => entry.key !== key))
  runtime.set('windowOverviewPendingTarget', key)
}

export function applyWorkspaceWindowAction(controller: SpacesController, workspaceId: string, keysToActOn: string[], action: 'tab' | 'float' | 'close'): void {
  const runtime = workspaceRuntime(controller, workspaceId)
  const selected = [...new Set(keysToActOn)]
  if (selected.length === 0) return
  const keys = layoutKeys(runtime)
  const stacks = read(runtime, 'windowStacks', [] as string[][])
  const tabs = read(runtime, 'popoverTabs', [] as string[])
  const floating = read(runtime, 'floatingWindow', null as ({ key: string; rect: FloatingRect; slot: number } | null))
  const selectedSet = new Set(selected)
  if (action === 'tab') {
    if (selected.length < 2) throw new Error('Select at least two windows to make a tab group')
    const frame = selected.find(key => keys.includes(key))
      ?? selected.map(key => stackOf(stacks, key)?.find(member => keys.includes(member))).find((key): key is string => Boolean(key))
      ?? selected.find(key => isSurfaceWindowKey(key) && tabs.includes(surfaceIdOfKey(key)))
    if (!frame) throw new Error('At least one selected window must have a visible frame')
    const members = [...new Set([frame, ...selected.filter(key => key !== frame)])]
    const nextKeys = keys.filter(key => !selectedSet.has(key) || key === frame)
    const keptStacks = stacks.flatMap(stack => {
      if (!stack.some(key => selectedSet.has(key))) return [stack]
      const survivors = stack.filter(key => !selectedSet.has(key))
      if (survivors.length > 0 && stack.some(key => keys.includes(key)) && !nextKeys.includes(survivors[0]!)) nextKeys.push(survivors[0]!)
      return survivors.length > 1 ? [survivors] : []
    })
    write(runtime, 'windowStacks', [...keptStacks, members])
    write(runtime, 'popoverTabs', tabs.filter(id => !selectedSet.has(surfaceWindowKey(id))))
    commit(runtime, [...nextKeys, ...(tabs.includes(surfaceIdOfKey(frame)) && !keys.includes(frame) ? [frame] : [])])
    runtime.set('windowOverviewPendingTarget', frame)
    return
  }
  if (action === 'float') {
    const key = selected[0]!
    if (floating && floating.key !== key) throw new Error('Dock the current floating window before floating another')
    const stack = stackOf(stacks, key)
    const successor = stack && keys.includes(key) ? stackSuccessor(stack, key) : null
    write(runtime, 'windowStacks', removeFromStack(stacks, key))
    const wasPopover = isSurfaceWindowKey(key) && tabs.includes(surfaceIdOfKey(key))
    if (wasPopover) {
      write(runtime, 'popoverTabs', tabs.filter(id => id !== surfaceIdOfKey(key)))
      if (read(runtime, 'activePopoverTab', null as string | null) === surfaceIdOfKey(key)) write(runtime, 'activePopoverTab', null)
    }
    const baseKeys = wasPopover && !keys.includes(key) ? [...keys, key] : keys
    commit(runtime, baseKeys.map(entry => entry === key ? successor ?? null : entry).filter((entry): entry is string => entry !== null))
    write(runtime, 'floatingWindow', { key, slot: Math.max(0, keys.indexOf(key)), rect: floating?.key === key ? floating.rect : defaultFloatingRect({ width: 80, height: 24 }) })
    runtime.set('windowOverviewPendingTarget', key)
    return
  }
  const remaining = keys.filter(key => !selectedSet.has(key))
  const survivorsByStack = stacks.map(stack => stack.filter(key => !selectedSet.has(key)))
  for (let index = 0; index < stacks.length; index += 1) {
    const old = stacks[index]!, survivors = survivorsByStack[index]!
    if (survivors.length && old.some(key => keys.includes(key)) && !remaining.includes(survivors[0]!)) remaining.push(survivors[0]!)
  }
  write(runtime, 'windowStacks', survivorsByStack.filter(stack => stack.length > 1))
  write(runtime, 'popoverTabs', tabs.filter(id => !selectedSet.has(surfaceWindowKey(id))))
  if (floating && selectedSet.has(floating.key)) write(runtime, 'floatingWindow', null)
  if (selected.some(isSurfaceWindowKey)) {
    const meta = { ...read(runtime, 'windowSurfaceMeta', {} as Record<string, unknown>) }
    for (const key of selected.filter(isSurfaceWindowKey)) delete meta[surfaceIdOfKey(key)]
    write(runtime, 'windowSurfaceMeta', meta)
  }
  if (selected.some(key => isSurfaceWindowKey(key) && read(runtime, 'activePopoverTab', null as string | null) === surfaceIdOfKey(key))) write(runtime, 'activePopoverTab', null)
  commit(runtime, remaining)
}

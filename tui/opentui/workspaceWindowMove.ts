import { sessionIdentityKey } from './sessionIdentity'
import type { Session } from '../../lib/types'
import type { SpacesController, WorkspaceRuntime } from './spacesStore'
import { isSurfaceWindowKey, orderWindows, surfaceIdOfKey, surfaceWindowKey } from './windowOrder'
import { isPopoverWindowKind, POPOVER_WINDOWS } from './popoverWindows'
import { reconcileWindowSplitTree, validWindowSplitTree } from './windowSplitTree'

const sessionKey = sessionIdentityKey
const read = <T>(runtime: WorkspaceRuntime, key: string, initial: T): T => runtime.get(key, initial, true)
const write = (runtime: WorkspaceRuntime, key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
const keysOf = (runtime: WorkspaceRuntime) => orderWindows(read(runtime, 'windowOrder', [] as string[]), read(runtime, 'splitPinnedKeys', [] as string[]).slice(0, read(runtime, 'splitPaneCount', 0)), read(runtime, 'windowSurfaces', [] as string[]))
function commit(runtime: WorkspaceRuntime, keys: string[]) {
  write(runtime, 'windowOrder', keys)
  write(runtime, 'splitPinnedKeys', keys.filter(key => !isSurfaceWindowKey(key)))
  write(runtime, 'splitPaneCount', keys.filter(key => !isSurfaceWindowKey(key)).length)
  write(runtime, 'windowSurfaces', keys.filter(isSurfaceWindowKey).map(surfaceIdOfKey))
  const tree = runtime.values.get('windowSplitTree')
  if (validWindowSplitTree(tree)) write(runtime, 'windowSplitTree', reconcileWindowSplitTree(tree, keys, runtime.values.get('primaryWindowOpen') !== false && runtime.values.get('workspaceHasSession') !== false && Boolean(runtime.values.get('selectedSessionKey')) || Boolean(runtime.values.get('activePopoverTab'))))
  else if (keys.length > 3 && read(runtime, 'splitArrangement', 'split') === 'split') write(runtime, 'splitArrangement', 'main-stack')
  write(runtime, 'windowZoom', null)
  write(runtime, 'splitFocusIndex', null)
  runtime.set('windowOverviewWindows', undefined)
}

/** Transfer a frame and its tabs, or a single overview tab. Resources are reassigned by the caller without restarting them. */
export function moveWorkspaceWindow(controller: SpacesController, sourceId: string, destinationId: string, target: string, singleTab = false): { key: string; resourceIds: string[] } {
  if (sourceId === destinationId) throw new Error('Choose another workspace')
  const workspaces = controller.getSnapshot().spaces.flatMap(space => space.workspaces)
  const sourceWorkspace = workspaces.find(workspace => workspace.id === sourceId)
  const destinationWorkspace = workspaces.find(workspace => workspace.id === destinationId)
  if (!sourceWorkspace || !destinationWorkspace) throw new Error('That workspace is no longer available')
  const source = controller.runtime(sourceWorkspace), destination = controller.runtime(destinationWorkspace)
  source.flushers.forEach(flush => flush())
  destination.flushers.forEach(flush => flush())
  const reader = read(source, 'primaryWindowOpen', true) && read(source, 'workspaceHasSession', true) ? read(source, 'selectedSessionKey', null as string | null) : null
  const key = target === 'reader' ? reader : target
  if (!key) throw new Error('This reader has no session to move')
  const sourceKeys = keysOf(source), destinationKeys = keysOf(destination)
  const sourceTabs = read(source, 'popoverTabs', [] as string[]), destinationTabs = read(destination, 'popoverTabs', [] as string[])
  const stacks = read(source, 'windowStacks', [] as string[][])
  const stack = stacks.find(stack => stack.includes(key))
  const floating = read(source, 'floatingWindow', null as { key: string } | null)
  if (key !== reader && !sourceKeys.includes(key) && floating?.key !== key && !stack && !(isSurfaceWindowKey(key) && sourceTabs.includes(surfaceIdOfKey(key)))) throw new Error('That window is no longer available')
  const members = !singleTab && stack ? [...stack] : [key]
  const moved = new Set(members)
  const sourceSessions = read(source, 'openTabSessions', [] as Session[])
  const readerSession = read(source, 'readerSession', null as Session | null)
  // The selected transcript is also an ordinary open tab. Reader metadata is
  // only a fallback for restored workspaces, not another tab to transfer.
  const sessions = [...new Map([...(readerSession ? [readerSession] : []), ...sourceSessions]
    .filter(session => moved.has(sessionKey(session)))
    .map(session => [sessionKey(session), session])).values()]
  if (members.some(member => !isSurfaceWindowKey(member) && !sessions.some(session => sessionKey(session) === member))) throw new Error('Session information is not available yet')
  const destinationStacks = read(destination, 'windowStacks', [] as string[][])
  const destinationFloating = read(destination, 'floatingWindow', null as { key: string } | null)
  const destinationReader = read(destination, 'primaryWindowOpen', true) && read(destination, 'workspaceHasSession', true) ? read(destination, 'selectedSessionKey', null as string | null) : null
  const taken = new Set([...destinationTabs.map(surfaceWindowKey), ...destinationKeys, ...destinationStacks.flat(), ...(destinationFloating ? [destinationFloating.key] : []), ...(destinationReader ? [destinationReader] : [])])
  if (members.some(member => !isSurfaceWindowKey(member) && taken.has(member))) throw new Error('That session is already displayed in the destination workspace')
  for (const member of members) {
    const incoming = source.values.get(`draft:${member}`), existing = destination.values.get(`draft:${member}`)
    if (incoming && existing && incoming !== existing) throw new Error('The destination has a different unsent draft for this session')
  }
  if (destinationKeys.length >= 31) throw new Error('The destination workspace has reached its window limit')
  const mapping = new Map<string, string>()
  for (const member of members) {
    let next = member
    if (isSurfaceWindowKey(member)) {
      const kind = surfaceIdOfKey(member).split('#')[0]!
      if (isPopoverWindowKind(kind) && POPOVER_WINDOWS[kind].single && [...taken].some(key => isSurfaceWindowKey(key) && surfaceIdOfKey(key).split('#')[0] === kind)) throw new Error(`The destination already has a ${kind} window`)
      if (kind === 'editor' && [...destination.values].some(([field, value]) => field.startsWith('editor:') && field.endsWith(':tabs') && Array.isArray(value) && value.length)) throw new Error('The destination already has editor buffers; use another workspace')
      for (let n = 2; taken.has(next); n++) next = surfaceWindowKey(`${kind}#${n}`)
    }
    mapping.set(member, next); taken.add(next)
  }
  const destinationSpace = controller.getSnapshot().spaces.find(space => space.workspaces.some(workspace => workspace.id === destinationId))!
  // Flush the currently mounted UI before editing either runtime, so its leave
  // callback cannot reinsert the transferred reader or overwrite its draft.
  controller.activate(destinationSpace.id, destinationId)
  const resourceIds = new Set<string>()
  const sourceMeta = { ...read(source, 'windowSurfaceMeta', {} as Record<string, unknown>) }
  const destinationMeta = { ...read(destination, 'windowSurfaceMeta', {} as Record<string, unknown>) }
  const sourceSelections = source.values.get('ref:shellSelections') as { current: Map<string, string | null> } | undefined
  const destinationSelections = destination.get('ref:shellSelections', () => ({ current: new Map<string, string | null>() }), false)
  for (const member of members) {
    const next = mapping.get(member)!
    if (isSurfaceWindowKey(member)) {
      const oldId = surfaceIdOfKey(member), newId = surfaceIdOfKey(next), kind = oldId.split('#')[0]!
      const originalMeta = sourceMeta[oldId] as Record<string, unknown> | undefined
      const sourceSpace = controller.getSnapshot().spaces.find(space => space.workspaces.some(workspace => workspace.id === sourceId))!
      destinationMeta[newId] = { cwd: readerSession?.cwd || sourceSpace.cwd, ...originalMeta }
      delete sourceMeta[oldId]
      if (kind === 'editor') for (const [field, value] of [...source.values]) if (field.startsWith('editor:')) {
        if (source.persistent.has(field)) write(destination, field, value); else destination.set(field, value)
        source.values.delete(field); source.persistent.delete(field); delete source.workspace.values[field]
      }
      if (kind === 'editor') for (const field of ['editorInitialPath', 'editorInitialLine']) if (source.values.has(field)) write(destination, field, source.values.get(field))
      const dependency = originalMeta?.session
      if (typeof dependency === 'string') {
        const pinned = [...sourceSessions, ...(readerSession ? [readerSession] : [])].find(session => sessionKey(session) === dependency)
        if (pinned && !sessions.some(session => sessionKey(session) === dependency)) sessions.push(pinned)
      }
      const prefix = `surface:${oldId}:${kind}:`, replacement = `surface:${newId}:${kind}:`
      for (const [field, value] of [...source.values]) if (field.startsWith(prefix)) {
        const destinationField = replacement + field.slice(prefix.length)
        if (source.persistent.has(field)) write(destination, destinationField, value); else destination.set(destinationField, value)
        if (field.endsWith('process:selectedId') && typeof value === 'string') resourceIds.add(value)
        source.values.delete(field); source.persistent.delete(field); delete source.workspace.values[field]
      }
      const selected = sourceSelections?.current.get(oldId)
      if (selected) { destinationSelections.current.set(newId, selected); resourceIds.add(selected) }
      sourceSelections?.current.delete(oldId)
    } else {
      for (const prefix of ['draft:', 'draftparts:']) if (source.values.has(prefix + member)) write(destination, prefix + next, source.values.get(prefix + member))
      const positions = source.values.get('ref:readerPositions') as { current: Map<string, unknown> } | undefined
      if (positions?.current.has(member)) destination.get('ref:readerPositions', () => ({ current: new Map<string, unknown>() }), false).current.set(next, positions.current.get(member))
    }
  }
  const sourceAttention = new Map(read(source, 'windowAttention', new Map<string, unknown>()))
  const destinationAttention = new Map(read(destination, 'windowAttention', new Map<string, unknown>()))
  for (const member of members) if (sourceAttention.has(member)) { destinationAttention.set(mapping.get(member)!, sourceAttention.get(member)); sourceAttention.delete(member) }
  write(source, 'windowAttention', sourceAttention); write(destination, 'windowAttention', destinationAttention)
  write(source, 'windowSurfaceMeta', sourceMeta); write(destination, 'windowSurfaceMeta', destinationMeta)
  const remainingTabs = sourceTabs.filter(id => !moved.has(surfaceWindowKey(id)))
  write(source, 'popoverTabs', remainingTabs)
  if (!remainingTabs.includes(read(source, 'activePopoverTab', ''))) write(source, 'activePopoverTab', null)
  const sourceRemaining = sourceKeys.flatMap(entry => moved.has(entry) ? stack?.filter(member => !moved.has(member)).slice(0, 1) ?? [] : [entry])
  write(source, 'windowStacks', stacks.map(stack => stack.filter(member => !moved.has(member))).filter(stack => stack.length > 1))
  if (floating && moved.has(floating.key)) write(source, 'floatingWindow', null)
  write(source, 'openTabSessions', sourceSessions.filter(session => !moved.has(sessionKey(session))))
  const tabs = read(destination, 'openTabSessions', [] as Session[])
  write(destination, 'openTabSessions', [...tabs, ...sessions.filter(session => !tabs.some(tab => sessionKey(tab) === sessionKey(session)))])
  if (moved.has(reader ?? '')) {
    write(source, 'primaryWindowOpen', false); write(source, 'workspaceHasSession', false); write(source, 'readerSession', null); write(source, 'selectedSessionKey', null)
    source.set('sessionDetail', null)
  }
  const newKey = mapping.get(key)!
  write(destination, 'workspaceLaunched', true)
  write(destination, 'windowStacks', [...destinationStacks, ...(members.length > 1 ? [members.map(member => mapping.get(member)!)] : [])])
  commit(source, sourceRemaining)
  commit(destination, [...destinationKeys, newKey])
  // Local undo must not resurrect a frame whose resource now belongs elsewhere.
  for (const runtime of [source, destination]) {
    (runtime.values.get('windowHistory') as { clear?: () => void } | undefined)?.clear?.()
    runtime.set('closedWindows', [])
  }
  destination.set('windowOverviewPendingTarget', newKey)
  return { key: newKey, resourceIds: [...resourceIds] }
}

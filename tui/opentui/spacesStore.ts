import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function canonicalSpacePath(cwd: string): string { try { return realpathSync(cwd) } catch { return path.resolve(cwd) } }

export type SpaceId = string
export type WorkspaceId = string
export type Workspace = { id: WorkspaceId; name: string; values: Record<string, unknown> }
export type Space = { id: SpaceId; name: string; cwd: string; workspaces: Workspace[]; activeWorkspaceId: WorkspaceId }
export type SpacesState = { workspacesEnabled?: boolean; version: 1; spaces: Space[]; activeSpaceId: SpaceId | null }
const createWorkspace = (name = '1'): Workspace => ({ id: randomUUID(), name, values: { workspaceLaunched: false, workspaceHasSession: false } })
const encode = (_key: string, value: unknown): unknown => value instanceof Set ? { $spaceType: 'set', values: [...value] } : value instanceof Map ? { $spaceType: 'map', values: [...value] } : value
const decode = (_key: string, value: any): unknown => value?.$spaceType === 'set' && Array.isArray(value.values) ? new Set(value.values) : value?.$spaceType === 'map' && Array.isArray(value.values) ? new Map(value.values) : value

export class WorkspaceRuntime {
  readonly values = new Map<string, unknown>()
  readonly persistent = new Set<string>()
  readonly restoredKeys: Set<string>
  readonly listeners = new Map<string, Set<() => void>>()
  beforeLeave: (() => void) | null = null
  readonly flushers = new Set<() => void>()
  private readonly changedKeys = new Set<string>()
  private updateQueued = false
  disposed = false
  constructor(readonly workspace: Workspace, readonly onChange: () => void) {
    this.restoredKeys = new Set(Object.keys(workspace.values))
    for (const [key, value] of Object.entries(workspace.values)) this.values.set(key, value)
  }
  get<T>(key: string, initial: T | (() => T), persist: boolean): T {
    if (persist) this.persistent.add(key)
    if (!this.values.has(key)) this.values.set(key, typeof initial === 'function' ? (initial as () => T)() : initial)
    return this.values.get(key) as T
  }
  set<T>(key: string, action: T | ((previous: T) => T)): void {
    if (this.disposed) return
    const previous = this.values.get(key) as T
    const next = typeof action === 'function' ? (action as (previous: T) => T)(previous) : action
    if (Object.is(previous, next)) return
    this.values.set(key, next)
    // A layout operation updates several fields. Notify only after all of
    // them are committed, so reconciliation never observes a partial undo.
    this.changedKeys.add(key)
    if (!this.updateQueued) {
      this.updateQueued = true
      queueMicrotask(() => {
        this.updateQueued = false
        const changed = [...this.changedKeys]
        this.changedKeys.clear()
        if (!this.disposed) for (const field of changed) this.listeners.get(field)?.forEach(listener => listener())
      })
    }
    if (this.persistent.has(key)) this.onChange()
  }
  subscribe(key: string, listener: () => void): () => void {
    let listeners = this.listeners.get(key)
    if (!listeners) this.listeners.set(key, listeners = new Set())
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  snapshot(): Record<string, unknown> {
    const values: Record<string, unknown> = { ...this.workspace.values }
    for (const key of this.persistent) values[key] = this.values.get(key)
    return values
  }
}

function validState(value: any): value is SpacesState {
  if (value?.workspacesEnabled !== undefined && typeof value.workspacesEnabled !== 'boolean') return false
  if (value?.version !== 1 || !Array.isArray(value.spaces)) return false
  const ids = new Set<string>()
  for (const space of value.spaces) {
    if (!space || typeof space.id !== 'string' || ids.has(space.id) || typeof space.name !== 'string' || typeof space.cwd !== 'string' || !path.isAbsolute(space.cwd) || !Array.isArray(space.workspaces) || !space.workspaces.length) return false
    ids.add(space.id)
    for (const workspace of space.workspaces) {
      if (!workspace || typeof workspace.id !== 'string' || ids.has(workspace.id) || typeof workspace.name !== 'string' || !workspace.values || typeof workspace.values !== 'object' || Array.isArray(workspace.values)) return false
      ids.add(workspace.id)
      const values = workspace.values
      for (const key of ['splitPinnedKeys', 'windowSurfaces', 'windowOrder', 'windowStacks', 'openTabSessions', 'queuedComposerSends', 'composerPromptParts', 'composerMentionAttachments']) if (values[key] !== undefined && !Array.isArray(values[key])) return false
      for (const key of ['expandedCardKeys', 'collapsedCardKeys', 'scrollbackToggledKeys']) if (values[key] !== undefined && !(values[key] instanceof Set)) return false
      if (values.windowAttention !== undefined && !(values.windowAttention instanceof Map)) return false
      if (values.splitPaneCount !== undefined && (!Number.isFinite(values.splitPaneCount) || values.splitPaneCount < 0)) return false
      if (values.splitArrangement !== undefined && !['split', 'main-stack', 'grid'].includes(values.splitArrangement)) return false
      if (values.splitOrientation !== undefined && !['columns', 'rows'].includes(values.splitOrientation)) return false
      if (values.selectedSessionKeyState != null && typeof values.selectedSessionKeyState !== 'string') return false
      if (values.openTabSessions?.some((session: any) => !session || typeof session.sessionId !== 'string')) return false
    }
    if (!space.workspaces.some((workspace: Workspace) => workspace.id === space.activeWorkspaceId)) return false
  }
  return value.activeSpaceId === null ? value.spaces.length === 0 : value.spaces.some((space: Space) => space.id === value.activeSpaceId)
}

export class SpacesController {
  readonly preferences = new WorkspaceRuntime({ id: 'appearance', name: 'Appearance', values: {} }, () => {})
  private state: SpacesState
  private readonly listeners = new Set<() => void>()
  private readonly attentionListeners = new Set<() => void>()
  private readonly attention = new Map<string, string>()
  private attentionVersion = 0
  private readonly runtimes = new Map<string, WorkspaceRuntime>()
  private timer: ReturnType<typeof setTimeout> | null = null
  readonly file: string
  readonly migrated: boolean
  private healthy = true
  private recoveredFromBackup = false
  persistenceError: string | null = null
  constructor(readonly launchCwd = process.cwd()) {
    this.file = path.join(launchCwd, '.agent-viewer-data', 'spaces.json')
    let restored: SpacesState | null = null
    let invalid = false
    for (const file of [this.file, `${this.file}.bak`]) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'), decode)
        if (validState(parsed)) { restored = parsed; this.recoveredFromBackup = file.endsWith('.bak'); break }
        invalid = true
      } catch { if (existsSync(file)) invalid = true }
    }
    this.healthy = !invalid || restored !== null
    this.migrated = !restored && !invalid
    const workspace = createWorkspace()
    if (this.migrated) workspace.values = { workspaceLaunched: true, workspaceHasSession: true, legacyInitialWorkspace: true }
    const space: Space = { id: randomUUID(), name: path.basename(launchCwd) || 'Project', cwd: canonicalSpacePath(launchCwd), workspaces: [workspace], activeWorkspaceId: workspace.id }
    this.state = restored ?? { version: 1, spaces: [space], activeSpaceId: space.id }
  }
  get recoveryWarning(): string | null { return !this.healthy ? 'Spaces could not be restored. Existing files were preserved; changes will not overwrite them.' : this.recoveredFromBackup ? 'Spaces restored from the last known good backup.' : null }
  get workspacesEnabled(): boolean { return this.state.workspacesEnabled !== false }
  setWorkspacesEnabled(enabled: boolean): void {
    if (this.workspacesEnabled === enabled) return
    this.state.workspacesEnabled = enabled
    this.publish()
  }
  getSnapshot = (): SpacesState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  subscribeAttention = (listener: () => void): (() => void) => { this.attentionListeners.add(listener); return () => { this.attentionListeners.delete(listener) } }
  getAttentionVersion = (): number => this.attentionVersion
  getAttention(id: string): string { return this.attention.get(id) ?? '' }
  setAttention(id: string, mark: string): void { if (this.getAttention(id) === mark) return; this.attention.set(id, mark); this.attentionVersion++; this.attentionListeners.forEach(listener => listener()) }
  activeSpace(): Space | null { return this.state.spaces.find(space => space.id === this.state.activeSpaceId) ?? null }
  activeWorkspace(): Workspace | null { const space = this.activeSpace(); return space?.workspaces.find(workspace => workspace.id === space.activeWorkspaceId) ?? null }
  runtime(workspace: Workspace): WorkspaceRuntime {
    let runtime = this.runtimes.get(workspace.id)
    if (!runtime) this.runtimes.set(workspace.id, runtime = new WorkspaceRuntime(workspace, () => this.scheduleSave()))
    return runtime
  }
  private publish(): void { this.state = { ...this.state, spaces: [...this.state.spaces] }; this.listeners.forEach(listener => listener()); this.scheduleSave() }
  private leave(): void { const workspace = this.activeWorkspace(); if (workspace) { const runtime = this.runtimes.get(workspace.id); runtime?.flushers.forEach(flush => flush()); runtime?.beforeLeave?.(); if (runtime) for (const key of runtime.values.keys()) runtime.restoredKeys.add(key) } }
  activate(spaceId: string, workspaceId?: string): void {
    const space = this.state.spaces.find(space => space.id === spaceId)
    if (!space || (workspaceId && !space.workspaces.some(workspace => workspace.id === workspaceId))) return
    if (spaceId === this.state.activeSpaceId && (!workspaceId || workspaceId === space.activeWorkspaceId)) return
    this.leave()
    if (this.getAttention(workspaceId ?? space.activeWorkspaceId) === '●') this.setAttention(workspaceId ?? space.activeWorkspaceId, '')
    this.state.activeSpaceId = spaceId
    if (workspaceId) space.activeWorkspaceId = workspaceId
    this.publish()
  }
  addSpace(cwd: string, name?: string): Space {
    this.leave()
    const absolute = canonicalSpacePath(path.resolve(this.launchCwd, cwd))
    const workspace = createWorkspace()
    const space = { id: randomUUID(), name: cleanName(name || path.basename(absolute) || 'Project'), cwd: absolute, workspaces: [workspace], activeWorkspaceId: workspace.id }
    this.state.spaces.push(space); this.state.activeSpaceId = space.id; this.publish(); return space
  }
  addWorkspace(spaceId: string): Workspace | null {
    const space = this.state.spaces.find(space => space.id === spaceId)
    if (!space) return null
    this.leave()
    let number = 1
    while (space.workspaces.some(workspace => workspace.name === String(number))) number++
    const workspace = createWorkspace(String(number))
    space.workspaces.push(workspace); space.activeWorkspaceId = workspace.id; this.state.activeSpaceId = space.id; this.publish(); return workspace
  }
  rename(id: string, name: string): void {
    for (const space of this.state.spaces) {
      const item = space.id === id ? space : space.workspaces.find(workspace => workspace.id === id)
      if (item) { item.name = cleanName(name); this.publish(); return }
    }
  }
  move(id: string, delta: -1 | 1): void {
    const lists: Array<Array<Space | Workspace>> = [this.state.spaces, ...this.state.spaces.map(space => space.workspaces)]
    for (const list of lists) {
      const index = list.findIndex(item => item.id === id)
      const to = index + delta
      if (index >= 0 && to >= 0 && to < list.length) { [list[index], list[to]] = [list[to]!, list[index]!]; this.publish(); return }
    }
  }
  close(id: string): void {
    if (id === this.activeSpace()?.id || id === this.activeWorkspace()?.id) this.leave()
    const dispose = (workspace: Workspace) => { const runtime = this.runtimes.get(workspace.id); if (runtime) { runtime.disposed = true; this.runtimes.delete(workspace.id) } }
    const spaceIndex = this.state.spaces.findIndex(space => space.id === id)
    if (spaceIndex >= 0) {
      const [removed] = this.state.spaces.splice(spaceIndex, 1)
      removed!.workspaces.forEach(dispose)
      if (this.state.activeSpaceId === id) this.state.activeSpaceId = this.state.spaces[Math.max(0, spaceIndex - 1)]?.id ?? null
    } else for (const space of this.state.spaces) {
      const index = space.workspaces.findIndex(workspace => workspace.id === id)
      if (index < 0) continue
      dispose(space.workspaces.splice(index, 1)[0]!)
      if (!space.workspaces.length) space.workspaces.push(createWorkspace())
      if (space.activeWorkspaceId === id) space.activeWorkspaceId = space.workspaces[Math.max(0, index - 1)]!.id
      break
    }
    this.publish()
  }
  workspacesFor(id: string): Workspace[] { const space = this.state.spaces.find(space => space.id === id); return space?.workspaces ?? this.state.spaces.flatMap(space => space.workspaces.filter(workspace => workspace.id === id)) }
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.healthy) return
    const state = { ...this.state, spaces: this.state.spaces.map(space => ({ ...space, workspaces: space.workspaces.map(workspace => ({ ...workspace, values: this.runtimes.get(workspace.id)?.snapshot() ?? workspace.values })) })) }
    mkdirSync(path.dirname(this.file), { recursive: true })
    const data = JSON.stringify(state, encode, 2)
    // Preserve the previous validated generation before replacing the main file.
    if (existsSync(this.file)) {
      try { const old = readFileSync(this.file, 'utf8'); if (validState(JSON.parse(old, decode))) { writeFileSync(`${this.file}.bak.tmp`, old); renameSync(`${this.file}.bak.tmp`, `${this.file}.bak`) } } catch { /* retain last good backup */ }
    }
    writeFileSync(`${this.file}.tmp`, `${data}\n`); renameSync(`${this.file}.tmp`, this.file)
    if (this.persistenceError) { this.persistenceError = null; this.setAttention('__storage', '') }
  }
  private scheduleSave(): void {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = null; try { this.flush() } catch (error) { this.persistenceError = `Spaces could not be saved: ${error instanceof Error ? error.message : String(error)}`; this.setAttention('__storage', this.persistenceError) } }, 350)
  }
}
function cleanName(name: string): string { const result = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); if (!result || result.length > 60) throw new Error('Use a name between 1 and 60 characters'); return result }

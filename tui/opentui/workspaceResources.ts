/** Lightweight ownership metadata; importing navigation never loads PTY/provider code. */
export type WorkspaceResource = { id: string; ownerId: string; label: string; running: boolean; error: boolean; stop: () => void }
const resources = new Map<string, WorkspaceResource>()
const closed = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
export function updateWorkspaceResource(resource: WorkspaceResource): void {
  if (closed.has(resource.ownerId)) return
  const previous = resources.get(resource.id)
  resources.set(resource.id, resource)
  if (previous?.ownerId !== resource.ownerId || previous?.running !== resource.running || previous?.error !== resource.error || !previous) { version++; listeners.forEach(listener => listener()) }
}
export function forgetWorkspaceResource(id: string): void { if (resources.delete(id)) { version++; listeners.forEach(listener => listener()) } }
export function workspaceResources(ownerIds: readonly string[]): WorkspaceResource[] { return [...resources.values()].filter(resource => ownerIds.includes(resource.ownerId)) }
export function closeWorkspaceResources(ownerId: string): void { closed.add(ownerId); for (const resource of workspaceResources([ownerId])) { resource.stop(); forgetWorkspaceResource(resource.id) } }
export function isWorkspaceClosed(ownerId?: string): boolean { return Boolean(ownerId && closed.has(ownerId)) }
export function subscribeWorkspaceResources(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function workspaceResourceVersion(): number { return version }

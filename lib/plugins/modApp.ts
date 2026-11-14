// Public, browser-safe mod app contract. Only the shell publishes context.
import { getPluginCommand, listPluginCommands, listLocalPluginManifests } from './catalog'
import { isPluginEnabled } from './enablement'
import { isAgentProvider } from '../provider'
import type { PluginSessionRef } from './bookmarks'
import type { LocalPluginManifest } from './localManifest'

export type ModAppCommand = { id: string; label: string; available: boolean; reason?: string }
export type ModAppSnapshot = {
  version: 1
  instanceId: string
  renderer: 'web' | 'tui'
  cwd: string | null
  theme: string | null
  focused: boolean | null
  focusedSurface: string | null
  surfaces: readonly { id: string; placement: string }[]
  selectedKey: string | null
  sessions: readonly { key: string; title: string; cwd: string | null; activity: 'needs-input' | 'running' | 'waiting' | 'idle'; target: PluginSessionRef }[]
  commands: readonly ModAppCommand[]
}
export type ModAppEffect = { type: 'command'; id: string } | { type: 'session'; target: PluginSessionRef } | { type: 'file'; path: string; line?: number }
export type ModApp = {
  getSnapshot: () => ModAppSnapshot
  subscribe: (listener: () => void) => () => void
  commands: { list: () => readonly ModAppCommand[]; run: (id: string) => Promise<void> }
  openSession: (target: PluginSessionRef) => Promise<void>
  openFile: (path: string, line?: number) => Promise<void>
}
export const EMPTY_MOD_APP: ModAppSnapshot = Object.freeze({ version: 1, instanceId: '', renderer: 'web', cwd: null, theme: null, focused: null, focusedSurface: null, surfaces: [], selectedKey: null, sessions: [], commands: [] })
let snapshot = EMPTY_MOD_APP
const listeners = new Set<() => void>()
let host: { runCommand: (id: string) => boolean | void; openSession?: (target: PluginSessionRef) => void | Promise<void>; openFile?: (path: string, line?: number) => void | Promise<void> } | null = null
export const modAppStore = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  publish(next: ModAppSnapshot) {
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return
    snapshot = freezeSnapshot(next)
    for (const listener of listeners) listener()
  },
  bind(next: NonNullable<typeof host>) { host = next; return () => { if (host === next) host = null } },
}
export function freezeSnapshot(value: ModAppSnapshot): ModAppSnapshot {
  const copy = structuredClone(value)
  const freeze = (entry: unknown): void => { if (entry && typeof entry === 'object') { Object.values(entry).forEach(freeze); Object.freeze(entry) } }
  freeze(copy)
  return copy
}
export function modAppCommands(renderer: 'web' | 'tui', cwd: string | null, selectedKey: string | null): ModAppCommand[] {
  return listPluginCommands(renderer).filter(command => command.opens && !command.handler && !command.webDashboard && !command.webReader).map(command => {
    const reason = !isPluginEnabled(command.pluginId) ? 'Plugin is disabled' : command.requires === 'session' && !selectedKey ? 'Select a session first' : command.requires === 'repository' && !cwd ? 'Open a repository first' : undefined
    return { id: command.id, label: command.label, available: !reason, ...(reason ? { reason } : {}) }
  })
}
export function decodeModAppEffect(raw: unknown): ModAppEffect | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.type === 'command' && typeof value.id === 'string' && value.id.length <= 128) return { type: 'command', id: value.id }
  if (value.type === 'file' && typeof value.path === 'string' && value.path.length <= 4096 && !/[\x00-\x1f]/.test(value.path)) return { type: 'file', path: value.path, ...(typeof value.line === 'number' && Number.isInteger(value.line) && value.line > 0 ? { line: value.line } : {}) }
  if (value.type === 'session' && value.target && typeof value.target === 'object') {
    const target = value.target as PluginSessionRef
    if (typeof target.sessionId === 'string' && isAgentProvider(target.provider) && (target.providerInstanceId === undefined || typeof target.providerInstanceId === 'string')) return { type: 'session', target: { sessionId: target.sessionId, provider: target.provider, providerInstanceId: target.providerInstanceId } }
  }
  return null
}
export async function applyModAppEffects(pluginId: string, effects: readonly ModAppEffect[], captured: ModAppSnapshot): Promise<void> {
  const manifest = listLocalPluginManifests().find(item => item.id === pluginId)
  if (!manifest?.appServices?.includes('navigation')) throw new Error('Mod must declare appServices: ["navigation"]')
  for (const effect of effects) {
    const current = modAppStore.getSnapshot()
    if (!isPluginEnabled(pluginId) || current.instanceId !== captured.instanceId || current.selectedKey !== captured.selectedKey || current.cwd !== captured.cwd || !host) throw new Error('Mod app target is no longer active')
    if (effect.type === 'command') {
      const command = current.commands.find(item => item.id === effect.id)
      const entry = getPluginCommand(effect.id)
      if (!command?.available || !entry?.opens || entry.handler || !isPluginEnabled(entry.pluginId)) throw new Error(command?.reason ?? 'Command is unavailable to mods')
      if (host.runCommand(effect.id) === false) throw new Error('No command host is available')
    } else if (effect.type === 'session') {
      if (!host.openSession) throw new Error('Session navigation is unavailable')
      await host.openSession(effect.target)
    } else {
      if (!host.openFile) throw new Error('File navigation is unavailable')
      await host.openFile(effect.path, effect.line)
    }
  }
}
export function modAppFor(manifest: Pick<LocalPluginManifest, 'id' | 'appServices'>, alive: () => boolean = () => true): ModApp | undefined {
  if (!manifest.appServices?.length) return undefined
  const run = (effect: ModAppEffect) => alive() ? applyModAppEffects(manifest.id, [effect], snapshot) : Promise.reject(new Error('Mod view is closed'))
  return {
    getSnapshot: modAppStore.getSnapshot, subscribe: modAppStore.subscribe,
    commands: { list: () => snapshot.commands, run: id => run({ type: 'command', id }) },
    openSession: target => run({ type: 'session', target }),
    openFile: (path, line) => run({ type: 'file', path, line }),
  }
}

/** HTTP inputs are reduced to public context, never spread into inspection files. */
export function decodeModAppSnapshot(raw: unknown): ModAppSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as Record<string, unknown>
  if (v.version !== 1 || (v.renderer !== 'web' && v.renderer !== 'tui') || typeof v.instanceId !== 'string' || !/^(web|tui)-[a-zA-Z0-9-]{1,100}$/.test(v.instanceId)) return undefined
  const text = (value: unknown, max = 4096) => typeof value === 'string' ? value.slice(0, max) : null
  const sessions: ModAppSnapshot['sessions'][number][] = []
  for (const item of Array.isArray(v.sessions) ? v.sessions.slice(0, 2000) : []) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const effect = decodeModAppEffect({ type: 'session', target: row.target })
    if (effect?.type !== 'session' || !text(row.key)) continue
    sessions.push({ key: text(row.key)!, title: text(row.title, 300) ?? '', cwd: text(row.cwd), target: effect.target, activity: row.activity === 'running' || row.activity === 'needs-input' || row.activity === 'waiting' ? row.activity : 'idle' })
  }
  return freezeSnapshot({ version: 1, instanceId: v.instanceId, renderer: v.renderer, cwd: text(v.cwd), theme: text(v.theme, 100), focused: typeof v.focused === 'boolean' ? v.focused : null, focusedSurface: text(v.focusedSurface, 128), selectedKey: text(v.selectedKey), sessions,
    surfaces: (Array.isArray(v.surfaces) ? v.surfaces.slice(0, 200) : []).flatMap((row: { id?: unknown; placement?: unknown } | null) => row && typeof row.id === 'string' && typeof row.placement === 'string' ? [{ id: row.id.slice(0, 128), placement: row.placement.slice(0, 32) }] : []),
    commands: (Array.isArray(v.commands) ? v.commands.slice(0, 500) : []).flatMap((row: ModAppCommand | null) => row && typeof row.id === 'string' && typeof row.label === 'string' ? [{ id: row.id.slice(0, 128), label: row.label.slice(0, 200), available: row.available === true, ...(typeof row.reason === 'string' ? { reason: row.reason.slice(0, 300) } : {}) }] : []),
  })
}

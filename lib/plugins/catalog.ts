// The bundled feature plugins' manifests: metadata only, safe in Web clients,
// the TUI root and workers. Adding a plugin adds one line here and one line in
// each renderer's loader list (components/shell/pluginViews.ts,
// tui/opentui/shell/pluginViews.ts); no root, palette or window-kind union
// changes.
import { manifest as subagents } from '../../plugins/subagents/manifest'
import { manifest as goals } from '../../plugins/goals/manifest'
import { manifest as composerTools } from '../../plugins/composer-tools/manifest'
import { manifest as analytics } from '../../plugins/analytics/manifest'
import { manifest as git } from '../../plugins/git/manifest'
import { manifest as files } from '../../plugins/files/manifest'
import { manifest as editor } from '../../plugins/editor/manifest'
import { manifest as messaging } from '../../plugins/messaging/manifest'
import { manifest as tasks } from '../../plugins/tasks/manifest'
import { manifest as bridges } from '../../plugins/bridges/manifest'
import { manifest as diagnostics } from '../../plugins/diagnostics/manifest'
import { manifest as terminal } from '../../plugins/terminal/manifest'
import { manifest as browser } from '../../plugins/browser/manifest'
import { manifest as pullRequests } from '../../plugins/pull-requests/manifest'
import { manifest as checkpoints } from '../../plugins/checkpoints/manifest'
import { manifest as fileHistory } from '../../plugins/file-history/manifest'
import { manifest as coordination } from '../../plugins/coordination/manifest'
import { manifest as desk } from '../../plugins/desk/manifest'
import { manifest as sessionInsights } from '../../plugins/session-insights/manifest'
import { manifest as tabManager } from '../../plugins/tab-manager/manifest'
import { manifest as sessionAlerts } from '../../plugins/session-alerts/manifest'
import { manifest as promptLibrary } from '../../plugins/prompt-library/manifest'
import { manifest as composerContext } from '../../plugins/composer-context/manifest'
import { manifest as recaps } from '../../plugins/recaps/manifest'
import { manifest as github } from '../../plugins/github/manifest'
import { manifest as dailySummary } from '../../plugins/daily-summary/manifest'
import { manifest as handoff } from '../../plugins/handoff/manifest'
import { manifest as bookmarks } from '../../plugins/bookmarks/manifest'
import { manifest as provenance } from '../../plugins/provenance/manifest'
import { manifest as remoteAccess } from '../../plugins/remote-access/manifest'
import { manifest as piActivity } from '../../plugins/pi-activity/manifest'
import { manifest as runDashboard } from '../../plugins/run-dashboard/manifest'
import type { PluginCommandSpec, PluginManifest, PluginRenderer, PluginSurfaceSpec } from './types'

export const PLUGIN_MANIFESTS = [analytics, git, files, editor, messaging, tasks, bridges, diagnostics, terminal, browser, subagents, pullRequests, checkpoints, fileHistory, coordination, desk, recaps, github, dailySummary, handoff, bookmarks, provenance, remoteAccess, piActivity, runDashboard, sessionInsights, tabManager, sessionAlerts, composerContext, promptLibrary, composerTools, goals] as const satisfies readonly PluginManifest[]

type BundledManifest = (typeof PLUGIN_MANIFESTS)[number]
export type PluginId = BundledManifest['id']
export type PluginSurfaceId = BundledManifest['surfaces'][number]['id']
export type PluginCommandId = BundledManifest['commands'][number]['id']
type BundledSurface = BundledManifest['surfaces'][number]
/** Surfaces that may sit in the side panel: hosts treat these ids as side-panel kinds. */
export type PluginPanelSurfaceId = BundledSurface extends infer S
  ? S extends { readonly id: infer I; readonly placements: readonly (infer P)[] } ? ('panel' extends P ? I : never) : never
  : never
/** Surfaces that are popover kinds only (overlay and window). */
export type PluginPopoverSurfaceId = Exclude<PluginSurfaceId, PluginPanelSurfaceId>
export type CheckedPanelSurfaceIds = PluginPanelSurfaceId

export type ResolvedPluginSurface = PluginSurfaceSpec & { readonly pluginId: PluginId; readonly stateVersion: number }
export type ResolvedPluginCommand = PluginCommandSpec & { readonly pluginId: PluginId }

const surfaces = new Map<string, ResolvedPluginSurface>()
const commands = new Map<string, ResolvedPluginCommand>()
for (const manifest of PLUGIN_MANIFESTS as readonly PluginManifest[]) {
  for (const surface of manifest.surfaces) {
    if (surfaces.has(surface.id)) throw new Error(`Duplicate plugin surface id: ${surface.id}`)
    surfaces.set(surface.id, { ...surface, pluginId: manifest.id as PluginId, stateVersion: manifest.stateVersion })
  }
  for (const command of manifest.commands) {
    if (commands.has(command.id)) throw new Error(`Duplicate plugin command id: ${command.id}`)
    if (command.handler) {
      if (command.opens !== undefined || command.placement !== undefined || !command.handler.trim()) throw new Error(`Invalid plugin action: ${command.id}`)
    } else {
      if (!manifest.surfaces.some(surface => surface.id === command.opens)) throw new Error(`Plugin command ${command.id} opens an undeclared surface: ${command.opens}`)
      if (!manifest.surfaces.find(surface => surface.id === command.opens)!.placements.includes(command.webDashboard ? 'window' : command.webReader ? 'panel' : command.placement ?? 'overlay')) throw new Error(`Plugin command ${command.id} opens ${command.opens} where it cannot be placed`)
    }
    if (command.webDashboard && (!command.renderers.includes('web') || command.scope !== 'application' || command.requires !== null || !manifest.dashboards?.some(dashboard => dashboard.id === command.webDashboard && dashboard.command === command.id && dashboard.surface === command.opens))) throw new Error(`Invalid plugin dashboard command: ${command.id}`)
    if (command.webReader && (!command.renderers.includes('web') || command.scope !== 'session' || command.requires !== 'session' || !manifest.reader?.some(spec => spec.id === command.webReader && spec.surface === command.opens))) throw new Error(`Invalid reader command: ${command.id}`)
    commands.set(command.id, { ...command, pluginId: manifest.id as PluginId })
  }
}

export function isPluginSurfaceId(id: unknown): id is PluginSurfaceId {
  return typeof id === 'string' && surfaces.has(id)
}

export function isPluginPanelSurfaceId(id: string): id is PluginPanelSurfaceId {
  return surfaces.get(id)?.placements.includes('panel') ?? false
}

export function getPluginSurface(id: PluginSurfaceId): ResolvedPluginSurface {
  return surfaces.get(id)!
}

export function listPluginSurfaces(renderer: PluginRenderer): ResolvedPluginSurface[] {
  return [...surfaces.values()].filter(surface => PLUGIN_MANIFESTS.find(m => m.id === surface.pluginId)!.renderers.includes(renderer as never))
}

export function getPluginCommand(id: string): ResolvedPluginCommand | undefined {
  return commands.get(id)
}

export function listPluginCommands(renderer: PluginRenderer): ResolvedPluginCommand[] {
  return [...commands.values()].filter(command => command.renderers.includes(renderer))
}

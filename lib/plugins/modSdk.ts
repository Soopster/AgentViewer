export type { PluginRuntimeEvent, PluginRuntimeEventContext, PluginRuntimeCapabilities } from './runtimeEvents'
export type { PluginPermissionReceipt, PluginPermissionTrace } from './permissionHistory'
export type { ModPackageMetadata } from './modPackageMetadata'
// Public, type-only SDK: importing these contracts loads no providers or host UI.
export type { ModConfigSchema, ModConfigField, ModConfigValue } from './modConfig'
export type { ModViewBlock, ModViewContent } from './modViews'
export type { LocalCommandEffects, LocalPluginManifest } from './localManifest'
export type { LocalCommandContext, LocalModContext } from './localPluginRuntime'
export type { ModAppSnapshot } from './modApp'
import type { PluginBehaviorModule } from './behavior'
import type { LocalCommandContext, LocalModContext } from './localPluginRuntime'
import type { LocalCommandEffects } from './localManifest'
import type { ModViewContent } from './modViews'
type Hook<K extends keyof PluginBehaviorModule> = NonNullable<PluginBehaviorModule[K]> extends (context: infer C) => infer R ? (context: C & LocalModContext) => R : never
export type ModServerModule = {
  readonly beforeTurn?: Hook<'beforeTurn'>
  readonly afterTurn?: Hook<'afterTurn'>
  readonly beforeSteer?: Hook<'beforeSteer'>
  readonly permission?: Hook<'permission'>
  readonly runtimeEvent?: Hook<'runtimeEvent'>
  readonly toolCard?: Hook<'toolCard'>
  readonly transcriptCard?: Hook<'transcriptCard'>
  /** Handlers for the `tools` plugin.json declares: operations an agent can call through the agent-viewer MCP bridge. */
  readonly tools?: Record<string, (args: Record<string, string | number | boolean>, context: { signal: AbortSignal }) => unknown>
  readonly deactivate?: () => void
  readonly commands?: Readonly<Record<string, (context: LocalCommandContext) => LocalCommandEffects | Promise<LocalCommandEffects>>>
  readonly widgets?: Readonly<Record<string, (context: LocalModContext & { signal: AbortSignal }) => { title?: string; text?: string; lines?: readonly string[]; tone?: 'info' | 'success' | 'warning' | 'error' } | null | Promise<{ title?: string; text?: string; lines?: readonly string[]; tone?: 'info' | 'success' | 'warning' | 'error' } | null>>>
  readonly views?: Readonly<Record<string, (context: LocalModContext & { signal: AbortSignal }) => ModViewContent | Promise<ModViewContent>>>
  readonly actions?: Readonly<Record<string, (context: LocalModContext & { signal: AbortSignal; view: string; item?: string }) => LocalCommandEffects | Promise<LocalCommandEffects>>>
}

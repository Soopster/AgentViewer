/** @jsxImportSource @opentui/react */
import { lazyComponent } from '../lazyComponent'

// Overlays load when first opened — see lazyComponent.tsx.
export const PluginManagerPopover = lazyComponent(() => import('../PluginManagerPopover').then((module) => module.PluginManagerPopover))
export const PromptLibraryPopover = lazyComponent(() => import('../PromptLibraryPopover').then((module) => module.PromptLibraryPopover))
export const ContextMenu = lazyComponent(() => import('../ContextMenu').then((module) => module.ContextMenu))
export const WindowBroadcastPopover = lazyComponent(() => import('../WindowBroadcastPopover').then((module) => module.WindowBroadcastPopover))
export const WindowLayoutPicker = lazyComponent(() => import('../WindowLayoutPicker').then((module) => module.WindowLayoutPicker))
export const DailySummaryPopover = lazyComponent(() => import('../DailySummaryPopover').then((module) => module.DailySummaryPopover))
export const RemoteCoordinatorPopover = lazyComponent(() => import('../RemoteCoordinatorPopover').then((module) => module.RemoteCoordinatorPopover))
export const PlaybookManagerPopover = lazyComponent(() => import('../PlaybookManagerPopover').then((module) => module.PlaybookManagerPopover))
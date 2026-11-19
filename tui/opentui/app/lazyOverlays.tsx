/** @jsxImportSource @opentui/react */
import { lazyComponent } from '../lazyComponent'

// Overlays load when first opened — see lazyComponent.tsx.
export const PluginManagerPopover = lazyComponent(() => import('../PluginManagerPopover').then((module) => module.PluginManagerPopover))
export const ContextMenu = lazyComponent(() => import('../ContextMenu').then((module) => module.ContextMenu))
export const WindowBroadcastPopover = lazyComponent(() => import('../WindowBroadcastPopover').then((module) => module.WindowBroadcastPopover))
export const WindowLayoutPicker = lazyComponent(() => import('../WindowLayoutPicker').then((module) => module.WindowLayoutPicker))
export const RemoteCoordinatorPopover = lazyComponent(() => import('../RemoteCoordinatorPopover').then((module) => module.RemoteCoordinatorPopover))

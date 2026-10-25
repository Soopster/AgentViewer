// What a TUI plugin view may import from the host. Plugins reach shared
// presentation primitives through this module only, never App.tsx or another
// root module, so the host can change its internals without breaking them.
export { PopoverDetachButton, popoverFrameCells, popoverRootProps } from '../dockedPopover'
export { tuiWorkerUrl } from '../workerUrl'
export type { TuiThemePalette } from '../../theme'
export type { TuiPluginView, TuiPluginViewProps, TuiPluginServices, TuiPluginKeyEvent } from './pluginTypes'
export { useWorkspaceState } from '../workspaceContext'
export { detectTuiCodeFiletypeFromPath } from '../../codeFiletypes'

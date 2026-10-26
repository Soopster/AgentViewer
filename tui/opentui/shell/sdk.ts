// What a TUI plugin view may import from the host. Plugins reach shared
// presentation primitives through this module only, never App.tsx or another
// root module, so the host can change its internals without breaking them.
export { PopoverDetachButton, popoverFrameCells, popoverRootProps } from '../dockedPopover'
export { tuiWorkerUrl } from '../workerUrl'
export type { TuiThemePalette } from '../../theme'
export type { TuiPluginView, TuiPluginViewProps, TuiPluginServices, TuiPluginKeyEvent, TuiPluginCapture } from './pluginTypes'
export { useWorkspaceContext, useWorkspaceState } from '../workspaceContext'
export { createScrollVelocityState, velocityScrollStep } from '../scrollVelocity'
export { createSidebarSessionSearch } from '../sidebarSessionSearch'
export { filterComposerMentionEntries, type ComposerMentionFileEntry } from '../composerMentionRanking'
export { detectTuiCodeFiletypeFromPath } from '../../codeFiletypes'
export { MODAL_CONTENT_Z_INDEX } from '../layers'
export { getProviderAccent } from '../../theme'
export { fitText } from '../textLayout'
export { isCtrlKey, isShiftedKey } from '../shortcutKeys'
export { normalizeBrowserUrl, openExternalUrl, terminalBrowserCommand, terminalBrowserEnabled } from '../terminalBrowser'

export { createPluginResourceScope } from '../../../lib/plugins/lifecycle'

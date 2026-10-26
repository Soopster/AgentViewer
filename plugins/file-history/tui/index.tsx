/** @jsxImportSource @opentui/react */
// TUI entry for the file-history plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { FileHistoryPopover } from './FileHistoryPopover'

const IGNORE_NOTICE = () => {}

function FileHistorySurface({ services, target, theme, accent, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const repository = services.repository!
  const composer = services.composer
  const overlay = placement === 'overlay'
  if (!target.path) return <text fg={theme.dim}>  No file to show.</text>
  return (
    <FileHistoryPopover
      docked={!overlay}
      cwd={repository.cwd}
      path={target.path}
      theme={theme}
      accentColor={accent}
      width={width}
      height={height}
      onClose={close}
      onNotice={services.notices?.show ?? IGNORE_NOTICE}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onAskAgent={composer?.askAboutSelection ? (request) => {
        composer.askAboutSelection!(request)
        // The composer is under a full-screen overlay; a window leaves it in view.
        if (overlay) close()
      } : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'file-history',
  views: { 'file-history': FileHistorySurface },
}

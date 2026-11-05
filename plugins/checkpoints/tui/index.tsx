/** @jsxImportSource @opentui/react */
// TUI entry for the checkpoints plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { CheckpointPopover } from './CheckpointPopover'

const IGNORE_NOTICE = () => {}

function CheckpointsSurface({ services, target, theme, accent, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const repository = services.repository!
  const fileHistory = services['file-history']
  const overlay = placement === 'overlay'
  return (
    <CheckpointPopover
      docked={!overlay}
      cwd={repository.cwd}
      theme={theme}
      accentColor={accent}
      width={width}
      height={height}
      onClose={close}
      onNotice={services.notices?.show ?? IGNORE_NOTICE}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      focusPrompt={target.turn ?? null}
      // A window's history opens as a window beside it; an overlay's, over it.
      onOpenFileHistory={fileHistory ? (path) => fileHistory.open(path, overlay ? 'overlay' : 'window') : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'checkpoints',
  views: { checkpoints: CheckpointsSurface },
}

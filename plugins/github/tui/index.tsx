/** @jsxImportSource @opentui/react */
// TUI entry for the GitHub plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { GitHubPopover } from './GitHubPopover'

const NO_NOTICES = () => {}

function GitHubSurface({ services, theme, width, height, placement, registerKeys, close }: TuiPluginViewProps) {
  const composer = services.composer
  return (
    <GitHubPopover
      docked={placement !== 'overlay'}
      cwd={services.repository!.cwd}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onAskAgent={(prompt) => { composer?.insertText?.(prompt, 'GitHub context added to composer') }}
      onKeyHandlerReady={registerKeys}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'github',
  views: { github: GitHubSurface },
}

/** @jsxImportSource @opentui/react */
// TUI entry for the pull-requests plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { PullRequestPopover } from './PullRequestPopover'

function PullRequestSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const repository = services.repository!
  const composer = services.composer
  return (
    <PullRequestPopover
      docked={placement !== 'overlay'}
      cwd={repository.cwd}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onAskAgent={(prompt) => { composer?.insertText?.(prompt, 'PR question added to composer') }}
      onSendDiffNoteToComposer={composer ? (prompt) => composer.appendDiffNote(prompt, 'PR diff comment added to composer') : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pull-requests',
  views: { 'pull-request': PullRequestSurface },
}

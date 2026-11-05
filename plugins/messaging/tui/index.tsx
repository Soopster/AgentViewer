/** @jsxImportSource @opentui/react */
// TUI entry for the Cross-session messaging plugin: loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { CrossSessionMessagingPopover } from './CrossSessionMessagingPopover'

const NO_NOTICES = () => {}

function MessagingSurface({ services, theme, width, height, placement, registerKeys, setCapture, close, detach }: TuiPluginViewProps) {
  const docked = placement !== 'overlay'
  return (
    <CrossSessionMessagingPopover
      docked={docked}
      currentSession={services.session?.session ?? null}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      onCaptureChange={docked ? setCapture : undefined}
      onDetach={detach}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'messaging',
  views: { messaging: MessagingSurface },
}

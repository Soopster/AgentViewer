/** @jsxImportSource @opentui/react */
// TUI entry for the Session recaps plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { RecapsPopover } from './RecapsPopover'

const NO_NOTICES = () => {}

function RecapsSurface({ services, theme, width, height, placement, registerKeys, close }: TuiPluginViewProps) {
  return (
    <RecapsPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      recap={services.session?.session?.recap ?? null}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'recaps',
  views: { recaps: RecapsSurface },
}

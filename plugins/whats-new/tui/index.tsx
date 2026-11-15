/** @jsxImportSource @opentui/react */
// TUI entry for the What's new plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { WhatsNewPopover } from './WhatsNewPopover'

const NO_NOTICES = () => {}

function WhatsNewSurface({ services, theme, accent, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const clipboard = services.clipboard
  return (
    <WhatsNewPopover
      docked={placement !== 'overlay'}
      theme={theme}
      accentColor={accent}
      width={width}
      height={height}
      read={services['whats-new']!.read}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onCopy={clipboard ? (text) => { void clipboard.write(text) } : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'whats-new',
  views: { 'whats-new': WhatsNewSurface },
}

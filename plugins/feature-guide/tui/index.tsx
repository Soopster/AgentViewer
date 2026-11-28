/** @jsxImportSource @opentui/react */
// TUI entry for What's new in Agent Viewer: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { FeatureGuidePopover } from './FeatureGuidePopover'

const NO_NOTICES = () => {}

function FeatureGuideSurface({ services, theme, accent, width, height, placement, registerKeys, close, detach, runCommand }: TuiPluginViewProps) {
  const clipboard = services.clipboard
  return (
    <FeatureGuidePopover
      docked={placement !== 'overlay'}
      theme={theme}
      accentColor={accent}
      width={width}
      height={height}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onRunCommand={runCommand}
      onCopy={clipboard ? (text) => { void clipboard.write(text) } : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'feature-guide',
  views: { 'feature-guide': FeatureGuideSurface },
}
